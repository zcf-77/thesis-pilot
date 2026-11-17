import type { BackendServices, ProjectRead } from "../../services/index.ts";
import type { RevisionNodeSelection } from "../../services/contracts/api.generated.ts";
import type { DocsSnapshot } from "../editor/docsSnapshot.ts";
import type { PreviewHighlight } from "@muffin-office/vue/docs-anchors";

/**
 * 写作页副驾面板统一契约（内容助手、安全格式、导入、导出、引用面板共用）。
 * 写作页按“可用面板注册表”挂载：传入当前正文与纸面选区，接收纸面叠加、定位与“已生成新版本”通知。
 */
export interface CopilotSelection {
  node: string;
  /** Unicode 标量偏移（行内对象计 1）。 */
  start: number;
  end: number;
  text: string;
}
export interface CopilotDocument {
  id: string;
  version: number;
  snapshot: DocsSnapshot;
}
export interface CopilotPanelProps {
  services: BackendServices;
  project: ProjectRead;
  document: CopilotDocument | null;
  selection: CopilotSelection | null;
  /** 当前编辑无未保存改动且为最新版本；为 false 时候选与写入类动作禁用。 */
  eligible: boolean;
}
export interface CopilotAnchor {
  node: string;
  start?: number;
  end?: number;
}
export type CopilotPanelEmits = {
  overlays: [group: string, highlights: PreviewHighlight[]];
  focus: [anchor: CopilotAnchor];
  changed: [];
  close: [];
};

/** 纸面选区 → 服务端 v2 节点选区。 */
export function nodeSelectionOf(selection: CopilotSelection): RevisionNodeSelection {
  return { node_id: selection.node, start: selection.start, end: selection.end, expected_text: selection.text };
}

/** 选区只能是同一段落内的非空文字。 */
export function selectionUsable(selection: CopilotSelection | null): selection is CopilotSelection {
  return !!selection && selection.end > selection.start && !!selection.text.trim();
}
