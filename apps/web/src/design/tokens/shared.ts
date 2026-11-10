/** 与主题无关的共享刻度：字号、间距、层级、时长、断点 */

export interface TypeStep {
  id: string;
  label: string;
  size: number;
  line: number;
  weight: string;
  family: "display" | "body" | "prose" | "mono" | "label" | "hand";
  use: string;
}

export const typeScale: TypeStep[] = [
  { id: "display-xl", label: "巨幅", size: 64, line: 1.08, weight: "display", family: "display", use: "封面、里程碑庆祝" },
  { id: "display", label: "展示", size: 44, line: 1.12, weight: "display", family: "display", use: "页面主标题、看板大数字" },
  { id: "title", label: "标题", size: 28, line: 1.25, weight: "display", family: "display", use: "模块标题、对话框标题" },
  { id: "heading", label: "小标题", size: 20, line: 1.35, weight: "heading", family: "body", use: "卡片标题、分区标题" },
  { id: "subheading", label: "条目标题", size: 16, line: 1.45, weight: "heading", family: "body", use: "列表条目、表单分组" },
  { id: "body", label: "界面正文", size: 14, line: 1.65, weight: "400", family: "body", use: "界面默认文字" },
  { id: "prose", label: "稿纸正文", size: 16, line: 1.95, weight: "400", family: "prose", use: "论文正文（编辑器）" },
  { id: "caption", label: "注释", size: 12.5, line: 1.55, weight: "400", family: "body", use: "元信息、帮助文字" },
  { id: "label", label: "眉题", size: 11, line: 1.3, weight: "600", family: "label", use: "分组眉题、表头" },
  { id: "mono", label: "等宽", size: 12, line: 1.5, weight: "500", family: "mono", use: "版本号、ID、时间戳" },
  { id: "hand", label: "手写", size: 15, line: 1.5, weight: "400", family: "hand", use: "铅笔批注、便签（≤ 20 字）" },
];

/** 4px 网格 */
export const spacing = [
  { id: "0.5", px: 2, use: "图标与文字的光学微调" },
  { id: "1", px: 4, use: "紧凑元素内距" },
  { id: "2", px: 8, use: "控件内元素间距" },
  { id: "3", px: 12, use: "卡片内行距、表单项间距" },
  { id: "4", px: 16, use: "卡片内边距（紧凑）" },
  { id: "5", px: 20, use: "卡片内边距（舒适）" },
  { id: "6", px: 24, use: "卡片之间、分区内间距" },
  { id: "8", px: 32, use: "分区之间" },
  { id: "12", px: 48, use: "页面段落之间" },
  { id: "16", px: 64, use: "页面级留白" },
];

/** 层级：z 轴语义（数值只在此处定义） */
export const layers = [
  { id: "canvas", z: 0, label: "L0 画布", what: "背景与纹理", shadow: "—" },
  { id: "surface", z: 1, label: "L1 纸面", what: "卡片、稿纸、面板", shadow: "shadow-1" },
  { id: "raised", z: 10, label: "L2 浮起", what: "悬停卡片、吸顶栏、拖拽中", shadow: "shadow-2" },
  { id: "floating", z: 30, label: "L3 浮动", what: "菜单、气泡、副驾坞、任务托盘", shadow: "shadow-3" },
  { id: "modal", z: 50, label: "L4 模态", what: "对话框、抽屉 + 遮罩", shadow: "shadow-4" },
  { id: "command", z: 70, label: "L5 指令", what: "指令面板、轻提示、会话失效覆盖", shadow: "shadow-4" },
];

/** 时长基准（毫秒）；主题通过 durScale 整体缩放 */
export const durations = [
  { id: "instant", ms: 90, use: "悬停变色、焦点环" },
  { id: "fast", ms: 150, use: "按压、开关、复选" },
  { id: "base", ms: 230, use: "标签滑块、气泡、菜单" },
  { id: "moderate", ms: 340, use: "抽屉、卡片展开、列表重排" },
  { id: "slow", ms: 520, use: "页面转场、对话框、主题切换" },
  { id: "deliberate", ms: 760, use: "签名动效：落墨、钤印、航线推进" },
];

export const breakpoints = [
  { id: "compact", min: 0, note: "< 960：副驾坞改为覆盖式抽屉，航线轨收为图标" },
  { id: "regular", min: 960, note: "960–1439：航线轨图标 + 舞台 + 可收起副驾坞" },
  { id: "wide", min: 1440, note: "≥ 1440：三栏常驻，多助手可并排两栏" },
];
