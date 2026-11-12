import type { EvidenceView, TaskStatus, TaskView } from "../../domain/types.ts";
import { usePreviewModule, usePreviewWorkspaceStore } from "./previewWorkspace.ts";
import { localDate, suggestPlan } from "../services/planService.ts";

export interface PlanEvidence extends EvidenceView {
  archived?: boolean;
  route?: string;
  materialId?: string;
}
export interface PlanTask extends Omit<TaskView, "evidence"> {
  start: string;
  deadline: string;
  dependencies: string[];
  evidence: PlanEvidence[];
  history: PlanHistory[];
  feedbackId?: string;
  feedbackIds?: string[];
}
export interface PlanHistory {
  id: string;
  at: string;
  summary: string;
  version: number;
  snapshot?: { id: string; title: string; start: string; deadline: string; status: TaskStatus; dependencies: string[] }[];
}
export interface PlanChange {
  id: string;
  start: string;
  deadline: string;
  previousStart: string;
  previousDeadline: string;
}
export interface PlanCandidate {
  baseVersion: number;
  changes: PlanChange[];
  status: "pending" | "adopted" | "rejected" | "expired" | "undone";
  resultVersion?: number;
  reasons?: string[];
  errors?: string[];
  input?: { at: string; planning: string; hardDeadline: string; taskIds: string[] };
}
export interface PlanState {
  version: number;
  tasks: PlanTask[];
  history: PlanHistory[];
  candidate: PlanCandidate | null;
  planningMode: "none" | "personal";
  planning: string;
  generation?: { id: string; status: "running" | "failed" | "cancelled" | "done"; error: string; baseVersion: number };
}
export type TaskDraft = Pick<PlanTask, "id" | "title" | "acceptance" | "start" | "deadline" | "chapter" | "dependencies" | "hardDeadline"> & {
  baseVersion?: number;
};
const now = () => new Date().toLocaleString("zh-CN");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function history(state: PlanState, summary: string, task?: PlanTask) {
  const record: PlanHistory = {
    id: crypto.randomUUID(),
    at: now(),
    summary,
    version: state.version,
    snapshot: state.tasks.map((item) => ({
      id: item.id,
      title: item.title,
      start: item.start,
      deadline: item.deadline,
      status: item.status,
      dependencies: [...item.dependencies],
    })),
  };
  state.history.unshift(record);
  if (task) task.history.unshift(record);
}
export function createPlanState(empty = false): PlanState {
  const task = (
    id: string,
    title: string,
    status: TaskStatus,
    start: string,
    deadline: string,
    dependencies: string[],
    chapter: string,
    evidence: PlanEvidence[] = [],
  ): PlanTask => ({
    id,
    title,
    status,
    start,
    deadline,
    dependencies,
    chapter,
    acceptance: "核对章节内容、实际产物及引用依据，保留对应版本。",
    evidence,
    history: [],
  });
  return {
    version: empty ? 1 : 4,
    planningMode: "none",
    planning: "",
    history: [],
    candidate: null,
    tasks: empty
      ? []
      : [
          task("t1", "完成第 3 章「系统设计」初稿", "verify", "2026-11-12", "2026-11-14", ["t2"], "第 3 章", [
            { id: "e1", kind: "document", label: "正文", version: 13, route: "/screens/write?chapter=第 3 章" },
            { id: "e2", kind: "file", label: "系统架构图.png", version: 2, route: "/screens/library" },
          ]),
          task("t2", "补充协同过滤对比实验", "doing", "2026-11-07", "2026-11-09", [], "3.2 节"),
          task("t6", "完成第 4 章「系统实现」初稿", "todo", "2026-11-15", "2026-11-22", ["t1"], "第 4 章"),
          task("t3", "提交中期检查表", "confirmed", "2026-10-27", "2026-10-30", [], "中期检查", [
            { id: "e3", kind: "file", label: "中期检查表.docx", version: 1, route: "/screens/library" },
          ]),
          task("t4", "第 2 章「相关技术」定稿", "confirmed", "2026-10-31", "2026-11-02", [], "第 2 章", [
            { id: "e4", kind: "document", label: "正文", version: 9, stale: true, route: "/screens/write?chapter=第 2 章" },
          ]),
          task("t5", "整理参考文献", "todo", "2026-11-23", "2026-12-20", ["t6"], "参考文献"),
        ],
  };
}
export function usePlanState() {
  const workspace = usePreviewWorkspaceStore();
  return usePreviewModule("plan", () => {
    const state = createPlanState(!workspace.current.sample);
    state.planning = workspace.current.planning;
    state.planningMode = state.planning.trim() ? "personal" : "none";
    return state;
  });
}
export function savePersonalPlanning(state: PlanState, mode: "none" | "personal", planning: string) {
  const next = mode === "personal" ? planning.trim() : "";
  if (state.planningMode === mode && state.planning === next) return;
  state.planningMode = mode;
  state.planning = next;
  state.version += 1;
  history(state, mode === "personal" ? "学生更新个人规划；旧调整候选需重新生成" : "学生选择不提供个人规划");
}
export function validatePlanState(input: unknown): input is PlanState {
  if (!input || typeof input !== "object") return false;
  const value = input as Partial<PlanState>;
  const validHistory = (items: unknown): boolean =>
    Array.isArray(items) &&
    items.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.at === "string" &&
        typeof item.summary === "string" &&
        Number.isInteger(item.version) &&
        (item.snapshot === undefined ||
          (Array.isArray(item.snapshot) &&
            item.snapshot.every((entry: unknown) => {
              if (!entry || typeof entry !== "object") return false;
              const row = entry as Record<string, unknown>;
              return (
                [row.id, row.title, row.start, row.deadline, row.status].every((value) => typeof value === "string") &&
                typeof row.status === "string" &&
                ["todo", "doing", "verify", "confirmed"].includes(row.status) &&
                Array.isArray(row.dependencies) &&
                row.dependencies.every((value) => typeof value === "string")
              );
            }))),
    );
  if (
    !Number.isInteger(value.version) ||
    (value.version ?? 0) < 1 ||
    !["none", "personal"].includes(value.planningMode ?? "") ||
    typeof value.planning !== "string" ||
    !validHistory(value.history) ||
    !Array.isArray(value.tasks)
  )
    return false;
  if (
    !value.tasks.every(
      (task) =>
        task &&
        typeof task.id === "string" &&
        typeof task.title === "string" &&
        typeof task.start === "string" &&
        typeof task.deadline === "string" &&
        (task.chapter === undefined || typeof task.chapter === "string") &&
        (task.acceptance === undefined || typeof task.acceptance === "string") &&
        (task.hardDeadline === undefined || typeof task.hardDeadline === "boolean") &&
        (task.feedbackId === undefined || typeof task.feedbackId === "string") &&
        (task.feedbackIds === undefined || (Array.isArray(task.feedbackIds) && task.feedbackIds.every((id) => typeof id === "string"))) &&
        (task.confirmedAt === undefined || typeof task.confirmedAt === "string") &&
        ["todo", "doing", "verify", "confirmed"].includes(task.status) &&
        Array.isArray(task.dependencies) &&
        task.dependencies.every((id) => typeof id === "string") &&
        validHistory(task.history) &&
        Array.isArray(task.evidence) &&
        task.evidence.every(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.label === "string" &&
            ["document", "file", "revision"].includes(item.kind) &&
            (item.version === undefined || (Number.isInteger(item.version) && item.version > 0)) &&
            (item.route === undefined || (typeof item.route === "string" && item.route.startsWith("/screens/"))) &&
            (item.materialId === undefined || typeof item.materialId === "string") &&
            (item.stale === undefined || typeof item.stale === "boolean") &&
            (item.archived === undefined || typeof item.archived === "boolean"),
        ),
    )
  )
    return false;
  if (new Set(value.tasks.map((task) => task.id)).size !== value.tasks.length) return false;
  if (
    value.generation &&
    (!["running", "failed", "cancelled", "done"].includes(value.generation.status) ||
      typeof value.generation.id !== "string" ||
      typeof value.generation.error !== "string" ||
      !Number.isInteger(value.generation.baseVersion))
  )
    return false;
  if (validatePlan(value.tasks, "9999-12-31").length) return false;
  if (value.candidate === null) return true;
  const candidate = value.candidate;
  return (
    !!candidate &&
    Number.isInteger(candidate.baseVersion) &&
    (candidate.resultVersion === undefined || Number.isInteger(candidate.resultVersion)) &&
    ["pending", "adopted", "rejected", "expired", "undone"].includes(candidate.status) &&
    (candidate.reasons === undefined || (Array.isArray(candidate.reasons) && candidate.reasons.every((item) => typeof item === "string"))) &&
    (candidate.errors === undefined || (Array.isArray(candidate.errors) && candidate.errors.every((item) => typeof item === "string"))) &&
    (candidate.input === undefined ||
      (candidate.input !== null &&
        typeof candidate.input === "object" &&
        [candidate.input.at, candidate.input.planning, candidate.input.hardDeadline].every((item) => typeof item === "string") &&
        Array.isArray(candidate.input.taskIds) &&
        candidate.input.taskIds.every((id) => typeof id === "string"))) &&
    Array.isArray(candidate.changes) &&
    new Set(candidate.changes.map((change) => change?.id)).size === candidate.changes.length &&
    candidate.changes.every(
      (change) =>
        change &&
        typeof change.id === "string" &&
        value.tasks!.some((task) => task.id === change.id) &&
        [change.start, change.deadline, change.previousStart, change.previousDeadline].every((date) => typeof date === "string"),
    )
  );
}
export function validatePlan(tasks: PlanTask[], hardDeadline: string): string[] {
  const errors: string[] = [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) {
      errors.push("存在循环依赖，请调整前置任务。");
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) if (byId.has(dependency)) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of tasks) {
    if (!task.title.trim()) errors.push("请填写任务目标。");
    if (!task.acceptance?.trim()) errors.push(`「${task.title || "新任务"}」缺少验收条件。`);
    const validDate = (value: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!validDate(task.start) || !validDate(task.deadline)) errors.push(`「${task.title}」请填写有效起止日期。`);
    else if (task.start > task.deadline) errors.push(`「${task.title}」开始日期不能晚于截止日期。`);
    if (task.deadline > hardDeadline) errors.push(`「${task.title}」超过论文硬截止 ${hardDeadline}，当前无可行安排。`);
    for (const id of task.dependencies) {
      const dep = byId.get(id);
      if (!dep) errors.push(`「${task.title}」关联的前置任务不存在。`);
      else if (dep.deadline > task.start) errors.push(`「${task.title}」必须在前置任务「${dep.title}」截止后开始。`);
    }
    visit(task.id);
  }
  return [...new Set(errors)];
}
export function saveTask(state: PlanState, draft: TaskDraft, hardDeadline: string): string[] {
  if (draft.baseVersion !== undefined && draft.baseVersion !== state.version) return ["计划版本已变化，旧编辑稿未覆盖新任务；请取消后重新打开编辑。"];
  const old = state.tasks.find((task) => task.id === draft.id);
  if (old?.hardDeadline && old.deadline !== draft.deadline) return ["该任务设置了固定截止，调整候选和普通编辑不能移动它。"];
  const fields = clone(draft);
  delete fields.baseVersion;
  const updated: PlanTask = { ...(old ?? { status: "todo", evidence: [], history: [] }), ...fields, title: draft.title.trim() };
  if (old?.status === "confirmed") updated.status = "verify";
  const proposed = state.tasks.filter((task) => task.id !== draft.id).concat(updated);
  const errors = validatePlan(proposed, hardDeadline);
  if (errors.length) return errors;
  const index = state.tasks.findIndex((task) => task.id === draft.id);
  if (index < 0) state.tasks.push(updated);
  else state.tasks[index] = updated;
  state.version += 1;
  history(state, old ? "编辑任务与约束" : "新增任务", updated);
  return [];
}
export function addFeedbackTask(
  state: PlanState,
  input: { title: string; chapter?: string; feedbackId: string; acceptance?: string; start?: string },
  hardDeadline: string,
): { ok: true; task: PlanTask } | { ok: false; errors: string[] } {
  const existing = state.tasks.find((task) => task.feedbackId === input.feedbackId || task.feedbackIds?.includes(input.feedbackId));
  if (existing) {
    const errors = validatePlan(state.tasks, hardDeadline);
    return errors.length ? { ok: false, errors } : { ok: true, task: existing };
  }
  const start = input.start ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  if (start > hardDeadline) return { ok: false, errors: ["项目硬截止早于任务开始日期，当前无可行安排；请先核对项目日期。"] };
  const task: PlanTask = {
    id: crypto.randomUUID(),
    title: input.title,
    chapter: input.chapter,
    feedbackId: input.feedbackId,
    feedbackIds: [input.feedbackId],
    acceptance: input.acceptance || "核对导师原文、完成修改并关联实际证据。",
    status: "todo",
    start,
    deadline: hardDeadline,
    dependencies: [],
    evidence: [],
    history: [],
  };
  const errors = validatePlan([...state.tasks, task], hardDeadline);
  if (errors.length) return { ok: false, errors };
  state.tasks.push(task);
  state.version += 1;
  history(state, "学生从反馈采纳创建任务", task);
  return { ok: true, task };
}
export function isStaleEvidence(evidence: PlanEvidence, documentVersion: number, materialVersions: Record<string, number> = {}) {
  return (
    !!evidence.stale ||
    (evidence.kind === "document" && evidence.version !== documentVersion) ||
    (!!evidence.materialId && evidence.version !== materialVersions[evidence.materialId])
  );
}
export function linkFeedbackToTask(state: PlanState, feedbackId: string, taskId?: string) {
  const target = taskId ? state.tasks.find((task) => task.id === taskId) : undefined;
  if (taskId && !target) return "关联任务已不存在，请重新选择。";
  for (const task of state.tasks) {
    const ids = [...new Set([...(task.feedbackIds ?? []), ...(task.feedbackId ? [task.feedbackId] : [])])];
    const next = task === target ? [...new Set([...ids, feedbackId])] : ids.filter((id) => id !== feedbackId);
    if (next.join("|") !== ids.join("|")) {
      task.feedbackIds = next;
      task.feedbackId = next[0];
      state.version += 1;
      history(state, `${task === target ? "关联" : "解除"}反馈 ${feedbackId}；任务完成状态不变`, task);
    }
  }
  return null;
}
export function confirmTask(
  state: PlanState,
  id: string,
  documentVersion: number,
  checked: boolean,
  materialVersions: Record<string, number> = {},
): string | null {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || !checked) return "请先核对任务与证据。";
  if (task.status === "confirmed") return "该任务已确认，无需重复提交。";
  const evidence = task.evidence.filter((item) => !item.archived);
  if (!evidence.length) return "请先关联实际产物版本。";
  if (evidence.some((item) => isStaleEvidence(item, documentVersion, materialVersions))) return "证据对应旧版本，请先复核并关联当前版本。";
  if (task.dependencies.some((dep) => state.tasks.find((item) => item.id === dep)?.status !== "confirmed")) return "前置任务尚未确认完成。";
  if (
    task.dependencies.some((dep) =>
      state.tasks.find((item) => item.id === dep)?.evidence.some((item) => !item.archived && isStaleEvidence(item, documentVersion, materialVersions)),
    )
  )
    return "前置任务的证据已变化，请先复核前置任务。";
  task.status = "confirmed";
  task.confirmedAt = now();
  state.version += 1;
  history(state, "学生核对证据并确认完成", task);
  return null;
}
export function associateDocument(state: PlanState, task: PlanTask, version: number) {
  if (task.status === "confirmed") task.status = "verify";
  for (const item of task.evidence) if (item.kind === "document" && !item.archived) item.archived = true;
  task.evidence.push({
    id: crypto.randomUUID(),
    kind: "document",
    label: task.chapter || "正文",
    version,
    route: "/screens/write?version=" + version + "&chapter=" + encodeURIComponent(task.chapter || ""),
  });
  state.version += 1;
  history(state, `关联正文 v${version}；旧关联保留`, task);
}
export function associateMaterial(state: PlanState, task: PlanTask, material: { id: string; name: string; version: number }) {
  if (task.status === "confirmed") task.status = "verify";
  for (const item of task.evidence) if (item.materialId === material.id && !item.archived) item.archived = true;
  task.evidence.push({
    id: crypto.randomUUID(),
    kind: "file",
    label: material.name,
    version: material.version,
    materialId: material.id,
    route: "/screens/library?material=" + material.id + "&version=" + material.version,
  });
  state.version += 1;
  history(state, `关联资料「${material.name}」v${material.version}；保留旧关联`, task);
}
export function setEvidenceArchived(state: PlanState, task: PlanTask, id: string, archived: boolean) {
  const evidence = task.evidence.find((item) => item.id === id);
  if (!evidence || !!evidence.archived === archived) return;
  evidence.archived = archived;
  if (task.status === "confirmed") task.status = "verify";
  state.version += 1;
  history(state, `${archived ? "解除" : "恢复"}证据关联：${evidence.label} v${evidence.version ?? "未知"}；原件与历史保留`, task);
}
export function changeTaskStatus(state: PlanState, task: PlanTask, status: Exclude<TaskStatus, "confirmed">, reason = "") {
  const rework = task.status === "confirmed";
  if (rework && !reason.trim()) return "请填写返工原因。";
  task.status = status;
  state.version += 1;
  history(state, rework ? `返工：${reason.trim()}` : `更新任务状态：${status === "doing" ? "进行中" : status === "verify" ? "待核验" : "待开始"}`, task);
  return null;
}
export function proposePlan(state: PlanState, hardDeadline = "9999-12-31", today = localDate()): PlanCandidate {
  const result = suggestPlan({ tasks: state.tasks, today, hardDeadline, planning: state.planningMode === "personal" ? state.planning : "" });
  state.candidate = {
    baseVersion: state.version,
    changes: result.changes,
    status: "pending",
    reasons: result.reasons,
    errors: result.errors,
    input: { at: today, planning: state.planning, hardDeadline, taskIds: state.tasks.map((task) => task.id) },
  };
  return state.candidate;
}
export function applyPlan(state: PlanState, hardDeadline: string): string[] {
  const candidate = state.candidate;
  if (!candidate || candidate.status !== "pending") return ["没有可采纳的调整候选。"];
  if (candidate.baseVersion !== state.version) {
    candidate.status = "expired";
    return ["计划版本已变化，请重新生成调整。"];
  }
  if (candidate.errors?.length) return candidate.errors;
  if (!candidate.changes.length) return ["当前没有需要移动的任务；请保留原计划，或先修改任务日期与约束。"];
  const proposed = clone(state.tasks);
  for (const change of candidate.changes) {
    const task = proposed.find((item) => item.id === change.id);
    if (!task) return ["调整关联任务已不存在。"];
    if (task.start !== change.previousStart || task.deadline !== change.previousDeadline) return ["候选的基础任务日期不一致，请重新生成调整。"];
    if (task.hardDeadline && task.deadline !== change.deadline) return ["调整不能移动固定截止任务。"];
    task.start = change.start;
    task.deadline = change.deadline;
  }
  const errors = validatePlan(proposed, hardDeadline);
  if (errors.length) return errors;
  state.tasks = proposed;
  state.version += 1;
  candidate.status = "adopted";
  candidate.resultVersion = state.version;
  history(
    state,
    "学生采纳计划调整，硬截止保持不变；" +
      candidate.changes
        .map(
          (change) =>
            `${state.tasks.find((task) => task.id === change.id)?.title}：${change.previousStart}—${change.previousDeadline} → ${change.start}—${change.deadline}`,
        )
        .join("；"),
  );
  return [];
}
export function undoPlanChange(state: PlanState, hardDeadline: string): string[] {
  const candidate = state.candidate;
  if (!candidate || candidate.status !== "adopted" || candidate.resultVersion !== state.version)
    return ["采纳后计划已变化，不能直接撤销；请对照历史手动调整。"];
  const proposed = clone(state.tasks);
  for (const change of candidate.changes) {
    const task = proposed.find((item) => item.id === change.id);
    if (task) {
      if (task.start !== change.start || task.deadline !== change.deadline) return ["任务日期已变化，不能直接撤销。"];
      task.start = change.previousStart;
      task.deadline = change.previousDeadline;
    }
  }
  const errors = validatePlan(proposed, hardDeadline);
  if (errors.length) return errors;
  state.tasks = proposed;
  state.version += 1;
  candidate.status = "undone";
  history(state, "撤销计划采纳，保留原决定与历史");
  return [];
}
export function moveTask(state: PlanState, id: string, delta: number) {
  const index = state.tasks.findIndex((task) => task.id === id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= state.tasks.length) return;
  const [task] = state.tasks.splice(index, 1);
  state.tasks.splice(next, 0, task!);
  state.version += 1;
  history(state, "调整任务显示顺序，依赖保持不变", task);
}
