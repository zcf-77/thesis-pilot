# SG-03 正文版本持久化

## 开工信息

| 字段 | 本轮记录 |
|---|---|
| task_id / status | SG-03；前后端及保存门槛纠错已通过下述工程验收，待远端交付核实 |
| 日期 / revision | 2026-11-17 / 3 |
| owner / coordinator | `sg03_documents` 负责 documents 后端纵切片、结构校验和 PostgreSQL 回归；主会话负责协调、公共资源与最终操作验收 |
| base_commit / 检出 | `06ddd64b4744a0f7364c13db13ba584840f07073`；`main`，`E:/Project/thesis-pilot`；本次已实际读取 HEAD |
| 确认依据 | 用户已确认 SG-01—SG-05、主动导入迁移策略，并明确继续；主代理核实远端认领 `66453721d708bf09d368ee8d609e8c762f8b6cf9` 后放行业务实现 |
| 上游 / 下游 | SG-02 已完成，根节点标记拒绝修复已入 `6019110`；SG-04 在本单之后接入保护、采纳及撤销事务 |
| 产品 AC | AC-001 的正文恢复子集、AC-008 的正文版本冲突前置能力；不据此将整项产品 AC 标为通过 |
| 当前修改授权 | 主代理已核实远端认领 `66453721d708bf09d368ee8d609e8c762f8b6cf9`，按台账划分的业务路径执行；不修改其他会话文件 |
| 业务文件 | `apps/api/src/thesis_pilot/modules/documents/`；`apps/api/tests/test_document_structure.py`、`test_documents.py`、`test_document_services.py`、`integration/test_documents.py`及 `fixtures/document-structure.json` |
| 公共资源 | 主代理独占迁移、错误码登记、应用入口、模型注册、健康检查版本、OpenAPI/生成契约和施工台账；本代理不执行 Git 写操作 |
| 迁移分配 | SG-03：`20261117_0003`，父 `20261117_0002`；主代理已整合，后端集成测试在随机隔离 schema 实际升级并检查元数据一致性 |

依据：[施工单](../../engineering/construction-orders.md)、[后端规范](../../engineering/backend-development.md)、[数据契约](../../engineering/data-contracts.md)、[前端接入](../../engineering/frontend-integration.md)、[正文结构合同](../../engineering/editor-snapshot-contract.md)。本文按[后端任务模板](../../engineering/templates/backend-task.md)区分设计、实现及实际结果；设计文字不自动视为验收通过。

## 需求与边界

用户主动将旧浏览器正文导入已经关联、且尚无远端正文的项目；导入成功后，正式正文可从服务器恢复并按独立内容版本保存。已有远端正文时阻止导入覆盖，不自动合并。本机原稿及历史永久保留原身份，不被远端稿替换或重新编号。

正式内容唯一事实为受限 Tiptap `json`，结构版本固定为 `schema_version: 1`。服务端不保存派生 `chapters`、编辑器 HTML 或整个 `PreviewProject`；前端从已校验 JSON 重算目录及展示。导入前由明确兼容入口完成缺失章节身份初始化，服务端不暗中生成身份或回退解析 HTML。

本单提供手动正文保存、读取及不可变历史读取。AI 候选采纳、保护规则事务、历史恢复写入与撤销属于 SG-04；远端稿在这些入口接通前不能将本地 AI 采纳伪装成普通手动保存。本单不新增模型调用、文件转换、账户权限或后台任务；继续使用受控联调认证，不宣称已有用户归属授权。

## 接口与字段

业务前缀 `/api/v1`；所有 ID 为 UUID，版本为正安全整数，时间为 ISO 8601 UTC。输入拒绝额外字段。各文档接口同时核对路径项目与文档归属，不能仅凭 `document_id` 访问另一个项目的正文。

| 路由 | 输入 | 成功返回 |
|---|---|---|
| `POST /projects/{project_id}/documents` | `DocumentImport`：`{content}`；仅供主动导入空远端项目 | 201，`DocumentRead`，初始正文版本 1 |
| `GET /projects/{project_id}/documents/current` | 项目 ID | 200，`DocumentRead`；无正文明确 404 |
| `PATCH /projects/{project_id}/documents/{document_id}` | `DocumentSave`：`{expected_version,content}` | 200，`DocumentRead`；匹配基础版本才保存 |
| `GET /projects/{project_id}/documents/{document_id}/versions` | `limit` 默认 20、范围 1—100；`offset` 默认 0、非负 | 200，`DocumentVersionPage`，按正文版本倒序 |
| `GET /projects/{project_id}/documents/{document_id}/versions/{version}` | 固定正文版本 | 200，`DocumentVersionRead` |

| DTO | 字段与语义 |
|---|---|
| `DocumentContent` | `schema_version: 1`；`json` 为经过递归与语义校验的正文树，不接受 `chapters/html` |
| `DocumentRead` | `id`、`project_id`、`version`、`content`、`created_at`、`updated_at`；`version` 为当前正文内容版本 |
| `DocumentVersionSummary` | `document_id`、`project_id`、`version`、`source`、`created_at`；列表不携带大正文 |
| `DocumentVersionRead` | `DocumentVersionSummary` 的字段及 `content`；固定历史内容 |
| `DocumentVersionPage` | `items`、`total`、`limit`、`offset`；`total` 为本次查询观察值，不承诺跨次分页快照 |
| `source` | 服务端根据入口写入 `local_import` 或 `manual_edit`；不接收客户端自由原因字符串 |

普通业务字段由 Pydantic 定义并导出真实 OpenAPI；递归正文可使用受限 JSON 类型配合 Python 语义校验，无需引入 Node 运行服务。生成器不支持的新 schema 结构须明确扩展并验证，禁止改成任意 `any` 或手写生成产物。

错误沿用 `{error:{code,message,request_id}}`，不回显正文、输入值或数据库异常。

| HTTP / code | 含义与客户端行为 |
|---|---|
| 404 `PROJECT_NOT_FOUND` | 项目不存在；保留草稿，不自动创建替代项目 |
| 404 `DOCUMENT_NOT_FOUND` | 当前项目无正文，或指定文档不属于该项目；只有明确查询到空远端时才提供主动导入 |
| 404 `DOCUMENT_VERSION_NOT_FOUND` | 指定历史版本不存在；不回退到同号本机历史或当前稿 |
| 409 `DOCUMENT_ALREADY_EXISTS` | 项目已有正文，包括首次并发导入的失败方；保留本机原稿并重新查询 |
| 409 `DOCUMENT_VERSION_CONFLICT` | 正文基础版本不匹配；保留草稿，读取最新稿后由用户决定，不自动换版本重发 |
| 413 `DOCUMENT_TOO_LARGE` | 超过正文专用字节预算；不写入，保留编辑草稿 |
| 422 `DOCUMENT_STRUCTURE_INVALID` | 节点、属性、身份、Unicode、表格或无损结构不合法；整次拒绝 |
| 422 `VALIDATION_ERROR` | 普通 DTO 字段不合法，沿用现有公共错误 |

401、503、网络失败、超时及无效响应不是“远端无正文”。通用服务故障与客户端取消沿用现有分类；不切换 Mock 或显示保存成功。错误码由主代理集中检查和登记，以上为设计约定。

## 结构校验与传输预算

Python 校验与生产编辑器使用同一份自制 JSON 案例；分别由后端校验器、前端实际 `validateEditorSnapshot/prepareEditorSnapshot` 执行，比较接受/拒绝及规范内容，不将两份自行编造的期望当作一致性证明。共享案例文件由主代理协调唯一所有者。

- 保持 [SG-02 合同](../../engineering/editor-snapshot-contract.md)的节点、标记、属性白名单和默认值；各层拒绝未知字段。只补已声明默认值，不能修补非法内容或合并相邻同格式文本。
- 根 `doc` 的非空 `marks` 整次拒绝；显式空数组按空默认值处理。节点深度以根为 0，上限 80，节点总数上限 100000；合法 24 层 blockquote 不得被通用传输校验误拒。
- 标记顺序采用生产 schema：`link → bold → code → italic → strike → underline → aiLock`；重复、错序和互斥组合拒绝，`code` 不能与其他标记共存。父子关系及父节点允许的标记同生产 schema。
- 表格先约束投影槽位最多 100000，再验证网格完整、跨度边界、重叠、缺格及跨行列宽一致性。不得用编辑器自动修补代替合法性校验。
- 所有字符串拒绝孤立代理字符；正文不得全局 trim。`chapterId` 保留已有非空身份且不能重复，长度上限按 UTF-16 单元计算为 200；普通 Python `len()` 或 JSON Schema 码点数不能代替该限制。
- ProseMirror 位置使用 UTF-16：非 BMP 字符占 2 个单元，文本之外还有节点结构位置。Python 使用明确 UTF-16 长度/边界辅助函数；不将 Python 字符下标混作持久锚点。本单不新增采纳补丁协议。

正文专用上限为 **16 MiB（16777216 字节）UTF-8 规范 JSON 内容**。API 与前端均按相同 UTF-8 字节规则计算，不能使用 JavaScript `text.length` 冒充字节数。正文接口请求体和单份正文响应另预留 64 KiB DTO 包装空间，上限为 16842752 字节；写入前检查规范内容预算，传输时检查整体预算，避免保存成功后无法读取。

HTTP 正文响应读取和 JSON 校验必须走正文专用预算；普通 DTO 继续保留现有深度 40、响应长度 1000000 的门槛。正文递归 JSON 的对象/数组层及 DTO 包装层不同于编辑器节点层，专用深度预算须容纳 80 层合法节点，再由语义校验拒绝第 81 层。请求在解析前限制传输大小，响应读取同样限制字节；超限明确失败并保留草稿，不截断正文。

数据库使用普通 PostgreSQL `JSON`，不选 `JSONB`。现行编辑器结构允许文本中的 U+0000，`JSONB` 拒绝该字符；普通 JSON 可保留对应转义。本单不需要对正文内部做数据库索引或 JSON 运算，必须以真实 PostgreSQL 往返验证此边界。[PostgreSQL JSON 类型说明](https://www.postgresql.org/docs/current/datatype-json.html)

## 数据库、版本与事务

| 表 | 字段和约束 |
|---|---|
| `documents` | `id` UUID 主键；`project_id` 唯一且外键指向 Project、删除受限；`current_version` 正安全整数；UTC 创建/更新时间 |
| `document_versions` | `(document_id,version)` 复合主键；文档外键、删除受限；`schema_version=1`；`content_json` 为 JSON；`source` 为受限来源；UTC 创建时间 |

当前正文通过 `documents.current_version` 指向不可变版本，`documents` 不重复存一份正文。使用可延迟的复合外键将 `(id,current_version)` 关联到 `(document_id,version)`，事务提交时保证当前指针有对应内容。历史只追加，无 UPDATE/DELETE 接口；PostgreSQL 迁移设置不可变约束触发器，拒绝改写或删除已存在版本。SQLite 快测不能代替上述约束的真实验证。

导入和保存均由 service 最外层 `with session.begin()` 拥有提交权，同步数据库路由使用 `def`，每请求独享 Session。先完成确定性结构和大小检查，再执行短事务，不在持锁期间调用外部网络。

1. **首次导入**：确认项目存在，在一次事务中新建 Document 和第 1 个 Version。`project_id` 唯一约束处理并发；只把明确的项目正文唯一冲突转换为 `DOCUMENT_ALREADY_EXISTS`，其他数据库错误不能静默伪装为业务冲突。
2. **手动保存**：UPDATE 条件同时包含文档 ID、项目 ID 和 `current_version = expected_version`；成功后递增正文版本并插入同号不可变内容，两者同事务提交。影响 0 行区分不存在与版本冲突。内容插入失败时，版本指针与更新时间也必须回滚。
3. **历史读取**：按项目、文档和版本读取固定内容；当前稿读取需在同一查询或一致事务中取得指针和对应内容。没有已提交一半的版本或指针可供客户端观察。
4. **重复与不确定结果**：本单不新增通用幂等键协议；导入唯一约束及保存 CAS 阻止重复创建版本。断线或超时后先保留草稿并重查，不能自动重新 POST，也不能读取新版本后自动重发旧 PATCH。

正文版本、项目元数据版本和结构版本分别管理；保存正文不更新 `Project.version`。本机版本继续属于本机文档历史。正式稿身份必须绑定 `instance/project/document/version`，不能把两个来源的 `v1` 当成同一版本。

新迁移只新增本单表与约束，不搬迁或覆盖浏览器数据；父版本依赖 SG-05 的 `20261117_0002`。主代理同步模型注册及健康检查的唯一 head。验收覆盖空库到 head、已有父版本升级、既有 Project/Job 数据保留及 `alembic check`。运行时不自动建表、迁移或 stamp；已有论文库不执行删除式 downgrade，出现问题保留现场并前向修复。临时测试 schema 的清理仅使用既有隔离测试规则。

## 前端衔接与状态

继续使用默认 `preview`，Mock/HTTP 显式选择且同契约；本单复用现有写作和项目页布局。已关联项目在写作台使用现有 `TpSegmented` 切换“本机原稿 / 正式稿”，不重建正文编辑器、不另造文字说明页。未关联时沿用本机体验，项目目录的服务关联入口保持原位置。正式稿的版本及保存状态集中在顶部；全局壳不再将正式稿描述为仅存浏览器。

| 功能编号 | 入口 → 操作与输入 | 结果与状态 | 跨页关联 → 验收 |
|---|---|---|---|
| SG03-UI01 来源与导入 | 已关联项目进入写作台，切换正式稿；明确查询为空后点击“导入本机正文” | 导入中禁重复提交；成功转为正式稿 v1；原稿/历史不改；已有稿或失败保留原稿 | 项目绑定沿用 sourceKey/projectId；SG03-01/07/08 |
| SG03-UI02 编辑保存 | 正式稿沿用同一工具栏、目录和编辑器；编辑后点击“保存”或 Ctrl/Cmd+S | 先保存独立本机草稿，再携带固定基础版本提交；期间新编辑仍未保存；成功更新正式版本 | 离页/刷新不自动提交草稿；顶层状态与当前来源一致；SG03-02/03/07 |
| SG03-UI03 冲突与未知结果 | 409 或网络/请求超时后点击“检查最新版本” | 保留当前草稿，读取最新稿；只在确认内容与所提交快照一致时确认结果；否则显示冲突，不换基线重发 | “保留草稿并载入新版”明确保存当前独立草稿后才换稿；失败不换稿；SG03-03/07 |
| SG03-UI04 草稿恢复 | 正式稿进入时读取独立草稿；单份恢复、多份在按需草稿列表中选择 | 草稿绑定服务/项目/文档/基础版本；不同窗口各自持有草稿 ID；不覆盖本机原稿或另一个窗口的草稿 | IndexedDB 独立存储；读取/写入失败明确提示并保留内存内容，可下载草稿；关页前未完成持久化提示；SG03-07/08 |
| SG03-UI05 历史 | 复用右侧版本页；正式稿分页读版本摘要，按需读取所选版本 | 历史内容只读，对比显示准确来源和版本；缺失/失败不跳至同号本机稿；SG03 不开放正式历史恢复写入 | 正式历史深链携带 source/service/project/document/version；裸 version 仍指本机；SG03-04/08 |
| SG03-UI06 辅助能力边界 | 同一写作台副驾、导出、关联章节入口 | 本机候选继续绑定本机稿；SG04 前正式稿不运行本机采纳/撤销/恢复；正式稿导出仅使用当前已加载内容 | 本机其他页面继续明确其本机来源，不将正式稿版本冒充本机版本；SG03-09 |

保存是明确操作，编辑只持久化草稿，不因恢复草稿、切页或后台查询隐式提交正式稿。草稿使用独立 IndexedDB 记录和每个编辑实例唯一 ID；恢复时复制所选快照，已有记录仅在原子事务确认冗余时清理，不能按项目整包覆盖其他窗口。冲突载入新版前归档当前草稿；成功保存只清理与已确认快照相同的冗余草稿，期间新编辑仍保留。用户主动选择恢复旧草稿时继续使用其原基础版本，不能自动变成最新基线。

动效映射：来源切换后的加载/空态/失败面板用共享 `tp-swap`，草稿列表新增/消除用稳定草稿 ID 与既有列表 hooks，版本详情/冲突详情按需展开；退出期间停止交互，快速切换使用请求序号忽略旧结果。正文编辑器不以来源或加载状态为 key，不通过动效重建。减弱模式沿用共享不超过 120ms 淡入淡出。四主题、390px、键盘及实际交互由主代理验收；实际结果见下方主代理验收记录。

本机原稿与历史保持原身份；既有裸 `?version=` 链接继续定位本机历史。远端稿及其草稿单独绑定完整服务实例、项目、文档和基础版本；远端编辑草稿独立保存在本机，不能覆盖本机原稿或被误认作已提交服务器内容。来自备份副本的远端关联仍按既有规则解除。

| 场景 | 状态与恢复要求 |
|---|---|
| 主动导入 | 先查明确的空远端状态；保留本机原稿，发送结构内容；只有服务器成功响应才能标为正式稿 |
| 已有远端正文 | 阻止导入覆盖，读取正式稿；不按名称、同号版本或相似内容自动合并 |
| 正常保存 | 固定文档身份、基础版本与请求快照；成功只确认该快照，期间继续编辑的草稿仍标未保存 |
| 保存失败/超限/结构拒绝 | 保留编辑内容和原基础版本，显示真实失败；不得静默回退 HTML、Mock 或本地成功 |
| 版本冲突 | 保留本机草稿并读取最新正式稿，供用户决定；不自动换基线或合并重发 |
| 超时/断线 | 结果未知，保留草稿并重查；重新读取不是重新提交授权 |
| 项目或来源切换 | 停止旧查询并使用请求序号/完整身份忽略迟到结果；不能把旧项目响应写进新项目 |
| 页面离开/取消查询 | 不等于撤销已到达服务器的保存；回到页面后重新读取确认状态 |
| 重启恢复 | 服务器恢复正式稿，本机恢复独立草稿；有差异时保留双方，不自动提交或覆盖 |
| 本地 AI 候选或历史恢复 | 远端写入路径在 SG-04 接通前不可使用这些本地应用动作；普通手动保存不得成为绕行入口 |

## 验收设计与当前结果

下表区分后端、浏览器实际行为与受控传输验证；子代理结果不代替主代理操作验收。

| 工程项 | 实际操作与判定 | 当前结果 |
|---|---|---|
| SG03-01 结构一致 | 两端读取同一自制案例；合法内容规范结果一致；非法根 marks、未知属性、孤立代理、错序标记、相邻文本及坏表格均拒绝且不改状态 | 后端和前端同 41 例通过，前端规范内容深比较、幂等和原件保留通过；已纳入主整合后的完整门槛 |
| SG03-02 边界大小 | 验证合法 24 层/80 层、非法 81 层、100000 节点边界及中文/非 BMP UTF-8 大小；16 MiB 内容可传，超限 413 且草稿保留；普通 DTO 门槛不变 | 后端结构边界及真实 HTTP 精确 16 MiB 保存/读取、超限不写入通过；前端受控传输边界通过。实际浏览器无效结构保存门槛纠错已通过，详见下文 |
| SG03-03 导入竞争 | 真实 PostgreSQL 两个独立 Session 同时首次导入，恰有一个成功和一个 409；仅一份 Document/Version，本机原稿及历史不变 | 真实 PostgreSQL 单胜及行数通过；主代理真实 HTTP 主动导入 v1 后本机原稿和历史保持 |
| SG03-04 保存 CAS | 两窗口固定同一基础版本提交不同正文，恰有一胜；失败方草稿保留，重读不产生第二次写入，Project 元数据版本不变 | 真实 PostgreSQL CAS 单胜及版本独立通过；主代理两窗口实际得到 v3/409，冲突草稿可保留、载入新版并刷新找回；受控 HTTP 的真实 IndexedDB 双窗口回归通过 |
| SG03-05 原子与不可变 | 注入新增版本失败，检查指针、时间和历史均回滚；直接尝试更新/删除历史被数据库拒绝，旧版本内容保持 | SQLite 和 PostgreSQL 事务回滚通过；真实 PostgreSQL 历史 UPDATE/DELETE、悬空指针和有数据 downgrade 拒绝通过 |
| SG03-06 持久恢复 | 真 HTTP 写入 PostgreSQL 后重启 API，再读当前稿与历史；中文、非 BMP、U+0000、标题身份、表格列宽及格式逐项一致 | 真实 uvicorn 进程重启后当前稿/历史、80 层及上述内容一致通过；未重启 PostgreSQL 服务进程 |
| SG03-07 隔离与迟到 | 真 HTTP 交叉使用项目/文档 ID 应 404；浏览器快速切换项目/来源、延迟旧响应，草稿与正式稿不串写 | 真实 HTTP 跨项目历史查询 404 通过；主代理新项目正式稿为空，返回原项目仍恢复其草稿；将旧项目真实 GET 响应延迟至切换后释放，新项目仍为空且没有旧稿 |
| SG03-08 失败恢复 | 真实接口认证失败、服务不可用、超时或冲突后保留草稿；检查不自动 POST/PATCH、不降级 Mock、没有虚假成功 | TestClient 认证及结构拒绝、真实 HTTP 冲突/超限通过；主代理浏览器断网保存失败后保留输入，联网检查和刷新未增加写请求，服务器仍 v3。未知结果及持久化失败另有 controller 回归；无效结构保存门槛最终复验通过 |
| SG03-09 版本来源 | 原本机历史链接继续读取本机；正式历史使用完整身份，两个 v1 不串用；SG-04 前本地 AI 应用不能进入远端保存 | 主代理正式 v1 对比正确读取原文，完整服务/项目/文档/版本链接有效；缺身份链接明确拒绝、保持当前稿；本机/正式撤销栈实际隔离，正式稿未开放本机采纳入口；原本机流程全量回归通过 |
| SG03-10 迁移与契约 | 真实空库/父版本升级、旧数据保留、唯一 head、Alembic 元数据一致；真实 OpenAPI 与生成 DTO、HTTP/Mock 合同一致 | 真实 PostgreSQL 升级、旧 Project/Job 保留、Alembic check 通过；生成契约及统一后端门槛通过，唯一 head 为 20261117_0003 |

整合时在 `apps/api` 执行 `uv sync --locked`、`uv run python scripts/check.py` 和 `uv run python -m pytest tests/integration/test_documents.py`；后者必须明确提供符合现有隔离规范的 `TP_TEST_DATABASE_URL`。完整服务门槛按主代理与 SG-05 协调执行 `uv run python scripts/check.py --integration`，不将缺环境跳过计为通过。真实 HTTP 验收使用运行中的 uvicorn 与 PostgreSQL；TestClient/SQLite 只计对应快测。

前端由负责代理按现有 check、test、build、E2E 入口执行，并由主代理实际操作来源切换、导入、保存、冲突与恢复；相关四主题、窄屏、键盘和减弱动效一并核对。格式、编译或测试数量不能替代上述需求覆盖。

## 后端实际运行与纠错

| 检查 / 环境 | 实际命令及结果 |
|---|---|
| Windows，`apps/api` | `uv run python -m ruff check src/thesis_pilot/modules/documents tests/test_document_structure.py tests/test_document_services.py tests/test_documents.py tests/integration/test_documents.py`：退出 0；本模块及测试格式化已执行 |
| Windows，`apps/api` | `uv run python -m mypy src/thesis_pilot/modules/documents`：退出 0，7 个源文件无问题 |
| Windows，`apps/api` | `uv run python -m pytest tests/test_document_structure.py tests/test_document_services.py tests/test_documents.py -q --tb=short`：退出 0，60 项通过；范围为 51 项结构/DTO、5 项 SQLite service、4 项 TestClient |
| Windows，完整后端门槛 | `uv run python scripts/check.py`：退出 0；离线锁检查 81 包一致，Ruff 检查通过、64 个文件格式一致，mypy 38 个源文件通过，141 项快测通过（15.59 秒），OpenAPI 快照一致，唯一迁移 head 为 `20261117_0003` |
| Ubuntu-24.04 独立 Linux 环境 | `wsl -d Ubuntu-24.04 -- bash /mnt/e/Project/thesis-pilot/work/stage1-services/run.sh python -m pytest tests/integration/test_documents.py -q --tb=short`：退出 0，最终 7 项通过，15.68 秒；此前 6 项通过后新增有数据 downgrade 拒绝回归，最终覆盖新增行为 |
| 共享结构前端复核 | 前端代理执行生产编辑器同一 41 例及 8 项服务边界测试，报告 49 项通过；本机日志 `work/sg-05/document-services-regression.log`。服务测试使用受控传输，不计为真实 HTTP |
| 仓库文档与差异 | `python -X utf8 scripts/validate_repository.py`：退出 0，89 份文档、392 个本地文件链接；`git diff --check`：退出 0。文档检查不等于页面或产品验收 |

本轮后端命令的原始结果保存在会话工具执行记录；集成临时 HTTP 日志位于 pytest 的隔离临时目录，不含令牌或正文。`run.sh` 从 Git 忽略的独立测试配置加载连接；测试每次创建随机 schema，收尾只清理该 schema。未将真实论文或凭据加入案例。

实际纠错：递归 JSON 的普通 Pydantic union 在合法 80 层时先触发验证深度限制；改用完整 Python 正文校验后，普通 Pydantic JSON 输出又触发序列化深度限制。最终 `EditorJsonContract` 保留明确递归 OpenAPI 结构，以完整正文校验负责此字段；documents 专用响应先再次验证实际 DTO/正文，再仅由确定性编码处理 UUID、UTC 和已检查的 JSON 值。没有放宽 80 层门槛，也不吞序列化错误。TestClient 和真实 HTTP 的 80 层往返、81 层拒绝均通过。复核另将合法整数属性规范为整数编码，保持前后端 UTF-8 预算一致，并补相应回归。

## 主代理整合与实际页面验收

- 完整 Linux 检查退出 0：141 快测、22 真实 PostgreSQL/Redis/prefork/HTTP 集成（正文 7、长任务 8、既有服务 7），无跳过。原始日志 `work/sg-03/backend-final-integration.log`，SHA-256 `c5b12cd50c60899acc15d3aec45240f180b53940e54dc98f24bbd779a3dfa259`。
- 前端 check、275 单测、默认构建通过；托盘修订后默认 Chrome 110 通过、5 个专用模式跳过，Mock 专用 4 项通过，独立 HTTP 拦截/真实 IndexedDB 双窗口 1 项通过。后续保存门槛修复仍须专有回归及门槛，不能将上述结果冒作修复后结果。
- Chrome 实际 HTTP 操作包含主动导入、保存、双窗口冲突、草稿恢复、来源撤销隔离、断网、跨项目和迟到响应。原件位于 `work/sg-03/manual/`：`result.json`、`offline-result.json`、`project-isolation.json`、`late-response.json`、`history-result.json`。延迟测试只控制真实 GET 的响应时点，没有用 Mock 替换数据库事实。
- 主代理逐张查看正式稿四主题 `formal-{zhumo,yingguang,yehang,chenwu}.png`、390px `narrow-write-final.png`、断网与历史截图；保持原写作布局和共享组件，版本及保存状态集中在顶部，窄屏未横向溢出。实际键盘编辑、Ctrl+S、来源切换、按需历史及减弱动效均已操作。系统中文输入沿用 SG-02 已完成的用户输入实证，不重复冒记本轮测试。
- 收工限定复核发现过当前编辑器捕获失败仍可提交旧有效草稿、来源切回清错误的问题。已统一按钮/快捷键提交前捕获校验，错误随正式稿编辑状态保留；顶部状态明确未保存，检查/恢复换稿期间暂停编辑，普通保存期间仍允许继续输入。自动检查同样不覆盖尚未捕获的输入，本机候选只检查本机文档。没有改变方案或减弱验收。
- 最终修复后 check、275 单测、默认构建通过；写作/保护/快照/版本相关 Chrome 19 项、独立 HTTP 拦截草稿 Chrome 2 项通过。主代理另用真实 HTTP 粘贴 `start=10001` 的超限列表，核实无效稿保留、切源后错误仍在、按钮/Ctrl+S 均零写请求；修正后只一次请求提交实际正文并生成 v2。原件 `work/sg-03/manual/invalid-capture-final.json`；测试日志前缀 `work/sg-03/formal-capture-release-`。

## 证据与交接

SG-03 前后端及保存门槛修复已整合并验收，等待远端交付核实；完整产品 AC 未据此改为通过。早前只读生产 schema 探针帮助发现根节点标记边界，随后由 SG-02 修复；旧探针曾接受根标记的结果不作为本单允许规则。

真实用户消息、子代理派发与执行原件由主协调者依[聊天证据规则](../../../.agents/skills/thesispilot-chat-evidence/SKILL.md)合并，本文不是完整原始对话。后端整合提交为 `5817b4b6fa65ada11f371aec7e37e4900acf6600`，目前仅本地提交；用户要求提交使用中文后，仅调整本轮尚未推送的提交说明，没有改写远端历史。前端及最终收单提交由主施工台账补录。

前端整合提交为 `a3c39b355191079bcdc8a9332e57167f85fa56ec`；下一步核实交付、登记完成，再认领 SG-04。新明显设计冲突立即反馈并停止受影响实现，不用调整合同或跳过检查消除失败。
