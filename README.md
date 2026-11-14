# ThesisPilot · 毕设智途

**暂定题目：《毕设智途：基于 AI 智能体的毕业论文进度追踪与可控辅助修改系统》**

面向毕业论文写作，将学校要求、论文版本和导师反馈关联起来，以证据追踪进度，在本人审阅下完成有依据、可撤销的局部修订。

GitHub：[zcf-77/thesis-pilot](https://github.com/zcf-77/thesis-pilot)（Private，需授权访问）。

> 当前阶段（2026-11-14）：`apps/web` 包含九页设计展台与十二个 Vue 交互设计页面：七个工作空间，以及项目、收件箱、账户、执行任务、导出备份。原页面已补齐全局阶段进度、写作三栏和受控候选、任务与反馈证据、资料要求、通知和执行任务，并支持浏览器本地保存、刷新恢复和 JSON 备份。项目元数据与诊断任务已通过真实 HTTP、PostgreSQL、Redis、Linux worker 联调；正式论文完整业务、真实模型、复杂文档解析及 DOCX 往返尚未验收，19 项完整产品验收尚未完成。

> **同日修复状态：** 用户已授权修复现有设计稿。缺失组件、类型错误和进度挂载已修复；当前修复内容见[逐项结果](docs/design/existing-design-repair-results.md)，实际检查及截图见[修复证据](docs/evidence/sessions/2026-11-14-existing-design-repair.md)。[此前审计](docs/design/design-implementation-audit.md)保留原始缺口与失败记录，不作为修复后状态。

> **后端底座首轮记录（2026-11-14）：** 新增 `apps/api`，含应用配置、认证边界、错误契约、项目持久化与版本控制、Job/outbox、Celery 适配和 LangGraph 诊断图。该轮 25 项同步测试通过，OpenAPI 已真实生成；网络和本地 socket 限制阻断了完整依赖锁、HTTP 与真实服务验证，当时尚未连接前端。启动前先读[后端说明](apps/api/README.md)及[该轮实测](docs/evidence/sessions/2026-11-14-backend-foundation.md)，不将代码底座计为完整产品后端已验收。

> **契约与真实接入（2026-11-14）：** 项目名称及诊断任务提供统一 DTO、运行时校验、Mock/HTTP 服务和同页接入组件；默认 `preview` 保留完整本地预览。规划、正文、资料等仍保存在本机；远端项目通过独立关联保留本地 ID 和内容。本轮已补齐 Windows/Linux 锁定依赖，后端 62 项快测与 7 项真实服务集成通过，浏览器真实验证项目冲突恢复、取消和队列执行。启动与双阶段验收见[本地运行](docs/engineering/local-runtime.md)，实际结果见[联调证据](docs/evidence/sessions/2026-11-14-real-integration.md)；此前接入过程见[原记录](docs/evidence/sessions/2026-11-14-frontend-integration.md)。

## AI 施工入口

对项目 AI 说“开工”或“开工 SG-编号”，按已确认施工单执行；每单结束自动验收与收工，也可随时说“收工”进行交接。当前业务单全部待确认，不自动开始业务改造。见[开工与收工](docs/engineering/construction-workflow.md)及[施工单与待决事项](docs/engineering/construction-orders.md)。

## 项目入口

| 内容 | 文件 |
|---|---|
| 当前设计展台源码与启动方式 | [apps/web](apps/web/README.md) |
| 后端底座、接口与验证限制 | [apps/api](apps/api/README.md) |
| 本地 PostgreSQL/Redis、API/worker 与真实浏览器联调 | [本地运行说明](docs/engineering/local-runtime.md) |
| 后端开发模式、规范与任务模板 | [开发规范](docs/engineering/backend-development.md)；[参考仓库](docs/engineering/backend-references.md)；[任务模板](docs/engineering/templates/backend-task.md) |
| 统一数据结构、契约生成与逐模块接入 | [数据契约规范](docs/engineering/data-contracts.md)；[前端接入说明](docs/engineering/frontend-integration.md) |
| 当前设计规范 | [DESIGN-SPEC](apps/web/docs/design/DESIGN-SPEC.md) |
| 统一控件与实际动效 | [自定义控件约束](docs/design/custom-controls.md)；[功能动效映射](docs/design/global-motion-implementation.md)；[本轮修复与检查](docs/evidence/sessions/2026-11-14-custom-controls-motion.md) |
| 最新修复及预览 | [23组缺口处理](docs/design/existing-design-repair-results.md)；[检查与效果截图](docs/evidence/sessions/2026-11-14-existing-design-repair.md) |
| 离线HTML交付 | [thesispilot-design-preview.html](deliverables/thesispilot-design-preview.html)，双击直接进入写作台，可切换原有12页 |
| 完整功能、模块、状态及跨页设计 | [交付功能设计基线](docs/design/delivered-functional-design.md)；[46项原稿来源](docs/design/delivery-source-functional-inventory.md) |
| 当前实现差距及逐项验收 | [实现审计与缺口](docs/design/design-implementation-audit.md)；[本轮实际检查](docs/evidence/sessions/2026-11-14-functional-design-audit.md) |
| 页面设计前置流程与当前缺口 | [页面功能设计与覆盖](docs/design/page-functional-design.md) |
| 全套页面实现与逐轮自检 | [功能设计与轮次](docs/design/remaining-screens-plan.md)；[实际验证记录](docs/evidence/sessions/2026-11-14-complete-designs.md)；入口 `#/screens/today` |
| 本次导入来源、修改及验证 | [导入记录](docs/evidence/sessions/2026-11-12-design-source-import.md) |
| 计划、资料、导师反馈页面设计 | [本轮范围与验证](docs/evidence/sessions/2026-11-14-page-designs.md)；运行后访问 `#/screens/plan` |
| 已确认功能与范围 | [产品方案](docs/product/proposal.md) |
| 19 项产品验收场景 | [验收标准](docs/product/acceptance.md) |
| 比赛要求与待确认事项 | [官方要求映射](docs/competition/requirements.md) |
| 仓库内 AI 工作指令 | [AGENTS.md](AGENTS.md) |
| 单人 AI 开发工作流 | [开发规范](docs/engineering/solo-ai-development.md) |
| 前后端技术栈、模块实现与取舍 | [架构说明](docs/engineering/architecture.md) |
| 完整功能架构图 | [SVG 架构图](docs/engineering/diagrams/thesis-pilot-architecture.svg) |
| 全套 Mock 前端功能范围 | [功能需求](docs/design/full-mock-functional-requirements.md) |
| 设计智能体交付与验收 | [交付要求](docs/design/full-mock-delivery-requirements.md) |
| 可选文档转换服务的研究与边界 | [MuffinOffice 接入研究](docs/engineering/integrations/muffin-office.md) |
| 阶段门槛与当前状态 | [执行路线](docs/engineering/roadmap.md) |
| 原始对话、提交与验证的对应方法 | [证据规范](docs/evidence/README.md) |
| 提交与发布流程 | [CONTRIBUTING.md](CONTRIBUTING.md) |

## 已确认功能

1. **论文主工作区**：沉浸式编辑，支持统一 AI、专业 AI、侧栏与多面板入口，切换保留写作上下文。
2. **开题至答辩的进度辅助**：个人规划、产物证据、导师反馈、重大节点提醒；学生确认完成，AI 建议计划调整后由学生采纳。
3. **受控修订**：保护数字、引用、公式与锁定内容，审阅差异后采纳，处理版本冲突、撤销和恢复。
4. **模板与论文要求**：上传解析、来源定位、规则管理和版本绑定；资料无需核对发布，暂不处理规则更新影响。
5. **独立论文评审**：可只评审，返回问题清单、参考评分与报告，不自动修改论文。
6. **四库管理**：智能体库、提示词库、AI API 接口库、模型库及管理页面。暂不展开租户、学校层级和角色权限体系。

## 技术方向

- 前端：Vue 3、TypeScript、Tailwind CSS、daisyUI、Vue Router、Pinia；统一由 Vite+ 管理工程与底层 pnpm，补足 Vue 类型检查。
- 后端：Python、FastAPI、Pydantic、PostgreSQL、SQLAlchemy、Alembic；LangGraph 编排，Celery + Redis 后台任务；uv、Ruff、pytest、Playwright 用于工程与验证。
- 编辑器：优先开源编辑内核，自行实现 Vue/daisyUI 外壳；具体内核经原型验证后确定。MuffinOffice 为可选服务端文档转换候选，不等待其浏览器 SDK；其接口能力仍以实测为准。
- 采用模块化单体，API、worker、调度器分进程运行。模型供应商、部署环境和具体依赖锁版本仍待验证。

## 新设计展台启动

在仓库根目录执行：

```powershell
cd apps/web
vp install --frozen-lockfile
vp dev --host 127.0.0.1 --port 18744 --strictPort
```

访问 `http://127.0.0.1:18744/`。设计展台使用 Vue、daisyUI 和 Tiptap，保留交付包的视觉方案；展示组件与正式业务能力的区别见 [前端说明](apps/web/README.md)。提交格式及验证门槛见 [提交规范](CONTRIBUTING.md)。

## 当前可执行检查

仅需 Python 3 标准库，在仓库根目录执行：

```powershell
python -X utf8 scripts/validate_repository.py
git diff --check
```

第一条检查文档链接、要求和验收编号、官方快照完整性及必要文件；不检查产品功能，也不代表满足完整比赛要求。

## 应用复现指南：尚待实现

实现后本节必须写明已验证的运行时版本、依赖锁、环境变量模板、数据初始化、启动地址、模型接入方式与前置条件、演示数据、测试和恢复步骤。不得在启动命令尚未存在时写“已支持一键运行”。

需在干净环境真实计时核验官方的 10 分钟复现要求，披露下载、网络、硬件和模型前置条件。固定响应回放与真实推理分开标识、分开验收。

## 参赛与公开边界

- 赛道：2026 第九届传智杯 AI 创新应用挑战赛（个人赛）。按 2026-11-18 保守安排，官网时间冲突见要求台账。
- 远程仓库按用户要求使用 **Private**；参赛前需为评审配置可用访问权限，私有地址本身不等于可评审。
- 不提交真实论文、导师个人信息、账号凭据、模型权重或未脱敏对话；公开材料使用自制或获授权且脱敏的样例。
- 当前未选定开源许可证，私有仓库不表示授予公众复用许可；第三方依赖与素材仍须记录许可和来源。

后续前端以 `apps/web` 的设计规范和组件为统一依据，补齐业务状态与服务层，并验证编辑器选区、事务、撤销和保护对象。DOCX 往返与可选服务端转换能力另行验证。
