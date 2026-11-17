import WritingCitationsPanel from "../writing-citations/WritingCitationsPanel.vue";
import type { WritingPanelDefinition } from "./panels.ts";

/**
 * 写作页副驾面板登记处。与 panels.ts 的接口定义分开，使只依赖接口与筛选逻辑的模块不必加载面板组件。
 * 协调者整合各切片时在此 import 组件并追加一项，写作页无需改动。
 */
export const WRITING_PANELS: readonly WritingPanelDefinition[] = [
  { id: "citations", label: "引用", order: 30, component: WritingCitationsPanel, placement: "document" },
];
