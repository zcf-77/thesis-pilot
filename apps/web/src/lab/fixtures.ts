/**
 * 展台样例数据（自制）。人物、学校、规范、文献均为虚构样例，不对应任何真实机构或出版物。
 * 全量实现时由 mock 服务的数据仓库提供，这里只服务于组件展示。
 */
import type {
  CandidateView,
  ConfigNodeView,
  FeedbackView,
  IssueView,
  JobView,
  LiteratureView,
  MaterialView,
  PlanBarView,
  RequirementView,
  RunStepView,
  ScoreDimView,
  StageView,
  SuggestionView,
  TaskView,
  VersionView,
} from "@/domain/types";

export const project = {
  title: "面向校园二手交易平台的混合推荐算法设计与实现",
  short: "推荐算法毕设",
  student: "林知夏",
  docVersion: 13,
  words: 8460,
};

export const stages: StageView[] = [
  { id: "s1", name: "开题", state: "done", date: "09-20" },
  { id: "s2", name: "中期检查", state: "done", date: "10-30" },
  { id: "s3", name: "论文撰写", state: "current", date: "至 12-20" },
  { id: "s4", name: "论文提交", state: "upcoming", date: "12-25" },
  { id: "s5", name: "答辩", state: "upcoming", date: "01-08" },
  { id: "s6", name: "结束", state: "upcoming" },
];

export const tasks: TaskView[] = [
  {
    id: "t1",
    title: "完成第 3 章「系统设计」初稿",
    status: "verify",
    acceptance: "包含总体架构、召回、排序三节，不少于 4000 字",
    due: "11-14 周六",
    dueState: "soon",
    chapter: "第 3 章",
    dependsOn: [
      { title: "开题报告定稿", done: true },
      { title: "第 2 章定稿", done: true },
    ],
    evidence: [
      { id: "e1", kind: "document", label: "正文", version: 13 },
      { id: "e2", kind: "file", label: "系统架构图.png", version: 2 },
    ],
  },
  {
    id: "t2",
    title: "补充协同过滤对比实验",
    status: "doing",
    acceptance: "至少两个基线方法，给出召回率与耗时",
    due: "11-09 周一",
    dueState: "overdue",
    chapter: "3.2 节",
    dependsOn: [
      { title: "整理实验数据集", done: true },
      { title: "实现基线方法 B", done: false },
    ],
  },
  {
    id: "t3",
    title: "提交中期检查表",
    status: "confirmed",
    due: "10-30",
    confirmedAt: "10-29 21:40",
    evidence: [{ id: "e3", kind: "file", label: "中期检查表.docx", version: 1 }],
  },
  {
    id: "t4",
    title: "第 2 章「相关技术」定稿",
    status: "confirmed",
    chapter: "第 2 章",
    confirmedAt: "11-02 16:05",
    evidence: [{ id: "e4", kind: "document", label: "正文", version: 9, stale: true }],
  },
  { id: "t5", title: "按模板整理参考文献格式", status: "todo", due: "12-22", hardDeadline: true, chapter: "参考文献" },
];

export const candidatePending: CandidateView = {
  id: "C-204",
  agent: "content",
  goal: "润色 3.2 节第 4 段：更学术、更明确",
  scope: "第 3 章 · 3.2 协同过滤召回 · 选区 96 字",
  baseVersion: 12,
  currentVersion: 12,
  status: "pending",
  basis: ["撰写规范 §2.3：结论应有数据支撑", "你在本次会话中的要求：“不要改数字”"],
  hunks: [
    {
      id: "h1",
      decision: "accepted",
      reason: "“进行召回”偏口语，改成明确的动宾结构。",
      segments: [
        { t: "eq", text: "本文采用基于物品的协同过滤算法" },
        { t: "del", text: "进行召回" },
        { t: "ins", text: "完成候选商品的召回" },
        { t: "eq", text: "。" },
      ],
    },
    {
      id: "h2",
      decision: "accepted",
      reason: "去掉“很多”这类模糊说法；数字和引用没有动。",
      segments: [
        { t: "eq", text: "实验表明，该方法在自建数据集上的召回率达到 " },
        { t: "protect", text: "71.4%", kind: "number" },
        { t: "eq", text: "，" },
        { t: "del", text: "比基线提升很多" },
        { t: "ins", text: "较基线方法有明显提升" },
        { t: "protect", text: "[7]", kind: "citation" },
        { t: "eq", text: "。" },
      ],
    },
    {
      id: "h3",
      decision: "pending",
      reason: "点明术语“冷启动”，和 3.4 节呼应。这一处改动较大，你看看是否符合原意。",
      segments: [
        { t: "del", text: "但是新商品效果不太好，因为没有交互数据。" },
        { t: "ins", text: "但对于缺少交互记录的新上架商品，该方法难以给出有效召回，即冷启动问题。" },
      ],
    },
  ],
  checks: [
    { id: "number", label: "数字", result: "pass", detail: "1 处数字，未被改动" },
    { id: "citation", label: "引用", result: "pass", detail: "1 处引用标记，未被改动" },
    { id: "formula", label: "公式", result: "unsupported", detail: "公式对象暂不支持自动校验；本段公式已整体锁定" },
    { id: "lock", label: "锁定", result: "pass" },
    { id: "range", label: "范围", result: "pass", detail: "所有改动都在选区内" },
    { id: "version", label: "版本", result: "pass", detail: "正文仍为 v12" },
  ],
};

export const candidateInvalid: CandidateView = {
  id: "C-205",
  agent: "content",
  goal: "把实验结论写得更有说服力",
  scope: "第 3 章 · 3.2 协同过滤召回 · 选区 41 字",
  baseVersion: 13,
  currentVersion: 13,
  status: "invalid",
  basis: [],
  hunks: [
    {
      id: "h1",
      decision: "pending",
      reason: "强化结论的力度。",
      blocked: "候选把受保护的数字 71.4% 改成了 78.2%，已拦截。",
      segments: [
        { t: "eq", text: "该方法在自建数据集上的召回率达到 " },
        { t: "protect", text: "78.2%", kind: "number", violated: true },
        { t: "eq", text: "，" },
        { t: "ins", text: "显著优于现有方法" },
        { t: "eq", text: "。" },
      ],
    },
  ],
  checks: [
    { id: "number", label: "数字", result: "fail", detail: "71.4% → 78.2%：数字被改动" },
    { id: "citation", label: "引用", result: "pass" },
    { id: "lock", label: "锁定", result: "pass" },
    { id: "range", label: "范围", result: "pass" },
    { id: "version", label: "版本", result: "pass" },
  ],
};

export const candidateExpired: CandidateView = {
  id: "C-198",
  agent: "format",
  goal: "统一 3.1 节的术语写法",
  scope: "第 3 章 · 3.1 总体架构",
  baseVersion: 11,
  currentVersion: 13,
  status: "expired",
  basis: [],
  hunks: [
    {
      id: "h1",
      decision: "pending",
      reason: "全文统一使用“召回层”。",
      segments: [
        { t: "eq", text: "系统由" },
        { t: "del", text: "召回模块" },
        { t: "ins", text: "召回层" },
        { t: "eq", text: "、排序层与服务层组成。" },
      ],
    },
  ],
  checks: [{ id: "version", label: "版本", result: "fail", detail: "基于 v11，当前 v13" }],
};

export const candidateGenerating: CandidateView = {
  id: "C-206",
  agent: "content",
  goal: "压缩 3.3 节第 2 段，控制在 150 字内",
  scope: "第 3 章 · 3.3 排序模型 · 选区 214 字",
  baseVersion: 13,
  currentVersion: 13,
  status: "generating",
  basis: [],
  hunks: [],
  checks: [],
};

export const runSteps: RunStepView[] = [
  { id: "r1", agent: "format", title: "检查第 3 章格式要求", status: "done", detail: "7 条硬规则已检查，1 条不能判定" },
  { id: "r2", agent: "lit", title: "检索“冷启动 推荐”样例文献", status: "failed", detail: "模拟：检索服务限流。其他子任务结果不受影响。" },
  { id: "r3", agent: "content", title: "为 3.2 节生成修订候选", status: "running" },
  { id: "r4", agent: "progress", title: "评估对本周计划的影响", status: "waiting" },
];

export const suggestions: SuggestionView[] = [
  {
    id: "g1",
    level: "important",
    title: "第 3 章比计划晚了 5 天",
    body: "照这样下去，12-20 写完会比较紧。我准备了一份调整方案，你看看要不要用。",
    event: "明显延期",
    at: "11-11 09:00",
    related: ["任务 · 补充协同过滤对比实验", "第 3 章 · 3.2 节"],
    basis: ["任务「补充协同过滤对比实验」原定 11-09，尚未确认完成", "硬截止「论文提交 12-25」前还有 4 个任务未开始"],
    uncertainty: "过去 4 天没有观察到正文编辑，但这不代表你没在做实验或查资料。",
    state: "unread",
  },
  {
    id: "g2",
    level: "normal",
    title: "第 2 章已确认完成，要不要做一次章节评审？",
    body: "评审只给问题清单和参考分，不会改正文，也不影响任务状态。",
    event: "完成重要章节",
    at: "11-02 16:05",
    related: ["第 2 章 · 相关技术", "正文 v9"],
    basis: ["你在 11-02 确认了任务「第 2 章定稿」"],
    state: "read",
  },
];

export const feedback: FeedbackView = {
  id: "F-07",
  original: "第三章的系统架构讲得太笼统，模块之间怎么交互看不出来。另外实验部分对比的基线太少，至少要有两个。还有那个图不太行。",
  source: "周老师（样例导师）· 微信转述",
  at: "11-08 19:22",
  docVersion: 11,
  items: [
    { id: "i1", text: "补充模块之间的交互说明（可用时序图或数据流图）", locate: "第 3 章 · 3.1 总体架构", taskTitle: "完善 3.1 架构说明", handled: true },
    {
      id: "i2",
      text: "对比实验的基线方法增加到至少两个",
      locate: "第 3 章 · 3.2 协同过滤召回",
      taskTitle: "补充协同过滤对比实验",
      handled: false,
      correctedByStudent: true,
    },
    { id: "i3", text: "“那个图不太行” —— 原话没有指明是哪一张图", flag: "ambiguous", handled: false },
  ],
};

export const materials: MaterialView[] = [
  {
    id: "m1",
    name: "示例学院本科毕业论文撰写规范",
    ext: "pdf",
    category: "规范",
    version: 2,
    status: "parsed",
    size: "1.2 MB",
    at: "11-09 20:14",
    recognized: 42,
  },
  {
    id: "m2",
    name: "毕业论文模板（理工类）",
    ext: "docx",
    category: "模板",
    version: 3,
    status: "partial",
    size: "86 KB",
    at: "11-09 20:16",
    recognized: 31,
    unrecognized: 3,
    diagnosis: "未识别：奇偶页页眉差异、目录域、封面文本框。可手动补充，形成新版本。",
  },
  { id: "m3", name: "协同过滤综述（样例）", ext: "pdf", category: "文献附件", version: 1, status: "processing", progress: 62, size: "2.4 MB", at: "刚刚" },
  {
    id: "m4",
    name: "中期检查意见（拍照）",
    ext: "jpg",
    category: "导师反馈",
    version: 1,
    status: "failed",
    size: "3.1 MB",
    at: "11-08 19:30",
    diagnosis: "模拟：图片文字无法提取。原件已保存，可重试或手动录入原文。",
  },
  {
    id: "m5",
    name: "开题报告终稿",
    ext: "docx",
    category: "参考材料",
    version: 2,
    status: "parsed",
    size: "54 KB",
    at: "11-10 08:02",
    recognized: 18,
    duplicateOf: 1,
  },
];

export const requirements: RequirementView[] = [
  {
    id: "R-003",
    text: "正文字数不少于 12000 字",
    kind: "hard",
    category: "字数",
    param: "≥ 12000",
    source: "撰写规范 §3.1",
    version: 2,
    verdict: "fail",
    verdictNote: "当前 8,460 字（正文 v13，程序统计，不含图表与参考文献）",
  },
  {
    id: "R-009",
    text: "参考文献不少于 15 篇，近五年文献占比不低于三分之一",
    kind: "hard",
    category: "引用",
    param: "≥ 15 篇 · 近五年 ≥ 1/3",
    source: "撰写规范 §4.2",
    version: 2,
    verdict: "pass",
    verdictNote: "当前 18 篇，其中近五年 9 篇",
  },
  {
    id: "R-014",
    text: "论证层次清晰，结论应有数据或文献支撑",
    kind: "semantic",
    category: "内容",
    source: "撰写规范 §2.3",
    version: 2,
    verdict: "advice",
    verdictNote: "3.2 节第 4 段的结论缺少与基线的数值对比（AI 判断，供参考）",
  },
  {
    id: "R-021",
    text: "一级标题使用三号黑体，居中",
    kind: "hard",
    category: "格式",
    param: "三号 · 黑体 · 居中",
    source: "模板 v3 · 标题样式",
    version: 3,
    verdict: "unknown",
    verdictNote: "当前文档不携带字号信息，无法判定。",
  },
  {
    id: "R-006",
    text: "摘要字数",
    kind: "hard",
    category: "字数",
    param: "300–500 字 ⟂ ≤ 300 字",
    source: "撰写规范 §3.4 / 模板 v3 · 摘要页说明",
    version: 2,
    verdict: "conflict",
    verdictNote: "规范写 300–500 字，模板写不超过 300 字。需要你或老师确认以哪个为准。",
  },
  {
    id: "R-030",
    text: "实验数据须注明来源",
    kind: "semantic",
    category: "内容",
    version: 1,
    verdict: "nosource",
    verdictNote: "只出现在导师转述里，没有找到规范原文，暂不作为检查项。",
  },
];

export const literature: LiteratureView[] = [
  {
    id: "L-012",
    title: "面向稀疏交互的物品协同过滤改进方法",
    meta: "样例作者甲、样例作者乙 · 2023 · 自制样例库 #L-012",
    coverage: { biblio: true, abstract: true, fulltext: true },
    verify: "verified",
    saved: true,
  },
  {
    id: "L-020",
    title: "校园场景下推荐系统冷启动问题综述",
    meta: "样例作者丙 · 2022 · 自制样例库 #L-020",
    coverage: { biblio: true, abstract: true, fulltext: false },
    verify: "verified",
    note: "只取得摘要：助手只会依据摘要回答，不会引用正文细节。",
  },
  {
    id: "L-027",
    title: "图神经网络推荐方法的比较研究",
    meta: "样例作者丁 等 · 2021 / 2022 · 自制样例库 #L-027",
    coverage: { biblio: true, abstract: false, fulltext: false },
    verify: "conflict",
    note: "两处来源的年份不一致（2021 / 2022），请核对后再引用。",
  },
  {
    id: "L-031",
    title: "二手交易平台用户行为分析",
    meta: "作者未知 · 年份未知 · 自制样例库 #L-031",
    coverage: { biblio: true, abstract: false, fulltext: false },
    verify: "unverified",
    note: "来源链接不可用，无法核实。暂不能用于提问或引用。",
  },
];

export const scoreDims: ScoreDimView[] = [
  { id: "d1", name: "结构与逻辑", score: 21, full: 25 },
  { id: "d2", name: "内容与论证", score: 17, full: 25, note: "3.2 节结论缺少数据支撑" },
  { id: "d3", name: "规范与格式", score: null, full: 25, note: "缺少字号信息" },
  { id: "d4", name: "语言表达", score: 20, full: 25 },
];
export const unchecked = ["图 3-2、图 3-4：图片内容未检查（当前不解析图像）", "公式 (3-1)–(3-6)：只检查了编号连续性，未检查推导", "第 5 章：尚无正文，未评审"];
export const issues: IssueView[] = [
  {
    id: "q1",
    severity: "major",
    title: "3.2 节的结论缺少数据支撑",
    location: "第 3 章 › 3.2 › 第 4 段",
    basis: "要求 R-014（语义）· 撰写规范 §2.3",
    suggestion: "给出与至少一个基线方法的召回率对比，或说明将在第 5 章给出。",
  },
  {
    id: "q2",
    severity: "minor",
    title: "术语不一致：“冷启动 / 冷开始”混用",
    location: "第 3 章 › 3.2、3.4",
    basis: "术语一致性检查（程序）",
    suggestion: "统一为“冷启动”。",
  },
  {
    id: "q3",
    severity: "advice",
    title: "3.1 节可以先给出架构图，再分层说明",
    location: "第 3 章 › 3.1",
    basis: "AI 建议，无对应硬性要求",
    suggestion: "把图 3-1 提前到本节第一段之后。",
  },
];

export const jobs: JobView[] = [
  {
    id: "J-881",
    kind: "parse",
    title: "解析：协同过滤综述（样例）.pdf",
    status: "running",
    progress: 62,
    scope: "资料 M-031 v1",
    snapshot: "解析配置 v2",
    attempt: 1,
  },
  {
    id: "J-880",
    kind: "review",
    title: "评审：第 3 章",
    status: "done",
    scope: "正文 v13 · 第 3 章",
    snapshot: "评审智能体 v4 · 量表 v2 · 要求 v2",
    attempt: 1,
  },
  {
    id: "J-879",
    kind: "search",
    title: "检索：冷启动 推荐",
    status: "partial",
    scope: "自制样例库",
    snapshot: "文献智能体 v3",
    attempt: 1,
    diagnosis: "4 条结果中 1 条来源不可用，已单独标出。",
  },
  {
    id: "J-878",
    kind: "generate",
    title: "修订候选：润色 3.2 节",
    status: "cancelled",
    scope: "正文 v12 · 选区 96 字",
    snapshot: "内容智能体 v5 · 提示词 v7",
    attempt: 1,
    diagnosis: "已取消；之后到达的 1 条结果已被丢弃。",
  },
  {
    id: "J-877",
    kind: "export",
    title: "导出 DOCX",
    status: "failed",
    scope: "正文 v13",
    snapshot: "转换服务（未接入）",
    attempt: 2,
    diagnosis: "DOCX 转换尚未接入。可以改为导出 HTML 或 JSON。",
  },
];

export const chainOk: ConfigNodeView[] = [
  { lib: "api", name: "示例接口 A", version: 3, state: "active" },
  { lib: "model", name: "示例模型 · 通用", version: 4, state: "active" },
  { lib: "prompt", name: "修订候选生成", version: 7, state: "active" },
  { lib: "agent", name: "内容辅助", version: 5, state: "active" },
];
export const chainBroken: ConfigNodeView[] = [
  { lib: "api", name: "示例接口 B", version: 2, state: "disabled", problem: "已于 11-10 停用" },
  { lib: "model", name: "示例模型 · 长文", version: 2, state: "invalid", problem: "所属接口已停用" },
  { lib: "prompt", name: "评审报告生成", version: 3, state: "active" },
  { lib: "agent", name: "论文评审", version: 4, state: "invalid", problem: "模型不可用，运行已阻止；不会自动换用其他模型" },
];

export const versions: VersionView[] = [
  { v: 13, at: "11-11 14:32", cause: "adopt", summary: "采纳 2 处修改 · 候选 C-204「润色 3.2 节第 4 段」", words: 8460, current: true },
  { v: 12, at: "11-11 14:05", cause: "manual", summary: "新增 3.3 节两段", words: 8431 },
  { v: 11, at: "11-08 22:47", cause: "manual", summary: "调整 3.1 节小标题", words: 8012 },
  { v: 10, at: "11-06 20:10", cause: "restore", summary: "恢复自 v8（v9 仍保留）", words: 7650 },
];

export const planBars: PlanBarView[] = [
  { id: "p1", title: "补充对比实验", start: 0, end: 4, newStart: 1, newEnd: 7 },
  { id: "p2", title: "第 3 章初稿", start: 2, end: 8, newStart: 7, newEnd: 12 },
  { id: "p3", title: "第 4 章 系统实现", start: 8, end: 18, newStart: 12, newEnd: 20 },
  { id: "p4", title: "第 5 章 测试与分析", start: 18, end: 24, newStart: 20, newEnd: 25 },
  { id: "p5", title: "参考文献整理", start: 24, end: 26, hard: true },
];
