# 正文快照结构合同

本合同用于 SG-02 的生产编辑器边界和 SG-03 的持久化前置设计。正式写作页与 DOCX 小样共用 `editorSchema.ts`；校验、准备、采集和加载入口位于 `editorAdapter.ts`。本合同不是已实现的正文服务端 API，也不代表完整产品验收通过。

## 格式与唯一内容来源

保持现有快照格式：`{schemaVersion: 1, json, chapters}`。未知版本和顶层字段整次拒绝；不改变项目备份外层格式。

- `json` 是受限 Tiptap JSON，保存正文、格式及标题的 `chapterId`。
- `chapters` 是派生索引。输入先校验条目结构，准备或采集时根据正文重算标题、层级、位置、范围和字数，不使用过期索引覆盖正文身份。
- 已有非空 `chapterId` 原样保留；重复身份拒绝加载。新编辑产生的标题由共享扩展分配身份。
- 旧快照没有身份或值为 `null` 时，普通校验及规范化不生成身份。只有显式的首次兼容或新内容初始化调用 `prepareEditorSnapshot(value, {assignMissingChapterIds: true})` 才分配；调用方保留原始数据并保存本次返回值。后续重载不再次分配。

正文内容版本、快照结构版本和项目元数据版本分别管理。SG-03 不应把整个本地项目对象或派生目录索引作为正文内容事实。

## 支持的节点与属性

结构来自正式写作页使用的 StarterKit、TableKit、`AiLock`、`StableChapterIds` 和 `HeadingFormat`，通过 `createEditorExtensions()` 统一启用。

| 节点 | 允许的属性 |
| --- | --- |
| `doc`、`paragraph`、`blockquote`、`bulletList`、`listItem`、`hardBreak`、`horizontalRule`、`table`、`tableRow` | 无 |
| `heading` | `level`：1–6；`chapterId`：非空且不超过 200 字符，或尚未分配的 `null`；`templateAlign`：`left/center/null`；`templateWeight`：`600/700/null` |
| `orderedList` | `start`：1–10000 的整数；`type`：`1/a/A/i/I/null` |
| `codeBlock` | `language`：字符串或 `null` |
| `tableCell`、`tableHeader` | `colspan/rowspan`：1–10000；`colwidth`：与 colspan 同长的非负安全整数数组或 `null`；`align`：`left/center/right/null` |
| `text` | `text` 必须是非空、UTF-16 完整的字符串；无节点属性 |

允许 `bold`、`italic`、`strike`、`code`、`underline`、`aiLock` 和 `link` 标记。前六种没有属性；`link` 仅允许 `href/target/rel/class/title`，链接地址限 `http://`、`https://`、`mailto:` 或片段地址，拒绝空白、控制字符及其他协议。标记重复、互斥冲突和错误的父子关系由同一生产 schema 检查。

缺省属性按该 schema 补齐。省略的空 `content/marks/attrs` 与显式空容器按已声明的空默认值处理；除此之外不删除、合并或改写输入字段。输入含相邻且会被解析器合并的同格式文本节点时，因无法保持原结构而拒绝。

所有层级都拒绝未知字段，包括 node、mark、attrs 和章节条目。节点总数和章节条目数上限各为 100000，节点递归深度上限 80。表格在分配网格前限制投影槽位，随后校验完整网格；会被编辑器自动修补的错位、缺格或越界合并不作为合法快照。

## 准备与原子替换

| 入口 | 行为 |
| --- | --- |
| `validateEditorSnapshot(value)` | 返回真假；执行属性、层级、生产 schema 和可逆检查；不修改输入、不生成身份 |
| `canonicalEditorJson(json)` | 返回独立副本，补齐合法默认值；用于内容比较，不分配身份 |
| `prepareEditorSnapshot(value, options?)` | 返回规范快照并重算章节索引；仅显式选项可初始化缺失身份 |
| `captureEditor(editor)` | 从实际编辑器内容采集并执行统一校验，返回规范快照 |
| `loadEditor(editor, snapshot, options?)` | 先完成统一检查，再使用目标编辑器实际 schema 二次验证可逆性，最后一次替换正文；返回本次准备好的快照 |

加载之前必须已有所有标题身份。反序列化和再序列化须与规范 JSON 完全一致；合法类型名不等于无损。校验失败不得发送编辑事务，因此正文、选区及由正文更新事件驱动的版本不变。

加载事务使用编辑器已有的 `skipTrailingNode` 和 `preventAutolink` 标记，避免把保存的内容在重载时自动补成尾段或链接。普通编辑行为保持原有规则。首次恢复可明确传入 `{emitUpdate: false}`，不发出正文更新事件，也不把恢复写入撤销历史。

## 旧 HTML 的显式兼容

`convertLegacyEditorHtml(html)` 是显式转换入口，不是结构校验失败后的回退。转换仅接受已支持的元素、属性和格式；拒绝未知标签、属性、重复属性及无法完整表达的样式。调用方必须保留原 HTML、旧结构、时间和历史，再按工作区的兼容接口挂载转换结果。

转换允许既有标签别名、属性顺序和内联标记顺序的等价表达，保留模板标题格式与 AI 锁定。表格列组及表格宽度仅在与已知单元格数据的派生结果相符时作为派生信息处理；无法映射的列宽不能静默丢弃。解析前后对比语义结构，只有一致时才生成新快照及缺失章节身份。

已有结构优先于 HTML。已有结构不受支持时保留原数据并失败，不读取 HTML 覆盖它。没有结构的旧记录必须走明确的一次兼容；不能仅因屏幕显示了正文便宣告转换或服务端保存成功。

## 选区与跨端边界

选区必须绑定正文身份和基础内容版本。位置单位是 ProseMirror 的 UTF-16 位置：文本使用 JavaScript UTF-16 长度，容器还占结构位置。它不等于 Python 字符下标、视觉字数或 DOCX 路径。

现阶段补丁限同一文本块，不允许跨段或跨格。适配层在执行补丁前检查文本边界与替换内容，拒绝切开代理对或引入孤立代理字符。中文和非 BMP 字符的保存/重载验证不等于系统中文输入法组合与候选操作验收。

DOCX 小样的对象占位不携带原始图片、公式或未知 XML。其保真依赖同一原件、原件指纹、映射及导出时的局部补丁检查；不能将仅有 JSON 的快照当作完整 DOCX 恢复包。详见 [DOCX 小样边界](docx-roundtrip.md)。

## 验证入口

在 `apps/web` 执行：

```powershell
vp test run tests/unit/editorSnapshot.test.ts tests/unit/writing-contracts.test.ts tests/unit/writing-guards.test.ts
```

`tests/docx/editor.html` 是使用生产 schema 的浏览器检查入口，可检查快照重载、旧 HTML 转换、选区和撤销。该入口的 `load` 明确初始化新导入内容的缺失章节身份。正式写作页、历史、备份、本地恢复、真实输入法及后续服务端行为仍须按对应施工单实际操作验收，不能用本合同或单元测试数量代替。
