# 首阶段工程基线复核

2026-11-17（Asia/Shanghai）。SG-01 为工程验收。复核基线为 `8045b325da0b94fdc19b869c19498a1a4b710d96`，主会话负责前端回归与操作，文档子代理负责状态纠偏和后端基础检查。认领、暂停与恢复见[施工台账](../../engineering/construction-orders.md)。

## 基线与差异

| 核对项 | 当前记录及依据 |
|---|---|
| 已有实现 | `45446de` 已对齐本地写作预览、项目元数据及诊断任务的范围。继续以 [README](../../../README.md) 为启动和检查入口，以 [前端修复](2026-11-14-existing-design-repair.md)、[服务接入](2026-11-14-frontend-integration.md)和[真实联调](2026-11-14-real-integration.md)为历史证据。 |
| 日期依赖 | `45446de` 记录两个依赖可行候选的用例因动态日期超出硬截止而失败。`091e705` 固定用例场景日期后通过预览和 Mock 回归。业务仍按实际条件计算排期。 |
| 文档支持 | `f964ebb` 的独立小样已用学校模板和自制样例验证 DOCX 导入、编辑、快照重载与副本导出。[README](../../../README.md)、[架构](../../engineering/architecture.md)和[路线](../../engineering/roadmap.md)补充这一事实，正式写作台入口待接入和验收。[小样支持范围](../../engineering/docx-roundtrip.md) |
| 模型选型 | 用户选定 DeepSeek 官方接口，普通任务使用 `deepseek-flash`，复杂任务使用 `deepseek-v4-pro`。型号可用性和调用待验证，应用尚未接入。依据为[施工台账 D5](../../engineering/construction-orders.md)。 |
| 前端设计 | `d2f751a` 将现有设计复用、控件层级、默认信息和逐页操作对照纳入[设计规范](../../../apps/web/docs/design/DESIGN-SPEC.md)及[页面功能设计](../../design/page-functional-design.md)。本次基线纠偏只涉及文档。 |
| 产品验收 | 当前工程证据保留对应边界，[19 项完整场景](../../product/acceptance.md)均待执行。 |

## 本轮检查

前端命令从 `apps/web` 执行，后端命令从 `apps/api` 执行。原始日志在本机 `work/stage1-baseline/`。

| 命令与环境 | 实际结果 | 日志 |
|---|---|---|
| `uv sync --locked`，Windows | 退出 0，解析 81 个包，检查 80 个包。 | `api.log` |
| `uv run --locked python scripts/check.py`，Windows / Python 3.13.7 | 退出 0。锁一致，Ruff 检查及格式通过，mypy 检查 31 个源文件通过，62 项快测通过。OpenAPI 验证通过，Alembic 唯一 head 为 `20261114_0001`。 | `api.log` |
| `vp run check` | 退出 0，生成契约、格式、静态检查及 Vue 类型通过。 | `web-check.log` |
| `vp test run` | 退出 0，21 个测试文件、189 项单测通过。 | `web-test.log` |
| `vp build`，默认 preview | 退出 0，生成静态资源与单文件展台。 | `web-build.log` |
| `vp run test:e2e`，按上述 preview 构建运行 Chrome，8 个并行进程 | 退出 1，100 通过、3 跳过、1 失败。`foundation-complete.spec.ts:114` 的任务取消与失败重试用例中，点击取消先等待按钮位置稳定，随后遇到指针事件拦截，按钮在超时前从 DOM 脱离。 | `web-e2e.log` |
| 同一 preview 构建，Chrome 定向复跑上述用例，1 个进程 | 1 项通过。 | `web-e2e-recheck.log` |
| 同一 preview 构建，Chrome 全量复跑，2 个并行进程 | 101 项通过、3 项跳过。两次全量回归跳过项均为 Mock 专用用例。 | `web-e2e-confirm.log` |
| 主会话在 Chrome 上操作 preview 单文件展台，1440 × 1000 | 写入自制正文、点击版本历史入口后刷新，确认正文恢复。项目目录仅确认可进入；任务页实际启动和取消预览任务，等待后仍保持已取消。未捕获页面异常。部分截图在入场或面板过渡完成前抓取，仅记录本轮操作，不作为完整视觉验收。 | `manual-review.json`、`manual-write.png`、`manual-projects.png`、`manual-jobs.png` |
| `python -X utf8 scripts/validate_repository.py`，仓库根目录 | 退出 0，校验 85 份文档、372 个本地文件链接、12 项赛事要求、19 项验收编号、2 份来源快照及哈希。 | 文档子代理工具输出 |

`api.log` 的 SHA-256 为 `4e89890cccae43cfa99fb4e579d746bb6d7ad40c487627756a94eb5564794347`。

本轮后端未执行 `--integration`，真实 PostgreSQL、Redis、worker 及 HTTP 浏览器联调见[此前联调记录](2026-11-14-real-integration.md)。
