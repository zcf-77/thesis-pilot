import type { DocsModel, DocsPreviewContext } from './types';
import type { EmbeddedFonts } from './embedded-fonts';
import type { AnchorStatus, HighlightResult, OffsetUnit, PreviewAnchor, PreviewHighlight, PreviewSelection } from './docs-anchors';
type __VLS_Props = {
    model: DocsModel;
    context: DocsPreviewContext;
    compact?: boolean;
    controlsTarget?: HTMLElement;
    /** 当前文档的内嵌字体（App 导入 DOCX 时注册）；只影响预览字体栈。 */
    embeddedFonts?: EmbeddedFonts;
    /** Host increments after installing or re-detecting original fonts. */
    fontRevision?: number;
    /** selection-change 事件里偏移的单位，缺省 scalar（IR Anchor）。 */
    selectionOffsetUnit?: OffsetUnit;
    /**
     * 可编辑表面（由 DocsEditor 使用）：纸面成为 contenteditable，页眉页脚、重复表头、域与对象标为不可编辑；
     * 渲染源模型本身（不走主题投影），模型变化时只续排受影响的页。本组件不处理输入。
     */
    editable?: boolean;
    /** 不渲染自带工具栏与说明文字；分页告警改由 pagination 事件带出。 */
    bare?: boolean;
    /** 受控缩放：数值或 fit-width；缺省用自带的缩放选择。 */
    zoom?: number | 'fit-width';
    /**
     * 排版引擎：flow 由浏览器原生分片（连续流，内容一变全文同帧重新切页）；
     * paged 是克隆分页（逐页探测；可编辑时增量续排）。缺省 auto：浏览器支持 column-wrap 时用 flow。
     */
    engine?: 'auto' | 'flow' | 'paged';
};
type JumpResult = 'found' | 'missing' | 'cancelled';
declare function jumpToBlock(id: string): Promise<JumpResult>;
declare function setHighlights(highlights: readonly PreviewHighlight[]): Promise<HighlightResult[]>;
declare function clearHighlights(group?: string): void;
/**
 * 滚到锚点（首段起点所在的可见片段）并标为当前项；分页未排到时等待后续批次，
 * 手动滚动或新的定位会取消。旧代次的页面不作为目标。
 */
declare function scrollToAnchor(anchor: PreviewAnchor): Promise<AnchorStatus>;
declare function repaginate(): Promise<void>;
/** 当前这遍分页（整篇或续排）结束后兑现。 */
declare function whenIdle(): Promise<void>;
declare function hold(value: boolean): void;
/** DOM 边界 → 正文文字块内的模型位置（标量偏移）；不在正文文字里返回 undefined。 */
declare function pointFromDom(container: Node, offset: number, bias?: 'start' | 'end'): {
    node: string;
    offset: number;
} | undefined;
/** 任意 DOM 边界 → 最近的可编辑位置。 */
declare function caretFromDom(container: Node, offset: number, bias?: 'start' | 'end'): {
    node: string;
    offset: number;
} | undefined;
/** 模型位置 → DOM 边界（当前代次的可见片段）；所在页尚未排出时返回 undefined。 */
declare function domFromPoint(point: {
    node: string;
    offset: number;
}): {
    node: Node;
    offset: number;
} | undefined;
/** 模型位置所在的可见页下标（从 0 起）。 */
declare function pageOf(point: {
    node: string;
    offset: number;
}): number | undefined;
declare function scrollToPage(index: number): void;
/** 把浏览器改脏的块（或全部）从模型重新挂载。 */
declare function restore(ids?: readonly string[]): undefined;
declare const __VLS_template: () => {
    __VLS_Slots: {
        controls?: (props: {}) => any;
    };
};
type __VLS_Slots = ReturnType<typeof __VLS_template>['__VLS_Slots'];
declare const __VLS_base: import("@vue/runtime-core").DefineComponent<__VLS_Props, {
    jumpToBlock: typeof jumpToBlock;
    scrollToAnchor: typeof scrollToAnchor;
    setHighlights: typeof setHighlights;
    clearHighlights: typeof clearHighlights;
    surface: () => HTMLElement | undefined;
    scroller: () => HTMLElement | undefined;
    pointFromDom: typeof pointFromDom;
    caretFromDom: typeof caretFromDom;
    domFromPoint: typeof domFromPoint;
    pageOf: typeof pageOf;
    scrollToPage: typeof scrollToPage;
    whenIdle: typeof whenIdle;
    hold: typeof hold;
    repaginate: typeof repaginate;
    restore: typeof restore;
    /** 当前排版引擎。 */
    engine: () => "flow" | "paged";
}, {}, {}, {}, import("@vue/runtime-core").ComponentOptionsMixin, import("@vue/runtime-core").ComponentOptionsMixin, {
    pagination: (state: {
        pages: number;
        complete: boolean;
        warnings?: string[];
    }) => any;
    "selection-change": (selection: PreviewSelection | null) => any;
    "pages-changing": () => any;
    "pages-changed": (change: {
        from: number;
        count: number;
    }) => any;
}, string, import("@vue/runtime-core").PublicProps, Readonly<__VLS_Props> & Readonly<{
    onPagination?: ((state: {
        pages: number;
        complete: boolean;
        warnings?: string[];
    }) => any) | undefined;
    "onSelection-change"?: ((selection: PreviewSelection | null) => any) | undefined;
    "onPages-changing"?: (() => any) | undefined;
    "onPages-changed"?: ((change: {
        from: number;
        count: number;
    }) => any) | undefined;
}>, {}, {}, {}, {}, string, import("@vue/runtime-core").ComponentProvideOptions, false, {}, any>;
declare const __VLS_export: __VLS_WithSlots<typeof __VLS_base, __VLS_Slots>;
declare const _default: typeof __VLS_export;
export default _default;
type __VLS_WithSlots<T, S> = T & {
    new (): {
        $slots: S;
    };
};
