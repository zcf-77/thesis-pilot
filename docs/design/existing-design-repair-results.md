# 现有设计稿修复结果与缺口追踪

日期：2026-11-14。本轮用户已授权“把现有设计稿修复完，不加新的页面，修复完给我看效果”。本文件承接[原始实现审计](design-implementation-audit.md)的23组GAP，记录本轮代码落点、分任务证据和仍需集成验证的内容；保留旧审计，不将此前缺失或失败改写成从未发生。

**本轮集成已完成：静态与Vue类型检查无警告/错误，138项单元和交付HTML的91项浏览器检查通过。** 23组GAP的实现落点与边界如下；实际失败、修正、最终检查、产物哈希和截图见[本轮集成证据](../evidence/sessions/2026-11-14-existing-design-repair.md)。这些检查证明本地交互预览，不等于真实模型/后端或正式产品AC全部通过。

## 1. 页面范围和证据入口

本轮在既有12个业务页面及共享组件内修复，没有新增业务页面或路由。`apps/web/src/router.ts`仍以原有12项数组生成`/screens/*`路由；`PageScreens.vue`仍承载七个空间和五个工具页面。新增的目录、任务托盘、通知横幅、只读定位抽屉及选区气泡均是既有页面内部组件，不是新页面。

| 既有空间/工具页 | 既有路由 |
|---|---|
| 今日、写作、计划 | `/screens/today`、`/screens/write`、`/screens/plan` |
| 资料、反馈、评审、配置 | `/screens/library`、`/screens/feedback`、`/screens/review`、`/screens/settings` |
| 项目、收件箱、账户、任务、导出 | `/screens/projects`、`/screens/inbox`、`/screens/account`、`/screens/jobs`、`/screens/export` |

源码入口：[router.ts](../../apps/web/src/router.ts)、[PageScreens.vue](../../apps/web/src/lab/pages/PageScreens.vue)。此前设计展台路由继续保留；不能把展台里的状态样例计为业务修复成果。

| 代号 | 本轮功能设计、实现与局部检查记录 | 主要职责 |
|---|---|---|
| O | [修复轮约束](repair-existing-designs.md) | 既有12页、功能先行、保护不放宽、统一自检 |
| W | [写作修复](repair-writing.md) | 编辑器、目录、副驾、选区、候选、引用/格式与上下文 |
| F | [保存项目导出修复](repair-foundation.md) | 本地持久化、恢复、项目、账户、备份、下载 |
| T | [计划反馈修复](repair-plan-feedback.md) | 泛化计划、时间线、反馈拆解、证据和关联 |
| L | [资料修复](repair-library.md) | 原件/解析、模板、规则、来源、文献 |
| R | [评审配置修复](repair-review-settings.md) | 固定输入、只读定位、四库、流程及任务反查 |
| E | [事件任务修复](repair-events.md) | 实际事件、去重/延后、统一执行记录和托盘 |

## 2. 23组GAP逐项结果

表中代码路径相对仓库根目录，函数/组件名供后续继续核验。分任务记录中的局部测试不能替代各行最后一列的跨页验收；真实服务边界不用于豁免本地Mock动作。

| 原GAP / 功能关联 | 本次实现或当前状态 | 代码与分任务证据 | 集成核对及保留边界 |
|---|---|---|---|
| GAP-01 / STOP、F03.04、F04.02 | 已补`WritingOutline`，写作目录恢复接入；全局外壳挂载`ProjectProgress`，统一显示阶段、倒计时、保存和版本。当前代码已有集成落点，最终类型/构建结果由主证据登记 | W、O；`lab/components/WritingOutline.vue`、`ProjectProgress.vue`；`lab/pages/PageScreens.vue` | 必须用本轮新构建验证目录/进度/布局；旧dist不能证明本次通过 |
| GAP-02 / F04.04、F20.08 | 工作区与偏好本地持久化；dirty/saving/saved/failed、重试、刷新恢复和中断任务归一化已接入。存储读取异常保留旧数据；写入前执行同一恢复校验 | F；`lab/state/previewWorkspace.ts`的`persistNow`、恢复初始化；`lab/services/persistence.ts` | 核对刷新、存储拒绝、恢复后再备份和合法技术正文；本地浏览器存储不等于服务端数据库/多设备同步 |
| GAP-03 / F04.07、F06.07、DS-46 | 新增编辑器schema/JSON/稳定章节/载入校验/事务适配；文字候选和助手Mock从Vue展示分离，请求固定来源及四库配置 | W；`lab/state/editorAdapter.ts`；`lab/services/writingAssistant.ts`；`settingsState.ts:captureBusinessConfig` | 核对结构往返、跨页实例/撤销栈、取消错误及实际配置消费；复杂DOCX对象和真实模型不在本轮接入范围 |
| GAP-04 / F05.01—03、F05.06—07 | 同一候选驱动稿内装饰差异和副驾卡；逐片段决定、拒绝、采纳、撤销继续受程序校验；新候选前及决定后归档完整候选、补丁、依据与版本 | W；`ScreenWrite.vue`候选装饰、`decide`/`rejectAll`/`adopt`；`writingState.ts:archiveWritingCandidate` | 连续两次候选、invalid拒绝、部分采纳、旧版阻断及刷新后的完整历史需在当前产物核对 |
| GAP-05 / F06.02—05 | 每助手保存独立草稿、选区、资料及目标；请求固定版本和来源；综合助手提供专业子任务、部分失败及单项重试。交叉复核后新增选区版本/章节身份，并校验旧范围 | W；`writingState.ts:WritingContext/WritingRequest`；`writingAssistant.ts:reconcileWritingContext`；`ScreenWrite.vue:captureRequest/send/retryStep` | 核对A助手选区后B编辑原文、双助手独立取消、原请求重试与部分结果保留；专业结果是明确标识的本地模拟 |
| GAP-06 / F13.05 | 引用采用独立追加意图，校验已核实来源版本/取得文本与精确追加内容，保留原段落；普通润色数字和引用保护继续保留 | W、L；`writingGuards.ts:validateCitationAppend`；`ScreenLibrary.vue:askAssistant`；`ScreenWrite.vue:checksFor/generateCandidate` | 必须走完资料→选区→候选→采纳→版本→撤销，并复验来源失效和旧稿拒绝；来源核验是本地模拟，不冒充出版真实性核验 |
| GAP-07 / F10.01、F11.01、F19.01 | 分类稳定ID/kind与显示名分离；配置改名后上传仍保留模板/规范业务类型，兼容既有种子 | L、R；`settingsState.ts:DictionaryItem`；`ScreenSettings.vue:saveCategory`；`ScreenLibrary.vue:inCategory/changeCategory/uploadFiles` | 核对改名→新上传→模板页→版本绑定；这是一处跨模块缺陷，不在三个模块重复计数 |
| GAP-08 / F11.03、F11.05 | 模板纠正以正在查看的版本预填；支持的标题层级、对齐、字重形成候选，显式采纳与撤销产生正文版本。格式重新生成已改为内部固定格式助手配置 | L、W；`ScreenLibrary.vue:editTemplate/prepareFormat`；`ScreenWrite.vue:prepareFormatCandidate/adoptFormat`；`writingAssistant.ts:captureFormatIntent` | 复验旧版纠正、格式配置停用/换助手后重生成、锁定与版本冲突；字号/页边距/分页保真等复杂格式仍明确未支持 |
| GAP-09 / F12.01、F12.04—07 | 已有逐条要求提取、按类型/参数判定、语义模拟、来源补链、冲突产生/解除及历史要求集绑定；评审冻结实际要求内容。写作请求新增完整绑定规则/模板快照，包含启用状态、参数、来源与判定；综合及5专业助手实际消费各自相关约束，输入和候选依据可查 | L、R、W；`libraryService.ts:extractLibraryRequirements/evaluateLibraryRequirement/semanticLibraryPreview`；`writingConstraints.ts:captureWritingConstraints/writingConstraintAdvice`；`ScreenLibrary.vue:bindRequirements/runSemantic`；`ScreenReview.vue:capture` | 未绑定、来源缺失、未知及冲突保留明确状态，不冒称全篇合规；规则旧快照不因新版本追改。最终全量检查见主证据 |
| GAP-10 / F13.04、F13.06—07 | 单篇、多选及处理函数执行统一核验；补充来源保存新版本和历史；上下文固定取得文本、范围及版本，不再仅传ID | L、W；`ScreenLibrary.vue:toggleLiterature/verifyLiterature/askAssistant`；`ScreenWrite.vue:sourceSnapshot` | 核对单篇/多选/深链门禁、取消迟到和补源后重新请求；外部全文检索与真实出版核验仍不声称已完成 |
| GAP-11 / F14.02、F15.02 | 智能体可显式绑定提示词历史版本；统一配置捕获生成实际四库链，评审输入冻结该链及要求/模板依据 | R、W；`settingsState.ts:configChain/captureConfigSnapshot/captureBusinessConfig`；`ScreenReview.vue:capture` | 核对绑定v1后编辑v2不追改旧运行，停用仍阻断；格式重新生成配置错配已列为本轮交叉修正 |
| GAP-12 / F14.04 | 问题默认定位到评审页内的只读原报告输入；单独“请求修订”才交接写作，附报告版本及可用章节ID | R；`ScreenReview.vue:openIssue`、只读定位抽屉；`reviewState.ts`范围提取 | 核对旧报告定位、同名章节、显式修订与正文/计划不变；没有新增路由 |
| GAP-13 / F19.02—05、F19.07 | 解析/生成/检索/反馈/计划/评审/配置/导出使用统一任务契约；任务中心统一筛选、独立尝试、固定输入、取消/重试；全局`JobTray`显示同一任务状态 | E及各业务分任务；`jobState.ts:startProjectJob/cancelPreviewJob/retryProjectJob`；`ScreenJobs.vue`；`lab/components/JobTray.vue` | 复验多来源任务、托盘就地操作与迟到隔离；运行时回调不序列化，刷新后明确回来源重新执行，不伪装恢复原定时器 |
| GAP-14 / F20.04—05 | 项目事件进入备份；各模块validator拒绝非法状态/计数/结构，恢复副本更新项目归属与运行ID并停止中断执行 | F、E；`previewBackup.ts:validatePreviewProject/parsePreviewBackup/normalizeRestoredModules`；`ScreenExport.vue:restore` | 合法备份往返及损坏/非法状态不污染原项目需核对；事件和历史恢复不等于重新执行已中断操作 |
| GAP-15 / F14.06、F20.07 | 支持格式的文件准备返回成功/失败结果；导出页、资料下载和评审导出保留对象、显示错误并可重试；统一记录导出任务 | F、L、R；`previewBackup.ts:downloadPreviewFile`；`ScreenExport.vue:exportFile`；`ScreenReview.vue:download`；`ScreenLibrary.vue:download` | 注入下载准备失败再重试；成功文案仅说明已向浏览器发起下载，不能证明用户磁盘已写入；不支持格式明确替代 |
| GAP-16 / F02.01/03/04、F03.02—06 | 项目表单补已有产物/来源/学生核对；日期及缩短截止冲突检查、UTF-8/读取失败恢复；流程可绑定历史版，今日按依赖/产物缺项核对并记录阶段确认 | F、R、O；`ScreenProjects.vue:save/importText`；`ScreenSettings.vue:bindWorkflow`；`ScreenToday.vue:confirmStage`；`projectProgress.ts` | 核对任意新项目、已有进度、冲突后保留输入、重排/依赖阶段；阶段确认由学生作出，不冒充导师认可 |
| GAP-17 / F03.04/07、F04.02/03/10 | 顶部阶段位置、阶段时间比例、任务确认比例、写作/今日字数目标分别有数据源；目录稳定标题及证据确认、阶段开始日、未知状态已接入 | W、L、R、O；`ProjectProgress.vue`、`WritingOutline.vue`；`ScreenToday.vue`；`projectProgress.ts`；`libraryService.ts:thesisWordCount/wordTarget` | 核对四种进度不混用，缺起始日期/规则不造百分比；切项目/正文/要求版本后同步，不复制样例数字 |
| GAP-18 / F07.06—07 | 通用计划服务按任意ID、依赖、原时长和硬截止生成候选；动态两周窗口可翻页/定位，显示窗口内全部任务；有生成/失败/取消/过期/无解状态 | T；`lab/services/planService.ts:suggestPlan`；`ScreenPlan.vue`时间线与生成流程；`planState.ts`采纳/旧编辑稿检查 | 核对第四项、跨月、任意ID、旧编辑稿及取消后迟到；自由规划原话保留，不擅自推断可用工时 |
| GAP-19 / F08.01—08 | 实际任务期限/确认及阶段事件进入通知规则；对象级去重/冷却/合并、抑制记录、延后截止与操作历史；今日聚合修订/计划/歧义反馈。页内`ProjectNotice`沿用L3约束 | E、O；`eventService.ts:processProjectEvents/useProjectEventBridge`；`inboxState.ts`；`ScreenInbox.vue`、`ScreenToday.vue`、`ProjectNotice.vue` | 核对不按场景按钮也能触发、不同对象不误吞、待办处理后更新；延后截止明确，未新增自动定时重送承诺；建议不用L4模态 |
| GAP-20 / F09.02—05/07 | 模拟拆解保留逐字原文范围，提出可核对任务/验收/已知章节；纠正不固定成图示；已有任务双向关联/解除，证据可选具体正文片段或资料版本，坏深链明确缺失 | T；`feedbackService.ts:analyzeFeedback/locateFeedback`；`ScreenFeedback.vue`；`feedbackState.ts`；`ScreenPlan.vue`反馈来源入口 | 核对一段多意见、未知章节、两条意见不同证据、关联解除与来源更新；处理仍是学生决定，输入仍只需粘贴文字 |
| GAP-21 / F10.02/06/07、F11.02/06 | 文本解析形成有限结构、行号片段及模板项；知识命中带固定版本和位置；取消同步资料与当前版本/尝试，迟到结果不覆盖；冲突/未知保留并可纠正 | L；`libraryService.ts:parseLibraryText`；`ScreenLibrary.vue:parseMaterial/abortParsing/askFragment/editTemplate`；`libraryState.ts`版本及来源状态 | 核对离页/切项目取消后各视图一致、旧版纠正及未知/冲突；复杂DOCX/PDF真实解析仍未接入，不能冒称排版保真 |
| GAP-22 / G.03—07、F04.09、DS-20/25/41—45 | 命令面板含章节/任务/页面与明确AI意图；副驾调宽/收起/抽屉/双会话；真实选区气泡复用保护动作，任务便签有真实深链；公共键盘与减弱动效沿用统一组件 | W、O；`PageScreens.vue`指令索引；`ScreenWrite.vue`；`TpDialog/TpTabs/TpSegmented`；`stores/appearance.ts`与`design/styles/motion.css` | 必须在当前390/1024/1440/1920布局检查可达、遮挡、焦点、气泡及动效；源码存在不能代替最终截图/键盘验收 |
| GAP-23 / F17.04、F20.03 | 配置详情从配置运行及统一任务快照反查使用记录；修改说明导出真实前后文字、版本成因、候选/片段决定及撤销历史 | R、F、W；`ScreenSettings.vue:containsConfig`及运行反查；`ScreenExport.vue:changes`；`writingState.ts:archiveWritingCandidate` | 连续修订并撤销后下载核对；编辑配置后旧运行仍对应原快照，不把摘要标题当完整变更证据 |

## 3. 本轮交叉复核发现及修正记录

以下是本轮实现后的复核问题，独立于旧审计中的原始缺口。记录修正与局部证据，不以“已修”替代最终统一回归。

| 问题 | 本轮修正 | 可查证据与剩余验证 |
|---|---|---|
| 普通技术论文中出现`javascript:`、`onclick=`、`url(...)`时被全文安全正则拒绝；保存显示成功，刷新才判损坏 | `safeDocumentHtml`改为检查标签token、属性及URL；正文讨论文字可保留。保存前使用同一项目恢复校验，避免把不可恢复快照标已保存 | F的“交叉检查后的安全文本纠正”；`previewBackup.ts:safeDocumentHtml`、`previewWorkspace.ts:persistNow`；分任务记录新增3项回归、两文件16项通过。最终浏览器刷新链见主证据 |
| 非当前助手的旧选区混入当前正文版本和全局光标章节 | 每助手上下文新增选区基础版本及章节身份；捕获请求前核对原文/章节，失效要求重新选择 | W交叉修正段；`writingState.ts:WritingContext`、`writingAssistant.ts:reconcileWritingContext`、`ScreenWrite.vue:captureRequest` |
| 已有格式候选切其他助手后，从公共审阅入口重新生成时捕获了其他助手配置 | 生成函数内部固定格式session与四库捕获，不能依赖路由入口先切换模式 | W交叉修正段；`writingAssistant.ts:captureFormatIntent`、`ScreenWrite.vue:prepareFormatCandidate`；后两项共新增4项回归，W记录后一次两文件21项通过 |

GAP-09已在集成期间补齐完整规则/模板内容快照及各助手实际消费，并加入不可追改、未知/冲突、模拟输出和备份校验回归。浏览器检查另发现引用的题录/摘要/全文节选组合快照不一致，现统一使用`libraryLiteratureSnapshot`，仍精确检查版本与核验状态；主证据记录引用采纳/撤销的最终复测。

## 4. 当前可引用的检查证据

以下数值摘自各分任务的实际执行记录；本文件编写过程只读核对源码和文档，没有重跑构建或E2E。检查集合可能交叉、源码也有后续集成修改，**不得把这些数字相加当作最终全量结果**。

| 分任务 | 已记录的局部检查 | 证据范围 |
|---|---|---|
| F 保存与恢复 | `preview-foundation`＋`persistence-repair`后一次2文件16项通过；实际九模块、1份样例评审的存储恢复探针通过 | 包含技术正文往返及写入前校验；前次13项和Node DOM限制已保留在历史过程 |
| W 写作 | `writing-guards`＋`writing-contracts`后一次2文件21项通过；定向格式化；本轮曾有类型检查退出0 | 后一次覆盖4项上下文/格式身份回归；新增/更新浏览器用例不在本文件预填通过 |
| T 计划与反馈 | 2文件23项通过；本轮类型检查退出0；使用19:39构建的三份浏览器文件首跑12通过/2定位器失败，修正定位器后仅复跑2项通过 | 这是局部且基于当时构建，不能代表后续全部集成源码；失败及复跑均保留 |
| L 资料 | `library-state`14项通过；定向格式化；9个浏览器场景已更新 | 覆盖类别/模板/规则/核验及状态校验；浏览器最终结果由主证据登记 |
| R 评审与配置 | `settings-state`＋`review-state`2文件21项通过；8个所属文件定向lint无告警、格式化；新增4条E2E | 包含明确提示词版本、固定输入、同名章节和分类；不等于真实服务接通 |
| E 通知与任务 | `events-jobs`1文件8项通过；所属文件定向格式化；新增2项浏览器检查 | 覆盖真实本地事件、去重/静默、取消迟到、尝试历史、延后及恢复 |
| 全局集成 | 最终14文件138项单元通过；交付HTML的91项浏览器检查通过；格式/静态/Vue类型无警告或错误，新构建成功，7张实际截图无页面错误 | 检查版本、失败修正、时长及产物信息统一记录于[本轮集成证据](../evidence/sessions/2026-11-14-existing-design-repair.md)，不与局部数字相加 |

## 5. 保留的真实能力边界

- 本轮修复的是Vue本地交互Mock。真实身份认证、服务端数据库、多设备同步、真实模型/API调用与线上任务执行不作为已实现能力。
- 文献与知识内容来自实际取得的本地数据或明确标识的自制样例；本地核验不证明外部出版真实性，不宣称联网取得未访问的全文。
- 真实DOCX/PDF复杂解析、复杂对象往返及字号/页边距/分页保真转换仍未接入。已支持的文字、标题格式、真实HTML/TXT/JSON及报告下载继续承担本地可操作和失败恢复要求，不能用这一边界删除验收项。
- 浏览器能触发下载不等于已确认用户磁盘保存；刷新后停止的任务不自动恢复丢失的运行时回调，应明确重新执行。
- 未确认的外壳备选、专注模式/航图首页及自动定时重送策略不因本轮修复被追加为硬要求；既有12页和已确认功能不反向缩减。

原[46项来源设计追踪](delivery-source-functional-inventory.md)与四分册139项功能切片继续作为功能依据。本表23组GAP是合并缺口的修复索引，23、46、139均不是验收通过率；正式产品AC和M01—M20的最终结论须以明确执行的证据分别登记。
