import type { DocsModel, Inline, InlineProps, ParaProps } from '../types';
import type { ApplyOptions, DocOp, TextBlock } from './ops.ts';
import type { DocPoint, MapStep } from './mapping.ts';
import { ancestors } from './tree.ts';
import type { DocIndex } from './tree.ts';
export interface DocSelection {
    anchor: DocPoint;
    focus: DocPoint;
}
export interface CommandContext {
    doc: DocsModel;
    selection: DocSelection | null;
    /** 待用格式：折叠光标处下一次输入采用的行内属性（null 表示沿用光标左侧文字）。 */
    marks: InlineProps | null;
    newId: () => string;
    constraints?: 'controlled';
}
export declare class Transform {
    before: DocsModel;
    doc: DocsModel;
    ops: DocOp[];
    inverse: DocOp[];
    steps: MapStep[];
    /** 命令给出的事务后选区；未给出时由 controller 把原选区穿过步骤。 */
    selection?: DocSelection | null;
    /** undefined：清空待用格式；其余值写入。 */
    marks?: InlineProps | null;
    keepMarks: boolean;
    private options;
    constructor(doc: DocsModel, options?: ApplyOptions);
    /** 应用一个操作；`hint` 覆盖默认推导的映射步骤（拆段、合段等“文字搬家”）。 */
    step(op: DocOp, hint?: MapStep[]): this;
    get index(): DocIndex;
    get changed(): boolean;
}
export declare const isCollapsed: (selection: DocSelection) => boolean;
/** 选区按文档顺序排好的两端；任一端不在正文文字块内时返回 undefined。 */
export declare function orderedRange(index: DocIndex, selection: DocSelection | null): {
    from: DocPoint;
    to: DocPoint;
    collapsed: boolean;
} | undefined;
/**
 * 删除 [from, to)。同一同级列表内的首尾段合并成一段；跨单元格 / 跨容器时只清空文字、保留结构；
 * 中间被完整覆盖的块（含表格、图片）整块删除，但不会把单元格或列表项删空。返回删除后的光标位置。
 */
export declare function deleteBetween(tr: Transform, from: DocPoint, to: DocPoint): DocPoint;
export declare function deleteSelection(ctx: CommandContext): Transform | null;
/** 删除任意模型区间（浏览器给出的目标范围：按词删除、拼写替换、拖放移走等）。 */
export declare function deleteRange(ctx: CommandContext, a: DocPoint, b: DocPoint): Transform | null;
type Unit = 'char' | 'word';
/**
 * 光标处向前 / 向后的一个删除单位（字素簇或词）。书签是零宽落点，删除时跳过并保留。
 * 段内没有可删内容时返回 undefined（交给合段）。
 */
export declare function deletionUnit(inlines: readonly Inline[], offset: number, direction: -1 | 1, unit: Unit): {
    start: number;
    end: number;
} | undefined;
export declare function deleteBackward(ctx: CommandContext, unit?: Unit): Transform | null;
export declare function deleteForward(ctx: CommandContext, unit?: Unit): Transform | null;
/** 输入文字清洗：换行统一为 \n，去掉其余控制字符与孤立代理项。 */
export declare function sanitizeText(text: string): string;
export declare function insertText(ctx: CommandContext, text: string): Transform | null;
/** 把模型区间替换为文字（输入法合成结束、拼写替换）：一次事务。 */
export declare function replaceRange(ctx: CommandContext, a: DocPoint, b: DocPoint, text: string): Transform | null;
export declare function splitBlock(ctx: CommandContext): Transform | null;
interface Span {
    block: TextBlock;
    start: number;
    end: number;
}
/** 选区覆盖的各文字块片段（文档顺序）。 */
export declare function selectedSpans(index: DocIndex, from: DocPoint, to: DocPoint): Span[];
export declare function setRunProps(ctx: CommandContext, props: InlineProps): Transform | null;
export type MarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'superscript' | 'subscript';
export type Tri = boolean | 'mixed';
export interface FormatState {
    bold: Tri;
    italic: Tri;
    underline: Tri;
    strike: Tri;
    superscript: Tri;
    subscript: Tri;
    align: ParaProps['align'] | 'mixed' | undefined;
    /** 0 表示正文段落。 */
    heading: number | 'mixed';
    style: string | 'mixed' | undefined;
    /** 光标在表格单元格内。 */
    inTable: boolean;
}
/** 工具栏状态：行内格式按“段落 run 缺省 + run 自身属性”判断，只看文档里写明的值。 */
export declare function formatState(ctx: CommandContext): FormatState | null;
export declare function toggleMark(ctx: CommandContext, name: MarkName): Transform | null;
export declare function setParaProps(ctx: CommandContext, props: ParaProps): Transform | null;
export declare function applyStyle(ctx: CommandContext, style: string): Transform | null;
/** 标题级别：1–6 设为标题；0 把标题改回正文段落。 */
export declare function setHeading(ctx: CommandContext, level: number): Transform | null;
/** 缩进一级：按字数缩进的段落增减 2 字，其余增减 `step` EMU（缺省 0.74 cm，Word 的增加缩进量）。 */
export declare function indent(ctx: CommandContext, direction: -1 | 1, step?: number): Transform | null;
/** 去掉选中文字的直接格式（保留链接）与段落的直接属性（保留样式名与编号标签）。 */
export declare function clearFormatting(ctx: CommandContext): Transform | null;
export interface SliceBlock {
    inlines: Inline[];
    /** 来自本编辑器的复制内容才带；外部内容一律沿用光标所在段落的属性。 */
    props?: ParaProps;
    heading?: number;
}
/** 在光标处插入若干段：首段并入当前段，末段接上当前段余下的文字。 */
export declare function insertSlice(ctx: CommandContext, slice: readonly SliceBlock[]): Transform | null;
export declare function plainSlice(text: string): SliceBlock[];
/** 选区内容：各文字块被选中的行内片段（复制 / 剪切用）。 */
export declare function selectionSlice(ctx: CommandContext): SliceBlock[];
/** 在光标所在行的上方 / 下方插入空行。表格含纵向合并单元格时不支持（内核没有对应操作）。 */
export declare function insertRow(ctx: CommandContext, where: 'above' | 'below'): Transform | null;
export declare function deleteRow(ctx: CommandContext): Transform | null;
/** Tab / Shift+Tab：移到下一格 / 上一格并选中其内容；在最后一格按 Tab 追加一行。 */
export declare function moveCell(ctx: CommandContext, direction: -1 | 1): Transform | null;
/** 命令当前是否可用。 */
export declare function tableAbility(ctx: CommandContext): {
    inTable: boolean;
    insertRow: boolean;
    deleteRow: boolean;
    /** 内核没有列操作与合并单元格操作：明确禁用。 */
    insertColumn: boolean;
    deleteColumn: boolean;
    mergeCells: boolean;
    splitCell: boolean;
};
export { ancestors };
