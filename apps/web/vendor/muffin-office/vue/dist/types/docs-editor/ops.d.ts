import type { Block, DocsModel, Inline, InlineProps, ParaProps } from '../types';
import type { MapStep } from './mapping.ts';
export type DocPosition = {
    kind: 'start';
} | {
    kind: 'end';
} | {
    kind: 'index';
    index: number;
} | {
    kind: 'before';
    id: string;
} | {
    kind: 'after';
    id: string;
};
/** 字符区间：Unicode 标量，左闭右开。 */
export interface CharRange {
    start: number;
    end: number;
}
export type DocOp = {
    op: 'doc.insert_block';
    section?: string;
    at: DocPosition;
    block: Block;
} | {
    op: 'doc.delete_block';
    id: string;
} | {
    op: 'doc.move_block';
    id: string;
    at: DocPosition;
} | {
    op: 'doc.replace_block';
    id: string;
    block: Block;
} | {
    op: 'doc.replace_text';
    id: string;
    range?: CharRange;
    text: string;
} | {
    op: 'doc.set_inlines';
    id: string;
    inlines: Inline[];
} | {
    op: 'doc.apply_style';
    ids: string[];
    style: string;
} | {
    op: 'doc.set_heading_level';
    id: string;
    level: number;
} | {
    op: 'doc.set_para_props';
    ids: string[];
    props: ParaProps;
} | {
    op: 'doc.set_run_props';
    id: string;
    range?: CharRange;
    props: InlineProps;
} | {
    op: 'doc.table.set_cell';
    table: string;
    row: number;
    col: number;
    blocks: Block[];
} | {
    op: 'doc.table.delete_row';
    table: string;
    row: number;
};
export type TextBlock = Extract<Block, {
    type: 'paragraph' | 'heading';
}>;
export declare const isTextBlock: (block: Block | undefined) => block is TextBlock;
export type DocOpsErrorCode = 'node_not_found' | 'invalid' | 'theme_constraint' | 'unsupported';
export declare class DocOpsError extends Error {
    code: DocOpsErrorCode;
    index: number;
    op: string;
    constructor(code: DocOpsErrorCode, index: number, op: string, detail: string);
}
export interface ApplyOptions {
    /** 受控主题拒绝逐块覆盖字体 / 字号 / 行距（与内核 Constraints::Controlled 一致）。 */
    constraints?: 'controlled';
}
export interface ApplyResult {
    doc: DocsModel;
    /** 逆操作：按顺序执行即回到应用前的模型。 */
    inverse: DocOp[];
    steps: MapStep[];
}
type Key = 'blocks' | 'items' | 'rows' | 'cells';
type Step = {
    key: Key;
    index: number;
};
export interface BlockPath {
    section: number;
    steps: Step[];
}
/** 正文中任意深度的块（页眉页脚、脚注不在内）。`section` 给定时只在该节内找。 */
export declare function findBlockPath(doc: DocsModel, id: string, section?: number): BlockPath | undefined;
export declare function blockAt(doc: DocsModel, path: BlockPath): Block;
type Atom = {
    ch: string;
    props: InlineProps | undefined;
} | {
    other: Inline;
};
/** 结构相等；undefined / null / 空对象视为同一个“未设置”。 */
export declare function sameValue(a: unknown, b: unknown): boolean;
export declare function flattenInlines(inlines: readonly Inline[]): Atom[];
export declare function rebuildInlines(atoms: readonly Atom[]): Inline[];
/** `over` 里有值的键覆盖 `base`（InlineProps::merged）。 */
export declare function mergeRunProps(base: InlineProps | undefined, over: InlineProps | undefined): InlineProps | undefined;
/** 段落属性合并（merge_para）：有值覆盖，间距 / 缩进逐键合并，制表位非空才替换，段落 run 属性合并。 */
export declare function mergeParaProps(base: ParaProps | undefined, over: ParaProps | undefined): ParaProps | undefined;
export declare function canonInlines(inlines: readonly Inline[]): Inline[];
/** 调用方给出的块按内核的规范序列化形态存入：空属性省略，缺省值补齐或省略。 */
export declare function canonBlock(block: Block): Block;
/** 公共前后缀之外的中段记为一次替换；文字未变返回空。 */
export declare function textDiffSteps(node: string, before: string, after: string): MapStep[];
export declare function applyOp(doc: DocsModel, op: DocOp, index?: number, options?: ApplyOptions): ApplyResult;
/** 整个事务原子执行：任一操作失败即抛出，输入模型不变。 */
export declare function applyOps(doc: DocsModel, ops: readonly DocOp[], options?: ApplyOptions): ApplyResult;
export {};
