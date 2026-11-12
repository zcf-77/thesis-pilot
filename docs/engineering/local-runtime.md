# 本地真实运行与联调

范围：项目元数据与诊断任务。论文正文、规划、资料和反馈仍由当前浏览器保存；诊断图不调用模型。开发服务令牌不是用户账户或项目归属权限。

## 环境与锁

本轮实测 Windows 与 WSL Ubuntu 24.04 的 Python 3.13.7、uv 0.12.17，使用同一份 `apps/api/uv.lock`。本地服务为 PostgreSQL 16.15、Redis 7.0.15；CI 另使用 PostgreSQL 17。不要将 WSL/Linux 和 Windows 的虚拟环境放在同一个 `.venv`。

从 `apps/api` 执行 `uv sync --locked`。仅修改依赖时执行 `uv lock` 并审阅差异。uv 的安装与 Python 管理见[官方安装文档](https://docs.astral.sh/uv/getting-started/installation/)和[Python 管理](https://docs.astral.sh/uv/guides/install-python/)；不要全局 pip 拼装项目环境。

## PostgreSQL 与 Redis

`scripts/dev_services.py` 只管理独立 Linux 本地实例，需预先提供 PostgreSQL 服务端/客户端及 Redis 程序，不安装系统服务。Windows 通过 WSL 执行。使用带有 `os.pidfd_open` 和 `signal.pidfd_send_signal` 的发行版 Python，例如本轮 Ubuntu 的 `/usr/bin/python3`；部分 standalone Python 不含该接口，脚本会在操作前拒绝。

以下为已安装标准发行版程序时的调用方式；按本机已安装版本选择 PostgreSQL 的 bin 目录。运行目录须为尚不存在的专用目录，不能传已有资料目录：

```bash
cd apps/api
export TP_RUNTIME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/thesis-pilot/services"
mkdir -p "$(dirname "$TP_RUNTIME_DIR")"
/usr/bin/python3 scripts/dev_services.py start \
  --runtime-dir "$TP_RUNTIME_DIR" \
  --postgres-bin /usr/lib/postgresql/16/bin \
  --redis-bin /usr/bin
/usr/bin/python3 scripts/dev_services.py status --runtime-dir "$TP_RUNTIME_DIR"
```

默认只监听 `127.0.0.1:15432`、`127.0.0.1:16379`；可首次指定 `--postgres-port`、`--redis-port`，后续按私密状态恢复。自备解包程序可通过 `--library-dir` 指定动态库目录。非 root 用户管理本人实例；root 初始化 PostgreSQL 时使用已有 postgres 账户，不自动创建系统用户。

脚本生成 `thesis_pilot_dev`、`thesis_pilot_test` 两个独立库及随机口令，配置存于运行目录的 `api.env`、`test.env`、`runtime.json`，目录 0700、配置 0600。不回显真实凭据，不修改仓库 `.env`。已有目录缺本脚本登记、端口被占或进程归属无法核实时拒绝接管。

```bash
/usr/bin/python3 scripts/dev_services.py stop --runtime-dir "$TP_RUNTIME_DIR"
```

stop 校验本目录登记的 PID、实际程序、数据目录与用户，再用 pidfd 停止；保留数据和配置，不删除数据库或目录。每次测试使用随机 schema，清理只作用于本次 schema；Redis 测试固定 DB 15、随机键前缀，不 FLUSHDB。

## API、worker 与 dispatcher

三个终端使用同一套 `api.env` 和虚拟环境。普通用户可使用以下方式；本轮跨平台运行的实际路径仅记录在[执行证据](../evidence/sessions/2026-11-14-real-integration.md)，不作为其他电脑的固定目录：

```bash
cd apps/api
set -a; . "$TP_RUNTIME_DIR/api.env"; set +a
export UV_PROJECT_ENVIRONMENT="${XDG_DATA_HOME:-$HOME/.local/share}/thesis-pilot/api-venv"
uv sync --locked
uv run --locked alembic upgrade head
uv run --locked alembic check
uv run --locked uvicorn thesis_pilot.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log
```

每个新终端都要重新设置相同的 `TP_RUNTIME_DIR`、`UV_PROJECT_ENVIRONMENT`，再执行 `set -a; . "$TP_RUNTIME_DIR/api.env"; set +a`；仅加载 `api.env` 不会设置前两个路径变量。然后分别执行：

```bash
uv run --locked celery -A thesis_pilot.workers.celery_app:app worker --pool=prefork --concurrency=2 --loglevel=WARNING
uv run --locked python -m thesis_pilot.workers.dispatcher --poll-seconds 1
```

root 环境若让 worker 降权，解释器与虚拟环境须位于该用户可以遍历的目录，不能引用 `/root` 中的 Python。API 启动不自动建表或迁移；迁移是显式命令。`/health/live` 仅证明进程存活，`/health/ready` 校验 PostgreSQL、精确迁移版本与 Redis，不代表 worker 已运行。

## 前端与真实浏览器验收

在 `apps/web/.env.development.local` 配置 `VITE_SERVICE_MODE=http`、`VITE_API_BASE_URL=/api/v1`、稳定的 `VITE_API_INSTANCE`、`TP_API_TARGET=http://127.0.0.1:8000` 与匹配 API 的 `TP_API_TOKEN`。该文件被忽略；`TP_API_TOKEN` 只由开发代理读取，不能改成 `VITE_API_TOKEN`。运行 `vp dev --host 127.0.0.1 --port 18745 --strictPort`。

默认 `vp build` 仍生成 preview。生产静态构建没有开发代理，不能把它当作 HTTP 联调入口。

真实浏览器配置为 `playwright.http.config.ts`，自行启动 18745 开发服务，执行前须停止其他占用该端口的前端实例。以 PowerShell 为例，先从本机私密配置给当前进程设置 `TP_API_TOKEN`，然后：

```powershell
$env:VITE_SERVICE_MODE = 'http'
$env:VITE_API_INSTANCE = 'local-dev'
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:TP_HTTP_TEST_PHASE = 'queued'
vp run test:http
```

queued 阶段停止 dispatcher，实际创建并取消排队任务；保存输出的非秘密 `HTTP_CANCELLED_JOB_ID`。随后启动 Linux worker 与 dispatcher：

```powershell
$env:TP_HTTP_TEST_PHASE = 'running'
$env:TP_HTTP_CANCELLED_JOB_ID = '<上阶段的实际任务 UUID>'
vp run test:http
```

running 阶段验证项目创建/改名、真实 409 后保留输入并显式恢复、本机正文与关联刷新保留、HTTP→数据库→outbox→Redis→worker→HTTP 成功结果，以及取消记录未被派发覆盖。两个阶段各执行一条测试，另一阶段不计为已执行；不能只跑一个阶段就称整条链路通过。

后端完整门槛在 Linux、明确的测试连接下执行：

```bash
set -a; . "$TP_RUNTIME_DIR/test.env"; set +a
uv run --locked python scripts/check.py --integration
```

其中快测、静态/契约与 7 项真实服务集成分别报告；浏览器 HTTP 验收另行执行，服务测试不代替 UI 链路。实际结果、失败纠正与剩余范围见[本轮证据](../evidence/sessions/2026-11-14-real-integration.md)。
