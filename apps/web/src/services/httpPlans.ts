import type { ApiTypes, PlanAdjustmentRead, PlanAdjustmentReceipt, PlanVersionRead, SchemaName } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { PageQuery, PlanService, ReminderSettingsService } from "./types.ts";
import { isPlanAdjustmentInput, pageQuery, parseDto, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const base = (projectId: string) => `/projects/${requireUuid(projectId)}/plan`;
const path = (projectId: string, adjustmentId: string) => `${base(projectId)}/adjustments/${requireUuid(adjustmentId)}`;
const suffix = (query?: PageQuery) => {
  const { limit, offset } = pageQuery(query);
  return `?limit=${limit}&offset=${offset}`;
};
function paged<T extends { items: unknown[]; limit: number; offset: number; total: number }>(value: T, query?: PageQuery): T {
  const { limit, offset } = pageQuery(query);
  if (value.limit !== limit || value.offset !== offset || value.items.length > limit || value.total < value.items.length)
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

/** A candidate never claims a decision or proposal it cannot have. */
export function planAdjustment(value: PlanAdjustmentRead, projectId: string, adjustmentId?: string): PlanAdjustmentRead {
  if (!same(value.project_id, projectId) || (adjustmentId !== undefined && !same(value.id, adjustmentId))) throw new ApiError("INVALID_RESPONSE");
  const decided = ["adopted", "kept", "reverted"].includes(value.state);
  if ((value.proposal !== null) !== (value.status === "succeeded") || decided !== (value.decision !== null)) throw new ApiError("INVALID_RESPONSE");
  if ((value.state === "reverted") !== (value.revert !== null)) throw new ApiError("INVALID_RESPONSE");
  if (["queued", "running", "failed", "cancelled"].includes(value.state) && value.state !== value.status) throw new ApiError("INVALID_RESPONSE");
  return value;
}

export function planReceipt(value: PlanAdjustmentReceipt, projectId: string): PlanAdjustmentReceipt {
  planAdjustment(value.adjustment, projectId);
  const { job } = value;
  if (
    job.kind !== "plan_adjustment" ||
    !same(job.id, value.adjustment.job_id) ||
    !same(job.project_id, projectId) ||
    !isPlanAdjustmentInput(job.input_snapshot) ||
    !same(job.input_snapshot.adjustment_id, value.adjustment.id)
  )
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

function planVersion(value: PlanVersionRead, projectId: string): PlanVersionRead {
  if (!same(value.project_id, projectId)) throw new ApiError("INVALID_RESPONSE");
  return value;
}

const lower = (value: string) => value.toLowerCase();

/** Client checks only bound transport; the server freezes inputs and enforces every constraint. */
export function planInput<Name extends "PlanSchedule" | "PlanAdjustmentCreate" | "PlanAdjustmentDecide" | "PlanAdjustmentRevert">(
  name: Name,
  input: ApiTypes[Name],
): ApiTypes[Name] {
  const value = structuredClone(input) as Record<string, unknown>;
  value.command_id = lower(value.command_id as string);
  if (typeof value.agent_config_version_id === "string") value.agent_config_version_id = lower(value.agent_config_version_id);
  if (Array.isArray(value.changes)) value.changes = (value.changes as ApiTypes["ScheduleChange"][]).map((item) => ({ ...item, task_id: lower(item.task_id) }));
  return parseDto(name, value, true);
}

export function createHttpPlans(request: Request): PlanService {
  return {
    async get(projectId, signal) {
      const value = await request(base(projectId), "PlanRead", "GET", undefined, signal);
      if (!same(value.project_id, projectId)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async versions(projectId, query, signal) {
      const value = paged(await request(`${base(projectId)}/versions${suffix(query)}`, "PlanVersionPage", "GET", undefined, signal), query);
      value.items.forEach((item) => planVersion(item, projectId));
      return value;
    },
    async schedule(projectId, input, signal) {
      return planVersion(await request(`${base(projectId)}/schedule`, "PlanVersionRead", "POST", planInput("PlanSchedule", input), signal), projectId);
    },
    async createAdjustment(projectId, input, signal) {
      const data = planInput("PlanAdjustmentCreate", input);
      return planReceipt(await request(`${base(projectId)}/adjustments`, "PlanAdjustmentReceipt", "POST", data, signal), projectId);
    },
    async adjustments(projectId, query, signal) {
      const value = paged(await request(`${base(projectId)}/adjustments${suffix(query)}`, "PlanAdjustmentPage", "GET", undefined, signal), query);
      value.items.forEach((item) => planAdjustment(item, projectId));
      return value;
    },
    async adjustment(projectId, adjustmentId, signal) {
      return planAdjustment(await request(path(projectId, adjustmentId), "PlanAdjustmentRead", "GET", undefined, signal), projectId, adjustmentId);
    },
    async cancel(projectId, adjustmentId, signal) {
      return planAdjustment(await request(`${path(projectId, adjustmentId)}/cancel`, "PlanAdjustmentRead", "POST", undefined, signal), projectId, adjustmentId);
    },
    async decide(projectId, adjustmentId, input, signal) {
      const data = planInput("PlanAdjustmentDecide", input);
      return planAdjustment(await request(`${path(projectId, adjustmentId)}/decisions`, "PlanAdjustmentRead", "POST", data, signal), projectId, adjustmentId);
    },
    async revert(projectId, adjustmentId, input, signal) {
      const data = planInput("PlanAdjustmentRevert", input);
      return planAdjustment(await request(`${path(projectId, adjustmentId)}/revert`, "PlanAdjustmentRead", "POST", data, signal), projectId, adjustmentId);
    },
  };
}

export function createHttpReminderSettings(request: Request): ReminderSettingsService {
  return {
    async get(signal) {
      return request("/reminder-settings", "ReminderSettingsRead", "GET", undefined, signal);
    },
    async update(input, signal) {
      return request("/reminder-settings", "ReminderSettingsRead", "PUT", parseDto("ReminderSettingsUpdate", input, true), signal);
    },
  };
}
