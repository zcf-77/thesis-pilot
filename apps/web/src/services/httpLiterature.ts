import type { ApiTypes, LiteratureEntryRead, LiteratureSearchRead, LiteratureSearchReceipt, SchemaName } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { LiteratureEntryQuery, LiteratureService, PageQuery } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const base = (projectId: string) => `/projects/${requireUuid(projectId)}/literature`;
const searchPath = (projectId: string, searchId: string) => `${base(projectId)}/searches/${requireUuid(searchId)}`;
const entryPath = (projectId: string, entryId: string) => `${base(projectId)}/entries/${requireUuid(entryId)}`;

function page<T extends { items: unknown[]; total: number; limit: number; offset: number }>(value: T, limit: number, offset: number): T {
  if (value.limit !== limit || value.offset !== offset || value.items.length > limit || value.total < value.items.length)
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

/** Results are only accepted with their own run; a snapshot never appears before success. */
export function checkSearch(value: LiteratureSearchRead, projectId: string, searchId?: string): LiteratureSearchRead {
  if (!same(value.project_id, projectId) || (searchId !== undefined && !same(value.id, searchId))) throw new ApiError("INVALID_RESPONSE");
  const snapshot = value.snapshot;
  if ((snapshot !== null) !== (value.status === "succeeded")) throw new ApiError("INVALID_RESPONSE");
  if (
    snapshot &&
    (snapshot.source !== value.source ||
      snapshot.items.length > value.rows ||
      snapshot.items.some((item, index) => item.index !== index || item.source !== value.source || (item.coverage === "abstract") !== (item.abstract !== null)))
  )
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

export function checkSearchReceipt(value: LiteratureSearchReceipt, projectId: string): LiteratureSearchReceipt {
  checkSearch(value.search, projectId);
  const { job } = value;
  if (
    job.kind !== "literature_search" ||
    !same(job.id, value.search.job_id) ||
    !same(job.project_id, projectId) ||
    !job.input_snapshot ||
    !("search_id" in job.input_snapshot) ||
    !same(job.input_snapshot.search_id, value.search.id)
  )
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

export function checkEntry(value: LiteratureEntryRead, projectId: string, entryId?: string): LiteratureEntryRead {
  if (!same(value.project_id, projectId) || (entryId !== undefined && !same(value.id, entryId))) throw new ApiError("INVALID_RESPONSE");
  if ((value.record.coverage === "abstract") !== (value.record.abstract !== null)) throw new ApiError("INVALID_RESPONSE");
  if (value.verification === "verified" && !value.verification_detail.checked) throw new ApiError("INVALID_RESPONSE");
  return value;
}

const lower = <T extends Record<string, unknown>>(value: T, keys: (keyof T)[]) =>
  Object.fromEntries(Object.entries(value).map(([key, item]) => [key, keys.includes(key as keyof T) && typeof item === "string" ? item.toLowerCase() : item]));

export function createHttpLiterature(request: Request): LiteratureService {
  const entryCommand = (input: ApiTypes["LiteratureEntryCommand"]) =>
    parseDto("LiteratureEntryCommand", { command_id: input.command_id.toLowerCase(), expected_version: input.expected_version }, true);
  return {
    async search(projectId, input, signal) {
      const data = parseDto("LiteratureSearchCreate", lower(input, ["command_id"]), true);
      return checkSearchReceipt(await request(`${base(projectId)}/searches`, "LiteratureSearchReceipt", "POST", data, signal), projectId);
    },
    async searches(projectId, query?: PageQuery, signal?) {
      const { limit, offset } = pageQuery(query);
      const value = page(
        await request(`${base(projectId)}/searches?limit=${limit}&offset=${offset}`, "LiteratureSearchPage", "GET", undefined, signal),
        limit,
        offset,
      );
      value.items.forEach((item) => checkSearch(item, projectId));
      return value;
    },
    async getSearch(projectId, searchId, signal) {
      return checkSearch(await request(searchPath(projectId, searchId), "LiteratureSearchRead", "GET", undefined, signal), projectId, searchId);
    },
    async cancelSearch(projectId, searchId, signal) {
      return checkSearch(await request(`${searchPath(projectId, searchId)}/cancel`, "LiteratureSearchRead", "POST", undefined, signal), projectId, searchId);
    },
    async retrySearch(projectId, searchId, input, signal) {
      const data = parseDto("LiteratureSearchRetry", { command_id: input.command_id.toLowerCase() }, true);
      const value = checkSearchReceipt(await request(`${searchPath(projectId, searchId)}/retry`, "LiteratureSearchReceipt", "POST", data, signal), projectId);
      if (!value.search.source_search_id || !same(value.search.source_search_id, searchId)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async save(projectId, input, signal) {
      const data = parseDto("LiteratureEntryCreate", lower(input, ["command_id", "search_id"]), true);
      const value = checkEntry(await request(`${base(projectId)}/entries`, "LiteratureEntryRead", "POST", data, signal), projectId);
      if (!same(value.search_id, data.search_id) || value.result_index !== data.result_index) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async entries(projectId, query: LiteratureEntryQuery = {}, signal?) {
      const { limit, offset } = pageQuery({ limit: 50, ...query });
      const removed = query.includeRemoved ? "&include_removed=true" : "";
      const value = page(
        await request(`${base(projectId)}/entries?limit=${limit}&offset=${offset}${removed}`, "LiteratureEntryPage", "GET", undefined, signal),
        limit,
        offset,
      );
      value.items.forEach((item) => {
        checkEntry(item, projectId);
        if (item.removed && !query.includeRemoved) throw new ApiError("INVALID_RESPONSE");
      });
      return value;
    },
    async getEntry(projectId, entryId, signal) {
      return checkEntry(await request(entryPath(projectId, entryId), "LiteratureEntryRead", "GET", undefined, signal), projectId, entryId);
    },
    async versions(projectId, entryId, query?: PageQuery, signal?) {
      const { limit, offset } = pageQuery({ limit: 50, ...query });
      return page(
        await request(`${entryPath(projectId, entryId)}/versions?limit=${limit}&offset=${offset}`, "LiteratureEntryVersionPage", "GET", undefined, signal),
        limit,
        offset,
      );
    },
    async remove(projectId, entryId, input, signal) {
      return checkEntry(
        await request(`${entryPath(projectId, entryId)}/remove`, "LiteratureEntryRead", "POST", entryCommand(input), signal),
        projectId,
        entryId,
      );
    },
    async restore(projectId, entryId, input, signal) {
      return checkEntry(
        await request(`${entryPath(projectId, entryId)}/restore`, "LiteratureEntryRead", "POST", entryCommand(input), signal),
        projectId,
        entryId,
      );
    },
    async verify(projectId, entryId, input, signal) {
      return checkEntry(
        await request(`${entryPath(projectId, entryId)}/verify`, "LiteratureEntryRead", "POST", entryCommand(input), signal),
        projectId,
        entryId,
      );
    },
  };
}
