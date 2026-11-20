# 官方来源快照

采集日期：2026-11-02（Asia/Shanghai）。两个响应均通过公开接口实际获取，HTTP 请求成功，JSON 包含 `code=200` 与 `success=true`。原始响应按下载字节保存。

| 文件 | 来源 |
|---|---|
| [2026-11-02-track-10039.json](2026-11-02-track-10039.json) | [赛道公开接口](https://gateway.boxuegu.com/portal-marketing/competition/track/detail?id=10039&includeDetail=true) |
| [2026-11-02-notice-10091.json](2026-11-02-notice-10091.json) | [预指导通知公开接口](https://gateway.boxuegu.com/portal-marketing/competition-notice/detail?id=10091) |

SHA-256：

```text
ADF2774A989D622D654BA5CB9A16A7F0910E898CA325012BCC295BCBC06AF185  2026-11-02-track-10039.json
138B1EBCA73967FFC8BD0FC9573951B63BC7F7BABD47A6CF3E75F471430C467B  2026-11-02-notice-10091.json
```

在仓库根目录通过 PowerShell 核对：

```powershell
Get-FileHash -Algorithm SHA256 docs/competition/sources/2026-11-02-track-10039.json
Get-FileHash -Algorithm SHA256 docs/competition/sources/2026-11-02-notice-10091.json
```

这些文件仅用于核验比赛要求，内容权利归原发布方。不要将其标记为用户与 AI 对话证据。后续官方更新应另存日期快照并在 [要求台账](../requirements.md) 记录差异，保留本次版本。
