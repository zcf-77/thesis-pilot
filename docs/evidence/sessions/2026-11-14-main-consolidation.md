# 2026-11-14 main 成果整理与阻断交接

## 需求、范围与验收

用户要求：所有改动有详细但简短的提交记录；现有改动拆成多个提交，全部汇入并推送 main，确认其他分支无领先提交，清理多余分支与工作树，确保本地干净；流程固化为 `/main`。用户补充：禁止一次性提交大量代码，遵守比赛规范与原则。

范围：本次开始时现存的设计、前端、后端、退役原型与文档改动，以及本次提交规范。关联 REQ-006、REQ-007、REQ-012；不是任何产品 AC 的通过声明。基础 main 为 `83b8cf4`。所有整理提交均使用本次实际提交时间，未倒签或恢复旧版本伪造演进。

| 编号 | 可执行验收 | 当前结果 |
|---|---|---|
| MAIN-001 | 按模块/目的显式暂存并拆分，标题和正文具体 | 已保存下表 25 条整理提交；含前端各模块及后端分层；每组暂存 diff/check/stat 和完整补丁在本地 work/main-commit-review |
| MAIN-002 | 本地 main 等于可查询的远端 main | 未完成，网络连接失败 |
| MAIN-003 | 全部分支独有提交已汇入 main，清理干净多余工作树 | 本地仅 main 和单个工作树；远端实时分支清单不可查询，不宣称全远端已确认；隔离副本是本次为保留成果新建，不能删除 |
| MAIN-004 | 原检出 status 干净 | 未完成，原目录 Git 元数据只读；未重置或清理原文件 |
| MAIN-005 | `/main` Skill 安装及验证 | 未完成，个人 Skill 检出不存在，替代连接失败；流程内容已落到项目 main-workflow 文档，不宣称命令已注册 |

## 保存方式与真实边界

原目录 `E:/Project/thesis-pilot` 的 `.git` 只有读取权限，`git fetch origin --prune` 失败：`cannot open '.git/FETCH_HEAD': Permission denied`；显式暂存试探失败：`Unable to create .../.git/index.lock: Permission denied`。

允许写入的独立目录为 `work/main-integration`。常规本地 clone 的 Git shell 被系统拒绝后，使用新 `git init --initial-branch=main`，复制原对象与引用、`git read-tree HEAD` 初始化独立索引，再复制当前 Git 管理及未忽略的新文件。原 `.git` 未修改，原文件未重置。副本使用相同 origin URL，保留原有两个提交及本批真实提交；副本不是原检出的额外 worktree。

逐组检查发现 `docs/design/repair-writing.md` 文件末尾多余空行；仅删除该空行后复查通过。原目录和副本同步此最小格式修复。未发现常见私钥/服务令牌特征；样例 `.env.example` 不是实际凭据，签名扫描不代表全面安全审计。

## 提交映射

以下是本次积压成果整理顺序，不代表这些模块在历史上按此顺序逐轮生成。中间提交存在待后续集成的依赖；验证针对相同最终内容集合，未宣称逐提交构建通过。大型现有单页面保持其模块边界，没有为了提交数量改写实现或制造虚构历史。

| SHA | 主题 | 文件数 |
|---|---|---:|
| `b629f0d078` | chore(prototype): 整理删除已退役的独立原型 | 30 |
| `3f4e94c005` | docs(design): 整理功能映射、覆盖审计与页面修复设计 | 35 |
| `3f9481a13c` | docs(design): 同步统一控件与真实功能动效规范 | 1 |
| `0f125bcdcf` | feat(controls): 整理自定义选择器、日历及浮层交互 | 9 |
| `575064b91f` | feat(motion): 整理共享动效与领域组件过渡 | 10 |
| `382c337b2d` | feat(workspace): 整理共享项目状态、本地恢复与备份页面 | 10 |
| `87323da965` | feat(plan): 整理任务计划、关联与完成状态交互 | 5 |
| `1af627a305` | feat(feedback): 整理反馈录入、原文保留与处理交互 | 6 |
| `ab74bcd1d1` | feat(library): 整理四库管理、配置关联与状态回归 | 5 |
| `8cdde4e377` | feat(writing): 整理受控候选、编辑适配及程序保护回归 | 11 |
| `49aa99047d` | feat(review): 整理仅评审页面与报告状态回归 | 4 |
| `f004240424` | feat(settings): 整理偏好设置、提醒配置与交互回归 | 4 |
| `b8459c6821` | feat(events): 整理通知、诊断任务及取消恢复交互 | 8 |
| `27e53eed97` | feat(progress): 整理全局阶段进度与今日视图 | 4 |
| `3a308184db` | feat(lab): 接入十二页预览入口与共享布局 | 8 |
| `9b2a591e9b` | test(web): 整理浏览器回归与页面证据采集入口 | 11 |
| `ccb353ed03` | docs(evidence): 归档现有页面截图与动效实测材料 | 32 |
| `8f0f8efa20` | feat(api): 整理 FastAPI 配置、认证与数据访问基础 | 19 |
| `4e4776e72a` | feat(api-projects): 整理项目元数据与版本冲突控制 | 7 |
| `db3e3dfc94` | feat(api-jobs): 整理诊断任务、outbox 与执行令牌边界 | 15 |
| `26ea6d65b0` | build(api): 登记项目与任务基础迁移 | 4 |
| `67c03a9e20` | test(api): 整理检查入口、接口契约及真实服务回归 | 9 |
| `2ef197952a` | docs(api): 登记后端开发门槛、CI 与环境阻断 | 6 |
| `a83bd9c267` | docs(evidence): 保留本轮设计会话、失败及实测索引 | 7 |
| `8c94e7c65a` | docs(project): 同步项目现状与逐项提交收尾规范 | 12 |

本证据记录与后续验证记录另行提交；用 `git log -- docs/evidence/sessions/2026-11-14-main-consolidation.md` 查询其真实提交，避免自引用。

## 实际检查

| 命令 | 退出码/结果 | 范围 |
|---|---|---|
| `python -X utf8 scripts/validate_repository.py` | 0；71 documents、284 links | 新增本记录前的仓库文档；随后本记录加入后复验 72 documents、285 links 通过，不等于应用验收 |
| `git diff --check`；逐组 `git diff --cached --check` | 0（修复一次 EOF 空行后） | 差异格式 |
| `vp run check` | 0；181 文件格式、164 文件检查及 vue-tsc 通过 | 前端最终文件集合 |
| `vp test run` | 0；17 文件、157 项通过 | 确定性前端单测 |
| `vp build` | 0；1811 modules、单文件 HTML 4.01MB | 前端构建；副产物不纳入 Git |
| `vp run test:e2e` | 本地 HTTP 预览未得到完成结果，取消，退出 1 | 不计通过 |
| Chrome + `PLAYWRIGHT_FILE=dist/thesispilot-design-lab.html`，`vp exec playwright test --workers=2` | 0；101 passed (3.2m) | 当前构建产物的离线浏览器回归，不是 HTTP 服务验收 |
| `python -X utf8 scripts/check.py`（apps/api） | 1；Missing uv.lock | 未执行完整后端快测/服务集成；不以旧 25 项测试记录替代本轮实测 |
| `git fetch`、`git push origin main`、`git ls-remote --heads origin` | 128；getaddrinfo() thread failed to start | 远端未同步、未 rebase；远端迁移/错误码冲突检查受阻 |
| `gh repo view ... --json visibility` | 1；error connecting to api.github.com | 当前 Private 可见性未重新核验，未执行修改权限 |

个人 Skill 连接 `https://chatgpt.com/backend-api/git-authed/skills` 同样因 DNS 执行失败，未初始化、验证或宣称安装成功。执行流程内容保存在 [main 汇总流程](../../engineering/main-workflow.md)，并已同步 CONTRIBUTING 与 AGENTS 的及时提交规则。

补充：在隔离副本执行文档检查时，因未复制被 Git 忽略的 deliverables/thesispilot-design-preview.html，出现 3 条现有本地 HTML 链接缺失。原目录的同一检查通过。该离线交付物未纳入 Git，干净克隆不能仅凭文档检查通过宣称完整交付。

## 证据与后续

本记录只保留当前用户指令的事实摘要、工具执行结果和提交映射，没有完整编程对话原件或校验值，不能计为三条完整 Prompt 链。未改写既有历史会话或声称补齐比赛过程证据。

原目录仍需在允许写入 Git 元数据且能够访问远端的环境接续：保留副本提交，核对两边实际文件完全一致后整合回原 main；fetch/rebase、迁移及错误码冲突检查、必要复验、推送并查询远端确认，再按 main-workflow 清理。不得删除当前保存独有提交的隔离副本或使用 force/reset/clean 制造干净状态。
