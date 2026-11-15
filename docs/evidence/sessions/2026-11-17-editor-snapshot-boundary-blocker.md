# 正文快照重载丢失未知属性：停工与修订方案

日期：2026-11-17（Asia/Shanghai）。基础提交 `19e0b09209798130690e1449e0d72963c11f543a`，正文实现仍与 `f964ebb` 相同。状态：发现设计缺陷后停止施工，修订方案待用户确认；未实施修复，不标记 SG-01/02 或产品 AC 完成。

## 已复现的问题

SG-02 子代理在自制快照的普通段落上添加未声明属性 `preservedSourceId`。生产 `validateEditorSnapshot` 接受该快照；`nodeFromJSON().check()` 也通过，但重载后该属性消失。

位置：`apps/web/src/lab/state/editorAdapter.ts` 的 `validateEditorSnapshot` 与 `loadEditor`。当前校验只检查部分已知属性值，没有拒绝节点和 mark 的未知属性；编辑器 schema 解码又会丢弃未声明属性。两者共同造成“通过校验”不代表“能完整重载”。

主代理于 2026-11-17T14:18:53+08:00 前完成独立复跑并查看截图，入口是 `tests/docx/editor.html`，调用生产 `loadEditor` / `captureEditor`，浏览器 Chrome `157.0.8103.79`。命令 `node work/sg-02/stage1-boundary-repro.mjs coordinator` 退出 0，输出 `status=defect-reproduced`；这表示复现完成，不表示功能通过。

| 自制输入 | 实际行为 |
|---|---|
| 已支持的标题、中文及非 BMP 字符 | 保存再载入一致：`normalReloadIdentical=true` |
| 未知节点 | 拒绝且保留原文：`rejected=true`、`previousPreserved=true` |
| 段落未知属性 | 未拒绝、替换正文且丢弃属性：`rejected=false`、`previousPreserved=false`、`candidateAttrPreserved=false` |

本机原件位于 `work/sg-02/stage1-boundary-repro.coordinator.input.json`、`.result.json`、`.normal.png`、`.unknown-attrs.png`，复跑脚本同目录。复跑需使用未占用的标签，如 `node work/sg-02/stage1-boundary-repro.mjs review-2`，避免覆盖已有证据。子代理脚本整理时发生的两次 ESM/CJS 启动失败保留在原始执行记录，之后成功复现。

证据仅来自自制数据，未发现或检查真实论文是否受影响。DOCX 原件保留及导出校验是另一层机制，不能由此断言 DOCX 原件被修改。

只读调用链定位：`previewBackup.ts` 对当前稿、历史及导入备份复用此校验；`previewWorkspace.ts` 保存结构快照；`ScreenWrite.vue` 虽保存结构，当前初始化、历史恢复及激活仍从 HTML 载入。最后一项尚未在正式页面复现数据丢失，不能把独立入口的结果直接扩大为正式写作页实测结论。

影响 SG-02 的结构支持边界，以及下游 SG-03 的正文持久化合同、SG-04 的版本和保护事务。SG-03/04 尚未认领或实现。所有实施已停止，允许继续的工作仅为复现、保存现场、记录证据和准备待确认方案。

## 待确认的最小修订

将 SG-02 的范围扩至生产快照边界，而非仅在独立 DOCX 小样补检查：

1. 从正式写作台实际启用的节点、mark 与属性确定唯一支持清单，校验 schema 版本、层级、属性类型和值。未知结构或属性整次拒绝，不静默忽略。
2. 替换当前编辑器之前完成所有检查；识别但无法无损重载的结构也拒绝。仅允许明确声明的默认值补齐，不能删除或改变输入中已有字段。
3. 正式写作页、历史恢复、备份及本地工作区使用同一门槛，优先读取有效结构快照。对已支持的旧快照保留兼容路径；旧 HTML 数据采用明确的一次兼容转换并保留原件。不支持的结构保持原件和当前正文，返回可理解的失败及恢复操作，不自动回退 HTML 或迁移覆盖。
4. 正文内容与章节身份是持久事实；章节位置、统计等派生索引由受支持内容重新计算。冻结 SG-03 合同前明确章节身份、选区位置单位、中文及非 BMP 字符边界。
5. 继续保持本阶段单文本块修订边界；正式 DOCX 导入导出、原件存储及复杂对象编辑仍属后续施工单。

拟新增实施文件：`apps/web/src/lab/state/editorAdapter.ts`、`previewBackup.ts`、`previewWorkspace.ts`、`apps/web/src/lab/screens/ScreenWrite.vue`，对应单元及浏览器回归；生产编辑器扩展定义如需拆出，先登记具体路径。复用现有页面布局与反馈组件。共享类型、接口、迁移仍由主代理统一处理。本次不修改这些实现。

## 恢复施工后的验收

- 合法快照保存、加载、再保存内容与章节身份一致，中文、非 BMP 字符、表格和已有保护标记不退化。
- 未知 schema、node、mark、属性、无效父子结构均明确拒绝；拒绝前后正文、选区和版本保持不变。
- 校验器和真实写作编辑器在支持范围上保持一致；不能只用独立小样的简化 schema 验证。
- 旧备份合法数据仍可恢复，未知数据失败时保留备份和当前项目；失败不提示保存成功。
- 继续 SG-02 原有的撤销、跨段选区、对象支持矩阵与真实中文输入检查。自动文本注入不能计为系统输入法验证。
- 主代理实际复跑及查看界面；完成上述条件才允许 SG-03 认领。30 组保护样例的人类确认仍留在 SG-04 验收。

## 现场与收工

- 已推送认领提交：`19e0b09209798130690e1449e0d72963c11f543a`；远端 main 已实证同位，仓库 PRIVATE。
- 停止前仅修改三份规范：`DESIGN-SPEC.md`、`page-functional-design.md`、`frontend-integration.md`。保留用户已确认的前端要求，不回滚或覆盖。
- 业务代码未修改，数据库未变更，模型接口未调用。前后端整套基础门槛与阶段业务验收尚未执行，不将历史结果计为本轮通过。
- 主代理已独立复现并查看实际截图，结果见上表；原始对话及工具执行按聊天证据归档，凭据留在本机受控原件。待用户确认本修订后才恢复施工。
