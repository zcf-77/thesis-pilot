import type { ApiTypes, CitationCandidateRead, CitationListRead, SchemaName } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { CitationService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const base = (projectId: string, documentId: string) => `/projects/${requireUuid(projectId)}/documents/${requireUuid(documentId)}/citations`;
const candidatePath = (projectId: string, documentId: string, candidateId: string) => `${base(projectId, documentId)}/candidates/${requireUuid(candidateId)}`;
const statuses = new Set(["ready", "applied", "rejected", "undone"]);

/** A candidate belongs to its document, never claims a result it cannot have, and stays applicable only while fresh. */
export function checkCandidate(value: CitationCandidateRead, projectId: string, documentId: string, candidateId?: string): CitationCandidateRead {
  if (!same(value.project_id, projectId) || !same(value.document_id, documentId) || (candidateId !== undefined && !same(value.id, candidateId)))
    throw new ApiError("INVALID_RESPONSE");
  const finished = value.status === "applied" || value.status === "undone";
  if (finished !== (value.result_version !== null) || (value.applicable && (value.status !== "ready" || value.stale))) throw new ApiError("INVALID_RESPONSE");
  if (value.undoable && (value.status !== "applied" || value.result_version !== value.document_version)) throw new ApiError("INVALID_RESPONSE");
  const { preview } = value;
  if (preview.number !== value.number || !same(preview.entry_id, value.entry.id) || preview.marker.text !== `[${value.number}]`)
    throw new ApiError("INVALID_RESPONSE");
  if (preview.marker.node !== value.placement.node_id || preview.marker.offset !== value.placement.offset) throw new ApiError("INVALID_RESPONSE");
  if (!preview.reference.text.startsWith(`[${value.number}] `)) throw new ApiError("INVALID_RESPONSE");
  return value;
}

/** Numbers run 1..n in order and every marker names a node; v1 versions carry no managed citations. */
export function checkCitations(value: CitationListRead, documentId: string, version?: number): CitationListRead {
  if (!same(value.document_id, documentId) || (version !== undefined && value.document_version !== version)) throw new ApiError("INVALID_RESPONSE");
  if (value.schema_version === 1 && (value.items.length > 0 || value.references_heading !== null)) throw new ApiError("INVALID_RESPONSE");
  if (value.items.some((item, index) => item.number !== index + 1 || item.markers.some((marker) => marker.end <= marker.start)))
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

export function createHttpCitations(request: Request): CitationService {
  const command = <Name extends "CitationApply" | "CitationReject" | "CitationUndo">(name: Name, input: ApiTypes[Name]) =>
    parseDto(name, { ...input, command_id: input.command_id.toLowerCase() }, true);
  return {
    async list(projectId, documentId, version, signal) {
      const query = version === undefined ? "" : `?version=${version}`;
      return checkCitations(await request(`${base(projectId, documentId)}${query}`, "CitationListRead", "GET", undefined, signal), documentId, version);
    },
    async create(projectId, documentId, input, signal) {
      const data = parseDto(
        "CitationCreate",
        { ...input, command_id: input.command_id.toLowerCase(), entry_id: requireUuid(input.entry_id).toLowerCase() },
        true,
      );
      return checkCandidate(await request(`${base(projectId, documentId)}/candidates`, "CitationCandidateRead", "POST", data, signal), projectId, documentId);
    },
    async candidates(projectId, documentId, query, signal) {
      const { limit, offset } = pageQuery(query);
      if (query?.status !== undefined && !statuses.has(query.status)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const status = query?.status ? `&status=${query.status}` : "";
      const value = await request(
        `${base(projectId, documentId)}/candidates?limit=${limit}&offset=${offset}${status}`,
        "CitationCandidatePage",
        "GET",
        undefined,
        signal,
      );
      if (value.limit !== limit || value.offset !== offset || value.items.length > limit || value.total < value.items.length)
        throw new ApiError("INVALID_RESPONSE");
      value.items.forEach((item) => {
        checkCandidate(item, projectId, documentId);
        if (query?.status && item.status !== query.status) throw new ApiError("INVALID_RESPONSE");
      });
      return value;
    },
    async get(projectId, documentId, candidateId, signal) {
      return checkCandidate(
        await request(candidatePath(projectId, documentId, candidateId), "CitationCandidateRead", "GET", undefined, signal),
        projectId,
        documentId,
        candidateId,
      );
    },
    async apply(projectId, documentId, candidateId, input, signal) {
      const data = command("CitationApply", input);
      return checkCandidate(
        await request(`${candidatePath(projectId, documentId, candidateId)}/apply`, "CitationCandidateRead", "POST", data, signal),
        projectId,
        documentId,
        candidateId,
      );
    },
    async reject(projectId, documentId, candidateId, input, signal) {
      const data = command("CitationReject", input);
      return checkCandidate(
        await request(`${candidatePath(projectId, documentId, candidateId)}/reject`, "CitationCandidateRead", "POST", data, signal),
        projectId,
        documentId,
        candidateId,
      );
    },
    async undo(projectId, documentId, candidateId, input, signal) {
      const data = command("CitationUndo", input);
      return checkCandidate(
        await request(`${candidatePath(projectId, documentId, candidateId)}/undo`, "CitationCandidateRead", "POST", data, signal),
        projectId,
        documentId,
        candidateId,
      );
    },
  };
}
