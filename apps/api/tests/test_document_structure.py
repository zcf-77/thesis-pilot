import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.schemas import DocumentContent, DocumentImport, DocumentSave
from thesis_pilot.modules.documents.structure import (
    MAX_CONTENT_BYTES,
    MAX_NODES,
    canonical_editor_json,
    compact_json,
    node_size,
    utf16_boundary,
    utf16_length,
)

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures/document-structure.json").read_text("utf-8")
)


def manuscript(text: str = "自制正文🙂") -> dict:
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


@pytest.mark.parametrize("case", FIXTURES, ids=lambda case: case["name"])
def test_shared_production_editor_contract(case: dict) -> None:
    original = copy.deepcopy(case["json"])
    if case["valid"]:
        canonical = canonical_editor_json(original)
        assert canonical_editor_json(canonical) == canonical
        assert (
            DocumentContent.model_validate({"schema_version": 1, "json": original}).json_content
            == canonical
        )
        if "canonical" in case:
            assert canonical == case["canonical"]
    else:
        with pytest.raises(AppError) as captured:
            canonical_editor_json(original)
        assert captured.value.code == "DOCUMENT_STRUCTURE_INVALID"
    assert original == case["json"]


def test_utf16_positions_chapter_length_and_missing_identity() -> None:
    assert utf16_length("甲🙂𠮷乙") == 6
    assert [offset for offset in range(8) if utf16_boundary("甲🙂𠮷乙", offset)] == [0, 1, 3, 5, 6]
    # The root nodeSize also includes two boundary tokens; doc.content.size is two less.
    assert node_size(canonical_editor_json(manuscript("甲🙂乙"))) == 8
    for identity, accepted in [("🙂" * 100, True), ("🙂" * 101, False), (None, False)]:
        content = {
            "type": "doc",
            "content": [{"type": "heading", "attrs": {"chapterId": identity}}],
        }
        if accepted:
            assert canonical_editor_json(content)["content"][0]["attrs"]["chapterId"] == identity
        else:
            with pytest.raises(AppError):
                canonical_editor_json(content)
    with pytest.raises(AppError):
        utf16_length("bad\udfff")


@pytest.mark.parametrize("nested,accepted", [(24, True), (78, True), (79, False), (81, False)])
def test_editor_node_depth_includes_text_leaves(nested: int, accepted: bool) -> None:
    node = manuscript()["content"][0]
    for _ in range(nested):
        node = {"type": "blockquote", "content": [node]}
    content = {"type": "doc", "content": [node]}
    if accepted:
        parsed = DocumentContent.model_validate({"schema_version": 1, "json": content})
        assert parsed.json_content == content
        assert parsed.model_dump(mode="python", by_alias=True)["json"] == content
    else:
        with pytest.raises(AppError):
            DocumentContent.model_validate({"schema_version": 1, "json": content})


def test_node_count_and_projected_grid_budget() -> None:
    content = {"type": "doc", "content": [{"type": "paragraph"} for _ in range(MAX_NODES - 1)]}
    assert len(canonical_editor_json(content)["content"]) == MAX_NODES - 1
    content["content"].append({"type": "paragraph"})
    with pytest.raises(AppError):
        canonical_editor_json(content)
    table = {
        "type": "doc",
        "content": [
            {
                "type": "table",
                "content": [
                    {
                        "type": "tableRow",
                        "content": [
                            {
                                "type": "tableCell",
                                "attrs": {"colspan": 10000},
                                "content": [{"type": "paragraph"}],
                            }
                        ],
                    }
                    for _ in range(11)
                ],
            }
        ],
    }
    with pytest.raises(AppError):
        canonical_editor_json(table)


def test_real_utf8_size_limit_and_exact_boundary() -> None:
    empty_size = len(compact_json(manuscript("")).encode("utf-8"))
    length = MAX_CONTENT_BYTES - empty_size
    # A non-BMP character uses four UTF-8 bytes; ensure this is not Python len or JS length.
    text = "🙂" * (length // 4) + "a" * (length % 4)
    assert len(compact_json(manuscript(text)).encode("utf-8")) == MAX_CONTENT_BYTES
    assert canonical_editor_json(manuscript(text))["type"] == "doc"
    with pytest.raises(AppError) as captured:
        canonical_editor_json(manuscript(text + "a"))
    assert captured.value.code == "DOCUMENT_TOO_LARGE" and captured.value.status_code == 413


def test_dto_extra_fields_versions_and_schema_are_strict() -> None:
    content = {"schema_version": 1, "json": manuscript()}
    for extras in ({"html": "<p>ignored</p>"}, {"chapters": []}, {"source": "ai_adoption"}):
        with pytest.raises(ValidationError):
            DocumentImport.model_validate({"content": content, **extras})
    for version in (True, 1.0, "1", 0, -1, 9007199254740992):
        with pytest.raises(ValidationError):
            DocumentSave.model_validate({"expected_version": version, "content": content})
    for schema in (True, 1.0, "1", 2):
        with pytest.raises(ValidationError):
            DocumentContent.model_validate({**content, "schema_version": schema})


def test_schema_describes_recursive_json_instead_of_unconstrained_any() -> None:
    for mode in ("validation", "serialization"):
        schema = DocumentContent.model_json_schema(mode=mode)
        recursive = schema["$defs"]["EditorJsonValue"]
        assert {branch["type"] for branch in recursive["anyOf"]} == {
            "object",
            "array",
            "string",
            "boolean",
            "integer",
            "number",
            "null",
        }


def test_integer_attributes_use_javascript_compatible_json_encoding() -> None:
    document = {
        "type": "doc",
        "content": [
            {
                "type": "orderedList",
                "attrs": {"start": 1.0},
                "content": [{"type": "listItem", "content": [{"type": "paragraph"}]}],
            }
        ],
    }
    assert '"start":1,' in compact_json(canonical_editor_json(document))
