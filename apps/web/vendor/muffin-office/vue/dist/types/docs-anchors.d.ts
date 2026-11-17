import type { Block, DocsModel, Inline } from './types';
export type OffsetUnit = 'scalar' | 'utf16';
export interface PreviewRange {
    node: string;
    start?: number;
    end?: number;
}
/** 主范围加可选的后续段（跨节点范围）；offsetUnit 缺省为 scalar（IR Anchor 语义）。 */
export interface PreviewAnchor extends PreviewRange {
    offsetUnit?: OffsetUnit;
    segments?: PreviewRange[];
}
export type AnchorStatus = 'found' | 'missing' | 'cancelled' | 'unsupported';
/** protected：编辑器标出受保护区间（只读预览用不到）。 */
export type HighlightTone = 'mark' | 'comment' | 'insert' | 'delete' | 'format' | 'protected';
export interface PreviewHighlight {
    id: string;
    /** 意见 / 差异 / 格式问题等来源，按组替换与清除。 */
    group: string;
    anchor: PreviewAnchor;
    tone?: HighlightTone;
}
export interface HighlightResult {
    id: string;
    group: string;
    status: AnchorStatus;
}
export interface PreviewSelectionSegment {
    node: string;
    start: number;
    end: number;
    text: string;
}
export interface PreviewSelection {
    offsetUnit: OffsetUnit;
    text: string;
    segments: PreviewSelectionSegment[];
}
export declare const OBJECT_UNIT = "\uFFFC";
export declare function scalarLength(text: string): number;
export declare function inlineText(item: Inline): string;
export declare function inlineLength(item: Inline): number;
export declare function paragraphText(inlines: Inline[]): string;
/** 每个行内节点在段落文字中的起点（标量）。 */
export declare function inlineOffsets(inlines: Inline[]): number[];
/** 标量偏移 → UTF-16 偏移；越界或非整数返回 undefined。 */
export declare function scalarToUtf16(text: string, offset: number): number | undefined;
/**
 * UTF-16 偏移 → 标量偏移。落在代理对中间时：默认拒绝（undefined）；
 * `snap` 为 'start' 向前取整、'end' 向后取整，供 DOM 选区换算使用。
 */
export declare function utf16ToScalar(text: string, offset: number, snap?: 'start' | 'end'): number | undefined;
export declare function convertOffset(text: string, offset: number, from: OffsetUnit, to: OffsetUnit): number | undefined;
/** 按标量切片。 */
export declare function sliceScalar(text: string, start: number, end: number): string;
export interface GridCell {
    row: number;
    col: number;
    rowSpan: number;
    colSpan: number;
}
/** HTML 表格算法：被纵向合并覆盖的格不在行内（与导入器一致），按占用推出网格列。 */
export declare function tableGrid(rows: ReadonlyArray<{
    cells: ReadonlyArray<{
        colSpan?: number;
        rowSpan?: number;
    }>;
}>): GridCell[][];
/** 导入的 Word 编号列表：每项首段自带标签，预览按段落平铺，列表与列表项本身没有 DOM。 */
export declare function isLabelledList(block: Block): boolean;
export type ModelNodeKind = 'text' | 'block' | 'row' | 'cell' | 'item' | 'hidden';
export interface ModelNode {
    id: string;
    kind: ModelNodeKind;
    /** 源模型文字投影（kind 为 text）。 */
    text?: string;
    /** 预览文字 = 前缀 + 源文字时的前缀长度（标量）；预览改写了文字时为 undefined。 */
    shift?: number;
    children: string[];
}
export interface ModelIndex {
    nodes: Map<string, ModelNode>;
    /** 预览中自身有 DOM 元素的节点。 */
    rendered: Set<string>;
}
/** `source` 是宿主锚点所指的 IR；`display` 是实际渲染的投影（如公文主题会给编号段加字面前缀）。 */
export declare function indexModel(source: DocsModel, display?: DocsModel): ModelIndex;
/** 节点在预览中的落点：自身有元素就是自身，否则取最近一层有元素的后代。 */
export declare function renderTargets(models: ModelIndex, id: string, depth?: number): string[];
export type NormalizedRange = {
    node: string;
    text: true;
    start: number;
    end: number;
} | {
    node: string;
    text: false;
    targets: string[];
};
/** 校验并换成预览（标量、含投影前缀）坐标。 */
export declare function normalizeAnchor(anchor: PreviewAnchor, models: ModelIndex): {
    ok: true;
    ranges: NormalizedRange[];
} | {
    ok: false;
    status: 'missing' | 'unsupported';
};
/** 只用到的 DOM 能力；真实 Node 与测试替身都满足。 */
export interface DomNode {
    readonly nodeType: number;
    readonly parentNode: DomNode | null;
    readonly childNodes: ArrayLike<DomNode>;
    readonly nodeValue: string | null;
    getAttribute?(name: string): string | null;
}
export interface TextPiece {
    kind: 'text' | 'atom';
    node: DomNode;
    start: number;
    end: number;
    /** 相对片段根的子节点下标路径，用于比较 DOM 边界先后。 */
    path: number[];
}
export interface TextMap {
    start: number;
    end: number;
    pieces: TextPiece[];
}
/** 片段文字映射；`begin` 是续段起点（上一片段终点）。 */
export declare function mapText(root: DomNode, begin?: number): TextMap;
export interface DomPoint {
    node: DomNode;
    offset: number;
}
/** 片段内 [start, end) 的 DOM 边界；与片段不相交时返回 undefined。 */
export declare function domRange(map: TextMap, start: number, end: number): {
    start: DomPoint;
    end: DomPoint;
} | undefined;
/** DOM 边界（Selection / Range 的 container + offset）→ 片段内模型偏移；不在片段内返回 undefined。 */
export declare function offsetAt(map: TextMap, root: DomNode, container: DomNode, offset: number, bias: 'start' | 'end'): number | undefined;
export type FragmentKind = 'text' | 'block' | 'row' | 'cell' | 'item';
/** body 正文；repeat 续页重复表头的副本；running 页眉页脚（每页一份）；note 文末脚注区。 */
export type FragmentRole = 'body' | 'repeat' | 'running' | 'note';
export interface TablePlacement {
    table?: string;
    row: number;
    col?: number;
    rowSpan?: number;
    colSpan?: number;
}
export interface Fragment {
    node: string;
    kind: FragmentKind;
    element: DomNode;
    /** 预览页下标（从 0 起）；脚注区为 -1。 */
    page: number;
    generation: number;
    role: FragmentRole;
    /** 同一节点在本代次内的第几个实例。 */
    instance: number;
    continuation: boolean;
    table?: TablePlacement;
}
export interface TextPart {
    fragment: Fragment;
    start: number;
    end: number;
}
export declare const FRAGMENT_SELECTOR = "[data-node-id],[data-row-id],[data-cell-id],[data-item-id]";
export declare class FragmentIndex {
    generation: number;
    private pages;
    private notes;
    private byNode;
    private byElement;
    private maps;
    /** 新一轮渲染：旧代次片段全部作废（仍在 DOM 中的旧页不再是定位目标）。 */
    reset(generation: number): void;
    get pageCount(): number;
    /** 按顺序登记下一页；`found` 可传 querySelectorAll(FRAGMENT_SELECTOR) 的结果。 */
    addPage(root: DomNode, found?: ArrayLike<DomNode>): void;
    /**
     * 增量续排：把 [start, start + deleteCount) 页换成 `roots`，其后的页原样保留（片段对象沿用，只改页号）。
     * 保留页页首的续段起点取自被换掉的前段，先算好缓存，换页后仍然成立。
     */
    splice(start: number, deleteCount: number, roots: ReadonlyArray<{
        root: DomNode;
        found?: ArrayLike<DomNode>;
    }>): void;
    setNotes(root: DomNode | undefined, found?: ArrayLike<DomNode>): void;
    private scan;
    isCurrent(fragment: Fragment): boolean;
    fragments(node: string): readonly Fragment[];
    pageFragments(page: number): readonly Fragment[];
    fragmentOf(element: DomNode): Fragment | undefined;
    textMap(fragment: Fragment): TextMap;
    /** 源字符区间（预览坐标）对应的全部可见片段；重复表头副本不作为目标。 */
    resolveText(node: string, start: number, end: number): {
        parts: TextPart[];
        covered: boolean;
    };
    resolveBlock(targets: readonly string[]): Fragment[];
}
export type Resolution = {
    status: 'found';
    text: TextPart[];
    blocks: Fragment[];
} | {
    status: 'pending' | 'missing' | 'unsupported';
    text: TextPart[];
    blocks: Fragment[];
};
/**
 * 规范化后的范围在当前代次中的落点。`complete` 表示本代次分页已结束：
 * 未覆盖的范围此时才判 missing；之前返回 pending，由调用方等下一批。
 */
export declare function resolveRanges(index: FragmentIndex, ranges: readonly NormalizedRange[], complete: boolean): Resolution;
export interface HighlightEntry {
    key: string;
    id: string;
    group: string;
    tone: HighlightTone;
    anchor: PreviewAnchor;
}
export declare class HighlightStore {
    private groups;
    /** 按组替换：输入里出现的组整体换成新内容，其他组不动。 */
    set(items: readonly PreviewHighlight[]): {
        added: HighlightEntry[];
        removed: HighlightEntry[];
    };
    clear(group?: string): HighlightEntry[];
    entries(): HighlightEntry[];
    /** 仍是当前登记的那一项（被替换或清除后为 false）。 */
    has(entry: HighlightEntry): boolean;
}
export interface SelectionPart {
    node: string;
    start: number;
    end: number;
    role: FragmentRole;
}
/** 选区片段（预览坐标，文档顺序）→ 源节点段落；跨页同段合并，正文选区不夹带页眉页脚与重复表头。 */
export declare function selectionFromParts(parts: readonly SelectionPart[], models: ModelIndex, unit: OffsetUnit): PreviewSelection | null;
type PaintTone = HighlightTone | 'current';
/** 是否能画字符范围（CSS Custom Highlight API）。 */
export declare function canHighlightText(): boolean;
/**
 * 字符范围走 CSS Custom Highlight（不改 DOM，不影响分页测量）；无字符范围的块 / 行 / 单元格
 * 在元素上标 data-doc-highlight。多个实例共享同名 Highlight，各自只增删自己的 Range。
 */
export declare class HighlightPainter {
    private ranges;
    private elements;
    private tones;
    addRange(key: string, tone: PaintTone, range: AbstractRange): boolean;
    addElement(key: string, tone: PaintTone, element: Element): void;
    private apply;
    remove(key: string): void;
    clear(): void;
}
export {};
