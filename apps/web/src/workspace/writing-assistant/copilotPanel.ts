import type { WritingSelection as CopilotSelection } from "../writing/panels.ts";
import type { RevisionNodeSelection } from "../../services/contracts/api.generated.ts";

/**
 * 写作页副驾面板契约的别名：唯一定义在 writing/panels.ts（锚点在 workspaceRoutes.ts），此处沿用切片内的命名。
 */
export type {
  WritingSelection as CopilotSelection,
  WritingPanelDocument as CopilotDocument,
  WritingPanelProps as CopilotPanelProps,
  WritingAnchor as CopilotAnchor,
  WritingPanelEmits as CopilotPanelEmits,
} from "../writing/panels.ts";

/** 纸面选区 → 服务端 v2 节点选区。 */
export function nodeSelectionOf(selection: CopilotSelection): RevisionNodeSelection {
  return { node_id: selection.node, start: selection.start, end: selection.end, expected_text: selection.text };
}

/** 选区只能是同一段落内的非空文字。 */
export function selectionUsable(selection: CopilotSelection | null): selection is CopilotSelection {
  return !!selection && selection.end > selection.start && !!selection.text.trim();
}
