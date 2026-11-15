import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { shallowReactive } from "vue";
import type { RevisionCommandRead, RevisionDecision, RevisionRead, RevisionSelection, RevisionSummary } from "../../services/contracts/api.generated.ts";
import { ApiError, asApiError, type BackendServices } from "../../services/index.ts";
import { isUuid } from "../../services/validation.ts";
import { previewFormalRevision } from "../services/formalRevisionPreview.ts";
import type { DocumentDraftScope } from "./documentDrafts.ts";
import type { CommittedRevisionOutcome, createRemoteDocumentController, RevisionEditorView } from "./remoteDocuments.ts";
import {
  browserRevisionCommands,
  prepareRevisionCommand,
  validateStoredRevisionCommand,
  type RevisionCommandRepository,
  type RevisionCommandRequest,
  type StoredRevisionCommand,
} from "./revisionCommands.ts";

type FormalDocument = ReturnType<typeof createRemoteDocumentController>;
type CommandStatus = "unknown" | "not-found" | "confirmed";
type Operation = "load" | "select" | "generate" | "decide" | "apply" | "cancel" | "undo" | "revert" | "check-command" | "retry-command";

export interface RevisionRecovery {
  id: string;
  operation: RevisionCommandRead["operation"];
  createdAt: string;
  status: CommandStatus;
  canRetry: boolean;
}

export interface RemoteRevisionsState {
  candidate: RevisionRead | null;
  items: RevisionSummary[];
  total: number;
  offset: number;
  limit: number;
  busy: boolean;
  commandsBlocked: boolean;
  canCancel: boolean;
  cancelling: boolean;
  operation: Operation | null;
  pendingCommands: RevisionRecovery[];
  latestReceipt: RevisionCommandRead | null;
  outcome: CommittedRevisionOutcome | null;
  resultVersion: number | null;
  reviewDraft: RevisionDecision[] | null;
  storageError: string;
  error: string;
  errorCode: string;
}

interface Options {
  repository?: RevisionCommandRepository;
  getViewIdentity?: () => string | null;
}

export function revisionSelectionFromEditor(document: ProseMirrorNode, from: number, to: number): RevisionSelection {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to <= from || to > document.content.size)
    throw new ApiError("REVISION_ANCHOR_INVALID");
  const start = document.resolve(from);
  const end = document.resolve(to);
  if (!start.sameParent(end) || !["paragraph", "heading"].includes(start.parent.type.name)) throw new ApiError("REVISION_ANCHOR_INVALID");
  return {
    textblock_path: Array.from({ length: start.depth }, (_value, depth) => start.index(depth)),
    from,
    to,
    text: document.textBetween(from, to, "", "\uFFFC"),
  };
}

const validVersion = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const canCancelCandidate = (candidate: RevisionRead | null) => !!candidate && ["generating", "ready", "invalid"].includes(candidate.status);
const newWrites: readonly Operation[] = ["generate", "decide", "apply", "cancel", "undo", "revert"];
const uncertainWrite = (error: ApiError) =>
  !error.status || error.status >= 500 || ["NETWORK_ERROR", "REQUEST_TIMEOUT", "INVALID_RESPONSE", "REQUEST_CANCELLED"].includes(error.code);

export function createRemoteRevisionsController(
  services: Pick<BackendServices, "sourceKey" | "revisions" | "documents">,
  identity: Readonly<DocumentDraftScope>,
  formal: FormalDocument,
  options: Options = {},
) {
  const scope = { ...identity };
  const { sourceKey, projectId, documentId } = scope;
  const { revisions, documents } = services;
  const repository = options.repository ?? browserRevisionCommands;
  const getViewIdentity = options.getViewIdentity ?? (() => null);
  const settled = new Set<string>();
  const state = shallowReactive<RemoteRevisionsState>({
    candidate: null,
    items: [],
    total: 0,
    offset: 0,
    limit: 20,
    get busy() {
      return this.operation !== null || this.cancelling;
    },
    get commandsBlocked() {
      return this.pendingCommands.some((command: RevisionRecovery) => !settled.has(command.id));
    },
    get canCancel() {
      return (
        !this.cancelling &&
        canCancelCandidate(this.candidate) &&
        (!this.operation || this.operation === "generate") &&
        !this.pendingCommands.some((command: RevisionRecovery) => command.operation !== "proposal" && !settled.has(command.id))
      );
    },
    cancelling: false,
    operation: null,
    pendingCommands: [],
    latestReceipt: null,
    outcome: null,
    resultVersion: null,
    reviewDraft: null,
    storageError: "",
    error: "",
    errorCode: "",
  });
  const stored = new Map<string, StoredRevisionCommand>();
  const statuses = new Map<string, CommandStatus>();
  const views = new Map<string, { document: RevisionEditorView | null; identity: string | null }>();
  let request: AbortController | undefined;
  let cancellation: AbortController | undefined;
  let suppressedGeneration = "";
  let disposed = false;

  function validBinding() {
    return !disposed && services.sourceKey === sourceKey && formal.matchesRevisionScope(scope);
  }

  const isCurrent = (controller: AbortController) => validBinding() && (request === controller || cancellation === controller);

  function showError(error?: ApiError) {
    state.error = error?.message ?? "";
    state.errorCode = error?.code ?? "";
  }

  function syncPending() {
    state.pendingCommands = [...stored.values()]
      .filter((record) => statuses.has(record.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
      .map((record) => {
        const status = statuses.get(record.id)!;
        return { id: record.id, operation: record.request.operation, createdAt: record.createdAt, status, canRetry: status === "not-found" };
      });
  }

  function mark(record: StoredRevisionCommand, status: CommandStatus) {
    statuses.set(record.id, status);
    syncPending();
  }

  async function remove(record: StoredRevisionCommand, controller: AbortController) {
    try {
      await repository.remove(record);
      if (!isCurrent(controller)) return;
      stored.delete(record.id);
      statuses.delete(record.id);
      views.delete(record.id);
      settled.delete(record.id);
      syncPending();
    } catch {
      if (isCurrent(controller)) state.storageError = "无法清理此条本机修订命令记录。";
    }
  }

  function verifyCandidate(candidate: RevisionSummary, expectedId = candidate.id) {
    if (
      candidate.id !== expectedId ||
      !isUuid(candidate.id) ||
      candidate.project_id !== projectId ||
      candidate.document_id !== documentId ||
      !validVersion(candidate.revision)
    )
      throw new ApiError("INVALID_RESPONSE");
  }

  async function readCandidate(id: string, controller: AbortController): Promise<RevisionRead | null> {
    const candidate = await revisions.get(projectId, documentId, id, controller.signal);
    if (!isCurrent(controller)) return null;
    verifyCandidate(candidate, id);
    return candidate;
  }

  function merge(candidate: RevisionRead, select: boolean, created = false) {
    const previous = state.candidate?.id === candidate.id ? state.candidate : undefined;
    if (previous && (previous.revision > candidate.revision || previous.document_version > candidate.document_version)) return;
    const { id, project_id, document_id, base_version, document_version, revision, status, result_version, created_at, updated_at } = candidate;
    const summary = { id, project_id, document_id, base_version, document_version, revision, status, result_version, created_at, updated_at };
    const existing = state.items.find((item) => item.id === id);
    if (existing && (existing.revision > revision || existing.document_version > document_version)) return;
    if (previous || select) state.candidate = candidate;
    if (existing) state.items = state.items.map((item) => (item.id === id ? summary : item));
    else if (created) {
      state.total += 1;
      if (state.offset === 0) state.items = [summary, ...state.items].slice(0, state.limit);
    }
  }

  async function run(operation: Operation, action: (controller: AbortController) => Promise<boolean>, concurrentCancel = false): Promise<boolean> {
    if (!validBinding() || (state.busy && !concurrentCancel) || cancellation) return false;
    if (operation !== "cancel" && newWrites.includes(operation) && state.commandsBlocked) {
      state.error = "请先确认尚未核对的修订命令结果。";
      state.errorCode = "";
      return false;
    }
    const controller = new AbortController();
    if (concurrentCancel) {
      cancellation = controller;
      state.cancelling = true;
    } else {
      request = controller;
      state.operation = operation;
    }
    showError();
    try {
      return await action(controller);
    } catch (cause) {
      if (isCurrent(controller)) showError(asApiError(cause));
      return false;
    } finally {
      if (isCurrent(controller)) {
        if (concurrentCancel) {
          cancellation = undefined;
          state.cancelling = false;
        } else {
          request = undefined;
          state.operation = null;
        }
      }
    }
  }

  function verifyReceipt(record: StoredRevisionCommand, receipt: RevisionCommandRead) {
    const { request } = record;
    const expected = "expected_document_version" in request.input ? request.input.expected_document_version : null;
    if (
      receipt.command_id !== record.id ||
      receipt.document_id !== documentId ||
      receipt.operation !== request.operation ||
      !validVersion(receipt.base_version) ||
      ("candidateId" in request && receipt.candidate_id !== request.candidateId) ||
      (request.operation === "create" && receipt.base_version !== request.input.base_version) ||
      (request.operation === "revert"
        ? receipt.candidate_id !== null || receipt.candidate_revision !== null
        : !isUuid(receipt.candidate_id) || !validVersion(receipt.candidate_revision)) ||
      (expected === null ? receipt.result_version !== null : receipt.base_version !== expected || receipt.result_version !== expected + 1)
    )
      throw new ApiError("INVALID_RESPONSE");
  }

  async function reconcile(record: StoredRevisionCommand, receipt: RevisionCommandRead, controller: AbortController, created = false): Promise<boolean> {
    verifyReceipt(record, receipt);
    mark(record, "confirmed");
    state.latestReceipt = receipt;
    if (receipt.result_version !== null) {
      const result = await documents.version(projectId, documentId, receipt.result_version, controller.signal);
      if (!isCurrent(controller)) return false;
      const source = receipt.operation === "apply" ? "ai_adoption" : receipt.operation === "undo" ? "adoption_undo" : "version_revert";
      if (result.project_id !== projectId || result.document_id !== documentId || result.version !== receipt.result_version || result.source !== source)
        throw new ApiError("INVALID_RESPONSE");
      const view = views.get(record.id);
      state.outcome = formal.acceptCommittedVersion(result, view?.document ?? null, !!view?.identity && view.identity === getViewIdentity());
      state.resultVersion = result.version;
    }
    const candidateId = receipt.candidate_id ?? (receipt.result_version !== null ? state.candidate?.id : undefined);
    if (candidateId) {
      const candidate = await readCandidate(candidateId, controller);
      if (!candidate) return false;
      if (receipt.candidate_revision !== null && candidate.revision < receipt.candidate_revision) throw new ApiError("INVALID_RESPONSE");
      if (receipt.result_version === null && candidate.base_version !== receipt.base_version) throw new ApiError("INVALID_RESPONSE");
      merge(candidate, !state.candidate || record.request.operation === "create", created);
    }
    if (record.request.operation === "decide") state.reviewDraft = null;
    settled.add(record.id);
    syncPending();
    await remove(record, controller);
    return isCurrent(controller);
  }

  function dispatch(command: RevisionCommandRequest, signal: AbortSignal): Promise<RevisionCommandRead> {
    switch (command.operation) {
      case "create":
        return revisions.create(projectId, documentId, command.input, signal);
      case "proposal":
        return revisions.propose(projectId, documentId, command.candidateId, command.input, signal);
      case "decide":
        return revisions.decide(projectId, documentId, command.candidateId, command.input, signal);
      case "apply":
        return revisions.apply(projectId, documentId, command.candidateId, command.input, signal);
      case "cancel":
        return revisions.cancel(projectId, documentId, command.candidateId, command.input, signal);
      case "undo":
        return revisions.undo(projectId, documentId, command.applicationCommandId, command.input, signal);
      case "revert":
        return revisions.revert(projectId, documentId, command.input, signal);
    }
  }

  async function send(record: StoredRevisionCommand, controller: AbortController, created = false): Promise<boolean> {
    let receipt: RevisionCommandRead;
    try {
      receipt = await dispatch(record.request, controller.signal);
    } catch (cause) {
      if (!isCurrent(controller)) return false;
      const error = asApiError(cause);
      if (uncertainWrite(error)) mark(record, "unknown");
      else {
        const target = record.request;
        if (error.code === "REVISION_REVIEW_CONFLICT" && target.operation === "decide") state.reviewDraft = target.input.decisions;
        await remove(record, controller);
        if (isCurrent(controller) && "candidateId" in target && error.status === 409) {
          try {
            const candidate = await readCandidate(target.candidateId, controller);
            if (candidate) merge(candidate, false);
          } catch {
            // The command error remains actionable even if a concurrent reread fails.
          }
        }
      }
      throw error;
    }
    if (!isCurrent(controller)) return false;
    try {
      return await reconcile(record, receipt, controller, created);
    } catch (cause) {
      if (isCurrent(controller) && statuses.get(record.id) !== "confirmed") mark(record, "unknown");
      throw cause;
    }
  }

  async function submit(command: RevisionCommandRequest, controller: AbortController): Promise<boolean> {
    const view = { document: formal.captureRevisionView(), identity: getViewIdentity() };
    let record: StoredRevisionCommand;
    try {
      record = await prepareRevisionCommand(scope, command);
      if (!isCurrent(controller)) return false;
      await repository.add(record);
    } catch {
      if (isCurrent(controller)) state.storageError = "无法在本机保留命令，本次未提交。";
      return false;
    }
    if (!isCurrent(controller)) return false;
    state.storageError = "";
    stored.set(record.id, record);
    views.set(record.id, view);
    return send(record, controller, command.operation === "create");
  }

  function load(offset = 0): Promise<boolean> {
    return run("load", async (controller) => {
      state.storageError = "";
      try {
        const entries = await repository.list(scope);
        for (const entry of entries) {
          try {
            await validateStoredRevisionCommand(scope, entry);
            if (!isCurrent(controller)) return false;
            stored.set(entry.id, entry);
            if (!statuses.has(entry.id)) statuses.set(entry.id, "unknown");
          } catch {
            if (isCurrent(controller)) state.storageError = "有待确认的本机修订命令无法读取。";
          }
        }
        if (!isCurrent(controller)) return false;
        syncPending();
      } catch {
        if (isCurrent(controller)) state.storageError = "无法读取本机待确认的修订命令。";
      }
      if (!isCurrent(controller)) return false;
      const page = await revisions.list(projectId, documentId, { limit: state.limit, offset }, controller.signal);
      if (!isCurrent(controller)) return false;
      page.items.forEach((item) => verifyCandidate(item));
      state.items = page.items;
      state.offset = page.offset;
      state.total = page.total;
      const id = state.candidate?.id ?? page.items[0]?.id;
      if (id) {
        const candidate = await readCandidate(id, controller);
        if (candidate) merge(candidate, true);
      }
      return isCurrent(controller);
    });
  }

  function select(id: string): Promise<boolean> {
    return run("select", async (controller) => {
      const candidate = await readCandidate(id, controller);
      if (!candidate) return false;
      if (state.candidate?.id !== id) state.reviewDraft = null;
      merge(candidate, true);
      return true;
    });
  }

  function generate(selection: RevisionSelection, goal: string): Promise<boolean> {
    return run("generate", async (controller) => {
      const view = formal.captureRevisionView();
      if (!view || !getViewIdentity()) throw new ApiError("REVISION_STALE");
      suppressedGeneration = "";
      const command = { command_id: crypto.randomUUID(), base_version: view.version, selection: structuredClone(selection), goal };
      if (!(await submit({ operation: "create", input: command }, controller)) || !isCurrent(controller)) return false;
      const candidate = state.candidate;
      if (!candidate || candidate.status !== "generating" || !candidate.generation_token || suppressedGeneration === candidate.id) return false;
      const patches = previewFormalRevision(candidate.selection);
      if (!patches.length) throw new ApiError("REVISION_NO_CHANGE");
      if (patches.length > 100) throw new ApiError("REVISION_TOO_LARGE");
      return submit(
        {
          operation: "proposal",
          candidateId: candidate.id,
          input: { command_id: crypto.randomUUID(), generation_token: candidate.generation_token, patches },
        },
        controller,
      );
    });
  }

  function decide(decisions: RevisionDecision[]): Promise<boolean> {
    const candidate = state.candidate;
    if (!candidate) return Promise.resolve(false);
    return run("decide", (controller) =>
      submit(
        {
          operation: "decide",
          candidateId: candidate.id,
          input: {
            command_id: crypto.randomUUID(),
            expected_revision: candidate.revision,
            decisions: decisions.map(({ patch_id, decision }) => ({ patch_id, decision })),
          },
        },
        controller,
      ),
    );
  }

  function apply(): Promise<boolean> {
    return run("apply", (controller) => {
      const candidate = state.candidate;
      const view = formal.captureRevisionView();
      if (!candidate?.applicable || !view || !getViewIdentity() || candidate.base_version !== view.version) throw new ApiError("REVISION_STALE");
      if (!candidate.decisions.some((decision) => decision.decision === "accepted")) throw new ApiError("REVISION_NOTHING_ACCEPTED");
      return submit(
        {
          operation: "apply",
          candidateId: candidate.id,
          input: { command_id: crypto.randomUUID(), expected_document_version: view.version, expected_revision: candidate.revision },
        },
        controller,
      );
    });
  }

  function cancel(): Promise<boolean> {
    const candidate = state.candidate;
    if (!candidate || !state.canCancel) return Promise.resolve(false);
    return run(
      "cancel",
      (controller) => {
        suppressedGeneration = candidate.id;
        return submit({ operation: "cancel", candidateId: candidate.id, input: { command_id: crypto.randomUUID() } }, controller);
      },
      state.operation === "generate",
    );
  }

  function undo(applicationCommandId: string): Promise<boolean> {
    return run("undo", async (controller) => {
      const view = formal.captureRevisionView();
      if (!view || !getViewIdentity()) throw new ApiError("REVISION_UNDO_CONFLICT");
      const apply = await revisions.command(projectId, documentId, applicationCommandId, controller.signal);
      if (!isCurrent(controller)) return false;
      if (apply.command_id !== applicationCommandId || apply.document_id !== documentId || apply.operation !== "apply" || !apply.candidate_id)
        throw new ApiError("INVALID_RESPONSE");
      if (apply.result_version !== view.version || formal.captureRevisionView()?.version !== view.version || !getViewIdentity())
        throw new ApiError("REVISION_UNDO_CONFLICT");
      return submit(
        {
          operation: "undo",
          candidateId: apply.candidate_id,
          applicationCommandId,
          input: { command_id: crypto.randomUUID(), expected_document_version: view.version },
        },
        controller,
      );
    });
  }

  function revert(targetVersion: number): Promise<boolean> {
    return run("revert", (controller) => {
      const view = formal.captureRevisionView();
      if (!view || !getViewIdentity()) throw new ApiError("REVISION_STALE");
      return submit(
        {
          operation: "revert",
          input: { command_id: crypto.randomUUID(), expected_document_version: view.version, target_version: targetVersion },
        },
        controller,
      );
    });
  }

  async function queryReceipt(record: StoredRevisionCommand, controller: AbortController) {
    try {
      return await revisions.command(projectId, documentId, record.id, controller.signal);
    } catch (cause) {
      const error = asApiError(cause);
      if (error.code !== "REVISION_COMMAND_NOT_FOUND") throw error;
      if (isCurrent(controller) && statuses.get(record.id) !== "confirmed") mark(record, "not-found");
      return null;
    }
  }

  function checkCommand(id: string): Promise<boolean> {
    return run("check-command", async (controller) => {
      const record = stored.get(id);
      if (!record) return false;
      const receipt = await queryReceipt(record, controller);
      if (!isCurrent(controller) || !receipt) return false;
      return reconcile(record, receipt, controller);
    });
  }

  function retryCommand(id: string): Promise<boolean> {
    if (statuses.get(id) !== "not-found") return Promise.resolve(false);
    return run("retry-command", async (controller) => {
      const record = stored.get(id);
      if (!record) return false;
      const receipt = await queryReceipt(record, controller);
      if (!isCurrent(controller)) return false;
      return receipt ? reconcile(record, receipt, controller) : send(record, controller);
    });
  }

  function dispose() {
    disposed = true;
    request?.abort();
    cancellation?.abort();
    request = cancellation = undefined;
  }

  return { state, load, select, generate, decide, apply, cancel, undo, revert, checkCommand, retryCommand, dispose };
}
