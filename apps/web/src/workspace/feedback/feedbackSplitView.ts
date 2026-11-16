import type { FeedbackSplitRead, FeedbackSuggestionRead, SuggestionDecision } from "../../services/contracts/api.generated.ts";
import { ApiError } from "../../services/errors.ts";
import { copy, type FeedbackDraft } from "../tasks/taskFeedbackDraft.ts";

export type SplitStatus = FeedbackSplitRead["status"];

export const isActiveSplit = (split?: Pick<FeedbackSplitRead, "status">) => split?.status === "queued" || split?.status === "running";

export const splitStatusLabel: Record<SplitStatus, string> = {
  queued: "等待整理",
  running: "正在整理原文",
  succeeded: "整理完成",
  failed: "整理未完成",
  cancelled: "已取消整理",
};

/** 失败与取消都不产生建议；文案说明原文保留与可走的下一步。 */
export function splitStatusText(split: Pick<FeedbackSplitRead, "status" | "error_code">) {
  if (split.status === "queued") return "已固定这次原文与整理智能体版本，等待执行。";
  if (split.status === "running") return "正在按原文逐句整理；完成前不会产生任何解释项。";
  if (split.status === "cancelled") return "已取消，没有产生建议或任务。原文保留，可按原输入重试或手动整理。";
  if (split.status === "failed") return `${split.error_code ? new ApiError(split.error_code).message : "整理未完成。"}原文保留，没有产生建议或任务。`;
  return "";
}

/** 材质：待决定为铅笔，过期为旧稿，已采纳为墨，已拒绝为留白。 */
export function suggestionTone(value: Pick<FeedbackSuggestionRead, "state" | "stale">) {
  if (value.state === "adopted") return "tp-ink";
  if (value.state === "rejected") return "tp-ghost";
  return value.stale ? "tp-stale" : "tp-pencil";
}

export const adoptable = (value: Pick<FeedbackSuggestionRead, "state" | "stale">) => value.state === "pending" && !value.stale;

export function splitCounts(split?: FeedbackSplitRead) {
  const values = split?.suggestions ?? [];
  return {
    total: values.length,
    pending: values.filter((value) => value.state === "pending").length,
    adopted: values.filter((value) => value.state === "adopted").length,
    stale: values.filter((value) => value.state === "pending" && value.stale).length,
  };
}

/** 与服务端“原样采纳”一致：学生确认原文范围；歧义保持待明确，不建任务。 */
export function draftFromSuggestion(value: FeedbackSuggestionRead): FeedbackDraft {
  return {
    source_range: copy(value.source_range),
    interpretation: value.interpretation,
    certainty: value.ambiguous || value.certainty === "uncertain" ? "uncertain" : "certain",
    correction: "",
    source_checked: true,
    task_id: null,
    new_task: null,
    evidence: [],
  };
}

export function decision(value: FeedbackSuggestionRead, action: SuggestionDecision["action"], content?: FeedbackDraft): SuggestionDecision {
  return {
    suggestion_id: value.id,
    expected_version: value.version,
    action,
    ...(content ? { content: copy(content) as SuggestionDecision["content"] } : {}),
  };
}

/** 学生决定后新出现的正式解释项；用于刷新反馈索引并定位到第一条。 */
export function adoptedItems(before: FeedbackSplitRead | undefined, after: FeedbackSplitRead) {
  const previous = new Map(before?.suggestions.map((value) => [value.id, value.feedback_item_id]) ?? []);
  return after.suggestions
    .filter((value) => value.state === "adopted" && value.feedback_item_id && previous.get(value.id) !== value.feedback_item_id)
    .map((value) => value.feedback_item_id!);
}

export const suggestionHistoryLabels: Record<string, string> = {
  adopt: "采纳",
  adopt_modified: "修改后采纳",
  reject: "拒绝",
  undo: "撤销决定",
};
