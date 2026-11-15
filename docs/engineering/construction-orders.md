# 施工单与当前状态

核对日期：2026-11-17；原阶段基线 `f964ebb1a384af85b15c0c813dad9374bb3a2ba1`。SG-01、SG-02、SG-03、SG-05 已完成并交付私有 main；SG-04及[窄屏写作浮层修订](../evidence/sessions/writing-drawer-design-blocker.md)工程验收通过，仍待至少30组保护样例的人工预期确认，第一阶段不登记全部完成。用户进一步授权：后续问题按推荐方案直接处理、验收并继续，不再逐次询问。SG-06—SG-16 尚未确认施工。执行规则见 [开工与收工](construction-workflow.md)。本表是 main 唯一施工状态入口，由本会话协调者串行更新。

## 基线判断

- 已有：Vue 3/Tiptap 十二页交互、共享组件/主题、浏览器保存与 JSON 恢复、选区保护与本地候选；后端 Project/Job/Outbox、CAS、幂等、取消与诊断队列，以及同契约 Mock/HTTP 接入。应继续建设现有前端，不重做页面。
- 有实现但不等于真实业务：本地助手、反馈拆解、评审、检索、配置试运行及文本解析。正式正文事务、复杂文档、真实模型和外部检索没有完整落地。
- 历史验证：[前端修复](../design/existing-design-repair-results.md)和[真实联调](../evidence/sessions/2026-11-14-real-integration.md)已有证据。本轮是代码/文档核对，未重跑这些业务测试，不将历史数字写成本轮通过。
- [产品验收](../product/acceptance.md) 19 项仍未完整验收；局部回归通过与这一状态不冲突。设计功能基线沿用 [交付设计](../design/delivered-functional-design.md)及 [需求清单](../design/full-mock-functional-requirements.md)。

## 待确认的判断与决定

代码定位（本轮只读核对）：前端服务模式见 `apps/web/src/services/runtime.ts`，真实适配见 `src/services/http.ts`，本地助手见 `src/lab/services/writingAssistant.ts`，其余本地业务见 `src/lab/services/` 与 `src/lab/state/`；上述简写相对 apps/web。后端仅 `apps/api/src/thesis_pilot/modules/projects` 与 `modules/jobs` 两个业务模块，诊断图在 `workflows/diagnostic.py`，队列在 `workers/`，基线迁移在 `apps/api/migrations/versions/20261114_0001_foundation.py`。源码定位不代替运行行为验收。

| 编号 | 差异或问题 | 建议或确认方案 | 用户决定 |
|---|---|---|---|
| D1 | 旧协作规范允许 coordination 台账，当前明确要求 main 持续更新 | main 唯一台账、单协调者串行认领；远端认领成功才开工 | 已确认：2026-11-17，本会话统筹，独立任务并行、主代理实际操作验收 |
| D2 | 自动收工的推送边界 | 每张已确认施工单完成后自动验收、更新 main 台账、提交及推送 private main；失败或范围变化保留现场并提问，不自动部署或删除分支/工作树 | 已确认：2026-11-16，用户对自动收工方案答复“按此执行”；仅确认此项，不确认业务施工单及其他待决事项 |
| D3 | 基线文档与台账需要核对 | 复用 45446de 的基线纠偏，核验并补差；不把产品 AC 擅自改成通过 | 已确认：2026-11-17，SG-01 |
| D4 | Tiptap 已使用，独立 DOCX 小样已提交 | 复用 f964ebb，核验编辑/锁定/拒绝边界及中文输入等缺口，不扩为正式 DOCX 业务入口 | 已确认：2026-11-17，SG-02 |
| D5 | 模型接入、检索与部署范围 | DeepSeek 官方接口：普通任务 deepseek-flash、复杂任务 deepseek-v4-pro；用户授权本机测试凭据使用。实际型号可用性与调用尚未核验；第一阶段不因此扩展 SG-07/08 | 2026-11-17 已确认供应商及任务分级；外部检索、部署和后续业务接入仍待确认 |
| D6 | 原路线含 11/17 目标，但剩余完整业务与材料较多 | 按依赖和验收推进，不据日期删需求；请确认是否仍以该日期为交付目标及优先范围 | 待确认 |

## 施工单

每单可独立验收；范围均含所需现有页面接入、契约生成、Mock 对齐、失败恢复和必要回归。不得将整个 PreviewProject 上传。下表范围不是任意文件修改权；开工时登记具体文件及共享资源，当前状态见文末执行记录。

### SG-01 当前基线与文档纠偏
- 目标/当前：让入口描述与已有底座一致；存在 D3 的历史与当前混写。
- 范围：README、architecture、roadmap、acceptance 当前状态段落；保留历史证据，核对前后端现有检查入口。
- 依赖：D3；不依赖业务开发。
- 验收：逐条差异有源码/历史证据定位；执行现有前后端基础检查，失败与未执行分别登记；文档链接校验通过，不改 AC 通过状态。工程验收，不冒用产品 AC。

### SG-02 文档与编辑器边界小样
- 目标/当前：确定可承诺的文档结构；已有 Tiptap JSON/选区适配，复杂 DOCX 未验证。
- 范围：复用 editorAdapter/writingGuards，自制标题、表格、公式、引用、图片样例，验证结构与锚点；形成导入导出支持矩阵。不先全面更换内核。
- 依赖：D4。
- 验收：每种对象标明可编辑/锁定/拒绝，保存往返及中文输入、撤销、跨段选区有实际结果；无法解析不丢失。AC-002/005/006/011 的前置证据，非整项通过。

### SG-03 正文版本持久化
- 目标/当前：正文成为可恢复的服务端事实；当前只有项目名称远端保存，正文在浏览器。
- 范围：Document/Version、结构校验、CAS 保存、独立正文版本、已有写作/项目页接入和本地数据迁移策略。
- 依赖：SG-02；迁移策略须用户确认，禁止覆盖本地数据。
- 验收：重启恢复、双窗口冲突、保存失败保留编辑、项目切换不串数据；真实 PostgreSQL/HTTP 回归。AC-001/008。

### SG-04 保护、采纳与撤销事务
- 目标/当前：把现有本地保护提升到不可绕过的服务端写入边界。
- 范围：候选基础版本/选区、程序保护、逐项决定、原子采纳、历史与撤销；复用现有差异界面。
- 依赖：SG-03。
- 验收：AC-005/006/007/008，至少30组人工确认保护样例；旧版、重叠、越界、重复请求均不写入；接受/撤销及重启一致；真实并发事务验证。

### SG-05 长任务可靠性
- 目标/当前：诊断任务已有 outbox/token/租约，尚不适用真实长模型/解析任务。
- 范围：续租、业务超时、结果 schema、取消/重试及重启边界；复用现有 Job 和任务中心。
- 依赖：SG-01；业务任务各自接入时复验。
- 验收：AC-010；真实 worker 长任务、租约丢失、取消迟到、重复投递、进程退出和重试耗尽均不重复写入。诊断回归保留。

### SG-06 资料原件、解析与要求
- 目标/当前：本地已有文本解析、版本和来源定位，缺服务端原件及复杂格式解析。
- 范围：受控文件存储、资料/模板版本、解析诊断、来源锚点、要求纠正；上传直接解析保存，不加核对发布。
- 依赖：SG-02/05；具体格式范围需确认。
- 验收：AC-002/013/014；重复导入、旧版本纠正、失败/取消保留原件，来源可追溯，硬规则与语义建议分开；资料不改正文。

### SG-07 四库与真实模型适配
- 目标/当前：已有四库本地版本快照/停用校验，调用仍模拟。
- 范围：服务端四库版本、凭据引用、已选供应商适配及任务配置快照；沿用 settings 页面。
- 依赖：SG-05、D5 的供应商/费用/外发决定。
- 验收：AC-017/010；真实调用与回放分别记录，配置编辑不追改旧运行，无效关联/停用明确失败，密钥不回显不入普通日志/备份。

### SG-08 统一与专业助手受控调用
- 目标/当前：已有五专业及综合助手上下文/部分重试，结果为本地模拟。
- 范围：绑定项目、正文/资料/规则/配置版本的真实执行，结果进入 SG-04 候选；现有侧栏多面板继续使用。
- 依赖：SG-04/06/07。
- 验收：AC-005/010/015；跨助手、跨章节、跨项目与取消后迟到均隔离；部分失败可重试；文档中的指令不能扩大权限，生成不改正文。

### SG-09 反馈与证据任务闭环
- 目标/当前：已有粘贴原文、模拟拆解和任务/证据关联，缺正式持久化与真实拆解。
- 范围：反馈原文及定位、任务/产物版本、用户纠正和处理；不增加反馈文件上传/OCR。
- 依赖：SG-03/06/07。
- 验收：AC-003/004；20条人工标注反馈，歧义/无法定位明确，原文不丢，旧证据变化要求复核；学生处理不等于导师批准。

### SG-10 计划与进度提醒
- 目标/当前：已有通用本地重排、确认阶段、事件去重/冷却，缺服务端事实和持久事件。
- 范围：计划版本、依赖约束、采纳事务、证据派生进度、站内提醒；复用今日/计划/收件箱。
- 依赖：SG-09/05。
- 验收：AC-009/016；10组计划样例，循环/硬截止无解明确；取消/陈旧候选不写入，无规划不编造效率，重复事件去重且通知失败不破坏数据。

### SG-11 文献来源与检索
- 目标/当前：本地文献候选及引用保护已有，来源检索为模拟。
- 范围：确认来源后的真实检索、元数据/摘要/全文分级、固定来源版本、引用候选；复用资料页。
- 依赖：SG-06/07/04、D5 检索来源决定。
- 验收：AC-019；真实可访问/摘要/全文/失败各有记录，不能编造页码或假称读过全文；未核实来源不能作为已核实引用采纳。

### SG-12 仅评审报告
- 目标/当前：已有固定输入报告和只读定位，本地规则/模拟评审。
- 范围：真实评审任务、量表与版本、报告持久化及下载，显式另建修订。
- 依赖：SG-06/07/08。
- 验收：AC-018；整篇/章节、缺依据、取消/重试与旧版定位均实测；前后正文/计划版本完全不变，参考分不冒充批准。

### SG-13 DOCX 与修改说明导出
- 目标/当前：已有文本/HTML/JSON及真实本地修改历史导出，DOCX 未实现。
- 范围：按 SG-02 支持矩阵导入/导出转换，版本绑定、真实修改说明；复用导出页。
- 依赖：SG-02/04/06/05；转换方案若新增服务或付费需确认。
- 验收：AC-011/002；指定办公软件实际打开核对标题/表格/数字/引用及限制，失败保留版本，修改说明对应真实采纳/撤销。

### SG-14 全项目备份恢复
- 目标/当前：已有浏览器 JSON 验证及副本隔离，缺服务端文件/历史完整恢复。
- 范围：正文、任务、资料原件、配置引用与版本的备份/恢复；保留原数据，凭据单独处理，不进入导出包。
- 依赖：SG-03/06/09/10/12。
- 验收：AC-012/001；干净数据目录恢复后关联一致；损坏/不兼容/部分失败不污染原项目；远端关联重查、副本解除绑定。

### SG-15 全链路验收与复现
- 目标/当前：已有局部工程证据，完整19项 AC 仍未验收，部署模式未确定。
- 范围：按产品验收逐项执行，现有12页四主题/窄屏/键盘/减弱动效，干净环境计时、来源许可、运行说明；不自行公开部署。
- 依赖：SG-08/10/11/12/13/14、D5/D6。
- 验收：19项逐一有实际版本/步骤/结果/证据，失败不能标完成；10分钟复现实测，真实试用未做则如实标注。AC-001—019、REQ-008/012。

### SG-16 开发证据与参赛交付
- 目标/当前：已有证据模板与摘要，三条完整 Prompt 链、视频/PDF/评审访问未验收。
- 范围：从各单开工即保存原始证据索引，最终制作视频/PDF及交付清单；报名、付费、外发、权限变更另确认。
- 依赖：证据收集随各单开始；最终材料依赖 SG-15 与 D6。
- 验收：REQ-005/006/007/009/010/011/012；三链人工核对完整，视频5—8分钟且协同片段至少2分钟，PDF≤30页且渲染检查，评审可访问；实际提交回执未取得则保持未提交。

## 建议顺序与交接

原建议顺序为 SG-01 → SG-02 → SG-03 → SG-04；SG-05 依赖 SG-01，可与文档小样独立推进，随后 SG-06/07 → SG-08/09 → SG-10/11/12 → SG-13/14 → SG-15 → SG-16 最终交付。2026-11-17 已确认首阶段，当前停工点与待确认修订见下方执行记录。SG-16 证据采集随各单开始，其最终交付尚未授权。

每单执行记录字段：状态、确认依据、owner、revision、更新时间、base_commit、文件与共享资源范围、依赖核实、验收命令/结果、证据链接、result_commits、远端交付核实、遗留/下一步。

## 第一阶段确认与执行（2026-11-17）

- 确认依据：本会话用户确认子代理模型限制、设计问题立即停工重审、独立工作并行及主代理手工验收，并答复“开始吧”。阶段为 SG-01—SG-05 的正文可靠保存与受控修订闭环；阶段工程验收后集中请用户确认下一阶段。
- owner / 唯一协调者：当前主会话 `01a1e81a-9eb8-7242-b824-bf7f88e668a3`。检出 `E:/Project/thesis-pilot`，main；开工盘点无未提交改动、无其他工作树，本地与 fetch 后 origin/main 一致，仓库 PRIVATE。
- 统一约束：子代理仅使用 `gpt-6.1-sol` 或 `gpt-6-astra`，按难度选择思考强度；明显设计缺陷立即停止受影响施工并向用户反馈，重新确认方案和设计；主代理亲自操作验收，不能以子代理汇报代替。
- 已确认迁移策略：用户主动把旧浏览器正文导入已关联且尚无远端正文的项目，保留本机原稿；有远端正文时阻止覆盖，本阶段不自动合并。
- 前端范围：复用项目页、写作台、任务中心及全局任务托盘；五条新增设计要求集中补入设计规范及页面交付检查。四主题、窄屏、键盘、减弱动效和实际状态均须对照设计稿检查。
- 共享资源：台账、AGENTS、API 入口、OpenAPI/生成契约、迁移与错误码由主代理串行整合。首批不变更迁移/错误码；后续认领时分配。所有 Git 暂存、提交、rebase、推送仅由主代理执行。

### SG-01 执行记录
- 状态：完成。revision：5；更新时间：2026-11-17。
- 确认依据：第一阶段确认；依赖 D3 已确认。
- base_commit：`f964ebb1a384af85b15c0c813dad9374bb3a2ba1`。
- 分工：主代理负责基线实跑与现场验收；`sg01_docs` 使用 `gpt-6.1-sol / high` 负责文档核对与前端规范；`stage1_evidence` 使用 `gpt-6.1-sol / medium` 整理本地片段，主代理合并。
- 文件范围：`apps/web/docs/design/DESIGN-SPEC.md`、`docs/design/page-functional-design.md`、`docs/engineering/frontend-integration.md`、README、architecture、roadmap、acceptance 当前状态段落，以及本轮 baseline 证据；主代理另负责 AGENTS、施工台账和聊天证据 JSON/展示页。不改 AC 通过状态。
- 验收：前端 check、test、build、E2E；后端 locked sync 与 check.py；仓库、聊天证据、展示页与 diff 校验；主代理实际打开页面对照设计。
- 验收结果：前端 check、189 项单测、build 通过；E2E 首轮取消任务点击超时，定向复跑及同构建双进程全量复跑通过（101 通过、3 项 Mock 专用跳过）。后端基础门槛与 62 项快测通过；本轮未跑后端真实服务。主代理实际操作保存刷新、进入项目目录、运行并取消预览任务，证据范围见[工程基线](../evidence/sessions/stage1-baseline.md)，不把过渡中的截图计为完整视觉验收。19 项产品 AC 仍待完整执行。
- result_commits：认领 `19e0b09209798130690e1449e0d72963c11f543a`、规范及停工证据 `d2f751a0612141b38e7a656b851373b98a968f14`、基线结果 `10fc50f34a42a752da8efccf597ae6a045e8037b` 均已推送并核实在远端 main。
- 恢复依据：用户明确“确认，按修订方案扩展 SG-02，修复并验收通过后继续原定阶段”，独立任务直接并行、主代理实际验收、新明显设计问题继续停工反馈。
- 下一步：用户恢复施工后可认领 SG-05。

### SG-02 执行记录
- 状态：完成。revision：6；更新时间：2026-11-17。
- 确认依据：第一阶段确认；依赖 D4 已确认，可与 SG-01 独立核验。
- base_commit：`f964ebb1a384af85b15c0c813dad9374bb3a2ba1`。
- 分工：`sg02_boundary` 使用 `gpt-6-astra / xhigh` 实现结构校验、统一生产 schema 和回归；`sg02_backup` 使用 `gpt-6.1-sol / high` 实现备份与工作区保护；主代理负责写作页接入、浏览器实际操作与最终验收。
- 文件范围：原小样路径继续保留；新增 `apps/web/src/lab/state/editorAdapter.ts`、`editorSchema.ts`（核心代理）；`previewBackup.ts`、`previewWorkspace.ts`（备份代理）；`apps/web/src/lab/screens/ScreenWrite.vue`（主代理）；核心代理使用 `tests/unit/editorSnapshot.test.ts` 和 `tests/docx/editor.ts`，备份代理使用 `tests/unit/previewBackup.test.ts`、`previewWorkspace.test.ts`、`persistence-repair.test.ts`。主代理负责相关 E2E、类型接入及整合。文档使用 `docs/engineering/editor-snapshot-contract.md`、既有 DOCX 范围和稳定名称的本轮证据。不变更数据库迁移或错误码。
- 验收：DOCX 自制样例与 Python 回归、浏览器保存重载/撤销/选区、系统中文输入实际检查、支持矩阵核验；无法安全解析必须保留或拒绝。界面改动另执行前端门槛。
- 验收结果：统一生产 schema、无损加载、旧 HTML 显式兼容及写作/历史/备份入口已实现。最终 207 项单测、DOCX Python 4 项回归、自制 DOCX 浏览器往返通过；主代理已实测结构恢复及四主题/窄屏错误状态。全量浏览器回归 108 项通过、3 项 Mock 专用跳过；保存失败草稿修复经 22 项相关流程复验通过，根标记拒绝补丁经 8 项相关浏览器场景复验通过。用户完成真实系统拼音输入，主代理核实组合事件、撤销、重做及刷新恢复。工程验收通过，详见[修复验收记录](../evidence/sessions/editor-snapshot-repair.md)。
- result_commits：结构修复 `a722eb4a12ca3360e2de7a281a31655d58dff025`、保存失败保护及验收证据 `74ae8282f0097b0a4c44bf725520646651c24b5a`、根标记拒绝 `60191100caa3e5dd23ec5a77d12d0ae9c05456a3` 均已推送；远端 main 核实为 `60191100caa3e5dd23ec5a77d12d0ae9c05456a3`。
- 证据与修订方案：[快照结构阻断](../evidence/sessions/2026-11-17-editor-snapshot-boundary-blocker.md)，2026-11-17 用户明确确认扩展修复。
- 恢复设计：生产节点/mark/属性白名单、无损反序列化、检查完成前不替换正文；写作页优先结构，历史/备份同门槛；旧 HTML 显式转换并保留原件，首次挂载结构不新增正文版本，未知结构不降级 HTML。已有章节 ID 保持；缺失 ID 仅显式一次兼容分配。
- 接口分工：核心代理维护 validate/prepare/capture/load 与显式 HTML 转换；备份代理维护 `attachLegacyDocumentStructure({projectId, version}, structure)` 和保存原子预检；主代理处理首次载入、激活、撤销与历史恢复、失败提示。公共接口变化先同步，禁止不同文件语义冲突。
- 下一步：用户恢复施工后认领 SG-03；SG-05 可独立并行。新明显设计问题仍须立即停止并反馈。

### 后续单状态
- SG-03：恢复认领，详见下方执行记录；SG-02 依赖已完成。
- SG-04：已确认，未认领；等待 SG-03。至少 30 组保护样例逐项登记，人工确认不由自动测试代签。
- SG-05：恢复认领，详见下方执行记录；SG-01 依赖已完成。包括任务中心与托盘统一真实状态，沿用[长任务设计](../evidence/sessions/job-reliability.md)。

### 用户暂停与恢复位置

- 用户原话：“先暂停，我要关机了，等会再继续”；登记时间 2026-11-17T15:36:01+08:00。立即停止新施工并中断仍在准备设计的 `sg03_documents`；本次仅完成保存、推送和交接。
- SG-01、SG-02 工程成果已验收，第一大阶段 SG-01—SG-05 尚未整体完成，不以本次暂停作为阶段验收。
- SG-03 目前只有只读接口、结构与事务方案，未创建业务文件或迁移；SG-04 未开工；SG-05 只有设计记录，未编辑业务。准备阶段提议的迁移编号尚未正式占用，恢复认领前重新检查远端。
- 恢复先执行开工盘点及 fetch，读本台账、[结构合同](editor-snapshot-contract.md)、[修复验收](../evidence/sessions/editor-snapshot-repair.md)与长任务设计，再分别认领 SG-03/SG-05。正文传输预算及本机/远端版本身份必须在 SG-03 设计中对齐；不能将本机 v1 和远端 v1 混用。
- 已确认前端保持现有布局与组件；子代理只用 gpt-6.1-sol 或 gpt-6-astra，独立工作并行，主代理实际验收。用户的本轮确认继续有效，无需重新确认已批准的阶段范围。

### 恢复施工盘点（2026-11-17）

- 用户回复“继续”，撤销上一条暂停指令。status 无未提交文件；唯一 main 检出、无其他工作树；fetch 成功，本地与 origin/main 均为 `06ddd64b4744a0f7364c13db13ba584840f07073`。
- 唯一协调者和检出不变。本轮仍不部署、不删除分支/工作树，不扩展 SG-06—SG-16。只有下列认领提交进入远端并重新核实占用后才能编辑业务。

### SG-03 执行记录

- 状态：完成。revision：5；更新时间：2026-11-17；base_commit：`06ddd64b4744a0f7364c13db13ba584840f07073`。
- 确认依据：第一阶段确认、已确认主动导入策略及本次“继续”；依赖 SG-02 已完成，结构合同含非空根 marks 拒绝。
- 分工：`sg03_documents` 使用 `gpt-6-astra / xhigh` 负责正文后端、同结构校验及事务回归；主代理负责正式写作/项目页接入、公共服务、迁移、生成契约和实际验收。
- 文件所有权：后端代理独占 `apps/api/src/thesis_pilot/modules/documents/`、`apps/api/tests/test_document_structure.py`、`test_documents.py`、`test_document_services.py`、`tests/integration/test_documents.py`、`tests/fixtures/editor-structures.json` 及 `docs/evidence/sessions/document-persistence.md`。主代理持有 `apps/api/src/thesis_pilot/main.py`、`db/models.py`、公共错误/请求边界、迁移、OpenAPI，以及 `apps/web/src/services/`、`ScreenWrite.vue`、项目接入组件、新正文状态/映射和相应前端合同、E2E。不得改 SG-05 独占文件。
- 共享资源占用：迁移 `20261117_0003`，父 `20261117_0002`，由主代理按单 head 串行整合；错误码 `DOCUMENT_NOT_FOUND`、`DOCUMENT_VERSION_NOT_FOUND`、`DOCUMENT_ALREADY_EXISTS`、`DOCUMENT_VERSION_CONFLICT`、`DOCUMENT_STRUCTURE_INVALID`、`DOCUMENT_TOO_LARGE`。既有 `PROJECT_NOT_FOUND` 沿用。
- 合同与界面边界：正文仅结构 JSON，章节索引派生；项目元数据版本、本机正文版本及远端正文版本独立。主动导入只允许空远端，保留本机原稿/历史。已有裸版本深链仍定位本机来源，正式稿绑定服务/项目/文档/版本。正文传输专用预算与生产结构校验对齐，普通 DTO 保持原限制。保存失败保留草稿、冲突不自动换基线重发、迟到响应不得串项目。SG-04 接入前，本地 AI 采纳不得走远端普通手动保存。
- 验收：后端 check.py、生成契约检查；真实 PostgreSQL 首次导入竞争/CAS/原子版本/重启恢复/项目隔离；前端 check/test/build、Mock/HTTP 的刷新恢复、双窗口冲突、失败保留与切换；主代理对照既有设计操作核验。上述工程验收已通过，保存门槛复核发现的实现问题已修正并复验，详见[正文持久化记录](../evidence/sessions/document-persistence.md)。
- result_commits：后端 `5817b4b6fa65ada11f371aec7e37e4900acf6600`；前端 `a3c39b355191079bcdc8a9332e57167f85fa56ec`。当前已在本地main，远端待核实；共同整合提交同时包含SG-05共享资源，不将中间提交称为完整应用交付。

### SG-05 执行记录

- 状态：完成，已确认的浮层修订验收通过。revision：5；更新时间：2026-11-17；base_commit：`06ddd64b4744a0f7364c13db13ba584840f07073`。
- 确认依据：第一阶段确认及本次“继续”；SG-01 已完成，可与 SG-03 独立并行；设计见[长任务记录](../evidence/sessions/job-reliability.md)。
- 分工：`sg05_reliability` 使用 `gpt-6.1-sol / xhigh` 负责后端任务和 worker；`sg02_backup` 使用 `gpt-6.1-sol / high` 负责前端任务中心与托盘；主代理维护共享契约、迁移、配置、真实环境与实际验收。
- 后端所有权：`apps/api/src/thesis_pilot/modules/jobs/{models,schemas,service,router}.py`、`workers/{execution,tasks,celery_app}.py`、`tests/{test_job_services,test_job_list,test_workflows}.py`、`tests/integration/{test_services,test_long_jobs}.py` 及明确的专属测试 helper。
- 前端所有权：`apps/web/src/lab/pages/PageScreens.vue`、`screens/ScreenJobs.vue`、`components/integration/ServiceJobs.vue`、`components/integration/jobsRequests.ts`、现有 `JobTray.vue`、新 `src/lab/state/serviceJobs.ts`、`tests/unit/service-jobs.test.ts`、`tests/e2e/api-integration.spec.ts`、`tests/e2e/http-integration.http.ts` 及专属任务回归。公共 services/生成文件由主代理统一修改；PageScreens 交接后主代理再整合正文保存指示，禁止同时写入。未确认的任务幂等键按服务/项目存于当前标签会话，刷新重试沿用，确认后清除。
- 共享资源占用：迁移 `20261117_0002`，父 `20261114_0001`；可空 `jobs.execution_deadline_at`；结果码 `JOB_EXECUTION_TIMEOUT`、`JOB_RESULT_INVALID`。主代理新增 `TP_WORKER_EXECUTION_TIMEOUT_SECONDS`（默认 900，范围 1—3600），同步配置示例及测试环境隔离。Job list 增加可重复 `status` 过滤，原分页语义保留；前端接口使用状态数组。
- 交互：共享同服务/项目的任务状态；前台取消以服务确认或重查为准；重新运行创建新幂等任务，旧终态保留。活跃数来自状态过滤后的总数，不从最近页猜测。内部标识、诊断代码和摘要收进详情，保留本机任务入口与来源深链，复用现有组件及动效。
- 验收：check.py、真实 PostgreSQL/Redis/Linux prefork 的长执行、续租、锁等待跨期、失租、取消迟到、重复投递、进程退出和耗尽；前端合同与 preview/Mock/HTTP 回归；主代理四主题、窄屏、键盘和减弱模式检查。上述工程验收及已确认浮层修订均通过，详见[长任务记录](../evidence/sessions/job-reliability.md)。
- result_commits：后端 `5817b4b6fa65ada11f371aec7e37e4900acf6600`；前端 `a3c39b355191079bcdc8a9332e57167f85fa56ec`。当前已在本地main，远端待核实；正文与任务共享迁移、入口和契约由主代理统一整合。

### SG-03/SG-05 验收与停工位置

- 远端认领 `66453721d708bf09d368ee8d609e8c762f8b6cf9` 已由主代理实际核实后放行。SG-03后端与SG-05前后端已落地；主代理已接正式稿来源、独立草稿及历史。文件范围细化：SG-03结构案例实际使用 `apps/api/tests/fixtures/document-structure.json`；`sg05_reliability / gpt-6.1-sol / xhigh` 后续负责 `remoteDocuments.ts`、`documentDrafts.ts` 及专有回归；`sg02_backup / gpt-6.1-sol / high` 后续负责两个FormalDocument组件、跨语言结构和service回归。公共上下文、布局和入口由主代理整合。
- 实证：最终Linux统一检查141快测与22真实集成全部通过；前端check、275单测、build通过。默认preview全量108通过、5跳过、1失败，失败为本机重试次数详情断言，尚未修复；跳过项为独立Mock和HTTP拦截场景。实际HTTP正文导入/保存/冲突/恢复和真实任务取消/重新运行已操作，完整视觉验收未通过。
- 新阻断：晨雾主题390px任务托盘最终态透出底层文字；关闭命中18×18小于设计规范。按用户要求立即停止后续业务施工、SG-04只读准备及文档续写。修订范围与证据见[浮层修订方案](../evidence/sessions/job-tray-design-blocker.md)，待用户确认。
- SG-04 尚未认领、未编辑业务文件。SG-03/SG-05 不标完成，不自动进入下一单。业务变更、真实测试原件和本机检查点保留；未将未通过成果推送main，未部署。

### SG-05 修订确认与恢复

- 用户明确答复“确认，按修订方案修复并继续”。恢复前fetch成功，HEAD与origin/main均为 `66453721d708bf09d368ee8d609e8c762f8b6cf9`；唯一main检出，保留72文件本机检查点，无占用冲突。
- 范围沿用现有SG-05认领：`sg02_backup / gpt-6.1-sol / high`修复JobTray材质与关闭按钮；`sg05_reliability / gpt-6.1-sol / xhigh`并行修正真实重试详情回归及浮层行为回归；主代理串行维护共享规范/令牌并实际验收。`sg03_documents / gpt-6-astra / xhigh`仅恢复SG-04设计准备，不提前编辑业务。
- 执行[已确认修订方案](../evidence/sessions/job-tray-design-blocker.md)：四主题浮层遮挡底层文字、关闭点击范围至少36×36、详情可查执行次数、既有取消/重试/迟到保护保留。验收后继续SG-04；再次发现明显设计问题仍立即停工反馈。

### SG-03/05 最终工程验收与交付准备

- 后端统一Linux门槛141快测和22真实集成通过，无跳过；迁移单head为 `20261117_0003`。前端最终check、275单测、默认构建通过；浮层修订后默认Chrome110通过、5个专用模式跳过，独立Mock4项通过。保存门槛最终修复后另跑写作/保护/快照/版本19项及HTTP拦截/真实IndexedDB草稿2项，全部通过。
- 主代理真实HTTP验收正式稿导入、保存、两窗口冲突、来源撤销隔离、断网草稿恢复、跨项目和迟到响应；超限列表不提交旧草稿，切源不清掉失效稿，修正后只提交当前正文。正式稿和任务页面四主题、390px、键盘与减弱动效已实际查看；托盘不透字、不被外观按钮覆盖、关闭36×36、退出inert和快速重开通过。
- 失败原件保留：全量旧执行次数断言、Mock新ID正则误写、浏览器粘贴切片形态断言均经纠正复验，不按首次成功记录。完整产品AC仍0/19，不将本阶段工程子集代作全产品通过。
- 用户追加“提交记得改为中文，不要英文提交……继续开发”。后续标题说明统一中文；本轮未推送的后端提交说明已调整，远端历史未改写。SG-04仅完成[设计及42组保护样例草案](../evidence/sessions/document-revisions.md)，尚未编辑业务；样例人工确认栏保持待确认。

### SG-03/05 交付核实

- fetch成功，rebase实际返回main已是最新；远端自认领后没有新增迁移/错误码，本轮0002/0003及新增错误码与远端碰撞为0。完整门槛之后未修改后端，前端最终修复已有针对性复验。
- 推送成功，远端main和本地HEAD实际均为 `4be318b49dbe6bd4389be0c79f00517a60c18ac3`；其中包含后端 `5817b4b6fa65ada11f371aec7e37e4900acf6600`、前端 `a3c39b355191079bcdc8a9332e57167f85fa56ec` 及证据/说明。查询仓库仍为PRIVATE。SG-03/05据此登记完成，本状态登记提交也须推送核实。
- 未部署、未删除分支/工作树、未改写远端提交。第一大阶段仍待SG-04，非整个阶段完成。

### SG-04 执行记录

- 状态：待验收（工程通过，人工保护样例未确认）。revision：4；更新时间：2026-11-17；base_commit：`4be318b49dbe6bd4389be0c79f00517a60c18ac3`。认领提交 `ada3b5630aadc27c602eb8347a1944b172d0b298` 已实际推送并核实后放行业务；恢复fetch成功，远端仍同位。用户确认两类窄屏抽屉修订，随后授权范围内问题按推荐方案直接处理。唯一协调者、main检出及工作目录不变。
- 确认依据：已确认首阶段SG-01—SG-05、继续原定阶段及本次“继续开发”；SG-03依赖已完成。流程与验收按[保护及事务设计](../evidence/sessions/document-revisions.md)，沿用确定性候选，不扩展真实模型或后续单。
- 并行分工：`sg03_documents / gpt-6-astra / xhigh`负责服务端UTF-16锚点、保护和事务；`sg05_reliability / gpt-6.1-sol / xhigh`负责前端命令/候选状态、未知结果恢复及Mock同契约；`sg02_backup / gpt-6.1-sol / high`负责复用现有审阅组件的正式稿面板与历史动作。主代理负责共享契约、迁移、写作入口、前后端整合及实际操作验收。
- 后端所有权：新 `apps/api/src/thesis_pilot/modules/revisions/`、新 `tests/test_revision_*.py`、`tests/test_revisions.py`、`tests/integration/test_revisions.py`、`tests/fixtures/revision-protection.json`，以及 `modules/documents/service.py` 的现有外层事务内追加版本函数、`models.py/schemas.py` 的版本来源枚举扩展。后端代理先交付DTO和模型契约，不修改迁移、公共入口/注册/生成文件。
- 前端状态所有权：新 `src/lab/state/remoteRevisions.ts`、`revisionCommands.ts`，新 `src/services/mockRevisions.ts` 和 `revisionProtection.ts`，必要的 `mockDocuments.ts` 内部事务适配；`remoteDocuments.ts` 的外部命令结果协调接口与专属单测；新修订状态/服务及E2E回归。与后端共享同源fixture，但fixture只由后端代理写。
- 前端页面所有权：新 `src/lab/components/integration/FormalRevisionPanel.vue`、必要的纯预览候选适配器，既有 `FormalDocumentHistory.vue` 的正式历史恢复入口与来源展示。不得改ScreenWrite或共享VersionTimeline；需要的共享组件参数由主代理串行修改。
- 主代理所有权：ScreenWrite、PageScreens/正式稿上下文、共享审阅/时间线组件、services types/http/index/mock入口/errors/validation、OpenAPI/DTO生成、main/dbmodels/health、迁移、台账与文档/证据。任何跨所有权调整先交接，所有Git操作由主执行。
- 共享资源：迁移 `20261117_0004`，父 `20261117_0003`；新增revision_candidates/revision_proposals/revision_commands，扩展历史来源为ai_adoption/adoption_undo/version_revert。错误码占用设计中的 `REVISION_NOT_FOUND`、`REVISION_COMMAND_NOT_FOUND`、`REVISION_STALE`、`REVISION_STATE_CONFLICT`、`REVISION_REVIEW_CONFLICT`、`REVISION_COMMAND_CONFLICT`、`REVISION_POLICY_STALE`、`REVISION_UNDO_CONFLICT`、`REVISION_ANCHOR_INVALID`、`REVISION_PATCH_INVALID`、`REVISION_PROTECTION_FAILED`、`REVISION_UNSUPPORTED`、`REVISION_NOTHING_ACCEPTED`、`REVISION_NO_CHANGE`、`REVISION_TOO_LARGE`。
- 协议：固定输入先登记再接收一次proposal；逐项决定不改正文；采纳、撤销、历史恢复由同事务CAS追加不可变版本并写命令回执；迟到、陈旧、重叠、越界、同键异参不能写入。身份含服务/项目/文档/版本；普通手动保存不承担候选采纳。候选请求/响应256KiB、选区32768个UTF-16单元、100补丁；正文继续16MiB结构合同。
- 验收：同源保护样例、真实PostgreSQL并发/故障回滚/重启和HTTP操作、前端Mock/HTTP状态及草稿保护、完整工程门槛；主代理四主题/窄屏/键盘/减弱模式实测。至少30组人工确认是独立验收项，设计已列42组，仍待实际执行及用户确认，不由自动化或主代理冒签人类结果。
- 恢复分工：`sg02_backup / gpt-6.1-sol / high`接管ScreenWrite中的浮层布局、关闭/焦点/过渡逻辑与WritingOutline关闭入口；不得改正文事务逻辑。`sg05_reliability / gpt-6.1-sol / xhigh`继续状态、Mock与同源保护复验，并独占新抽屉行为回归；`sg03_documents / gpt-6-astra / xhigh`继续后端预算/16MiB边界及统一门槛。主代理仍独占共享规范、台账、迁移和Git，负责实际页面验收。
- result_commits：后端 `f2871d3d51cd17bd235c8fe5439486c3a30e5a1a`；前端 `d282e646f9f30037183c3caaa86a1b7aa522a30c`。两次均为中文提交；文档证据及远端交付核实见后续记录。未完成的人工预期确认不因工程提交而改为通过。

### SG-04 最终工程验收与收工准备

- 后端统一门槛216快测、30真实PostgreSQL/Redis/Linux worker/HTTP集成均通过，无跳过；Ruff、mypy、真实OpenAPI及Alembic单head0004通过。包含同命令并发、不同候选竞争、决定CAS、取消迟到、服务重启、不可变记录及故障回滚；256KiB候选增长和16MiB采纳结果超限均整次回滚。
- 前端最终check、360单测、默认preview构建通过；默认浏览器114通过、9模式专用跳过，独立Mock7通过。跳过不算通过，模式及最后小改动复验范围见[修订记录](../evidence/sessions/document-revisions.md)。全仓契约扫描使用指定git grep覆盖跟踪文件和未忽略未跟踪文件，共373处/45文件；生成契约、词汇、共享组件、页面和Mock均同步。
- 主代理实际HTTP验证决定不改稿、采纳v2、撤销v3、历史恢复v4；真实提交后丢响应可查原命令恢复且仅一次采纳请求；请求期间输入的新草稿保留；取消和旧候选不能改稿；策略变化后旧候选明确不可采纳。实际查看四主题桌面与两类窄屏抽屉，确认不透字、顶层遮挡、关闭36×36、焦点/键盘/遮罩、长内容滚动、快速重开及100ms减弱动效。
- 原窄屏失败及修复中暴露的遮罩、页签收缩、减弱位移问题保留证据，修正后复验通过；没有降级界面为文字列表，没有重建正文编辑器。主代理完成实际验收，子代理已交接停止修改。
- 文档校验通过：92份文档、430个本地链接；聊天证据5个主聊天、28次子代理运行，原件哈希、真实派发/提交定位、排除范围和展示同步通过，diff检查无错误。
- 人工样例仍为42组、27变体待核对，至少30组人工预期确认未完成，AI不代签；SG-04保持待验收、第一阶段不登记完整完成，产品19项完整AC状态不变。当前工程成果可交付私有main，不进入SG-06之后的新范围，不部署或删除分支/工作树。
