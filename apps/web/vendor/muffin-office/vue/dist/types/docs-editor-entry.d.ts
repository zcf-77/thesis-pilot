export { default as DocsEditor } from './DocsEditor.vue';
export { default as DocsEditorPage } from './DocsEditorPage.vue';
export type { EditorSelection, EditorViewState } from './DocsEditor.vue';
export { DocsEditorController, DocOpsError, SLICE_MIME, applyOp, applyOps, createId, mapAnchor, mapPoint, mapRange, } from './docs-editor/index.ts';
export type { BlockedEvent, CommandName, DocOp, DocPoint, DocSelection, FormatState, KernelTransaction, MapStep, ProtectedKind, ProtectedRange, SliceBlock, TransactionMeta, TransactionSource, } from './docs-editor/index.ts';
