# 比赛阶段交付：b748424

2026-11-18 UTC+08，应用源码基线为`b748424bf53da3a9022189d949d97d09ab325539`，私有main已fetch核实一致。后续仅补交付工具和说明；没有把当前阶段成果称为完整上线首版。

## 实际产物

- 本机正式预览：`http://127.0.0.1:18021/`，同源FastAPI提供workspace构建；`/health/ready`及入口各实际返回200。访问口令只在本机私密配置，未写入本文、Git或录屏。进程关闭后需按[复现说明](../../engineering/competition-reproduction.md)重启。
- 源码包：`work/competition-release/b748424/source-b748424.zip`，24,574,646字节，SHA256 `9cc3eb731f095bc4da53a04bdcc16866bc5cfda152ee17acb0f2051c1a8c61fd`。从固定Git提交导出，含uv锁、前端锁及0011迁移，不含work、.git、.env或.key。
- 正式前端包：`work/competition-release/b748424/workspace-dist-b748424.zip`，2,064,067字节，SHA256 `6dc34dc10349e53049be266185a7f5524dc49c45ce5a8f38ad28f05d6d7c4a9c`。19文件逐项摘要见同目录`artifact-manifest.json`，ZIP完整性和解压读回SHA均通过。
- 前端包是完整运行体系的一部分，需要Python3.13、锁定依赖、PostgreSQL、Redis、API、Linux prefork worker及dispatcher。工作区来源校验限定loopback，未实施公网发布，也不把配置中的production误称公开生产部署。
- 合成演示资料已用`apps/api/scripts/create_material_demo.py`在新目录独立重生成；DOCX 1,682字节，SHA256 `0433db562bcec61333351cde453241a130875a69517ed6bd6c172018c158be33`，与上传及实际下载原件一致。每次录制创建新合成项目，不依赖既有论文数据。

## 同版实际录屏

全部源视频位于`work/competition-evidence/release-b748424/`，以同一个正式构建及同版API/worker录制。七个场景均真实运行并通过断言，1920×1080 WebM均实际解码播放、核验尾时间与SHA；不是截图脚本替代视频。录制不包含访问口令，仅使用合成输入。

| 文件基础名 | 实际场景 | WebM秒数 |
|---|---|---:|
| 01-writing-history | 正式稿保存、历史与刷新 | 13.996 |
| 02-structure-task | 真实结构检查任务及产物 | 13.066 |
| 03-conflict-recovery | 冲突保留草稿与恢复 | 16.207 |
| 04-configurations | 四库版本、引用与确定性提示词试跑 | 30.945 |
| 05-materials | 合成原件上传、解析与原件下载 | 24.606 |
| 06-document-source | 固定来源导入、章节校正、保存与历史原件 | 35.873 |
| 07-content-assistant | 独立会话草稿、选区、缺凭据失败及固定输入重试 | 28.875 |

场景07四库准备通过真实API，manifest明确记录seededViaApi；用户会话、选区、发送、恢复和重试为实际UI操作。缺凭据失败不能当作模型生成成功。源WebM与截图保留，MP4转换结果另见同目录转码manifest。

七段MP4已实际全部转码通过，共163.245234秒、18,176,754字节，逐段H.264标识、1920×1080、正时长、播放推进、与原片时长偏差不超过1秒及落盘SHA核验通过。转码manifest SHA256为`a3dbf105228c20ce1c0107962b5d2fe815ed4ea1f3b6c6da68ef3f28b6a2e4ac`，原WebM保持。可直接打开`work/competition-evidence/release-b748424/index.html`逐段播放；不是5–8分钟比赛成片。

## 已过与未运行

- 最近API完整工程闸门：448项测试、Ruff/mypy、OpenAPI及Alembic单head0011通过。SG08新增12个不同真实PG回归有实际通过结果；成功模型分支是明确测试桩，非供应商证据。
- 前端43文件490项测试、`vp run check`、`vp build --mode workspace`通过；内容助手与来源导入桌面各1项通过，随后统一七场景录制全部通过。
- 原有阶段队列测试的两项默认skip不计通过；本轮未重跑广泛浏览器/移动矩阵，也未重新跑全量历史Linux服务集成。构建与本机可操作不等于19项AC全部完成。
- 干净环境10分钟复现未计时；七段素材不足5–8分钟赛事成片，缺至少2分钟真实AI编程协作录像；完整三条Prompt链和30页内PDF仍未完成。没有提交赛事、外传对话或改变私有仓库权限。

## 当前具体阻塞

1. 尚无已核实可用DeepSeek凭据。真实调用成功不能验收，已接链路只实测缺凭据失败与恢复。
2. SG04独立AI复核发现静态fixture与九个时序场景覆盖不能混记，未填写human_review；模型正式采纳仍由后端阻止。明细见[内容助手证据](content-assistant-foundation.md)。
3. SG09A任务反馈及SG19安全格式的后续认领提交/推送被自动审批拒绝；读取原始用户持续施工授权后仅重试一次仍被拒绝。理由是该授权不足以确认两项范围。两次Git命令均未执行，业务尚未开始；未绕过安全策略。台账只记录待确认范围与阻塞，不作成功认领。
4. 因后续业务未关闭，任务/反馈、计划、引用、格式、正式DOCX/PDF导出、完整评审、默认产物切换及整体AC仍未完成。现有来源原件下载不冒充正式导出，结构检查不冒充完整论文评审。
