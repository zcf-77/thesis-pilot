import type {
  DocumentEvidence,
  EvidenceSnapshot,
  FeedbackItemSummary,
  FeedbackSummary,
  MaterialEvidence,
  RevisionSelection,
} from "../../services/contracts/api.generated.ts";
import type { EvidenceView } from "../../domain/types.ts";
import { documentTextblocks } from "../tasks/taskFeedbackDraft.ts";

export type FeedbackFilter = "all" | "pending" | "handled";
export type EntryState = "recorded" | "failed" | "processed" | "unclear" | "unchecked" | "missingEvidence" | "staleEvidence" | "archivedTask" | "ready";
export interface InboxEntry {
  key: string;
  kind: "batch" | "item";
  batchId: string;
  itemId?: string;
  number: string;
  date: string;
  title: string;
  summary: string;
  state: EntryState;
  stateLabel: string;
  handled: boolean;
}

const stateLabels: Record<EntryState, string> = {
  recorded: "原文已录入，尚未整理",
  failed: "解释项读取失败",
  processed: "你已标记处理",
  unclear: "待明确理解",
  unchecked: "待核对原文范围",
  missingEvidence: "待补充修改证据",
  staleEvidence: "证据需复核",
  archivedTask: "关联任务已归档",
  ready: "待核对修改证据",
};

export const batchKey = (id: string) => `batch:${id}`;
export const itemKey = (id: string) => `item:${id}`;

export function firstLine(text: string, limit = 28) {
  const line =
    text
      .split(/\r\n|\r|\n/)
      .find((value) => value.trim())
      ?.trim() ?? "";
  const characters = Array.from(line);
  return characters.slice(0, limit).join("") + (characters.length > limit ? "…" : "");
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
export function formatDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function formatTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${formatDate(iso)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function itemState(item: Pick<FeedbackItemSummary, "status" | "review_reasons">): EntryState {
  if (item.status === "processed") return "processed";
  const reasons = item.review_reasons;
  if (reasons.includes("不确定解释尚未纠正")) return "unclear";
  if (reasons.includes("反馈原文尚未人工核对")) return "unchecked";
  if (reasons.includes("缺少处理证据")) return "missingEvidence";
  if (reasons.includes("处理证据版本已变化")) return "staleEvidence";
  if (reasons.includes("关联任务已归档")) return "archivedTask";
  return "ready";
}

/** Merges per-batch item pages into one inbox; numbering follows recording order, display keeps newest batches first. */
export function buildInbox(batches: FeedbackSummary[], items: ReadonlyMap<string, FeedbackItemSummary[]>, failed: ReadonlySet<string> = new Set()) {
  const order = [...batches].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const numbers = new Map(order.map((batch, index) => [batch.id, `F-${pad(index + 1)}`]));
  const entries: InboxEntry[] = [];
  for (const batch of batches) {
    const number = numbers.get(batch.id)!;
    const list = items.get(batch.id) ?? [];
    if (failed.has(batch.id) || !list.length) {
      const state: EntryState = failed.has(batch.id) ? "failed" : "recorded";
      entries.push({
        key: batchKey(batch.id),
        kind: "batch",
        batchId: batch.id,
        number,
        date: formatDate(batch.created_at),
        title: firstLine(batch.preview) || "文字反馈",
        summary: state === "failed" ? `文字录入 · ${batch.item_count} 条解释未读取` : "文字录入 · 尚未拆解",
        state,
        stateLabel: stateLabels[state],
        handled: false,
      });
      continue;
    }
    list.forEach((item, index) => {
      const state = itemState(item);
      entries.push({
        key: itemKey(item.id),
        kind: "item",
        batchId: batch.id,
        itemId: item.id,
        number: `${number}.${index + 1}`,
        date: formatDate(item.updated_at),
        title: firstLine(item.preview) || "人工解释",
        summary: `${item.certainty === "uncertain" ? "有歧义 / 缺材料" : "人工已明确"}${item.task_id ? " · 已关联任务" : ""}`,
        state,
        stateLabel: stateLabels[state],
        handled: state === "processed",
      });
    });
  }
  return entries;
}

export function inboxCounts(entries: InboxEntry[]) {
  return {
    pending: entries.filter((entry) => !entry.handled && entry.state !== "failed").length,
    unclear: entries.filter((entry) => entry.state === "unclear").length,
    handled: entries.filter((entry) => entry.handled).length,
  };
}

export function filterInbox(entries: InboxEntry[], filter: FeedbackFilter) {
  return filter === "all" ? entries : entries.filter((entry) => entry.handled === (filter === "handled"));
}

function shorten(text: string, limit: number) {
  const characters = Array.from(text.replace(/\s+/g, " ").trim());
  return characters.slice(0, limit).join("") + (characters.length > limit ? "…" : "");
}

export function evidenceView(snapshot: EvidenceSnapshot, index: number): EvidenceView {
  const reference = snapshot.reference;
  return reference.kind === "document"
    ? {
        id: `${index}:${snapshot.fingerprint}`,
        kind: "document",
        label: `正文「${shorten(reference.selection.text, 16)}」`,
        version: reference.version,
        stale: !!snapshot.stale,
      }
    : { id: `${index}:${snapshot.fingerprint}`, kind: "file", label: snapshot.label, stale: !!snapshot.stale };
}

export function evidenceExcerpt(snapshots: EvidenceSnapshot[]) {
  return snapshots
    .map((snapshot) =>
      snapshot.reference.kind === "document"
        ? `正文 v${snapshot.reference.version}\n${snapshot.reference.selection.text}`
        : `${snapshot.label}\n${snapshot.reference.anchor_ids.length} 个解析锚点，原件内容请在资料页核对。`,
    )
    .join("\n\n");
}

export function sameEvidence(a: (DocumentEvidence | MaterialEvidence)[] | undefined, b: (DocumentEvidence | MaterialEvidence)[] | undefined) {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/**
 * Re-points a document selection to the current version only when the same textblock path still holds the
 * identical text at the identical in-block offset; otherwise the student must choose the new fragment explicitly.
 */
export function rebaseSelection(oldJson: unknown, currentJson: unknown, selection: RevisionSelection): RevisionSelection | undefined {
  const path = JSON.stringify(selection.textblock_path);
  const before = documentTextblocks(oldJson).find((block) => JSON.stringify(block.path) === path);
  const after = documentTextblocks(currentJson).find((block) => JSON.stringify(block.path) === path);
  if (!before || !after) return;
  const offset = selection.from - before.position;
  const length = selection.to - selection.from;
  if (offset < 0 || length <= 0 || before.text.slice(offset, offset + length) !== selection.text) return;
  if (after.text.slice(offset, offset + length) !== selection.text) return;
  return { textblock_path: [...after.path], from: after.position + offset, to: after.position + offset + length, text: selection.text };
}

export const historyActions: Record<string, string> = {
  create: "人工新增解释",
  edit: "人工纠正",
  processed: "学生标记已处理",
  reopen: "撤销处理声明",
};

/** Deep link from other pages (`?batch=&item=`); unknown or mismatched ids resolve to nothing instead of an error. */
export function resolveFeedbackLink(entries: InboxEntry[], query: { batch?: string; item?: string }) {
  if (query.item) {
    const match = entries.find((entry) => entry.itemId === query.item && (!query.batch || entry.batchId === query.batch));
    if (match) return match.key;
  }
  if (!query.batch) return;
  return (entries.find((entry) => entry.kind === "batch" && entry.batchId === query.batch) ?? entries.find((entry) => entry.batchId === query.batch))?.key;
}
