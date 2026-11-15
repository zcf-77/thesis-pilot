# ThesisPilot · 毕设智途

**暂定题目：《毕设智途：基于 AI 智能体的毕业论文进度追踪与可控辅助修改系统》**

面向毕业论文写作，将学校要求、论文版本和导师反馈关联起来，以证据追踪进度，在本人审阅下完成有依据、可撤销的局部修订。

GitHub：[zcf-77/thesis-pilot](https://github.com/zcf-77/thesis-pilot)（Private，需授权访问）。

## 当前状态

- 正式工作区可独立构建和本机启动。解锁后使用真实项目、空白正式稿、正文保存与历史；个人偏好由服务保存，正文草稿按工作区与项目隔离。启动步骤见[正式工作区](docs/engineering/local-runtime.md#正式工作区)。
- `apps/web` 包含九页设计展台和十二个 Vue 交互页面。写作台使用 Tiptap，支持选区保护、本地修订候选、浏览器保存、刷新恢复与 JSON 备份。页面修复与测试见[前端修复记录](docs/evidence/sessions/2026-11-14-existing-design-repair.md)。
- 默认构建仍为本地 `preview`。显式选择 HTTP 模式后，已关联项目可主动将本机原稿导入空的正式稿，按独立版本保存、对比历史，并显式恢复为新版本。双窗口发生版本冲突时，可保留独立浏览器草稿并载入新版。本机原稿、规划、资料和反馈继续由浏览器保存。见[正文持久化记录](docs/evidence/sessions/document-persistence.md)。
- 项目元数据、正式稿和诊断任务共用 Mock/HTTP 契约。真实 PostgreSQL、Redis 与 Linux worker 已验证长任务续租、超时、取消、异常结果及进程退出恢复。任务中心和全局托盘共用服务状态，重新运行会创建新任务并保留旧结果。见[长任务记录](docs/evidence/sessions/job-reliability.md)。
- 独立 DOCX 小样已用学校模板和自制样例验证导入、编辑、快照重载与副本导出。正式写作台的 DOCX 入口待接入和验收。见[小样支持范围](docs/engineering/docx-roundtrip.md)。
- 正式稿已接入服务端候选保护、逐项决定、原子采纳、撤销及历史恢复。候选来自确定性文字预览；同命令重试不重复写入，迟到结果保留期间新草稿。SG-04 工程验收通过，42 组保护样例及 27 个变体仍待人工核对。见[修订记录](docs/evidence/sessions/document-revisions.md)。账户与项目归属授权、真实模型、外部检索及复杂文档解析仍待验收，19 项完整产品场景保持未完整验收。见[产品验收表](docs/product/acceptance.md)。

## AI 施工入口

对项目 AI 说“开工”或“开工 SG-编号”可启动已确认的施工单，也可说“收工”进行交接。认领和验收状态见[施工台账](docs/engineering/construction-orders.md)，具体步骤见[开工与收工](docs/engineering/construction-workflow.md)。

从设计展台到完整业务系统的节点、并行排期、功能覆盖与正式切换门槛见[正式系统实施计划](docs/engineering/business-system-plan.md)。SG-17先建设正式入口，逐模块接通后由SG-20切换默认正式产物，SG-15按全部规划功能及19项AC终验；这些新增业务尚未实施。

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
| 页面修复及预览 | [23组缺口处理](docs/design/existing-design-repair-results.md)；[检查与效果截图](docs/evidence/sessions/2026-11-14-existing-design-repair.md) |
| 离线预览 | 在 `apps/web` 运行 `vp build` 后打开 `dist/thesispilot-design-lab.html` |
| 完整功能、模块、状态及跨页设计 | [交付功能设计基线](docs/design/delivered-functional-design.md)；[46项原稿来源](docs/design/delivery-source-functional-inventory.md) |
| 前端修复前的审计 | [实现审计与缺口](docs/design/design-implementation-audit.md)；[审计检查记录](docs/evidence/sessions/2026-11-14-functional-design-audit.md) |
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
| 核心功能链、开发对话和智能体执行 | [开发档案 HTML](docs/evidence/showcase.html)；[证据规范](docs/evidence/README.md) |
| 提交与发布流程 | [CONTRIBUTING.md](CONTRIBUTING.md) |

## 已确认的产品范围

1. **论文主工作区**：沉浸式编辑，支持统一 AI、专业 AI、侧栏与多面板入口，切换保留写作上下文。
2. **开题至答辩的进度辅助**：个人规划、产物证据、导师反馈、重大节点提醒；学生确认完成，AI 建议计划调整后由学生采纳。
3. **受控修订**：保护数字、引用、公式与锁定内容，审阅差异后采纳，处理版本冲突、撤销和恢复。
4. **模板与论文要求**：上传解析、来源定位、规则管理和版本绑定；资料无需核对发布，暂不处理规则更新影响。
5. **独立论文评审**：可只评审，返回问题清单、参考评分与报告，不自动修改论文。
6. **四库管理**：智能体库、提示词库、AI API 接口库、模型库及管理页面。暂不展开租户、学校层级和角色权限体系。

## 技术方向

- 前端：Vue 3、TypeScript、Tailwind CSS、daisyUI、Vue Router、Pinia；统一由 Vite+ 管理工程与底层 pnpm，补足 Vue 类型检查。
- 后端：Python、FastAPI、Pydantic、PostgreSQL、SQLAlchemy、Alembic；LangGraph 编排，Celery + Redis 后台任务；uv、Ruff、pytest、Playwright 用于工程与验证。
- 编辑器使用 Tiptap 与自有 Vue/daisyUI 外壳。MuffinOffice 保留为可选服务端转换方案。
- 采用模块化单体，API、worker 和任务派发进程独立运行。前端使用 `pnpm-lock.yaml`，后端使用 `uv.lock`。模型已选 DeepSeek 官方接口，尚待接入和验证。外部检索服务与部署环境待选定。见[架构说明](docs/engineering/architecture.md)。

## 启动本地预览

在仓库根目录执行：

```powershell
cd apps/web
vp install --frozen-lockfile
vp dev --host 127.0.0.1 --port 18744 --strictPort
```

访问 `http://127.0.0.1:18744/`，可从首页打开交互页面，或直接访问 `http://127.0.0.1:18744/#/screens/today`。安装所需工具版本和离线预览方法见[前端说明](apps/web/README.md)。

## 基础检查

仅需 Python 3 标准库，在仓库根目录执行：

```powershell
python -X utf8 scripts/validate_repository.py
git diff --check
```

前端从 `apps/web` 运行 `vp run check`、`vp test run` 和 `vp build`。后端从 `apps/api` 运行 `uv sync --locked` 和 `uv run --locked python scripts/check.py`。浏览器回归及真实数据库、队列联调使用独立的检查入口。见[提交规范](CONTRIBUTING.md)及[本地联调](docs/engineering/local-runtime.md)。

## 本地服务复现

按[本地运行指南](docs/engineering/local-runtime.md)准备隔离的 PostgreSQL、Redis、环境配置及迁移，再启动 API 和 HTTP 模式前端。诊断任务另需 Linux worker 和任务派发进程。接口和当前验证范围见[后端说明](apps/api/README.md)。

参赛所需的干净环境 10 分钟复现尚未计时。正式版本的复现说明仍须覆盖下载、网络、硬件和模型前置条件。见[比赛要求](docs/competition/requirements.md)。

## 参赛与公开边界

- 赛道：2026 第九届传智杯 AI 创新应用挑战赛（个人赛）。按 2026-11-18 保守安排，官网时间冲突见要求台账。
- 远程仓库按用户要求使用 **Private**；参赛前需为评审配置可用访问权限，私有地址本身不等于可评审。
- 不提交真实论文、导师个人信息、账号凭据、模型权重或未脱敏对话；公开材料使用自制或获授权且脱敏的样例。
- 当前未选定开源许可证，私有仓库不表示授予公众复用许可；第三方依赖与素材仍须记录许可和来源。

后续前端以 `apps/web` 的设计规范和组件为统一依据，补齐业务状态与服务层，并验证编辑器选区、事务、撤销和保护对象。
