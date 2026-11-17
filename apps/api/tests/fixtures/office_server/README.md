# office-server 录制响应

本机 `tp-office` 边车（office-server 0.1.1，`office-kernel-1`，开发许可）对 `tests/office_docx.py` 生成的自制合成论文 DOCX（不含任何用户资料）的真实响应，供假边车单测使用：

| 文件 | 端点 | 说明 |
| --- | --- | --- |
| `thesis-parse.json` | `POST /v1/parse`（`office-source/1`） | DocsModel + preserved/converted/unsupported，原样保存 |
| `thesis-inspect.json` | `POST /v1/docs/inspect`（`include=["irMap","index"]`） | 只保留信封与 `result.irMap`，省略 `index` |

合成 DOCX 字节确定（固定 ZIP 时间），`sourceSha256` 与其 SHA-256 一致。边车或合成文档变更时重新录制；集成测试 `tests/integration/test_office_io.py` 始终对真实边车运行。
