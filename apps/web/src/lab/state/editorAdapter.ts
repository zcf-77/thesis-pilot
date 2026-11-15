import { type Editor, type JSONContent } from "@tiptap/vue-3";
import { DOMParser as ProseMirrorDOMParser, DOMSerializer, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";
import { editorSnapshotSchema } from "./editorSchema.ts";
import { allChecksPass, validateTextPatches, type GuardInput, type TextPatch } from "./writingGuards.ts";
export { StableChapterIds } from "./editorSchema.ts";
type EditorPort = Pick<Editor, "state" | "getJSON" | "schema" | "view">;

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
const MAX_NODES = 100_000;
const invalidSnapshot = () => new Error("文档结构版本、对象或属性不受支持，当前正文保持不变。");
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null);
const keysWithin = (value: Record<string, unknown>, names: string[]) => Object.keys(value).every((key) => names.includes(key));
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const wellFormed = (value: unknown): value is string =>
  typeof value === "string" &&
  !Array.from(value).some((character) => {
    const point = character.codePointAt(0)!;
    return point >= 0xd800 && point <= 0xdfff;
  });
const nullableString = (value: unknown) => value === null || wellFormed(value);
const choice = (value: unknown, values: unknown[]) => values.includes(value);
const safeHref = (value: unknown) =>
  wellFormed(value) &&
  /^(?:https?:\/\/|mailto:|#)/i.test(value) &&
  !Array.from(value).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127);
const attributeRules: Record<string, Record<string, (value: unknown) => boolean>> = {
  heading: {
    level: (value) => integer(value, 1, 6),
    chapterId: (value) => value === null || (wellFormed(value) && value.length > 0 && value.length <= 200),
    templateAlign: (value) => choice(value, [null, "left", "center"]),
    templateWeight: (value) => choice(value, [null, "600", "700"]),
  },
  orderedList: { start: (value) => integer(value, 1, 10000), type: (value) => choice(value, [null, "1", "a", "A", "i", "I"]) },
  codeBlock: { language: nullableString },
  tableCell: {
    colspan: (value) => integer(value, 1, 10000),
    rowspan: (value) => integer(value, 1, 10000),
    colwidth: (value) => value === null || (Array.isArray(value) && value.length > 0 && value.length <= 10000 && value.every((width) => integer(width))),
    align: (value) => choice(value, [null, "left", "center", "right"]),
  },
  link: { href: safeHref, target: nullableString, rel: nullableString, class: nullableString, title: nullableString },
};
attributeRules.tableHeader = attributeRules.tableCell!;

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((item, index) => sameJson(item, right[index]));
  if (!record(left) || !record(right)) return false;
  return (
    Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
  );
}
function normalizedAttributes(kind: string, value: unknown, mark = false): Record<string, unknown> | undefined {
  const spec = (mark ? editorSnapshotSchema.marks[kind] : editorSnapshotSchema.nodes[kind])?.spec.attrs ?? {};
  const input = value === undefined ? {} : value;
  if (!record(input) || !keysWithin(input, Object.keys(spec))) throw invalidSnapshot();
  const attrs: Record<string, unknown> = {};
  for (const [key, definition] of Object.entries(spec)) {
    const selected = Object.hasOwn(input, key) ? input[key] : definition.default;
    if (!attributeRules[kind]?.[key]?.(selected)) throw invalidSnapshot();
    attrs[key] = Array.isArray(selected) ? [...selected] : selected;
  }
  if ((kind === "tableCell" || kind === "tableHeader") && Array.isArray(attrs.colwidth) && attrs.colwidth.length !== attrs.colspan) throw invalidSnapshot();
  return Object.keys(attrs).length ? attrs : undefined;
}
function decodeWithoutLoss(json: JSONContent, schema: Schema): ProseMirrorNode {
  const document = schema.nodeFromJSON(json);
  document.check();
  if (!sameJson(document.toJSON(), json)) throw invalidSnapshot();
  document.descendants((node) => {
    if (node.type.name === "table") {
      const ending = new Map<number, number>();
      let carried = 0;
      let width = 0;
      node.forEach((row, _offset, rowIndex) => {
        carried -= ending.get(rowIndex) ?? 0;
        let rowWidth = carried;
        row.forEach((cell) => {
          const colspan = Number(cell.attrs.colspan);
          const rowspan = Number(cell.attrs.rowspan);
          if (rowIndex + rowspan > node.childCount) throw invalidSnapshot();
          rowWidth += colspan;
          if (rowspan > 1) {
            carried += colspan;
            ending.set(rowIndex + rowspan, (ending.get(rowIndex + rowspan) ?? 0) + colspan);
          }
        });
        width = Math.max(width, rowWidth);
      });
      if (width * node.childCount > MAX_NODES) throw invalidSnapshot();
      const map = TableMap.get(node);
      if (!map.width || map.problems?.length) throw invalidSnapshot();
    }
  });
  return document;
}

/** 补齐已声明的缺省值；不分配身份，也不修改调用方数据。 */
export function canonicalEditorJson(value: unknown): JSONContent {
  let count = 0;
  const ids = new Set<string>();
  const normalize = (input: unknown, depth: number): JSONContent => {
    if (++count > MAX_NODES || depth > 80 || !record(input) || typeof input.type !== "string" || !Object.hasOwn(editorSnapshotSchema.nodes, input.type))
      throw invalidSnapshot();
    const kind = input.type;
    if (!keysWithin(input, kind === "text" ? ["type", "text", "marks"] : ["type", "attrs", "content", "marks"])) throw invalidSnapshot();
    const result: JSONContent = { type: kind };
    if (kind === "text") {
      if (!wellFormed(input.text) || !input.text.length) throw invalidSnapshot();
      result.text = input.text;
    } else {
      const attrs = normalizedAttributes(kind, input.attrs);
      if (attrs) result.attrs = attrs;
      if (kind === "heading" && typeof attrs?.chapterId === "string") {
        if (ids.has(attrs.chapterId)) throw invalidSnapshot();
        ids.add(attrs.chapterId);
      }
      if (input.content !== undefined) {
        if (!Array.isArray(input.content) || input.content.length > MAX_NODES) throw invalidSnapshot();
        if (input.content.length) result.content = input.content.map((child) => normalize(child, depth + 1));
      }
    }
    if (input.marks !== undefined) {
      if (!Array.isArray(input.marks) || input.marks.length > Object.keys(editorSnapshotSchema.marks).length) throw invalidSnapshot();
      const seen = new Set<string>();
      const marks = input.marks.map((mark) => {
        if (
          !record(mark) ||
          !keysWithin(mark, ["type", "attrs"]) ||
          typeof mark.type !== "string" ||
          !Object.hasOwn(editorSnapshotSchema.marks, mark.type) ||
          seen.has(mark.type)
        )
          throw invalidSnapshot();
        seen.add(mark.type);
        const attrs = normalizedAttributes(mark.type, mark.attrs, true);
        return { type: mark.type, ...(attrs ? { attrs } : {}) };
      });
      if (marks.length) result.marks = marks;
    }
    return result;
  };
  const json = normalize(value, 0);
  if (json.type !== "doc") throw invalidSnapshot();
  decodeWithoutLoss(json, editorSnapshotSchema);
  return json;
}

function checkedSnapshot(value: unknown): JSONContent {
  if (
    !record(value) ||
    !keysWithin(value, ["schemaVersion", "json", "chapters"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.chapters) ||
    value.chapters.length > MAX_NODES
  )
    throw invalidSnapshot();
  const ids = new Set<string>();
  for (const chapter of value.chapters) {
    if (
      !record(chapter) ||
      !keysWithin(chapter, ["id", "title", "level", "position", "end", "words"]) ||
      !wellFormed(chapter.id) ||
      !chapter.id.length ||
      chapter.id.length > 200 ||
      ids.has(chapter.id) ||
      !wellFormed(chapter.title) ||
      !integer(chapter.level, 1, 6) ||
      !integer(chapter.position) ||
      !integer(chapter.end, Number(chapter.position)) ||
      !integer(chapter.words)
    )
      throw invalidSnapshot();
    ids.add(chapter.id);
  }
  return canonicalEditorJson(value.json);
}
export function validateEditorSnapshot(value: unknown): value is EditorSnapshot {
  try {
    checkedSnapshot(value);
    return true;
  } catch {
    return false;
  }
}
export function prepareEditorSnapshot(value: unknown, options: { assignMissingChapterIds?: boolean } = {}): EditorSnapshot {
  const json = checkedSnapshot(value);
  if (options.assignMissingChapterIds) {
    const assign = (node: JSONContent) => {
      if (node.type === "heading" && !node.attrs!.chapterId) node.attrs!.chapterId = crypto.randomUUID();
      node.content?.forEach(assign);
    };
    assign(json);
  }
  return { schemaVersion: 1, json, chapters: collectChapters(decodeWithoutLoss(json, editorSnapshotSchema)) };
}

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
  return prepareEditorSnapshot({ schemaVersion: 1, json: editor.getJSON(), chapters: [] });
}
export function loadEditor(editor: EditorPort, snapshot: EditorSnapshot, options: { emitUpdate?: boolean } = {}): EditorSnapshot {
  const prepared = prepareEditorSnapshot(snapshot);
  const document = decodeWithoutLoss(prepared.json, editor.schema);
  document.descendants((node) => {
    if (node.type.name === "heading" && !node.attrs.chapterId) throw new Error("章节身份尚未初始化，请先完成旧稿兼容转换；当前正文保持不变。");
  });
  const transaction = editor.state.tr
    .replaceWith(0, editor.state.doc.content.size, document.content)
    .setMeta("skipTrailingNode", true)
    .setMeta("preventAutolink", true);
  if (options.emitUpdate === false) transaction.setMeta("preventUpdate", true).setMeta("addToHistory", false);
  editor.view.dispatch(transaction);
  return prepared;
}

const htmlAttributes: Record<string, string[]> = {
  p: [],
  blockquote: [],
  ul: [],
  li: [],
  pre: [],
  hr: [],
  br: [],
  tbody: [],
  tr: [],
  colgroup: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  s: [],
  strike: [],
  del: [],
  u: [],
  h1: ["data-chapter-id", "data-template-align", "data-template-weight", "style"],
  ol: ["start", "type"],
  code: ["class"],
  table: ["style"],
  col: ["style"],
  td: ["colspan", "rowspan", "colwidth", "align", "style"],
  span: ["data-ai-lock", "class", "title"],
  a: ["href", "target", "rel", "class", "title"],
};
for (const tag of ["h2", "h3", "h4", "h5", "h6"]) htmlAttributes[tag] = htmlAttributes.h1!;
htmlAttributes.th = htmlAttributes.td!;
const htmlAliases: Record<string, string> = { b: "strong", i: "em", strike: "s", del: "s" };
const inlineHtmlMarks = new Set(["strong", "em", "s", "u", "a", "span", "code"]);
const legacyError = () => new Error("旧稿含不能完整转换的结构或格式，原稿仍保留；请从支持的备份恢复或保留原件另行处理。");

function validateLegacyHtmlTokens(html: string) {
  let offset = 0;
  let count = 0;
  while ((offset = html.indexOf("<", offset)) !== -1) {
    const token = /^<(?:"[^"]*"|'[^']*'|[^>"'])*>/.exec(html.slice(offset));
    if (!token || ++count > MAX_NODES * 2) throw legacyError();
    const start = /^<(\/?)([a-z][a-z\d]*)/i.exec(token[0]);
    if (!start || !Object.hasOwn(htmlAttributes, start[2]!.toLowerCase())) throw legacyError();
    let rest = token[0].slice(start[0].length, -1);
    if (start[1]) {
      if (rest.trim()) throw legacyError();
    } else {
      const seen = new Set<string>();
      while (rest.trim() && rest.trim() !== "/") {
        const attr = /^\s+([a-z_:][a-z\d_:.-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/i.exec(rest);
        if (!attr || seen.has(attr[1]!.toLowerCase()) || !htmlAttributes[start[2]!.toLowerCase()]!.includes(attr[1]!.toLowerCase())) throw legacyError();
        seen.add(attr[1]!.toLowerCase());
        rest = rest.slice(attr[0].length);
      }
    }
    offset += token[0].length;
  }
}

function semanticHtmlAttributes(element: Element): Record<string, string> {
  const tag = element.tagName.toLowerCase();
  const attrs: Record<string, string> = {};
  for (const attribute of element.attributes) {
    if (!htmlAttributes[tag]?.includes(attribute.name)) throw legacyError();
    if (attribute.name !== "style") attrs[attribute.name] = attribute.value;
  }
  if (tag === "span" && attrs["data-ai-lock"] !== "true") throw legacyError();
  if (tag === "code" && attrs.class && !/^language-[^\s]+$/.test(attrs.class)) throw legacyError();
  const style = element.getAttribute("style");
  if (style !== null) {
    const allowed = /^h[1-6]$/.test(tag) ? ["text-align", "font-weight"] : ["td", "th"].includes(tag) ? ["text-align"] : ["width", "min-width"];
    const seen = new Set<string>();
    for (const declaration of style.split(";").filter((part) => part.trim())) {
      const property = /^\s*([a-z-]+)\s*:\s*([^;]+?)\s*$/i.exec(declaration);
      const name = property?.[1]?.toLowerCase();
      if (!property || !name || !allowed.includes(name) || seen.has(name)) throw legacyError();
      seen.add(name);
      const normalized = (element as HTMLElement).style.getPropertyValue(name).trim();
      if (!normalized) throw legacyError();
      attrs[`style:${name}`] = normalized;
    }
  }
  if (tag === "span") {
    if (attrs.class === "write-locked") delete attrs.class;
    if (attrs.title === "AI 锁定；本人仍可手动编辑") delete attrs.title;
  }
  if (tag === "a") {
    if (attrs.target === "_blank") delete attrs.target;
    if (attrs.rel === "noopener noreferrer nofollow") delete attrs.rel;
  }
  if (tag === "ol" && attrs.start === "1") delete attrs.start;
  if (tag === "td" || tag === "th") {
    if (attrs.colspan === "1") delete attrs.colspan;
    if (attrs.rowspan === "1") delete attrs.rowspan;
    if (attrs.align) {
      if (attrs["style:text-align"] && attrs["style:text-align"] !== attrs.align) throw legacyError();
      attrs["style:text-align"] = attrs.align;
      delete attrs.align;
    }
  }
  return Object.fromEntries(Object.entries(attrs).sort(([a], [b]) => a.localeCompare(b)));
}

interface HtmlMeaning {
  tag?: string;
  attrs?: Record<string, string>;
  text?: string;
  marks?: string[];
  content?: HtmlMeaning[];
}
function semanticHtmlChildren(parent: ParentNode, inheritedMarks: string[] = []): HtmlMeaning[] {
  const output: HtmlMeaning[] = [];
  for (const child of parent.childNodes) {
    if (child.nodeType === 3) {
      const text = child.textContent ?? "";
      const parentTag = (parent as Element).tagName?.toLowerCase();
      if (!text || (!text.trim() && (!parentTag || ["ul", "ol", "table", "tbody", "tr", "blockquote"].includes(parentTag)))) continue;
      const marks = [...inheritedMarks].sort();
      const previous = output.at(-1);
      if (previous?.text !== undefined && sameJson(previous.marks, marks)) previous.text += text;
      else output.push({ text, marks });
    } else if (child.nodeType === 1) {
      const element = child as Element;
      const name = element.tagName.toLowerCase();
      const tag = htmlAliases[name] ?? name;
      const attrs = semanticHtmlAttributes(element);
      if (tag === "tbody") output.push(...semanticHtmlChildren(element, inheritedMarks));
      else if (inlineHtmlMarks.has(tag)) output.push(...semanticHtmlChildren(element, [...inheritedMarks, JSON.stringify([tag, attrs])]));
      else
        output.push({
          tag,
          attrs,
          content: semanticHtmlChildren(element, inheritedMarks),
          ...(inheritedMarks.length ? { marks: [...inheritedMarks].sort() } : {}),
        });
    } else throw legacyError();
  }
  return output;
}

/** 显式旧稿转换；调用方保留原 HTML，再持久化返回的结构与新分配的章节身份。 */
export function convertLegacyEditorHtml(html: string): EditorSnapshot {
  if (!wellFormed(html) || typeof document === "undefined") throw legacyError();
  validateLegacyHtmlTokens(html);
  const original = document.createElement("template");
  original.innerHTML = html;
  for (const element of original.content.querySelectorAll("*")) semanticHtmlAttributes(element);
  const parseRoot = original.content.cloneNode(true) as DocumentFragment;
  for (const element of parseRoot.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")) {
    if (element.getAttribute("data-template-weight") === element.style.fontWeight) element.style.removeProperty("font-weight");
  }
  const parsed = ProseMirrorDOMParser.fromSchema(editorSnapshotSchema).parse(parseRoot, { preserveWhitespace: "full" });
  const json = canonicalEditorJson(parsed.toJSON());
  const rendered = document.createElement("template");
  rendered.content.append(DOMSerializer.fromSchema(editorSnapshotSchema).serializeFragment(parsed.content));
  const beforeTables = [...original.content.querySelectorAll("table")];
  const afterTables = [...rendered.content.querySelectorAll("table")];
  if (beforeTables.length !== afterTables.length) throw legacyError();
  for (const [index, table] of beforeTables.entries()) {
    const other = afterTables[index]!;
    if (table.hasAttribute("style") && !sameJson(semanticHtmlAttributes(table), semanticHtmlAttributes(other))) throw legacyError();
    table.removeAttribute("style");
    other.removeAttribute("style");
    const beforeCols = [...table.children].find((element) => element.tagName.toLowerCase() === "colgroup");
    const afterCols = [...other.children].find((element) => element.tagName.toLowerCase() === "colgroup");
    if (beforeCols && (!afterCols || !sameJson(semanticHtmlChildren(beforeCols), semanticHtmlChildren(afterCols)))) throw legacyError();
    beforeCols?.remove();
    afterCols?.remove();
  }
  if (!sameJson(semanticHtmlChildren(original.content), semanticHtmlChildren(rendered.content))) throw legacyError();
  return prepareEditorSnapshot({ schemaVersion: 1, json, chapters: [] }, { assignMissingChapterIds: true });
}

export function applyTextPatches(editor: EditorPort, input: GuardInput): { ok: boolean; checks: ReturnType<typeof validateTextPatches> } {
  const boundary = (position: number) => {
    if (!Number.isInteger(position) || position < 0 || position > editor.state.doc.content.size) return false;
    const resolved = editor.state.doc.resolve(position);
    if (!resolved.parent.isTextblock) return false;
    const before = resolved.parent.textBetween(0, resolved.parentOffset, "\n", "\ufffc");
    const after = resolved.parent.textBetween(resolved.parentOffset, resolved.parent.content.size, "\n", "\ufffc");
    return wellFormed(before) && wellFormed(after);
  };
  const safe = input.patches.every((patch) => boundary(patch.from) && boundary(patch.to) && wellFormed(patch.after));
  const checks = validateTextPatches({ ...input, unsupported: input.unsupported || !safe });
  if (!allChecksPass(checks)) return { ok: false, checks };
  let tr = editor.state.tr;
  for (const p of [...input.patches].sort((a, b) => b.from - a.from)) {
    tr = p.after ? tr.replaceWith(p.from, p.to, editor.schema.text(p.after, editor.state.doc.resolve(p.from).marks())) : tr.delete(p.from, p.to);
  }
  editor.view.dispatch(tr);
  return { ok: true, checks };
}
export function paragraphTextPatches(from: number, before: string, after: string): TextPatch[] {
  return [{ id: "h1", from, to: from + before.length, before, after }];
}
