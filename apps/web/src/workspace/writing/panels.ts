import type { Component } from "vue";
import type { PreviewHighlight } from "@muffin-office/vue/docs-anchors";
import type { BackendServices, ProjectRead } from "../../services/index.ts";
import type { DocsSnapshot } from "../editor/docsSnapshot.ts";
import type { WritingAnchor } from "../workspaceRoutes.ts";

/**
 * 写作页副驾坞的面板注册表。各切片的面板（助手、格式、导入、导出、引用）在自己的目录里实现组件，
 * 由协调者在 registry.ts 的 WRITING_PANELS 中登记；写作页按登记与当前正文状态动态渲染标签，未登记的能力不出现入口。
 */
export interface WritingPanelDocument {
  id: string;
  version: number;
  snapshot: DocsSnapshot;
}

/** 单段文字选区，偏移为 Unicode 标量（左闭右开）；折叠光标为 start === end 且 text 为空。跨段选区不提供给面板。 */
export interface WritingSelection {
  node: string;
  start: number;
  end: number;
  text: string;
}

/** 正文锚点与深链格式统一定义在 workspaceRoutes（formatWritingAnchor / parseWritingAnchor）。 */
export type { WritingAnchor } from "../workspaceRoutes.ts";

/** 面板组件的 props。 */
export interface WritingPanelProps {
  services: BackendServices;
  project: ProjectRead;
  /** 当前可编辑的正式稿（v2）；空项目或旧版结构为 null。 */
  document: WritingPanelDocument | null;
  selection: WritingSelection | null;
  /** 当前编辑无未保存改动且为最新版本：候选、写入类动作在 false 时禁用并说明。 */
  eligible: boolean;
}

/** 面板组件的 emits。 */
export interface WritingPanelEmits {
  /** 在纸面上画候选差异、命中等，按 group 整组替换（空数组即清除）。 */
  overlays: [group: string, highlights: PreviewHighlight[]];
  /** 滚动定位并闪烁。 */
  focus: [anchor: WritingAnchor];
  /** 服务端已生成新版本（采纳、导入、恢复等），写作页重载正文。 */
  changed: [];
  close: [];
}

export type WritingPanelPlacement = "document" | "empty" | "always";

export interface WritingPanelDefinition {
  /** 稳定 ID：assistant / format / import / export / citations … 也用于 `?panel=` 深链。 */
  id: string;
  label: string;
  /** 标签排序；内置“版本”为 90。 */
  order: number;
  component: Component;
  /** document：有可编辑正文时；empty：空项目时；always：都显示。 */
  placement: WritingPanelPlacement;
  /** 选区气泡的“请 AI 起草”打开此面板（只取第一个登记者）。 */
  drafts?: boolean;
  /** 空项目页的入口按钮文字，点击打开此面板（如“从资料导入”）。 */
  emptyAction?: string;
}

/** 内置“版本”面板的 ID，供深链与测试使用。 */
export const HISTORY_PANEL_ID = "history";

/** 当前应显示的面板（按 order 排序）。 */
export function availablePanels(panels: readonly WritingPanelDefinition[], hasDocument: boolean): WritingPanelDefinition[] {
  return panels
    .filter((panel) => panel.placement === "always" || panel.placement === (hasDocument ? "document" : "empty"))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
