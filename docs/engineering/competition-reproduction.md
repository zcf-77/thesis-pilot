# 比赛版复现与桌面录屏

本文对应私有 main 的 `b748424bf53da3a9022189d949d97d09ab325539`，数据库单 head 为 `20261118_0011`。后续提交以实际 `git rev-parse HEAD`、`alembic heads` 和施工台账为准。本文命令为按现有脚本整理的复现步骤，文档整理者没有另行执行安装、迁移、构建或七段录制。协调者已在同一 `b748424` 上实际重录七场景 WebM，七场景清单通过，health 与首页响应均为 200；最终文件路径、摘要及 MP4 状态见协调者最终交付记录，不以本文代替产物清单。干净环境尚未计时，**不能声称“10 分钟复现已实测”**。

正式工作区需要 API、PostgreSQL、Redis、Linux Celery prefork worker 和 dispatcher；单独打开静态文件无法复现持久化与后台任务。默认 `vp build` 是设计展台，须明确构建 `workspace`。本入口仅监听本机，不代表公开部署或已完成全部产品验收。状态以[施工台账](construction-orders.md)为准，通用细节见[本地运行](local-runtime.md)。

## 干净环境准备

1. 取得授权的私有仓库副本和指定提交；不要覆盖已有检出的未提交改动。记录 `git rev-parse HEAD` 与 `git status --short`。
2. 准备 Python 3.13（已实测 3.13.7）、uv（已实测 0.12.17）、Node 26.13.0、pnpm 11.25.0、Vite+ 1.6.0。Python 与前端版本分别受 `apps/api/pyproject.toml`、`uv.lock` 和前端锁文件约束。
3. 准备 Linux/WSL 环境、PostgreSQL 服务端及客户端、Redis、近期 Chrome。已有记录使用 Ubuntu 24.04、PostgreSQL 16.15、Redis 7.0.15；CI 的 PostgreSQL 17 不等于本轮另行实测所有组合。WSL 发行版、系统包与 Chrome 不由项目锁文件安装。网络下载依赖、系统安装和首次浏览器安装均可能超过十分钟。
4. Windows 与 Linux 分开虚拟环境；三个后端进程同一提交、同一锁、同一专用开发库和 Redis。不要用 SQLite 替代真实运行，也不要在生产库执行测试。

以下 Bash 命令从仓库根目录开始，`TP_REPO_ROOT` 取当前副本绝对路径，不依赖原开发机的盘符：

```bash
export TP_REPO_ROOT="$PWD"
export TP_RUNTIME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/thesis-pilot/competition-services"
export UV_PROJECT_ENVIRONMENT="${XDG_DATA_HOME:-$HOME/.local/share}/thesis-pilot/competition-venv"
cd "$TP_REPO_ROOT/apps/api"
uv sync --locked
```

前端可在 Windows PowerShell 的仓库根目录运行；Linux 也使用相同的 `vp` 命令：

```powershell
Set-Location apps/web
npm install --global vite-plus@1.6.0 # 已有相同版本时跳过
vp install --frozen-lockfile
vp run check
vp test run
vp build --mode workspace
```

输出为 `apps/web/dist-workspace/`。录屏脚本默认选已安装 Chrome；若只安装 Playwright Chromium，使用 `vp exec playwright install chromium`，并按脚本实际支持的 channel 配置运行。现有 MP4 转码工具固定使用 Chrome，需另备 Chrome，不能以安装 Chromium 推断已满足转码依赖。

## 专用服务、迁移与启动

以下使用仓库已有 `dev_services.py`，运行目录必须尚不存在，且仅用于本次复现。先按本机已安装 PostgreSQL 版本修改 `--postgres-bin`。脚本不安装系统程序，不接管未知目录，不删除已有数据库：

```bash
cd "$TP_REPO_ROOT/apps/api"
mkdir -p "$(dirname "$TP_RUNTIME_DIR")"
/usr/bin/python3 scripts/dev_services.py start \
  --runtime-dir "$TP_RUNTIME_DIR" \
  --postgres-bin /usr/lib/postgresql/16/bin --redis-bin /usr/bin
/usr/bin/python3 scripts/dev_services.py status --runtime-dir "$TP_RUNTIME_DIR"
```

默认端口为 PostgreSQL `15432`、Redis `16379`。占用时首次启动可另选 `--postgres-port`、`--redis-port`，不要终止不属于本次运行的服务。脚本生成独立开发库、测试库及私密 `api.env`/`test.env`；不要打印或提交其内容。发行版 `/usr/bin/python3` 需具有脚本要求的 pidfd 接口，standalone Python 不一定具备。

在本机受控配置中保存独立随机访问口令（32—256 个可打印 ASCII 字符；不能等于 API token），三个后端终端均采用下面的配置。`read -s` 不回显；不要启用 shell 命令跟踪，不将口令写入命令参数、录像、日志、`VITE_*` 或浏览器存储：

```bash
cd "$TP_REPO_ROOT/apps/api"
set +x
set -a
. "$TP_RUNTIME_DIR/api.env"
set +a
export TP_ENVIRONMENT=production
export TP_AUTH_MODE=workspace
export TP_WORKSPACE_ORIGIN=http://127.0.0.1:8017
export TP_WORKSPACE_WEB_ROOT="$TP_REPO_ROOT/apps/web/dist-workspace"
read -r -s -p '输入本次复现的独立访问口令: ' TP_WORKSPACE_ACCESS_KEY
printf '\n'
export TP_WORKSPACE_ACCESS_KEY
# 本文第07段专门验证缺凭据失败：确保专用实例不配置模型密钥。
export TP_DEEPSEEK_API_KEY=''
uv run --locked alembic heads
uv run --locked alembic upgrade head
uv run --locked alembic check
uv run --locked uvicorn thesis_pilot.main:create_app --factory \
  --host 127.0.0.1 --port 8017 --no-access-log
```

`heads` 应只有 `20261118_0011`；当前 API readiness 也要求此版本。不要用 `stamp` 或自动建表跳过迁移。首次迁移后再启动其余进程；后续仅换前端不应重复创建数据库。

另开两个 Linux 终端，分别重新设置 `TP_REPO_ROOT`、`TP_RUNTIME_DIR`、`UV_PROJECT_ENVIRONMENT`，并重复上一段加载 `api.env` 及设置 workspace 进程环境的步骤（不重复启动 API），然后分别运行：

```bash
uv run --locked celery -A thesis_pilot.workers.celery_app:app worker \
  --pool=prefork --concurrency=2 --loglevel=WARNING
```

```bash
uv run --locked python -m thesis_pilot.workers.dispatcher --poll-seconds 1
```

运行账户须能遍历解释器与虚拟环境路径；root 环境下按[本地运行说明](local-runtime.md)让 worker 使用适当账户，不能让普通 worker 引用 `/root` 内环境。API 启动成功不代表 worker/dispatcher 已启动。浏览器访问 `http://127.0.0.1:8017/` 并输入口令，检查 `/health/live` 与 `/health/ready`；真实结构任务产生结果才证明后台链路可用。

原开发机 `work/sg21a-evidence/browser_api.py` 是 Windows API + 固定 WSL 服务配置的本机包装，`work/competition-evidence/run-linux.sh` 是固定 Linux 虚拟环境/测试配置包装；它们不属于可移植启动入口，也不应把里面引用的私密配置一起外传。干净环境使用以上命令。

## 合成数据与七场景录制

先从 `apps/api` 生成仓库自制的 DOCX/文本，不录入真实论文：

```bash
uv run --locked python scripts/create_material_demo.py \
  "$TP_REPO_ROOT/work/competition-evidence/material-fixtures"
```

数据由脚本确定性创建。原件字节保存在 PostgreSQL，无额外对象存储目录；只有受限 DOCX 和严格 UTF-8 文本支持解析，PDF 可存原件但解析明确失败。资料与正式稿来源导入保留原件 SHA 和版本映射，不能承诺任意 Word 排版保真。

从 Windows PowerShell 的仓库根目录录制时，口令通过安全输入进入进程环境，不在录制页输入。访问的 API、前端产物及 Linux worker 须同版：

```powershell
Set-Location apps/web
$env:TP_COMPETITION_ORIGIN = 'http://127.0.0.1:8017'
$secret = Read-Host '输入同一复现实例的访问口令' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:TP_COMPETITION_ACCESS_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  Remove-Variable secret, pointer
}
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:TP_COMPETITION_MODEL_STAGE = 'missing'
$run = Get-Date -Format 'yyyyMMdd-HHmmss'
$env:TP_COMPETITION_OUT = [IO.Path]::GetFullPath("../../work/competition-evidence/reproduction-$run")
$env:TP_COMPETITION_SCENARIOS = '01-writing-history,02-structure-task,03-conflict-recovery,04-configurations,05-materials,06-document-source,07-content-assistant'
try {
  node scripts/capture-competition.mjs
} finally {
  Remove-Item Env:TP_COMPETITION_ACCESS_KEY
}
```

| 场景 ID | 实际验证内容与边界 |
|---|---|
| `01-writing-history` | 合成项目、正文保存、历史与刷新恢复 |
| `02-structure-task` | 固定已保存正文版本的真实结构任务，未保存草稿不混入输入；需 worker |
| `03-conflict-recovery` | 双窗口 CAS 冲突、保留草稿与恢复 |
| `04-configurations` | 四库新建、引用/版本、确定性提示词渲染；不调用模型 |
| `05-materials` | 合成 DOCX 上传、真实解析、来源与公式保护诊断、原件下载 SHA/字节核对 |
| `06-document-source` | 固定原件解析版本导入、章节校正、正式稿历史来源映射及原包复核 |
| `07-content-assistant` | 独立会话草稿、缺模型凭据的真实失败、固定输入重试；辅助配置通过 API 创建并记入清单，不冒充全部由 UI 创建 |

可把 `TP_COMPETITION_SCENARIOS` 改为单一 ID，另设新的输出目录后重录；不要覆盖已交付视频。第07段须显式 `MODEL_STAGE=missing` 且服务实际没有模型凭据，脚本会核验；有密钥环境不能假装缺密钥。第02段等待超时可能标 `partial`，不能当作成功。`TP_COMPETITION_JOB_TIMEOUT_MS` 默认 45000，可按脚本约束调整；`TP_COMPETITION_HOLD_MS` 默认 1400。`TP_COMPETITION_PROBE=1` 只检测录屏管线，不计业务验证。

输出 `manifest.json`、逐场景 WebM、截图及元数据。只有清单 `passed`、各场景检查通过且实际视频播放校验成功，才可计作已录制。录屏不包含登录口令；1920×1080 的场景片段不自动构成比赛要求的 5—8 分钟成片，也不满足至少 2 分钟真实 AI 编程协同的证据要求。

使用已纳入前端脚本目录的通用转码工具。从 `apps/web` 运行以下命令，必须显式提供已通过原始清单的目录（也可继续使用上面的 `$env:TP_COMPETITION_OUT`）。命令执行及最终清单确认前，不宣称 MP4 已完成：

```powershell
node scripts/transcode-competition.mjs $env:TP_COMPETITION_OUT
```

转码要求已通过的源清单和 Chrome H.264 MP4 MediaRecorder 支持，保留 WebM；拒绝覆盖既有 MP4 与转码清单。失败后保留现场并选择新的录制输出目录，不删除旧证据强行重跑。检查 `mp4-transcode-manifest.json` 中总体/逐片 `passed`、`playbackVerified`、尺寸、正时长、SHA256、`sourcePreserved`，并实际打开各 MP4 核对内容。仅有 MP4 扩展名或截图不能算视频交付。

## 复测与仍存限制

以下是可复现检查入口，不表示本文编写时已重新运行。既有通过结果、运行环境与范围需对照各轮 `docs/evidence/sessions/` 和最终交付清单；未运行项、跳过项分列，不合计为通过：

```text
# 仓库根目录
python -X utf8 scripts/validate_repository.py
git diff --check
# apps/web
vp run check
vp test run
vp build --mode workspace
# apps/api
uv run --locked python scripts/check.py
```

真实服务集成在独立 Linux 测试配置下执行：加载本次 `test.env` 后运行 `uv run --locked python scripts/check.py --integration`。该配置不能换成开发或生产库；测试使用随机 schema/键前缀，不要求清空共享 Redis。正式桌面 E2E 从 `apps/web` 执行 `vp exec playwright test --config playwright.workspace.config.ts`，通过进程环境提供 `TP_WORKSPACE_TEST_ORIGIN`、`TP_WORKSPACE_TEST_ACCESS_KEY`；内容助手缺凭据专项按现有测试显式设置 `TP_WORKSPACE_TEST_MODEL_STAGE=missing`。排队/运行任务分阶段验证仍按[本地运行说明](local-runtime.md)，不能以一次默认测试推断所有专用阶段执行。

当前可演示的是已交付切片，不是全部比赛主流程闭环。真实模型成功调用未验收；测试中的 provider stub 只验证事务和保护行为，不能作模型证据。模型候选采纳仍有 `REVISION_ADOPTION_NOT_APPROVED` 门禁，不能绕过。五类专业助手、导师反馈与任务计划的正式业务、文献检索、完整评审、正式 DOCX/PDF 导出、多步恢复等仍须对照施工台账逐项完成；设计展台入口不代表这些正式业务已上线。SG04 保护预期的 AI 复核不能填写为人工审核通过。

当前不实施新增未确认的 SG09A/SG19；认领提交/推送受到自动审批拒绝，不以复现说明替代范围确认。本文也不执行公开发布、赛事提交、仓库可见性修改或生产覆盖。
