# 后端参考仓库与采纳记录

核验日期：2026-11-14（Asia/Shanghai）。本轮直接查阅官方仓库和文档，借鉴工程组织与可靠性实践，不整体移植其他产品。下表的“本项目决定”是面向 ThesisPilot 需求的选择；开源项目的能力不代表本项目已完成验收。

精确安装版本以 `apps/api/uv.lock` 和运行证据为准。链接指向核验时的官方页面，分支页面会变化；本轮没有导入外部源码快照，因而不虚构某个来源 commit SHA。未来复制源码片段须单独记录固定 commit、文件、修改范围和许可证声明。

| 官方来源与许可 | 核验的实践 | 本项目决定 | 不直接照搬的部分 |
|---|---|---|---|
| [FastAPI full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template)，MIT；[后端配置](https://github.com/fastapi/full-stack-fastapi-template/blob/master/backend/pyproject.toml)、[后端说明](https://github.com/fastapi/full-stack-fastapi-template/blob/master/backend/README.md) | 独立后端配置、类型检查、pytest、迁移、锁文件和生成前端契约 | 使用应用工厂/设置、锁定依赖、测试和 Alembic；以 OpenAPI 作为接口合同 | 保留既有 Vue 与 SQLAlchemy；不搬 React、SQLModel、登录邮件、云部署及整套模板业务 |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)，MIT；[interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)、[persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | 显式图状态、节点与暂停恢复；持久状态和内存样例的区别 | 首轮仅接入结构化诊断图；正式写入继续由业务服务审阅后提交；持久人工暂停在相应业务迭代单独验收 | 不为角色数量创建独立模型/服务；不把内存 checkpoint 当重启恢复；不把图完成当论文已批准 |
| [celery/celery](https://github.com/celery/celery)，New BSD（[LICENSE](https://github.com/celery/celery/blob/main/LICENSE)）；[Tasks](https://docs.celeryq.dev/en/stable/userguide/tasks.html) | 幂等任务、确认与重新投递、外部调用超时 | 事务 outbox 加幂等键，消费端令牌/租约与条件提交；消息只包含 job ID，数据库保留状态 | 不用 Celery result backend 作为产品事实来源；不将 acks_late 当恰好一次，也不声称原生 Windows worker 已受验证 |
| [sqlalchemy/sqlalchemy](https://github.com/sqlalchemy/sqlalchemy)，MIT；[Session Basics](https://docs.sqlalchemy.org/en/20/orm/session_basics.html) | Session 对应事务和本地生命周期，不能在并发任务共享 | 同步 SQLAlchemy 2.x；每请求/执行一个 Session，service 拥有事务，数据库约束与 CAS 处理竞争 | 不为“先进”强制 async；不使用全局 Session，不让 repository 独立提交破坏外层原子性 |
| [astral-sh/uv](https://github.com/astral-sh/uv)，Apache-2.0 或 MIT；[GitHub Actions 指南](https://docs.astral.sh/uv/guides/integration/github/) | Python/依赖管理、锁定同步与 CI 复用 | `.python-version`、`pyproject.toml`、`uv.lock` 与 `uv sync --locked`；统一本地和 CI 检查入口 | 不照抄文档中会更新的示例版本；不在自动检查时静默升级全部依赖 |
| [Alembic 官方 autogenerate 指南](https://alembic.sqlalchemy.org/en/latest/autogenerate.html)；[源码仓库](https://github.com/sqlalchemy/alembic) | 自动生成是待审迁移，需要开发者检查修正 | 单一 head、集中分配迁移父节点、实际数据库 upgrade/check；删改数据必须明确授权范围 | 不将 autogenerate 结果直接视为安全迁移，不在应用启动时自动建表或 stamp |

上表许可描述对应列出的仓库页面；不是全部直接/传递依赖许可证清单。Alembic 文档用于方法参考，后续随实际依赖版本核验其发行包许可。数据库/队列服务版本和使用条件须在接入记录中单独确认；不能把 Python 客户端许可推断成服务端许可。

## 引入的是哪些开发模式

1. **按功能交付纵切片**：一个需求同时包含 schema、服务、数据库约束和验收，避免先建大量空模块。
2. **契约与代码共同演进**：HTTP schema、错误码、OpenAPI 变更一起审阅；前端正式接入时再生成/适配调用层。
3. **依赖和检查可复现**：锁文件固定解析结果，开发者与 CI 使用同一入口；真实服务缺失明确失败。
4. **事务管理事实，队列传递工作**：outbox 对接至少一次投递，幂等与版本检查在数据库最终执行；这是基于项目可靠性需求的组合设计，并非某一模板开箱即用的保证。
5. **AI 的输出可审阅**：工作流生成结构化产物，权限、保护检查和采纳由程序控制；模型能力与确定性代码能力分别验证。
6. **小步演进并保留真实证据**：只记录实际实现与运行，独立审查高风险边界；沿用本仓库协作台账，不新增重复管理层。

## 升级与引用规则

- 升级由明确任务发起，说明问题、兼容风险、回退方法；重新生成锁、检查契约和迁移，并运行受影响的集成场景。
- 官方示例只证明示例设计；参考仓库的 README、CI 徽章和测试数量不能作为本项目测试结果。
- 引入源码、素材或模型时单独登记出处、固定版本/校验值、许可和改动；依赖安装不自动授予第三方论文、样例或数据的使用权。
- 避免版本营销表述。选择依据是当前项目约束、安装兼容和实测结果，不要求追逐最新主版本。
