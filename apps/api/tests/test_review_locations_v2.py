"""SG-22 E: review issue locations on v2 versions name the node and scalar offsets."""

from typing import Any
from uuid import uuid4

from thesis_pilot.modules.documents.content import ContentView
from thesis_pilot.modules.documents.legacy_v1 import convert_v1
from thesis_pilot.modules.reviews.schemas import ReviewLocation
from thesis_pilot.modules.reviews.scope import chapters, extract_scope, map_location

V1: dict[str, Any] = {
    "type": "doc",
    "content": [
        {
            "type": "heading",
            "attrs": {"chapterId": "c1", "level": 1},
            "content": [{"type": "text", "text": "第一章 引言"}],
        },
        {"type": "paragraph", "content": [{"type": "text", "text": "🙂样本量 42，结论稳健。"}]},
        {
            "type": "bulletList",
            "content": [
                {
                    "type": "listItem",
                    "content": [
                        {"type": "paragraph", "content": [{"type": "text", "text": "第一项"}]}
                    ],
                },
                {
                    "type": "listItem",
                    "content": [
                        {"type": "paragraph", "content": [{"type": "text", "text": "第二项说明"}]}
                    ],
                },
            ],
        },
    ],
}


def views() -> tuple[ContentView, ContentView]:
    snapshot = convert_v1(V1, document_id=uuid4(), version=2).snapshot
    return ContentView.of(1, V1), ContentView.of(2, snapshot)


def locate(view: ContentView, claim: dict[str, object]) -> dict[str, object]:
    scope = extract_scope(view, None)
    titles = {str(item["chapter_id"]): str(item["title"]) for item in chapters(view)}
    location = map_location(scope, titles, claim, view)
    ReviewLocation.model_validate(location)
    return location


def test_v2_range_names_node_with_scalar_offsets() -> None:
    v1, v2 = views()
    paragraph = v2.top_blocks()[1]
    located = locate(v2, {"chapter_id": "c1", "block": 1, "quote": "样本量 42"})
    assert located["status"] == "range" and located["node_id"] == paragraph.node_id
    # The emoji counts one scalar (two UTF-16 units in the v1 report).
    assert (located["start"], located["end"]) == (1, 7)
    legacy = locate(v1, {"chapter_id": "c1", "block": 1, "quote": "样本量 42"})
    assert (legacy["start"], legacy["end"], legacy["node_id"]) == (2, 8, None)


def test_v2_quote_inside_list_anchors_the_item_paragraph() -> None:
    _, v2 = views()
    located = locate(v2, {"chapter_id": "c1", "block": 2, "quote": "说明"})
    assert located["status"] == "range" and (located["start"], located["end"]) == (3, 5)
    assert located["node_id"] != v2.top_blocks()[2].node_id
    block = locate(v2, {"chapter_id": None, "block": 2, "quote": None})
    assert block["status"] == "block" and block["node_id"] == v2.top_blocks()[2].node_id


def test_v2_unconfirmed_claims_stay_unlocated_and_chapters_name_headings() -> None:
    _, v2 = views()
    assert locate(v2, {"chapter_id": "c1", "block": 1, "quote": "不存在"})["status"] == (
        "unlocated"
    )
    # Quotes crossing list items cannot be anchored to one node and are not guessed.
    crossing = locate(v2, {"chapter_id": "c1", "block": 2, "quote": "第一项\n第二项"})
    assert crossing["status"] == "unlocated" and crossing["node_id"] is None
    chapter = locate(v2, {"chapter_id": "c1", "block": None, "quote": None})
    assert chapter["status"] == "chapter" and chapter["node_id"] == "c1"
