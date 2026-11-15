import { Extension, type JSONContent } from "@tiptap/vue-3";
import { Plugin } from "@tiptap/pm/state";
import { canonicalEditorJson } from "../../lab/state/editorAdapter.ts";

export type SourceGuardPolicy =
  | { mode: "loading" | "error" }
  | { mode: "free" }
  | { mode: "source"; baseline: unknown; editablePaths: readonly (readonly number[])[] };
export interface SourceGuardOptions {
  getPolicy: () => SourceGuardPolicy;
  bypass: () => boolean;
  onReject: (message: string) => void;
}
const rejection = "来源保护已阻止这次修改：仅允许编辑已映射的纯文字；锁定内容、未知对象、格式、章节及结构不能更改。";
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function nodeAt(root: JSONContent, path: readonly number[]): JSONContent | undefined {
  let node: JSONContent | undefined = root;
  for (const index of path) {
    if (!Number.isSafeInteger(index) || index < 0) return;
    node = node?.content?.[index];
  }
  return node;
}
function textShape(node: JSONContent): unknown {
  if (!["paragraph", "heading"].includes(node.type ?? "") || node.marks?.some((mark) => mark.type === "aiLock")) throw new Error(rejection);
  const children = node.content ?? [];
  if (children.length > 1 || children.some((child) => child.type !== "text" || child.marks?.some((mark) => mark.type === "aiLock"))) throw new Error(rejection);
  const text = children[0];
  if (!text) return { type: "text" };
  const { text: _text, ...shape } = text;
  return shape;
}

/** Match backend container slots after the shared editor canonicalization. */
export function sourceDocumentEditAllowed(baseline: unknown, candidate: unknown, paths: readonly (readonly number[])[]): boolean {
  try {
    const base = canonicalEditorJson(baseline);
    const next = canonicalEditorJson(candidate);
    const seen = new Set<string>();
    for (const path of paths) {
      if (!path.length) return false;
      const key = JSON.stringify(path);
      if (seen.has(key)) return false;
      seen.add(key);
      const before = nodeAt(base, path);
      const after = nodeAt(next, path);
      if (!before || !after || stable(textShape(before)) !== stable(textShape(after))) return false;
      if (before.content) after.content = JSON.parse(JSON.stringify(before.content)) as JSONContent[];
      else delete after.content;
    }
    return stable(base) === stable(next);
  } catch {
    return false;
  }
}

export function sourceGuardPlugin(options: SourceGuardOptions): Plugin {
  return new Plugin({
    filterTransaction(transaction) {
      if (!transaction.docChanged || options.bypass()) return true;
      const policy = options.getPolicy();
      if (policy.mode === "free") return true;
      if (policy.mode !== "source") {
        options.onReject("正在核对正式稿来源保护，当前暂为只读；请等待来源核对完成或重试读取。");
        return false;
      }
      if (sourceDocumentEditAllowed(policy.baseline, transaction.doc.toJSON(), policy.editablePaths)) return true;
      options.onReject(rejection);
      return false;
    },
  });
}

export function createDocumentSourceGuard(options: SourceGuardOptions) {
  return Extension.create({
    name: "formalDocumentSourceGuard",
    priority: 1000,
    addProseMirrorPlugins() {
      return [sourceGuardPlugin(options)];
    },
  });
}
