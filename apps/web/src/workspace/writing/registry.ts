import WritingAssistantPanel from "../writing-assistant/WritingAssistantPanel.vue";
import WritingCitationsPanel from "../writing-citations/WritingCitationsPanel.vue";
import WritingExportPanel from "../writing-export/WritingExportPanel.vue";
import WritingFormatPanel from "../writing-format/WritingFormatPanel.vue";
import WritingImportPanel from "../writing-import/WritingImportPanel.vue";
import type { WritingPanelDefinition } from "./panels.ts";

/**
 * 写作页副驾面板登记处。与 panels.ts 的接口定义分开，使只依赖接口与筛选逻辑的模块不必加载面板组件。
 * 协调者整合各切片时在此 import 组件并追加一项，写作页无需改动。
 */
export const WRITING_PANELS: readonly WritingPanelDefinition[] = [
  { id: "assistant", label: "助手", order: 10, component: WritingAssistantPanel, placement: "document", drafts: true },
  { id: "format", label: "格式", order: 20, component: WritingFormatPanel, placement: "document" },
  { id: "citations", label: "引用", order: 30, component: WritingCitationsPanel, placement: "document" },
  // Word 导入：空项目建立正式稿，已有正文时作为新版本导入，两种状态都提供。
  { id: "import", label: "导入", order: 40, component: WritingImportPanel, placement: "always", emptyAction: "导入 Word" },
  { id: "export", label: "导出", order: 50, component: WritingExportPanel, placement: "document" },
];
