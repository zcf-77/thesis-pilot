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
    dm.Link: "Link",
    dm.InlineProps: "InlineProps",
    dm.AnchorPos: "AnchorPos",
    dm.ImageAnchor: "ImageAnchor",
    dm.Spacing: "Spacing",
    dm.Indent: "Indent",
    dm.TabStop: "TabStop",
    dm.Border: "Border",
    dm.Borders: "Borders",
    dm.ListLabel: "ListLabel",
    dm.ParaProps: "ParaProps",
    dm.ListItem: "ListItem",
    dm.TableContinuation: "TableContinuation",
    dm.TableProps: "TableProps",
    dm.CellProps: "CellProps",
    dm.TableCell: "TableCell",
    dm.TableRow: "TableRow",
    dm.PageSize: "PageSize",
    dm.Margins: "Margins",
    dm.DocGrid: "DocGrid",
    dm.PageProps: "PageProps",
    dm.HeaderFooter: "HeaderFooter",
    dm.Section: "Section",
    dm.Meta: "Meta",
    dm.Resource: "Resource",
    dm.Unsupported: "Unsupported",
    dm.ListBlock: "List",
    dm.TableBlock: "Table",
    dm.ImageBlock: "Image",
    dm.ImageInline: "InlineImage",
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
        dm.ParagraphBlock,
        dm.HeadingBlock,
        dm.CodeBlock,
        dm.QuoteBlock,
        dm.PageBreakBlock,
        dm.RuleBlock,
        dm.TocBlock,
        dm.RunInline,
        dm.BreakInline,
        dm.TabInline,
        dm.FieldInline,
        dm.BookmarkInline,
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
        {"type": "paragraph", "id": f"p{index}", "inlines": []} for index in range(dm.MAX_NODES)
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
    value: dict[str, Any] = {"model": base_model(), "protections": protections}
    if chapters is not None:
        value["chapters"] = chapters
    return value


def test_snapshot_derives_chapters_and_resolves_scalar_protections() -> None:
    result = dm.validate_snapshot(
        snapshot([{"id": "k1", "kind": "lock", "anchor": {"node": "p1", "start": 2, "end": 5}}])
    )
    assert result["chapters"] == [{"id": "h1", "level": 1, "title": "绪论"}]
    # "数据🙂" is 3 scalars, the tab 1, so [2,5) is "🙂\t𠮷".
    assert dm.protected_text(result["model"], result["protections"][0])[0] == "🙂\t𠮷"
    assert dm.validate_snapshot(result) == result


@pytest.mark.parametrize(
    "protection",
    [
        {"id": "k", "kind": "lock", "anchor": {"node": "missing"}},
        {"id": "k", "kind": "lock", "anchor": {"node": "p1", "start": 3, "end": 3}},
        {"id": "k", "kind": "lock", "anchor": {"node": "p1", "start": 0, "end": 7}},
        {"id": "k", "kind": "lock", "anchor": {"node": "p1", "start": 0}},
    ],
)
def test_invalid_protection_anchors_are_rejected(protection: dict[str, Any]) -> None:
    with pytest.raises(AppError) as raised:
        dm.validate_snapshot(snapshot([protection]))
    assert raised.value.code == "DOCMODEL_PROTECTION_INVALID"


def test_supplied_chapters_must_match_the_derived_outline() -> None:
    with pytest.raises(AppError) as raised:
        dm.validate_snapshot(snapshot([], chapters=[{"id": "h1", "level": 2, "title": "绪论"}]))
    assert raised.value.code == "DOCMODEL_CHAPTERS_MISMATCH"
    duplicated = snapshot(
        [
            {"id": "k", "kind": "lock", "anchor": {"node": "p1"}},
            {"id": "k", "kind": "lock", "anchor": {"node": "h1"}},
        ]
    )
    with pytest.raises(AppError):
        dm.validate_snapshot(deepcopy(duplicated))
