# 2026-11-14 后端底座与开发规范

日期按 Asia/Shanghai。基础提交：`83b8cf4640f9744572588f10a331647f73a702f9`，当前 main。开始时已有大量前端、设计稿、README、AGENTS、架构/路线等未提交改动；本轮不覆盖、不清理、不笼统暂存。当前代码未提交、未推送、未部署。

## 输入、范围与产物

本轮真实用户指令摘录：“先按照方案把后端的底层搭起来吧。形成一整套完善的额开发规范。参考一些前沿的代码仓库等。引入他们的开发模式。”

先读 README、比赛要求、产品 AC、架构、开发规范和工作区状态，再写[底座需求与 BE-001—008](../../engineering/backend-foundation-plan.md)。Explore 代理并行只读定位；项目、任务、规范分别限定文件所有权；主代理整合运行时、迁移、依赖声明、测试、CI 及共享文档；独立代理审查代码。任务协调记录在需求文件中，不强制向 main 额外提交任务登记。

产物：`apps/api` 模块化单体及项目/诊断任务切片，OpenAPI 真实导出，项目/任务/outbox 基线迁移，HTTP/同步/真实服务测试，CI、配置模板与运行说明；[开发规范](../../engineering/backend-development.md)、[参考记录](../../engineering/backend-references.md)、[任务模板](../../engineering/templates/backend-task.md)。技术取舍为同步 Session、service 事务、CAS、outbox、幂等 token、短任务有限恢复；不引入参考仓库整套业务。

仅保留此脱敏开发摘要与实际输出定位，没有完整原始编程对话导出；此记录不能计作一条完整 Prompt 链。没有人工点击验收、真实模型结果、试用或提交映射可填写，不补造。

## 实际验证

| 检查 | 结果 | 范围/关键输出 |
|---|---|---|
| 环境检查 | 成功 | Python 3.13.7、uv 0.12.17；无 PostgreSQL/Redis 命令及监听；运行时依赖未完整安装 |
| `uv sync`，缓存先尝试 `E:\workspace\uv-cache-thesis` | 失败，退出 1 | 创建缓存目录被拒绝；改用本仓库忽略的 `work/uv-cache` |
| `uv sync`，仓库内缓存 | 失败，退出 1 | PyPI 请求失败，`tunnel error`、`tcp connect error`、Windows `os error 10013`；未修改网络权限或代理，未生成 uv.lock |
| 实际缓存依赖核查 | 部分可用 | 仅复制/读取已有缓存到忽略的 work 临时验证；缺 psycopg/Alembic/Celery/Redis/Ruff/hatchling，不能完成完整离线锁定安装 |
| OpenAPI 导出与 `--check` | 成功，退出 0 | 真实 FastAPI 生成 `apps/api/openapi.json`，OpenAPI 3.1.0、7 个路径、9 个操作；检查输出 `OpenAPI contract verified` |
| 51 项快测中的同步可执行部分 | **25 passed，26 deselected**，退出 0 | SQLite 真实事务、项目持久化/分页/CAS/回滚、Job/outbox 原子性、派发失败重试、发布后 DB 失败重投、重复消费、取消迟到、租约/预算恢复、配置脱敏、真实 LangGraph 确定性运行 |
| HTTP TestClient | 阻断、中断运行 | Windows asyncio `_make_self_pipe → socket._fallback_socketpair → socket.accept` 卡住；20 秒 faulthandler 定位，尚未进入请求；不替换 socket 绕过限制，26 项未执行不计通过 |
| mypy 2.1.0 | 失败，退出 1 | 检查 31 个源码文件，仅 `api/health.py` 的 Redis `import-not-found`；不添加 ignore 掩盖缺包；不称类型检查已通过 |
| Black 26.5.1 顺序格式化 | 成功，退出 0 | 46 个 Python 文件，23 个实际格式化；仅格式整理，不代替仍缺失的 Ruff 检查 |
| Python AST、仓库文档与差异检查 | 成功，退出 0 | 46 个 Python 文件可解析；70 份文档、276 个本地链接、12 REQ、19 AC、2 份来源快照校验通过；`git diff --check` 无错误 |
| Ruff、Alembic 离线 SQL/单 head 运行、迁移升级 | 未执行 | 对应工具包缺失；已编写命令及单 head 强制检查，不能用静态文件替代实际运行 |
| `python -X utf8 scripts/check.py`（apps/api） | 阻断，退出 1 | 实际输出 `Missing uv.lock: run uv lock and uv sync on an authorized network first.`，确认统一门槛不会跳过缺失锁 |
| 7 项 PostgreSQL/Redis/Linux worker 集成 | 未执行 | 无真实服务/依赖；已编写隔离测试与 CI；缺配置明确失败，不 skip |
| 远端 CI、前端联调、真实模型、19 项产品 AC | 未执行 | 新建 workflow 不代表已运行；没有修改前端实现或产品 AC 完成状态 |

离线验证实际版本：FastAPI 0.162.5、Pydantic 2.14.0 / core 2.50.0、pydantic-settings 2.16.2、SQLAlchemy 2.0.50、LangGraph 1.2.18、httpx 0.28.1、pytest 9.1.1、mypy 2.1.0。使用真实缓存兼容当前 Python 的包，不使用伪造 Redis/Celery/数据库。此清单不是依赖锁或正式兼容性保证。

临时依赖来源与运行入口保存于 Git 忽略的 `work/offline-backend-check/`，包括 `packages.json`、`paths.json`、`bootstrap.py`、`run.py`、类型检查与限制摘要。可执行命令如下（仅当前环境缓存验证；正式复现走 API README 的 uv 锁）：

最终同步测试原始输出为 `work/offline-backend-check/final-pytest.log`：51 项收集，25 项选择执行并通过，26 项未执行。后端文件仍未提交；不把共享工作区其他会话的改动纳入本轮产物。

```text
python -X utf8 -B work/offline-backend-check/run.py -k "test_job_services or test_project_services or invalid_configuration or configuration_failure or flush_failure or update_commit_failure or diagnostic or distinct_projects" -o faulthandler_timeout=20 -vv
python -X utf8 -B work/offline-backend-check/bootstrap.py scripts/export_openapi.py --check
python -X utf8 -B work/offline-backend-check/bootstrap.py --mypy
```

## 真实审查与纠错

1. 部分测试导入 Celery 薄包装阻断离线收集。将执行服务独立为 `workers/execution.py`，保留实际队列适配；将核心状态测试改为直接业务 service/SQLite 会话，HTTP 测试保留，未降低断言或伪造依赖。
2. 独立审查发现 Starlette 异常处理返回后仍向 Uvicorn 抛出，默认服务器日志可能泄露异常。中间件增加脱敏异常边界，启动明确 `--no-access-log`；补 HTTP 不外抛测试，因当前 socket 限制尚未运行该 HTTP 回归。
3. 非 ASCII Bearer 在字符串 compare_digest 中可抛 TypeError，改为字节比较；配置异常增加 hide_input_in_errors，实际同步测试确认异常字符串不含秘密。
4. 任务原先可能无限恢复，补最多 3 次执行预算与 `JOB_ATTEMPTS_EXHAUSTED`；取消和过期 token 仍不能提交，相关同步回归通过。
5. `alembic heads` 多头也可能退出 0，增加 `check_migrations.py` 显式比对唯一 head 与 readiness 版本，待完整依赖环境执行。

## 工程验收结论

BE-001/002 代码与契约已具备，HTTP 验证阻断；BE-003/005 同步核心验证通过，真实 PostgreSQL/Redis 仍待验收；BE-004 迁移已写但未执行；BE-006 确定性图已实际验证，不代表模型或持久 checkpoint；BE-007 受完整依赖锁、Ruff、服务环境阻断；BE-008 规范、模板与参考记录已写。**本轮交付为代码底座与部分实测，不标记整套可运行验收完成。**

下一步在可联网开发环境执行 `uv lock`、锁定安装、Ruff 格式/检查、完整快测与类型检查，复核 OpenAPI，再使用一次性 PostgreSQL/Redis 在 Linux 执行全部集成。通过后才提交真实锁文件与验证记录并推进账户/论文受控写入及前端联调。原始对话完整导出与产品验收仍独立补齐。
