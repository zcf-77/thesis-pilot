import { shallowReactive } from "vue";
import { ApiError, asApiError, type BackendServices, type DocumentRead } from "../../services/index.ts";
import {
  browserDocumentDrafts,
  sameDocumentDraftScope,
  type DocumentDraft,
  type DocumentDraftRepository,
  type DocumentDraftScope,
  type PendingDocumentSave,
  type RemoteDocumentIdentity,
} from "./documentDrafts.ts";
import { prepareEditorSnapshot, type EditorSnapshot } from "./editorAdapter.ts";

type Operation = "import" | "save" | "check" | "recover" | "load-latest";
type DraftStatus = "idle" | "pending" | "saved" | "error";

export interface RemoteDocumentState {
  phase: "idle" | "loading" | "empty" | "ready" | "error";
  operation: Operation | null;
  document: DocumentRead | null;
  snapshot: EditorSnapshot | null;
  loadRevision: number;
  latest: DocumentRead | null;
  baseVersion: number | null;
  dirty: boolean;
  issue: "conflict" | "unknown" | null;
  error: string;
  errorCode: string;
  drafts: DocumentDraft[];
  draftStatus: DraftStatus;
  draftError: string;
}

const draftWriteError = "本机草稿无法写入。编辑内容仍在当前页面，请下载草稿。";
const draftReadError = "本机草稿无法读取。当前正文保持原状。";
const memoryDrafts = new Map<string, DocumentDraft>();

function protectUnsavedDrafts(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}

function keepInMemory(draft: DocumentDraft) {
  if (!memoryDrafts.size && typeof window !== "undefined") window.addEventListener("beforeunload", protectUnsavedDrafts);
  memoryDrafts.set(draft.id, draft);
}

function forgetMemoryDraft(draft: DocumentDraft) {
  if (memoryDrafts.get(draft.id)?.revision !== draft.revision) return;
  memoryDrafts.delete(draft.id);
  if (!memoryDrafts.size && typeof window !== "undefined") window.removeEventListener("beforeunload", protectUnsavedDrafts);
}

const jsonOf = (snapshot: EditorSnapshot) => JSON.stringify(snapshot.json);
const payloadOf = (snapshot: EditorSnapshot): DocumentRead["content"] => ({ schema_version: 1, json: snapshot.json });

async function fingerprint(snapshot: EditorSnapshot): Promise<string> {
  const data = new TextEncoder().encode(jsonOf(snapshot));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function orderedDrafts(drafts: DocumentDraft[]): DocumentDraft[] {
  return [...drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

function uncertainWrite(error: ApiError): boolean {
  return (
    ["NETWORK_ERROR", "REQUEST_TIMEOUT", "REQUEST_CANCELLED", "INVALID_RESPONSE", "INTERNAL_ERROR"].includes(error.code) ||
    (error.status !== undefined && error.status >= 500)
  );
}

export function createRemoteDocumentController(
  services: Pick<BackendServices, "sourceKey" | "documents">,
  identity: Readonly<RemoteDocumentIdentity>,
  drafts: DocumentDraftRepository = browserDocumentDrafts,
) {
  const binding = { ...identity };
  const state = shallowReactive<RemoteDocumentState>({
    phase: "idle",
    operation: null,
    document: null,
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
  });
  let activeDraft: DocumentDraft | null = null;
  let persistedDraft: DocumentDraft | undefined;
  let queued: Promise<unknown> = Promise.resolve();
  let request: AbortController | undefined;
  let disposed = false;
  let uncertainImport: EditorSnapshot | null = null;

  const toScope = (document: DocumentRead): DocumentDraftScope => ({ ...binding, documentId: document.id });
  const isCurrent = (candidate: AbortController) => !disposed && request === candidate && services.sourceKey === binding.sourceKey;

  function showError(error?: ApiError) {
    state.error = error?.message ?? "";
    state.errorCode = error?.code ?? "";
  }

  function start(operation: Operation | null) {
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

  function validateResponse(document: DocumentRead, expectedId?: string): EditorSnapshot {
    if (
      document.project_id !== binding.projectId ||
      (expectedId !== undefined && document.id !== expectedId) ||
      !document.id ||
      !Number.isSafeInteger(document.version) ||
      document.version < 1 ||
      document.content?.schema_version !== 1
    ) {
      throw new ApiError("INVALID_RESPONSE");
    }
    try {
      const prepared = prepareEditorSnapshot({ schemaVersion: 1, json: document.content.json, chapters: [] });
      const missingId = (node: EditorSnapshot["json"]): boolean => (node.type === "heading" && !node.attrs?.chapterId) || !!node.content?.some(missingId);
      if (missingId(prepared.json)) throw new ApiError("INVALID_RESPONSE");
      return prepared;
    } catch {
      throw new ApiError("INVALID_RESPONSE");
    }
  }

  function setConfirmed(document: DocumentRead, snapshot: EditorSnapshot) {
    state.document = document;
    state.snapshot = snapshot;
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

  function persist(draft: DocumentDraft, required = false): Promise<boolean> {
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

  function setDraft(snapshot: EditorSnapshot, baseVersion: number, pendingSave?: PendingDocumentSave) {
    const document = state.document!;
    const draft: DocumentDraft = {
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

  async function readDrafts(document: DocumentRead): Promise<{ entries: DocumentDraft[]; failed: boolean }> {
    const scope = toScope(document);
    const entries = new Map<string, DocumentDraft>();
    let failed = false;
    try {
      for (const draft of await drafts.list(scope)) {
        if (sameDocumentDraftScope(draft, scope)) entries.set(draft.id, draft);
      }
    } catch {
      failed = true;
    }
    for (const draft of memoryDrafts.values()) {
      if (sameDocumentDraftScope(draft, scope)) entries.set(draft.id, draft);
    }
    return { entries: orderedDrafts([...entries.values()]), failed };
  }

  function discardConfirmed(draft: DocumentDraft) {
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

  function restore(draft: DocumentDraft, current: DocumentRead) {
    state.document = current;
    state.drafts = state.drafts.filter((entry) => entry.id !== draft.id);
    setDraft(draft.snapshot, draft.baseVersion, draft.pendingSave);
    state.loadRevision += 1;
    state.issue = draft.baseVersion !== current.version ? "conflict" : draft.pendingSave ? "unknown" : null;
    state.latest = state.issue === "conflict" ? current : null;
  }

  async function load(): Promise<boolean> {
    if (state.phase === "ready" || uncertainImport) return checkLatest();
    const operation = start(null);
    if (!operation) return false;
    state.phase = "loading";
    try {
      const document = await services.documents.current(binding.projectId, operation.signal);
      if (!isCurrent(operation)) return false;
      const snapshot = validateResponse(document);
      const existing = await readDrafts(document);
      if (!isCurrent(operation)) return false;
      setConfirmed(document, snapshot);
      state.draftError = existing.failed ? draftReadError : "";
      const latestJson = jsonOf(snapshot);
      const listed = new Set<string>();
      state.drafts = existing.entries.filter((draft) => {
        const draftJson = jsonOf(draft.snapshot);
        if (draftJson === latestJson) {
          discardConfirmed(draft);
          return false;
        }
        const equivalent = `${draft.baseVersion}:${draft.pendingSave?.fingerprint ?? ""}:${draftJson}`;
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
      if (state.phase === "error") showError(error);
      return state.phase === "empty";
    } finally {
      end(operation);
    }
  }

  async function importLocal(snapshot: unknown): Promise<boolean> {
    if (state.phase !== "empty" || state.issue) return false;
    const operation = start("import");
    if (!operation) return false;
    let imported: EditorSnapshot | undefined;
    try {
      imported = prepareEditorSnapshot(snapshot, { assignMissingChapterIds: true });
      const document = await services.documents.import(binding.projectId, { content: payloadOf(imported) }, operation.signal);
      if (!isCurrent(operation)) return false;
      const confirmed = validateResponse(document);
      if (document.version !== 1 || jsonOf(confirmed) !== jsonOf(imported)) throw new ApiError("INVALID_RESPONSE");
      setConfirmed(document, confirmed);
      return true;
    } catch (cause) {
      if (!isCurrent(operation)) return false;
      const error = imported ? asApiError(cause) : new ApiError("DOCUMENT_STRUCTURE_INVALID");
      if (imported && (uncertainWrite(error) || error.code === "DOCUMENT_ALREADY_EXISTS")) {
        uncertainImport = imported;
        state.issue = error.code === "DOCUMENT_ALREADY_EXISTS" ? "conflict" : "unknown";
      }
      showError(error);
      return false;
    } finally {
      end(operation);
    }
  }

  function edit(snapshot: EditorSnapshot): boolean {
    if (disposed || state.phase !== "ready" || state.baseVersion === null) return false;
    try {
      const prepared = prepareEditorSnapshot(snapshot);
      setDraft(prepared, state.baseVersion, activeDraft?.pendingSave);
      return true;
    } catch {
      showError(new ApiError("DOCUMENT_STRUCTURE_INVALID"));
      return false;
    }
  }

  function confirmSave(document: DocumentRead, current: DocumentDraft, submittedMatches: boolean) {
    state.document = document;
    state.latest = null;
    state.issue = null;
    state.baseVersion = document.version;
    showError();
    if (submittedMatches) {
      activeDraft = null;
      state.dirty = false;
      state.draftStatus = "idle";
      state.draftError = "";
      discardConfirmed(current);
      const persisted = persistedDraft;
      if (persisted?.id === current.id && persisted.revision !== current.revision && jsonOf(persisted.snapshot) === jsonOf(current.snapshot)) {
        discardConfirmed(persisted);
      }
    } else {
      setDraft(current.snapshot, document.version);
    }
  }

  async function save(): Promise<boolean> {
    const document = state.document;
    const draft = activeDraft;
    if (!document || !draft || state.phase !== "ready" || state.issue || draft.baseVersion !== document.version) return false;
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
      const confirmed = validateResponse(response, document.id);
      const submittedJson = jsonOf(draft.snapshot);
      if (response.version !== expectedVersion + 1 || jsonOf(confirmed) !== submittedJson) throw new ApiError("INVALID_RESPONSE");
      confirmSave(response, activeDraft, jsonOf(activeDraft.snapshot) === submittedJson);
      return true;
    } catch (cause) {
      if (!isCurrent(operation) || !activeDraft) return false;
      const error = asApiError(cause);
      state.issue = error.code === "DOCUMENT_VERSION_CONFLICT" ? "conflict" : sent && uncertainWrite(error) ? "unknown" : null;
      if (state.issue !== "unknown" && activeDraft.pendingSave) setDraft(activeDraft.snapshot, activeDraft.baseVersion);
      showError(error);
      return false;
    } finally {
      end(operation);
    }
  }

  async function checkLatest(): Promise<boolean> {
    const operation = start("check");
    if (!operation) return false;
    try {
      const latest = await services.documents.current(binding.projectId, operation.signal);
      if (!isCurrent(operation)) return false;
      const snapshot = validateResponse(latest, state.document?.id);
      if (latest.version < Math.max(state.document?.version ?? 0, state.latest?.version ?? 0)) throw new ApiError("INVALID_RESPONSE");
      const pendingSave = activeDraft?.pendingSave;
      if (pendingSave && latest.version === pendingSave.expectedVersion + 1 && (await fingerprint(snapshot)) === pendingSave.fingerprint) {
        if (!isCurrent(operation) || !activeDraft) return false;
        confirmSave(latest, activeDraft, jsonOf(activeDraft.snapshot) === jsonOf(snapshot));
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
      } else {
        const imported = uncertainImport;
        uncertainImport = null;
        if (state.document?.version === latest.version && state.snapshot) {
          if (jsonOf(state.snapshot) !== jsonOf(snapshot)) throw new ApiError("INVALID_RESPONSE");
          // An unchanged version does not replace the editor or its undo history.
          state.document = latest;
        } else {
          setConfirmed(latest, snapshot);
        }
        if (imported && (latest.version !== 1 || jsonOf(imported) !== jsonOf(snapshot))) showError(new ApiError("DOCUMENT_ALREADY_EXISTS"));
      }
      return true;
    } catch (cause) {
      if (!isCurrent(operation)) return false;
      const error = asApiError(cause);
      if (error.code === "DOCUMENT_NOT_FOUND" && !state.document) {
        uncertainImport = null;
        state.phase = "empty";
        state.issue = null;
        return true;
      }
      if (!state.document) state.phase = "error";
      showError(error);
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

  async function loadLatestPreservingDraft(): Promise<boolean> {
    const latest = state.latest;
    if (!latest || state.phase !== "ready") return false;
    const operation = start("load-latest");
    if (!operation) return false;
    try {
      const snapshot = validateResponse(latest, state.document?.id);
      if (!(await archive(operation))) return false;
      setConfirmed(latest, snapshot);
      return true;
    } finally {
      end(operation);
    }
  }

  async function recoverDraft(id: string): Promise<boolean> {
    const document = state.latest ?? state.document;
    if (!document || state.phase !== "ready" || activeDraft?.id === id) return false;
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
    if (!draft) return null;
    return {
      filename: "thesispilot-document-draft.json",
      mime: "application/json;charset=utf-8",
      content: JSON.stringify({ ...toScope(state.document!), baseVersion: draft.baseVersion, content: payloadOf(draft.snapshot) }),
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    request?.abort();
    request = undefined;
  }

  return { state, load, importLocal, edit, save, checkLatest, loadLatestPreservingDraft, recoverDraft, downloadDraft, dispose };
}
