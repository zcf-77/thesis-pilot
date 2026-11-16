import type { Tone } from "../../design/tone.ts";
import type { ScoreDimView } from "../../domain/types.ts";
import type { ReviewIssue, ReviewRead, ReviewReportRead } from "../../services/contracts/api.generated.ts";

export const severityLabel = { major: "严重", minor: "一般", advice: "建议" } as const;

export const reviewStatus: Record<ReviewRead["status"], { label: string; tone: Tone }> = {
  queued: { label: "等待开始", tone: "info" },
  running: { label: "正在评审", tone: "info" },
  succeeded: { label: "报告已生成", tone: "neutral" },
  failed: { label: "评审失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "ghost" },
};

export const isActiveReview = (review?: ReviewRead) => review?.status === "queued" || review?.status === "running";

export function scoreDims(report: ReviewReportRead): ScoreDimView[] {
  return report.content.scores.map((score) => ({
    id: score.dimension_id,
    name: score.name,
    score: score.score,
    full: score.full,
    note: score.reason || undefined,
  }));
}

export function uncheckedItems(report: ReviewReportRead): string[] {
  return report.content.unchecked.map((item) => `${item.item}：${item.reason}`);
}

/** 只陈述服务器核对后的位置；无法映射的保持“无法定位”，不猜测。 */
export function locationLabel(issue: ReviewIssue): string {
  const location = issue.location;
  if (location.status === "unlocated") return "无法定位";
  const chapter = location.chapter_title ?? (location.chapter_id ? "章节" : "正文开头");
  if (location.status === "chapter" || location.block_index === null) return chapter;
  return location.quote ? `${chapter} · “${location.quote}”` : `${chapter} · 第 ${location.block_index + 1} 段`;
}

export function basisLabel(issue: ReviewIssue): string {
  return issue.basis.length ? issue.basis.map((item) => item.label).join("；") : "缺依据";
}

export function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function matchesHistory(review: ReviewRead, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [review.scope_title, formatTime(review.created_at), `v${review.document_version}`, reviewStatus[review.status].label, review.agent_name]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

type Node = { type?: string; text?: string; attrs?: { chapterId?: unknown }; content?: Node[] };
const text = (node: Node): string => (node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(text).join(""));

/** 与服务器同规则：顶层带 chapterId 的标题即可评审的章节。 */
export function chapterOptions(json: unknown): { value: string; label: string }[] {
  const root = json as Node;
  return (root?.content ?? []).flatMap((node) =>
    node.type === "heading" && typeof node.attrs?.chapterId === "string" ? [{ value: node.attrs.chapterId, label: text(node).trim() || "未命名章节" }] : [],
  );
}

export function downloadName(review: ReviewRead, format: "html" | "markdown"): string {
  return `thesispilot-review-v${review.document_version}.${format === "html" ? "html" : "md"}`;
}
