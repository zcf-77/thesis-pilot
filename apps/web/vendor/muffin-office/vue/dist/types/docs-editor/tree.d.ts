import type { Block, DocsModel, Inline, InlineProps } from '../types';
import { scalarLength } from '../docs-anchors.ts';
import type { TextBlock } from './ops.ts';
import type { DocPoint } from './mapping.ts';
export interface BlockEntry {
    id: string;
    block: Block;
    /** 同级块数组：节正文 / 单元格 / 列表项 / 引用 / 容器。 */
    siblings: readonly Block[];
    index: number;
    /** 外层块（表格 / 列表 / 引用 / 容器）的 ID；顶层块没有。 */
    parent?: string;
    /** 所在顶层块 ID。 */
    top: string;
    section: number;
    cell?: {
        table: string;
        row: number;
        col: number;
        id: string;
    };
    item?: {
        list: string;
        index: number;
        id: string;
    };
    /** 先序序号与子树内最大序号：`seq < x <= last` 即 x 在本块之内。 */
    seq: number;
    last: number;
}
export interface DocIndex {
    doc: DocsModel;
    blocks: Map<string, BlockEntry>;
    /** 正文里的文字块（段落 / 标题），文档顺序。 */
    texts: TextBlock[];
    order: Map<string, number>;
}
export declare function indexDoc(doc: DocsModel): DocIndex;
export declare function textBlock(index: DocIndex, id: string): TextBlock | undefined;
export declare function textLength(index: DocIndex, id: string): number;
export declare function blockText(index: DocIndex, id: string): string;
/** 文档顺序比较；不在正文文字块内的位置排在最后。 */
export declare function comparePoints(index: DocIndex, a: DocPoint, b: DocPoint): number;
export declare function clampPoint(index: DocIndex, point: DocPoint): DocPoint | undefined;
/** 外层块链：自身在前，逐层向外。 */
export declare function ancestors(index: DocIndex, id: string): BlockEntry[];
/** 按标量偏移切出 [start, end) 的行内节点；切开的 run 保留属性。 */
export declare function sliceInlines(inlines: readonly Inline[], start: number, end?: number): Inline[];
/** 偏移处左侧（`side` 为 -1）或右侧字符所在 run 的属性；不是文字时返回 undefined。 */
export declare function runPropsAt(inlines: readonly Inline[], offset: number, side: -1 | 1): InlineProps | undefined;
export { scalarLength };
