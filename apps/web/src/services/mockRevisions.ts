import { stableRevisionJson } from "../lab/state/revisionCommands.ts";
import type { ApiTypes, DocumentRead, DocumentVersionRead, RevisionCommandRead, RevisionRead, RevisionSummary } from "./contracts/api.generated.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import type { MockDocuments } from "./mockDocuments.ts";
import { parseRevisionDto, REVISION_TRANSPORT_BYTES } from "./revisionContent.ts";
import { evaluateRevisionProtection, requireProtectedRevision, resolveRevisionSelection, REVISION_POLICY } from "./revisionProtection.ts";
import type { RevisionService } from "./types.ts";
import { pageQuery, requireUuid } from "./validation.ts";

type CommandSchema = "RevisionCreate" | "RevisionProposal" | "RevisionDecide" | "RevisionApply" | "RevisionCancel" | "RevisionUndo" | "RevisionRevert";
type Write = {
  candidate?: RevisionRead;
  content?: DocumentRead["content"];
  source?: Exclude<DocumentVersionRead["source"], "local_import" | "manual_edit" | "blank">;
  baseVersion: number;
  reverses?: string;
};
type Record = { fingerprint: string; receipt: RevisionCommandRead };
const clone = <T>(value: T): T => structuredClone(value);
const failure = (code: string, status: number) => new ApiError(code, { status });

function summary(candidate: RevisionRead, documentVersion: number): RevisionSummary {
  const { id, project_id, document_id, base_version, revision, status, result_version, created_at, updated_at } = candidate;
  return { id, project_id, document_id, base_version, document_version: documentVersion, revision, status, result_version, created_at, updated_at };
}

function read(candidate: RevisionRead, documentVersion: number): RevisionRead {
  const stale = candidate.base_version !== documentVersion;
  const checks = candidate.checks.map((check) => (check.rule === "version" ? { ...check, result: stale ? ("fail" as const) : ("pass" as const) } : check));
  return {
    ...candidate,
    checks,
    document_version: documentVersion,
    generation_token: candidate.status === "generating" ? candidate.generation_token : null,
    applicable: !stale && candidate.status === "ready" && candidate.policy_version === REVISION_POLICY && checks.every((check) => check.result === "pass"),
  };
}

function update(candidate: RevisionRead, now: string, fields: Partial<RevisionRead>): RevisionRead {
  if (candidate.revision >= Number.MAX_SAFE_INTEGER) throw failure("REVISION_REVIEW_CONFLICT", 409);
  return { ...candidate, ...fields, revision: candidate.revision + 1, updated_at: now };
}

function requireReview(candidate: RevisionRead) {
  if (candidate.status !== "ready" && candidate.status !== "invalid") throw failure("REVISION_STATE_CONFLICT", 409);
}

function requireCurrent(candidate: RevisionRead, document: DocumentRead) {
  if (candidate.base_version !== document.version) throw failure("REVISION_STALE", 409);
  if (candidate.policy_version !== REVISION_POLICY) throw failure("REVISION_POLICY_STALE", 409);
}

function requireReviewVersion(candidate: RevisionRead, expectedRevision: number) {
  if (candidate.revision !== expectedRevision || candidate.revision >= Number.MAX_SAFE_INTEGER) throw failure("REVISION_REVIEW_CONFLICT", 409);
}

export function createMockRevisions(documents: MockDocuments): RevisionService {
  const candidates = new Map<string, RevisionRead>();
  const commands = new Map<string, Record>();
  const reversals = new Set<string>();
  const key = (documentId: string, id: string) => documentId + ":" + requireUuid(id).toLowerCase();

  async function before(signal?: AbortSignal) {
    throwIfAborted(signal);
    await Promise.resolve();
    throwIfAborted(signal);
  }

  function getCandidate(document: DocumentRead, id: string): RevisionRead {
    const candidate = candidates.get(key(document.id, id));
    if (!candidate) throw failure("REVISION_NOT_FOUND", 404);
    return candidate;
  }

  function getCommand(document: DocumentRead, id: string): RevisionCommandRead {
    const record = commands.get(key(document.id, id));
    if (!record) throw failure("REVISION_COMMAND_NOT_FOUND", 404);
    return record.receipt;
  }

  async function write<Name extends CommandSchema>(
    projectId: string,
    documentId: string,
    name: Name,
    raw: ApiTypes[Name],
    operation: RevisionCommandRead["operation"],
    targetId: string | null,
    signal: AbortSignal | undefined,
    prepare: (document: DocumentRead, input: ApiTypes[Name], now: string) => Write,
  ): Promise<RevisionCommandRead> {
    const input = clone(parseRevisionDto(name, raw, true));
    input.command_id = input.command_id.toLowerCase();
    if ("generation_token" in input) input.generation_token = input.generation_token.toLowerCase();
    const target = targetId === null ? null : requireUuid(targetId).toLowerCase();
    await before(signal);
    const document = documents.revisionCurrent(projectId, documentId);
    const commandKey = key(documentId, input.command_id);
    const fingerprint = stableRevisionJson([operation, target, input]);
    const previous = commands.get(commandKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw failure("REVISION_COMMAND_CONFLICT", 409);
      return clone(previous.receipt);
    }

    const now = new Date().toISOString();
    const next = prepare(document, input, now);
    const receipt = parseRevisionDto("RevisionCommandRead", {
      command_id: input.command_id,
      document_id: documentId,
      candidate_id: next.candidate?.id ?? null,
      operation,
      candidate_revision: next.candidate?.revision ?? null,
      base_version: next.baseVersion,
      result_version: next.content ? document.version + 1 : null,
      created_at: now,
    });
    if (next.candidate) {
      const output = read(next.candidate, receipt.result_version ?? document.version);
      const largestView = { ...output, document_version: Number.MAX_SAFE_INTEGER, applicable: false };
      if (new TextEncoder().encode(JSON.stringify(largestView)).byteLength > REVISION_TRANSPORT_BYTES) throw failure("REVISION_TOO_LARGE", 413);
      parseRevisionDto("RevisionRead", output);
    }
    // All validation precedes the synchronous document, candidate and receipt commit.
    if (next.content && next.source) documents.appendRevisionVersion(projectId, documentId, document.version, next.content, next.source);
    if (next.candidate) candidates.set(key(documentId, next.candidate.id), next.candidate);
    if (next.reverses) reversals.add(key(documentId, next.reverses));
    commands.set(commandKey, { fingerprint, receipt });
    return clone(receipt);
  }

  return {
    create(projectId, documentId, input, signal) {
      return write(projectId, documentId, "RevisionCreate", input, "create", null, signal, (document, data, now) => {
        if (!data.goal.trim()) throw failure("VALIDATION_ERROR", 422);
        if (data.base_version !== document.version) throw failure("REVISION_STALE", 409);
        resolveRevisionSelection(document.content, data.selection);
        return {
          baseVersion: document.version,
          candidate: {
            id: crypto.randomUUID(),
            project_id: projectId,
            document_id: documentId,
            base_version: document.version,
            document_version: document.version,
            revision: 1,
            status: "generating",
            result_version: null,
            application_command_id: null,
            created_at: now,
            updated_at: now,
            selection: data.selection,
            goal: data.goal,
            policy_version: REVISION_POLICY,
            producer: "deterministic_preview",
            generation_token: crypto.randomUUID(),
            patches: [],
            decisions: [],
            checks: [],
            applicable: false,
          },
        };
      });
    },
    propose(projectId, documentId, candidateId, input, signal) {
      return write(projectId, documentId, "RevisionProposal", input, "proposal", candidateId, signal, (document, data, now) => {
        const candidate = getCandidate(document, candidateId);
        if (candidate.status !== "generating" || candidate.generation_token !== data.generation_token) throw failure("REVISION_STATE_CONFLICT", 409);
        if (candidate.policy_version !== REVISION_POLICY) throw failure("REVISION_POLICY_STALE", 409);
        if (new Set(data.patches.map((patch) => patch.id)).size !== data.patches.length) throw failure("REVISION_PATCH_INVALID", 422);
        const base = documents.revisionVersion(projectId, documentId, candidate.base_version);
        const { checks } = evaluateRevisionProtection(base.content, candidate.selection, data.patches, base.version, base.version);
        return {
          baseVersion: base.version,
          candidate: update(candidate, now, {
            status: checks.every((check) => check.result === "pass") ? "ready" : "invalid",
            patches: data.patches,
            decisions: data.patches.map((patch) => ({ patch_id: patch.id, decision: "pending" })),
            checks,
          }),
        };
      });
    },
    decide(projectId, documentId, candidateId, input, signal) {
      return write(projectId, documentId, "RevisionDecide", input, "decide", candidateId, signal, (document, data, now) => {
        const candidate = getCandidate(document, candidateId);
        requireReviewVersion(candidate, data.expected_revision);
        requireReview(candidate);
        const choices = new Map(data.decisions.map((decision) => [decision.patch_id, decision.decision]));
        if (choices.size !== data.decisions.length || choices.size !== candidate.patches.length || candidate.patches.some((patch) => !choices.has(patch.id)))
          throw failure("REVISION_PATCH_INVALID", 422);
        if ([...choices.values()].includes("accepted")) {
          requireCurrent(candidate, document);
          requireProtectedRevision(candidate.checks);
        }
        const byId = (a: { patch_id: string }, b: { patch_id: string }) => (a.patch_id < b.patch_id ? -1 : a.patch_id > b.patch_id ? 1 : 0);
        const decisions = [...data.decisions].sort(byId);
        return {
          baseVersion: candidate.base_version,
          candidate:
            stableRevisionJson(decisions) === stableRevisionJson([...candidate.decisions].sort(byId)) ? candidate : update(candidate, now, { decisions }),
        };
      });
    },
    apply(projectId, documentId, candidateId, input, signal) {
      return write(projectId, documentId, "RevisionApply", input, "apply", candidateId, signal, (document, data, now) => {
        const candidate = getCandidate(document, candidateId);
        requireReviewVersion(candidate, data.expected_revision);
        requireCurrent(candidate, document);
        if (data.expected_document_version !== document.version) throw failure("DOCUMENT_VERSION_CONFLICT", 409);
        requireReview(candidate);
        if (candidate.status !== "ready") requireProtectedRevision(candidate.checks);
        const accepted = new Set(candidate.decisions.filter((decision) => decision.decision === "accepted").map((decision) => decision.patch_id));
        if (!accepted.size) throw failure("REVISION_NOTHING_ACCEPTED", 422);
        const full = evaluateRevisionProtection(document.content, candidate.selection, candidate.patches, candidate.base_version, document.version);
        requireProtectedRevision(full.checks);
        const result = evaluateRevisionProtection(
          document.content,
          candidate.selection,
          candidate.patches.filter((patch) => accepted.has(patch.id)),
          candidate.base_version,
          document.version,
        );
        requireProtectedRevision(result.checks);
        if (!result.content || stableRevisionJson(result.content) === stableRevisionJson(document.content)) throw failure("REVISION_NO_CHANGE", 422);
        return {
          baseVersion: document.version,
          content: result.content,
          source: "ai_adoption",
          candidate: update(candidate, now, { status: "applied", result_version: document.version + 1, application_command_id: data.command_id }),
        };
      });
    },
    cancel(projectId, documentId, candidateId, input, signal) {
      return write(projectId, documentId, "RevisionCancel", input, "cancel", candidateId, signal, (document, _data, now) => {
        const candidate = getCandidate(document, candidateId);
        if (!["generating", "ready", "invalid"].includes(candidate.status)) throw failure("REVISION_STATE_CONFLICT", 409);
        return { baseVersion: candidate.base_version, candidate: update(candidate, now, { status: "cancelled", generation_token: null }) };
      });
    },
    undo(projectId, documentId, applicationCommandId, input, signal) {
      return write(projectId, documentId, "RevisionUndo", input, "undo", applicationCommandId, signal, (document, data, now) => {
        const application = getCommand(document, applicationCommandId);
        if (
          application.operation !== "apply" ||
          !application.candidate_id ||
          !application.base_version ||
          application.result_version !== document.version ||
          data.expected_document_version !== document.version ||
          reversals.has(key(documentId, applicationCommandId))
        )
          throw failure("REVISION_UNDO_CONFLICT", 409);
        const candidate = getCandidate(document, application.candidate_id);
        if (candidate.status !== "applied") throw failure("REVISION_UNDO_CONFLICT", 409);
        const before = documents.revisionVersion(projectId, documentId, application.base_version);
        return {
          baseVersion: document.version,
          content: before.content,
          source: "adoption_undo",
          reverses: applicationCommandId,
          candidate: update(candidate, now, { status: "undone" }),
        };
      });
    },
    revert(projectId, documentId, input, signal) {
      return write(projectId, documentId, "RevisionRevert", input, "revert", null, signal, (document, data) => {
        if (data.expected_document_version !== document.version) throw failure("DOCUMENT_VERSION_CONFLICT", 409);
        const target = documents.revisionVersion(projectId, documentId, data.target_version);
        if (stableRevisionJson(target.content) === stableRevisionJson(document.content)) throw failure("REVISION_NO_CHANGE", 422);
        return { baseVersion: document.version, content: target.content, source: "version_revert" };
      });
    },
    async get(projectId, documentId, candidateId, signal) {
      await before(signal);
      const document = documents.revisionCurrent(projectId, documentId);
      const candidate = getCandidate(document, candidateId);
      return clone(parseRevisionDto("RevisionRead", read(candidate, document.version)));
    },
    async list(projectId, documentId, query, signal) {
      const { offset, limit } = pageQuery(query);
      if (limit > 50) throw failure("VALIDATION_ERROR", 422);
      await before(signal);
      const document = documents.revisionCurrent(projectId, documentId);
      const list = [...candidates.values()].filter((candidate) => candidate.document_id === document.id);
      list.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      const items = list.slice(offset, offset + limit).map((candidate) => summary(candidate, document.version));
      return clone(parseRevisionDto("RevisionPage", { items, total: list.length, limit, offset }));
    },
    async command(projectId, documentId, commandId, signal) {
      await before(signal);
      return clone(getCommand(documents.revisionCurrent(projectId, documentId), commandId));
    },
  };
}
