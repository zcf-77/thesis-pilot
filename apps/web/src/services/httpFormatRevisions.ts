import type { ApiTypes, SchemaName, FormatRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { FormatRevisionService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;
const base = (p: string, d: string) => `/projects/${requireUuid(p)}/documents/${requireUuid(d)}`;
const candidatePath = (p: string, d: string, id: string) => `${base(p, d)}/format-revisions/${requireUuid(id)}`;
const commandPath = (p: string, d: string, id: string) => `${base(p, d)}/format-commands/${requireUuid(id)}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function identity(value: FormatRead, p: string, d: string, id?: string) {
  if (!same(value.project_id, p) || !same(value.document_id, d) || (id && !same(value.id, id))) throw new ApiError("INVALID_RESPONSE");
  return value;
}
export function formatInput<Name extends "FormatCreate" | "FormatDecide" | "FormatApply" | "FormatUndo">(name: Name, input: ApiTypes[Name]): ApiTypes[Name] {
  const value = parseDto(name, input, true);
  if (
    "selections" in value &&
    (new Set(value.selections.map((s) => s.rule_id)).size !== value.selections.length ||
      value.selections.some((s) => new Set(s.target_anchor_ids).size !== s.target_anchor_ids.length))
  )
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  if ("decisions" in value && new Set(value.decisions.map((d) => d.patch_id)).size !== value.decisions.length)
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return value;
}
export function createHttpFormatRevisions(request: Request): FormatRevisionService {
  const command = async (
    path: string,
    operation: "create" | "decide" | "apply" | "undo",
    input: { command_id: string },
    signal?: AbortSignal,
    candidateId?: string,
  ) => {
    const value = await request(path, "FormatCommandRead", "POST", input, signal);
    if (!same(value.command_id, input.command_id) || value.operation !== operation || (candidateId && !same(value.candidate_id, candidateId)))
      throw new ApiError("INVALID_RESPONSE");
    return value;
  };
  return {
    async context(p, d, signal) {
      return request(`${base(p, d)}/format-context`, "FormatContext", "GET", undefined, signal);
    },
    async create(p, d, input, signal) {
      return command(`${base(p, d)}/format-revisions`, "create", formatInput("FormatCreate", input), signal);
    },
    async list(p, d, query, signal) {
      const { limit, offset } = pageQuery(query);
      const value = await request(`${base(p, d)}/format-revisions?limit=${limit}&offset=${offset}`, "FormatPage", "GET", undefined, signal);
      if (value.limit !== limit || value.offset !== offset || value.items.length > limit || value.total < value.items.length)
        throw new ApiError("INVALID_RESPONSE");
      value.items.forEach((v) => identity(v, p, d));
      return value;
    },
    async get(p, d, id, signal) {
      return identity(await request(candidatePath(p, d, id), "FormatRead", "GET", undefined, signal), p, d, id);
    },
    async decide(p, d, id, input, signal) {
      return command(`${candidatePath(p, d, id)}/decisions`, "decide", formatInput("FormatDecide", input), signal, id);
    },
    async apply(p, d, id, input, signal) {
      return command(`${candidatePath(p, d, id)}/apply`, "apply", formatInput("FormatApply", input), signal, id);
    },
    async undo(p, d, id, input, signal) {
      return command(`${commandPath(p, d, id)}/undo`, "undo", formatInput("FormatUndo", input), signal);
    },
    async command(p, d, id, signal) {
      const value = await request(commandPath(p, d, id), "FormatCommandRead", "GET", undefined, signal);
      if (!same(value.command_id, id)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
  };
}
