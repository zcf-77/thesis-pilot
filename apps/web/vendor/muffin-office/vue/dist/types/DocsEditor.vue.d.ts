import type { DocsModel, DocsPreviewContext } from './types';
import type { EmbeddedFonts } from './embedded-fonts';
import type { AnchorStatus, PreviewAnchor, PreviewHighlight, PreviewSelectionSegment } from './docs-anchors';
import { DocsEditorController } from './docs-editor/index.ts';
import type { BlockedEvent, CommandName, DocPoint, DocSelection, FormatState, KernelTransaction, ProtectedRange, TransactionMeta } from './docs-editor/index.ts';
export interface EditorSelection {
    anchor: DocPoint;
    focus: DocPoint;
    collapsed: boolean;
    /** 选中的文字（各段以 \n 相接）。 */
    text: string;
    /** 文档顺序的各段区间，偏移为 Unicode 标量（IR Anchor 语义）；UTF-16 换算见 scalarToUtf16。 */
    segments: PreviewSelectionSegment[];
}
export interface EditorViewState {
    format: FormatState | null;
    canUndo: boolean;
    canRedo: boolean;
    dirty: boolean;
    readOnly: boolean;
    focused: boolean;
    composing: boolean;
    pages: number;
    /** 光标所在页（从 1 起）；尚未定位时为 0。 */
    currentPage: number;
    /** 分页是否已排完（长文档后台续排时为 false）。 */
    layoutComplete: boolean;
}
type __VLS_Props = {
    /** 文档模型。配合 `update:model` 可用 v-model；传入非本组件发出的对象视为外部换稿（清空撤销栈）。 */
    model: DocsModel;
    /** 预览上下文（主题样式、调色板），来自内核 `docs_preview_context`。 */
    context: DocsPreviewContext;
    readOnly?: boolean;
    /** 缩放：数值或 fit-width（缺省）。 */
    zoom?: number | 'fit-width';
    /** 受保护区间：区间内的输入、删除、粘贴、格式修改全部拦截并发 blocked。 */
    protectedRanges?: readonly ProtectedRange[];
    /** 叠加层（候选差异、搜索命中等）：按锚点画在纸面上，随编辑移动，不写回模型。 */
    overlays?: readonly PreviewHighlight[];
    /** 把受保护区间画出来（缺省 true）。 */
    showProtected?: boolean;
    protectFormatting?: boolean;
    /** 事务署名，如 `user:alice`。 */
    actor?: string;
    /** 主题约束；缺省取 context.constraints。controlled 时字体 / 字号 / 行距覆盖在本地即被拒绝，与内核一致。 */
    constraints?: 'controlled' | 'open';
    /** 同步否决钩子：返回 false 则事务不落地（宿主的版本 / 权限校验）。 */
    beforeTransaction?: (transaction: KernelTransaction, meta: TransactionMeta) => boolean | void;
    /** 粘贴外部内容：formatted 保留受支持的字符格式子集（缺省），plain 只取纯文本。 */
    paste?: 'formatted' | 'plain';
    spellcheck?: boolean;
    /** 排版引擎：缺省 auto（支持时用浏览器原生分片的连续流，否则克隆分页）。 */
    engine?: 'auto' | 'flow' | 'paged';
    ariaLabel?: string;
    embeddedFonts?: EmbeddedFonts;
    fontRevision?: number;
};
declare function exec(command: CommandName, args?: unknown): boolean;
declare function can(command: CommandName): boolean;
declare function focus(): void;
declare function setSelection(selection: DocSelection | null): void;
declare const __VLS_export: import("@vue/runtime-core").DefineComponent<__VLS_Props, {
    /** 执行命令；返回是否生效（被保护区间 / 约束 / 宿主拦下时为 false 并发 blocked）。 */
    exec: typeof exec;
    can: typeof can;
    focus: typeof focus;
    undo: () => boolean;
    redo: () => boolean;
    /** 标记保存点：`state.dirty` 归零。 */
    markSaved: () => void;
    clearHistory: () => void;
    getModel: () => DocsModel;
    getSelection: () => EditorSelection | null;
    setSelection: typeof setSelection;
    insertText: (text: string) => boolean;
    scrollToAnchor: (anchor: PreviewAnchor) => Promise<AnchorStatus>;
    scrollToPage: (page: number) => void | undefined;
    /** 当前这遍排版结束（长文档后台续排完成）。 */
    whenIdle: () => Promise<void>;
    /** 整篇重新分页（字体变化后，或核对增量续排结果）。 */
    relayout: () => Promise<void>;
    /** 模型位置所在页（从 0 起）与当前排版引擎。 */
    pageOf: (point: DocPoint) => number | undefined;
    engine: () => "flow" | "paged";
    /** 最近若干次输入的实测耗时（毫秒）。 */
    metrics: () => {
        inputMs: number[];
        settleMs: number[];
    };
    state: import("@vue/reactivity").ComputedRef<EditorViewState>;
    /** 无界面会话控制器（高级用法：自定义命令、直接读写选区）。 */
    controller: DocsEditorController;
}, {}, {}, {}, import("@vue/runtime-core").ComponentOptionsMixin, import("@vue/runtime-core").ComponentOptionsMixin, {
    pagination: (state: {
        pages: number;
        current: number;
        complete: boolean;
        warnings: string[];
    }) => any;
    "selection-change": (selection: EditorSelection | null) => any;
    transaction: (transaction: KernelTransaction, meta: TransactionMeta) => any;
    "update:model": (model: DocsModel) => any;
    blocked: (event: BlockedEvent) => any;
    "state-change": (state: EditorViewState) => any;
}, string, import("@vue/runtime-core").PublicProps, Readonly<__VLS_Props> & Readonly<{
    onPagination?: ((state: {
        pages: number;
        current: number;
        complete: boolean;
        warnings: string[];
    }) => any) | undefined;
    "onSelection-change"?: ((selection: EditorSelection | null) => any) | undefined;
    onTransaction?: ((transaction: KernelTransaction, meta: TransactionMeta) => any) | undefined;
    "onUpdate:model"?: ((model: DocsModel) => any) | undefined;
    onBlocked?: ((event: BlockedEvent) => any) | undefined;
    "onState-change"?: ((state: EditorViewState) => any) | undefined;
}>, {}, {}, {}, {}, string, import("@vue/runtime-core").ComponentProvideOptions, false, {}, any>;
declare const _default: typeof __VLS_export;
export default _default;
