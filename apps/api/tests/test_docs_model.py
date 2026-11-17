"""DocsModel subset validation, ThesisPilot limits and drift against the kernel schema."""

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import docs_model as dm

SCHEMA = json.loads(
    (Path(__file__).parent / "fixtures" / "muffin_office" / "docs-model.schema.json").read_text(
        encoding="utf-8"
    )
)
DEFS: dict[str, Any] = SCHEMA["$defs"]

# ThesisPilot class → kernel schema definition (struct-shaped types).
STRUCTS: dict[type[BaseModel], str] = {
    dm.DocsLink: "Link",
    dm.DocsInlineProps: "InlineProps",
    dm.DocsAnchorPos: "AnchorPos",
    dm.DocsImageAnchor: "ImageAnchor",
    dm.DocsSpacing: "Spacing",
    dm.DocsIndent: "Indent",
    dm.DocsTabStop: "TabStop",
    dm.DocsBorder: "Border",
    dm.DocsBorders: "Borders",
    dm.DocsListLabel: "ListLabel",
    dm.DocsParaProps: "ParaProps",
    dm.DocsListItem: "ListItem",
    dm.DocsTableContinuation: "TableContinuation",
    dm.DocsTableProps: "TableProps",
    dm.DocsCellProps: "CellProps",
    dm.DocsTableCell: "TableCell",
    dm.DocsTableRow: "TableRow",
    dm.DocsPageSize: "PageSize",
    dm.DocsMargins: "Margins",
    dm.DocsDocGrid: "DocGrid",
    dm.DocsPageProps: "PageProps",
    dm.DocsHeaderFooter: "HeaderFooter",
    dm.DocsSection: "Section",
    dm.DocsMeta: "Meta",
    dm.DocsResource: "Resource",
    dm.DocsUnsupported: "Unsupported",
    dm.DocsListBlock: "List",
    dm.DocsTableBlock: "Table",
    dm.DocsImageBlock: "Image",
    dm.DocsImageInline: "InlineImage",
}


def aliases(model: type[BaseModel]) -> tuple[set[str], set[str]]:
    names = {info.alias or name for name, info in model.model_fields.items()}
    required = {
        info.alias or name for name, info in model.model_fields.items() if info.is_required()
    }
    return names - {"type"}, required - {"type"}


@pytest.mark.parametrize(
    "model,name", STRUCTS.items(), ids=lambda item: getattr(item, "__name__", item)
)
def test_struct_fields_are_a_subset_of_the_kernel_schema(model: type[BaseModel], name: str) -> None:
    definition = DEFS[name]
    properties = set(definition.get("properties", {}))
    ours, required = aliases(model)
    assert ours <= properties, ours - properties
    assert set(definition.get("required", [])) <= required | {"type"}


def variants(definition: str) -> dict[str, dict[str, Any]]:
    result = {}
    for variant in DEFS[definition]["oneOf"]:
        tag = variant["properties"]["type"]["const"]
        result[tag] = variant
    return result


@pytest.mark.parametrize(
    "model",
    [
        dm.DocsParagraphBlock,
        dm.DocsHeadingBlock,
        dm.DocsCodeBlock,
        dm.DocsQuoteBlock,
        dm.DocsPageBreakBlock,
        dm.DocsRuleBlock,
        dm.DocsTocBlock,
        dm.DocsRunInline,
        dm.DocsBreakInline,
        dm.DocsTabInline,
        dm.DocsFieldInline,
        dm.DocsBookmarkInline,
    ],
)
def test_tagged_variants_match_the_kernel_schema(model: type[BaseModel]) -> None:
    tag = model.model_fields["type"].annotation.__args__[0]  # type: ignore[union-attr]
    table = variants("Block") if "Block" in model.__name__ else variants("Inline")
    ours, required = aliases(model)
    assert ours <= set(table[tag]["properties"]) - {"type"}
    assert set(table[tag].get("required", [])) - {"type"} <= required


def base_model() -> dict[str, Any]:
    return {
        "kind": "docs",
        "schemaVersion": 1,
        "id": "doc",
        "theme": {"name": "minimal"},
        "sections": [
            {
                "id": "s1",
                "blocks": [
                    {
                        "type": "heading",
                        "id": "h1",
                        "level": 1,
                        "inlines": [{"type": "run", "text": "绪论"}],
                    },
                    {
                        "type": "paragraph",
                        "id": "p1",
                        "inlines": [
                            {"type": "run", "text": "数据🙂"},
                            {"type": "tab"},
                            {"type": "run", "text": "𠮷值", "props": {"bold": True}},
                        ],
                    },
                ],
            }
        ],
    }


def test_canonical_dump_drops_serde_defaults() -> None:
    raw = base_model()
    raw["sections"][0]["blocks"][1]["props"] = {"spacing": {}, "tabs": [], "run": {}}
    raw["sections"][0]["blocks"][1]["inlines"][0]["props"] = {}
    result = dm.validate_model(raw)
    paragraph = result["sections"][0]["blocks"][1]
    assert "props" not in paragraph and "props" not in paragraph["inlines"][0]
    assert result == dm.validate_model(result)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda m: m.update(extra=True),
        lambda m: m["sections"][0]["blocks"].append(
            {"type": "container", "id": "c", "kind": "x", "blocks": []}
        ),
        lambda m: m["sections"][0]["blocks"][1]["inlines"].append(
            {"type": "footnote_ref", "id": "f"}
        ),
        lambda m: m["sections"][0]["blocks"].append(
            {"type": "paragraph", "id": "p1", "inlines": []}
        ),
        lambda m: m["sections"][0]["blocks"][0].update(level=7),
        lambda m: m["sections"][0]["blocks"][1]["inlines"].append(
            {"type": "run", "text": "\ud800"}
        ),
        lambda m: m["sections"][0]["blocks"][1]["inlines"].append({"type": "run", "text": 3}),
        lambda m: m["sections"][0]["blocks"].append(
            {"type": "image", "id": "i", "resource": "missing"}
        ),
        lambda m: m.update(
            resources=[{"id": "r", "mime": "image/png", "data": {"kind": "bytes", "value": "AA=="}}]
        ),
        lambda m: m.update(sections=[]),
        lambda m: m["sections"][0]["blocks"][0].update(level=True),
    ],
)
def test_out_of_subset_models_are_rejected(mutate: Any) -> None:
    raw = base_model()
    mutate(raw)
    with pytest.raises(AppError) as raised:
        dm.validate_model(raw)
    assert raised.value.code == "DOCMODEL_INVALID"


def test_limits_reject_deep_or_huge_models() -> None:
    block: dict[str, Any] = {"type": "paragraph", "id": "p", "inlines": []}
    for index in range(dm.MAX_DEPTH):
        block = {"type": "quote", "id": f"q{index}", "blocks": [block]}
    raw = base_model()
    raw["sections"][0]["blocks"] = [block]
    with pytest.raises(AppError) as raised:
        dm.validate_model(raw)
    assert raised.value.code == "DOCMODEL_TOO_LARGE"
    raw = base_model()
    raw["sections"][0]["blocks"] = [
        {"type": "paragraph", "id": f"p{index}", "inlines": []} for index in range(dm.MAX_NODES + 1)
    ]
    with pytest.raises(AppError) as raised:
        dm.validate_model(raw)
    assert raised.value.code == "DOCMODEL_TOO_LARGE"


def test_resources_are_content_addressed_references() -> None:
    raw = base_model()
    digest = "ab" * 32
    raw["resources"] = [
        {
            "id": "r1",
            "mime": "image/png",
            "data": {"kind": "uri", "value": f"tp-resource:{digest}"},
            "sha256": digest,
        }
    ]
    raw["sections"][0]["blocks"].append({"type": "image", "id": "img", "resource": "r1"})
    assert dm.resource_hashes(dm.validate_model(raw)) == {digest}
    raw["resources"][0]["sha256"] = "cd" * 32
    with pytest.raises(AppError):
        dm.validate_model(raw)


def snapshot(protections: list[dict[str, Any]], chapters: Any = None) -> dict[str, Any]:
    value: dict[str, Any] = {"schemaVersion": 2, "model": base_model(), "protections": protections}
    if chapters is not None:
        value["chapters"] = chapters
    return value


def test_snapshot_derives_chapters_and_resolves_scalar_protections() -> None:
    result = dm.validate_snapshot(
        snapshot([{"id": "k1", "kind": "lock", "anchor": {"node": "p1", "start": 2, "end": 5}}])
    )
    assert result["schemaVersion"] == 2
    assert result["chapters"] == [
        {"id": "h1", "level": 1, "title": "绪论", "block": 0, "end": 2, "words": 5}
    ]
    # "数据🙂" is 3 scalars, the tab 1, so [2,5) is "🙂\t𠮷".
    assert dm.protected_text(result["model"], result["protections"][0])[0] == "🙂\t𠮷"
    assert dm.validate_snapshot(result) == result


def run(text: str) -> dict[str, Any]:
    return {"type": "run", "text": text}


def test_chapter_rule_matches_the_editor() -> None:
    """block/end over all sections, raw run titles, JS-whitespace word count, references stop."""
    raw = base_model()
    raw["sections"] = [
        {
            "id": "s1",
            "blocks": [
                {
                    "type": "heading",
                    "id": "h1",
                    "level": 1,
                    "inlines": [run(" 第一章 "), {"type": "tab"}],
                },
                {
                    "type": "paragraph",
                    "id": "p1",
                    "inlines": [run("甲 乙\u3000丙\u00a0"), {"type": "tab"}],
                },
                {"type": "heading", "id": "h2", "level": 2, "inlines": [run("1.1")]},
                {
                    "type": "list",
                    "id": "l1",
                    "kind": "bullet",
                    "items": [
                        {
                            "id": "i1",
                            "blocks": [{"type": "paragraph", "id": "p2", "inlines": [run("ab")]}],
                        }
                    ],
                },
                {
                    "type": "quote",
                    "id": "q1",
                    "blocks": [
                        {"type": "heading", "id": "h9", "level": 3, "inlines": [run("不计")]}
                    ],
                },
            ],
        },
        {
            "id": "s2",
            "blocks": [
                {"type": "code_block", "id": "c1", "text": "x = 1"},
                {
                    "type": "table",
                    "id": "t1",
                    "rows": [
                        {
                            "id": "r1",
                            "cells": [
                                {
                                    "id": "e1",
                                    "blocks": [
                                        {"type": "paragraph", "id": "p3", "inlines": [run("表")]}
                                    ],
                                }
                            ],
                        }
                    ],
                },
                {"type": "heading", "id": "h3", "level": 1, "inlines": [run("参考文献")]},
                {"type": "paragraph", "id": "p4", "inlines": [run("[1] 文献")]},
                {"type": "heading", "id": "h4", "level": 1, "inlines": [run("致谢")]},
                {"type": "paragraph", "id": "p5", "inlines": [run("谢谢")]},
            ],
        },
    ]
    chapters = dm.derive_chapters(dm.validate_model(raw))
    assert chapters == [
        {"id": "h1", "level": 1, "title": " 第一章 ", "block": 0, "end": 7, "words": 3 + 2 + 3},
        {"id": "h2", "level": 2, "title": "1.1", "block": 2, "end": 7, "words": 2 + 3},
        {"id": "h3", "level": 1, "title": "参考文献", "block": 7, "end": 9, "words": 0},
        {"id": "h4", "level": 1, "title": "致谢", "block": 9, "end": 11, "words": 0},
    ]
    assert dm.REFERENCES_TITLE.match(" 5. 参考文献 ") and not dm.REFERENCES_TITLE.match(
        "参考文献综述"
    )


@pytest.mark.parametrize(
    "protection",
    [
        {"id": "k", "kind": "lock", "anchor": {"node": "missing"}},
        {"id": "k", "kind": "lock", "anchor": {"node": "p1", "start": 3, "end": 3}},
        {"id": "k", "kind": "lock", "anchor": {"node": "p1", "start": 0, "end": 7}},
        {"id": "k", "kind": "lock", "anchor": {"node": "p1", "start": 0}},
        {"id": "k", "kind": "lock", "anchor": {"node": "s1"}},
        {"id": "k", "kind": "lock", "anchor": {"node": "p1"}, "protectFormatting": True},
    ],
)
def test_invalid_protection_anchors_are_rejected(protection: dict[str, Any]) -> None:
    with pytest.raises(AppError) as raised:
        dm.validate_snapshot(snapshot([protection]))
    assert raised.value.code in {"DOCMODEL_PROTECTION_INVALID", "DOCMODEL_INVALID"}


def test_supplied_chapters_are_shape_checked_then_recomputed() -> None:
    stale = [{"id": "h1", "level": 2, "title": "旧", "block": 5, "end": 6, "words": 9}]
    result = dm.validate_snapshot(snapshot([], chapters=stale))
    assert result["chapters"] == dm.derive_chapters(result["model"])
    with pytest.raises(AppError):
        dm.validate_snapshot(snapshot([], chapters=[{"id": "h1", "level": 1, "title": "x"}]))
    missing_version = snapshot([])
    del missing_version["schemaVersion"]
    with pytest.raises(AppError):
        dm.validate_snapshot(missing_version)
    duplicated = snapshot(
        [
            {"id": "k", "kind": "lock", "anchor": {"node": "p1"}},
            {"id": "k", "kind": "lock", "anchor": {"node": "h1"}},
        ]
    )
    with pytest.raises(AppError):
        dm.validate_snapshot(deepcopy(duplicated))
