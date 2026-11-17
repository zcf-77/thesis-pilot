import type { PreviewAnchor } from '../docs-anchors.ts';
export type MapStep = 
/** `node` 的 [start, end) 被替换为 `insert` 个标量。 */
{
    kind: 'text';
    node: string;
    start: number;
    end: number;
    insert: number;
}
/** `from` 的 [start, end) 搬到 `to` 的 `at` 处（拆段、合段）。`whole` 表示整段搬走，两端边界一并跟随。 */
 | {
    kind: 'move';
    from: string;
    start: number;
    end: number;
    to: string;
    at: number;
    whole?: boolean;
}
/** 节点消失；其中的位置落到 `fallback`，没有则判为已删除。 */
 | {
    kind: 'remove';
    node: string;
    fallback?: DocPoint;
};
export interface DocPoint {
    node: string;
    offset: number;
}
/** 偏向：-1 贴前文（区间终点），1 贴后文（区间起点、插入后的光标）。 */
export type Assoc = -1 | 1;
/** 位置穿过步骤；所在节点被删除且没有落点时返回 undefined。 */
export declare function mapPoint(point: DocPoint, steps: readonly MapStep[], assoc?: Assoc): DocPoint | undefined;
export interface MappedRange {
    node: string;
    start: number;
    end: number;
}
/**
 * 区间穿过步骤。返回各段（拆段后可能落在两个节点）；整体被删除返回空数组。
 * `intact` 为 false 表示区间内的文字被改动过（删除、在内部插入、被拆开）。
 */
export declare function mapRange(range: MappedRange, steps: readonly MapStep[]): {
    segments: MappedRange[];
    intact: boolean;
};
/**
 * 步骤的逆（撤销用）：替换反向替换，搬移原路搬回。被删除节点的“移除”没有逆——节点由逆操作重新出现，
 * 当初落到别处的位置留在原地。
 */
export declare function invertSteps(steps: readonly MapStep[]): MapStep[];
/** 被步骤移除的节点（整节点锚点据此判断失效）。 */
export declare function removedNodes(steps: readonly MapStep[]): Set<string>;
/**
 * 宿主锚点穿过步骤（只支持标量偏移；UTF-16 锚点请先用 convertOffset 换算）。
 * 文字范围被整体删除或所指节点消失时返回 undefined。
 */
export declare function mapAnchor(anchor: PreviewAnchor, steps: readonly MapStep[]): PreviewAnchor | undefined;
