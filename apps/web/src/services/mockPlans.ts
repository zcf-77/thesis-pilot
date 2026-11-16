import type {
  ConfigurationProbeConfiguration,
  JobRead,
  PlanAdjustmentRead,
  PlanChange,
  PlanTaskState,
  PlanVersionRead,
  ProjectRead,
  ReminderSettingsRead,
  TaskRead,
} from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { planInput } from "./httpPlans.ts";
import type { JobService, PlanService, ReminderSettingsService, TaskService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

type Range = { start_date: string | null; due_date: string | null };

/** Same date rules as the server (modules/plans/constraints.py) for a whole change set. */
export function planViolations(tasks: PlanTaskState[], changes: Map<string, Range>, deadline: string | null): string[] {
  const final = new Map(tasks.map((task) => [task.task_id, { ...task, ...changes.get(task.task_id) }]));
  const found: string[] = [];
  for (const [id, change] of changes) {
    const task = final.get(id);
    if (!task) {
      found.push("任务不属于本项目。");
      continue;
    }
    const days = [change.start_date, change.due_date].filter((day): day is string => !!day);
    if (task.archived) found.push(`「${task.title}」已归档。`);
    if (task.status === "confirmed") found.push(`「${task.title}」已确认完成。`);
    if (change.start_date && change.due_date && change.start_date > change.due_date) found.push(`「${task.title}」开始晚于预计完成。`);
    if (task.hard_deadline && days.some((day) => day > task.hard_deadline!)) found.push(`「${task.title}」越过硬截止。`);
    if (deadline && days.some((day) => day > deadline)) found.push(`「${task.title}」越过项目截止。`);
    const begin = task.start_date ?? task.due_date;
    for (const dependency of task.depends_on.map((item) => final.get(item))) {
      if (dependency && !dependency.archived && dependency.due_date && begin && dependency.due_date > begin)
        found.push(`「${task.title}」早于前置任务「${dependency.title}」完成。`);
    }
    for (const successor of final.values()) {
      const next = successor.start_date ?? successor.due_date;
      if (successor.depends_on.includes(id) && !successor.archived && task.due_date && next && task.due_date > next)
        found.push(`「${task.title}」晚于后续任务「${successor.title}」开始。`);
    }
  }
  return found;
}

const state = (task: TaskRead): PlanTaskState => ({
  task_id: task.id,
  version: task.version,
  position: task.position,
  title: task.content.title,
  status: task.status,
  archived: task.content.archived ?? false,
  start_date: task.content.start_date ?? null,
  due_date: task.content.due_date ?? null,
  hard_deadline: task.content.hard_deadline ?? null,
  depends_on: [...(task.content.depends_on ?? [])],
});

/**
 * Deterministic in-memory adapter with the HTTP contract. Like the server without credentials,
 * the Mock queue fails every adjustment job and never invents a candidate; manual batch
 * adjustment and plan history behave like the server.
 */
export function createMockPlans(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => ProjectRead,
  tasks: TaskService,
  configuration: (versionId: string) => ConfigurationProbeConfiguration,
  jobs: JobService,
  enqueue: (projectId: string, adjustmentId: string) => JobRead,
): PlanService {
  const versions = new Map<string, PlanVersionRead[]>();
  const adjustments = new Map<string, PlanAdjustmentRead>();
  const commands = new Map<string, { fingerprint: string; result: unknown }>();

  async function allTasks(projectId: string, signal?: AbortSignal) {
    const result: TaskRead[] = [];
    for (let offset = 0; ;) {
      const page = await tasks.list(projectId, { offset, limit: 100 }, signal);
      for (const item of page.items) result.push(await tasks.get(projectId, item.id, signal));
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) return result;
    }
  }
  function remembered<T>(commandId: string, fingerprint: string): T | undefined {
    const previous = commands.get(commandId);
    if (previous && previous.fingerprint !== fingerprint) throw new ApiError("TASK_COMMAND_CONFLICT", { status: 409 });
    return previous ? (structuredClone(previous.result) as T) : undefined;
  }
  async function refresh(value: PlanAdjustmentRead) {
    const job = await jobs.get(value.job_id, undefined, value.project_id);
    Object.assign(value, { status: job.status, state: job.status, error_code: job.error_code, attempt: job.attempt, updated_at: job.updated_at });
    return parseDto("PlanAdjustmentRead", structuredClone(value));
  }
  function find(projectId: string, adjustmentId: string) {
    requireProject(requireUuid(projectId));
    const value = adjustments.get(requireUuid(adjustmentId).toLowerCase());
    if (!value || value.project_id !== projectId.toLowerCase()) throw new ApiError("PLAN_ADJUSTMENT_NOT_FOUND", { status: 404 });
    return value;
  }
  const history = (projectId: string) => versions.get(projectId.toLowerCase()) ?? [];

  return {
    async get(projectId, signal) {
      await before(signal);
      const project = requireProject(requireUuid(projectId));
      const latest = [...adjustments.values()].filter((item) => item.project_id === project.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return parseDto("PlanRead", {
        project_id: project.id,
        plan_version: history(project.id).length,
        deadline: project.deadline ?? null,
        planning_mode: project.planning_mode,
        latest_adjustment_id: latest?.id ?? null,
      });
    },
    async versions(projectId, query, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      const { limit, offset } = pageQuery(query);
      const ordered = [...history(projectId)].reverse();
      return parseDto("PlanVersionPage", structuredClone({ items: ordered.slice(offset, offset + limit), total: ordered.length, limit, offset }));
    },
    async schedule(projectId, input, signal) {
      await before(signal);
      const project = requireProject(requireUuid(projectId));
      const data = planInput("PlanSchedule", input);
      const fingerprint = JSON.stringify({ project: project.id, op: "schedule", data });
      const previous = remembered<PlanVersionRead>(data.command_id, fingerprint);
      if (previous) return previous;
      if (project.archived) throw new ApiError("PLAN_PROJECT_ARCHIVED", { status: 409 });
      const current = await allTasks(project.id, signal);
      const byId = new Map(current.map((task) => [task.id, task]));
      for (const change of data.changes) {
        const task = byId.get(change.task_id);
        if (!task) throw new ApiError("PLAN_TASK_NOT_FOUND", { status: 404 });
        if (task.version !== change.expected_version) throw new ApiError("PLAN_TASK_STALE", { status: 409 });
      }
      const changes = new Map(data.changes.map((item) => [item.task_id, { start_date: item.start_date ?? null, due_date: item.due_date ?? null }]));
      if (planViolations(current.map(state), changes, project.deadline ?? null).length) throw new ApiError("PLAN_CONSTRAINT_VIOLATION", { status: 422 });
      const recorded: PlanChange[] = [];
      for (const change of data.changes) {
        const task = byId.get(change.task_id)!;
        const next = await tasks.update(
          project.id,
          task.id,
          {
            command_id: crypto.randomUUID(),
            expected_version: task.version,
            content: { ...task.content, start_date: change.start_date ?? null, due_date: change.due_date ?? null },
          },
          signal,
        );
        recorded.push({
          task_id: task.id,
          title: task.content.title,
          before: { start_date: task.content.start_date ?? null, due_date: task.content.due_date ?? null },
          after: { start_date: next.content.start_date ?? null, due_date: next.content.due_date ?? null },
          before_version: task.version,
          after_version: next.version,
        });
      }
      const list = history(project.id);
      const value = parseDto("PlanVersionRead", {
        project_id: project.id,
        version: list.length + 1,
        action: "manual",
        reason: data.reason?.trim() || "学生手动调整计划",
        adjustment_id: null,
        changes: recorded,
        tasks: (await allTasks(project.id, signal)).map(state),
        created_at: new Date().toISOString(),
      });
      versions.set(project.id, [...list, value]);
      commands.set(data.command_id, { fingerprint, result: structuredClone(value) });
      return structuredClone(value);
    },
    async createAdjustment(projectId, input, signal) {
      await before(signal);
      const project = requireProject(requireUuid(projectId));
      const data = planInput("PlanAdjustmentCreate", input);
      const fingerprint = JSON.stringify({ project: project.id, op: "create", agent: data.agent_config_version_id });
      const previous = remembered<string>(data.command_id, fingerprint);
      const receipt = async (value: PlanAdjustmentRead) => {
        const adjustment = await refresh(value);
        const { attempts: _attempts, artifacts: _artifacts, ...job } = await jobs.get(value.job_id, undefined, value.project_id);
        return parseDto("PlanAdjustmentReceipt", { adjustment, job });
      };
      if (previous) return receipt(find(project.id, previous));
      if (project.archived) throw new ApiError("PLAN_PROJECT_ARCHIVED", { status: 409 });
      for (const item of adjustments.values()) {
        if (item.project_id !== project.id) continue;
        const current = await refresh(item);
        if (current.status === "queued" || current.status === "running") throw new ApiError("PLAN_ADJUSTMENT_BUSY", { status: 409 });
      }
      const frozen = configuration(data.agent_config_version_id);
      if (frozen.config_kind !== "agent" || frozen.agent?.role !== "progress" || !frozen.model?.capabilities.includes("plan"))
        throw new ApiError("PLAN_AGENT_INVALID", { status: 422 });
      const states = (await allTasks(project.id, signal)).map(state);
      const open = states.filter((item) => !item.archived && item.status !== "confirmed");
      if (!open.length) throw new ApiError("PLAN_NO_OPEN_TASKS", { status: 422 });
      const id = crypto.randomUUID();
      const job = enqueue(project.id, id);
      const value = parseDto("PlanAdjustmentRead", {
        id,
        project_id: project.id,
        job_id: job.id,
        status: job.status,
        state: job.status,
        error_code: null,
        attempt: 0,
        base_plan_version: history(project.id).length,
        agent_config_version_id: data.agent_config_version_id,
        agent_name: "进度智能体",
        config_version_ids: { ...frozen.version_ids },
        deadline: project.deadline ?? null,
        planning_mode: project.planning_mode,
        task_count: states.filter((item) => !item.archived).length,
        requested_model: null,
        response_model: null,
        proposal: null,
        decision: null,
        revert: null,
        created_at: job.created_at,
        updated_at: job.updated_at,
      });
      adjustments.set(id, value);
      commands.set(data.command_id, { fingerprint, result: id });
      return receipt(value);
    },
    async adjustments(projectId, query, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      const { limit, offset } = pageQuery(query);
      const ordered = [...adjustments.values()]
        .filter((item) => item.project_id === projectId.toLowerCase())
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      const items = await Promise.all(ordered.slice(offset, offset + limit).map(refresh));
      return parseDto("PlanAdjustmentPage", { items, total: ordered.length, limit, offset });
    },
    async adjustment(projectId, adjustmentId, signal) {
      await before(signal);
      return refresh(find(projectId, adjustmentId));
    },
    async cancel(projectId, adjustmentId, signal) {
      await before(signal);
      const value = find(projectId, adjustmentId);
      await jobs.cancel(value.job_id, signal, value.project_id);
      return refresh(value);
    },
    async decide(projectId, adjustmentId, input, signal) {
      await before(signal);
      planInput("PlanAdjustmentDecide", input);
      find(projectId, adjustmentId);
      throw new ApiError("PLAN_CANDIDATE_UNAVAILABLE", { status: 409 });
    },
    async revert(projectId, adjustmentId, input, signal) {
      await before(signal);
      planInput("PlanAdjustmentRevert", input);
      find(projectId, adjustmentId);
      throw new ApiError("PLAN_CANDIDATE_UNAVAILABLE", { status: 409 });
    },
  };
}

export function createMockReminderSettings(before: (signal?: AbortSignal) => Promise<void>): ReminderSettingsService {
  let current: ReminderSettingsRead = { version: 0, enabled: true, cooldown_hours: 24, overdue_days: 1, updated_at: null };
  return {
    async get(signal) {
      await before(signal);
      return structuredClone(current);
    },
    async update(input, signal) {
      await before(signal);
      const data = parseDto("ReminderSettingsUpdate", input, true);
      if (data.expected_version !== current.version) throw new ApiError("PLAN_REMINDER_CONFLICT", { status: 409 });
      current = parseDto("ReminderSettingsRead", {
        version: current.version + 1,
        enabled: data.enabled,
        cooldown_hours: data.cooldown_hours,
        overdue_days: data.overdue_days,
        updated_at: new Date().toISOString(),
      });
      return structuredClone(current);
    },
  };
}
