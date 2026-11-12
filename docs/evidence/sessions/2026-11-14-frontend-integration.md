# 2026-11-14 数据契约与首轮前端接入

用户输入依次为“现有前端是否满足直接边开发边接入？是否有完善的数据结构规范？”和“继续吧”。本轮按已登记的 [INT-001—008](../../engineering/frontend-integration-plan.md) 实现统一契约与首批项目/诊断任务接入；关联 AC-001/008/010/012/015，但不将这些完整产品 AC 标为通过。

工具：Codex 主会话与限定文件所有权的并行子任务；具体底层模型版本无法从执行输出确认。原始对话尚未完整导出。本文是事实索引与结果摘要，不是三条完整编程 Prompt 链，不伪造人工试用、服务器执行或模型输出。

## 实现与实际验收

| 编号 | 本轮实现 | 实测与边界 |
|---|---|---|
| INT-001 | 后端真实 OpenAPI → 生成 TypeScript DTO/schema；拒绝不支持的结构 | 14 项生成测试、漂移检查通过；生成文件固定 LF，避免 Windows 检出造成假漂移 |
| INT-002 | 同契约 Mock/HTTP 服务、运行时校验、错误/超时/取消、显式实例 | 11 项服务行为测试通过；注入 fetch 的单测不能证明真实 HTTP 已通 |
| INT-003 | 原项目路由内提供列表、创建名称、改名、详情、冲突和未知结果恢复 | Mock 浏览器实际完成创建/改名/详情；无项目整体上传，不支持的字段明确留在本机 |
| INT-004 | remoteBinding 关联本机项目，保留本地 ID/正文/历史/模块，备份新副本去绑定 | 4 项绑定保护测试通过，浏览器实际验证重新打开保留已编辑正文 |
| INT-005 | 诊断任务创建、分页查询、轮询、取消与离页返回恢复 | Mock 浏览器实际创建/取消/再次创建/离页返回/完成；未确认创建键按来源与项目保留在会话内 |
| INT-006 | GET /api/v1/jobs 按 project_id 分页，稳定排序，检查项目存在，UTC 输出 | 新增 4 项同步列表测试通过；另新增 7 项 HTTP 回归，本会话未完成 HTTP 执行 |
| INT-007 | 默认 preview 保留原页面；mock/http 使用同一套接入组件 | check、189 项单测、两种模式 build、101 项原交互与 3 项 Mock 接入浏览器测试通过 |
| INT-008 | 数据三层、公共字段、版本、状态、实体关系、演进和模块模板 | [数据规范](../../engineering/data-contracts.md)、[接入说明](../../engineering/frontend-integration.md)已写入；未实现实体明确为待契约化 |

本轮没有新增路由、数据库迁移或服务端错误码。项目元数据版本与正文版本独立。开发代理令牌只在 Vite 服务端闭包注入；不构成用户登录或项目归属权限。诊断任务没有调用模型、没有改写论文。

## 真实纠错与复查

1. 生成文件曾被格式化，导致契约漂移检查失败。重新生成后在格式化配置中明确排除生成文件；添加窄范围 `.gitattributes` LF 规则，未关闭契约检查。
2. 绑定校验键数量初稿误写为 6，实际定义是 5，已修正。绑定测试首次对含可选 undefined 的内存对象直接调用持久化校验而失败；改为验证实际持久化边界的序列化 JSON，未放宽生产校验。
3. 页面审查发现项目创建未知结果未覆盖 5xx/无效成功响应；现保留输入、阻止直接重复提交并引导核对目录。发现任务未确认幂等键随组件销毁丢失，现按服务实例/项目保留到确认响应。发现详情中的活动任务离开当前分页后停止查询，现补独立读取。
4. 同步审查与格式检查发生时页面子任务仍在编辑，曾出现格式检查失败；待文件所有权交回后限定格式化，完整 check 复测退出 0。
5. 第二轮限定只读复查未发现阻断性问题，范围为服务/生成器、项目关联/备份、开发代理和任务列表；不是全仓审计或真实服务验收。

## 命令与结果

下列均为本会话实际工具输出。前端命令工作目录 `apps/web`，后端缓存运行器命令工作目录仓库根；缓存运行器加载真实已存在的 Python 包，没有伪造缺失库。

| 命令/检查 | 实际结果 |
|---|---|
| `vp run check` | 退出 0；API contract verified，202 文件格式通过，186 文件 lint/type 检查通过，vue-tsc 通过 |
| `vp test run` | 退出 0；21 个测试文件、189 passed；此前一次为 188 passed/1 failed，修复见上 |
| `vp build` | 退出 0；1828 modules，preview 单文件约 4.03 MB |
| `VITE_SERVICE_MODE=mock`、`VITE_API_INSTANCE=integration-test` 下 `vp build --outDir ../../work/api-mock-preview` | 退出 0；1828 modules，Mock 单文件约 4.04 MB；独立输出未覆盖默认预览 |
| `VITE_SERVICE_MODE=http`、测试实例 ID 和人工合成 TP_API_TOKEN 下 `vp build --outDir ../../work/api-http-preview` | 退出 0；1828 modules；逐文件检查构建产物未包含合成令牌。该值为自制测试标记，从未是真实凭据；不等于 HTTP 可达 |
| `PLAYWRIGHT_CHANNEL=chrome`、`PLAYWRIGHT_FILE=dist/thesispilot-design-lab.html` 下 `vp exec playwright test --workers=2 --output ../../work/api-preview-test-results` | 退出 0；101 passed、3 skipped，3.1 分钟；跳过的 3 项要求 Mock 构建，未计为通过 |
| `PLAYWRIGHT_FILE=../../work/api-mock-preview/thesispilot-design-lab.html`、`PLAYWRIGHT_CHANNEL=chrome`、`TP_API_INTEGRATION_E2E=1` 下 `vp exec playwright test tests/e2e/api-integration.spec.ts --workers=1 --output ../../work/api-mock-test-results` | 退出 0；3 passed，20.2 秒；同契约内存服务，不是 HTTP 后端 |
| `python -X utf8 -B work/offline-backend-check/run.py -k "test_job_services or test_project_services or job_list_services or invalid_configuration or configuration_failure or flush_failure or update_commit_failure or diagnostic or distinct_projects" -o faulthandler_timeout=20 -q` | 退出 0；29 passed、33 deselected，4.98 秒；SQLite 同步回归不替代 PostgreSQL |
| `python -X utf8 -B work/offline-backend-check/bootstrap.py scripts/export_openapi.py --check` | 退出 0，OpenAPI contract verified；包含本轮真实路由与 JobPage |
| `python -X utf8 scripts/check.py`（apps/api） | 退出 1：`Missing uv.lock: run uv lock and uv sync on an authorized network first.`；完整后端门槛仍未通过 |
| 不筛选的缓存后端测试 | 卡在 Windows asyncio `_fallback_socketpair` / `accept`；20 秒 faulthandler 栈定位后停止，退出 1，无完整通过结论 |
| 不设置 PLAYWRIGHT_FILE 的 HTTP 预览测试 | 未完成启动/连通检查，主动停止，退出 1；未计通过，随后对文件构建完成上述浏览器检查 |
| `python -X utf8 scripts/validate_repository.py`、`git diff --check` | 均退出 0；77 documents、307 local file links。此前在证据文件尚未创建时链接检查失败，补齐本文件后复测通过 |

环境差异：同仓库另一会话的 [Git 恢复记录](2026-11-14-git-recovery.md)记载了其 HTTP 预览和 62 项缓存测试成功；本会话实际仍有 socket/Git 网络限制，两份结果分别保留，不挪用另一会话结果替代本次联调。

## 页面、动效与截图

| 触发操作 | 状态与动效 | 减弱模式/检查 |
|---|---|---|
| 打开/关闭新建名称表单 | 共享 tp-swap；退出期间 inert，取消退出恢复交互 | 390px/1440px 减弱动效 E2E 实际取消表单，未生成项目 |
| 创建项目/任务、状态变化 | 稳定 ID 的 tp-list、状态 tp-swap；结果确认后更新 | Mock 流程实际操作通过；沿用全局减弱令牌，不延迟数据写入 |
| 读取详情、加载/错误、未绑定任务页 | 共享状态组件及 tp-swap | 四主题截图检查；错误/超时行为另由服务测试覆盖，未声称浏览器已模拟所有网络失败 |
| 离开任务页后返回 | 停止旧查询，保留后台事实；重新读取列表 | 浏览器完成任务不因离页而取消；无旧结果写入正文 |

使用现有 `scripts/shot.ts`、本机 Chrome、Mock 独立文件构建实际截图并打开检查：`work/api-integration-zhumo.png`、`work/api-integration-chenwu.png`（1440px），`work/api-integration-yehang-mobile.png`、`work/api-integration-yingguang-mobile.png`（390px，减弱模式）。表单、输入和按钮沿用主题，未发现裁切或重叠。一次误用不存在的 qinglv 主题，只得到回退主题截图，未计为第四主题；随后使用正确 chenwu 重拍并检查。截图与浏览器输出为本地可复现中间证据，未混入论文或凭据。

## 提交及环境交接

| 提交 | 内容 |
|---|---|
| `aa0e0cb` | 实现前登记 INT-001—008 与边界 |
| `732ce5e` | 后端任务列表、UTC 契约与回归 |
| `d8a54a7` | 生成器、DTO/schema、漂移测试、CI 与 LF 规则 |
| `b192ad1` | 统一 Mock/HTTP 服务与行为测试 |
| `3e86728` | 模式/代理、服务实例、工作区关联与保护回归 |
| `1ad1aef` | 现有项目/任务路由接入及 Mock 浏览器流程 |
| `565e621` | 数据结构、字段关系和逐模块接入规范 |

本轮开始原检出的 Git 元数据写入失败，沿用既有 `work/main-integration` 保存真实小步提交。执行期间观察到原 main 已由另一会话恢复到 `a103712`；通过本地 bundle 导入并用真实 merge `41710f6` 合入，保留其恢复工具与证据提交，不覆盖原文件、不重复生成旧提交历史。直接本地路径 fetch 曾遇 Git/MSYS 命名对象权限错误，bundle 导入成功。

本会话 `git -C work/main-integration fetch origin --prune` 退出 1：`getaddrinfo() thread failed to start`。不能据此声称已与最新远端 rebase、迁移/错误码无远端冲突、已经推送或完成清理。未执行 force push，未删除工作树或未发布提交。当前文档及最终收尾提交可通过 `git log -- <本文路径>` 查询。

收尾实际执行 `python -X utf8 scripts/publish_main.py --check-only` 退出 0：原 main `a103712` 与当时待接回 `607bab3` 的受控文件逐字节一致，整合副本无未提交改动。随后执行接回入口，退出 1：不能写入 `.git/thesispilot-publish-write-probe`（Permission denied），在修改原引用/索引之前停止；未绕过权限。原工作目录仍显示尚未接回的本轮差异，不能称其干净；提交副本及文件保留，后续可在具备权限与网络的终端按 main 流程接续。

剩余：完整 uv 锁、Ruff/mypy/Alembic 和 PostgreSQL/Redis/Linux worker 验证；真实 HTTP 代理到 API 链路；用户会话/资源授权；正文/计划/资料/反馈/候选等逐模块正式契约和后端实现。下一模块沿用数据规范、真实 OpenAPI 生成与同契约服务，不要求等整套后端完成后再接前端。
