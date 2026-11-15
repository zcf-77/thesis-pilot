import type { ProjectRead } from "./contracts/api.generated.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import { createMockDocuments } from "./mockDocuments.ts";
import { createMockJobs } from "./mockJobs.ts";
import { createMockRevisions } from "./mockRevisions.ts";
import type { BackendServices } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

const clone = <T>(value: T): T => structuredClone(value);
const stamp = () => new Date().toISOString();
const byNewest = <T extends { created_at: string; id: string }>(a: T, b: T) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

/** Deterministic in-memory API adapter; never imported by the HTTP implementation. */
export function createMockServices(sourceKey: string): BackendServices {
  const projects = new Map<string, ProjectRead>();
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
  const documents = createMockDocuments(project);
  return {
    sourceKey,
    documents,
    jobs: createMockJobs(before, project, documents),
    revisions: createMockRevisions(documents),
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
  };
}
