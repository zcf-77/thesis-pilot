import type { DocsChapter, DocsModel, DocsProtection, DocumentRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";

/**
 * 正文快照 v2 的服务层辅助：Mock 与服务端遵循同一规则（章节派生、保护保持、v1 转换子集）。
 * 偏移一律为 Unicode 标量：run 文字每个标量计 1，其余行内对象各计 1。
 */
export type DocsSnapshotContent = Extract<DocumentRead["content"], { schema_version: 2 }>["json"];
type Json = Record<string, unknown>;
type Block = Json & { type: string; id: string };
type Inline = Json & { type: string };

/** 与 JavaScript `\s` 相同的空白集合（服务端同一集合计字）。 */
const SPACE = String.raw`\t\n\v\f\r    -     　﻿`;
const WHITESPACE = new RegExp(`[${SPACE}]`, "u");
const REFERENCES_TITLE = new RegExp(`^[${SPACE}]*(?:\\d*[.、${SPACE}]*)?参考文献[${SPACE}]*$`, "u");
const OBJECT_ATOM = "￼";
const USER_KINDS = new Set(["lock"]);
const RESOURCE_URI = /^tp-resource:[0-9a-f]{64}$/;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const blocksOf = (value: unknown) => (Array.isArray(value) ? (value as Block[]) : []);
const inlinesOf = (block: Block) => (block.inlines ?? []) as Inline[];
const runText = (inlines: Inline[]) => inlines.map((inline) => (inline.type === "run" ? String(inline.text) : "")).join("");

export function atomText(inlines: Inline[]): string {
  return inlines
    .map((inline) => (inline.type === "run" ? String(inline.text) : inline.type === "break" ? "\n" : inline.type === "tab" ? "\t" : OBJECT_ATOM))
    .join("");
}

function nested(block: Block): Block[][] {
  if (block.type === "quote" || block.type === "container") return [blocksOf(block.blocks)];
  if (block.type === "list") return blocksOf(block.items).map((item) => blocksOf(item.blocks));
  if (block.type === "table") return blocksOf(block.rows).flatMap((row) => blocksOf(row.cells).map((cell) => blocksOf(cell.blocks)));
  return [];
}

/** 文字的非空白标量数（与章节字数同一口径）。 */
export function countText(value: string): number {
  let count = 0;
  for (const character of value) if (!WHITESPACE.test(character)) count++;
  return count;
}

/** 顶层块的正文非空白标量数（递归列表、引用、容器；不计标题、表格、图片）。 */
export function countBlockWords(block: Block): number {
  if (block.type === "paragraph" || block.type === "code_block") return countText(block.type === "paragraph" ? runText(inlinesOf(block)) : String(block.text));
  if (block.type === "list" || block.type === "quote" || block.type === "container")
    return nested(block).reduce((sum, list) => sum + list.reduce((n, child) => n + countBlockWords(child), 0), 0);
  return 0;
}

const topBlocks = (model: DocsModel) => (model.sections as unknown as Json[]).flatMap((section) => blocksOf(section.blocks));

/**
 * 章节：各节顶层标题块（编辑器、Mock 与服务端同一规则，正文快照 v2 唯一的派生来源）。
 * 每章字数为本章正文非空白标量数（不计标题、表格、图片块），止于“参考文献”标题。
 */
export function deriveChapters(model: DocsModel): DocsChapter[] {
  const top = topBlocks(model);
  const rows: DocsChapter[] = [];
  top.forEach((block, index) => {
    if (block.type === "heading")
      rows.push({ id: block.id, level: Number(block.level), title: runText(inlinesOf(block)), block: index, end: top.length, words: 0 });
  });
  const references = rows.find((row) => REFERENCES_TITLE.test(row.title))?.block ?? top.length;
  rows.forEach((row, position) => {
    row.end = rows.slice(position + 1).find((next) => next.level <= row.level)?.block ?? top.length;
    const stop = Math.min(row.end, Math.max(row.block, references));
    for (let index = row.block + 1; index < stop; index++) row.words += countBlockWords(top[index]!);
  });
  return rows;
}

/** 全文正文字数：与章节同一口径（含首个标题之前的正文），止于“参考文献”标题。 */
export function documentWords(model: DocsModel): number {
  let words = 0;
  for (const block of topBlocks(model)) {
    if (block.type === "heading" && REFERENCES_TITLE.test(runText(inlinesOf(block)))) break;
    words += countBlockWords(block);
  }
  return words;
}

type BodyNode = { kind: "block" | "item" | "row" | "cell"; node: Json };

function bodyNodes(model: DocsModel): Map<string, BodyNode> {
  const nodes = new Map<string, BodyNode>();
  const visit = (blocks: Block[]) => {
    for (const block of blocks) {
      nodes.set(block.id, { kind: "block", node: block });
      if (block.type === "list") for (const item of blocksOf(block.items)) nodes.set(item.id, { kind: "item", node: item });
      if (block.type === "table")
        for (const row of blocksOf(block.rows)) {
          nodes.set(row.id, { kind: "row", node: row });
          for (const cell of blocksOf(row.cells)) nodes.set(cell.id, { kind: "cell", node: cell });
        }
      nested(block).forEach(visit);
    }
  };
  for (const section of model.sections as unknown as Json[]) visit(blocksOf(section.blocks));
  return nodes;
}

function plainText(entry: BodyNode): string {
  const block = (value: Block): string => {
    if (value.type === "paragraph" || value.type === "heading")
      return inlinesOf(value)
        .map((inline) =>
          inline.type === "run"
            ? String(inline.text)
            : inline.type === "break"
              ? "\n"
              : inline.type === "tab"
                ? "\t"
                : inline.type === "image"
                  ? text(inline.alt)
                  : "",
        )
        .join("");
    if (value.type === "code_block") return String(value.text);
    if (value.type === "image") return text(value.alt);
    if (value.type === "table")
      return blocksOf(value.rows)
        .map((row) => plainText({ kind: "row", node: row }))
        .join("\n");
    if (value.type === "list")
      return blocksOf(value.items)
        .map((item) => plainText({ kind: "item", node: item }))
        .join("\n");
    if (value.type === "quote" || value.type === "container") return blocksOf(value.blocks).map(block).join("\n");
    return "";
  };
  if (entry.kind === "block") return block(entry.node as Block);
  if (entry.kind === "item") return blocksOf(entry.node.blocks).map(block).join("\n");
  if (entry.kind === "cell") return blocksOf(entry.node.blocks).map(block).join(" ");
  return blocksOf(entry.node.cells)
    .map((cell) => plainText({ kind: "cell", node: cell }))
    .join("\t");
}

function protectedText(nodes: Map<string, BodyNode>, protection: DocsProtection): { text: string; node: Json } {
  const entry = nodes.get(protection.anchor.node);
  if (!entry) throw new ApiError("DOCMODEL_PROTECTION_INVALID", { status: 422 });
  const { start, end } = protection.anchor;
  if (start == null && end == null) return { text: plainText(entry), node: entry.node };
  const block = entry.node as Block;
  if (start == null || end == null || entry.kind !== "block" || (block.type !== "paragraph" && block.type !== "heading"))
    throw new ApiError("DOCMODEL_PROTECTION_INVALID", { status: 422 });
  const text = Array.from(atomText(inlinesOf(block)));
  if (!(start >= 0 && start < end && end <= text.length)) throw new ApiError("DOCMODEL_PROTECTION_INVALID", { status: 422 });
  return { text: text.slice(start, end).join(""), node: block };
}

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item as Json).sort(([a], [b]) => (a < b ? -1 : 1))) : item,
  );

/** 服务端 validate_snapshot 的 Mock 对应：节点 ID 唯一、资源只以 uri 引用、保护可解析，章节重算。 */
export function normalizeSnapshot(snapshot: DocsSnapshotContent): DocsSnapshotContent {
  const model = snapshot.model;
  const ids = new Set<string>([model.id]);
  const claim = (id: string) => {
    if (ids.has(id)) throw new ApiError("DOCMODEL_INVALID", { status: 422 });
    ids.add(id);
  };
  for (const section of model.sections as unknown as Json[]) claim(String(section.id));
  for (const id of bodyNodes(model).keys()) claim(id);
  for (const resource of (model.resources ?? []) as unknown as Json[]) {
    const data = resource.data as Json;
    if (data.kind !== "uri" || !RESOURCE_URI.test(String(data.value))) throw new ApiError("DOCMODEL_INVALID", { status: 422 });
  }
  const nodes = bodyNodes(model);
  const seen = new Set<string>();
  for (const protection of snapshot.protections ?? []) {
    if (seen.has(protection.id)) throw new ApiError("DOCMODEL_PROTECTION_INVALID", { status: 422 });
    seen.add(protection.id);
    protectedText(nodes, protection);
  }
  return { schemaVersion: 2, model, protections: snapshot.protections ?? [], chapters: deriveChapters(model) };
}

/** 服务端 protection_rule_check 的 Mock 对应。 */
export function checkProtections(base: DocsSnapshotContent | null, next: DocsSnapshotContent, userEdit: boolean) {
  const nextItems = new Map((next.protections ?? []).map((item) => [item.id, item]));
  const baseItems = new Map((base?.protections ?? []).map((item) => [item.id, item]));
  for (const [id, item] of nextItems)
    if (!baseItems.has(id) && !(userEdit && USER_KINDS.has(item.kind))) throw new ApiError("DOCMODEL_PROTECTION_FORGED", { status: 422 });
  if (!base) return;
  const before = bodyNodes(base.model);
  const after = bodyNodes(next.model);
  const violated = () => new ApiError("DOCMODEL_PROTECTION_VIOLATED", { status: 409 });
  for (const [id, old] of baseItems) {
    const current = nextItems.get(id);
    if (!current) {
      if (userEdit && USER_KINDS.has(old.kind)) continue;
      throw violated();
    }
    const whole = old.anchor.start == null;
    if (current.kind !== old.kind || current.binding !== old.binding || current.anchor.node !== old.anchor.node || (current.anchor.start == null) !== whole)
      throw violated();
    const was = protectedText(before, old);
    let now: { text: string; node: Json };
    try {
      now = protectedText(after, current);
    } catch {
      throw violated();
    }
    if (now.text !== was.text || (whole && old.kind === "object" && stable(now.node) !== stable(was.node))) throw violated();
  }
}

const ALIGN: Record<string, string> = { left: "start", center: "center", right: "end", justify: "justify" };
const LIST_KINDS: Record<string, string> = { "1": "decimal", a: "lower_alpha", A: "upper_alpha", i: "lower_roman", I: "upper_roman" };
type V1Node = { type: string; attrs?: Json; content?: V1Node[]; text?: string; marks?: { type: string; attrs?: Json }[] };

/** v1（Tiptap JSON）→ v2 的 Mock 转换子集：标题 ID 沿用 chapterId，aiLock → lock/object 保护。 */
export function convertLegacyContent(json: unknown, prefix: string): DocsSnapshotContent {
  const protections: DocsProtection[] = [];
  const id = (path: number[], role = "n") => `${prefix}-${role}-${path.join("-") || "0"}`;
  const inlines = (node: V1Node, path: number[], blockId: string) => {
    const out: Json[] = [];
    let offset = 0;
    let lockStart: number | null = null;
    const locks: [number, number][] = [];
    let allLocked = (node.content ?? []).length > 0;
    for (const child of node.content ?? []) {
      if (child.type === "hardBreak") {
        out.push({ type: "break", kind: "line" });
        if (lockStart !== null) locks.push([lockStart, offset]);
        lockStart = null;
        allLocked = false;
        offset++;
        continue;
      }
      const props: Json = {};
      let locked = false;
      for (const mark of child.marks ?? []) {
        if (mark.type === "aiLock") locked = true;
        else if (mark.type === "underline") props.underline = "single";
        else if (mark.type === "link") props.link = mark.attrs?.title ? { href: mark.attrs.href, title: mark.attrs.title } : { href: mark.attrs?.href };
        else props[mark.type] = true;
      }
      const text = String(child.text ?? "");
      const length = Array.from(text).length;
      if (locked && lockStart === null) lockStart = offset;
      if (!locked && lockStart !== null) {
        locks.push([lockStart, offset]);
        lockStart = null;
      }
      if (!locked) allLocked = false;
      offset += length;
      const last = out.at(-1);
      if (last?.type === "run" && stable(last.props ?? {}) === stable(props)) last.text = String(last.text) + text;
      else out.push(Object.keys(props).length ? { type: "run", text, props } : { type: "run", text });
    }
    if (lockStart !== null) locks.push([lockStart, offset]);
    const text = (node.content ?? []).map((child) => child.text ?? "").join("");
    if (allLocked && text.startsWith("［锁定对象 ")) protections.push({ id: id(path, "object"), kind: "object", anchor: { node: blockId } });
    else for (const [start, end] of locks) protections.push({ id: id([...path, start], "lock"), kind: "lock", anchor: { node: blockId, start, end } });
    return out;
  };
  const blocks = (nodes: V1Node[] | undefined, path: number[]): Json[] => (nodes ?? []).map((node, index) => block(node, [...path, index]));
  const block = (node: V1Node, path: number[]): Json => {
    const attrs = node.attrs ?? {};
    if (node.type === "heading") {
      const blockId = typeof attrs.chapterId === "string" ? attrs.chapterId : id(path);
      const props: Json = {};
      if (attrs.templateAlign) props.align = ALIGN[text(attrs.templateAlign)];
      if (attrs.templateWeight) props.run = { bold: true };
      return { type: "heading", id: blockId, level: attrs.level ?? 1, ...(Object.keys(props).length ? { props } : {}), inlines: inlines(node, path, blockId) };
    }
    const blockId = id(path);
    if (node.type === "paragraph")
      return {
        type: "paragraph",
        id: blockId,
        ...(attrs.alignment ? { props: { align: ALIGN[text(attrs.alignment)] } } : {}),
        inlines: inlines(node, path, blockId),
      };
    if (node.type === "blockquote") return { type: "quote", id: blockId, blocks: blocks(node.content, path) };
    if (node.type === "bulletList" || node.type === "orderedList") {
      const start = Number(attrs.start ?? 1);
      return {
        type: "list",
        id: blockId,
        kind: node.type === "bulletList" ? "bullet" : (LIST_KINDS[text(attrs.type) || "1"] ?? "decimal"),
        ...(node.type === "orderedList" && start !== 1 ? { start } : {}),
        items: (node.content ?? []).map((item, index) => ({ id: id([...path, index], "item"), blocks: blocks(item.content, [...path, index]) })),
      };
    }
    if (node.type === "codeBlock")
      return {
        type: "code_block",
        id: blockId,
        ...(attrs.language ? { lang: attrs.language } : {}),
        text: (node.content ?? []).map((child) => child.text ?? "").join(""),
      };
    if (node.type === "horizontalRule") return { type: "rule", id: blockId };
    if (node.type === "table")
      return {
        type: "table",
        id: blockId,
        rows: (node.content ?? []).map((row, rowIndex) => ({
          id: id([...path, rowIndex], "row"),
          ...((row.content ?? []).length && (row.content ?? []).every((cell) => cell.type === "tableHeader") ? { header: true } : {}),
          cells: (row.content ?? []).map((cell, cellIndex) => {
            const cellAttrs = cell.attrs ?? {};
            return {
              id: id([...path, rowIndex, cellIndex], "cell"),
              ...(Number(cellAttrs.colspan ?? 1) !== 1 ? { colSpan: Number(cellAttrs.colspan) } : {}),
              ...(Number(cellAttrs.rowspan ?? 1) !== 1 ? { rowSpan: Number(cellAttrs.rowspan) } : {}),
              blocks: blocks(cell.content, [...path, rowIndex, cellIndex]),
            };
          }),
        })),
      };
    throw new ApiError("DOCUPGRADE_INVARIANT_FAILED", { status: 422 });
  };
  const content = blocks((json as V1Node).content, []);
  const model = {
    kind: "docs",
    schemaVersion: 1,
    id: `${prefix}-document`,
    theme: { name: "minimal" },
    sections: [{ id: `${prefix}-section-0`, blocks: content }],
  } as unknown as DocsModel;
  return normalizeSnapshot({ schemaVersion: 2, model, protections });
}

/** 图片字节的格式嗅探（与服务端一致：PNG/JPEG/GIF/WebP）。 */
export function sniffImage(bytes: Uint8Array, mime: string): boolean {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (mime === "image/png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mime === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mime === "image/gif") return starts(0x47, 0x49, 0x46, 0x38);
  if (mime === "image/webp") return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return false;
}
