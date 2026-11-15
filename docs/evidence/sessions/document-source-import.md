# 固定原件导入与正式稿来源保护

SG-13A，2026-11-18 UTC+08，基础 `ce19a73bbed74ff04a1a707a0085f276a5825eec`。范围以[施工台账](../../engineering/construction-orders.md)为准，对应AC-002、正式写入保护与恢复的AC-005/006/008/012相关边界；不据此签过全部产品验收。

## 先行功能设计

| 功能 | 入口与输入 | 结果/状态/恢复 | 关联与验收 |
|---|---|---|---|
| 原件导入预览 | 无正式稿的写作页选择同项目资料、原件、解析版本 | 固定来源SHA、支持诊断、可读章节候选；源失效/跨项目明确失败 | 来源不切换最新版，不接收客户端全文JSON |
| 章节校正与导入 | 对允许anchor选择标题/段落及1..6层级，显式导入 | 同事务正文v1、来源与保护映射；已有稿409，命令重放稳定回执 | 原文不变、未知对象不动、并发一次创建；失败不损坏旧内容 |
| 编辑与保存 | 已导入的正式稿映射文字槽编辑 | 不支持的对象/结构变更在编辑事务提示拒绝，服务端仍最终检查 | 原件完整可下载；保存/AI采纳/撤销/历史恢复每版均保留来源映射 |
| 来源查看与恢复 | 当前/历史来源信息、原包下载 | 明确原件与解析版本、章节校正和支持范围，刷新不丢 | 不把编辑投影当完整DOCX；不把学生改动当导师认可 |

空稿创建保留现有独立入口和自由编辑行为；从原件导入只对尚无Document的项目开放，不能自动覆盖已建空稿或已有正文。导入后的受限DOCX当前仅支持固定映射的纯文本编辑；新增/重排结构和格式变更明确不支持，SG-19/13B另接入，不冒称任意保真转换。

## 冻结架构与保护

- 新增document_sources根身份与逐DocumentVersion不可变映射，原件/解析/SHA/manifest与命令摘要固定。原件、解析版本均仍由materials保存，不复制或篡改它们。
- 服务端从parse.editor_json重建；章节纠正只针对映射唯一且支持的paragraph/heading，标题ID由服务器给出。保存明确章节覆盖；后续验证先核目标章节字段，再在临时副本逆向恢复原字段并执行原manifest骨架保护，不能直接放松原保护允许任意改结构。
- documents服务抽事务内创建helper；统一append入口在CAS事务内核来源保护并记录下一版本映射，使手动保存、AI apply/undo/revert统一受控。guards只依赖模型、正文结构和解析纯函数，避免与业务service循环导入。
- 前端复用现编辑器实例，条件启用源文档事务过滤；原文、公式、图片、域、无法解析占位及结构变化不靠AI提示词保护。异常保留草稿并显示具体支持范围，空稿不受源文档限制。
- 同步事务、幂等、错误码、OpenAPI生成及HTTP/Mock契约一致；演示使用既有生成DOCX，不输入真实论文或凭据。录屏只记录实际成功路径，失败修复证据另记。

## 实施与纠错证据

- 新增来源模块、事务内正文创建、统一append保护与逐版映射；0010迁移对来源根和版本映射实施UPDATE/DELETE不可变约束，有来源数据时拒绝回退以免丢失保护事实。
- 前端固定三项来源ID，原始章节预览与“导入后”校正字段明确区分；同一Tiptap实例增加事务过滤，不因来源状态重建编辑器。当前及历史来源下载取真正原包。来源查询携带所见正文版本，防止并发更新把旧稿和新映射混用。
- HTTP/Mock统一契约，Mock也将正文与来源同步提交/回滚；来源信息缺失或异常不会降级普通稿，只有明确无导入来源才保持自由编辑。
- 真实PG首次12项均在迁移对比阶段失败：迁移生成后模型版本字段改为BigInteger，迁移仍是Integer；协调者同步0010字段，再跑12项全部通过（13.55s）。没有跳过迁移检查或改用SQLite作为集成结果。
- 正式工程检查初轮发现迁移import顺序、来源预览联合类型；分别修排序及通过已验证guard模型读取editable_paths。uv默认缓存目录权限失败后改用仓库既有忽略目录work/uv-cache，未改变系统安全策略。
- 前端首次全量467项/41文件通过，正式workspace构建通过；check指出配置和HTTP来源适配格式，分别交各自所有者修复。最终完整闸门、浏览器与录屏结果待实测后续记。

以上为真实AI开发与运行摘要，不是逐字Prompt链，也不代替人工预期签核。

## 实测结果

- 最终Windows `uv run --locked python scripts/check.py`退出0：413测试通过（137.31s），Ruff、格式、mypy82源文件、真实OpenAPI及唯一head0010通过。受限环境初跑停在asyncio本机socketpair，45秒诊断栈定位后中断；获准环境重跑完成，未跳过测试。
- 独立Linux/PostgreSQL `pytest tests/integration/test_document_sources.py -q`：12通过（13.55s）。演示库增量升级0010成功，`alembic check`返回无新升级操作。
- 前端最终475测试/41文件通过；`vp run check`3/3无警告通过；`vp build --mode workspace`通过。产物仍是显式正式工作区，未切换默认preview或公开部署。
- 真实桌面来源导入场景1通过（11.4s）：上传合成DOCX、真实worker解析、两项章节纠正、导入v1、映射文字保存v2、刷新、Enter结构修改前端拒绝、绕过前端的同源公式篡改PATCH409且版本不变、当前/历史原件下载逐字节与SHA一致。首轮标签exact不匹配、次轮直接PATCH未带Origin先被CSRF403拒绝；分别修测试定位及合法同源请求后实过，未降低保护规则。
- 既有空稿桌面场景1通过（14.2s）；同文件另2项需queued/worker阶段，本轮默认跳过，不能计作通过。此前阶段结果仍在各自历史证据中。

## 本机复现

依照[运行说明](../../engineering/local-runtime.md)准备专用PostgreSQL/Redis、迁移、API/dispatcher/Linux worker，前端构建正式工作区；以下从相应目录执行，访问口令仅放进程环境，不贴入日志。

```text
apps/api: uv run --locked python scripts/create_material_demo.py ../../work/competition-evidence/material-fixtures
apps/api: uv run --locked python scripts/check.py
apps/api: uv run --locked python -m pytest tests/integration/test_document_sources.py -q
apps/web: vp run check
apps/web: vp test run
apps/web: vp build --mode workspace
apps/web: vp exec playwright test --config playwright.workspace.config.ts document-source.integration.ts
apps/web: node scripts/capture-competition.mjs
```

桌面测试使用 `TP_WORKSPACE_TEST_ORIGIN=http://127.0.0.1:18021`、本次专用`TP_WORKSPACE_TEST_ACCESS_KEY`及`PLAYWRIGHT_CHANNEL=chrome`。录屏额外设 `TP_COMPETITION_SCENARIOS=06-document-source` 和独立 `TP_COMPETITION_OUT`。每次新建合成项目；不依赖先前演示ID。原件生成可重复核对，无真实论文数据。

本次WebM：`work/competition-evidence/document-source-v1/06-document-source.webm`，1920×1080，37.019秒，7516933字节，SHA-256 `5737a72fe9557ba08b81acb2382b4a47d3e956589c92b261f59710c336129c3f`；浏览器实际解码播放与尾时间通过。当前/历史下载均为1682字节、SHA-256 `0433db562bcec61333351cde453241a130875a69517ed6bd6c172018c158be33`，与合成上传文件一致；详情和逐步动作见同目录manifest。

H.264 MP4：`work/competition-evidence/document-source-v1/06-document-source.mp4`，1920×1080，37.116秒，3812830字节，SHA-256 `445a5d493513eb8e78ede4fa4773e28f9eb6d33c96995df6b664bd52d9f250e8`；真实转码及完整播放核验成功，原WebM保留。六段分别可播放的场景素材仍不是5–8分钟赛事成片，也不满足至少2分钟真实AI编程协同的录屏要求。

提交映射：后端 `dc91faf`，前端与真实录屏脚本 `725eb6e`。文档检查99文档/489本地链接通过，`git diff --check`通过；远端交付结果由协调者完成fetch/rebase/push后登记在唯一台账。
