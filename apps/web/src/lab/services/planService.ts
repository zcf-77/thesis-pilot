import type { PlanChange, PlanTask } from "../state/planState.ts";

export interface PlanRequest {
  tasks: PlanTask[];
  today: string;
  hardDeadline: string;
  planning: string;
}
export interface PlanResult {
  changes: PlanChange[];
  reasons: string[];
  errors: string[];
}
const day = 86_400_000;
export const shiftDate = (value: string, days: number) => new Date(Date.parse(value + "T00:00:00Z") + days * day).toISOString().slice(0, 10);
export const localDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });

/** Deterministic Mock scheduler: preserves task duration and all fixed deadlines. */
export function suggestPlan(request: PlanRequest): PlanResult {
  const byId = new Map(request.tasks.map((task) => [task.id, task]));
  const scheduled = new Map<string, { start: string; deadline: string }>();
  const visiting = new Set<string>();
  const errors: string[] = [];
  const changes: PlanChange[] = [];
  function schedule(task: PlanTask) {
    if (scheduled.has(task.id)) return;
    if (visiting.has(task.id)) {
      errors.push("存在循环依赖，无法形成可行安排。");
      return;
    }
    visiting.add(task.id);
    for (const id of task.dependencies) {
      const parent = byId.get(id);
      if (!parent) errors.push(`「${task.title}」的前置任务不存在。`);
      else schedule(parent);
    }
    visiting.delete(task.id);
    if (!Number.isFinite(Date.parse(task.start)) || !Number.isFinite(Date.parse(task.deadline))) {
      errors.push(`「${task.title}」缺少有效起止日期。`);
      return;
    }
    const duration = Math.max(0, Math.round((Date.parse(task.deadline) - Date.parse(task.start)) / day));
    const predecessorEnd = task.dependencies
      .map((id) => scheduled.get(id)?.deadline)
      .filter((value): value is string => !!value)
      .sort()
      .at(-1);
    const minimum = [request.today, task.start, predecessorEnd ? shiftDate(predecessorEnd, 1) : task.start].sort().at(-1)!;
    let start = task.status === "confirmed" ? task.start : minimum;
    let deadline = task.status === "confirmed" ? task.deadline : shiftDate(start, duration);
    if (task.hardDeadline) {
      deadline = task.deadline;
      if (shiftDate(start, duration) > deadline) errors.push(`「${task.title}」无法在固定截止 ${deadline} 前保留原任务时长，请人工调整范围或依赖。`);
      start = task.start;
      if (task.status !== "confirmed" && predecessorEnd && predecessorEnd > start) errors.push(`「${task.title}」与前置任务的固定日期冲突。`);
    }
    if (deadline > request.hardDeadline) errors.push(`「${task.title}」超过论文硬截止 ${request.hardDeadline}，当前无可行安排。`);
    scheduled.set(task.id, { start, deadline });
    if (start !== task.start || deadline !== task.deadline)
      changes.push({ id: task.id, start, deadline, previousStart: task.start, previousDeadline: task.deadline });
  }
  for (const task of request.tasks) schedule(task);
  return {
    changes: errors.length ? [] : changes,
    errors: [...new Set(errors)],
    reasons: [
      `按 ${request.today} 起的可用日期、真实前置依赖和原任务时长模拟计算；已确认任务与固定截止不移动。`,
      request.planning.trim()
        ? `个人规划已随请求保留：${request.planning.trim()}。自由文字尚不转换为可用工时，采纳前请核对个人安排。`
        : "未提供个人规划；不推断每天投入时间或个人效率。",
      "此方案是本地约束计算，不预测实际完成概率；没有可行解时保留原计划。",
    ],
  };
}
