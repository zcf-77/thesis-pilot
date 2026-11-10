# 论文主工作区交互原型

本目录直接使用 Vue 3 + TypeScript + daisyUI 组件实现交互设计稿，可继续复用组件与样式，不需要从静态图片重写界面。设计与范围见 [工作区交互设计](../../docs/design/workspace-interactions.md)。Tiptap 仅用于本轮开源编辑内核小样，正式内核尚未确定。

## 启动与检查

前端工程统一由 Vite+ 管理。项目选择 `vite-plus` 1.6.0、底层 pnpm 11.25.0；Node 26.13.0 由 `.node-version` 交给 `vp` 管理。浏览器测试要求系统已安装 Google Chrome；Playwright 配置使用 `channel: "chrome"`，不会自动安装浏览器。

先安装 Vite+ 的 `vp` 命令，再从仓库根目录进入原型目录：

```powershell
cd prototypes/workspace
vp install --frozen-lockfile
vp dev
```

打开 <http://127.0.0.1:18743>。端口固定且启用 `strictPort`，端口被占用时启动失败。

在原型目录执行：

```powershell
vp run check
vp build
vp run test:e2e
```

`vp run check` 调用 Vite+ 的 `vp check`，并执行专门的 Vue 类型检查；`vp build` 生成 `dist`。`vp run test:e2e` 调度 Playwright 浏览器流程，按配置启动或复用本地原型服务。`vp test` 是 Vitest 入口；当前没有单元测试，不将空测试集计为通过。这些命令不代表正式应用的 19 项 AC 已通过，实际运行结果另行记录。

Vite+ 工具链迁移与验证仍在执行，见[迁移记录](../../docs/evidence/sessions/2026-11-11-viteplus-toolchain.md)。

当前原型尚未分包，初次构建出现约 546 kB 的 JavaScript chunk 警告；后续根据正式应用路由和加载方式再处理，不把此体积当作已优化结果。

截图位于仓库根目录的 [work/design](../../work/design)，包含写作、双面板、评审及移动端状态；该目录不是本原型下的子目录。

## 组件复用边界

`src/App.vue` 组合工作区；`src/types.ts` 定义 props、会话、选区、候选及报告结构。展示组件通过 props 接收状态、通过 emits 提交意图，服务与样例数据不嵌入展示组件。

| 组件 | 输入与职责 | 事件或操作边界 |
| --- | --- | --- |
| `WorkspaceHeader.vue` | `title`、`saved`、`focused`、`assistantOpen`；项目标题、保存状态与入口 | `toggleFocus`、`toggleAssistant`、`toggleOutline`、`review` |
| `DocumentOutline.vue` | `items`、`active`、`completed`；章节目录与当前状态 | `navigate(title)`、`review` |
| `EditorToolbar.vue` | `editor`；格式、表格、撤销与重做 | 格式操作调用传入的 Tiptap 实例；`toggleOutline` 向外通知 |
| `PaperEditor.vue` | `editor`、标题、选区文字、字数、版本与章节状态；正文展示 | `revise`、`ask`、`clearSelection`、`complete` |
| `AssistantWorkspace.vue` | 模式、布局、两侧角色、消息、选区、候选与报告；组织辅助面板 | `update:*`、`close`、`send`、`revise`、`accept`、`reject`、`review`、`locate`、`downloadReport` |
| `AgentPanel.vue` | `role`、`messages`、`selectionText`；单个助手会话与输入 | `send(text)`、`revise`、`review` |
| `RevisionReview.vue` | `candidate`、`stale`、`error`；原文与候选对照 | `accept`、`reject` |
| `ReviewReport.vue` | `report`；问题、示例评分和未检查项 | `locate(section)`、`download` |
| `MilestoneNotice.vue` | `chapter`；章节完成后的建议 | `review`、`later`、`dismiss` |

`src/composables/useWorkspace.ts` 协调编辑器实例、选区与版本、面板和会话状态、候选采纳、报告、章节完成及浏览器草稿。它通过 `useWorkspace(service)` 注入 `AssistantService`；正式接入时可替换服务实现，并逐步将业务状态迁往正式接口，保留组件接口。

`src/services/prototypeAssistant.ts` 是明确的固定样例适配：会话按角色返回预置文字，修订只做确定性的措辞替换，评审返回固定报告；没有真实模型、检索或外部请求。`reply`、`revise`、`review` 是可替换接口，不应把样例输出计作 AI 效果证据。

`src/fixtures/demoThesis.ts` 为自制论文样稿，不是真实学生论文、实验结果或已核验文献。后续样例应继续与展示组件分离。

正式项目复用时，保留 `types.ts` 及各组件的 props/emits 合同，加载 `style.css` 中的 daisyUI 主题和工作区样式，并按锁文件对齐 Vue、Tiptap、Lucide 依赖。只有编辑区和工具栏依赖 Tiptap 实例；AI 会话、审阅、报告与通知组件不依赖具体编辑内核。模型服务、数据库版本和服务器授权仍须在正式应用实现，不能将原型里的客户端检查当作服务端保护。

## 迁移前验证

2026-11-11 工具链迁移前：`npm run check`、`npm run build` 均退出 0；Playwright 为 **8 passed（9.4s）**。首轮有 1 项窄屏按钮可访问名称失败，补充明确标签后复测通过；完整记录见[本轮证据](../../docs/evidence/sessions/2026-11-11-workspace-prototype.md)。构建仍有约 547 kB 单块提示，没有隐藏该提示或宣称完成加载优化。

## 当前限制

正式 FastAPI 后端尚未实现。`localStorage` 仅保存此浏览器的样稿与部分状态，不提供服务端持久化、备份恢复、并发控制或数据库原子事务。

修订保护只覆盖单个段落内未加格式的纯文本选区，检查选区基础版本、原文一致性，以及有限的数字、方括号引用和公式符号。跨段、带格式或复杂对象不进入该修订小样；这不等同于正式的公式、锁定句、复杂文档保护能力。

正文可编辑不代表具备 DOCX 导入导出、分页或保真往返能力。本原型不接入 MuffinOffice，也不实现正式计划、资料解析、四库管理及真实模型调用；浏览器交互验证不替代产品验收。

## 依赖与许可

以下版本来自本目录 `package.json` 和实际已安装包的 `package.json`；许可证字段按实际元数据记录。

| 依赖 | 版本 | `license` |
| --- | --- | --- |
| Vue | 3.5.45 | MIT |
| Tiptap：`@tiptap/vue-3`、`starter-kit`、`extension-table`、`pm` | 3.33.1 | MIT |
| ProseMirror：`prosemirror-model` | 1.25.13 | MIT |
| ProseMirror：`prosemirror-state` | 1.4.4 | MIT |
| ProseMirror：`prosemirror-view` | 1.42.9 | MIT |
| daisyUI | 5.7.50 | MIT |
| Lucide：`@lucide/vue` | 1.72.0 | ISC |

本轮使用开源 Tiptap StarterKit 和 TableKit，未使用付费扩展。Lucide 当前安装包声明 ISC，不能记为 MIT。上表仅列实际核对过的包，不推定全部传递依赖采用同一许可；正式分发仍需保留各依赖相应的许可与版权声明。

工程选择：Vite+ 1.6.0 统一集成管理 Oxlint 1.93.0、Oxfmt 0.78.0、Vitest 5.1.0；底层 pnpm 11.25.0。TypeScript 6.0.3、Tailwind CSS 4.3.5、Playwright 1.65.0、vue-tsc 3.3.14；完整依赖以 `pnpm-lock.yaml` 为准。上述工具链的迁移验证结果以迁移记录为准。
