import type { StageView } from "../../domain/types.ts";
import type { WorkflowRevision, WorkflowStage } from "./settingsState.ts";

export interface ProjectStageProgress {
  stages: StageView[];
  sourceStages: WorkflowStage[];
  currentIndex: number;
  known: boolean;
  issue: string;
}

/** Only the explicitly bound snapshot defines the project's route. */
export function projectStageProgress(
  history: WorkflowRevision[],
  boundVersion: number,
  currentName: string,
  confirmedIds: string[] = [],
): ProjectStageProgress {
  const revision = history.find((item) => item.version === boundVersion);
  const sourceStages = revision?.stages.filter((stage) => stage.enabled) ?? [];
  const currentIndex = sourceStages.findIndex((stage) => stage.name === currentName);
  const issue =
    boundVersion <= 0
      ? "尚未绑定毕设流程"
      : !revision
        ? `流程 v${boundVersion} 的快照不可用`
        : !sourceStages.length
          ? "绑定流程没有启用的阶段"
          : currentIndex < 0
            ? `当前阶段“${currentName || "未设置"}”不在绑定流程中`
            : "";
  return {
    stages: sourceStages.map((stage, index) => ({
      id: stage.id,
      name: stage.name,
      state: currentIndex < 0 ? "upcoming" : index === currentIndex ? "current" : confirmedIds.includes(stage.id) ? "done" : "upcoming",
      date: stage.deadline || undefined,
      note: stage.condition,
    })),
    sourceStages,
    currentIndex,
    known: !issue,
    issue,
  };
}

export interface DeadlineSummary {
  kind: "future" | "today" | "overdue" | "unknown";
  days: number | null;
  label: string;
}

function calendarDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  return time / 86_400_000;
}

/** Calendar days in the user's project timezone, not elapsed 24-hour intervals. */
export function projectDeadlineSummary(deadline: string, now = new Date()): DeadlineSummary {
  const due = calendarDay(deadline);
  if (due === null) return { kind: "unknown", days: null, label: deadline ? "提交日期待核对" : "提交日期未设置" };
  if (!Number.isFinite(now.getTime())) return { kind: "unknown", days: null, label: "当前日期不可用" };
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === name)!.value;
  const today = calendarDay(`${part("year")}-${part("month")}-${part("day")}`)!;
  const days = due - today;
  return {
    kind: days > 0 ? "future" : days < 0 ? "overdue" : "today",
    days,
    label: days > 0 ? `距论文提交 ${days} 天` : days < 0 ? `论文提交已逾期 ${-days} 天` : "今天是论文提交截止日",
  };
}

/** Preserve the saved record; placeholders must not become an invented clock time. */
export function savedClock(savedAt: string): string | undefined {
  const match = savedAt.match(/(?:^|[\sT])(\d{1,2}):(\d{2})(?::\d{2})?(?:$|\s|[.Z+-])/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
  return `${match[1]!.padStart(2, "0")}:${match[2]}`;
}

export interface StageConfirmation {
  id: string;
  stageId: string;
  stageName: string;
  workflowVersion: number;
  documentVersion: number;
  at: string;
  evidenceTaskIds: string[];
  note: string;
}
export interface StageProgressState {
  confirmations: StageConfirmation[];
}

/** A phase's calendar elapsed time is independent of task confirmation or word count. */
export function stageElapsed(start: string | undefined, deadline: string, now = new Date()) {
  const first = calendarDay(start ?? "");
  const last = calendarDay(deadline);
  const remaining = projectDeadlineSummary(deadline, now);
  if (first === null || last === null || last <= first || remaining.days === null)
    return { known: false, percent: 0, elapsed: 0, total: 0, label: "阶段时间待补充" };
  const total = last - first;
  const elapsed = Math.max(0, total - remaining.days);
  return {
    known: true,
    percent: Math.min(100, Math.round((elapsed / total) * 100)),
    elapsed,
    total,
    label: remaining.days < 0 ? `阶段已逾期 ${-remaining.days} 天` : `已用 ${elapsed} / ${total} 天`,
  };
}

/** Only a declared predecessor or explicit confirmation makes a next phase eligible. */
export function availableNextStages(stages: WorkflowStage[], currentId: string, confirmedIds: string[]) {
  const completed = new Set([...confirmedIds, currentId]);
  return stages
    .filter((stage) => stage.enabled && !completed.has(stage.id) && (stage.predecessorId ? completed.has(stage.predecessorId) : !currentId))
    .sort((a, b) => Number(b.predecessorId === currentId) - Number(a.predecessorId === currentId));
}
