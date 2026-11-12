import { Extension, type Editor, type JSONContent } from "@tiptap/vue-3";
import { Plugin } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { allChecksPass, validateTextPatches, type GuardInput, type TextPatch } from "./writingGuards.ts";
type EditorPort = Pick<Editor, "state" | "getJSON" | "schema" | "view"> & { commands: { setContent: (content: JSONContent) => boolean } };

export interface ChapterEntry {
  id: string;
  title: string;
  level: number;
  position: number;
  end: number;
  words: number;
}
export interface EditorSnapshot {
  schemaVersion: 1;
  json: JSONContent;
  chapters: ChapterEntry[];
}
export function validateEditorSnapshot(value: unknown): value is EditorSnapshot {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!record(value) || value.schemaVersion !== 1 || !record(value.json) || value.json.type !== "doc" || !Array.isArray(value.chapters)) return false;
  const types = new Set([
    "doc",
    "paragraph",
    "heading",
    "text",
    "blockquote",
    "bulletList",
    "orderedList",
    "listItem",
    "hardBreak",
    "horizontalRule",
    "codeBlock",
    "table",
    "tableRow",
    "tableCell",
    "tableHeader",
  ]);
  const marks = new Set(["bold", "italic", "strike", "code", "underline", "link", "aiLock"]);
  let count = 0;
  const node = (n: unknown, depth: number): boolean => {
    if (++count > 100_000 || depth > 80 || !record(n) || !types.has(String(n.type))) return false;
    if (n.type === "text" && typeof n.text !== "string") return false;
    if (n.attrs !== undefined && !record(n.attrs)) return false;
    if (record(n.attrs)) {
      if (n.type === "heading" && (!Number.isInteger(n.attrs.level) || Number(n.attrs.level) < 1 || Number(n.attrs.level) > 6)) return false;
      if (n.attrs.chapterId != null && (typeof n.attrs.chapterId !== "string" || n.attrs.chapterId.length > 200)) return false;
      if (n.attrs.templateAlign != null && (typeof n.attrs.templateAlign !== "string" || !["left", "center"].includes(n.attrs.templateAlign))) return false;
      if (n.attrs.templateWeight != null && (typeof n.attrs.templateWeight !== "string" || !["600", "700"].includes(n.attrs.templateWeight))) return false;
      for (const key of ["colspan", "rowspan", "start"])
        if (n.attrs[key] != null && (!Number.isSafeInteger(n.attrs[key]) || Number(n.attrs[key]) < 1 || Number(n.attrs[key]) > 10000)) return false;
    }
    if (
      n.marks !== undefined &&
      (!Array.isArray(n.marks) ||
        !n.marks.every((m) => {
          if (!record(m) || !marks.has(String(m.type))) return false;
          if (m.type !== "link") return true;
          const href = record(m.attrs) ? m.attrs.href : null;
          if (typeof href !== "string") return false;
          for (const character of href) if (character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127) return false;
          return /^(?:https?:\/\/|mailto:|#)/i.test(href);
        }))
    )
      return false;
    return n.content === undefined || (Array.isArray(n.content) && n.content.every((c) => node(c, depth + 1)));
  };
  const ids = new Set<string>();
  return (
    node(value.json, 0) &&
    value.chapters.every((chapter) => {
      if (!record(chapter) || typeof chapter.id !== "string" || ids.has(chapter.id) || typeof chapter.title !== "string") return false;
      ids.add(chapter.id);
      return (
        ["position", "end", "words", "level"].every((key) => Number.isSafeInteger(chapter[key]) && Number(chapter[key]) >= 0) &&
        Number(chapter.level) >= 1 &&
        Number(chapter.level) <= 6 &&
        Number(chapter.end) >= Number(chapter.position)
      );
    })
  );
}
export const StableChapterIds = Extension.create({
  name: "stableChapterIds",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          chapterId: {
            default: null,
            parseHTML: (e: HTMLElement) => e.getAttribute("data-chapter-id"),
            renderHTML: (a: Record<string, unknown>) => (a.chapterId ? { "data-chapter-id": a.chapterId } : {}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const seen = new Set<string>();
          const tr = state.tr;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "heading") return;
            const id = String(node.attrs.chapterId || "");
            if (!id || seen.has(id)) {
              const fresh = crypto.randomUUID();
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, chapterId: fresh });
              seen.add(fresh);
            } else seen.add(id);
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
export function collectChapters(doc?: ProseMirrorNode): ChapterEntry[] {
  if (!doc) return [];
  const rows: ChapterEntry[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "heading")
      rows.push({
        id: String(node.attrs.chapterId || `unassigned-${position}`),
        title: node.textContent,
        level: Number(node.attrs.level),
        position,
        end: doc.content.size,
        words: 0,
      });
  });
  for (const [i, entry] of rows.entries()) {
    entry.end = rows.slice(i + 1).find((next) => next.level <= entry.level)?.position ?? doc.content.size;
    const referencesStart = rows.find((row) => /^(?:\d*[.、\s]*)?参考文献$/.test(row.title.trim()))?.position ?? doc.content.size;
    doc.nodesBetween(entry.position, Math.min(entry.end, Math.max(entry.position, referencesStart)), (node) => {
      if (["heading", "table", "figure"].includes(node.type.name)) return false;
      if (node.isText) for (const character of node.text ?? "") if (!/\s/.test(character)) entry.words += 1;
      return true;
    });
  }
  return rows;
}
export function captureEditor(editor: EditorPort): EditorSnapshot {
  return { schemaVersion: 1, json: editor.getJSON(), chapters: collectChapters(editor.state.doc) };
}
export function loadEditor(editor: EditorPort, snapshot: EditorSnapshot) {
  if (!validateEditorSnapshot(snapshot)) throw new Error("文档结构版本或对象不受支持，当前正文保持不变。");
  editor.schema.nodeFromJSON(snapshot.json).check();
  editor.commands.setContent(snapshot.json);
}
export function applyTextPatches(editor: EditorPort, input: GuardInput): { ok: boolean; checks: ReturnType<typeof validateTextPatches> } {
  const checks = validateTextPatches(input);
  if (!allChecksPass(checks)) return { ok: false, checks };
  let tr = editor.state.tr;
  for (const p of [...input.patches].sort((a, b) => b.from - a.from)) {
    tr = tr.replaceWith(p.from, p.to, editor.schema.text(p.after, editor.state.doc.resolve(p.from).marks()));
  }
  editor.view.dispatch(tr);
  return { ok: true, checks };
}
export function paragraphTextPatches(from: number, before: string, after: string): TextPatch[] {
  return [{ id: "h1", from, to: from + before.length, before, after }];
}
