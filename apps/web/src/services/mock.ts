import type { JobRead, ProjectRead } from "./contracts/api.generated.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import type { BackendServices } from "./types.ts";
import { pageQuery, parseDto, requireIdempotencyKey, requireUuid } from "./validation.ts";

const clone = <T>(value: T): T => structuredClone(value);
const stamp = () => new Date().toISOString();
const byNewest = <T extends { created_at: string; id: string }>(a: T, b: T) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

/** Deterministic in-memory API adapter; never imported by the HTTP implementation. */
export function createMockServices(sourceKey: string): BackendServices {
  const projects = new Map<string, ProjectRead>();
  const jobs = new Map<string, JobRead>();
  const idempotency = new Map<string, { projectId: string; kind: string; jobId: string }>();

  async function before(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await Promise.resolve();
    throwIfAborted(signal);
  }
  function project(id: string): ProjectRead {
    requireUuid(id);
    const value = projects.get(id);
    if (!value) throw new ApiError("PROJECT_NOT_FOUND", { status: 404 });
    return value;
  }
  function job(id: string): JobRead {
    requireUuid(id);
    const value = jobs.get(id);
    if (!value) throw new ApiError("JOB_NOT_FOUND", { status: 404 });
    progress(value);
    return value;
  }
  function progress(value: JobRead): void {
    if (value.status !== "queued" && value.status !== "running") return;
    const elapsed = Date.now() - Date.parse(value.created_at);
    if (elapsed >= 500 && value.status === "queued") {
      value.status = "running";
      value.attempt = 1;
      value.updated_at = stamp();
    }
    if (elapsed >= 2_000) {
      value.status = "succeeded";
      value.attempt = 1;
      value.updated_at = stamp();
      value.result = {
        kind: "diagnostic",
        job_id: value.id,
        project_id: value.project_id,
        checked: true,
        model_used: false,
        writes_performed: false,
        message: "本地模拟服务诊断完成；未调用模型，未修改论文或计划。",
      };
    }
  }

  return {
    sourceKey,
    projects: {
      async list(query, signal) {
        await before(signal);
        const { limit, offset } = pageQuery(query);
        const ordered = [...projects.values()].sort(byNewest);
        return clone(parseDto("ProjectPage", { items: ordered.slice(offset, offset + limit), total: ordered.length, limit, offset }));
      },
      async create(input, signal) {
        await before(signal);
        const data = parseDto("ProjectCreate", { ...input, name: typeof input.name === "string" ? input.name.trim() : input.name }, true);
        const now = stamp();
        const value: ProjectRead = { id: crypto.randomUUID(), name: data.name, version: 1, created_at: now, updated_at: now };
        projects.set(value.id, value);
        return clone(parseDto("ProjectRead", value));
      },
      async get(id, signal) {
        await before(signal);
        return clone(parseDto("ProjectRead", project(id)));
      },
      async update(id, input, signal) {
        await before(signal);
        const data = parseDto("ProjectUpdate", { ...input, name: typeof input.name === "string" ? input.name.trim() : input.name }, true);
        const current = project(id);
        if (current.version !== data.expected_version) throw new ApiError("PROJECT_VERSION_CONFLICT", { status: 409 });
        current.name = data.name;
        current.version += 1;
        current.updated_at = stamp();
        return clone(parseDto("ProjectRead", current));
      },
    },
    jobs: {
      async list(query, signal) {
        await before(signal);
        project(query.project_id);
        const { limit, offset } = pageQuery(query);
        const ordered = [...jobs.values()].filter((value) => value.project_id === query.project_id).sort(byNewest);
        ordered.forEach(progress);
        return clone(parseDto("JobPage", { items: ordered.slice(offset, offset + limit), total: ordered.length, limit, offset }));
      },
      async create(input, idempotencyKey, signal) {
        await before(signal);
        const data = parseDto("JobCreate", { kind: "diagnostic", ...input }, true);
        requireIdempotencyKey(idempotencyKey);
        const existing = idempotency.get(idempotencyKey);
        if (existing) {
          if (existing.projectId !== data.project_id || existing.kind !== data.kind) throw new ApiError("JOB_IDEMPOTENCY_CONFLICT", { status: 409 });
          return clone(parseDto("JobRead", job(existing.jobId)));
        }
        project(data.project_id);
        const now = stamp();
        const value: JobRead = {
          id: crypto.randomUUID(),
          project_id: data.project_id,
          kind: "diagnostic",
          status: "queued",
          attempt: 0,
          result: null,
          error_code: null,
          created_at: now,
          updated_at: now,
        };
        jobs.set(value.id, value);
        idempotency.set(idempotencyKey, { projectId: data.project_id, kind: data.kind ?? "diagnostic", jobId: value.id });
        return clone(parseDto("JobRead", value));
      },
      async get(id, signal) {
        await before(signal);
        return clone(parseDto("JobRead", job(id)));
      },
      async cancel(id, signal) {
        await before(signal);
        const current = job(id);
        if (["succeeded", "failed"].includes(current.status)) throw new ApiError("JOB_STATE_CONFLICT", { status: 409 });
        if (current.status === "cancelled") return clone(parseDto("JobRead", current));
        current.status = "cancelled";
        current.updated_at = stamp();
        return clone(parseDto("JobRead", current));
      },
    },
  };
}
