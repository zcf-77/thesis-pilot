import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { CapturedAssistantSelection } from "./assistantDrafts.ts";

export function captureSavedAssistantSelection(
  document: ProseMirrorNode,
  from: number,
  to: number,
  documentId: string,
  version: number,
): CapturedAssistantSelection {
  if (from === 0 && to === document.content.size && document.childCount === 1 && ["paragraph", "heading"].includes(document.firstChild?.type.name ?? "")) {
    from = 1;
    to = document.content.size - 1;
  }
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to <= from || to > document.content.size)
    throw new Error("请在同一段落明确选择非空文字，本轮不自动读取全文。");
  const start = document.resolve(from);
  const end = document.resolve(to);
  if (!start.sameParent(end) || !["paragraph", "heading"].includes(start.parent.type.name))
    throw new Error("本轮仅支持同一段落或标题内的明确选区，请缩小选择范围。");
  const text = document.textBetween(from, to, "", "\uFFFC");
  if (!text.trim()) throw new Error("请明确选择非空文字。");
  return {
    document_id: documentId,
    document_version: version,
    selection: { from, to, text, textblock_path: Array.from({ length: start.depth }, (_, depth) => start.index(depth)) },
  };
}
