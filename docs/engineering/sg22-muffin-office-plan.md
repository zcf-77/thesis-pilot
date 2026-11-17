# SG-22 正文编辑器切换为 MuffinOffice —— 接入方案（协调者定稿）

MuffinOffice 快照：muffin-office-poc `origin/main` `cfb8352`，已解出到 `/private/tmp/claude-501/-Users-mufeng--claude-spares-spare-O2xhZ2/148f9005-5000-4d2e-9a37-4cf7f4595691/scratchpad/mo`（只读参考，含 docs/48-Word纸面编辑器.md、docs/38-office-server.md、packages/vue/src/DocsEditor.vue 与 docs-editor/*、packages/core、crates/*）。该快照下 `frontend/public/pkg`（office-wasm）与 `pkg-import` 已用本机 wasm-pack 构建成功。**不得修改 muffin-office-poc 仓库**；需要的上游改动写进报告“上游需求”。

## 已核实的事实
1. office-server 边车的 `/v1/docs/transactions`、`/inspect`、`/anchors/resolve`、`/compare` 作用于 **DOCX 字节**（同段文字替换/插入/删除、真实 w:ins/w:del、批注、UTF-16 偏移、irMap 映射源路径↔IR 节点）。`/v1/docx` 只接受 `doc-spec/resolved-1`、`gongwen-docx-1`。模型→DOCX（`model_to_docx`）、`txn` 重放、`validate_project_model` **只在 WASM**。`/v1/parse`（`office-source/1`）返回 DocsModel + unsupported/preserved/converted。
2. DOCX 导入会丢 OMML 公式与 VML；域只保留缓存文字；模板样式折叠为内置主题；没有论文主题。
3. 偏移：DocsEditor 与 IR 锚点用 Unicode 标量（行内原子计 1），布局与 office-review 用 UTF-16；ThesisPilot 现用 ProseMirror UTF-16；Python `str` 索引即标量。
4. 节点 ID 只需非空且唯一，旧 `chapterId` 可直接作标题块 ID。
5. `DocsEditorPage` 含 4 个原生 `<select>`，**不能用**；只用 `DocsEditor`，外壳自建。编辑器减弱动效依赖 `prefers-reduced-motion`，我们用 `[data-motion=reduced]`，需覆盖。
6. `office.worker.ts` 从 `self.location.origin + '/pkg/'` 加载 WASM，我们构建 `base: "./"`——用记录在案的补丁文件改为可配置基址。
7. 保护区间是宿主属性，DocsModel 没有锁标记，保护信息存放在 ThesisPilot 快照。
8. 读取 Tiptap JSON（`content_json`）的后端模块：revisions（anchors.py、protection.py）、format_revisions、assistant_sessions、tasks/evidence.py、jobs/service.py 与 workflows/document_inspection.py、document_sources、parsers/materials.py、exports（render.py、change_record.py、jobs.py）、reviews/scope.py。

## 定稿契约
- **正文快照 schemaVersion 2**（存于 `document_versions`）：
  `{schemaVersion: 2, model: DocsModel, protections: [{id, kind: "number"|"citation"|"formula"|"lock"|"object"|"source", anchor: {node, start?, end?}, binding?}], chapters: [派生：{id: 标题块id, level, title, ...}]}`
  - 偏移一律 Unicode 标量；整块保护省略 start/end。
  - 章节由标题块重算，章节 ID = 标题块 `id`。
  - 图片字节移出模型，存内容寻址表 `document_resources`（sha256），模型以 `uri` 引用，API 为编辑器与边车解析。
- **保存**：客户端提交完整模型 + 版本 CAS（同现状），保存不依赖边车。服务端：按 MuffinOffice 模型 JSON Schema（随供应快照）校验所支持子集 + ThesisPilot 上限；保护保持校验（每个基版本保护仍存在且文字一致，`protectFormatting` 时格式一致；保护块不可删除）；DOCX 来源文档校验来源守卫（标记不可编辑的节点不变）。
- **浏览器**：`DocsEditor` + `EngineClient`（office-wasm）仅用于 `docs_preview_context` 与打开模型校验；`beforeTransaction` 执行只读/来源策略；`overlays` 显示候选差异与评审命中；正式导入导出不在浏览器做。
- **后端（候选权威）**：`modules/documents/docs_ops.py` 最小操作子集 `replace_text`、`set_inlines`、`set_heading_level`、`set_para_props`（白名单字段）、`apply_style`、`insert_block`、`replace_block`；以 MuffinOffice 144 条金标 `packages/vue/tests/fixtures/doc-ops-conformance.json` 测试；另加 vitest 交叉校验 Python 输出与 WASM `txn`/`validate_project_model`。候选采纳在一个 DB 事务内原子完成。
- **边车**（`providers/office_server.py`，bearer token 只在后端）：DOCX 导入 `/v1/parse` + `/v1/docs/inspect include=[irMap,index]` 绑定节点↔源路径；保留原件导出 `/v1/docs/transactions`（基于存储原件，按 irMap 映射逐节点文字差异；开启修订得到带修订的 DOCX 作为修改说明）；PDF `/v1/pdf`。空白起稿（无原件）的文档用 office-wasm 的 Node 运行器重建 DOCX（随供应快照，worker 调用；需 Node，写进运行说明），再走 `/v1/pdf`。
- **候选**：内容候选 `{base_version, node_id, start, end(标量), expected_text}`，限单段/标题内文字 run，不跨原子；`protection.py` 从 UTF-16 改为标量。格式候选由 `editor_path` 改为 `node_id`（标题级别、对齐、样式）。引用候选插入标记 run（成为绑定文献记录 ID 的 `citation` 保护）并在参考文献标题下追加条目块。所有采纳 CAS `expected_document_version` 后生成新版本；客户端重载模型（清空编辑器撤销栈）。
- **锁与未解析对象**：`aiLock` → `lock` 保护；导入丢失的对象 → 映射段落的整块 `object` 保护，纸面显示标记；原件保留真实对象用于导出。
- **迁移（显式、版本化、只追加）**：Alembic `20261119_0020`：`schema_version IN (1,2)`、来源新值 `schema_upgrade`、表 `document_schema_upgrades`（文档、起止版本、转换器版本与 SHA、损失报告、唯一 command_id）、`revisions`/`format_revisions` 加 `content_schema_version`、来源守卫 v2 合同、`document_resources` 表；不改写既有行。转换器 `documents/legacy_v1.py` 确定性：段落、标题（级别；chapterId→id；templateAlign/templateWeight→props）、列表、表格（合并；px→EMU）、blockquote→quote、codeBlock、分隔线、硬换行、marks→InlineProps、aiLock→保护、DOCX 占位→object 保护；非标题 ID 由（文档、版本、路径）哈希派生 ULID 格式。不变量：逐块拼接文字相等、章节 ID 保持、保护文字相等、幂等、v1 子集损失报告为空。升级命令 `POST /documents/{id}/schema-upgrade {command_id, expected_version}`（写作页提供入口），追加 N+1 版为 v2，并由 v1 可编辑路径与转换器路径→节点映射建立 v2 来源映射；v1 上未决候选经正常版本检查变为过期。旧版本按原样可读，`?as=v2` 内存转换只读预览（标 `converted:true`）；导出与修改说明按 schema 版本分派；回退到 v1 目标时先转换再追加 v2 版本。
- **供应（vendoring）**：`apps/web/scripts/vendor-muffin-office.mjs --from <mo 目录> --rev cfb8352`：核对来源树与 rev；用 ThesisPilot 自带的 Vite 配置把 `@muffin-office/core`、`@muffin-office/vue` 构建为 `dist/`（ES 模块 + .d.ts，入口 `docs-editor` 与 `core`），使 ThesisPilot 的 vue-tsc/lint 不编译 MuffinOffice 源码；构建 office-wasm（`--target web --release`）；写 `apps/web/vendor/muffin-office/VENDOR.json`（rev、rustc/wasm-pack/node 版本、每个文件 SHA-256），复制 NOTICE、一致性金标与模型 schema；`--verify` 重建比对。`pnpm-workspace.yaml` 加 `vendor/muffin-office/*`。`vite.config.ts`：`worker.format: "es"`，vendor 排除出 optimizeDeps/fmt/lint，WASM 由 `public/mo/pkg` 提供；基址补丁以 `vendor/muffin-office/patches/*.patch` 记录。编辑器不进入设计展台单文件构建。许可：MuffinOffice 为用户本人专有软件；公开源码包只含构建产物 + `LICENSE-GRANT.md`（用于 ThesisPilot 与赛事评审、不得再分发），不含 TS 源码、服务镜像与许可文件。
- **默认取舍**：公式/域缺失→整块 object 保护 + 保留原件导出；导出对话框提供“保留原件”（格式变化列入修改说明）与“重新生成”（附损失报告）；旧文档逐个显式升级、绝不在启动时自动；正式工作区在 B、C 完成后移除 Tiptap，设计展台保留；论文样式采用导入的逐段格式。

## 上游需求（提交给 MuffinOffice，不由本会话实现）
`/v1/docx` 支持 `docs-model/1` 输入（模型→DOCX）与模型校验端点；公式/VML 不透明占位；WASM 资源基址可配置；开放约束的 `thesis` 主题。
