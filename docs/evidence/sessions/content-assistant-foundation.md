# 内容助手会话与真实运行基础

SG-08A，2026-11-18 UTC+08。基础交付SHA `109cc597e666c625fe97eb05306e75f61a6095a5`，认领已推私有main并核实 `56d96fb0d2d4d23766536e4ce425cf4b9a05a081`。唯一状态见[施工台账](../../engineering/construction-orders.md)。本轮先完成已保存非空选区的内容修订，不把全文问答、五专业、复杂多步骤或整个SG-08算作完成。

## 功能与验收映射

| 功能 | 入口、操作与输入 | 结果、恢复、跨页 | 必要验收 |
|---|---|---|---|
| 持久会话 | 正式写作页新建/选择内容会话、改名/归档，多面板 | 消息是服务端事实；面板关闭不取消任务 | 刷新恢复、项目隔离、CAS冲突 |
| 独立输入草稿 | 每服务/项目/会话独立本机草稿 | 未发送不进入正式消息；失败保留输入 | 两会话不串草稿，恢复标明本机 |
| 明确上下文 | 已保存选区、目标、智能体版本、显式资料原件/解析/锚点、项目绑定版本 | 服务器冻结范围、来源、配置，不能静默切最新版 | 陈旧/跨项目/失效来源拒绝，资料不能改变权限 |
| 真实运行 | 用户发送后原子保存消息、运行、候选、Job/outbox | worker调用既有受限DeepSeek适配；缺凭据真实失败并可重试 | 状态与Job一致、输入幂等、故障回滚 |
| 结果与审阅 | 真实输出reply/replacement，经服务器保护检查产生候选 | 范围及before由服务器产生，显示差异和保护依据 | 不接客户端假模型结果；失败/取消迟到不能产候选 |
| 取消/重试 | 真实服务端取消；从旧运行固定输入重试 | 新run/新job、关联旧run；正文/绑定漂移要求重新提交 | token/CAS、不能复用旧run_id形成孤儿任务 |
| 采纳门槛 | model_run候选保留审阅，明确未开放原因 | 后端保护门槛阻止写稿，不接受前端绕过参数 | SG-04独立依据及签核未完成前不冒记开放 |

空白、加载、失败、取消、过期、冲突和未知响应均保留明确状态及恢复动作。本次单步内容运行没有部分完成产物，不伪造复杂多步恢复；SG-21B另跟随真实多步骤联验。

## 冻结契约与所有权

- 会话`/projects/{pid}/assistant-sessions`，版本控制改名/归档；消息按seq升序不可变。每会话最多一个queued/running运行，关闭面板与导航不取消后台任务。
- `POST .../assistant-sessions/{sid}/runs`固定command_id、expected_session_version、purpose=content_revision、document_id/version、既有RevisionSelection、goal、显式material_sources、agent_config_version_id和source_binding_version_id。当前无项目绑定时才允许null，不能省略已有绑定。
- `GET .../assistant-runs/{rid}`和`/context`返回任务事实与固定来源，不含凭据；cancel/retry有幂等命令。重试生成新run/job，复用旧用户消息并保留source_run_id，不重复发消息或静默改上下文。
- 模型仅返回严格JSON的reply/replacement；内部修订helper从固定选区生成补丁，保护检查不靠提示词。公开旧proposal接口不得给model_run注入伪模型结果。正式稿写入只经既有受控命令。
- Session/Message/Run归会话后端，Job/worker归运行后端，Revision model_run及事务helper归修订整合者；正式UI、HTTP/Mock和真实PG测试各自独占，root维护迁移0011、注册、生成、台账与Git。
- 本机草稿独立于正式消息，不将旧previewFormalRevision确定性生成接到真实助手。Mock必须明确模拟，不做HTTP失败降级。没有凭据的失败录屏不能冒充真实模型成功。

认领Git动作首次被自动审批拒绝，理由为未见SG-08A明确授权；命令未执行。按要求读取用户2026-11-17 14:50:34 UTC原始持续施工指令后，对同一命令重试一次获准并核实远端；未改变安全策略、未委派绕过。实现与验证结果后续据实追加。

## 阶段实测与纠错

- 0011包含会话/消息/运行/命令，以及model_run候选关联。消息和命令不可变；输入、上下文、配置及已建立的任务/候选/回复关联不得修改。修订旧输入保护触发器扩展run_id；含助手数据时拒绝回退。先在随机独立PostgreSQL schema检查迁移，并回归既有来源导入：1通过、11未选（2.31s）。
- 助手真实PG首轮11通过、1失败（16.97s）：测试把排队回执的隐藏candidate_id误当成缺少数据库候选；修为回执null、真实Run/candidate关系存在且状态generating，原子表计数断言保留。定向复测1通过、11未选（2.57s）；12个不同场景都有实际通过结果。
- PG成功模型分支仅使用明确`TEST STUB`的typed completion，用来验证事务和保护；它不是供应商调用证据。覆盖并发busy/CAS、命令重放、明确来源、跨项目拒绝、取消迟到、固定重试及正文漂移、保护违规、采纳门槛、失败回滚与SQL不可变性。
- 修订owner专项21测试通过：model_run绑定不可伪造，公开proposal拒绝伪模型输入，服务器固定补丁范围与原文，取消/失败分离，模型采纳门槛及故障回滚。完整API/前端/桌面和本机真实worker结果待最终版本执行后填写。

## 最终工程与桌面结果

- 最终API完整检查448项通过（163.46秒），Ruff/mypy、OpenAPI与单迁移head0011通过。前端`vp run check`3/3通过，43文件490项测试通过，`vp build --mode workspace`成功，主产物`WorkspaceShell-DVbhZDLI.js`/`index-2TM1SVK5.js`。
- 同源真实Chrome内容助手桌面1项通过（11.6秒），既有来源导入/保护桌面1项通过（11.6秒）。使用真实PostgreSQL、Redis、Linux worker及dispatcher：两会话草稿独立，固定选区/配置/上下文，真实缺凭据失败，刷新恢复，新run重试同一输入且消息不重复、正文不变。没有把缺凭据当成功。
- 实际第七段视频`work/competition-evidence/assistant-v1/07-content-assistant.mp4`为1920×1080 H.264，29.338667秒，3,444,522字节，SHA256 `8d485f2b753791f933e441ff6c2c3ff5d897c13b2b4f96748a29a54ed97dab59`。Chrome播放及尾时间核验通过；源WebM29.278秒保留。两张过程截图及终态截图已生成并人工查看，明确显示MODEL_NOT_CONFIGURED。
- 视频四库准备通过真实API建立合成记录，manifest标记seededViaApi；会话/选区/发送/失败/重试均为实际UI操作。访问口令不入录像。七段素材不等于完整赛事成片，模型成功、正式模型采纳、全文问答、五专业、复杂多步仍未验收。
- 复现：先按本地运行说明启动已迁移0011的API/PG/Redis/Linux worker和dispatcher；构建workspace。设置仅进程内`TP_WORKSPACE_TEST_ORIGIN`/`TP_WORKSPACE_TEST_ACCESS_KEY`与`PLAYWRIGHT_CHANNEL=chrome`；`TP_WORKSPACE_TEST_MODEL_STAGE=missing`后在apps/web执行`vp exec playwright test --config playwright.workspace.config.ts assistant.integration.ts --output test-results/assistant`。录制另设`TP_COMPETITION_MODEL_STAGE=missing`、`TP_COMPETITION_SCENARIOS=07-content-assistant`及新输出目录，执行`node scripts/capture-competition.mjs`。缺凭据stage是可核验前提，存在凭据时不得使用该断言冒记成功。
- 提交映射：后端`9adc53f`，前端及实际录屏脚本`48c00a9`。推前fetch实无远端增量，迁移0011及新增错误码无远端冲突。文档校验100文件/492链接通过，其范围仅文档。

## SG-04 独立AI复核明细

本次协调者与只读代理另依据产品AC-005—008及“数字/引用/公式/锁定/范围不被材料指令改变”的约束，检查既有fixture，而非以测试通过反推预期正确。发现42主组实际为33个静态protection和9个scenario；27变体均为静态保护。Python和前端同源fixture测试过滤scenario，实际执行60个静态输入。

- 静态输入中普通文字替换与保护数字、引用、锁区、UTF-16完整字符、路径身份的允许/拒绝方向有独立依据；P05百分比空格、P06科学计数等值改写的拒绝依据是已声明的v1严格字面策略，不能宣传成数学数值不等；P16—20只是保守拒绝未知内容，不是公式解析成功。
- P33—40及P42共用同一初始文档、单条补丁、base=current=1和allowed=true，缺少时序步骤，不能作为9条完整场景证据。已有服务/PG/真实HTTP测试分别覆盖子集采纳、并发、CAS、取消、撤销及重启，但需按实际请求和断言关联，不能自动把这些fixture签为完整。
- P28仅有mixed bold/plain，没有文档所列跨表格单元格与hardBreak子例；P30仅单补丁删除`1 2`空白，不证明两补丁组合；P20未含文档另列DOCX占位，P23/P31部分子例也未完整入组。后续来源保护回归不能冒充这些原始组内输入。
- 因此仅记录“实际静态输入保护方向的AI复核”和已存在独立测试映射，不填写human_review，不宣称42组完整场景已确认，模型采纳门槛保持。精确错误码和规则名是实现契约，不能自身充当独立产品预期依据。
