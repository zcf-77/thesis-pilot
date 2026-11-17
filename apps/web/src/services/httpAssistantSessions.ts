import type { ApiTypes, SchemaName, AssistantSessionRead, AssistantRunRead, AssistantRunReceipt, AssistantRunRetryReceipt } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { selectionText } from "./revisionProtectionV2.ts";
import type { AssistantSessionService, PageQuery } from "./types.ts";
import { isContentRevisionInput, pageQuery, parseDto, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const base = (projectId: string) => `/projects/${requireUuid(projectId)}`;
const sessionPath = (projectId: string, sessionId: string) => `${base(projectId)}/assistant-sessions/${requireUuid(sessionId)}`;
const runPath = (projectId: string, runId: string) => `${base(projectId)}/assistant-runs/${requireUuid(runId)}`;
export function assistantInput<Name extends "AssistantSessionCreate" | "AssistantSessionUpdate" | "AssistantRunCreate" | "AssistantRunCommand">(
  name: Name,
  input: ApiTypes[Name],
): ApiTypes[Name] {
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object")
      return Object.fromEntries(
        // UUID 标识统一小写；正文节点 ID（node_id）区分大小写，原样保留。
        Object.entries(value).map(([key, item]) => [
          key,
          key.endsWith("_id") && key !== "node_id" && typeof item === "string" ? item.toLowerCase() : normalize(item),
        ]),
      );
    return value;
  }
  const normalized = { ...(normalize(input) as object), ...("title" in input && typeof input.title === "string" ? { title: input.title.trim() } : {}) };
  const data = parseDto(name, normalized, true);
  if (name === "AssistantSessionUpdate" && (Object.keys(data).length <= 1 || Object.values(data).some((value) => value === null)))
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  if (name === "AssistantRunCreate") {
    const run = data as ApiTypes["AssistantRunCreate"];
    const sources = run.input.material_sources ?? [];
    if (
      !run.input.goal.trim() ||
      !selectionText(run.input.selection).trim() ||
      new Set(sources.map((source) => source.parse_version_id.toLowerCase())).size !== sources.length ||
      sources.some((source) => new Set(source.anchor_ids).size !== source.anchor_ids.length)
    )
      throw new ApiError("VALIDATION_ERROR", { status: 422 });
    if (new TextEncoder().encode(JSON.stringify(run)).byteLength > 256 * 1024) throw new ApiError("ASSISTANT_INPUT_TOO_LARGE", { status: 413 });
  }
  if (name === "AssistantRunCreate") {
    const run = data as ApiTypes["AssistantRunCreate"];
    return parseDto(
      name,
      { ...run, purpose: run.purpose ?? "content_revision", input: { ...run.input, material_sources: run.input.material_sources ?? [] } },
      true,
    );
  }
  return data;
}
function pageIdentity(value: { limit: number; offset: number; total: number; items: unknown[] }, query?: PageQuery) {
  const { limit, offset } = pageQuery(query);
  if (value.limit !== limit || value.offset !== offset || value.total < value.items.length || value.items.length > limit)
    throw new ApiError("INVALID_RESPONSE");
}
function sessionIdentity(value: AssistantSessionRead, projectId: string, sessionId?: string) {
  if (!sameId(value.project_id, projectId) || (sessionId && !sameId(value.id, sessionId))) throw new ApiError("INVALID_RESPONSE");
}
function runIdentity(value: AssistantRunRead, projectId: string, runId?: string, sessionId?: string) {
  if (!sameId(value.project_id, projectId) || (runId && !sameId(value.id, runId)) || (sessionId && !sameId(value.session_id, sessionId)))
    throw new ApiError("INVALID_RESPONSE");
}
function receiptIdentity(value: AssistantRunReceipt | AssistantRunRetryReceipt, projectId: string, sessionId?: string) {
  sessionIdentity(value.session, projectId, sessionId);
  runIdentity(value.run, projectId, undefined, value.session.id);
  if (
    !sameId(value.job.project_id, projectId) ||
    value.job.kind !== "content_revision" ||
    value.job.id !== value.run.job_id ||
    !isContentRevisionInput(value.job.resource_scope) ||
    value.job.resource_scope.run_id !== value.run.id ||
    value.run.status !== value.job.status
  )
    throw new ApiError("INVALID_RESPONSE");
  if (
    "message" in value &&
    (value.message.session_id !== value.session.id ||
      (value.message.run_id !== null && value.message.run_id !== value.run.id) ||
      value.message.id !== value.run.trigger_message_id ||
      value.message.role !== "user")
  )
    throw new ApiError("INVALID_RESPONSE");
}
export function createHttpAssistantSessions(request: Request): AssistantSessionService {
  return {
    async list(projectId, query = {}, signal) {
      const { limit, offset } = pageQuery(query);
      if (query.include_archived !== undefined && typeof query.include_archived !== "boolean") throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const value = await request(
        `${base(projectId)}/assistant-sessions?limit=${limit}&offset=${offset}${query.include_archived ? "&include_archived=true" : ""}`,
        "AssistantSessionPage",
        "GET",
        undefined,
        signal,
      );
      pageIdentity(value, query);
      value.items.forEach((session) => {
        sessionIdentity(session, projectId);
        if (!query.include_archived && session.archived) throw new ApiError("INVALID_RESPONSE");
      });
      return value;
    },
    async create(projectId, input, signal) {
      const data = assistantInput("AssistantSessionCreate", input);
      const value = await request(`${base(projectId)}/assistant-sessions`, "AssistantSessionRead", "POST", data, signal);
      sessionIdentity(value, projectId);
      if (value.version !== 1) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async get(projectId, sessionId, signal) {
      const value = await request(sessionPath(projectId, sessionId), "AssistantSessionRead", "GET", undefined, signal);
      sessionIdentity(value, projectId, sessionId);
      return value;
    },
    async update(projectId, sessionId, input, signal) {
      const data = assistantInput("AssistantSessionUpdate", input);
      const value = await request(sessionPath(projectId, sessionId), "AssistantSessionRead", "PATCH", data, signal);
      sessionIdentity(value, projectId, sessionId);
      if (value.version !== data.expected_version + 1) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async messages(projectId, sessionId, query, signal) {
      const { limit, offset } = pageQuery(query);
      if (limit > 50) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const value = await request(
        `${sessionPath(projectId, sessionId)}/messages?limit=${limit}&offset=${offset}`,
        "AssistantMessagePage",
        "GET",
        undefined,
        signal,
      );
      pageIdentity(value, query);
      if (
        value.items.some(
          (message) =>
            !sameId(message.session_id, sessionId) || message.seq < 1 || Array.from(message.content).length > (message.role === "user" ? 2000 : 4000),
        )
      )
        throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async createRun(projectId, sessionId, input, signal) {
      const data = assistantInput("AssistantRunCreate", input);
      const value = await request(`${sessionPath(projectId, sessionId)}/runs`, "AssistantRunReceipt", "POST", data, signal);
      receiptIdentity(value, projectId, sessionId);
      if (
        value.run.document_id !== data.input.document_id ||
        value.run.document_version !== data.input.document_version ||
        value.message.content !== data.input.goal
      )
        throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async runs(projectId, sessionId, query, signal) {
      const { limit, offset } = pageQuery(query);
      const value = await request(`${sessionPath(projectId, sessionId)}/runs?limit=${limit}&offset=${offset}`, "AssistantRunPage", "GET", undefined, signal);
      pageIdentity(value, query);
      value.items.forEach((run) => runIdentity(run, projectId, undefined, sessionId));
      return value;
    },
    async run(projectId, runId, signal) {
      const value = await request(runPath(projectId, runId), "AssistantRunRead", "GET", undefined, signal);
      runIdentity(value, projectId, runId);
      return value;
    },
    async context(projectId, runId, signal) {
      const value = await request(`${runPath(projectId, runId)}/context`, "AssistantRunContext", "GET", undefined, signal);
      if (!sameId(value.run_id, runId)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async cancel(projectId, runId, input, signal) {
      const data = assistantInput("AssistantRunCommand", input);
      const value = await request(`${runPath(projectId, runId)}/cancel`, "AssistantRunRead", "POST", data, signal);
      runIdentity(value, projectId, runId);
      if (value.status !== "cancelled") throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async retry(projectId, runId, input, signal) {
      const data = assistantInput("AssistantRunCommand", input);
      const value = await request(`${runPath(projectId, runId)}/retry`, "AssistantRunRetryReceipt", "POST", data, signal);
      receiptIdentity(value, projectId);
      if (sameId(value.run.id, runId) || !sameId(value.run.source_run_id ?? "", runId)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
  };
}
