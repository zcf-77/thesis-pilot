import type { TaskContent, FeedbackContent } from "../../services/index.ts";
import { editorSnapshotSchema } from "../../lab/state/editorSchema.ts";

export type EvidenceDraft = NonNullable<TaskContent["evidence"]>[number];
export interface TaskContentDraft {
  title: string;
  description: string;
  acceptance: string;
  start_date: string | null;
  due_date: string | null;
  hard_deadline: string | null;
  depends_on: string[];
  chapter: { document_id: string; version: number; chapter_id: string } | null;
  evidence: EvidenceDraft[];
  archived: boolean;
  status: "todo" | "doing" | "verify";
}
export function emptyTask(): TaskContentDraft {
  return {
    title: "",
    description: "",
    acceptance: "",
    start_date: null,
    due_date: null,
    hard_deadline: null,
    depends_on: [],
    chapter: null,
    evidence: [],
    archived: false,
    status: "todo",
  };
}
export function normalizeTask(content: TaskContent): TaskContentDraft {
  return { ...emptyTask(), ...copy(content), status: content.status === "doing" || content.status === "verify" ? content.status : "todo" };
}
export type FeedbackDraft = Omit<FeedbackContent, "new_task" | "task_id" | "correction" | "evidence"> & {
  new_task: TaskContentDraft | null;
  task_id: string | null;
  correction: string;
  evidence: EvidenceDraft[];
};
export function normalizeFeedback(content: FeedbackContent): FeedbackDraft {
  return {
    ...copy(content),
    new_task: content.new_task ? normalizeTask(content.new_task) : null,
    task_id: content.task_id ?? null,
    correction: content.correction ?? "",
    evidence: copy(content.evidence ?? []),
  };
}
export interface TextblockChoice {
  path: number[];
  text: string;
  label: string;
  chapterId: string | null;
  position: number;
}
export function documentTextblocks(json: unknown): TextblockChoice[] {
  const output: TextblockChoice[] = [];
  const document = editorSnapshotSchema.nodeFromJSON(json);
  document.descendants((node, position) => {
    if (!["paragraph", "heading"].includes(node.type.name)) return;
    let textOnly = true;
    node.forEach((child) => {
      if (!child.isText) textOnly = false;
    });
    if (!textOnly || !node.textContent) return false;
    const resolved = document.resolve(position + 1);
    const path = Array.from({ length: resolved.depth }, (_, depth) => resolved.index(depth));
    output.push({
      path,
      position: position + 1,
      text: node.textContent,
      label: `${node.type.name === "heading" ? "标题" : "段落"} ${path.join(".")} · ${node.textContent.slice(0, 64)}`,
      chapterId: node.type.name === "heading" ? (node.attrs.chapterId ?? null) : null,
    });
    return false;
  });
  return output;
}
function splitsSurrogate(text: string, offset: number) {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(text[offset]!);
}
export function exactTextRange(text: string, from: number, to: number): { from: number; to: number; text: string } | undefined {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to > text.length ||
    splitsSurrogate(text, from) ||
    splitsSurrogate(text, to)
  )
    return;
  return { from, to, text: text.slice(from, to) };
}
/** Textareas display CRLF/CR as LF; keep references in the immutable original's UTF-16 coordinates. */
export function textareaTextRange(original: string, from: number, to: number) {
  const boundaries = [0];
  for (let index = 0; index < original.length;) {
    index += original[index] === "\r" && original[index + 1] === "\n" ? 2 : 1;
    boundaries.push(index);
  }
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to > boundaries.length - 1) return;
  return exactTextRange(original, boundaries[from]!, boundaries[to]!);
}
export function evidenceLabel(evidence: EvidenceDraft) {
  return evidence.kind === "document"
    ? `正文 v${evidence.version} · 路径 ${evidence.selection.textblock_path.join(".")} · ${evidence.selection.from}–${evidence.selection.to} · ${evidence.selection.text}`
    : `材料 ${evidence.material_id.slice(0, 8)} · 原件 ${evidence.original_id.slice(0, 8)} · 解析 ${evidence.parse_version_id.slice(0, 8)} · ${evidence.anchor_ids.length} 个锚点`;
}
export function taskDraftError(content: TaskContentDraft, taskId?: string) {
  if (!content.title.trim()) return "请填写任务标题。";
  if (!content.acceptance.trim()) return "请填写任务验收条件。";
  if (content.title.length > 200) return "任务标题最多 200 个字符。";
  if (taskId && content.depends_on.includes(taskId)) return "任务不能依赖自身。";
  return "";
}
export function draftKey(sourceKey: string, workspaceId: string, projectId: string, kind: string, id: string) {
  return "thesispilot.task-feedback-draft.v1:" + JSON.stringify([sourceKey, workspaceId, projectId, kind, id]);
}
export function readDraft<T>(key: string): T | undefined {
  const value = localStorage.getItem(key);
  if (value === null) return;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("本机草稿无法读取，已保留原始内容。请勿覆盖浏览器存储。");
  }
}
export function writeDraft(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}
export function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
