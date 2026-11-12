# 毕设智途 ThesisPilot

面向毕业论文全过程的前端设计展台。产品原则：**AI 主动判断并提供帮助，重要节点介入，学生最终决定。**

> **当前阶段：设计语言、组件展台与全套交互页面预览。**
> 包含四套统一主题、九页设计展台，以及七个工作空间与五个公共入口；使用 Vue 3、TypeScript 和共享项目状态，页面操作实际更新预览数据。
> 已补本地预览服务和浏览器持久化，支持刷新恢复、保存失败重试与 JSON 备份。项目元数据与诊断任务已增加统一 Mock/HTTP 接入层；正式 HTTP 联调和完整业务持久化尚未验收，真实模型与复杂文档转换尚未接入。原页面能力边界与实测见[修复记录](../../docs/evidence/sessions/2026-11-14-existing-design-repair.md)。

> **2026-11-14 修复更新：** 已获授权修复原有12页，不新增页面或路由。目录组件、全局航线与进度、写作布局、上下文/版本保护和各模块跨页链路已补修。完整功能设计见[功能与模块基线](../../docs/design/delivered-functional-design.md)，逐项变化见[修复结果](../../docs/design/existing-design-repair-results.md)。[先前审计](../../docs/design/design-implementation-audit.md)作为历史基线保留，最终检查以本轮修复记录为准。

> **2026-11-14 接入更新：** `VITE_SERVICE_MODE=preview|mock|http`，默认保留原页面；mock/http 在项目和任务页共用接入组件。接口范围仅项目列表、新建名称、读取、改名，以及诊断任务创建、按项目分页、查询和取消。当前前端 check、189 项单元测试、preview/mock 构建已通过；真实 HTTP 及完整业务联调尚未通过。详见[接入说明](../../docs/engineering/frontend-integration.md)、[数据契约](../../docs/engineering/data-contracts.md)及[本轮证据](../../docs/evidence/sessions/2026-11-14-frontend-integration.md)。

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
vp run check                   # 生成契约漂移、格式、Oxlint 与 Vue 类型检查
vp run contracts:generate      # OpenAPI 更新后生成 DTO/schema；生成文件不手改
vp test run                    # 令牌与状态、保护校验、依赖约束、版本/备份等单元测试
vp build                       # 构建 dist/ 与单文件展台
vp exec playwright install chromium
vp run test:e2e                # 使用 127.0.0.1:18744，需先构建
vp run shots                   # 截图到 test-results/design-lab.png，需先构建
```

端到端测试自行启动预览服务，端口占用时失败，不复用其他会话的服务。主交付是 `src/lab/screens/` 下 Vue 源码；运行后进入 `#/screens/today`，或首页「打开全套页面设计」。构建的 `dist/thesispilot-design-lab.html` 是同一 Vue 应用的离线查看补充。

本轮导出为[thesispilot-design-preview.html](../../deliverables/thesispilot-design-preview.html)：与当前构建使用相同内联代码和样式，仅增加无hash时默认进入写作台的入口脚本。完整浏览器复测与截图使用这份导出文件，原有展台与12页仍全部可访问。

若运行环境禁止本地 HTTP 连接，但已安装 Chrome，可对同一构建产物的单文件版本执行交互检查（不会启动服务器）：

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome' # 也可用已安装的 msedge；不设置则用 Playwright Chromium
$env:PLAYWRIGHT_FILE = 'dist/thesispilot-design-lab.html'
vp exec playwright test --workers=2
node scripts/shot.ts --file dist/thesispilot-design-lab.html --route /screens/library --channel chrome --out test-results/library.png
Remove-Item Env:PLAYWRIGHT_FILE, Env:PLAYWRIGHT_CHANNEL
```

离线单文件检查不替代 HTTP 服务可达性验证。2026-11-14 本轮使用本机 Chrome 157.0.8103.51；运行沙箱中的本地网络连接被拒绝，HTTP 端到端入口未完成验收。

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
| `#/screens/today` | 今日：阶段、当前任务、待留意事项、工作入口 |
| `#/screens/write` | 写作：真实 Tiptap、章节/选区、六助手、保护检查、候选审阅与版本恢复 |
| `#/screens/plan` | 计划：阶段、任务与证据、周日程、计划调整候选 |
| `#/screens/library` | 资料：上传与原件版本、模板、论文要求、样例文献查询与写作上下文 |
| `#/screens/feedback` | 导师反馈：仅粘贴原话、分段整理、纠正、任务采纳/关联、证据、处理历史 |
| `#/screens/review` | 评审：整篇/章节、固定输入版本、规则预览报告、问题定位、历史与下载 |
| `#/screens/settings` | 配置：四库管理、关联检查、模拟运行、阶段流程、字典与提醒参数 |
| `#/screens/projects` | 项目：创建/编辑/切换、首次设置、文本导入、归档与恢复 |
| `#/screens/inbox` | 收件箱：原因和依据、延后/忽略、线下进展、去重/冷却与静默 |
| `#/screens/account` | 账户：演示昵称、偏好、会话退出/失效及重新进入 |
| `#/screens/jobs` | 执行任务：状态筛选、输入与诊断、取消/重试、评审及配置运行关联 |
| `#/screens/export` | 导出备份：HTML/纯文本、真实修改记录、评审报告、项目 JSON 备份与恢复 |

设计展台底部的“方案坞”全局切换四套方案；业务页面将它收起为右下角“外观”按钮，展开后可切换主题与完整 / 减弱动效。

全站选择器、日历/时间面板使用 `TpSelect`、`TpDatePicker`，复选、文件与数值输入统一自定义外观；禁止重新加入浏览器默认选择菜单。现有页面的新增/取消、列表进出、详情/候选、浮层和导航转场必须实际接入动效，不能仅在展台演示。规则及功能映射见[自定义控件](../../docs/design/custom-controls.md)与[全局动效](../../docs/design/global-motion-implementation.md)，后续页面维护同样遵守。

十二个页面使用统一外壳、设计令牌与 Tp 组件。模块状态按项目隔离，跨页共享正文/任务/资料版本，自动写入当前浏览器；刷新恢复前会校验数据。保存失败可重试或下载备份，不显示虚假成功。项目备份是真实 JSON，恢复为独立副本、保留原项目；被中断的执行需重新发起。功能设计与修复映射见[本轮结果](../../docs/design/existing-design-repair-results.md)。

反馈页点击「录入反馈」即可粘贴文字；Enter 换行，Ctrl/Cmd+Enter 保存，Esc 取消。保存只保留原文；后续「整理」按原文段落生成待核对项，由学生纠正并采纳任务，不冒充模型理解或导师认可。真实模型、全文检索、DOCX/PDF 转换、复杂模板格式应用仍有明确未接入状态。写作修订当前限单个纯文本块，跨数字/引用边界、公式及不支持对象会被拒绝，不承诺任意文档保真。

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
  services/            生成 DTO/schema、统一异步接口、Mock/HTTP、响应校验与映射
  stores/              外观偏好（方案、动效）、轻提示队列
  lab/                 设计展台；screens/ 为十二个页面，state/ 为共享项目与模块状态
scripts/               build-tokens.ts · subset-fonts.py · vite-single-file.ts · shot.ts · evidence.sh
tests/unit/            Vitest：令牌、状态、保护规则、依赖约束、版本及备份校验
tests/e2e/             Playwright：展台、十二页交互、跨页数据与恢复、响应式布局
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

下表是组件与页面的定位索引。十二个页面的实际交互、状态覆盖和服务缺口分别记录在 [分轮设计](../../docs/design/remaining-screens-plan.md) 与 [本轮证据](../../docs/evidence/sessions/2026-11-14-complete-designs.md)，不能用组件存在或本地测试数量代替产品验收。

| 模块 | 复用的设计与组件 | 当前页面入口 |
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

## 服务边界

原有写作、计划、反馈、资料、通知与浏览器保存仍使用 `src/lab/services/` 的本地预览服务。新增 `src/services/` 从后端 OpenAPI 生成 DTO/schema，提供项目元数据、诊断任务的统一异步接口及 Mock/HTTP 实现，统一处理错误、响应校验、请求取消和状态映射；请求失败不回落 Mock。

| 模式 | 项目/诊断任务 | 其余本地业务 |
|---|---|---|
| `preview`（默认） | 保留原有预览交互 | 原浏览器工作区 |
| `mock` | 同契约内存服务，跨页共享，刷新不承诺持久化 | 原浏览器工作区 |
| `http` | 等待 API 确认，项目名称与任务状态由服务端决定 | 正文、规划、资料等仍只在本机；不随名称保存上传 |

在 `.env.local` 明确选择模式。HTTP 使用 `VITE_API_BASE_URL=/api/v1` 与公开稳定的 `VITE_API_INSTANCE`；开发代理仅在服务器侧读取 `TP_API_TARGET`、`TP_API_TOKEN`。禁止把令牌写成 `VITE_API_TOKEN` 或放入浏览器保存/产物。准确配置见[接入说明](../../docs/engineering/frontend-integration.md)。

打开接口项目通过 `remoteBinding` 关联本机工作区，保留本地 ID、正文和模块；复制备份为新项目时移除关联。远端任务刷新后查询服务端，不使用“浏览器退出即取消”的本地模拟规则。账户登录、其他 AI/业务接口及真实端到端联调仍待实现或验证。

## 已知边界

- 默认 preview 的 `/screens/*` 使用共享本地项目状态、输入校验、版本与保护检查、下载及恢复；项目与外观保存在当前浏览器 localStorage。清理浏览器数据会删除本地保存，仍应下载 JSON 备份。接口模式仅增加项目元数据与诊断任务；正文及完整业务的服务端持久化、跨端并发控制仍未验收。
- 组件展台里的编辑器样张仍用于展示。写作页另有真实 Tiptap、选区候选与保护检查；当前限定单个纯文本块，拒绝切开数字/引用边界、公式及不支持的复杂对象，不能推断 DOCX 往返或任意文档保真已通过。
- 助手回复、文献查询与配置运行使用明确标注的本地预览；评审只执行有限规则，不代表真实学术评审。模板只支持已实现的标题格式候选，复杂资料解析、任意模板保真、真实模型和外部检索尚未接入。
- 展示 / 稿纸 / 手写三种中文字体是**展台子集**，只含源码里出现过的字；正式应用需换成完整字体。
- 四套方案各只有一种明暗模式。
- 原来源记录只覆盖 Chromium（Playwright 自带的 headless shell 158）；Firefox、Safari 与真实设备不在其验证范围。签名样式使用了 CSS `@scope`、`linear()` 缓动与 View Transitions，需要较新的浏览器。
- 没有做用户测试。

来源环境记录见 `docs/design/VERIFICATION.md`；本机当前结果见[本轮证据](../../docs/evidence/sessions/2026-11-14-existing-design-repair.md)。

## 后续正式业务工作

1. 将现有本地服务契约接入真实会话与持久化，补齐数据库原子事务和并发版本检查。
2. 验证复杂文档、公式和模板格式补丁，明确 DOCX/PDF 转换的保真范围。
3. 接入真实模型、检索和后台任务，保持学生审阅与保护检查，不让服务接入绕过当前边界。
4. 按 F01—F20 及产品 AC 执行正式业务验收，补齐真实试用、完整开发对话与复现证据。
