"""v1 → v2 converter invariants on a self-made synthetic manuscript."""

from copy import deepcopy
from typing import Any, cast
from uuid import UUID

import pytest

from thesis_pilot.modules.documents.docs_model import (
    atom_text,
    derive_chapters,
    find_block,
    model_of,
    protected_text,
    validate_snapshot,
)
from thesis_pilot.modules.documents.legacy_v1 import (
    check_invariants,
    convert_v1,
    derived_id,
    v1_locked_texts,
    v1_textblocks,
    v2_textblocks,
)

DOCUMENT = UUID("7a4f3c1e-0000-4000-8000-000000000001")


def text(value: str, *marks: dict[str, Any]) -> dict[str, Any]:
    node: dict[str, Any] = {"type": "text", "text": value}
    if marks:
        node["marks"] = list(marks)
    return node


def heading(chapter: str, level: int, value: str, **attrs: Any) -> dict[str, Any]:
    return {
        "type": "heading",
        "attrs": {"chapterId": chapter, "level": level, **attrs},
        "content": [text(value)],
    }


def paragraph(*content: dict[str, Any], **attrs: Any) -> dict[str, Any]:
    node: dict[str, Any] = {"type": "paragraph", "content": list(content)}
    if attrs:
        node["attrs"] = attrs
    return node


LOCK = {"type": "aiLock"}
V1: dict[str, Any] = {
    "type": "doc",
    "content": [
        heading("chapter-intro", 1, "绪论🙂", templateAlign="center", templateWeight="700"),
        paragraph(
            text("样本量为 "),
            text("128𠮷", LOCK),
            text(" 例，"),
            text("加粗", {"type": "bold"}, {"type": "italic"}),
            {"type": "hardBreak"},
            text("见", {"type": "link", "attrs": {"href": "https://example.org/a"}}),
            alignment="justify",
        ),
        paragraph(text("［锁定对象 1］公式 E=mc²", LOCK)),
        heading("chapter-method", 2, "方法"),
        {
            "type": "orderedList",
            "attrs": {"start": 3, "type": "a"},
            "content": [
                {"type": "listItem", "content": [paragraph(text("第一项"))]},
                {
                    "type": "listItem",
                    "content": [
                        paragraph(text("第二项")),
                        {
                            "type": "bulletList",
                            "content": [{"type": "listItem", "content": [paragraph(text("嵌套"))]}],
                        },
                    ],
                },
            ],
        },
        {"type": "blockquote", "content": [paragraph(text("引文"))]},
        {"type": "codeBlock", "attrs": {"language": "python"}, "content": [text("print(1)")]},
        {"type": "horizontalRule"},
        {
            "type": "table",
            "content": [
                {
                    "type": "tableRow",
                    "content": [
                        {
                            "type": "tableHeader",
                            "attrs": {"colspan": 2, "colwidth": [100, 200]},
                            "content": [paragraph(text("合并表头"))],
                        },
                    ],
                },
                {
                    "type": "tableRow",
                    "content": [
                        {
                            "type": "tableCell",
                            "attrs": {"rowspan": 2, "colwidth": [100], "align": "center"},
                            "content": [paragraph(text("跨行"))],
                        },
                        {
                            "type": "tableCell",
                            "attrs": {"colwidth": [200]},
                            "content": [paragraph(text("甲"))],
                        },
                    ],
                },
                {
                    "type": "tableRow",
                    "content": [
                        {
                            "type": "tableCell",
                            "attrs": {"colwidth": [200]},
                            "content": [paragraph()],
                        },
                    ],
                },
            ],
        },
    ],
}


def test_conversion_preserves_text_chapters_and_protections() -> None:
    conversion = convert_v1(V1, document_id=DOCUMENT, version=4)
    check_invariants(V1, conversion)
    model = model_of(conversion.snapshot)
    assert v1_textblocks(V1) == v2_textblocks(model)
    assert [item["id"] for item in derive_chapters(model)] == ["chapter-intro", "chapter-method"]
    assert conversion.snapshot["chapters"] == derive_chapters(model)
    assert conversion.loss == []
    protections = cast(list[dict[str, Any]], conversion.snapshot["protections"])
    assert [item["kind"] for item in protections] == ["lock", "object"]
    assert sorted(protected_text(model, item)[0] for item in protections) == sorted(
        v1_locked_texts(V1)
    )
    lock = protections[0]
    # Unicode scalar offsets: "样本量为 " is 5 scalars; "128𠮷" is 4 (𠮷 is one scalar).
    assert lock["anchor"]["start"] == 5 and lock["anchor"]["end"] == 9
    assert protections[1]["anchor"] == {"node": model["sections"][0]["blocks"][2]["id"]}


def test_conversion_maps_structure_and_formatting() -> None:
    model = model_of(convert_v1(V1, document_id=DOCUMENT, version=4).snapshot)
    blocks = model["sections"][0]["blocks"]
    assert blocks[0] == {
        "type": "heading",
        "id": "chapter-intro",
        "level": 1,
        "props": {"align": "center", "run": {"bold": True}},
        "inlines": [{"type": "run", "text": "绪论🙂"}],
    }
    body = blocks[1]
    assert body["props"] == {"align": "justify"}
    assert [inline["type"] for inline in body["inlines"]] == ["run", "run", "break", "run"]
    assert body["inlines"][1]["props"] == {"bold": True, "italic": True}
    assert body["inlines"][3]["props"] == {"link": {"href": "https://example.org/a"}}
    # The lock mark itself is not a run property; it became a protection.
    assert atom_text(body["inlines"]).startswith("样本量为 128𠮷 例，")
    ordered = blocks[4]
    assert (ordered["kind"], ordered["start"]) == ("lower_alpha", 3)
    assert ordered["items"][1]["blocks"][1]["kind"] == "bullet"
    assert blocks[5]["type"] == "quote"
    assert blocks[6] == {
        "type": "code_block",
        "id": blocks[6]["id"],
        "lang": "python",
        "text": "print(1)",
    }
    assert blocks[7]["type"] == "rule"
    table = blocks[8]
    assert table["colWidths"] == [100 * 9525, 200 * 9525]
    assert table["rows"][0]["header"] is True
    assert table["rows"][0]["cells"][0]["colSpan"] == 2
    span = table["rows"][1]["cells"][0]
    assert span["rowSpan"] == 2
    assert span["blocks"][0]["props"] == {"align": "center"}
    assert table["rows"][2]["cells"][0]["blocks"][0]["inlines"] == []


def test_conversion_is_deterministic_and_idempotent() -> None:
    first = convert_v1(V1, document_id=DOCUMENT, version=4)
    second = convert_v1(deepcopy(V1), document_id=DOCUMENT, version=4)
    assert first.snapshot == second.snapshot and first.node_map == second.node_map
    # Revalidating a converted snapshot is a fixed point.
    assert validate_snapshot(first.snapshot) == first.snapshot
    other = convert_v1(V1, document_id=DOCUMENT, version=5)
    assert model_of(other.snapshot)["id"] != model_of(first.snapshot)["id"]
    # Chapter ids never depend on the version.
    assert derive_chapters(model_of(other.snapshot)) == derive_chapters(model_of(first.snapshot))


def test_node_map_covers_textblocks_and_ids_are_ulids() -> None:
    conversion = convert_v1(V1, document_id=DOCUMENT, version=4)
    model = model_of(conversion.snapshot)
    assert conversion.node_map[(0,)] == "chapter-intro"
    for path in [(1,), (2,), (4, 1, 0), (8, 1, 0, 0)]:
        node = find_block(model, conversion.node_map[path])
        assert node is not None and node["type"] == "paragraph"
    identifier = derived_id(DOCUMENT, 4, "n:1")
    assert len(identifier) == 26 and identifier[0] <= "7"
    assert conversion.node_map[(1,)] == identifier


def test_loss_report_lists_non_carried_attributes() -> None:
    lossy = deepcopy(V1)
    lossy["content"][0]["attrs"]["templateWeight"] = "600"
    lossy["content"][1]["content"][5]["marks"][0]["attrs"]["target"] = "_self"
    row = lossy["content"][8]["content"][1]["content"]
    row[1]["type"] = "tableHeader"
    conversion = convert_v1(lossy, document_id=DOCUMENT, version=1)
    assert [item["kind"] for item in conversion.loss] == [
        "heading.template_weight",
        "link.attributes",
        "table.header_cell",
    ]
    check_invariants(lossy, conversion)


def test_invariant_check_detects_tampering() -> None:
    conversion = convert_v1(V1, document_id=DOCUMENT, version=4)
    model_of(conversion.snapshot)["sections"][0]["blocks"][1]["inlines"][0]["text"] = "改"
    with pytest.raises(ValueError):
        check_invariants(V1, conversion)


def test_blank_v1_document_converts() -> None:
    blank = {"type": "doc", "content": [{"type": "paragraph"}]}
    conversion = convert_v1(blank, document_id=DOCUMENT, version=1)
    assert model_of(conversion.snapshot)["sections"][0]["blocks"] == [
        {"type": "paragraph", "id": derived_id(DOCUMENT, 1, "n:0"), "inlines": []}
    ]
    assert conversion.snapshot["protections"] == [] and conversion.snapshot["chapters"] == []
