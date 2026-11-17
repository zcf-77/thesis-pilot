# MuffinOffice 内核金标与模型 Schema

只读复制自 muffin-office-poc `origin/main` rev `cfb8352`，供 `docs_model.py` / `docs_ops.py` 一致性测试使用；不在本仓库修改。

| 文件 | 来源 | SHA-256 |
| --- | --- | --- |
| `doc-ops-conformance.json` | `packages/vue/tests/fixtures/doc-ops-conformance.json`（144 条，内核 `UPDATE_CONFORMANCE=1` 生成） | `69ab3e54e932fd36beb97346fadc7600698427314f1961dadeabd7be9360299e` |
| `docs-model.schema.json` | `office schema model`（`crates/office-cli`，`office-model` 的 `json_schema_for_model`） | `7761c3d4d0f011c7b2df329df088c876072c8f39c0fa172cd2a7a0b49490f3cc` |
| `doc-op.schema.json` | `office schema op`（`office-ops` 的 `json_schema_for_op`） | `46b47ba28fd14bf69c6a01d8d1705a1cd8f5f223cc2700aa9f0c6db572847cdc` |

Schema 由本机 `cargo build --offline -p office-cli`（rustc 1.98.1、cargo 1.98.1）构建后导出。更新时重新复制、更新本表哈希，并重跑 `tests/test_docs_model.py` 与 `tests/test_docs_ops.py`。
