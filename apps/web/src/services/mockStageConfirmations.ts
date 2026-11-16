import type {
  DeliverableFact,
  FlowStage,
  FlowVersionRead,
  MaterialRead,
  ProjectRead,
  StageCommandRead,
  StageConfirmationRead,
  StageOption,
  TaskRead,
} from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { stageInput } from "./httpStageConfirmations.ts";
import type { DocumentService, MaterialService, StageConfirmationService, TaskService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

const clone = <T>(value: T): T => structuredClone(value);
const fail = (code: string, status = 409): never => {
  throw new ApiError(code, { status });
};
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const norm = (value: string) => value.replace(/\s+/gu, "").toLocaleLowerCase();
type Record = StageConfirmationRead & { fingerprint: string; command_id: string; result: StageCommandRead };
interface Dependencies {
  before(signal?: AbortSignal): Promise<void>;
  project(id: string): ProjectRead;
  saveProject(next: ProjectRead): void;
  flowVersion(id: string): FlowVersionRead | undefined;
  documents: DocumentService;
  tasks: TaskService;
  materials: MaterialService;
}

/** Same contract and rules as the API: stage completion only through explicit records. */
export function createMockStageConfirmations(deps: Dependencies): StageConfirmationService {
  const records: Record[] = [];
  const of = (projectId: string) => records.filter((row) => row.project_id === projectId);
  const revokedBy = (projectId: string) => new Map(of(projectId).flatMap((row) => (row.revokes_id ? [[row.revokes_id, row.id] as const] : [])));
  function active(projectId: string, flowVersionId: string | null) {
    const revoked = revokedBy(projectId);
    const result = new Map<string, Record>();
    for (const row of of(projectId)) if (row.kind === "confirm" && row.flow_version_id === flowVersionId && !revoked.has(row.id)) result.set(row.stage_id, row);
    return result;
  }
  function revocable(owner: ProjectRead): Record | undefined {
    const revoked = revokedBy(owner.id);
    const latest = [...of(owner.id)].reverse().find((row) => row.kind === "confirm" && !revoked.has(row.id));
    return latest && latest.flow_version_id === owner.flow_version_id && latest.resulting_stage_id === owner.stage_id ? latest : undefined;
  }
  function stages(versionId: string): FlowStage[] {
    const snapshot = deps.flowVersion(versionId);
    if (!snapshot) return fail("STAGE_INVALID", 422);
    return snapshot.stages.map((stage) => ({ description: "", dependencies: [], enabled: true, start: null, deadline: null, ...stage }));
  }
  const nameOf = (list: FlowStage[], id: string) => list.find((stage) => stage.id === id)?.name ?? id;
  function nextOptions(list: FlowStage[], current: string, confirmed: Set<string>): StageOption[] {
    const done = new Set([...confirmed, current]);
    return list
      .filter((stage) => stage.enabled && !done.has(stage.id) && (stage.dependencies ?? []).every((id) => done.has(id)))
      .map((stage) => ({ id: stage.id, name: stage.name }));
  }
  async function allTasks(projectId: string, signal?: AbortSignal): Promise<TaskRead[]> {
    const result: TaskRead[] = [];
    for (let offset = 0; ;) {
      const page = await deps.tasks.list(projectId, { limit: 100, offset }, signal);
      for (const item of page.items) result.push(await deps.tasks.get(projectId, item.id, signal));
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) return result;
    }
  }
  async function allMaterials(projectId: string, signal?: AbortSignal): Promise<MaterialRead[]> {
    const result: MaterialRead[] = [];
    for (let offset = 0; ;) {
      const page = await deps.materials.list(projectId, { limit: 100, offset }, signal);
      result.push(...page.items);
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) return result;
    }
  }
  async function currentDocument(projectId: string, signal?: AbortSignal) {
    try {
      return await deps.documents.current(projectId, signal);
    } catch (error) {
      if (error instanceof ApiError && error.code === "DOCUMENT_NOT_FOUND") return undefined;
      throw error;
    }
  }
  const usable = (task: TaskRead) => task.status === "confirmed" && !task.content.archived && !task.needs_review;
  function deliverables(stage: FlowStage, tasks: TaskRead[], materials: MaterialRead[]): DeliverableFact[] {
    return stage.deliverables.map((name) => {
      const key = norm(name);
      const taskIds = tasks
        .filter(
          (task) =>
            key && [task.content.title, task.content.acceptance, ...task.evidence_snapshots.map((item) => item.label)].some((text) => norm(text).includes(key)),
        )
        .map((task) => task.id);
      const materialIds = materials.filter((item) => key && (norm(item.name).includes(key) || norm(item.source_note).includes(key))).map((item) => item.id);
      return { name, status: taskIds.length ? "confirmed_task" : materialIds.length ? "material" : "none", task_ids: taskIds, material_ids: materialIds };
    });
  }
  function view(row: Record): StageConfirmationRead {
    const { fingerprint: _f, command_id: _c, result: _r, ...rest } = row;
    return { ...clone(rest), revoked_by_id: revokedBy(row.project_id).get(row.id) ?? null };
  }
  function replay(projectId: string, commandId: string, kind: string, scope: string, input: unknown): StageCommandRead | undefined {
    const row = records.find((item) => item.command_id === commandId);
    if (!row) return undefined;
    if (row.project_id !== projectId || row.kind !== kind || row.fingerprint !== stable([scope, input])) return fail("STAGE_COMMAND_CONFLICT");
    return clone(row.result);
  }
  function append(
    owner: ProjectRead,
    expected: number,
    resulting: string,
    fields: Omit<
      StageConfirmationRead,
      "id" | "project_id" | "sequence" | "project_version_after" | "created_at" | "revoked_by_id" | "stage_name" | "resulting_stage_name"
    >,
    list: FlowStage[],
    commandId: string,
    fingerprint: string,
  ): StageCommandRead {
    if (owner.version !== expected) return fail("STAGE_VERSION_CONFLICT");
    const now = new Date().toISOString();
    const project: ProjectRead = { ...owner, stage_id: resulting, version: owner.version + 1, updated_at: now };
    const confirmation: StageConfirmationRead = {
      ...fields,
      id: crypto.randomUUID(),
      project_id: owner.id,
      sequence: of(owner.id).length + 1,
      stage_name: nameOf(list, fields.stage_id),
      resulting_stage_name: nameOf(list, fields.resulting_stage_id),
      revoked_by_id: null,
      project_version_after: project.version,
      created_at: now,
    };
    const result = parseDto("StageCommandRead", { confirmation, project });
    deps.saveProject(project);
    records.push({ ...clone(confirmation), command_id: commandId, fingerprint, result: clone(result) });
    return clone(result);
  }
  return {
    async progress(projectId, signal) {
      await deps.before(signal);
      const owner = deps.project(projectId);
      const [document, tasks, materials] = await Promise.all([currentDocument(owner.id, signal), allTasks(owner.id, signal), allMaterials(owner.id, signal)]);
      const candidates = tasks.filter(usable);
      const latest = revocable(owner);
      const common = {
        project_id: owner.id,
        project_version: owner.version,
        stage_id: owner.stage_id,
        document: document ? { document_id: document.id, version: document.version } : null,
        evidence_candidates: candidates.map((task) => ({ task_id: task.id, version: task.version, title: task.content.title })),
        revocable_id: latest?.id ?? null,
      };
      if (!owner.flow_version_id)
        return parseDto("StageProgressRead", {
          ...common,
          binding: "unbound",
          flow_id: null,
          flow_version_id: null,
          flow_version: null,
          flow_name: null,
          stages: [],
          current: null,
        });
      const snapshot = deps.flowVersion(owner.flow_version_id);
      if (!snapshot) return fail("STAGE_INVALID", 422);
      const list = stages(snapshot.id);
      const enabled = list.filter((stage) => stage.enabled);
      const confirmed = active(owner.id, owner.flow_version_id);
      const current = enabled.find((stage) => stage.id === owner.stage_id);
      const revoked = revokedBy(owner.id);
      const entered =
        current &&
        [...of(owner.id)]
          .reverse()
          .find((row) => row.kind === "confirm" && !revoked.has(row.id) && row.flow_version_id === owner.flow_version_id && row.next_stage_id === current.id);
      const prerequisites = (current?.dependencies ?? []).map((id) => ({ stage_id: id, name: nameOf(list, id), confirmed: confirmed.has(id) }));
      return parseDto("StageProgressRead", {
        ...common,
        binding: current ? "ready" : "invalid",
        flow_id: snapshot.flow_id,
        flow_version_id: snapshot.id,
        flow_version: snapshot.version,
        flow_name: snapshot.name,
        stages: enabled.map((stage) => ({
          id: stage.id,
          name: stage.name,
          state: stage.id === current?.id ? "current" : confirmed.has(stage.id) ? "confirmed" : "upcoming",
          start: stage.start ?? null,
          deadline: stage.deadline ?? null,
          confirmation_id: confirmed.get(stage.id)?.id ?? null,
        })),
        current: current
          ? {
              stage: current,
              confirmed: confirmed.has(current.id),
              confirmation_id: confirmed.get(current.id)?.id ?? null,
              entered_at: entered?.created_at ?? null,
              prerequisites,
              prerequisites_met: prerequisites.every((item) => item.confirmed),
              deliverables: deliverables(current, candidates, materials),
              next_stages: nextOptions(enabled, current.id, new Set(confirmed.keys())),
            }
          : null,
      });
    },
    async history(projectId, query, signal) {
      await deps.before(signal);
      const owner = deps.project(projectId);
      const { limit, offset } = pageQuery(query);
      const ordered = [...of(owner.id)].reverse();
      return parseDto("StageConfirmationPage", { items: ordered.slice(offset, offset + limit).map(view), total: ordered.length, limit, offset });
    },
    async confirm(projectId, input, signal) {
      await deps.before(signal);
      const data = stageInput("StageConfirm", input);
      const owner = deps.project(projectId);
      const scope = `stage.confirm:${owner.id}`;
      const old = replay(owner.id, data.command_id, "confirm", scope, data);
      if (old) return old;
      if (owner.archived) return fail("STAGE_PROJECT_ARCHIVED");
      if (owner.version !== data.expected_project_version) return fail("STAGE_VERSION_CONFLICT");
      if (!owner.flow_version_id || !owner.stage_id) return fail("STAGE_FLOW_REQUIRED");
      if (owner.flow_version_id !== data.flow_version_id || owner.stage_id !== data.stage_id) return fail("STAGE_NOT_CURRENT");
      const list = stages(owner.flow_version_id);
      const enabled = list.filter((stage) => stage.enabled);
      const stage = enabled.find((item) => item.id === data.stage_id) ?? fail("STAGE_INVALID", 422);
      const confirmed = active(owner.id, owner.flow_version_id);
      if (confirmed.has(stage.id)) return fail("STAGE_ALREADY_CONFIRMED");
      if ((stage.dependencies ?? []).some((id) => !confirmed.has(id))) return fail("STAGE_PREREQUISITE_UNCONFIRMED");
      const options = nextOptions(enabled, stage.id, new Set(confirmed.keys()));
      const next = data.next_stage_id ?? null;
      if ((next === null && options.length) || (next !== null && !options.some((item) => item.id === next))) return fail("STAGE_NEXT_INVALID", 422);
      const document = await currentDocument(owner.id, signal);
      if ((document?.version ?? null) !== (data.document_version ?? null)) return fail("STAGE_DOCUMENT_STALE");
      const evidence = [];
      for (const ref of data.evidence ?? []) {
        let task: TaskRead;
        try {
          task = await deps.tasks.get(owner.id, ref.task_id, signal);
        } catch {
          return fail("STAGE_EVIDENCE_INVALID", 422);
        }
        if (task.status !== "confirmed" || task.content.archived) return fail("STAGE_EVIDENCE_INVALID", 422);
        if (task.version !== ref.version || task.needs_review) return fail("STAGE_EVIDENCE_STALE");
        evidence.push({ task_id: task.id, version: task.version, title: task.content.title });
      }
      // Re-read after awaits: a concurrent command may have advanced the project meanwhile.
      const latest = deps.project(owner.id);
      const again = replay(owner.id, data.command_id, "confirm", scope, data);
      if (again) return again;
      return append(
        latest,
        data.expected_project_version,
        next ?? stage.id,
        {
          kind: "confirm",
          flow_version_id: owner.flow_version_id,
          stage_id: stage.id,
          next_stage_id: next,
          resulting_stage_id: next ?? stage.id,
          revokes_id: null,
          document_id: document?.id ?? null,
          document_version: document?.version ?? null,
          evidence,
          note: data.note,
        },
        list,
        data.command_id,
        stable([scope, data]),
      );
    },
    async revoke(projectId, confirmationId, input, signal) {
      await deps.before(signal);
      const data = stageInput("StageRevoke", input);
      const owner = deps.project(projectId);
      const id = requireUuid(confirmationId).toLowerCase();
      const scope = `stage.revoke:${owner.id}:${id}`;
      const old = replay(owner.id, data.command_id, "revoke", scope, data);
      if (old) return old;
      if (owner.archived) return fail("STAGE_PROJECT_ARCHIVED");
      const target = of(owner.id).find((row) => row.id === id && row.kind === "confirm") ?? fail("STAGE_CONFIRMATION_NOT_FOUND", 404);
      if (owner.version !== data.expected_project_version) return fail("STAGE_VERSION_CONFLICT");
      if (revocable(owner)?.id !== target.id) return fail("STAGE_REVOKE_CONFLICT");
      return append(
        owner,
        data.expected_project_version,
        target.stage_id,
        {
          kind: "revoke",
          flow_version_id: target.flow_version_id,
          stage_id: target.stage_id,
          next_stage_id: null,
          resulting_stage_id: target.stage_id,
          revokes_id: target.id,
          document_id: null,
          document_version: null,
          evidence: [],
          note: data.note ?? "",
        },
        stages(target.flow_version_id),
        data.command_id,
        stable([scope, data]),
      );
    },
  };
}
