import type { Block, DocsModel, Inline } from "@muffin-office/core/types";
import { inlineLength } from "@muffin-office/vue/docs-anchors";
import type { EditorSnapshot } from "../../lab/state/editorAdapter.ts";

/**
 * 正文快照 schemaVersion 2（存于 document_versions）：MuffinOffice DocsModel + ThesisPilot 保护信息 + 派生章节。
 *
 * - 偏移一律是 Unicode 标量：run 文字每个标量计 1，其余行内对象（换行、制表、图片、域…）各计 1。
 * - 保护区间只能落在段落 / 标题内（带 start/end），或整块（只给 node：任意块、列表项、表格行、单元格）。
 * - 章节由顶层标题块重算，章节 ID = 标题块 id；输入里的 chapters 只校验结构，不作为事实。
 * - 图片字节不进入快照：resources 一律以 uri 引用内容寻址存储。
 * 完整的模型字段约束由内核 validate_project_model 与服务端 JSON Schema 校验，本模块只做 ThesisPilot 不变量。
 */
export const DOCS_SNAPSHOT_SCHEMA_VERSION = 2 as const;
export const PROTECTION_KINDS = ["number", "citation", "formula", "lock", "object", "source"] as const;
export type ProtectionKind = (typeof PROTECTION_KINDS)[number];

export interface ProtectionAnchor {
  node: string;
  /** 段内起点（标量，含）；整块保护省略。 */
  start?: number;
  /** 段内终点（标量，不含）；整块保护省略。 */
  end?: number;
}
export interface DocsProtection {
  id: string;
  kind: ProtectionKind;
  anchor: ProtectionAnchor;
  /** 绑定的业务记录 ID（引用保护为文献记录）。 */
  binding?: string;
}
export interface DocsChapter {
  /** 标题块 id。 */
  id: string;
  level: number;
  /** 标题内 run 文字直接拼接（不去空白、不含行内对象）。 */
  title: string;
  /** 标题在全部节顶层块序列中的序号。 */
  block: number;
  /** 本章结束（不含）：下一个同级或更高级标题的序号，没有则为顶层块总数。 */
  end: number;
  /** 本章正文非空白标量数：不计标题、表格、图片块，止于“参考文献”标题。 */
  words: number;
}
export interface DocsSnapshot {
  schemaVersion: typeof DOCS_SNAPSHOT_SCHEMA_VERSION;
  model: DocsModel;
  protections: DocsProtection[];
  chapters: DocsChapter[];
}
export type AnyDocumentSnapshot = EditorSnapshot | DocsSnapshot;

export const DOCS_SNAPSHOT_LIMITS = { nodes: 100_000, depth: 80, idLength: 200, protections: 100_000, bindingLength: 200 } as const;

export class DocsSnapshotError extends Error {
  /** 违反的具体约束，供排查；不直接展示。 */
  readonly reason: string;

  constructor(reason: string) {
    super("正文快照的结构不受支持，没有载入。当前正文保持不变；请恢复其他历史版本或联系维护者。");
    this.name = "DocsSnapshotError";
    this.reason = reason;
  }
}

/** 节点索引：正文（各节正文块、列表项、表格行与单元格）的 ID → 种类与段内文字长度。 */
export interface ModelNode {
  kind: "block" | "item" | "row" | "cell";
  /** 块类型（kind 为 block 时）。 */
  type?: Block["type"];
  /** 段落 / 标题的标量文字长度。 */
  textLength?: number;
  /** 是否位于正文（而非页眉页脚、脚注）。 */
  body: boolean;
}

const BLOCK_TYPES = new Set<string>(["paragraph", "heading", "list", "table", "image", "code_block", "quote", "container", "page_break", "rule", "toc"]);
const INLINE_TYPES = new Set<string>(["run", "break", "tab", "image", "chart", "footnote_ref", "bookmark", "field"]);
const SNAPSHOT_KEYS = ["schemaVersion", "model", "protections", "chapters"];
const PROTECTION_KEYS = ["id", "kind", "anchor", "binding"];
const ANCHOR_KEYS = ["node", "start", "end"];
const CHAPTER_KEYS = ["id", "level", "title", "block", "end", "words"];
/** 与 JavaScript `\s` 相同的空白集合；服务端按同一集合计字。 */
const SPACE = String.raw`\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff`;
const WHITESPACE = new RegExp(`[${SPACE}]`, "u");
const REFERENCES_TITLE = new RegExp(`^[${SPACE}]*(?:\\d*[.、${SPACE}]*)?参考文献[${SPACE}]*$`, "u");

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null);
const keysWithin = (value: Record<string, unknown>, names: readonly string[]) => Object.keys(value).every((key) => names.includes(key));
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
/** 字符串不含孤立代理码元。 */
export function wellFormed(value: unknown): value is string {
  if (typeof value !== "string") return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
const nodeId = (value: unknown): value is string => wellFormed(value) && value.length > 0 && value.length <= DOCS_SNAPSHOT_LIMITS.idLength;

const runText = (inlines: readonly Inline[]) => inlines.map((inline) => (inline.type === "run" ? inline.text : "")).join("");

/** 校验模型的 ThesisPilot 不变量并建立节点索引；不合格时抛出 DocsSnapshotError。 */
export function indexModelNodes(model: unknown): Map<string, ModelNode> {
  if (!record(model) || model.kind !== "docs") throw new DocsSnapshotError("model.kind 必须是 docs");
  if (!nodeId(model.id)) throw new DocsSnapshotError("model.id 无效");
  if (!integer(model.schemaVersion, 1, 1000)) throw new DocsSnapshotError("model.schemaVersion 无效");
  if (!record(model.theme) || typeof model.theme.name !== "string") throw new DocsSnapshotError("model.theme 无效");
  if (!Array.isArray(model.sections)) throw new DocsSnapshotError("model.sections 必须是数组");
  const nodes = new Map<string, ModelNode>();
  let count = 0;
  const claim = (id: unknown, node: ModelNode, where: string) => {
    if (!nodeId(id)) throw new DocsSnapshotError(`${where} 的 id 无效`);
    if (nodes.has(id)) throw new DocsSnapshotError(`节点 id 重复：${id}`);
    if (++count > DOCS_SNAPSHOT_LIMITS.nodes) throw new DocsSnapshotError("节点数量超过上限");
    nodes.set(id, node);
  };
  const inlines = (value: unknown, depth: number, where: string): number => {
    if (!Array.isArray(value)) throw new DocsSnapshotError(`${where}.inlines 必须是数组`);
    if (depth > DOCS_SNAPSHOT_LIMITS.depth) throw new DocsSnapshotError("嵌套层级超过上限");
    let length = 0;
    for (const inline of value) {
      if (!record(inline) || typeof inline.type !== "string" || !INLINE_TYPES.has(inline.type)) throw new DocsSnapshotError(`${where} 含不支持的行内对象`);
      if (inline.type === "run" && !wellFormed(inline.text)) throw new DocsSnapshotError(`${where} 的文字含孤立代理字符`);
      length += inlineLength(inline as Inline);
    }
    return length;
  };
  const blocks = (value: unknown, depth: number, body: boolean, where: string) => {
    if (!Array.isArray(value)) throw new DocsSnapshotError(`${where} 必须是块数组`);
    if (depth > DOCS_SNAPSHOT_LIMITS.depth) throw new DocsSnapshotError("嵌套层级超过上限");
    for (const block of value) {
      if (!record(block) || typeof block.type !== "string" || !BLOCK_TYPES.has(block.type)) throw new DocsSnapshotError(`${where} 含不支持的块`);
      const type = block.type as Block["type"];
      const node: ModelNode = { kind: "block", type, body };
      claim(block.id, node, where);
      const here = `${where}/${String(block.id)}`;
      if (type === "paragraph" || type === "heading") {
        if (type === "heading" && !integer(block.level, 1, 6)) throw new DocsSnapshotError(`${here} 的标题级别无效`);
        node.textLength = inlines(block.inlines, depth + 1, here);
      } else if (type === "list") {
        if (!Array.isArray(block.items)) throw new DocsSnapshotError(`${here}.items 必须是数组`);
        for (const item of block.items) {
          if (!record(item)) throw new DocsSnapshotError(`${here} 的列表项无效`);
          claim(item.id, { kind: "item", body }, here);
          blocks(item.blocks, depth + 1, body, `${here}/${String(item.id)}`);
        }
      } else if (type === "table") {
        if (!Array.isArray(block.rows)) throw new DocsSnapshotError(`${here}.rows 必须是数组`);
        for (const row of block.rows) {
          if (!record(row) || !Array.isArray(row.cells)) throw new DocsSnapshotError(`${here} 的表格行无效`);
          claim(row.id, { kind: "row", body }, here);
          for (const cell of row.cells) {
            if (!record(cell)) throw new DocsSnapshotError(`${here} 的单元格无效`);
            claim(cell.id, { kind: "cell", body }, here);
            blocks(cell.blocks, depth + 1, body, `${here}/${String(cell.id)}`);
          }
        }
        if (block.caption !== undefined) inlines(block.caption, depth + 1, `${here}.caption`);
      } else if (type === "quote" || type === "container") blocks(block.blocks, depth + 1, body, here);
      else if (type === "image") {
        if (typeof block.resource !== "string") throw new DocsSnapshotError(`${here}.resource 无效`);
        if (block.caption !== undefined) inlines(block.caption, depth + 1, `${here}.caption`);
      } else if (type === "code_block" && !wellFormed(block.text)) throw new DocsSnapshotError(`${here}.text 无效`);
    }
  };
  for (const [index, section] of model.sections.entries()) {
    if (!record(section) || !nodeId(section.id)) throw new DocsSnapshotError(`sections[${index}] 无效`);
    blocks(section.blocks, 1, true, `sections[${index}]`);
    for (const part of ["header", "footer"] as const) {
      const value = section[part];
      if (value === undefined) continue;
      if (!record(value)) throw new DocsSnapshotError(`sections[${index}].${part} 无效`);
      for (const key of ["blocks", "firstPage", "evenPage"]) if (value[key] !== undefined) blocks(value[key], 1, false, `sections[${index}].${part}.${key}`);
    }
  }
  if (model.footnotes !== undefined) {
    if (!Array.isArray(model.footnotes)) throw new DocsSnapshotError("footnotes 必须是数组");
    for (const note of model.footnotes) {
      if (!record(note)) throw new DocsSnapshotError("脚注无效");
      blocks(note.blocks, 1, false, `footnotes/${String(note.id)}`);
    }
  }
  if (model.resources !== undefined) {
    if (!Array.isArray(model.resources)) throw new DocsSnapshotError("resources 必须是数组");
    for (const resource of model.resources) {
      if (!record(resource) || !nodeId(resource.id) || !record(resource.data)) throw new DocsSnapshotError("资源条目无效");
      if (resource.data.kind !== "uri" || typeof resource.data.value !== "string" || !resource.data.value)
        throw new DocsSnapshotError(`资源 ${resource.id} 必须以 uri 引用，字节不进入快照`);
    }
  }
  return nodes;
}

function parseProtections(value: unknown, nodes: Map<string, ModelNode>): DocsProtection[] {
  if (!Array.isArray(value)) throw new DocsSnapshotError("protections 必须是数组");
  if (value.length > DOCS_SNAPSHOT_LIMITS.protections) throw new DocsSnapshotError("保护数量超过上限");
  const seen = new Set<string>();
  return value.map((item, index) => {
    const where = `protections[${index}]`;
    if (!record(item) || !keysWithin(item, PROTECTION_KEYS)) throw new DocsSnapshotError(`${where} 含未知字段`);
    if (!nodeId(item.id) || seen.has(item.id)) throw new DocsSnapshotError(`${where} 的 id 无效或重复`);
    seen.add(item.id);
    if (!PROTECTION_KINDS.includes(item.kind as ProtectionKind)) throw new DocsSnapshotError(`${where} 的种类不受支持`);
    if (item.binding !== undefined && !(wellFormed(item.binding) && item.binding.length > 0 && item.binding.length <= DOCS_SNAPSHOT_LIMITS.bindingLength))
      throw new DocsSnapshotError(`${where} 的绑定无效`);
    const anchor = item.anchor;
    if (!record(anchor) || !keysWithin(anchor, ANCHOR_KEYS) || typeof anchor.node !== "string") throw new DocsSnapshotError(`${where} 的锚点无效`);
    const node = nodes.get(anchor.node);
    if (!node?.body) throw new DocsSnapshotError(`${where} 指向不存在的正文节点`);
    const ranged = anchor.start !== undefined || anchor.end !== undefined;
    if (ranged) {
      if (node.textLength === undefined) throw new DocsSnapshotError(`${where} 的区间只能落在段落或标题内`);
      if (!integer(anchor.start) || !integer(anchor.end) || anchor.start >= anchor.end || anchor.end > node.textLength)
        throw new DocsSnapshotError(`${where} 的区间越界或为空`);
    }
    const protection: DocsProtection = {
      id: item.id,
      kind: item.kind as ProtectionKind,
      anchor: ranged ? { node: anchor.node, start: anchor.start as number, end: anchor.end as number } : { node: anchor.node },
    };
    if (item.binding !== undefined) protection.binding = item.binding as string;
    return protection;
  });
}

function checkChapterShape(value: unknown) {
  if (!Array.isArray(value) || value.length > DOCS_SNAPSHOT_LIMITS.nodes) throw new DocsSnapshotError("chapters 必须是数组");
  for (const entry of value)
    if (
      !record(entry) ||
      !keysWithin(entry, CHAPTER_KEYS) ||
      !nodeId(entry.id) ||
      !integer(entry.level, 1, 6) ||
      typeof entry.title !== "string" ||
      !integer(entry.block) ||
      !integer(entry.end) ||
      !integer(entry.words)
    )
      throw new DocsSnapshotError("章节条目结构无效");
}

/** 顶层块的正文非空白标量数（递归列表、引用、容器；不计标题、表格、图片）。 */
function countWords(block: Block): number {
  const count = (text: string) => {
    let n = 0;
    for (const character of text) if (!WHITESPACE.test(character)) n++;
    return n;
  };
  switch (block.type) {
    case "paragraph":
      return count(runText(block.inlines));
    case "code_block":
      return count(block.text);
    case "list":
      return block.items.reduce((sum, item) => sum + item.blocks.reduce((n, child) => n + countWords(child), 0), 0);
    case "quote":
    case "container":
      return block.blocks.reduce((n, child) => n + countWords(child), 0);
    default:
      return 0;
  }
}

/** 由顶层标题块重算章节（服务端按同一规则实现）。 */
export function deriveChapters(model: DocsModel): DocsChapter[] {
  const top = model.sections.flatMap((section) => section.blocks);
  const rows: DocsChapter[] = [];
  top.forEach((block, index) => {
    if (block.type === "heading") rows.push({ id: block.id, level: block.level, title: runText(block.inlines), block: index, end: top.length, words: 0 });
  });
  const references = rows.find((row) => REFERENCES_TITLE.test(row.title))?.block ?? top.length;
  for (const [i, entry] of rows.entries()) {
    entry.end = rows.slice(i + 1).find((next) => next.level <= entry.level)?.block ?? top.length;
    const stop = Math.min(entry.end, Math.max(entry.block, references));
    for (let index = entry.block + 1; index < stop; index++) entry.words += countWords(top[index]);
  }
  return rows;
}

/** 校验 v2 快照并返回规范副本（章节按正文重算）。 */
export function parseDocsSnapshot(value: unknown): DocsSnapshot {
  if (!record(value) || !keysWithin(value, SNAPSHOT_KEYS)) throw new DocsSnapshotError("快照含未知字段");
  if (value.schemaVersion !== DOCS_SNAPSHOT_SCHEMA_VERSION) throw new DocsSnapshotError("schemaVersion 必须是 2");
  const nodes = indexModelNodes(value.model);
  const protections = parseProtections(value.protections, nodes);
  checkChapterShape(value.chapters);
  const model = value.model as unknown as DocsModel;
  return { schemaVersion: DOCS_SNAPSHOT_SCHEMA_VERSION, model, protections, chapters: deriveChapters(model) };
}

/** 由编辑器当前模型与保护生成待保存的快照。 */
export function createDocsSnapshot(model: DocsModel, protections: readonly DocsProtection[]): DocsSnapshot {
  return parseDocsSnapshot({ schemaVersion: DOCS_SNAPSHOT_SCHEMA_VERSION, model, protections, chapters: [] });
}

export function isDocsSnapshot(value: unknown): value is DocsSnapshot {
  try {
    parseDocsSnapshot(value);
    return true;
  } catch {
    return false;
  }
}

/** v1（Tiptap JSON）快照的外形判断；结构校验仍由 editorAdapter.validateEditorSnapshot 负责。 */
export function isLegacySnapshot(value: unknown): value is EditorSnapshot {
  return record(value) && value.schemaVersion === 1 && record(value.json) && value.json.type === "doc" && Array.isArray(value.chapters);
}

/** 快照结构版本：1（Tiptap JSON）、2（DocsModel）；无法识别时为 undefined。 */
export function snapshotSchemaVersion(value: unknown): 1 | 2 | undefined {
  if (!record(value)) return undefined;
  return value.schemaVersion === 1 || value.schemaVersion === 2 ? value.schemaVersion : undefined;
}
