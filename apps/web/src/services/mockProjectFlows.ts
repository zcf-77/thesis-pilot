import type { FlowRead, FlowVersionRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { parseFlowInput } from "./httpProjectFlows.ts";
import type { ProjectFlowService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

const clone = <T>(value: T): T => structuredClone(value);
const equalId = (first: string, second: string) => first.toLowerCase() === second.toLowerCase();

export function createMockProjectFlows(before: (signal?: AbortSignal) => Promise<void>) {
  const flows = new Map<string, FlowRead>();
  const history = new Map<string, FlowVersionRead[]>();
  function flow(id: string): FlowRead {
    const current = flows.get(requireUuid(id).toLowerCase());
    if (!current) throw new ApiError("PROJECT_FLOW_NOT_FOUND", { status: 404 });
    return current;
  }
  function snapshot(current: FlowRead, now: string): FlowVersionRead {
    return {
      id: crypto.randomUUID(),
      flow_id: current.id,
      version: current.version,
      name: current.name,
      stages: clone(current.stages),
      created_at: now,
    };
  }
  const service: ProjectFlowService = {
    async list(query, signal) {
      await before(signal);
      const { limit, offset } = pageQuery(query);
      const ordered = [...flows.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      return clone(parseDto("FlowPage", { items: ordered.slice(offset, offset + limit), total: ordered.length, limit, offset }));
    },
    async create(input, signal) {
      await before(signal);
      const data = parseFlowInput("FlowCreate", input);
      const now = new Date().toISOString();
      const value: FlowRead = {
        id: crypto.randomUUID(),
        name: data.name,
        version: 1,
        enabled: true,
        current_version_id: crypto.randomUUID(),
        stages: clone(data.stages),
        created_at: now,
        updated_at: now,
      };
      const initial = snapshot(value, now);
      value.current_version_id = initial.id;
      parseDto("FlowRead", value);
      flows.set(value.id, value);
      history.set(value.id, [initial]);
      return clone(value);
    },
    async get(id, signal) {
      await before(signal);
      return clone(flow(id));
    },
    async update(id, input, signal) {
      await before(signal);
      const data = parseFlowInput("FlowUpdate", input);
      const current = flow(id);
      if (current.version !== data.expected_version) throw new ApiError("PROJECT_FLOW_VERSION_CONFLICT", { status: 409 });
      const now = new Date().toISOString();
      const next: FlowRead = {
        ...current,
        name: data.name ?? current.name,
        stages: clone(data.stages ?? current.stages),
        enabled: data.enabled ?? current.enabled,
        version: current.version + 1,
        updated_at: now,
      };
      const entry = snapshot(next, now);
      next.current_version_id = entry.id;
      parseDto("FlowRead", next);
      flows.set(current.id, next);
      history.get(current.id)!.push(entry);
      return clone(next);
    },
    async versions(id, query, signal) {
      await before(signal);
      const current = flow(id);
      const { limit, offset } = pageQuery(query);
      const ordered = [...history.get(current.id)!].sort((a, b) => b.version - a.version);
      return clone(parseDto("FlowVersionPage", { items: ordered.slice(offset, offset + limit), total: ordered.length, limit, offset }));
    },
    async version(id, version, signal) {
      await before(signal);
      if (!Number.isSafeInteger(version) || version < 1) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const entry = history.get(requireUuid(id).toLowerCase())?.find((candidate) => candidate.version === version);
      if (!entry) throw new ApiError("PROJECT_FLOW_VERSION_NOT_FOUND", { status: 404 });
      return clone(entry);
    },
  };
  function validateBinding(versionId: string | null, stageId: string | null): void {
    if ((versionId === null) !== (stageId === null)) throw new ApiError("PROJECT_FLOW_BINDING_INVALID", { status: 422 });
    if (versionId === null) return;
    requireUuid(versionId);
    const entry = [...history.values()].flat().find((candidate) => equalId(candidate.id, versionId));
    if (!entry) throw new ApiError("PROJECT_FLOW_VERSION_NOT_FOUND", { status: 404 });
    if (!flows.get(entry.flow_id)!.enabled) throw new ApiError("PROJECT_FLOW_DISABLED", { status: 409 });
    if (!entry.stages.some((stage) => stage.id === stageId && (stage.enabled ?? true))) throw new ApiError("PROJECT_FLOW_STAGE_INVALID", { status: 422 });
  }
  /** Immutable snapshot lookup for modules that read a project's bound version. */
  function versionById(versionId: string): FlowVersionRead | undefined {
    const entry = [...history.values()].flat().find((candidate) => equalId(candidate.id, versionId));
    return entry ? clone(entry) : undefined;
  }
  return { service, validateBinding, versionById };
}
