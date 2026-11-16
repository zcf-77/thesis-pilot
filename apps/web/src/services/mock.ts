import type { ProjectRead } from "./contracts/api.generated.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import { createMockDocuments } from "./mockDocuments.ts";
import { createMockJobs } from "./mockJobs.ts";
import { createMockAIConfigs } from "./mockAIConfigs.ts";
import { createMockMaterials } from "./mockMaterials.ts";
import { createMockDocumentSources } from "./mockDocumentSources.ts";
import { createMockAssistantSessions } from "./mockAssistantSessions.ts";
import { createMockTasksFeedback } from "./mockTasksFeedback.ts";
import { createMockFormatRevisions } from "./mockFormatRevisions.ts";
import { createMockRevisions } from "./mockRevisions.ts";
import { createMockProjectFlows } from "./mockProjectFlows.ts";
import { parseProjectInput } from "./httpProjectFlows.ts";
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
    const value = projects.get(id.toLowerCase());
    if (!value) throw new ApiError("PROJECT_NOT_FOUND", { status: 404 });
    return value;
  }
  const documents = createMockDocuments(project);
  const flows = createMockProjectFlows(before);
  const aiConfigs = createMockAIConfigs(before, (ids) => jobs.configurationReferences(ids));
  const materials = createMockMaterials(before, project, (projectId, input, fileType) => jobs.enqueueMaterial(projectId, input, fileType));
  const jobs = createMockJobs(before, project, documents, aiConfigs.freeze, materials.completeParse);
  const documentSources = createMockDocumentSources(before, project, documents, materials.sourceData);
  const tasksFeedback = createMockTasksFeedback(before, project, documents, materials.sourceData);
  const assistantSessions = createMockAssistantSessions(
    before,
    project,
    documents,
    materials.service,
    materials.sourceData,
    aiConfigs.configuration,
    jobs,
    (projectId, runId, sourceJobId) => jobs.enqueueAssistant(projectId, runId, sourceJobId),
  );
  return {
    sourceKey,
    projectFlows: flows.service,
    aiConfigs: aiConfigs.service,
    materials: materials.service,
    documents,
    documentSources,
    assistantSessions,
    ...tasksFeedback,
    formatRevisions: createMockFormatRevisions(before, project, documents, documentSources, materials.sourceBinding, materials.parseData),
    jobs,
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
        const data = parseProjectInput("ProjectCreate", input);
        const now = stamp();
        const value: ProjectRead = {
          id: crypto.randomUUID(),
          name: data.name,
          title: data.title ?? "",
          deadline: data.deadline ?? null,
          planning_mode: data.planning_mode ?? "none",
          plan_note: data.plan_note ?? "",
          existing_artifacts: data.existing_artifacts ?? "",
          archived: data.archived ?? false,
          flow_version_id: data.flow_version_id ?? null,
          stage_id: data.stage_id ?? null,
          version: 1,
          created_at: now,
          updated_at: now,
        };
        flows.validateBinding(value.flow_version_id, value.stage_id);
        parseDto("ProjectRead", value);
        projects.set(value.id, value);
        return clone(value);
      },
      async get(id, signal) {
        await before(signal);
        return clone(parseDto("ProjectRead", project(id)));
      },
      async update(id, input, signal) {
        await before(signal);
        const data = parseProjectInput("ProjectUpdate", input);
        const current = project(id);
        if (current.version !== data.expected_version) throw new ApiError("PROJECT_VERSION_CONFLICT", { status: 409 });
        const next: ProjectRead = {
          ...current,
          name: data.name ?? current.name,
          title: data.title ?? current.title,
          deadline: Object.hasOwn(data, "deadline") ? (data.deadline ?? null) : current.deadline,
          planning_mode: data.planning_mode ?? current.planning_mode,
          plan_note: data.plan_note ?? current.plan_note,
          existing_artifacts: data.existing_artifacts ?? current.existing_artifacts,
          archived: data.archived ?? current.archived,
          flow_version_id: Object.hasOwn(data, "flow_version_id") ? (data.flow_version_id ?? null) : current.flow_version_id,
          stage_id: Object.hasOwn(data, "stage_id") ? (data.stage_id ?? null) : current.stage_id,
          version: current.version + 1,
          updated_at: stamp(),
        };
        if (next.flow_version_id !== current.flow_version_id || next.stage_id !== current.stage_id) flows.validateBinding(next.flow_version_id, next.stage_id);
        parseDto("ProjectRead", next);
        projects.set(current.id, next);
        return clone(next);
      },
    },
  };
}
