# 2026-11-02 · 仓库与开发规范初始化

状态：初始化事实记录，非完整 AI 编程对话导出，不计入三条核心功能 Prompt 链。日期按 Asia/Shanghai。

## 用户授权与意图

以下为当前会话用户指令的局部摘录，不代表完整原始对话：

> 在 E:\Project 下建立一个仓库，初始化并且写入仓库要求。方案暂定这个选题，后续在仓库内部细化方案。

> 能不能规范一点 不要用拼音做项目名啊

> gh 已登录   帮我发布到github，private权限。

结果目标：以 ThesisPilot 为英文项目名，中文名保留毕设智途，完成初步方案、比赛要求、单人 AI 开发规范和私有仓库初始化。本轮不开发产品功能，不作获奖承诺。

## 实际操作与观察

- 检查目标父目录存在，原本不是 Git 仓库；确认新项目目录没有既有文件后初始化 `main` 分支。Git 版本实际输出 `2.49.0.windows.1`。
- 用户更正命名后，暂停子任务写入，校验源/目标都在 `E:\Project`，确认目标不存在后移动目录；`git rev-parse --show-toplevel` 实际返回 `E:/Project/thesis-pilot`。
- 两项独立文档任务并行：产品方案/验收、比赛来源/交付矩阵；主任务编写工程规范、证据模板和校验器。子任务不提交 Git。
- 官方赛道与通知通过公开接口重新读取，返回成功；保留实际响应与 SHA-256，不改写来源。详见 [比赛要求](../../competition/requirements.md)。
- 首次执行 `gh` 未找到命令，实际错误为 `The term 'gh' is not recognized`；定位到 `C:\Program Files\GitHub CLI\gh.exe` 后，身份验证成功。未读取或写入明文 token。
- 原始完整聊天/工具输出仍位于当前 Codex 聊天，尚未导出到本仓库。本文是事实摘要；不能声称具备完整对话证据。

## 验证与提交

已实际执行以下检查，均成功；不代表产品验收通过：

```text
python -X utf8 scripts/validate_repository.py
PASS: 15 documents; 29 local file links; 12 requirements; 12 acceptance scenarios; 2 source snapshots and hashes.
Scope: repository documentation only; application, full Prompt chains and contest submission NOT verified.

校验器负例验证（内存模拟，无文件改写）
PASS: simulated source-byte change is rejected.
PASS: simulated broken local link is rejected.
PASS: unmodified repository remains valid; negative checks changed no files.
```

另已使用 Git 对跟踪及未跟踪未忽略文件执行全仓旧名称检查，无残留；对选定 GitHub token/私钥模式检查无命中（不等同全面安全审计）。`git check-ignore` 确认环境文件、用户论文目录与私人对话路径受忽略。

当前应用功能、模型调用、试用、性能、视频、PDF 与赛事提交均未开始。初始化证据没有补造完整对话。

本文件关联的提交使用 `git log -- docs/evidence/sessions/2026-11-02-initialization.md` 查询，避免在同一提交中填写尚不存在的提交哈希。GitHub 创建与推送状态由远端查询核验，不能从用户授权推断成功。

## 私有远端初始化

- 初始化基线仅包含方案、规范、快照与文档校验器，共 20 个文件；没有产品功能一次性打包。应用开发尚未开始时，按用户要求整理初始化历史，后续功能开发必须保留真实的细粒度演进记录。
- 经用户明确授权，实际创建 `https://github.com/zcf-77/thesis-pilot`，平台返回 `isPrivate=true`、`visibility=PRIVATE`；已配置 `origin`。
- 首次 `git fetch origin` 成功，`git ls-remote --heads origin` 无分支输出；新空远端没有可 rebase 的分支，不能报告已执行 rebase。
- 当前版本没有应用数据库迁移或业务错误码登记，初次推送撞号检查不适用；后续引入后必须与远端对照。
- 推送完成以本地 HEAD、远端 main 和可见性查询为最终证据，聊天中汇报。本文不将仓库 push 当作应用部署或赛事提交。
