import type { ApiTypes, FlowStage, SchemaName } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { PageQuery, ProjectFlowService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

type FlowRequest = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;
const equalId = (first: string, second: string) => first.toLowerCase() === second.toLowerCase();
const trim = (value: unknown) => (typeof value === "string" ? value.trim() : value);

export function parseProjectInput<Name extends "ProjectCreate" | "ProjectUpdate">(schema: Name, input: ApiTypes[Name]): ApiTypes[Name] {
  const normalized = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      ["name", "title", "plan_note", "existing_artifacts", "stage_id"].includes(key)
        ? trim(value)
        : key === "flow_version_id" && typeof value === "string"
          ? value.toLowerCase()
          : value,
    ]),
  );
  const data = parseDto(schema, normalized, true);
  if (schema === "ProjectCreate" && (data.flow_version_id == null) !== (data.stage_id == null)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
  if (
    schema === "ProjectUpdate" &&
    (Object.keys(data).length <= 1 || Object.entries(data).some(([key, value]) => value === null && !["deadline", "flow_version_id", "stage_id"].includes(key)))
  )
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return data;
}

export function parseFlowInput<Name extends "FlowCreate" | "FlowUpdate">(schema: Name, input: ApiTypes[Name]): ApiTypes[Name] {
  const data = parseDto(
    schema,
    {
      ...input,
      ...(Object.hasOwn(input, "name") ? { name: trim(input.name) } : {}),
      ...(Array.isArray(input.stages)
        ? {
            stages: input.stages.map((stage) => {
              if (stage === null || typeof stage !== "object" || Array.isArray(stage)) return stage;
              return Object.fromEntries(
                Object.entries({ description: "", dependencies: [], enabled: true, start: null, deadline: null, ...stage }).map(([key, value]) => [
                  key,
                  ["id", "name", "description"].includes(key)
                    ? trim(value)
                    : ["deliverables", "conditions", "dependencies"].includes(key) && Array.isArray(value)
                      ? value.map(trim)
                      : value,
                ]),
              );
            }),
          }
        : {}),
    },
    true,
  );
  if (schema === "FlowUpdate" && (Object.keys(data).length <= 1 || Object.values(data).some((value) => value === null)))
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  if (data.stages != null) validateFlowStages(data.stages);
  return data;
}

/** Cross-field graph invariants cannot be expressed by the generated JSON Schema. */
export function validateFlowStages(stages: FlowStage[], input = true): void {
  const fail = () => {
    throw new ApiError(input ? "VALIDATION_ERROR" : "INVALID_RESPONSE", input ? { status: 422 } : {});
  };
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  if (byId.size !== stages.length || new Set(stages.map((stage) => stage.name)).size !== stages.length || !stages.some((stage) => stage.enabled ?? true))
    fail();
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) fail();
    if (visited.has(id)) return;
    const stage = byId.get(id);
    if (!stage) return fail();
    if (stage.start != null && stage.deadline != null && stage.start > stage.deadline) fail();
    if ((stage.enabled ?? true) && (!stage.deliverables.length || !stage.conditions.length)) fail();
    const dependencies = stage.dependencies ?? [];
    if (new Set(dependencies).size !== dependencies.length) fail();
    visiting.add(id);
    for (const dependency of dependencies) {
      const prerequisite = byId.get(dependency);
      if (!prerequisite || ((stage.enabled ?? true) && !(prerequisite.enabled ?? true))) return fail();
      if ((stage.enabled ?? true) && stage.deadline != null && prerequisite.deadline != null && stage.deadline < prerequisite.deadline) fail();
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  }
  stages.forEach((stage) => visit(stage.id));
}

function checkPage(page: { limit: number; offset: number; total: number; items: unknown[] }, query?: PageQuery) {
  const { limit, offset } = pageQuery(query);
  if (page.limit !== limit || page.offset !== offset || page.items.length > limit || page.total < page.items.length) throw new ApiError("INVALID_RESPONSE");
}

export function createHttpProjectFlows(request: FlowRequest): ProjectFlowService {
  return {
    async list(query, signal) {
      const { limit, offset } = pageQuery(query);
      const result = await request(`/project-flows?limit=${limit}&offset=${offset}`, "FlowPage", "GET", undefined, signal);
      checkPage(result, query);
      result.items.forEach((item) => validateFlowStages(item.stages, false));
      return result;
    },
    async create(input, signal) {
      const data = parseFlowInput("FlowCreate", input);
      const result = await request("/project-flows", "FlowRead", "POST", data, signal);
      if (result.version !== 1) throw new ApiError("INVALID_RESPONSE");
      validateFlowStages(result.stages, false);
      return result;
    },
    async get(id, signal) {
      const result = await request(`/project-flows/${requireUuid(id)}`, "FlowRead", "GET", undefined, signal);
      if (!equalId(result.id, id)) throw new ApiError("INVALID_RESPONSE");
      validateFlowStages(result.stages, false);
      return result;
    },
    async update(id, input, signal) {
      const data = parseFlowInput("FlowUpdate", input);
      const result = await request(`/project-flows/${requireUuid(id)}`, "FlowRead", "PATCH", data, signal);
      if (!equalId(result.id, id) || result.version !== data.expected_version + 1) throw new ApiError("INVALID_RESPONSE");
      validateFlowStages(result.stages, false);
      return result;
    },
    async versions(id, query, signal) {
      const { limit, offset } = pageQuery(query);
      const result = await request(`/project-flows/${requireUuid(id)}/versions?limit=${limit}&offset=${offset}`, "FlowVersionPage", "GET", undefined, signal);
      checkPage(result, query);
      for (const item of result.items) {
        if (!equalId(item.flow_id, id)) throw new ApiError("INVALID_RESPONSE");
        validateFlowStages(item.stages, false);
      }
      return result;
    },
    async version(id, version, signal) {
      if (!Number.isSafeInteger(version) || version < 1) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const result = await request(`/project-flows/${requireUuid(id)}/versions/${version}`, "FlowVersionRead", "GET", undefined, signal);
      if (!equalId(result.flow_id, id) || result.version !== version) throw new ApiError("INVALID_RESPONSE");
      validateFlowStages(result.stages, false);
      return result;
    },
  };
}
