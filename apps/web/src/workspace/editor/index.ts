// MuffinOffice 正文编辑器的接入层：组件样式与主题映射随入口加载，内核按需懒加载。
import "@muffin-office/vue/style.css";
import "./moTheme.css";

export { DocsEditor } from "@muffin-office/vue/docs-editor";
export type {
  BlockedEvent,
  CommandName,
  DocPoint,
  DocSelection,
  EditorSelection,
  EditorViewState,
  FormatState,
  KernelTransaction,
  ProtectedRange,
  TransactionMeta,
} from "@muffin-office/vue/docs-editor";
export type { PreviewHighlight, HighlightTone } from "@muffin-office/vue/docs-anchors";
export type { DocsModel, DocsPreviewContext } from "@muffin-office/core/types";
export * from "./anchors.ts";
export * from "./docsSnapshot.ts";
export * from "./engine.ts";
export * from "./protections.ts";
