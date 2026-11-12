# 2026-11-14 后端依赖与真实前后端联调

## 开工与范围

用户输入：“继续把后端依赖和运行环境补齐，跑通前后端真实联调，验证通过后提交推送。”基础版本 `b78bb779789d3a1c814d9c8a351cdb8fdddf1103`，main、原工作区，开工工作区干净。负责人为当前 Codex 主会话；状态 active。关联 BE-001—008、INT-001—008、REQ-006/012，以及 AC-001/008/010 的本轮工程子集；不据此宣布完整产品 AC 通过。

允许修改：API 依赖声明/锁、实际检查暴露的后端缺陷、开发环境与验证入口、真实 HTTP 浏览器测试及必要文档。主会话拥有锁、迁移、错误码、公共入口与文档；限定前端子任务仅新增 HTTP 测试配置和 spec。无新模型调用、账户体系或论文服务端写入。已有迁移为 `20261114_0001`，计划不变更数据结构或新增错误码。

推荐运行方式：复用本机 WSL Ubuntu，隔离 PostgreSQL、Redis 与 Linux worker；Windows 前端经同源开发代理访问真实 API。使用独立端口/测试库，不接触已有私人服务和数据。真实凭据仅保存被忽略的本机配置，不进入 Git、日志、浏览器和备份。

## 需求与验收设计

| 编号 | 入口与输入 | 结果与边界 | 可执行验收 |
|---|---|---|---|
| ENV-001 | uv 解析与锁定安装 | 真实锁与 Windows/Linux 可安装；缺包失败，不用缓存拼装冒充 | `uv lock`、`uv sync --locked`、锁审阅 |
| ENV-002 | 统一后端检查入口 | Ruff/mypy、快测、真实 OpenAPI、Alembic 单 head 通过 | `uv run --locked python scripts/check.py` |
| ENV-003 | 独立 PostgreSQL/Redis/Linux worker | 真实迁移、CAS、幂等、派发锁、取消/迟到、租约与队列链路通过 | 显式 `TP_TEST_*`、`scripts/check.py --integration`，随机 schema 清理仅限本次测试 |
| ENV-004 | Vue HTTP 模式→开发代理→API | 创建/改名/409保留输入，工作区正文与关联刷新不丢失 | 独立 HTTP Playwright 配置，唯一自制项目，真实网络响应 |
| ENV-005 | HTTP 创建诊断→outbox→Redis→Linux worker | 成功结果由数据库/API读回；离页/刷新恢复；明确取消拒绝迟到 | 先停派发验证 queued→cancelled，再启动真实派发/worker 验证 succeeded |
| ENV-006 | 本地复现与收尾 | 启停方式、版本、失败与命令可复现；同步远端后提交推送 | 文档校验、差异审阅、fetch/rebase、远端 SHA 与 Private 核对 |

非法输入、无鉴权、依赖未就绪、旧版本、幂等重放/冲突、查询超时/取消、迟到与重启恢复由已有回归及新增真实 HTTP 验收分层覆盖；真实诊断没有模型或部分结果分支，不伪造模型状态。应用启动仍不自动迁移。测试销毁仅限明确创建的随机 schema/进程，不 drop 既有数据库、不 FLUSHDB。

## 验证记录

开工确认 Python 3.13.7、uv 0.12.17；Windows 无 Docker 命令；本机已有 WSL Ubuntu-24.04，只有 PostgreSQL 客户端/开发文件，没有服务端和 Redis。经官方 PyPI 真实解析生成锁，Windows 安装 80 个外部包；Linux 安装 78 个外部包，平台条件依赖不同，同一锁共 81 包（含本地项目）。检查下载 URL 均为 PyPI 文件源 HTTPS、带 SHA-256，无凭据 URL。

本机运行状态：Windows API `127.0.0.1:8000`、Vue 开发服务 `127.0.0.1:18745`；WSL 内 PostgreSQL `15432`、Redis `16379`、Linux worker/dispatcher。服务数据、二进制和 Linux 虚拟环境在 `/opt/thesis-pilot-runtime`，没有注册或替换系统服务。PostgreSQL/Redis 与缺失动态库从 Ubuntu 官方包下载解包，未改动其他已有服务。实际版本：PostgreSQL 16.15、Redis server 7.0.15、Celery 5.7.0、FastAPI 0.162.7、SQLAlchemy 2.0.57、Alembic 1.20.1、Pydantic 2.14.3、psycopg 3.3.9、LangGraph 1.2.22；完整包散列以锁为准。

本机 API `.env` 和 Web `.env.development.local` 已生成匹配的随机服务令牌；前者连接上述独立实例，后者仅启用本地开发 HTTP 代理。两文件均被 Git 忽略。默认生产构建仍为 preview，实际检查构建产物 6 个文件均不含本机真实令牌。Redis 只绑定回环地址，测试 DB 15、开发 DB 0，不清空共享库。

### 真实命令与结果

| 检查 | 实际结果/退出码 | 范围与原始输出位置 |
|---|---|---|
| Windows `uv lock`、`uv sync --locked` | 均 0；真实解析 81 包 | 官方 PyPI；34.64 秒解析，真实安装，不再拼装离线缓存 |
| Linux `uv sync --locked --python 3.13.7` | 0 | 独立 Linux venv，不复用 Windows `.venv` |
| Windows `uv run --locked python scripts/check.py` | 0；Ruff、48 文件格式、31 源文件 mypy、62 passed（6.80s）、OpenAPI/迁移 head 通过 | 新增帮助脚本前的已锁定应用基线 |
| Linux `uv run --locked python scripts/check.py --integration` | 0；Ruff、49 文件格式、31 源文件 mypy、62 passed（5.49s）、7 个真实服务测试 passed（5.23s）、OpenAPI/head 通过 | PostgreSQL 真实迁移/元数据、并发 CAS/幂等、派发锁、取消/租约与独立 Redis/Linux solo worker；不含浏览器 UI |
| 开发库 `alembic upgrade head`、`alembic check` | 均 0；无新 upgrade 操作差异 | 实际迁移为 `20261114_0001`，应用未自动迁移 |
| `/health/live`、`/health/ready` | HTTP 200；alive/ready | Windows API 经本机转发连接 Linux PostgreSQL/Redis |
| 未带令牌直访真实 `/api/v1/projects` | HTTP 401、UNAUTHORIZED | 无匿名业务访问；不代表账户/项目权限已实现 |
| HTTP 浏览器 queued 阶段 | 0；1 passed（8.3s）、另一阶段 1 skipped | 创建项目→排队→取消→刷新；真实任务 ID `80d05ef3-2356-4fd4-85ba-29f7e01b286a`，仅为自制测试标识 |
| HTTP 浏览器 running 阶段 | 0；1 passed（12.5s）、另一阶段 1 skipped | 实际 409/保留输入/读取新版/明确保存，正文与本机/远端 ID 刷新保留，真实队列结果/详情/离页恢复；复核旧任务仍 cancelled、attempt=0 |
| 启停帮助脚本实际冒烟 | 0 | 独立 `15433/16380`，初始化、status、重复 start、stop、status；创建自制 marker 表后停止/重启仍可查询；目录保留，最终两个 smoke 实例均停止 |
| Redis 依赖中断与恢复 | 0；503 NOT_READY→200 ready | 仅停止自建 `16379` 实例，finally 恢复，未 FLUSHDB；结果 `work/real-integration/readiness.json` |
| Redis 恢复后再次 running 浏览器验收 | 0；1 passed（13.3s）、另一阶段 1 skipped | 真实 worker 自动重连并执行新任务；仍核对旧取消任务不被覆盖 |
| 前端 `vp run check`、`vp test run`、`vp build` | 均 0；204 文件格式、188 文件检查及 Vue 类型、21 文件/189 单测、1828 modules | 新 HTTP 配置纳入 TypeScript 检查；末次默认构建约 4.03 MB，不含本机服务令牌 |
| 默认 HTTP 预览浏览器回归 | 0；101 passed、3 skipped（2.9m） | 3 项仅适用独立 Mock 构建，本轮未把跳过计通过；真实 HTTP 两阶段另行通过 |
| 文档校验、差异检查 | 均 0；79 documents、317 links（收尾补充前） | 仅文档/格式，不替代产品验收 |

每次 HTTP 双阶段只执行适用的一条测试，另条显式跳过；两阶段都实际运行过，不能把同一阶段重跑折算为新增覆盖。Windows API、Linux PostgreSQL/Redis 与 Linux非 root prefork worker 的实际网络/进程链路已验证；独立集成测试的 solo worker 与手动运行的 prefork 分别保留结论。

### 实际失败与修复

1. Linux 首次统一检查因 uv 未在 PATH 而失败；按官方安装目录显式加入当前进程 PATH，未改检查门槛。
2. Linux worker 首次降权后导入失败：uv 默认 Python 位于 `/root`，postgres 用户不能读取标准库。将真实 Python 3.13.7 复制到可遍历的专用 `/opt/thesis-pilot-runtime/python`，由同一锁安装独立 worker venv，再以 postgres 用户执行 prefork；未放宽 `/root` 权限。
3. 开发帮助脚本首次 initdb 不能重开 root 管道的 `/dev/stdin`；改为 0600 专用临时口令文件，root 时只交给 postgres 读取，finally 删除该临时文件，不回显口令。
4. Debian Redis 入口是符号链接，提前 resolve 后以 redis-check-rdb 名称执行导致启动失败；保留调用路径，仅在 PID 归属核验时解析实际程序。保留第一次失败目录并安全停止其 PostgreSQL，使用新 smoke 目录完成全流程。
5. standalone Python 缺少 pidfd 包装，初次 stop 抛 AttributeError；在任何服务操作前校验能力，缺少时明确拒绝并提示用发行版 `/usr/bin/python3`。系统 Python 的 start/status/重复 start/stop/持久化重启已真实通过，没有不安全 kill(pid) 降级。
6. 环境模板 CORS JSON 需兼容 shell source；增加外层单引号，并实际 source 后通过 Settings 校验，未放宽配置校验。

限定只读审查覆盖帮助脚本的进程归属、私密日志与恢复路径，以及本地运行说明；未发现待处理阻断。审查不替代上述真实执行，也不是全仓安全审计。

### 提交与交接

| 提交 | 内容 |
|---|---|
| `4b93ffc` | 官方 PyPI 完整依赖锁与跨平台安装 |
| `2dc8404` | 独立本地 PostgreSQL/Redis 帮助脚本与运行说明 |
| `f69b723` | 双阶段真实 HTTP 浏览器回归、命令和类型检查入口 |

当前记录及 README/规范更新另行提交，以 `git log -- docs/evidence/sessions/2026-11-14-real-integration.md` 查询，避免自引用。代码推送前还需 fetch/rebase、核对远端迁移与错误码、审阅差异；实际推送结果以当前会话和本地 `work/real-integration/publish-result.json` 为准，不预写成功。本轮未新增迁移、错误码或应用业务接口。

当前服务数据均为自制验收项目，不含真实论文。遗留边界：账户和资源授权、论文正文服务端保护/采纳/恢复、真实模型、复杂文档及完整产品 AC 仍未实现或验收。本次只完成已实现项目/诊断切片的环境和真实链路，不冒充完整产品后端完成。

本机普通重启可按[本地运行说明](../../engineering/local-runtime.md)使用独立新目录重建实例；当前 `/opt/thesis-pilot-runtime/state` 是本轮早期显式创建的运行目录，不含帮助脚本 owner 登记，脚本会拒绝接管它，不能通过改 marker 冒充拥有。保留该目录的数据/配置，复用时按已知二进制与数据路径显式重启 PostgreSQL/Redis；帮助脚本验证目录 `/opt/thesis-pilot-helper-smoke-v2` 已停止。API/前端仍使用被忽略的本机配置，可直接以 API README 和本地运行说明的命令再次启动。

此记录为真实会话摘要；原始完整对话尚未导出，不计为完整 Prompt 链。没有人工验收或模型质量结论可填写。
