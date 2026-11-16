import type { JobRead, LiteratureSearchRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { JobService, LiteratureService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

/**
 * In-memory adapter with the HTTP contract. Like a server without network access, the
 * mock queue fails every search and never invents bibliographic records, so no entry
 * can be saved here.
 */
export function createMockLiterature(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => unknown,
  jobs: JobService,
  enqueue: (projectId: string, searchId: string, sourceJobId?: string) => JobRead,
): LiteratureService {
  const searches = new Map<string, LiteratureSearchRead>();
  const commands = new Map<string, { fingerprint: string; searchId: string }>();

  function find(projectId: string, searchId: string) {
    requireProject(requireUuid(projectId));
    const value = searches.get(requireUuid(searchId).toLowerCase());
    if (!value || value.project_id !== projectId.toLowerCase()) throw new ApiError("LITERATURE_SEARCH_NOT_FOUND", { status: 404 });
    return value;
  }
  async function refresh(value: LiteratureSearchRead) {
    const job = await jobs.get(value.job_id, undefined, value.project_id);
    Object.assign(value, { status: job.status, error_code: job.error_code, attempt: job.attempt, updated_at: job.updated_at, snapshot: null });
    return parseDto("LiteratureSearchRead", structuredClone(value));
  }
  async function receipt(value: LiteratureSearchRead) {
    const search = await refresh(value);
    const { attempts: _attempts, artifacts: _artifacts, ...job } = await jobs.get(value.job_id, undefined, value.project_id);
    return parseDto("LiteratureSearchReceipt", { search, job });
  }
  async function assertIdle(projectId: string) {
    for (const item of searches.values()) {
      if (item.project_id !== projectId.toLowerCase()) continue;
      const current = await refresh(item);
      if (current.status === "queued" || current.status === "running") throw new ApiError("LITERATURE_SEARCH_BUSY", { status: 409 });
    }
  }
  function remember(commandId: string, fingerprint: string) {
    const previous = commands.get(commandId);
    if (previous && previous.fingerprint !== fingerprint) throw new ApiError("LITERATURE_COMMAND_CONFLICT", { status: 409 });
    return previous ? searches.get(previous.searchId) : undefined;
  }
  function insert(projectId: string, params: Pick<LiteratureSearchRead, "query" | "source" | "year_from" | "year_to" | "rows">, source?: LiteratureSearchRead) {
    const id = crypto.randomUUID();
    const job = enqueue(projectId, id, source?.job_id);
    const value: LiteratureSearchRead = {
      id,
      project_id: projectId.toLowerCase(),
      job_id: job.id,
      status: job.status,
      attempt: job.attempt,
      error_code: null,
      query: params.query,
      source: params.source,
      year_from: params.year_from,
      year_to: params.year_to,
      rows: params.rows,
      source_search_id: source?.id ?? null,
      snapshot: null,
      created_at: job.created_at,
      updated_at: job.updated_at,
    };
    searches.set(id, value);
    return value;
  }
  const noEntry = () => {
    throw new ApiError("LITERATURE_ENTRY_NOT_FOUND", { status: 404 });
  };

  return {
    async search(projectId, input, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      const data = parseDto("LiteratureSearchCreate", { ...input, command_id: input.command_id.toLowerCase() }, true);
      const query = data.query.split(/\s+/).filter(Boolean).join(" ");
      if (!query) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const params = { query, source: data.source ?? "crossref", year_from: data.year_from ?? null, year_to: data.year_to ?? null, rows: data.rows ?? 10 };
      const fingerprint = JSON.stringify(["search", projectId.toLowerCase(), params]);
      const previous = remember(data.command_id, fingerprint);
      if (previous) return receipt(previous);
      await assertIdle(projectId);
      const value = insert(projectId, params);
      commands.set(data.command_id, { fingerprint, searchId: value.id });
      return receipt(value);
    },
    async searches(projectId, query, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      const { limit, offset } = pageQuery(query);
      const items = [...searches.values()]
        .filter((item) => item.project_id === projectId.toLowerCase())
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      return parseDto("LiteratureSearchPage", {
        items: await Promise.all(items.slice(offset, offset + limit).map(refresh)),
        total: items.length,
        limit,
        offset,
      });
    },
    async getSearch(projectId, searchId, signal) {
      await before(signal);
      return refresh(find(projectId, searchId));
    },
    async cancelSearch(projectId, searchId, signal) {
      await before(signal);
      const value = find(projectId, searchId);
      await jobs.cancel(value.job_id, signal, value.project_id);
      return refresh(value);
    },
    async retrySearch(projectId, searchId, input, signal) {
      await before(signal);
      const commandId = parseDto("LiteratureSearchRetry", { command_id: input.command_id.toLowerCase() }, true).command_id;
      const fingerprint = JSON.stringify(["retry", projectId.toLowerCase(), searchId.toLowerCase()]);
      const previous = remember(commandId, fingerprint);
      if (previous) return receipt(previous);
      const original = await refresh(find(projectId, searchId));
      if (original.status !== "failed" && original.status !== "cancelled") throw new ApiError("LITERATURE_RETRY_INVALID", { status: 409 });
      await assertIdle(projectId);
      const value = insert(projectId, original, original);
      commands.set(commandId, { fingerprint, searchId: value.id });
      return receipt(value);
    },
    async save(projectId, input, signal) {
      await before(signal);
      const data = parseDto("LiteratureEntryCreate", { ...input, command_id: input.command_id.toLowerCase(), search_id: input.search_id.toLowerCase() }, true);
      const search = await refresh(find(projectId, data.search_id));
      if (search.status !== "succeeded") throw new ApiError("LITERATURE_SEARCH_NOT_READY", { status: 409 });
      throw new ApiError("LITERATURE_RESULT_NOT_FOUND", { status: 404 });
    },
    async entries(projectId, query = {}, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      const { limit, offset } = pageQuery({ limit: 50, ...query });
      return parseDto("LiteratureEntryPage", { items: [], total: 0, limit, offset });
    },
    async getEntry(_projectId, entryId, signal) {
      await before(signal);
      requireUuid(entryId);
      return noEntry();
    },
    async versions(_projectId, entryId, _query, signal) {
      await before(signal);
      requireUuid(entryId);
      return noEntry();
    },
    async remove(_projectId, entryId, _input, signal) {
      await before(signal);
      requireUuid(entryId);
      return noEntry();
    },
    async restore(_projectId, entryId, _input, signal) {
      await before(signal);
      requireUuid(entryId);
      return noEntry();
    },
    async verify(_projectId, entryId, _input, signal) {
      await before(signal);
      requireUuid(entryId);
      return noEntry();
    },
  };
}
