# ThesisPilot 后端底座

FastAPI 模块化单体，项目元数据与诊断任务为首轮真实切片。前端 `apps/web` 尚未切换到本 API；本轮不实现账户登录、论文正文持久化与采纳、文件转换、四库或真实模型调用。

**当前状态（2026-11-14）：代码及 OpenAPI 已建立，离线真实依赖下 25 项同步测试通过。完整环境尚未验收。** 本机连接 PyPI 被执行环境拒绝，尚未生成 `uv.lock`；缺少 Alembic、psycopg、Celery、Redis、Ruff。HTTP 测试在 Windows asyncio 创建本地 socket 时阻塞，尚未进入请求。PostgreSQL/Redis/Linux worker 集成未运行；不得将此版本标为已可完整启动或已通过 CI。详见[实际证据](../../docs/evidence/sessions/2026-11-14-backend-foundation.md)。

## 已有入口

| 入口 | 行为 |
|---|---|
| `GET /health/live` | 进程存活，不连接数据库或队列 |
| `GET /health/ready` | 检查数据库连通、精确迁移版本及 Redis；未就绪 503 |
| `POST /api/v1/projects` | 新建项目元数据：`{"name":"自制样例"}` |
| `GET /api/v1/projects?limit=20&offset=0` | 有上限、稳定排序的分页查询 |
| `GET /api/v1/projects/{id}` | 读取项目 |
| `PATCH /api/v1/projects/{id}` | `{"name":"新名称","expected_version":1}`；旧版本 409 |
| `POST /api/v1/jobs` | `{"project_id":"UUID","kind":"diagnostic"}`，必须带 `Idempotency-Key`；返回 202 |
| `GET /api/v1/jobs/{id}` | 读取数据库中的真实任务状态 |
| `POST /api/v1/jobs/{id}/cancel` | 取消排队/执行中任务；迟到结果不能提交 |

业务入口统一要求 `Authorization: Bearer <TP_API_TOKEN>`。此令牌只是受控本地联调认证，不是用户账户、项目归属或权限系统；不可放入 Vue 源码或产物。成功直接返回类型化资源，错误为 `{"error":{"code":"...","message":"...","request_id":"..."}}`。契约见 [openapi.json](openapi.json)，开发环境 `/docs` 可交互查看；生产配置关闭文档入口。

诊断任务状态：`queued → running → succeeded / failed`，排队或执行中可转 `cancelled`。同幂等键同参返回同任务，异参 409。数据库事务同时保存 Job/outbox；派发允许重投，执行通过租约和 token 条件写入。执行租约失效最多恢复到 3 次尝试，耗尽记录 `JOB_ATTEMPTS_EXHAUSTED`。消息尚未认领时可重新派发，Redis 不是业务状态存储。

## 首次补齐环境

已检测 Python **3.13.7**、uv **0.12.17**。Python 工程声明 `>=3.13,<3.14`，数据库方向 PostgreSQL/psycopg；真实服务测试配置 PostgreSQL 17、Redis 7。外部服务需由开发者提供，本仓库不预设本机已安装或启动，也不自动操作其他数据库。

由于本轮网络阻断，首次需要在允许访问 PyPI 的开发环境，从本目录执行以下步骤。生成锁文件后审阅并作为下一次真实迭代提交；不得用手写版本清单替代依赖解析结果：

```powershell
uv lock
uv sync --locked
uv run ruff check . --fix
uv run ruff format .
uv run python scripts/export_openapi.py
uv run python scripts/check.py
```

后续正常开发只需 `uv sync --locked`；修改依赖才更新锁。本轮离线测试通过真实缓存包执行，版本与限制在证据中；缓存验证不是锁定安装，也不是可复现环境交付。CI 刻意在缺少锁文件时失败，不能跳过锁检查制造绿色状态。

## 配置、迁移与启动

1. 将 `.env.example` 复制为本目录 `.env`，配置自己的 PostgreSQL、Redis 连接及至少 32 字符的随机 API 令牌。实际文件被 Git 忽略。可用 `uv run python -c "import secrets; print(secrets.token_urlsafe(32))"` 生成本地令牌，不把输出粘贴进日志或 Git。
2. 确认连接指向本人明确选择的开发库，再执行迁移。API 不自动建表、迁移或 stamp。首迁移 `20261114_0001` 建立 `projects`、`jobs`、`outbox_events`。
3. 三个独立终端分别运行 API、Linux worker、dispatcher。当前 dispatcher 足够单进程；没有引入额外调度服务。

```powershell
uv run alembic upgrade head
uv run alembic check
uv run uvicorn thesis_pilot.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log
```

```text
uv run celery -A thesis_pilot.workers.celery_app:app worker --loglevel=WARNING
uv run python -m thesis_pilot.workers.dispatcher
```

API 默认仅绑定本机；`--no-access-log` 防止 Uvicorn 默认日志记录完整 URL/query。应用日志只记路由模板、请求 ID、状态和耗时；异常边界不向 ASGI 服务器传出原始异常值。诊断任务只接收 ID，模型和论文内容都不进入消息。

worker 的正式验证平台为 Linux。当前无长任务续租/心跳，仅支持无副作用的短诊断；真实解析、模型与导出任务必须先补续租、业务超时、结果 schema 及重试策略。LangGraph 示例没有持久 checkpointer，不宣称支持人工暂停后的重启恢复。

## 验证与恢复

```powershell
uv run python scripts/check.py
$env:TP_TEST_DATABASE_URL = 'postgresql+psycopg://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/thesis_pilot_test'
$env:TP_TEST_REDIS_URL = 'redis://127.0.0.1:6379/15'
uv run python scripts/check.py --integration
```

默认入口检查依赖锁、Ruff、mypy、51 项快测、OpenAPI 漂移和唯一迁移 head；静态检查失败立即停止。显式集成入口要求真实服务，缺连接或缺依赖失败，不静默 skip。真实服务共 7 项：迁移一致性、并发 CAS、并发幂等、并发派发锁、取消迟到、租约恢复、Redis/Celery 真实进程链路。

集成测试只接受数据库名以 `_test` 结尾，逐次生成随机 schema，清理仅该 schema；Redis 强制 DB 15 并使用随机键前缀和队列，不 FLUSHDB。worker 链路在 Linux 子进程使用 `solo` 池，证明消息与进程边界，不能代替部署环境的 `prefork` 验收。配置的是一次性测试资源，不要传入真实资料所在服务。

生产式恢复以数据库事实为准：重启 dispatcher 后继续派发未发布事件，超时未认领任务重派，过期执行重新取得 token；取消与旧 token 结果拒绝保存。数据库整体备份恢复、正式论文历史恢复尚未实现，不能把任务恢复等同 AC-012。

CI 定义位于 `.github/workflows/backend.yml`，目前未推送/运行。它只授予仓库只读权限，使用临时 PostgreSQL/Redis，执行同一检查入口。当前 25 个同步测试通过不等于全部 51 个快测、7 个真实服务测试或 19 项产品 AC 通过。

## 开发入口

当前错误码登记由整合者维护；新增码先检查语义重复，并补异常测试：

| 错误码 | 语义 |
|---|---|
| `AUTH_NOT_CONFIGURED` / `UNAUTHORIZED` | 令牌未配置 / 认证失败 |
| `VALIDATION_ERROR` / `HTTP_ERROR` / `INTERNAL_ERROR` | 请求校验 / 资源或方法不可用 / 脱敏内部错误 |
| `NOT_READY` | 数据库、迁移或 Redis 未就绪 |
| `PROJECT_NOT_FOUND` / `PROJECT_VERSION_CONFLICT` | 项目缺失 / 元数据版本冲突 |
| `JOB_NOT_FOUND` / `JOB_STATE_CONFLICT` | 任务缺失 / 终态不能取消 |
| `JOB_IDEMPOTENCY_CONFLICT` | 同一幂等键对应不同请求 |
| `JOB_DISPATCH_FAILED` | outbox 派发失败，保留事件重试 |
| `JOB_EXECUTION_FAILED` / `JOB_ATTEMPTS_EXHAUSTED` | 执行失败 / 恢复次数耗尽 |
| `JOB_DISPATCH_DATABASE_UNAVAILABLE` | dispatcher 数据库暂不可达，仅诊断输出 |

- [后端开发规范](../../docs/engineering/backend-development.md)：模块、API、事务、任务、迁移、测试、协作及合并门槛。
- [参考仓库与取舍](../../docs/engineering/backend-references.md)：官方工程实践与许可来源。
- [任务模板](../../docs/engineering/templates/backend-task.md)：需求、AC、范围、状态、验证和交接。
- [本轮需求与验收](../../docs/engineering/backend-foundation-plan.md)、[全局协作流程](../../docs/engineering/multi-agent-workflow.md)。
