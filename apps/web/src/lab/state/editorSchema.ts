import { Extension, Mark, getSchema } from "@tiptap/vue-3";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";

export const StableChapterIds = Extension.create({
  name: "stableChapterIds",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          chapterId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-chapter-id"),
            renderHTML: (attrs: Record<string, unknown>) => (attrs.chapterId ? { "data-chapter-id": attrs.chapterId } : {}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const seen = new Set<string>();
          const transaction = state.tr;
          state.doc.descendants((node, position) => {
            if (node.type.name !== "heading") return;
            const id = String(node.attrs.chapterId || "");
            if (!id || seen.has(id)) {
              const fresh = crypto.randomUUID();
              transaction.setNodeMarkup(position, undefined, { ...node.attrs, chapterId: fresh });
              seen.add(fresh);
            } else seen.add(id);
          });
          return transaction.docChanged ? transaction : null;
        },
      }),
    ];
  },
});

export const HeadingFormat = Extension.create({
  name: "safeHeadingFormat",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          templateAlign: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-template-align"),
            renderHTML: (attrs: Record<string, unknown>) =>
              ["left", "center"].includes(String(attrs.templateAlign))
                ? { "data-template-align": attrs.templateAlign, style: `text-align:${String(attrs.templateAlign)}` }
                : {},
          },
          templateWeight: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-template-weight"),
            renderHTML: (attrs: Record<string, unknown>) =>
              ["600", "700"].includes(String(attrs.templateWeight))
                ? { "data-template-weight": attrs.templateWeight, style: `font-weight:${String(attrs.templateWeight)}` }
                : {},
          },
        },
      },
    ];
  },
});

export const AiLock = Mark.create({
  name: "aiLock",
  parseHTML: () => [{ tag: 'span[data-ai-lock="true"]' }],
  renderHTML: () => ["span", { "data-ai-lock": "true", class: "write-locked", title: "AI 锁定；本人仍可手动编辑" }, 0],
});

export function createEditorExtensions() {
  return [StarterKit, TableKit.configure({ table: { resizable: false } }), AiLock, StableChapterIds, HeadingFormat];
}

export const editorSnapshotSchema = getSchema(createEditorExtensions());
