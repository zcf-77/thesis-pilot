# 功能架构与技术栈

更新日期为 2026-11-17。当前应用以十二个 Vue 交互页面和 Tiptap 写作台为基础。项目元数据、正式稿和诊断任务已接入真实服务。本机原稿、独立草稿、规划、反馈和资料仍由浏览器保存。正式稿支持导入、按基线版本保存、只读历史和冲突恢复，候选保护、采纳与撤销事务留待 SG-04。完整论文业务、复杂 DOCX、真实模型与外部检索仍待验收。见[正文持久化](../evidence/sessions/document-persistence.md)、[长任务可靠性](../evidence/sessions/job-reliability.md)及[产品验收](../product/acceptance.md)。

## 1. 技术栈与取舍

| 层次 | 选型 | 推荐理由与关键取舍 |
|---|---|---|
| 前端 | Vue 3、TypeScript、Vite+ | 组件化论文工作区和管理页面，用类型约束接口与编辑器适配层 |
| 界面 | Tailwind CSS、daisyUI | 统一样式与主题；daisyUI 不替代复杂表格、编辑器及可访问性交互实现 |
| 页面与状态 | Vue Router、Pinia | 管理路由、面板和项目状态；不复制多份独立可写的论文 |
| 前端工程 | Vite+，底层 pnpm | 统一管理 Node、依赖、开发、检查、格式化、构建与测试；vue-tsc 补足 Vue 类型检查 |
| 后端 | Python、FastAPI、Pydantic | 业务接口和结构校验；长文解析、评审、模型调用放后台任务 |
| 数据 | PostgreSQL、SQLAlchemy、Alembic | 事务、版本并发控制和迁移；增加服务运维，但适合并发任务和采纳保护 |
| AI 编排 | LangGraph | 当前运行确定性诊断图；计划用于工具调用和工作流恢复，正式写入权限由业务服务控制 |
| 后台任务 | Celery、Redis | 解析、评审、导出与周期检查脱离 HTTP 请求；必须处理重复执行和取消 |
| 编辑器 | Tiptap + 自有 Vue/daisyUI 外壳 | 已用于交互页面的结构化编辑与选区适配。独立 DOCX 小样已完成学校模板与自制样例的往返，正式写作台入口待接入和验收。见[小样支持范围](docx-roundtrip.md) |
| 可选文档转换 | MuffinOffice 0.1.1 用户提供包 | 仅作为服务端候选；现有研究不代表已接入，不等待其浏览器 SDK |
| Python 工程 | uv、Ruff、pytest | 依赖锁定、静态检查、保护规则与事务测试 |
| 界面验收 | Playwright | 验证选区、采纳、撤销、面板切换与导出等真实操作 |

前端使用 `pnpm-lock.yaml`，后端使用 `uv.lock`。已验证的操作系统、运行时和服务版本见[本地运行指南](local-runtime.md)。外部检索和部署环境仍待选定。

### 前端工具版本

2026-11-11 核验注册表后选择 `vite-plus` **1.6.0**、底层 pnpm **11.25.0**。Vite+ 集成 Oxlint **1.93.0**、Oxfmt **0.78.0** 和 Vitest **5.1.0**，不再分别选择直接 Vite、Oxlint、Oxfmt 工程依赖。Node **26.13.0** 通过`apps/web` 目录的 `.node-version` 交给 `vp` 管理，当前锁文件为 `pnpm-lock.yaml`。

- 在 `apps/web` 执行 `vp install --frozen-lockfile`、`vp dev`、`vp run check`、`vp build` 和 `vp run test:e2e`。
- `vp run check` 检查生成契约漂移、格式、静态规则及 Vue 类型。
- `vp run test:e2e` 调度 Playwright。`vp test run` 使用 Vitest，覆盖令牌、项目状态、写作保护、依赖约束和版本备份等基础行为。

导入时的环境和验证见[导入记录](../evidence/sessions/2026-11-12-design-source-import.md)；后续十二页交互设计的实际检查见[本轮记录](../evidence/sessions/2026-11-14-complete-designs.md)。旧原型已退役，其工具链迁移不再继续。此前直接使用 npm、Oxlint 与 Oxfmt 的真实运行记录保留在原始开发证据中。

页面预览使用 `src/lab/state/previewWorkspace.ts` 的 Pinia 项目状态，各模块通过 `usePreviewModule` 隔离。本机原稿版本由统一入口追加，反馈、计划、资料及评审沿用本机 ID 和版本。浏览器保存支持刷新恢复，JSON 备份可校验结构并恢复为新项目。`preview` 为默认模式，项目元数据、正式稿与诊断任务的 `mock` 和 `http` 共用服务契约。已关联项目使用同一编辑器切换本机和正式稿来源，两者的版本和撤销状态各自独立。正式稿草稿由 IndexedDB 保留，明确保存后才提交服务端。见[前端接入说明](frontend-integration.md)。

## 2. 部署关系

### 2026-11-14 后端底座实现状态

`apps/api` 已建立 Python 3.13 + FastAPI/Pydantic、同步 SQLAlchemy Session、Alembic 基线、项目元数据 CAS、诊断 Job/outbox、Celery 适配及 LangGraph 确定性图。API 采用同步数据库路由，每个请求/执行独享 Session；service 显式事务，不增加空泛 repository 基类。业务接口暂由服务端 Bearer 令牌保护，缺配置拒绝；账户、会话和项目归属权限未实现。

当时已建立项目、任务、outbox 模型与迁移，论文文档 schema 和正式采纳尚未实现。首轮曾受环境限制，仅通过 25 项同步 SQLite/图测试，见[原始记录](../evidence/sessions/2026-11-14-backend-foundation.md)。后续已生成完整 uv 锁，Windows/Linux 工程检查、62 项快测、7 项真实 PostgreSQL/Redis/Linux worker 集成及项目/诊断任务浏览器联调通过。底座联调的 Linux 实际 worker 使用 prefork，独立集成用例使用 solo。见[历史联调证据](../evidence/sessions/2026-11-14-real-integration.md)。

SG-03 新增项目内唯一的 `Document` 和不可变的 `DocumentVersion`。事务以正文版本做条件更新并追加历史，项目元数据版本独立。SG-05 为诊断任务新增固定执行期限、短事务续租和严格结果校验，验证了真实 `prefork` 的恢复和取消边界。运行步骤见[后端 README](../../apps/api/README.md)与[本地运行](local-runtime.md)。

采用一个仓库、模块化单体后端。API、后台任务和调度器分进程运行，不为每个智能体建立微服务。若选用 MuffinOffice 转换，则作为独立 Linux/amd64 服务通过内部 HTTP 接口接入；它不是浏览器编辑的前置条件。

```mermaid
flowchart TD
    UI[Vue 论文工作区 / AI 面板 / 管理页面] --> API[FastAPI]
    API --> BIZ[项目 / 计划 / 文档 / 规则 / 配置 / 评审]
    BIZ --> DB[(PostgreSQL)]
    BIZ --> FILES[文件存储适配层]
    BIZ --> EVENTS[任务记录 / 事务事件]
    EVENTS --> QUEUE[Redis / Celery]
    SCHED[单实例调度器] --> QUEUE
    QUEUE --> WORKER[后台 Worker]
    WORKER --> GRAPH[LangGraph 工作流]
    GRAPH --> TOOLS[受限工具 / 检索 / 模型调用]
    WORKER -. 可选 .-> OFFICE[MuffinOffice 文档转换候选]
    WORKER --> DB
    UI --> REVIEW[学生审阅与采纳]
    REVIEW --> BIZ
```

完整功能结构见 [SVG 架构图](diagrams/thesis-pilot-architecture.svg)。图中模块表示职责，不代表独立部署单元或已经实现。

## 3. 功能模块映射

| 模块 | 目标架构 | 核心边界 |
|---|---|---|
| 论文主工作区 | 延续现有 Tiptap、EditorAdapter 与 Vue/daisyUI 外壳 | 正式文档 schema 和复杂对象需验证；按文档结构和选区锚点写入 |
| 统一/专业 AI 面板 | Pinia 保存界面与会话上下文，后端协调任务 | 共享论文版本；切换保留光标、选区和未保存编辑，多面板不代表多次自动调用模型 |
| 项目、进度、计划 | PostgreSQL 状态与依赖，确定性日期计算 | 学生确认完成后更新派生进度；计划变更先生成候选再采纳 |
| 主动辅助 | 业务事件 + 定时扫描 + 合并、去重、冷却 | 无编辑不等于无进度；可延后、忽略，不持续打断输入 |
| 模板、资料 | 原件、版本、解析诊断、文档转换适配层 | 上传直接解析保存版本，不增加核对发布流程 |
| 论文要求 | Pydantic 结构 + 来源锚点 + 规则执行器 | 可判定硬规则由代码执行，语义要求提供证据及不确定性 |
| 受控修订 | 候选补丁、差异展示、事务应用 | 模型不能直接写正文；采纳时复验版本与保护规则 |
| 论文评审 | 硬规则检查、语义评审、报告汇总 | 仅评审可独立运行，参考分不能冒充教师评分 |
| 文献检索 | 检索适配器、元数据及引用核验 | 外部服务待定；标明摘要与全文范围，不伪造来源 |
| 四库管理 | Vue 管理页 + FastAPI CRUD + 配置版本 | 智能体、提示词、AI API 接口、模型分别维护，任务绑定版本 |
| 通知、任务状态 | 站内记录，SSE 候选及断线后状态查询 | 不依赖浏览器持续在线；邮件等渠道未选定 |

业务底座当前保存项目元数据、正式稿及其不可变版本，以及诊断任务状态。正式稿候选保护、采纳和撤销待 SG-04。登录会话、资料文件和正式通知持久化属于后续能力，暂不展开租户、学校层级或角色权限体系。

## 4. 数据与任务控制

服务端已实现 Project、Job 和 OutboxEvent。基线迁移 `20261114_0001` 已在本地 PostgreSQL 执行 `alembic upgrade head` 并通过 `alembic check`，由运行人员显式应用迁移。后续实体包括 Document、DocumentVersion、TemplateVersion、RequirementVersion、Feedback、Task、PlanVersion、Suggestion、ReviewRun、ReviewReport、Notification、AgentVersion、PromptVersion、ProviderConfigVersion 和 ModelConfigVersion。见[真实联调记录](../evidence/sessions/2026-11-14-real-integration.md)。

文件通过存储适配层保存，数据库记录摘要、位置、版本和状态。初期可用受控本地目录，保留对象存储替换接口；未预设云平台。文档内部 schema 在开源编辑内核与文档往返小样验证后确定，不用纯文本覆盖含公式、表格的结构文档。

正式修订协议：

1. 固定基础论文版本、选区锚点、模板及规则版本，生成候选。
2. 程序检查选区、数字、引用、公式、锁定文本及结构；无法安全解析的对象锁定或拒绝修改。
3. 用户审阅差异并采纳；部分接受后重新检查组合结果，拒绝重叠补丁。
4. 事务内再次检查基础版本、候选状态和保护规则，原子保存新版本及采纳记录；冲突要求重新审阅。
5. 失败保持原稿；撤销形成可追溯恢复版本。重复请求、取消后迟到响应不能重复应用或覆盖正文。

任务状态建议：待开始→进行中→待核验→已确认，返工保留历史。达到字数或模型判断通过不能自动完成学生确认。

PostgreSQL 保存项目元数据、当前正式稿版本指针、历史版本、任务状态及 outbox。诊断任务经 outbox 派发，领取后按固定期限续租。幂等键与执行令牌隔离重复请求、失租重领和取消后的迟到结果。Celery 执行任务，LangGraph 当前运行确定性诊断图。LangGraph 暂停后持久化恢复与各真实业务任务仍待接入和验收。见[长任务可靠性记录](../evidence/sessions/job-reliability.md)。

Celery worker 推荐在 Linux 运行；Windows 开发机使用经验证的 WSL2 或容器环境，不将原生 Windows worker 作为验收基线。

## 5. 智能体与主动辅助

用户已选定 DeepSeek 官方接口，普通任务用 `deepseek-flash`，复杂任务用 `deepseek-v4-pro`。型号可用性与实际调用待验证，应用尚未接入。见[施工台账 D5](construction-orders.md)。

全局智能体协调文献查询、论文辅助、格式规范、进度管控、论文评审五个专业智能体，共用受限工具和规则执行层。角色不必对应不同模型实例，按效果、时延和费用验证配置。

主动辅助入口为明显延期、持续缺乏可观察进展、章节完成、阶段完成等事件。先由程序判断、去重、合并，再按需调用模型。冷却、静默时段和风险阈值可配置，数值经试用确定。提醒解释依据和不确定性，不能将“没编辑”直接断言为“没工作”。

学生可填写个人规划；没有规划时根据已知截止和产物判断，不编造个人效率。学生确认完成后系统自动更新派生进度和风险；修改日期、任务范围或论文仍需采纳。

检索先采用章节/来源定位和 PostgreSQL 关键词查询。pgvector 与嵌入模型作为需要语义检索时的候选，先评估资料规模和命中率，不默认增加独立向量数据库。

## 6. 模板、要求与评审

导师反馈使用 Vue 页内文本表单粘贴录入。原文保留换行与空格，录入时间独立于未知的导师反馈时间；未拆解的原文不会自动产生任务或 AI 判断。该入口于 2026-11-14 经交互验证，现通过浏览器保存，服务端持久化与真实 AI 拆解仍待实现。见[粘贴录入迭代](../evidence/sessions/2026-11-14-feedback-paste.md)。

模板保存原件、解析结果、诊断、版本和支持范围。要求提取保存原句、页码/段落来源、适用范围、规则类型、参数及抽取不确定性。上传即解析和保存版本，不设核对发布门槛；解析缺失或冲突必须可见。管理员可纠正提取结果并形成新版本。

当前论文绑定模板和要求版本；暂不做规则更新影响分析或全量迁移。字体、引用数量等可确定判断的规则由代码校验；论证和内容完整性输出带依据的语义判断。提示词不能保证模型永不违背要求，程序校验与正式写入入口承担硬边界。

评审固定论文、规则、模板、评分量表及配置版本，输出问题清单、严重程度、位置、依据、建议、分项参考分、未检查项与汇总报告。缺证据时标为不能判定，不捏造实验或引用。仅评审只生成检查产物；学生决定修改时创建独立修订任务。报告可导出供教师参考，不默认建设教师账号体系。

python-docx、lxml、pdfplumber 作为资料解析和确定性检查的补充候选，按编辑器及文档转换链路的实测缺口决定是否引入；不承诺保真 Word 排版，不允许二次解析静默损坏复杂对象。

## 7. 四库管理

| 库 | 主要字段 | 约束 |
|---|---|---|
| 智能体库 | 职责、允许工具、输出结构、提示词及模型引用 | 不通过配置页面上传任意可执行代码 |
| 提示词库 | 模板、变量定义、版本、适用任务 | 论文和检索内容是不可信数据，不能提升权限 |
| AI API 接口库 | 服务商、协议、地址、超时、限流、密钥引用 | 密钥服务端保存，浏览器及日志脱敏 |
| 模型库 | 模型标识、能力、上下文限制、参数、费用配置 | 能力与价格附来源及核验时间，不写死推测值 |

每次执行记录具体配置版本、输入文档版本、结果和诊断；不把完整私密论文、私人对话或密钥写入运行日志。

## 8. 后续实现与验收门槛

1. 延续当前[设计规范](../../apps/web/docs/design/DESIGN-SPEC.md)、十二页组件及项目、正式稿和诊断服务接入方式，按确认的施工单接入其他业务状态和持久化。
2. 使用现有 Tiptap 和 Vue/daisyUI 外壳验证许可、输入法、文档 schema、选区锚点、编辑事务、撤销及保护对象，确定正式写作台的支持范围。
3. 基于独立小样的支持范围，在正式写作台验收导入—编辑—保存—导出，检查模板样式、公式、引用、图表、目录及页码。若采用 MuffinOffice 转换，另验 Linux/amd64 服务、鉴权与接口合同。
4. 在正式应用验证保护规则、版本冲突与原子采纳，再扩展主动事件；原型中对交互的验证不替代后端约束验收。
5. 按现有锁文件复现环境，执行相关类型检查、后端测试和浏览器流程。19 项完整产品场景仍待逐项验收。

详见 [MuffinOffice 接入研究](integrations/muffin-office.md)。框架依据：[FastAPI](https://fastapi.tiangolo.com/)、[LangGraph](https://docs.langchain.com/oss/python/langgraph/overview)、[Celery](https://docs.celeryq.dev/en/stable/)、[SQLAlchemy](https://docs.sqlalchemy.org/en/20/)、[daisyUI Vue 安装](https://daisyui.com/docs/install/vue/)。
