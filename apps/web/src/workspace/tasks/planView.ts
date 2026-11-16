import type { PlanAdjustmentItem, PlanAdjustmentRead, PlanVersionRead, TaskSummary } from "../../services/index.ts";
import type { Tone } from "../../design/tone.ts";

export const WINDOW_DAYS = 14;
const DAY = 86_400_000;

/** ISO calendar arithmetic in UTC so daylight saving never shifts a date. */
export function shiftDate(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
export function dayOffset(start: string, iso: string) {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY);
}
export const shortDay = (iso: string) => iso.slice(5).replace("-", ".");
export const rangeLabel = (start: string | null | undefined, due: string | null | undefined) =>
  start && due ? `${shortDay(start)} — ${shortDay(due)}` : due ? `截止 ${shortDay(due)}` : start ? `${shortDay(start)} 开始` : "未设日期";

export function windowDays(start: string, today: string) {
  return Array.from({ length: WINDOW_DAYS }, (_, index) => {
    const iso = shiftDate(start, index);
    const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return { iso, date: Number(iso.slice(8)), weekend: weekday === 0 || weekday === 6, today: iso === today };
  });
}

type Span = { start: number; end: number; visible: boolean; label: string };
function span(windowStart: string, start: string | null | undefined, due: string | null | undefined): Span | undefined {
  const first = start ?? due;
  const last = due ?? start;
  if (!first || !last) return undefined;
  const from = dayOffset(windowStart, first);
  const to = dayOffset(windowStart, last) + 1;
  return {
    start: Math.max(0, Math.min(WINDOW_DAYS, from)),
    end: Math.max(0, Math.min(WINDOW_DAYS, to)),
    visible: to > 0 && from < WINDOW_DAYS,
    label: rangeLabel(start, due),
  };
}

export interface TimelineRow {
  id: string;
  title: string;
  current?: Span;
  next?: Span;
  /** Offset of the task's own fixed deadline when it falls inside the window. */
  flag?: number;
  hardDeadline?: string | null;
  overdue: boolean;
}

/**
 * Rows for the two-week window. Candidate bars come only from items the server did not block;
 * the formal plan is drawn from the task list and never from the candidate.
 */
export function timelineRows(items: readonly TaskSummary[], windowStart: string, today: string, preview?: readonly PlanAdjustmentItem[]): TimelineRow[] {
  const changes = new Map((preview ?? []).filter((item) => !item.blocked && item.task_id).map((item) => [item.task_id!, item]));
  const rows: TimelineRow[] = [];
  for (const task of items) {
    if (task.archived) continue;
    const current = span(windowStart, task.start_date, task.due_date);
    const change = changes.get(task.id);
    const next = change ? span(windowStart, change.after.start_date, change.after.due_date) : undefined;
    if (!current?.visible && !next?.visible) continue;
    const flagAt = task.hard_deadline ? dayOffset(windowStart, task.hard_deadline) : -1;
    rows.push({
      id: task.id,
      title: task.title,
      current,
      next,
      flag: flagAt >= 0 && flagAt < WINDOW_DAYS ? flagAt : undefined,
      hardDeadline: task.hard_deadline,
      overdue: !!task.due_date && task.due_date < today && task.status !== "confirmed",
    });
  }
  return rows;
}

export function offsetInWindow(windowStart: string, iso: string | null | undefined) {
  if (!iso) return undefined;
  const offset = dayOffset(windowStart, iso);
  return offset >= 0 && offset < WINDOW_DAYS ? offset : undefined;
}

export const planActionLabel: Record<PlanVersionRead["action"], string> = {
  adopt: "采纳计划调整",
  revert: "撤销采纳",
  manual: "手动调整",
};

export type AdjustmentState = PlanAdjustmentRead["state"];
export const adjustmentStatus: Record<AdjustmentState, { label: string; tone: Tone }> = {
  queued: { label: "排队中", tone: "info" },
  running: { label: "生成中", tone: "info" },
  failed: { label: "生成失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "ghost" },
  pending: { label: "等你决定", tone: "pencil" },
  expired: { label: "已过期", tone: "warning" },
  adopted: { label: "已采纳", tone: "seal" },
  kept: { label: "已保留原计划", tone: "neutral" },
  reverted: { label: "已撤销采纳", tone: "neutral" },
};
export const isActiveAdjustment = (value?: PlanAdjustmentRead) => value?.state === "queued" || value?.state === "running";
export const selectableItems = (value?: PlanAdjustmentRead) => value?.proposal?.items.filter((item) => !item.blocked && item.task_id) ?? [];

/** Phrases a candidate's state change for the panel, never claiming more than the server said. */
export function adjustmentSummary(value: PlanAdjustmentRead): string {
  const items = value.proposal?.items ?? [];
  const blocked = items.filter((item) => item.blocked).length;
  switch (value.state) {
    case "queued":
    case "running":
      return `正在依据计划 v${value.base_plan_version} 的 ${value.task_count} 项任务核对依赖与日期…`;
    case "failed":
      return "这次没有生成候选，原计划保持不变。";
    case "cancelled":
      return "已取消生成，原计划保持不变；之后返回的结果不会写入。";
    case "pending":
      return items.length
        ? `${items.length} 项建议，${items.length - blocked} 项可采纳${blocked ? `，${blocked} 项未通过程序检查` : ""}。采纳前，正式计划保持不变。`
        : "当前没有需要移动的任务，可以保留原计划。";
    case "expired":
      return `候选基于计划 v${value.base_plan_version} 时的任务版本；之后任务或截止已变化，不能再采纳。`;
    case "adopted":
      return `已采纳 ${value.decision?.accepted_item_ids.length ?? 0} 项，记入计划 v${value.decision?.plan_version}；硬截止保持不变。`;
    case "kept":
      return "已保留原计划，这份候选不会写入。";
    case "reverted":
      return `已撤销采纳，计划 v${value.revert?.plan_version} 恢复为采纳前的日期。`;
  }
}
