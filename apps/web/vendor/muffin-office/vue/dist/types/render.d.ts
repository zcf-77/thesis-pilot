import type { Block, Color, DocsModel, Inline, InlineProps, ListKind, ParaProps, Palette, PlacedParagraph, SlotTextSpec, ThemeFonts } from './types';
/** 1 pt = 12 700 EMU。 */
export declare const EMU_PER_PT = 12700;
type ParaSpacing = NonNullable<ParaProps['spacing']>;
/** 与 office-pptx 写出的 bodyPr lIns/rIns、tIns/bIns 一致。 */
export declare const INSET_X = 91440;
export declare const INSET_Y = 45720;
export declare const DEFAULT_LEVEL_INDENT = 342900;
export declare const LINE_HEIGHT_FACTOR = 1.2;
export declare const PARA_SPACE_RATIO = 0.2;
export declare const DEFAULT_TABLE_SIZE = 1400;
export declare function resolveColor(c: Color | undefined, palette: Palette, fallback: string): string;
/** 主题字体槽 → CSS 字体栈；Office 字体名经 MO-41 别名表落到自托管 OFL 替身。 */
export declare function fontStack(font: SlotTextSpec['font'] | undefined, fonts: ThemeFonts): string;
export declare function cssAlign(a: string | undefined): string;
/**
 * CSS line-height：倍数 → 无单位（单倍 = LINE_HEIGHT_FACTOR），固定值 → px（内容层 1 px = 1 pt）。
 * `reduction` 为 normAutofit lnSpcReduction（1/1000 %），只作用于倍数行距。
 */
export declare function lineHeight(ls: SlotTextSpec['lineSpacing'] | ParaSpacing['line'] | undefined, sizePt: number, reduction?: number): string;
/** 行内字体：拉丁 + 东亚（命名字体原样，主题字体走源主题 / 内置主题的标题 / 正文字体）。 */
export declare function runFontStack(latin: InlineProps['font'], ea: InlineProps['fontEastAsia'], fonts: ThemeFonts): string | undefined;
export declare function lineSpacingFactor(spec: SlotTextSpec, sizeEmu: number): number;
export declare function inlineText(inlines: Inline[] | undefined): string;
export declare function blockText(b: Block): string;
export declare function blocksText(blocks: Block[]): string;
export declare function listMarkerText(kind: ListKind, n: number, checked?: boolean): string;
/**
 * 段落前缀：无序 "•"、有序按层级计数（同层连续列表项递增；遇到非列表段落或更浅层级时重置更深层级）。
 * Rust 版式提供每个列表项的绝对序号；续页和相邻独立列表使用该值，旧数据缺值时才递增回退。
 */
export declare function paragraphMarkers(paras: PlacedParagraph[]): string[];
export interface OutlineHeading {
    id: string;
    level: number;
    text: string;
    blocks: number;
}
export interface DocsOutline {
    headings: OutlineHeading[];
    totalBlocks: number;
    byType: Array<[string, number]>;
}
/** Docs 大纲：顶层标题 + 每个标题下到下一个标题之前的块数。 */
export declare function docsOutline(model: DocsModel): DocsOutline;
export {};
