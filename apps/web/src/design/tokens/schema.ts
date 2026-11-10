/**
 * 设计令牌契约（单一事实来源的“形状”）。
 * - 所有主题必须提供完全相同的令牌键；缺键在类型检查与 Vitest 中都会失败。
 * - 组件只允许消费语义令牌（--tp-*），不得直接写十六进制色值。
 */

export type ThemeId = "zhumo" | "yingguang" | "yehang" | "chenwu";
export type Mode = "light" | "dark";
export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export interface TokenDoc {
  group: string;
  label: string;
  use: string;
}

/** 颜色令牌：键即 CSS 变量名（--tp-<key>） */
export const colorTokens = {
  // —— 表面：从底到顶 ——
  canvas: { group: "表面", label: "画布", use: "应用最底层背景，承载所有纸面" },
  surface: { group: "表面", label: "纸面", use: "卡片、面板、编辑纸张" },
  "surface-raised": { group: "表面", label: "浮起面", use: "弹层、菜单、悬浮卡" },
  "surface-sunken": { group: "表面", label: "凹面", use: "输入槽、代码、轨道、次级分区" },
  "surface-inverse": { group: "表面", label: "反相面", use: "提示气泡、强调块、深色条" },
  scrim: { group: "表面", label: "遮罩", use: "对话框与抽屉背后的压暗层" },
  // —— 线条 ——
  line: { group: "线条", label: "分隔线", use: "列表、表格、分区之间的细线" },
  "line-strong": { group: "线条", label: "结构线", use: "需要强调的框线、表头、标尺" },
  outline: { group: "线条", label: "组件描边", use: "卡片、输入框等组件的外轮廓" },
  // —— 文字 ——
  text: { group: "文字", label: "正文", use: "一级文字、标题" },
  "text-muted": { group: "文字", label: "次要文字", use: "说明、元信息" },
  "text-faint": { group: "文字", label: "弱文字", use: "占位、禁用、装饰性标注（不承载关键信息）" },
  "text-inverse": { group: "文字", label: "反相文字", use: "反相面上的文字" },
  // —— 行动 ——
  action: { group: "行动", label: "主行动", use: "每个区域唯一的主按钮底色" },
  "action-hover": { group: "行动", label: "主行动·悬停", use: "主按钮悬停" },
  "action-content": { group: "行动", label: "主行动上的文字", use: "主按钮文字与图标" },
  accent: { group: "行动", label: "品牌强调", use: "链接、当前导航、焦点、关键数字" },
  "accent-soft": { group: "行动", label: "品牌强调·浅", use: "选中行、当前项的底色" },
  "accent-soft-content": { group: "行动", label: "品牌强调·浅上的文字", use: "浅底上的强调文字" },
  focus: { group: "行动", label: "焦点环", use: "键盘焦点可见性" },
  // —— 材质：铅笔 / 墨水 / 印章 / 留白 / 旧稿 ——
  ink: { group: "材质", label: "墨", use: "已成事实：学生写下或确认过的内容" },
  pencil: { group: "材质", label: "铅笔", use: "AI 提议、候选、尚未被采纳的一切" },
  "pencil-soft": { group: "材质", label: "铅笔·浅底", use: "候选卡片底色、候选插入文字底色" },
  "pencil-line": { group: "材质", label: "铅笔·线", use: "候选虚线描边、批注引线" },
  "pencil-content": { group: "材质", label: "铅笔·文字", use: "铅笔浅底上的文字" },
  seal: { group: "材质", label: "印章", use: "学生作出的决定：采纳、确认完成、已处理" },
  "seal-content": { group: "材质", label: "印章上的文字", use: "实心印章内的文字" },
  "seal-soft": { group: "材质", label: "印章·浅底", use: "决定记录行的底色" },
  "ghost-line": { group: "材质", label: "留白·线", use: "未知 / 不能判定 / 未检查的空位描边" },
  "ghost-fill": { group: "材质", label: "留白·纹", use: "未知空位的斜线纹理" },
  stale: { group: "材质", label: "旧稿", use: "过期候选、基于旧版本的报告文字" },
  "stale-soft": { group: "材质", label: "旧稿·浅底", use: "过期对象的底色" },
  highlight: { group: "材质", label: "荧光", use: "搜索命中、定位闪烁、刚被采纳的文字" },
  // —— 状态 ——
  success: { group: "状态", label: "成功", use: "圆点、进度、填充" },
  "success-soft": { group: "状态", label: "成功·浅底", use: "状态胶囊底色" },
  "success-content": { group: "状态", label: "成功·文字", use: "浅底或纸面上的文字与图标" },
  warning: { group: "状态", label: "注意", use: "圆点、进度、填充" },
  "warning-soft": { group: "状态", label: "注意·浅底", use: "状态胶囊底色" },
  "warning-content": { group: "状态", label: "注意·文字", use: "浅底或纸面上的文字与图标" },
  danger: { group: "状态", label: "危险", use: "圆点、进度、填充" },
  "danger-soft": { group: "状态", label: "危险·浅底", use: "状态胶囊底色" },
  "danger-content": { group: "状态", label: "危险·文字", use: "浅底或纸面上的文字与图标" },
  info: { group: "状态", label: "信息", use: "圆点、进度、填充" },
  "info-soft": { group: "状态", label: "信息·浅底", use: "状态胶囊底色" },
  "info-content": { group: "状态", label: "信息·文字", use: "浅底或纸面上的文字与图标" },
  neutral: { group: "状态", label: "中性", use: "圆点、进度、填充" },
  "neutral-soft": { group: "状态", label: "中性·浅底", use: "状态胶囊底色" },
  "neutral-content": { group: "状态", label: "中性·文字", use: "浅底或纸面上的文字与图标" },
  // —— 历史差异（事实对比，区别于“铅笔”候选差异）——
  "ins-bg": { group: "差异", label: "新增·底", use: "版本对比中的新增" },
  "ins-text": { group: "差异", label: "新增·字", use: "版本对比中的新增" },
  "del-bg": { group: "差异", label: "删除·底", use: "版本对比中的删除" },
  "del-text": { group: "差异", label: "删除·字", use: "版本对比中的删除" },
  // —— 保护对象 ——
  "protect-number": { group: "保护对象", label: "数字", use: "论文数字的保护下划线" },
  "protect-citation": { group: "保护对象", label: "引用", use: "引用标记的保护下划线" },
  "protect-formula": { group: "保护对象", label: "公式", use: "公式对象的保护描边" },
  "protect-lock": { group: "保护对象", label: "锁定", use: "学生手动锁定的片段" },
  // —— 助手身份（分类色，不表达好坏）——
  "agent-general": { group: "助手", label: "综合助手", use: "头像、标签页标记" },
  "agent-lit": { group: "助手", label: "文献查询", use: "头像、标签页标记" },
  "agent-content": { group: "助手", label: "内容辅助", use: "头像、标签页标记" },
  "agent-format": { group: "助手", label: "格式规范", use: "头像、标签页标记" },
  "agent-progress": { group: "助手", label: "进度管控", use: "头像、标签页标记" },
  "agent-review": { group: "助手", label: "论文评审", use: "头像、标签页标记" },
} as const satisfies Record<string, TokenDoc>;

export type ColorToken = keyof typeof colorTokens;

/** 非颜色令牌：字体、形状、阴影、质感、动效性格 */
export const varTokens = {
  "font-display": { group: "字体", label: "展示字体", use: "大标题、数字看板、空状态标题" },
  "font-body": { group: "字体", label: "界面字体", use: "界面正文、控件" },
  "font-prose": { group: "字体", label: "稿纸字体", use: "论文正文（编辑器纸面）" },
  "font-mono": { group: "字体", label: "等宽字体", use: "版本号、ID、代码、对齐数字" },
  "font-hand": { group: "字体", label: "手写字体", use: "铅笔批注、印章文字、便签（仅短句）" },
  "font-label": { group: "字体", label: "标签字体", use: "眉题、分组小标题" },
  "display-weight": { group: "字体", label: "展示字重", use: "展示字体使用的字重" },
  "display-tracking": { group: "字体", label: "展示字距", use: "展示字体的字距" },
  "heading-weight": { group: "字体", label: "标题字重", use: "区块标题字重" },
  "label-tracking": { group: "字体", label: "标签字距", use: "眉题字距" },
  "label-transform": { group: "字体", label: "标签大小写", use: "眉题是否大写（仅影响拉丁字母）" },
  "radius-xs": { group: "形状", label: "圆角 XS", use: "标记、保护下划线块、小徽标" },
  "radius-s": { group: "形状", label: "圆角 S", use: "按钮、输入、胶囊内元素" },
  "radius-m": { group: "形状", label: "圆角 M", use: "卡片、菜单" },
  "radius-l": { group: "形状", label: "圆角 L", use: "面板、对话框" },
  "radius-xl": { group: "形状", label: "圆角 XL", use: "大容器、场景外框" },
  "border-w": { group: "形状", label: "描边粗细", use: "组件外轮廓线宽" },
  "shadow-1": { group: "层级", label: "一层投影", use: "静止卡片" },
  "shadow-2": { group: "层级", label: "二层投影", use: "悬停、吸顶条" },
  "shadow-3": { group: "层级", label: "三层投影", use: "菜单、浮动坞" },
  "shadow-4": { group: "层级", label: "四层投影", use: "对话框、指令面板" },
  "shadow-press": { group: "层级", label: "按下投影", use: "按钮按下瞬间" },
  "action-fill": { group: "质感", label: "主行动填充", use: "主按钮背景（可为渐变）" },
  "canvas-image": { group: "质感", label: "画布纹理", use: "画布背景图层" },
  "canvas-size": { group: "质感", label: "画布纹理尺寸", use: "画布背景尺寸" },
  "surface-backdrop": { group: "质感", label: "纸面背板", use: "纸面 backdrop-filter（毛玻璃）" },
  "ease-standard": { group: "动效", label: "标准曲线", use: "状态内变化：颜色、尺寸、位置" },
  "ease-enter": { group: "动效", label: "进入曲线", use: "元素进入画面（减速）" },
  "ease-exit": { group: "动效", label: "离开曲线", use: "元素离开画面（加速）" },
  "enter-transform": { group: "动效", label: "进入起点", use: "进入动画的起始 transform" },
  "enter-filter": { group: "动效", label: "进入滤镜", use: "进入动画的起始 filter" },
  "press-transform": { group: "动效", label: "按压形变", use: "按钮按下的 transform" },
  "hover-transform": { group: "动效", label: "悬停形变", use: "可交互卡片悬停的 transform" },
  "seal-rotate": { group: "动效", label: "印章角度", use: "印章落定后的旋转角度" },
} as const satisfies Record<string, TokenDoc>;

export type VarToken = keyof typeof varTokens;

export interface ThemeDef {
  id: ThemeId;
  /** 中文名 */
  name: string;
  en: string;
  /** 单字徽记 */
  glyph: string;
  mode: Mode;
  tagline: string;
  story: string;
  mood: string[];
  bestFor: string;
  watchOut: string;
  motionCharacter: string;
  icon: IconWeight;
  color: Record<ColorToken, string>;
  /** 半透明令牌参与对比度计算时使用的等效不透明色 */
  contrastAs?: Partial<Record<ColorToken, string>>;
  vars: Record<VarToken, string>;
  /** 弹簧：由脚本求解为 CSS linear() 曲线与时长 */
  spring: { stiffness: number; damping: number; mass: number };
  /** 时长缩放：主题的“快慢性格” */
  durScale: number;
  daisy: { depth: 0 | 1; noise: 0 | 1 };
}

/** 对比度契约：[前景, 背景, 最低比值, 说明] */
export const contrastPairs: [ColorToken, ColorToken, number, string][] = [
  ["text", "canvas", 7, "正文 / 画布"],
  ["text", "surface", 7, "正文 / 纸面"],
  ["text", "surface-sunken", 7, "正文 / 凹面"],
  ["text-muted", "canvas", 4.5, "次要文字 / 画布"],
  ["text-muted", "surface", 4.5, "次要文字 / 纸面"],
  ["text-faint", "surface", 3, "弱文字 / 纸面（仅装饰与占位）"],
  ["text-inverse", "surface-inverse", 7, "反相文字 / 反相面"],
  ["action-content", "action", 4.5, "主按钮文字 / 主按钮"],
  ["action-content", "action-hover", 4.5, "主按钮文字 / 悬停"],
  ["accent", "surface", 4.5, "强调文字 / 纸面"],
  ["accent", "canvas", 4.5, "强调文字 / 画布"],
  ["accent-soft-content", "accent-soft", 4.5, "强调浅底文字"],
  ["focus", "surface", 3, "焦点环 / 纸面"],
  ["pencil", "surface", 3, "铅笔线与图标 / 纸面"],
  ["pencil-content", "pencil-soft", 4.5, "铅笔文字 / 铅笔浅底"],
  ["pencil-content", "surface", 4.5, "铅笔文字 / 纸面"],
  ["seal-content", "seal", 4.5, "印章文字 / 印章"],
  ["seal", "surface", 3, "空心印章 / 纸面"],
  ["stale", "surface", 3, "旧稿文字 / 纸面（已降级）"],
  ["success-content", "success-soft", 4.5, "成功文字 / 浅底"],
  ["success-content", "surface", 4.5, "成功文字 / 纸面"],
  ["warning-content", "warning-soft", 4.5, "注意文字 / 浅底"],
  ["warning-content", "surface", 4.5, "注意文字 / 纸面"],
  ["danger-content", "danger-soft", 4.5, "危险文字 / 浅底"],
  ["danger-content", "surface", 4.5, "危险文字 / 纸面"],
  ["info-content", "info-soft", 4.5, "信息文字 / 浅底"],
  ["info-content", "surface", 4.5, "信息文字 / 纸面"],
  ["neutral-content", "neutral-soft", 4.5, "中性文字 / 浅底"],
  ["ins-text", "ins-bg", 4.5, "新增文字 / 新增底"],
  ["del-text", "del-bg", 4.5, "删除文字 / 删除底"],
];
