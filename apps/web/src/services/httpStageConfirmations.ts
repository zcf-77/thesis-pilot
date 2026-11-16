import type { ApiTypes, SchemaName, StageCommandRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { PageQuery, StageConfirmationService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const base = (projectId: string) => `/projects/${requireUuid(projectId)}`;

/** Shared by HTTP and Mock so both reject the same malformed commands before transport. */
export function stageInput<Name extends "StageConfirm" | "StageRevoke">(name: Name, input: ApiTypes[Name]): ApiTypes[Name] {
  const lower = (value: unknown) => (typeof value === "string" ? value.toLowerCase() : value);
  const normalized: Record<string, unknown> = { ...input, command_id: lower(input.command_id) };
  if ("flow_version_id" in input) {
    normalized.flow_version_id = lower(input.flow_version_id);
    normalized.stage_id = typeof input.stage_id === "string" ? input.stage_id.trim() : input.stage_id;
    normalized.evidence = (input.evidence ?? []).map((item) => ({ ...item, task_id: lower(item.task_id) }));
    normalized.document_version ??= null;
    normalized.next_stage_id ??= null;
  }
  const data = parseDto(name, normalized, true);
  if (/[\uD800-\uDFFF]/u.test(data.note ?? "")) throw new ApiError("VALIDATION_ERROR", { status: 422 });
  if ("stage_id" in data) {
    const ids = (data.evidence ?? []).map((item) => item.task_id);
    if (!data.note.trim() || new Set(ids).size !== ids.length || data.next_stage_id === data.stage_id) throw new ApiError("VALIDATION_ERROR", { status: 422 });
  }
  return data;
}

function command(value: StageCommandRead, projectId: string): StageCommandRead {
  if (!same(value.confirmation.project_id, projectId) || !same(value.project.id, projectId)) throw new ApiError("INVALID_RESPONSE");
  return value;
}

export function createHttpStageConfirmations(request: Request): StageConfirmationService {
  return {
    async progress(projectId, signal) {
      const value = await request(`${base(projectId)}/stage-progress`, "StageProgressRead", "GET", undefined, signal);
      if (!same(value.project_id, projectId)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async history(projectId, query?: PageQuery, signal?) {
      const { limit, offset } = pageQuery(query);
      const value = await request(`${base(projectId)}/stage-confirmations?limit=${limit}&offset=${offset}`, "StageConfirmationPage", "GET", undefined, signal);
      if (value.limit !== limit || value.offset !== offset || value.items.length > limit || value.items.some((item) => !same(item.project_id, projectId)))
        throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async confirm(projectId, input, signal) {
      return command(await request(`${base(projectId)}/stage-confirmations`, "StageCommandRead", "POST", stageInput("StageConfirm", input), signal), projectId);
    },
    async revoke(projectId, confirmationId, input, signal) {
      const path = `${base(projectId)}/stage-confirmations/${requireUuid(confirmationId)}/revocations`;
      const value = command(await request(path, "StageCommandRead", "POST", stageInput("StageRevoke", input), signal), projectId);
      if (!same(value.confirmation.revokes_id ?? "", confirmationId)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
  };
}
