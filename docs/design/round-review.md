# 评审空间：功能设计与实现轮次

日期：2026-11-14（Asia/Shanghai）。需求 F14，关联 AC-018（仅评审）、AC-010（失败、取消、重试）。属于完整 Vue 设计预览，真实模型与学校评分未接入。

## 实现前功能设计

| 功能 | 入口与输入 | 输出与状态 | 跨页与验收 |
|---|---|---|---|
| 发起独立评审 | 评审页「新建评审」；整篇/当前识别章节、量表版本 | 固定文稿、模板、要求、量表版本与输入原文；等待→运行→完成/部分完成 | 发起及运行不改正文或计划；AC-018 |
| 可解释报告 | 摘要、分项参考评分、严重程度筛选、依据与建议 | 只按实际取得的文字做确定性预览检查；模拟分与未检查项明确区分 | 不能判定不补分，不产生教师认可；AC-018 |
| 定位与后续修订 | 问题项「定位到正文」「请求修订候选」 | 跳到对应章节；修订仅带入目标，不自动改稿 | `/screens/write?chapter=...&review=...&goal=...`；AC-018 |
| 历史与旧稿 | 左栏选择历史；报告版本/输入快照；对比上一份 | 当前正文变化后显示旧稿；对照版本、范围、问题数与字数 | 历史不可追改；AC-018 |
| 异常与恢复 | 可展开的状态预览：正常/部分/超时 | 排队/运行可取消；失败保留输入和历史，可按原快照重试；迟到结果忽略 | AC-010；跨项目运行不得写入其他项目 |
| 报告导出 | 当前报告「下载报告」 | 下载真实可打开的 HTML 报告，包含版本、规则、问题和未检查项 | 无 DOCX/PDF 假下载；AC-018 |

布局：沿用 `screen-page`、`screen-heading`、纸面面板、TpButton/TpField/TpStatus，以及 ReviewSummary / IssueItem。桌面历史侧栏+报告主体，窄屏纵向；页头统计数统一 32px。评审结果是信息和建议，不使用学生采纳印章。

数据：`usePreviewModule("review", factory)` 按项目隔离。报告保存输入快照和实际检查结果；定时器与浏览器对象不进入项目数据。默认已有一份由当前自制样例输入构造的明确预览报告。用户输入不进入 Git 或日志。

可执行验收：创建整篇和章节报告；核对正文版本保持不变；运行中取消后无新报告；超时后按原输入重试；修改正文再回访显示旧稿；严重程度筛选可恢复；HTML 下载包含当前所选报告；390px 页面无横向溢出。

## 实现与自检

已实现 `ScreenReview.vue` 与 `reviewState.ts`，按项目隔离；报告真实保存输入文字与版本，重试沿用原快照，取消后迟到结果不产生报告。提供 HTML 下载、报告历史与元数据对比，旧稿定位前明确提示将打开当前同名章节。新空项目没有样例报告。

新增 `review-state.test.ts` 验证快照隔离、HTML 转义、损坏备份拒绝与部分完成；`review-complete.spec.ts` 覆盖章节/下载、取消/失败重试、部分完成/窄屏及正文更新后的旧稿提示。

已执行：

- `vp test run tests/unit/review-state.test.ts`：退出 0，1 个文件、4 项测试通过（429ms）。
- `vp lint src/lab/screens/ScreenReview.vue src/lab/state/reviewState.ts tests/e2e/review-complete.spec.ts tests/unit/review-state.test.ts`：退出 0。
- 定向 `vp fmt` 后 `--check`：通过。未格式化其他会话文件。
- `vp exec vue-tsc -b`：最初因新增单元测试引入 NodeNext 的相对导入要求失败，已改为相对路径与显式 `.ts`；复测退出 0。并行开发中的他页错误不计为本模块缺陷。
- 浏览器 E2E：统一构建后，以 `PLAYWRIGHT_CHANNEL=chrome`、`PLAYWRIGHT_FILE=dist/thesispilot-design-lab.html` 执行 `vp exec playwright test tests/e2e/review-complete.spec.ts --workers=1 --output=test-results/review-round`。首轮 3 通过、1 失败：测试按标签精确匹配受必填星号影响，未定位到已有控件；改为按 combobox 的可访问名称定位，应用代码无需修改。
- 同一构建复测，输出改为 `test-results/review-round-retry`：退出 0，**4 项通过（19.1s）**。验证了章节输入固定、真实 HTML 下载、筛选/对比、取消抑制迟到结果、超时保留输入并重试、部分结果、390px 无溢出和正文更新后旧稿提示。
- 只评审无写入复核：测试先记录计划版本及任务列表，完成评审与导出后回到计划逐项比较，完全一致；正文版本也保持一致。代码仅新增报告和通知，不调用文稿或计划写入方法。
- `scripts/shot.ts --file ... --route /screens/review --theme zhumo --motion reduced --hideDock --channel chrome` 实际输出 `test-results/review-round/review-desktop.png`（1440×1100）和 `review-mobile.png`（390×1000），已目视检查：共同外壳/令牌、32px 统计、桌面两栏、窄屏堆叠正常，未见遮挡或页面横向溢出。其他主题由主会话统一视觉回归。

未接入真实模型、文献核验和学校评分；只有标题识别驱动明确标注的预览分，其他评分留空。此轮不代表正式产品 AC-018 通过。本文为真实迭代摘要，不是完整原始 Prompt 链；未提交或推送。

最终集成补齐未绑定模板/要求的显示与报告说明；四项评审浏览器回归和统一检查见[集成自检记录](../evidence/sessions/2026-11-14-complete-designs.md)。
