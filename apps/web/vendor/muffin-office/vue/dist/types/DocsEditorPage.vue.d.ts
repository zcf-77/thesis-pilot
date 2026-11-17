import type { DocsModel, DocsPreviewContext } from './types';
import type { EditorSelection, EditorViewState } from './DocsEditor.vue';
import type { EmbeddedFonts } from './embedded-fonts';
import type { PreviewAnchor, PreviewHighlight } from './docs-anchors';
import type { BlockedEvent, CommandName, KernelTransaction, ProtectedRange, TransactionMeta } from './docs-editor/index.ts';
type __VLS_Props = {
    model: DocsModel;
    context: DocsPreviewContext;
    /** 文档标题（显示在页面左上）。 */
    title?: string;
    readOnly?: boolean;
    protectedRanges?: readonly ProtectedRange[];
    overlays?: readonly PreviewHighlight[];
    actor?: string;
    constraints?: 'controlled' | 'open';
    beforeTransaction?: (transaction: KernelTransaction, meta: TransactionMeta) => boolean | void;
    /** 样式下拉里的命名样式（来自模板）；缺省取上下文里的段落样式名。 */
    styles?: ReadonlyArray<{
        name: string;
        label?: string;
    }>;
    /** 是否显示导航窗格（标题大纲）。 */
    outline?: boolean;
    engine?: 'auto' | 'flow' | 'paged';
    embeddedFonts?: EmbeddedFonts;
    fontRevision?: number;
};
declare const __VLS_template: () => {
    __VLS_Slots: {
        title?: (props: {}) => any;
    } & {
        actions?: (props: {}) => any;
    } & {
        tools?: (props: {}) => any;
    } & {
        aside?: (props: {}) => any;
    } & {
        status?: (props: {}) => any;
    };
};
type __VLS_Slots = ReturnType<typeof __VLS_template>['__VLS_Slots'];
declare const __VLS_base: import("@vue/runtime-core").DefineComponent<__VLS_Props, {
    /** 内层 DocsEditor 实例：exec / can / undo / scrollToAnchor / markSaved 等。 */
    editor: import("@vue/reactivity").Ref<import("@vue/runtime-core").CreateComponentPublicInstanceWithMixins<Readonly<{
        model: DocsModel;
        context: DocsPreviewContext;
        readOnly?: boolean;
        zoom?: number | "fit-width";
        protectedRanges?: readonly ProtectedRange[];
        overlays?: readonly PreviewHighlight[];
        showProtected?: boolean;
        protectFormatting?: boolean;
        actor?: string;
        constraints?: "controlled" | "open";
        beforeTransaction?: (transaction: KernelTransaction, meta: TransactionMeta) => boolean | void;
        paste?: "formatted" | "plain";
        spellcheck?: boolean;
        engine?: "auto" | "flow" | "paged";
        ariaLabel?: string;
        embeddedFonts?: EmbeddedFonts;
        fontRevision?: number;
    }> & Readonly<{
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
    }>, {
        exec: (command: CommandName, args?: unknown) => boolean;
        can: (command: CommandName) => boolean;
        focus: () => void;
        undo: () => boolean;
        redo: () => boolean;
        markSaved: () => void;
        clearHistory: () => void;
        getModel: () => DocsModel;
        getSelection: () => EditorSelection | null;
        setSelection: (selection: import("./docs-editor-entry.ts").DocSelection | null) => void;
        insertText: (text: string) => boolean;
        scrollToAnchor: (anchor: PreviewAnchor) => Promise<import("./docs-anchors").AnchorStatus>;
        scrollToPage: (page: number) => void | undefined;
        whenIdle: () => Promise<void>;
        relayout: () => Promise<void>;
        pageOf: (point: import("./docs-editor-entry.ts").DocPoint) => number | undefined;
        engine: () => "flow" | "paged";
        metrics: () => {
            inputMs: number[];
            settleMs: number[];
        };
        state: import("@vue/reactivity").ComputedRef<EditorViewState>;
        controller: import("./docs-editor-entry.ts").DocsEditorController;
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
    }, import("@vue/runtime-core").PublicProps, {}, false, {}, {}, import("@vue/runtime-core").GlobalComponents, import("@vue/runtime-core").GlobalDirectives, string, {}, any, import("@vue/runtime-core").ComponentProvideOptions, {
        P: {};
        B: {};
        D: {};
        C: {};
        M: {};
        Defaults: {};
    }, Readonly<{
        model: DocsModel;
        context: DocsPreviewContext;
        readOnly?: boolean;
        zoom?: number | "fit-width";
        protectedRanges?: readonly ProtectedRange[];
        overlays?: readonly PreviewHighlight[];
        showProtected?: boolean;
        protectFormatting?: boolean;
        actor?: string;
        constraints?: "controlled" | "open";
        beforeTransaction?: (transaction: KernelTransaction, meta: TransactionMeta) => boolean | void;
        paste?: "formatted" | "plain";
        spellcheck?: boolean;
        engine?: "auto" | "flow" | "paged";
        ariaLabel?: string;
        embeddedFonts?: EmbeddedFonts;
        fontRevision?: number;
    }> & Readonly<{
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
    }>, {
        exec: (command: CommandName, args?: unknown) => boolean;
        can: (command: CommandName) => boolean;
        focus: () => void;
        undo: () => boolean;
        redo: () => boolean;
        markSaved: () => void;
        clearHistory: () => void;
        getModel: () => DocsModel;
        getSelection: () => EditorSelection | null;
        setSelection: (selection: import("./docs-editor-entry.ts").DocSelection | null) => void;
        insertText: (text: string) => boolean;
        scrollToAnchor: (anchor: PreviewAnchor) => Promise<import("./docs-anchors").AnchorStatus>;
        scrollToPage: (page: number) => void | undefined;
        whenIdle: () => Promise<void>;
        relayout: () => Promise<void>;
        pageOf: (point: import("./docs-editor-entry.ts").DocPoint) => number | undefined;
        engine: () => "flow" | "paged";
        metrics: () => {
            inputMs: number[];
            settleMs: number[];
        };
        state: import("@vue/reactivity").ComputedRef<EditorViewState>;
        controller: import("./docs-editor-entry.ts").DocsEditorController;
    }, {}, {}, {}, {}> | undefined, import("@vue/runtime-core").CreateComponentPublicInstanceWithMixins<Readonly<{
        model: DocsModel;
        context: DocsPreviewContext;
        readOnly?: boolean;
        zoom?: number | "fit-width";
        protectedRanges?: readonly ProtectedRange[];
        overlays?: readonly PreviewHighlight[];
        showProtected?: boolean;
        protectFormatting?: boolean;
        actor?: string;
        constraints?: "controlled" | "open";
        beforeTransaction?: (transaction: KernelTransaction, meta: TransactionMeta) => boolean | void;
        paste?: "formatted" | "plain";
        spellcheck?: boolean;
        engine?: "auto" | "flow" | "paged";
        ariaLabel?: string;
        embeddedFonts?: EmbeddedFonts;
        fontRevision?: number;
    }> & Readonly<{
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
    }>, {
        exec: (command: CommandName, args?: unknown) => boolean;
        can: (command: CommandName) => boolean;
        focus: () => void;
        undo: () => boolean;
        redo: () => boolean;
        markSaved: () => void;
        clearHistory: () => void;
        getModel: () => DocsModel;
        getSelection: () => EditorSelection | null;
        setSelection: (selection: import("./docs-editor-entry.ts").DocSelection | null) => void;
        insertText: (text: string) => boolean;
        scrollToAnchor: (anchor: PreviewAnchor) => Promise<import("./docs-anchors").AnchorStatus>;
        scrollToPage: (page: number) => void | undefined;
        whenIdle: () => Promise<void>;
        relayout: () => Promise<void>;
        pageOf: (point: import("./docs-editor-entry.ts").DocPoint) => number | undefined;
        engine: () => "flow" | "paged";
        metrics: () => {
            inputMs: number[];
            settleMs: number[];
        };
        state: import("@vue/reactivity").ComputedRef<EditorViewState>;
        controller: import("./docs-editor-entry.ts").DocsEditorController;
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
    }, import("@vue/runtime-core").PublicProps, {}, false, {}, {}, import("@vue/runtime-core").GlobalComponents, import("@vue/runtime-core").GlobalDirectives, string, {}, any, import("@vue/runtime-core").ComponentProvideOptions, {
        P: {};
        B: {};
        D: {};
        C: {};
        M: {};
        Defaults: {};
    }, Readonly<{
        model: DocsModel;
        context: DocsPreviewContext;
        readOnly?: boolean;
        zoom?: number | "fit-width";
        protectedRanges?: readonly ProtectedRange[];
        overlays?: readonly PreviewHighlight[];
        showProtected?: boolean;
        protectFormatting?: boolean;
        actor?: string;
        constraints?: "controlled" | "open";
        beforeTransaction?: (transaction: KernelTransaction, meta: TransactionMeta) => boolean | void;
        paste?: "formatted" | "plain";
        spellcheck?: boolean;
        engine?: "auto" | "flow" | "paged";
        ariaLabel?: string;
        embeddedFonts?: EmbeddedFonts;
        fontRevision?: number;
    }> & Readonly<{
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
    }>, {
        exec: (command: CommandName, args?: unknown) => boolean;
        can: (command: CommandName) => boolean;
        focus: () => void;
        undo: () => boolean;
        redo: () => boolean;
        markSaved: () => void;
        clearHistory: () => void;
        getModel: () => DocsModel;
        getSelection: () => EditorSelection | null;
        setSelection: (selection: import("./docs-editor-entry.ts").DocSelection | null) => void;
        insertText: (text: string) => boolean;
        scrollToAnchor: (anchor: PreviewAnchor) => Promise<import("./docs-anchors").AnchorStatus>;
        scrollToPage: (page: number) => void | undefined;
        whenIdle: () => Promise<void>;
        relayout: () => Promise<void>;
        pageOf: (point: import("./docs-editor-entry.ts").DocPoint) => number | undefined;
        engine: () => "flow" | "paged";
        metrics: () => {
            inputMs: number[];
            settleMs: number[];
        };
        state: import("@vue/reactivity").ComputedRef<EditorViewState>;
        controller: import("./docs-editor-entry.ts").DocsEditorController;
    }, {}, {}, {}, {}> | undefined>;
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
declare const __VLS_export: __VLS_WithSlots<typeof __VLS_base, __VLS_Slots>;
declare const _default: typeof __VLS_export;
export default _default;
type __VLS_WithSlots<T, S> = T & {
    new (): {
        $slots: S;
    };
};
