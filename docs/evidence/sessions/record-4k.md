# W-F 4K 正式页面录屏、中文配音与同步字幕

日期：2026-11-20（America/Los_Angeles）。施工单：W-F。基线：`912eb26bc35b32201fa8c7d3204c0b98da32aeae`；认领提交：`c367f341ff02060f197b28c20a04edd85db31612`。本轮未派发子代理。

## 范围与真实环境

- 复用 `work/product-ui-test` 中既有 Docker 服务和合成数据，入口 `http://127.0.0.1:28190`；没有新建或重置实例，没有使用 `work/sg22-env` 中的真实论文实例。
- 使用 `apps/web/scripts/capture-competition.mjs` 的真实 Chrome 页面录制，访问口令只从既有进程环境映射，不进入录像、日志或 Git。
- 实例实际没有模型凭据；第 07 段只验证 `MODEL_NOT_CONFIGURED`、原消息与固定输入重试，不冒充模型调用成功。第 04 段是确定性模板试跑，明确未调用模型、未写正文。
- 录屏增加 `TP_COMPETITION_WIDTH` / `TP_COMPETITION_HEIGHT`，本轮为 3840×2160；默认 1920×1080 保持不变。新增 `scripts/produce_competition_video.py`，只接受整体及逐场景均通过的清单。

## 当前页面的最小录制适配

- MuffinOffice 纸面改用真实键盘输入，多行正文逐行核对；空白稿按 v1 → 显式升级 v2 → 首次保存 v3，冲突另一窗口保存为 v4。
- 对齐当前写作副驾、审阅页签、冲突对话框、本机草稿菜单、配置台默认智能体页签、资料下载与版本记录、任务目标与证据控件、内容助手固定选区 `expected_text`。
- 安全格式先通过页面按钮把旧来源稿升级为新版编辑器，再执行候选决定、采纳、撤销和过期保护；来源合同按实际 `schema_version=3 / guard_version=source-model-v2` 核验，不再误用旧投影覆盖层。
- 旧 `06-document-source` 依赖已不存在的章节校正控件，本轮不纳入；没有为重拍视频伪造旧面板或绕过真实业务步骤。
- `4k-record-v1` 至 `4k-record-v5` 的选择器、版本及场景失败现场均保留，未剪入成功成片。最终同源整轮为 `4k-record-v6`，总清单及八个入选场景均 `passed`，每段均为 3840×2160 且播放校验通过。

## 最终八场景

| 场景 | 实际业务结果 |
|---|---|
| `01-writing-history` | 新建合成项目，输入正文，保存 v3，查看历史并刷新恢复。 |
| `02-structure-task` | 固定 v3 提交真实 worker，未保存草稿不混入，结构结果刷新恢复。 |
| `03-conflict-recovery` | 双窗口产生真实 409，载入 v4 并恢复保留的 v3 本机草稿。 |
| `04-configurations` | 四库 UI 新建、不可变版本引用和确定性试跑；无模型调用、无正文写入。 |
| `05-materials` | 合成 DOCX 解析为真实部分识别结果，公式受保护；下载原件字节及 SHA-256 与上传一致。 |
| `07-content-assistant` | 两个会话草稿隔离；缺凭据失败与固定输入重试均真实记录，无候选、无正文改写。 |
| `08-task-feedback` | 固定版本证据、旧证据复核、返工、人工解释、学生处理撤销及历史恢复。 |
| `09-safe-format` | 显式编辑器升级、逐项决定、部分接受采纳、撤销、过期保护和正式版本历史。 |

源清单：`work/competition-evidence/4k-record-v6/manifest.json`。八个源 WebM、场景截图、任务及配置 ID、失败重试结果均保留在该目录。

## 配音、字幕与成片

- Windows 本机 `Microsoft Huihui Desktop` 逐句生成中文语音；按实际 WAV 时长生成场景与全局 SRT。
- 最终目录：`work/competition-evidence/4k-record-v6/production-v2/`。
- 成片：`thesis-pilot-4k.mp4`；外挂字幕：`thesis-pilot-4k.srt`；画面内同时烧录中文字幕。逐场景 MP4、WAV、SRT、时间轴及源 WebM 均保留。
- 初版 `production/` 的 42 号字幕及 64 边距在 4K 缩放后遮挡画面，保留该现场但不作为最终交付；最终仅调整为 18 号字幕、20 底部边距和 1 像素轮廓，业务画面、配音及时间轴未改。

| 核验项 | 实际结果 |
|---|---|
| 时长 / 画面 | 198.121289 秒（3 分 18.12 秒）；3840×2160，H.264，20 fps。 |
| 音轨 | AAC，48 kHz，单声道；`mean_volume=-27.7 dB`，`max_volume=-0.5 dB`，不是空音轨。 |
| 字幕 | 16 条；顺序对应八场景，逐条文本和时间与 `production-manifest.json` 一致，无重叠。 |
| 文件 | MP4 为 27,968,229 字节；SHA-256 `a426b879479dba6fff961a5633367e3c12a6ece170946f1b814bad5d20325d93`。 |
| SRT | 1,648 字节；SHA-256 `869e89a7014f912b9f48428f5df12e71cfb1eccba4b8f319f0112be3bcd569fd`。 |
| Chrome 播放 | 实际解码 57 帧后推进到 `198.121289`，`ended=true`。 |
| 全片检查 | FFmpeg 全片解码无错误、无黑场区间；五张代表帧审阅确认底部字幕与正常片尾。 |
| 预览副本 | `thesis-pilot-4k-preview.mp4` 为 1280×720、2,100,028 字节，只用于核验，不替代 4K 原片。 |

机器核验位于最终目录的 `verification-ffprobe.json`、`verification-volume.txt`、`verification-srt.json`、`verification-playback.json`、`verification-blackdetect.txt`、`verification-decode.txt` 与 `verification-summary.json`。代表帧为 `check-intro.jpg`、`check-materials.jpg`、`check-assistant.jpg`、`check-format.jpg`、`check-tail.jpg`。

## 工程检查与边界

- `node --check scripts/capture-competition.mjs` 通过；`npx --yes pnpm@11.25.0 --dir apps/web exec vue-tsc -b` 通过。
- 仓库文档、聊天证据与展示一致性检查以本文件提交前的实际命令输出为准，见施工台账最终登记。
- 本轮没有修改业务代码或放宽业务断言，也没有补跑并冒记 W-E 的全量页面矩阵。真实模型成功、完整 19 项产品 AC、公开部署和赛事提交均不因本片改判。
- 成片只有 3 分 18.12 秒，**不能声称已满足赛事 5—8 分钟要求，也不能把它算作至少 2 分钟真实 AI 编程协同录屏**。
