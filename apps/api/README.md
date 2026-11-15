# ThesisPilot 后端底座

FastAPI 模块化单体，提供本机会话、个人偏好、项目元数据、正式稿、受控修订、正文结构检查及诊断任务接口。正式稿支持创建空稿、主动导入、按基础版本保存及不可变历史。现有候选修订接口提供程序保护、采纳、撤销和恢复；真实模型、四库和复杂文件转换由后续施工单接入。

**当前后端实测（2026-11-17）**：Linux依赖锁、Ruff、77文件格式、mypy的46源文件、216项快测、真实OpenAPI及单head `20261117_0004`全部通过；30项PostgreSQL/Redis/Linux worker/HTTP集成通过，无跳过。覆盖采纳、撤销、恢复、并发与重启回执，以及256KiB响应和16MiB正文结果超限回滚。保护样例人工复核仍未完成，详见[保护与采纳记录](../../docs/evidence/sessions/document-revisions.md)。

SG-03/05此前门槛为141快测、22真实集成与head `20261117_0003`。运行方法见[本地环境与联调](../../docs/engineering/local-runtime.md)，历史结果见[正文持久化](../../docs/evidence/sessions/document-persistence.md)和[长任务记录](../../docs/evidence/sessions/job-reliability.md)。

**底座首轮记录（2026-11-14）：代码及 OpenAPI 已建立，离线真实依赖下 25 项同步测试通过。完整环境尚未验收。** 当轮连接 PyPI 被执行环境拒绝，未生成 `uv.lock`；缺少 Alembic、psycopg、Celery、Redis、Ruff。HTTP 测试在 Windows asyncio 创建本地 socket 时阻塞，尚未进入请求。PostgreSQL/Redis/Linux worker 集成未运行；详见[该轮实际证据](../../docs/evidence/sessions/2026-11-14-backend-foundation.md)。

**接入迭代（2026-11-14）：** 新增按项目分页的 Job 查询与 UTC 输出规范，并由实际 OpenAPI 支撑前端生成契约。本轮同步后端测试结果为 **29 passed、33 deselected**；未执行项及真实 HTTP/数据库/队列链路不能计为通过，完整依赖环境仍待补齐。详见[本轮证据](../../docs/evidence/sessions/2026-11-14-frontend-integration.md)、[数据规范](../../docs/engineering/data-contracts.md)和[前端接入](../../docs/engineering/frontend-integration.md)。

## 已有入口

| 入口 | 行为 |
|---|---|
| `GET /health/live` | 进程存活，不连接数据库或队列 |
| `GET /health/ready` | 检查数据库连通、精确迁移版本及 Redis；未就绪 503 |
| `POST /api/v1/projects` | 新建项目元数据：`{"name":"自制样例"}` |
| `GET /api/v1/projects?limit=20&offset=0` | 有上限、稳定排序的分页查询 |
| `GET /api/v1/projects/{id}` | 读取项目 |
| `PATCH /api/v1/projects/{id}` | `{"name":"新名称","expected_version":1}`；旧版本 409 |
| `POST /api/v1/projects/{project_id}/documents` | 显式导入 `{content}`，建立正式稿 v1；已有正式稿返回 409 |
| `POST /api/v1/projects/{project_id}/documents/blank` | 创建空白正式稿 v1，历史来源记录为 `blank`；已有正式稿返回 409 |
| `GET /api/v1/projects/{project_id}/documents/current` | 读取当前正式稿；未导入返回 `DOCUMENT_NOT_FOUND` |
| `PATCH /api/v1/projects/{project_id}/documents/{document_id}` | 以 `{expected_version,content}` 保存新版本；过期版本冲突返回 409 |
| `GET /api/v1/projects/{project_id}/documents/{document_id}/versions` | 分页读取不可变历史摘要，正文按版本单独读取 |
| `GET /api/v1/projects/{project_id}/documents/{document_id}/versions/{version}` | 只读指定正式正文版本 |
| `POST /api/v1/jobs` | 创建指定类型任务，带 `Idempotency-Key`；返回 202 |
| `GET /api/v1/jobs?project_id={UUID}&limit=20&offset=0` | 按项目分页、稳定排序；可重复传入 `status=queued&status=running`，分页和总数应用同一过滤 |
| `GET /api/v1/jobs/{id}` | 读取任务、尝试和产物，正式模式须传 `project_id` |
| `POST /api/v1/jobs/{id}/cancel` | 取消排队或运行中任务，正式模式须传 `project_id` |
| `POST /api/v1/jobs/{id}/retry` | 以原固定输入和新幂等键创建任务，正式模式须传 `project_id` |

联调模式使用 `Authorization: Bearer <TP_API_TOKEN>`。正式本机模式使用服务端可撤销的 HttpOnly 会话 Cookie，并校验请求来源。`/api/v1/workspace/session` 支持建立、查询和关闭会话，`PATCH /api/v1/workspace/profile` 以资料版本保存个人偏好。正式模式为单实例单人工作区。配置与运行见[正式工作区](../../docs/engineering/local-runtime.md#正式工作区)。

成功直接返回类型化资源，错误为 `{"error":{"code":"...","message":"...","request_id":"..."}}`。[openapi.json](openapi.json) 以正式模式生成。开发环境 `/docs` 对应当前服务配置，生产配置关闭文档入口。

正文 `content` 只包含 `schema_version: 1` 和受限 Tiptap JSON，请求项目与正文归属必须匹配。导入与保存使用事务，版本条件更新与历史追加同时提交。正式正文版本与项目元数据版本独立，历史摘要无需下载正文。每份规范正文限 16 MiB UTF-8，传输另留 64 KiB 包装空间，编辑器节点深度最多 80。PostgreSQL 使用 `JSON` 保存允许包含 U+0000 转义的内容。见[正文结构合同](../../docs/engineering/editor-snapshot-contract.md)和[数据契约](../../docs/engineering/data-contracts.md)。

修订入口以 `/api/v1/projects/{project_id}/documents/{document_id}` 为共同前缀：

| 路径与方法 | 行为 |
| --- | --- |
| `POST /revisions` | 固定基础版本、UTF-16选区和目标，登记候选 |
| `PUT /revisions/{candidate_id}/proposal` | 用该次生成token接收一次提案并运行保护检查 |
| `GET /revisions`、`GET /revisions/{candidate_id}` | 分页摘要及单候选详情，陈旧性按当前正文版本派生 |
| `PUT /revisions/{candidate_id}/decisions` | 保存完整逐条决定，expected_revision冲突不覆盖旧决定 |
| `POST /revisions/{candidate_id}/apply` | 重新检查版本与保护，原子追加正文版本及采纳回执 |
| `POST /revisions/{candidate_id}/cancel` | 取消未结束候选，迟到提案不能复活 |
| `POST /revision-commands/{application_command_id}/undo` | 仅当前版本仍为采纳结果时撤销，追加新版本 |
| `POST /revert` | 将同一正文的指定历史恢复为更大的版本 |
| `GET /revision-commands/{command_id}` | 查询固定成功回执，404不保证原请求永远不会完成 |

所有修订写命令包含固定 `command_id`，同键同参返回原回执，同键异参409。候选传输为256KiB、最多100补丁、选区最多32768个UTF-16单元；最终Read和正文预算都在提交前检查，失败整次回滚。只支持同块同格式文本，公式块、对象、跨块和无法解析的保护内容明确拒绝。模型尚未接入，`deterministic_preview`不代表真实推理；42组预期仍待人工复核。

任务走 `queued → running → succeeded / failed`，排队或执行中可转 `cancelled`。同幂等键同参返回同任务，异参 409。Job 和 outbox 同时提交，消息重投由 token 与租约隔离。失租可恢复，最多认领 3 次，耗尽记录 `JOB_ATTEMPTS_EXHAUSTED`。业务期限和非法结果分别记录 `JOB_EXECUTION_TIMEOUT` 与 `JOB_RESULT_INVALID`。

正式工作区提供 `document_inspection`。服务固定正文 UUID、已保存版本及统计配置，校验所属项目，成功状态与结构统计产物一起提交到 PostgreSQL。尝试记录自动重领的过程，显式重跑创建关联的新任务。诊断仅在联调模式提供。[任务数据契约](../../docs/engineering/data-contracts.md#6-后台任务-dto)

## 锁定安装

实测 Python **3.13.7**、uv **0.12.17**。Python 工程声明 `>=3.13,<3.14`；本地已验证 PostgreSQL 16.15、Redis 7.0.15，CI 使用 PostgreSQL 17、Redis 7。服务脚本只管理显式目录内的独立实例，不自动操作其他数据库。

从本目录使用已审阅的完整锁安装并检查：

```powershell
uv sync --locked
uv run --locked python scripts/check.py
```

修改依赖才执行 `uv lock`、审阅并提交新锁。上方首轮/接入记录中的缓存测试和环境阻断属于历史事实，不替代当前锁定环境结果。CI 仍在缺锁时失败，不跳过锁检查。[本地服务帮助脚本](scripts/dev_services.py)支持 Linux 实例 start/status/stop，前置与完整步骤见本地运行说明。

## 配置、迁移与启动

1. 将 `.env.example` 复制为本目录 `.env`，配置自己的 PostgreSQL、Redis 连接及至少 32 字符的随机 API 令牌。实际文件被 Git 忽略。可用 `uv run python -c "import secrets; print(secrets.token_urlsafe(32))"` 生成本地令牌，不把输出粘贴进日志或 Git。
2. 确认连接指向本人明确选择的开发库。升级前停止旧版 API、worker 和 dispatcher，再执行迁移。当前 head 为 `20261117_0006`，增加固定业务输入、留存的执行尝试和结果产物。旧诊断任务与幂等键继续有效。记录新业务任务或执行尝试后，使用前向迁移。
3. 三个独立终端分别运行 API、Linux worker、dispatcher。当前 dispatcher 足够单进程；没有引入额外调度服务。

```powershell
uv run alembic upgrade head
uv run alembic check
uv run uvicorn thesis_pilot.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log
```

```text
uv run celery -A thesis_pilot.workers.celery_app:app worker --pool=prefork --concurrency=2 --loglevel=WARNING
uv run python -m thesis_pilot.workers.dispatcher
```

API 默认仅绑定本机；`--no-access-log` 防止 Uvicorn 默认日志记录完整 URL/query。应用日志只记路由模板、请求 ID、状态和耗时；异常边界不向 ASGI 服务器传出原始异常值。队列消息只携带任务 ID。

worker 的验证平台为 Linux。执行中使用独立短事务续租，每次领取受固定期限约束。API、worker、dispatcher 使用一致的 `TP_WORKER_LEASE_SECONDS`（默认 60，范围 10–3600 秒）和 `TP_WORKER_EXECUTION_TIMEOUT_SECONDS`（默认 900，范围 1–3600 秒）。真实解析、模型和导出接入时须验证各自的结果与重试边界。多步骤编排的持久检查点待 SG-21B 随真实助手运行联验。

## 验证与恢复

```powershell
uv run python scripts/check.py
$env:TP_TEST_DATABASE_URL = 'postgresql+psycopg://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/thesis_pilot_test'
$env:TP_TEST_REDIS_URL = 'redis://127.0.0.1:6379/15'
uv run python scripts/check.py --integration
```

默认入口检查依赖锁、Ruff、mypy、快测、OpenAPI 漂移和唯一迁移 head。显式集成入口要求真实服务，覆盖升级和数据保留、正文并发与 HTTP 持久化、Job 状态冲突与重复投递，以及 Redis/Celery 执行进程。

集成测试只接受数据库名以 `_test` 结尾，每次使用随机 schema，清理限本次 schema。Redis 测试固定 DB 15，并使用随机键前缀和队列。基础任务链路保留 `solo` 池回归，长任务验证使用实际 Linux `prefork` worker。测试连接应指向一次性资源。

恢复以数据库记录为准。重启 dispatcher 可继续投递未发布事件，超时未认领任务可重派，过期执行按预算重新领取。取消、失租旧 token 或过期执行返回的结果不得提交。正式稿重启后可读取当前和历史版本，正式历史恢复写入及数据库整体备份恢复仍待接入。

CI 定义位于 `.github/workflows/backend.yml`，使用临时 PostgreSQL/Redis 执行同一入口，远端状态以实际执行证据为准。19 项完整产品 AC 仍须按对应业务范围逐项验收。

## 开发入口

当前错误码登记由整合者维护；新增码先检查语义重复，并补异常测试：

| 错误码 | 语义 |
|---|---|
| `AUTH_NOT_CONFIGURED` / `UNAUTHORIZED` | 令牌未配置 / 认证失败 |
| `VALIDATION_ERROR` / `HTTP_ERROR` / `INTERNAL_ERROR` | 请求校验 / 资源或方法不可用 / 脱敏内部错误 |
| `NOT_READY` | 数据库、迁移或 Redis 未就绪 |
| `PROJECT_NOT_FOUND` / `PROJECT_VERSION_CONFLICT` | 项目缺失 / 元数据版本冲突 |
| `DOCUMENT_NOT_FOUND` / `DOCUMENT_VERSION_NOT_FOUND` | 对应项目中无指定正文或历史版本 |
| `DOCUMENT_ALREADY_EXISTS` / `DOCUMENT_VERSION_CONFLICT` | 正式稿已存在 / 正文基础版本已变化 |
| `DOCUMENT_STRUCTURE_INVALID` / `DOCUMENT_TOO_LARGE` | 不受支持的正文结构 / 超过正文传输或内容预算 |
| `JOB_NOT_FOUND` / `JOB_STATE_CONFLICT` | 当前项目无此任务 / 状态与取消或重跑命令冲突 |
| `JOB_KIND_UNAVAILABLE` / `JOB_INPUT_INVALID` | 正式工作区不提供此类型 / 固定输入未通过执行校验 |
| `JOB_IDEMPOTENCY_CONFLICT` | 同一幂等键对应不同请求 |
| `JOB_DISPATCH_FAILED` | outbox 派发失败，保留事件重试 |
| `JOB_EXECUTION_FAILED` / `JOB_ATTEMPTS_EXHAUSTED` | 执行失败 / 恢复次数耗尽 |
| `JOB_EXECUTION_TIMEOUT` / `JOB_RESULT_INVALID` | 执行业务期限到达 / 结果未通过结构和身份校验 |
| `JOB_DISPATCH_DATABASE_UNAVAILABLE` | dispatcher 数据库暂不可达，仅诊断输出 |

- [后端开发规范](../../docs/engineering/backend-development.md)：模块、API、事务、任务、迁移、测试、协作及合并门槛。
- [数据契约规范](../../docs/engineering/data-contracts.md)、[前端接入说明](../../docs/engineering/frontend-integration.md)：DTO/领域/View 分层、字段与状态、Mock/HTTP 和项目关联。
- [参考仓库与取舍](../../docs/engineering/backend-references.md)：官方工程实践与许可来源。
- [任务模板](../../docs/engineering/templates/backend-task.md)：需求、AC、范围、状态、验证和交接。
- [本轮需求与验收](../../docs/engineering/backend-foundation-plan.md)、[全局协作流程](../../docs/engineering/multi-agent-workflow.md)。
