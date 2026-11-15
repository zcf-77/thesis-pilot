import type { ApiTypes, RevisionCommandRead, SchemaName } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { parseRevisionDto } from "./revisionContent.ts";
import type { RevisionService } from "./types.ts";
import { pageQuery, requireUuid } from "./validation.ts";

type RevisionRequest = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;
type InputSchema = "RevisionCreate" | "RevisionProposal" | "RevisionDecide" | "RevisionApply" | "RevisionCancel" | "RevisionUndo" | "RevisionRevert";
const equalId = (first: string, second: string) => first.toLowerCase() === second.toLowerCase();
const base = (projectId: string, documentId: string) => `/projects/${requireUuid(projectId)}/documents/${requireUuid(documentId)}`;

function checkBinding(actual: { project_id: string; document_id: string }, projectId: string, documentId: string) {
  if (!equalId(actual.project_id, projectId) || !equalId(actual.document_id, documentId)) throw new ApiError("INVALID_RESPONSE");
}

export function createHttpRevisions(request: RevisionRequest): RevisionService {
  async function send<Name extends InputSchema>(
    schema: Name,
    operation: RevisionCommandRead["operation"],
    path: string,
    documentId: string,
    input: ApiTypes[Name],
    signal?: AbortSignal,
    candidateId?: string,
    resultVersion?: number,
  ) {
    const data = parseRevisionDto(schema, input, true);
    const receipt = await request(path, "RevisionCommandRead", ["proposal", "decide"].includes(operation) ? "PUT" : "POST", data, signal);
    if (
      !equalId(receipt.document_id, documentId) ||
      !equalId(receipt.command_id, data.command_id) ||
      receipt.operation !== operation ||
      (candidateId !== undefined && (!receipt.candidate_id || !equalId(receipt.candidate_id, candidateId))) ||
      (operation === "create" && !receipt.candidate_id) ||
      (operation === "revert" && receipt.candidate_id !== null) ||
      (resultVersion !== undefined && receipt.result_version !== resultVersion)
    )
      throw new ApiError("INVALID_RESPONSE");
    return receipt;
  }
  return {
    create(projectId, documentId, input, signal) {
      return send("RevisionCreate", "create", `${base(projectId, documentId)}/revisions`, documentId, input, signal);
    },
    propose(projectId, documentId, candidateId, input, signal) {
      return send(
        "RevisionProposal",
        "proposal",
        `${base(projectId, documentId)}/revisions/${requireUuid(candidateId)}/proposal`,
        documentId,
        input,
        signal,
        candidateId,
      );
    },
    async get(projectId, documentId, candidateId, signal) {
      const result = await request(`${base(projectId, documentId)}/revisions/${requireUuid(candidateId)}`, "RevisionRead", "GET", undefined, signal);
      checkBinding(result, projectId, documentId);
      if (!equalId(result.id, candidateId)) throw new ApiError("INVALID_RESPONSE");
      return result;
    },
    async list(projectId, documentId, query, signal) {
      const { limit, offset } = pageQuery(query);
      if (limit > 50) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const result = await request(`${base(projectId, documentId)}/revisions?limit=${limit}&offset=${offset}`, "RevisionPage", "GET", undefined, signal);
      result.items.forEach((entry) => checkBinding(entry, projectId, documentId));
      return result;
    },
    decide(projectId, documentId, candidateId, input, signal) {
      return send(
        "RevisionDecide",
        "decide",
        `${base(projectId, documentId)}/revisions/${requireUuid(candidateId)}/decisions`,
        documentId,
        input,
        signal,
        candidateId,
      );
    },
    apply(projectId, documentId, candidateId, input, signal) {
      return send(
        "RevisionApply",
        "apply",
        `${base(projectId, documentId)}/revisions/${requireUuid(candidateId)}/apply`,
        documentId,
        input,
        signal,
        candidateId,
        input.expected_document_version + 1,
      );
    },
    cancel(projectId, documentId, candidateId, input, signal) {
      return send(
        "RevisionCancel",
        "cancel",
        `${base(projectId, documentId)}/revisions/${requireUuid(candidateId)}/cancel`,
        documentId,
        input,
        signal,
        candidateId,
      );
    },
    undo(projectId, documentId, applicationCommandId, input, signal) {
      return send(
        "RevisionUndo",
        "undo",
        `${base(projectId, documentId)}/revision-commands/${requireUuid(applicationCommandId)}/undo`,
        documentId,
        input,
        signal,
        undefined,
        input.expected_document_version + 1,
      );
    },
    revert(projectId, documentId, input, signal) {
      return send(
        "RevisionRevert",
        "revert",
        `${base(projectId, documentId)}/revert`,
        documentId,
        input,
        signal,
        undefined,
        input.expected_document_version + 1,
      );
    },
    async command(projectId, documentId, commandId, signal) {
      const result = await request(
        `${base(projectId, documentId)}/revision-commands/${requireUuid(commandId)}`,
        "RevisionCommandRead",
        "GET",
        undefined,
        signal,
      );
      if (!equalId(result.document_id, documentId) || !equalId(result.command_id, commandId)) throw new ApiError("INVALID_RESPONSE");
      return result;
    },
  };
}
