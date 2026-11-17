import { shallowReactive } from "vue";
import { ApiError, asApiError, type BackendServices, type DocumentRead } from "../../services/index.ts";
import type { ApiTypes } from "../../services/contracts/api.generated.ts";
import { DocsSnapshotError, parseDocsSnapshot, type DocsSnapshot } from "../editor/docsSnapshot.ts";
import {
  browserDocsDrafts,
  sameDocsDraftScope,
  type DocsDraft,
  type DocsDraftIdentity,
  type DocsDraftRepository,
  type DocsDraftScope,
  type PendingDocsSave,
} from "./docsDrafts.ts";

/**
 * 正式稿（快照 v2）的读取、草稿、保存与冲突。v1 正文只读，经显式升级后进入编辑。
 *
 * - 保存提交完整快照并以 `expected_version` 做 CAS；保存与 AI 采纳互不相干。
 * - 每次编辑写入本机草稿（按服务、项目、本地工作区、正文隔离）；刷新后单份草稿自动恢复。
 * - 结果未知的保存以提交指纹核对最新版本；不一致按冲突处理，不猜测成功。
 */
export type DocsOperation = "create-blank" | "save" | "check" | "recover" | "load-latest" | "upgrade";
type DraftStatus = "idle" | "pending" | "saved" | "error";
export type UpgradeRecord = ApiTypes["DocumentSchemaUpgradeRecord"];

export interface DocsDocumentState {
  phase: "idle" | "loading" | "empty" | "ready" | "error";
  operation: DocsOperation | null;
  /** 当前编辑所依据的服务端正式稿（v1 或 v2）。 */
  document: DocumentRead | null;
  /** 服务端正式稿的结构版本。 */
  schema: 1 | 2 | null;
  /** `document` 的 v2 快照（v1 为 null）。 */
  confirmed: DocsSnapshot | null;
  /** 编辑器应载入的快照：草稿或已确认的正文。 */
  snapshot: DocsSnapshot | null;
  /** 每次需要编辑器换稿时递增（载入、恢复草稿、载入最新）；保存成功不递增，编辑器保持撤销栈。 */
  loadRevision: number;
  /** 比 `document` 更新的服务端版本。 */
  latest: DocumentRead | null;
  baseVersion: number | null;
  dirty: boolean;
  issue: "conflict" | "unknown" | null;
  error: string;
  errorCode: string;
  /** 可恢复的其他草稿（不含当前编辑中的草稿）。 */
  drafts: DocsDraft[];
  draftStatus: DraftStatus;
  draftError: string;
  /** 最近一次保存成功的时间。 */
  savedAt: string | null;
  /** 最近一次显式升级的记录（含损失报告）。 */
  upgrade: UpgradeRecord | null;
}

const draftWriteError = "本机草稿无法写入。编辑内容仍在当前页面，请下载草稿后再离开。";
const draftReadError = "本机草稿无法读取。当前正文保持原状。";
const memoryDrafts = new Map<string, DocsDraft>();

function protectUnsavedDrafts(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}

function keepInMemory(draft: DocsDraft) {
  if (!memoryDrafts.size && typeof window !== "undefined") window.addEventListener("beforeunload", protectUnsavedDrafts);
  memoryDrafts.set(draft.id, draft);
}

function forgetMemoryDraft(draft: DocsDraft) {
  if (memoryDrafts.get(draft.id)?.revision !== draft.revision) return;
  memoryDrafts.delete(draft.id);
  if (!memoryDrafts.size && typeof window !== "undefined") window.removeEventListener("beforeunload", protectUnsavedDrafts);
}

/** 键序无关的 JSON（省略 undefined），用于比较与指纹。 */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : stableJson(item))).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** 快照的业务内容（模型 + 保护）；章节是派生数据，不参与比较。 */
export const snapshotKey = (snapshot: DocsSnapshot) => stableJson({ model: snapshot.model, protections: snapshot.protections });

async function fingerprint(snapshot: DocsSnapshot): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshotKey(snapshot)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const payloadOf = (snapshot: DocsSnapshot): DocumentRead["content"] => ({ schema_version: 2, json: snapshot as never });

/**
 * 服务端新建的空白稿（v1、版本 1、只有空段落）：没有任何内容需要转换。写作页直接升级为 v2，
 * 与“创建空白正式稿”一致；有内容或已有历史的旧正文仍须学生显式升级。
 */
export function isBlankLegacy(document: DocumentRead | null): boolean {
  if (!document || document.version !== 1 || document.content.schema_version !== 1) return false;
  const nodes = (document.content.json as { content?: { type?: string; content?: unknown[] }[] }).content ?? [];
  return nodes.every((node) => node.type === "paragraph" && !node.content?.length);
}

function orderedDrafts(drafts: DocsDraft[]): DocsDraft[] {
  return [...drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

function uncertainWrite(error: ApiError): boolean {
  return (
    ["NETWORK_ERROR", "REQUEST_TIMEOUT", "REQUEST_CANCELLED", "INVALID_RESPONSE", "INTERNAL_ERROR"].includes(error.code) ||
    (error.status !== undefined && error.status >= 500)
  );
}

/** 快照无法解释时给学生看的错误：不载入，服务器版本保持不变。 */
export class UnsupportedSnapshotError extends ApiError {
  constructor() {
    super("INVALID_RESPONSE");
    this.message = new DocsSnapshotError("").message;
  }
}

export function createDocsDocumentController(
  services: Pick<BackendServices, "sourceKey" | "documents">,
  identity: Readonly<DocsDraftIdentity>,
  drafts: DocsDraftRepository = browserDocsDrafts,
) {
  const binding = { ...identity };
  const state = shallowReactive<DocsDocumentState>({
    phase: "idle",
    operation: null,
    document: null,
    schema: null,
    confirmed: null,
    snapshot: null,
    loadRevision: 0,
    latest: null,
    baseVersion: null,
    dirty: false,
    issue: null,
    error: "",
    errorCode: "",
    drafts: [],
    draftStatus: "idle",
    draftError: "",
    savedAt: null,
    upgrade: null,
  });
  let activeDraft: DocsDraft | null = null;
  let persistedDraft: DocsDraft | undefined;
  let queued: Promise<unknown> = Promise.resolve();
  let request: AbortController | undefined;
  let disposed = false;
  let upgradeCommand: { id: string; version: number } | undefined;

  const toScope = (document: DocumentRead): DocsDraftScope => ({ ...binding, documentId: document.id });
  const isCurrent = (candidate: AbortController) => !disposed && request === candidate && services.sourceKey === binding.sourceKey;

  function showError(error?: ApiError) {
    state.error = error?.message ?? "";
    state.errorCode = error?.code ?? "";
  }

  function start(operation: DocsOperation | null) {
    if (disposed || request || services.sourceKey !== binding.sourceKey) return;
    request = new AbortController();
    state.operation = operation;
    showError();
    return request;
  }

  function end(candidate: AbortController) {
    if (!isCurrent(candidate)) return;
    request = undefined;
    state.operation = null;
  }

  /** 校验服务端正文：项目、ID、版本与结构；v2 快照按 ThesisPilot 不变量解析。 */
  function validate(document: DocumentRead, expectedId?: string): { schema: 1 | 2; snapshot: DocsSnapshot | null } {
    if (
      document.project_id !== binding.projectId ||
      (expectedId !== undefined && document.id !== expectedId) ||
      !document.id ||
      !Number.isSafeInteger(document.version) ||
      document.version < 1 ||
      (document.content?.schema_version !== 1 && document.content?.schema_version !== 2)
    )
      throw new ApiError("INVALID_RESPONSE");
    if (document.content.schema_version === 1) return { schema: 1, snapshot: null };
    try {
      return { schema: 2, snapshot: parseDocsSnapshot(document.content.json) };
    } catch {
      throw new UnsupportedSnapshotError();
    }
  }

  function setConfirmed(document: DocumentRead, parsed: { schema: 1 | 2; snapshot: DocsSnapshot | null }) {
    state.document = document;
    state.schema = parsed.schema;
    state.confirmed = parsed.snapshot;
    state.snapshot = parsed.snapshot;
    state.loadRevision += 1;
    state.baseVersion = document.version;
    state.phase = "ready";
    state.latest = null;
    state.issue = null;
    state.dirty = false;
    state.draftStatus = "idle";
    showError();
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = queued.then(work);
    queued = next.catch(() => undefined);
    return next;
  }

  function persist(draft: DocsDraft, required = false): Promise<boolean> {
    return enqueue(async () => {
      if (!required && activeDraft?.revision !== draft.revision) return false;
      if (persistedDraft?.revision === draft.revision) return true;
      try {
        await drafts.put(draft);
        persistedDraft = draft;
        forgetMemoryDraft(draft);
        if (!disposed && activeDraft?.revision === draft.revision) {
          state.draftStatus = "saved";
          if (state.draftError !== draftReadError) state.draftError = "";
        }
        return true;
      } catch {
        if (!disposed && activeDraft?.revision === draft.revision) {
          state.draftStatus = "error";
          state.draftError = draftWriteError;
        }
        return false;
      }
    });
  }

  function setDraft(snapshot: DocsSnapshot, baseVersion: number, pendingSave?: PendingDocsSave) {
    const document = state.document!;
    const draft: DocsDraft = {
      ...toScope(document),
      id: activeDraft?.id ?? crypto.randomUUID(),
      revision: crypto.randomUUID(),
      baseVersion,
      snapshot,
      updatedAt: new Date().toISOString(),
      ...(pendingSave ? { pendingSave } : {}),
    };
    activeDraft = draft;
    state.snapshot = snapshot;
    state.baseVersion = baseVersion;
    state.dirty = true;
    state.draftStatus = "pending";
    keepInMemory(draft);
    void persist(draft);
    return draft;
  }

  async function readDrafts(document: DocumentRead): Promise<{ entries: DocsDraft[]; failed: boolean }> {
    const scope = toScope(document);
    const entries = new Map<string, DocsDraft>();
    let failed = false;
    try {
      for (const draft of await drafts.list(scope)) if (sameDocsDraftScope(draft, scope)) entries.set(draft.id, draft);
    } catch {
      failed = true;
    }
    for (const draft of memoryDrafts.values()) if (sameDocsDraftScope(draft, scope)) entries.set(draft.id, draft);
    return { entries: orderedDrafts([...entries.values()]), failed };
  }

  function discardConfirmed(draft: DocsDraft) {
    forgetMemoryDraft(draft);
    void enqueue(async () => {
      try {
        await drafts.removeIfUnchanged(draft);
        if (persistedDraft?.revision === draft.revision) persistedDraft = undefined;
      } catch {
        if (!disposed && !state.draftError) state.draftError = "正式稿已确认，本机草稿清理失败。";
      }
    });
  }

  function restore(draft: DocsDraft, current: DocumentRead) {
    state.document = current;
    state.drafts = state.drafts.filter((entry) => entry.id !== draft.id);
    setDraft(draft.snapshot, draft.baseVersion, draft.pendingSave);
    state.loadRevision += 1;
    state.issue = draft.baseVersion !== current.version ? "conflict" : draft.pendingSave ? "unknown" : null;
    state.latest = state.issue === "conflict" ? current : null;
  }

  async function load(): Promise<boolean> {
    if (state.phase === "ready") return checkLatest();
    const operation = start(null);
    if (!operation) return false;
    state.phase = "loading";
    try {
      const document = await services.documents.current(binding.projectId, operation.signal);
      if (!isCurrent(operation)) return false;
      const parsed = validate(document);
      const existing = parsed.schema === 2 ? await readDrafts(document) : { entries: [], failed: false };
      if (!isCurrent(operation)) return false;
      setConfirmed(document, parsed);
      state.draftError = existing.failed ? draftReadError : "";
      const confirmedKey = parsed.snapshot ? snapshotKey(parsed.snapshot) : "";
      const listed = new Set<string>();
      state.drafts = existing.entries.filter((draft) => {
        const key = snapshotKey(draft.snapshot);
        if (key === confirmedKey) {
          discardConfirmed(draft);
          return false;
        }
        const equivalent = `${draft.baseVersion}:${draft.pendingSave?.fingerprint ?? ""}:${key}`;
        if (listed.has(equivalent)) return false;
        listed.add(equivalent);
        return true;
      });
      if (state.drafts.length === 1) restore(state.drafts[0]!, document);
      return true;
    } catch (cause) {
      if (!isCurrent(operation)) return false;
      const error = asApiError(cause);
      state.phase = error.code === "DOCUMENT_NOT_FOUND" ? "empty" : "error";
      if (state.phase === "error") showError(cause instanceof UnsupportedSnapshotError ? cause : error);
      return state.phase === "empty";
    } finally {
      end(operation);
    }
  }

  async function runUpgrade(document: DocumentRead, operation: AbortController): Promise<boolean> {
    if (upgradeCommand?.version !== document.version) upgradeCommand = { id: crypto.randomUUID(), version: document.version };
    const result = await services.documents.upgradeSchema(
      binding.projectId,
      document.id,
      { command_id: upgradeCommand.id, expected_version: document.version },
      operation.signal,
    );
    if (!isCurrent(operation)) return false;
    const parsed = validate(result.document, document.id);
    if (parsed.schema !== 2 || result.document.version <= document.version) throw new ApiError("INVALID_RESPONSE");
    upgradeCommand = undefined;
    setConfirmed(result.document, parsed);
    state.upgrade = result.upgrade;
    return true;
  }

  /** 空项目创建正式稿：服务端空白稿仍为 v1，紧接着显式升级为 v2（历史保留两条记录）。 */
  async function createBlank(): Promise<boolean> {
    if (state.phase !== "empty") return false;
    const operation = start("create-blank");
    if (!operation) return false;
    try {
      const document = await services.documents.createBlank(binding.projectId, operation.signal);
      if (!isCurrent(operation)) return false;
      const parsed = validate(document);
      if (document.version !== 1) throw new ApiError("INVALID_RESPONSE");
      setConfirmed(document, parsed);
      if (parsed.schema === 2) return true;
      return await runUpgrade(document, operation);
    } catch (cause) {
      if (!isCurrent(operation)) return false;
      const error = asApiError(cause);
      if (error.code === "DOCUMENT_ALREADY_EXISTS") {
        end(operation);
        state.phase = "idle";
        return load();
      }
      showError(error);
      return false;
    } finally {
      end(operation);
    }
  }

  /** v1 → v2 显式升级：同一操作标识可安全重试；成功后进入编辑。 */
  async function upgrade(): Promise<boolean> {
    const document = state.document;
    if (!document || state.schema !== 1 || state.phase !== "ready") return false;
    const operation = start("upgrade");
    if (!operation) return false;
    try {
      return await runUpgrade(document, operation);
    } catch (cause) {
      if (!isCurrent(operation)) return false;
      const error = asApiError(cause);
      if (!uncertainWrite(error)) upgradeCommand = undefined;
      showError(error);
      if (error.code === "DOCUMENT_VERSION_CONFLICT" || error.code === "DOCUPGRADE_ALREADY_UPGRADED") {
        end(operation);
        const message = state.error;
        const code = state.errorCode;
        await checkLatest();
        if (state.schema === 1) {
          state.error = message;
          state.errorCode = code;
        }
      }
      return false;
    } finally {
      end(operation);
    }
  }

  /** 编辑开始但快照尚未生成：先标记未保存，避免状态滞后。 */
  function touch() {
    if (disposed || state.phase !== "ready" || state.schema !== 2) return;
    state.dirty = true;
    if (state.draftStatus !== "error") state.draftStatus = "pending";
  }

  function edit(snapshot: DocsSnapshot): boolean {
    if (disposed || state.phase !== "ready" || state.schema !== 2 || state.baseVersion === null) return false;
    setDraft(snapshot, state.baseVersion, activeDraft?.pendingSave);
    if (state.latest && state.latest.version > state.baseVersion && state.issue !== "unknown") state.issue = "conflict";
    return true;
  }

  function confirmSave(document: DocumentRead, current: DocsDraft, submittedMatches: boolean, snapshot: DocsSnapshot) {
    state.document = document;
    state.confirmed = snapshot;
    state.latest = null;
    state.issue = null;
    state.baseVersion = document.version;
    state.savedAt = document.updated_at;
    showError();
    if (submittedMatches) {
      activeDraft = null;
      state.dirty = false;
      state.draftStatus = "idle";
      state.draftError = "";
      discardConfirmed(current);
      const persisted = persistedDraft;
      if (persisted?.id === current.id && persisted.revision !== current.revision && snapshotKey(persisted.snapshot) === snapshotKey(current.snapshot))
        discardConfirmed(persisted);
    } else {
      setDraft(current.snapshot, document.version);
    }
  }

  async function save(): Promise<boolean> {
    const document = state.document;
    const draft = activeDraft;
    if (!document || !draft || state.phase !== "ready" || state.schema !== 2 || state.issue || draft.baseVersion !== document.version) return false;
    const operation = start("save");
    if (!operation) return false;
    let sent = false;
    try {
      const expectedVersion = draft.baseVersion;
      const pendingSave = { expectedVersion, fingerprint: await fingerprint(draft.snapshot) };
      if (!isCurrent(operation) || !activeDraft) return false;
      const pending = setDraft(activeDraft.snapshot, expectedVersion, pendingSave);
      if (!(await persist(pending, true)) || !isCurrent(operation)) return false;
      sent = true;
      const response = await services.documents.save(
        binding.projectId,
        document.id,
        { expected_version: expectedVersion, content: payloadOf(draft.snapshot) },
        operation.signal,
      );
      if (!isCurrent(operation) || !activeDraft) return false;
      const parsed = validate(response, document.id);
      if (parsed.schema !== 2 || response.version !== expectedVersion + 1) throw new ApiError("INVALID_RESPONSE");
      confirmSave(response, activeDraft, activeDraft.revision === pending.revision, parsed.snapshot!);
      return true;
    } catch (cause) {
      if (!isCurrent(operation) || !activeDraft) return false;
      const error = asApiError(cause);
      state.issue = error.code === "DOCUMENT_VERSION_CONFLICT" ? "conflict" : sent && uncertainWrite(error) ? "unknown" : null;
      if (state.issue !== "unknown" && activeDraft.pendingSave) setDraft(activeDraft.snapshot, activeDraft.baseVersion);
      showError(error);
      if (state.issue === "conflict") {
        end(operation);
        await checkLatest();
        if (!state.error) showError(error);
      }
      return false;
    } finally {
      end(operation);
    }
  }

  /** 冲突时以当前草稿覆盖为新版本：最新版本的改动不合并，仍在历史中。 */
  async function saveOverLatest(): Promise<boolean> {
    const latest = state.latest;
    if (!latest || !activeDraft || state.issue !== "conflict" || state.operation) return false;
    try {
      validate(latest, state.document?.id);
    } catch (cause) {
      showError(asApiError(cause));
      return false;
    }
    state.document = latest;
    state.latest = null;
    state.issue = null;
    setDraft(activeDraft.snapshot, latest.version);
    return save();
  }

  async function checkLatest(): Promise<boolean> {
    const operation = start("check");
    if (!operation) return false;
    try {
      const latest = await services.documents.current(binding.projectId, operation.signal);
      if (!isCurrent(operation)) return false;
      const parsed = validate(latest, state.document?.id);
      if (latest.version < Math.max(state.document?.version ?? 0, state.latest?.version ?? 0)) throw new ApiError("INVALID_RESPONSE");
      const pendingSave = activeDraft?.pendingSave;
      if (
        pendingSave &&
        parsed.snapshot &&
        latest.version === pendingSave.expectedVersion + 1 &&
        (await fingerprint(parsed.snapshot)) === pendingSave.fingerprint
      ) {
        if (!isCurrent(operation) || !activeDraft) return false;
        confirmSave(latest, activeDraft, snapshotKey(activeDraft.snapshot) === snapshotKey(parsed.snapshot), parsed.snapshot);
      } else if (!isCurrent(operation)) {
        return false;
      } else if (activeDraft) {
        if (latest.version !== activeDraft.baseVersion) {
          state.latest = latest;
          state.issue = "conflict";
        } else {
          if (activeDraft.pendingSave) setDraft(activeDraft.snapshot, activeDraft.baseVersion);
          state.latest = null;
          state.issue = state.issue === "conflict" ? "conflict" : null;
        }
      } else if (state.document?.version === latest.version) {
        // 版本未变：不替换编辑器，也不清空撤销栈。
        state.document = latest;
      } else {
        setConfirmed(latest, parsed);
      }
      return true;
    } catch (cause) {
      if (!isCurrent(operation)) return false;
      const error = asApiError(cause);
      if (error.code === "DOCUMENT_NOT_FOUND" && !state.document) {
        state.phase = "empty";
        state.issue = null;
        return true;
      }
      if (!state.document) state.phase = "error";
      showError(cause instanceof UnsupportedSnapshotError ? cause : error);
      return false;
    } finally {
      end(operation);
    }
  }

  async function archive(operation: AbortController): Promise<boolean> {
    while (activeDraft && isCurrent(operation)) {
      const draft = activeDraft;
      if (!(await persist(draft, true))) return false;
      if (activeDraft !== draft) continue;
      if (!isCurrent(operation)) return false;
      state.drafts = orderedDrafts([...state.drafts.filter((entry) => entry.id !== draft.id), draft]);
      activeDraft = null;
    }
    return isCurrent(operation);
  }

  /** 载入最新版本：当前草稿先保存在本机草稿列表，可随时恢复。 */
  async function loadLatestPreservingDraft(): Promise<boolean> {
    const latest = state.latest;
    if (!latest || state.phase !== "ready") return false;
    const operation = start("load-latest");
    if (!operation) return false;
    try {
      const parsed = validate(latest, state.document?.id);
      if (!(await archive(operation))) return false;
      setConfirmed(latest, parsed);
      return true;
    } catch (cause) {
      if (isCurrent(operation)) showError(asApiError(cause));
      return false;
    } finally {
      end(operation);
    }
  }

  async function recoverDraft(id: string): Promise<boolean> {
    const document = state.latest ?? state.document;
    if (!document || state.phase !== "ready" || state.schema !== 2 || activeDraft?.id === id) return false;
    const operation = start("recover");
    if (!operation) return false;
    try {
      const available = await readDrafts(document);
      if (!isCurrent(operation)) return false;
      const draft = available.entries.find((entry) => entry.id === id);
      if (available.failed || !draft) state.draftError = draftReadError;
      else if (state.draftError === draftReadError) state.draftError = "";
      if (!draft || !(await archive(operation))) return false;
      restore(draft, document);
      return true;
    } finally {
      end(operation);
    }
  }

  function downloadDraft() {
    const draft = activeDraft;
    if (!draft || !state.document) return null;
    return {
      filename: "thesispilot-document-draft.json",
      mime: "application/json;charset=utf-8",
      content: JSON.stringify({ ...toScope(state.document), baseVersion: draft.baseVersion, content: payloadOf(draft.snapshot) }),
    };
  }

  function retryDraft() {
    if (activeDraft && !disposed) void persist(activeDraft);
  }

  /** 当前编辑是否允许面板发起写入：无未保存修改、无冲突、是最新版本、没有进行中的操作。 */
  function eligible(): boolean {
    return (
      !disposed &&
      state.phase === "ready" &&
      state.schema === 2 &&
      !!state.document &&
      !state.dirty &&
      !state.issue &&
      !state.operation &&
      !state.latest &&
      state.baseVersion === state.document.version
    );
  }

  function pause() {
    if (!request) return;
    request.abort();
    request = undefined;
    if (state.phase === "loading") state.phase = "idle";
    if (!state.issue && state.operation === "save" && activeDraft?.pendingSave) state.issue = "unknown";
    state.operation = null;
  }

  function dispose() {
    disposed = true;
    pause();
  }

  return {
    state,
    load,
    createBlank,
    upgrade,
    touch,
    edit,
    save,
    saveOverLatest,
    checkLatest,
    loadLatestPreservingDraft,
    recoverDraft,
    downloadDraft,
    retryDraft,
    eligible,
    pause,
    dispose,
  };
}

export type DocsDocumentController = ReturnType<typeof createDocsDocumentController>;
