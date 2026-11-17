import type { Block, DocsModel, DocsPreviewContext } from "@muffin-office/core/types";
import type { FormatState, ProtectedRange } from "@muffin-office/vue/docs-editor";
import { countText, documentWords } from "../../services/docsContent.ts";
import { deriveChapters, type DocsChapter } from "../editor/docsSnapshot.ts";

export { countText };

/** 目录与状态栏用到的正文结构：章节、全文字数、节点 → 顶层块序号。 */
export interface WritingStructure {
  chapters: DocsChapter[];
  words: number;
  /** 正文中任意节点 ID → 所在顶层块序号。 */
  topOf: Map<string, number>;
}

function collect(block: Block, index: number, into: Map<string, number>) {
  into.set(block.id, index);
  if (block.type === "list")
    for (const item of block.items) {
      into.set(item.id, index);
      for (const child of item.blocks) collect(child, index, into);
    }
  else if (block.type === "table")
    for (const row of block.rows) {
      into.set(row.id, index);
      for (const cell of row.cells) {
        into.set(cell.id, index);
        for (const child of cell.blocks) collect(child, index, into);
      }
    }
  else if (block.type === "quote" || block.type === "container") for (const child of block.blocks) collect(child, index, into);
}

export function readStructure(model: DocsModel): WritingStructure {
  const topOf = new Map<string, number>();
  let index = 0;
  for (const section of model.sections) for (const block of section.blocks) collect(block, index++, topOf);
  return { chapters: deriveChapters(model), words: documentWords(model as unknown as Parameters<typeof documentWords>[0]), topOf };
}

/** 光标所在的最近一个标题（章节或小节）。 */
export function chapterAt(structure: WritingStructure, node: string | undefined): DocsChapter | undefined {
  if (!node) return undefined;
  const index = structure.topOf.get(node);
  if (index === undefined) return undefined;
  let found: DocsChapter | undefined;
  for (const chapter of structure.chapters) {
    if (chapter.block > index) break;
    found = chapter;
  }
  return found;
}

/** 目录行：层级缩进相对最浅一级计算，避免只有二级标题时整体右移。 */
export function outlineRows(chapters: readonly DocsChapter[]) {
  const top = chapters.reduce((min, chapter) => Math.min(min, chapter.level), 6);
  return chapters.map((chapter) => ({ ...chapter, depth: Math.min(3, chapter.level - top) }));
}

const STYLE_LABELS: Record<string, string> = {
  Normal: "正文",
  BodyText: "正文",
  Body: "正文",
  Caption: "题注",
  Title: "文档标题",
  Subtitle: "副标题",
  Quote: "引用",
  IntenseQuote: "强调引用",
  ListParagraph: "列表段落",
  NoSpacing: "无间距",
  TOCHeading: "目录标题",
  FootnoteText: "脚注文字",
  Bibliography: "参考文献",
};

export type StyleValue = "p" | `h${1 | 2 | 3 | 4 | 5 | 6}` | `s:${string}`;
export interface StyleOption {
  value: StyleValue;
  label: string;
}

const headingStyle = /^(heading|标题)\s*\d$/i;

/** 段落样式选项：正文、标题 1—3（光标在更深标题时追加该级），以及主题中可用的其他段落样式。 */
export function styleOptions(context: DocsPreviewContext | undefined, format: FormatState | null): StyleOption[] {
  const options: StyleOption[] = [
    { value: "p", label: "正文" },
    { value: "h1", label: "标题 1" },
    { value: "h2", label: "标题 2" },
    { value: "h3", label: "标题 3" },
  ];
  const level = format?.heading;
  if (typeof level === "number" && level > 3) options.push({ value: `h${level as 4 | 5 | 6}`, label: `标题 ${level}` });
  if (!context) return options;
  const body = context.docs.bodyStyle;
  const headings = new Set(context.docs.headingStyles ?? []);
  for (const name of Object.keys(context.styles).sort()) {
    if (name === body || headings.has(name) || headingStyle.test(name) || STYLE_LABELS[name] === "正文") continue;
    options.push({ value: `s:${name}`, label: STYLE_LABELS[name] ?? name });
  }
  if (typeof format?.style === "string" && format.style !== "mixed" && !options.some((option) => option.value === `s:${format.style}`)) {
    const name = format.style;
    if (name !== body && !headings.has(name) && !headingStyle.test(name)) options.push({ value: `s:${name}`, label: STYLE_LABELS[name] ?? name });
  }
  return options;
}

/** 当前段落样式；多段混合时为 undefined（下拉显示占位）。 */
export function styleValue(context: DocsPreviewContext | undefined, format: FormatState | null): StyleValue | undefined {
  if (!format || format.heading === "mixed" || format.style === "mixed") return undefined;
  if (format.heading > 0) return `h${format.heading as 1 | 2 | 3 | 4 | 5 | 6}`;
  const style = format.style;
  if (!style || style === context?.docs.bodyStyle || STYLE_LABELS[style] === "正文") return "p";
  return `s:${style}`;
}

/** 选区与锁定保护的关系：选区（单段）落在某个锁定内时返回该锁定。 */
export function lockAt(ranges: readonly ProtectedRange[], node: string, start: number, end: number): ProtectedRange | undefined {
  return ranges.find((range) => {
    if (range.kind !== "lock" || range.anchor.node !== node) return false;
    const from = range.anchor.start;
    const to = range.anchor.end;
    if (from === undefined || to === undefined) return true;
    return start < to && end > from ? true : start === end && start >= from && start <= to;
  });
}
