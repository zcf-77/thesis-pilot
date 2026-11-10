# 毕设智途 ThesisPilot

面向毕业论文全过程的前端设计展台。产品原则：**AI 主动判断并提供帮助，重要节点介入，学生最终决定。**

> **当前阶段：设计语言与组件展台（v0.1，待确认）。**
> 本仓库目前交付的是设计规范、四套视觉方案、设计令牌、基础与业务展示组件和九页设计展台。
> **业务流程、Mock 服务、编辑器适配层尚未实现** —— 它们依赖你对方案的确认，见文末「下一步」。

## 运行（Windows PowerShell）

从仓库根目录进入本目录。以下命令需要 Node 26.13.0、pnpm 11.25.0 和 Vite+ 1.6.0；版本约束见 `.node-version`、`package.json` 与 `pnpm-workspace.yaml`。

```powershell
Set-Location apps/web
npm install --global vite-plus@1.6.0  # 已安装相同版本时可跳过
vp install --frozen-lockfile
vp dev --host 127.0.0.1
```

开发服务器地址以终端输出为准。检查和构建仍从本目录执行：

```powershell
vp run check                   # 格式、Oxlint 与 Vue 类型检查
vp test run                    # 令牌、对比度、弹簧、状态词汇表单元测试
vp build                       # 构建 dist/ 与单文件展台
vp exec playwright install chromium
vp run test:e2e                # 使用 127.0.0.1:18744，需先构建
vp run shots                   # 截图到 test-results/design-lab.png，需先构建
```

端到端测试自行启动预览服务，端口占用时失败，不复用其他会话的服务。构建后也可直接双击 `dist/thesispilot-design-lab.html` 查看九个页面。

其他维护命令：`vp run tokens` 重新生成令牌与对比度报告；`vp run fonts` 依赖 `python3`、fonttools、brotli 和字体源文件。`scripts/evidence.sh` 是原来源环境的 Bash 证据脚本，会替换 `docs/design/screens/` 并重建 PDF，不属于 Windows 常规检查命令。

## 来源与验证记录

本目录从 2026-11-12 提供的源码包导入。原作者的 Linux/Chromium 验证与截图记录保留于 [VERIFICATION.md](docs/design/VERIFICATION.md)，其中的命令结果、数量与日期属于来源记录，不代表本仓库导入后的复测结果。本机实际检查以仓库开发证据记录为准。

## 展台页面

| 路由 | 内容 |
|---|---|
| `#/` | 总览：一句话原则、实时演示的写作台、四个方案卡、待确认的四件事 |
| `#/directions` | 四个方案：同一张设计稿（写作台 / 今日页）换四套令牌，可直接操作 |
| `#/grammar` | 设计语法：五种材质、候选的七种状态、空间 / 强调 / 介入 / 文字四种层级、状态词汇表 |
| `#/tokens` | 色彩与令牌：62 个颜色令牌、对比度契约实时计算、形状、投影、间距 |
| `#/components` | 基础组件：按钮、表单与校验、选择与导航、状态、反馈与浮层、数据表 |
| `#/domain` | 业务组件：航线、任务、修订候选、助手、主动建议、反馈、资料、要求、文献、评审、计划、任务、四库、版本、编辑器样张 |
| `#/motion` | 动效系统：时长、曲线、四种性格并排、八段签名动效、通用编排、减弱动效 |
| `#/layouts` | 布局与导航：信息架构、三种外壳、推荐外壳的结构、界面清单 |
| `#/spec` | 规范文档：渲染 `docs/design/DESIGN-SPEC.md` |

页面底部的“方案坞”全局切换四套方案；右侧的闪电切换完整 / 减弱动效。

## 目录结构

```
src/
  design/
    tokens/            令牌契约（schema.ts）、四套取值（themes.ts）、共享刻度、对比度与弹簧计算
    styles/            index.css 入口；generated/ 为脚本生成；base / motion / materials / ui / domain / signatures
    fonts/             展台字体子集（woff2）
    theme.ts           主题作用域（provide / inject，支持嵌套）
  components/
    ui/                基础组件（TpButton、TpField、TpStatus、TpSeal、TpPencilFrame、TpDialog …）
    domain/            业务组件（RevisionCard、TaskCard、StageRoute、FeedbackCard、ReviewSummary …）
  domain/              展示层类型（types.ts）与状态词汇表（vocab.ts）
  stores/              外观偏好（方案、动效）、轻提示队列
  lab/                 设计展台：页面、场景（写作台 / 今日）、样例数据
scripts/               build-tokens.ts · subset-fonts.py · vite-single-file.ts · shot.ts · evidence.sh
tests/unit/            Vitest：令牌契约、对比度、弹簧、状态词汇表
tests/e2e/             Playwright：展台可用性、设计语法、基础组件、编辑器样张
tokens/                独立令牌产物：tokens.css、thesispilot.tokens.json
docs/design/           DESIGN-SPEC.md（规范）、VERIFICATION.md（验证记录）、contrast-report.md、screens/
licenses/              字体与图标许可
```

## 设计令牌

单一事实来源是 `src/design/tokens/themes.ts`。`vp run tokens` 由它生成：

| 产物 | 用途 |
|---|---|
| `src/design/styles/generated/themes.css` | 应用内使用：daisyUI 主题块 + `--tp-*` 语义变量 |
| `tokens/tokens.css` | 独立 CSS 变量表，不依赖 Tailwind / daisyUI |
| `tokens/thesispilot.tokens.json` | W3C Design Tokens 风格 JSON |
| `docs/design/contrast-report.md` | 四套方案 × 30 组对比度实测 |

对比度不达标时脚本以非零退出，单元测试也会失败。

## 功能覆盖对照（设计阶段）

本阶段覆盖的是“每个功能模块需要的展示组件与状态设计”，**不是可操作的业务闭环**。

| 模块 | 已有的设计与组件 | 规划入口（见展台「布局与导航」） |
|---|---|---|
| F01 用户与会话 | TpDialog（会话失效模态）、TpSaveIndicator（保存状态说明） | 账户与偏好；配置台 |
| F02 项目与首次设置 | 表单与校验样张、场景顶栏的项目切换器 | 项目切换器；首次设置向导 |
| F03 流程与阶段 | StageRoute（完整 / 紧凑） | 今日；计划；配置台 |
| F04 编辑与文档结构 | EditorSpecimen（Tiptap 3.33.1 真实编辑）、稿纸排版、保护对象样式 | 写作 |
| F05 修订、审阅与版本 | RevisionCard、DiffText、TpPencilFrame、TpSeal、VersionTimeline | 写作 |
| F06 综合 / 专业 AI | AssistantMessage、AssistantComposer、ContextScope、RunSteps | 副驾坞 |
| F07 任务、计划与进度 | TaskCard、EvidenceChip、PlanDiff、TpRing | 计划；今日 |
| F08 主动辅助与通知 | SuggestionCard、介入阶梯 L0–L4 | 收件箱；今日横幅 |
| F09 导师反馈 | FeedbackCard | 反馈 |
| F10 资料与知识库 | MaterialRow、TpDrawer（来源定位） | 资料 |
| F11 模板版本 | MaterialRow（识别 / 未识别 / 诊断）、TpVersion | 资料 |
| F12 论文要求 | RequirementRow（硬规则 / 语义，六种结论） | 资料 |
| F13 文献 | LiteratureCard（取得范围、核验状态） | 资料；副驾坞 |
| F14 评审 | ReviewSummary、IssueItem | 评审 |
| F15–F18 四库 | ConfigChain、数据表样张 | 配置台 |
| F19 配置、任务与诊断 | JobRow | 配置台；任务托盘 |
| F20 导出、备份与恢复 | JobRow（导出失败与替代路径）、VersionTimeline | 导出与备份 |

## 服务边界（规划，尚未实现）

规划中的服务边界如下；展示组件通过数据与事件连接业务状态，具体接入仍需实现与验证。

```
展示组件（src/components）──► 状态（Pinia stores）──► 服务接口（src/services/*.ts，纯类型契约）
                                                        ├─ mock 适配器（内存 / IndexedDB 数据仓库，可控场景）
                                                        └─ http 适配器（FastAPI，后续）
AI 能力经独立的 ai 服务接口封装（生成候选、拆解反馈、评审、检索），同样有 mock 与真实两种实现。
统一错误模型：正常 / 错误 / 取消 / 过期 / 冲突 / 部分结果 六类结果，组件用 TpState 与状态词汇表呈现。
```

## 已知边界

- 展台里的交互是组件级演示：业务状态变化发生在页面内存中，没有业务持久化、服务层或业务校验；只有外观偏好保存在浏览器 localStorage。
- 编辑器样张里数字与引用的保护下划线是视觉示意（按正则识别），保护逻辑尚未实现。
- 展示 / 稿纸 / 手写三种中文字体是**展台子集**，只含源码里出现过的字；正式应用需换成完整字体。
- 四套方案各只有一种明暗模式。
- 原来源记录只覆盖 Chromium（Playwright 自带的 headless shell 158）；Firefox、Safari 与真实设备不在其验证范围。签名样式使用了 CSS `@scope`、`linear()` 缓动与 View Transitions，需要较新的浏览器。
- 没有做用户测试。

详见 `docs/design/VERIFICATION.md`。

## 下一步（待你确认后）

1. 收敛方案：保留选定的取值，清理其余方案。
2. 应用外壳：航线轨、航线条、副驾坞、收件箱、任务托盘、指令面板、项目切换器。
3. 服务与契约：DTO、统一错误模型、Mock 适配器与数据仓库、场景开关。
4. 编辑器适配层：文档结构与版本、选区锚点、保护对象、候选校验与应用、历史与恢复。
5. 按空间实现 F01—F20 的完整流程与全部状态。
6. 测试与证据：M01—M20 逐项记录。
