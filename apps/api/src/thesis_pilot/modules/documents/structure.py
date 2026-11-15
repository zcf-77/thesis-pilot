"""The frozen production editor contract, independent of a JavaScript runtime."""

import json
import math
import re
from typing import cast

from thesis_pilot.core.errors import AppError

type EditorJsonValue = (
    dict[str, EditorJsonValue] | list[EditorJsonValue] | str | bool | int | float | None
)
type JsonObject = dict[str, EditorJsonValue]

MAX_SAFE_INTEGER = 9007199254740991
MAX_NODES = 100000
MAX_DEPTH = 80
MAX_CONTENT_BYTES = 16 * 1024 * 1024
MAX_TRANSPORT_BYTES = MAX_CONTENT_BYTES + 64 * 1024
MARK_ORDER = ("link", "bold", "code", "italic", "strike", "underline", "aiLock")
BLOCKS = {
    "paragraph",
    "blockquote",
    "bulletList",
    "orderedList",
    "codeBlock",
    "heading",
    "horizontalRule",
    "table",
}
INLINE = {"text", "hardBreak"}
NODE_TYPES = BLOCKS | INLINE | {"doc", "listItem", "tableRow", "tableCell", "tableHeader"}
DEFAULTS: dict[str, JsonObject] = {
    "heading": {"chapterId": None, "templateAlign": None, "templateWeight": None, "level": 1},
    "orderedList": {"start": 1, "type": None},
    "codeBlock": {"language": None},
    "tableCell": {"colspan": 1, "rowspan": 1, "colwidth": None, "align": None},
    "tableHeader": {"colspan": 1, "rowspan": 1, "colwidth": None, "align": None},
    "link": {
        "href": None,
        "target": "_blank",
        "rel": "noopener noreferrer nofollow",
        "class": None,
        "title": None,
    },
}


def invalid_structure() -> AppError:
    return AppError("DOCUMENT_STRUCTURE_INVALID", "正文结构不受支持，当前稿保持不变。", 422)


def too_large() -> AppError:
    return AppError("DOCUMENT_TOO_LARGE", "正文超过大小限制，请保留草稿并缩减后重试。", 413)


def well_formed(value: object) -> bool:
    return isinstance(value, str) and not any(0xD800 <= ord(char) <= 0xDFFF for char in value)


def utf16_length(value: str) -> int:
    if not well_formed(value):
        raise invalid_structure()
    return sum(2 if ord(char) > 0xFFFF else 1 for char in value)


def utf16_boundary(value: str, offset: int) -> bool:
    if not well_formed(value) or type(offset) is not int or offset < 0:
        return False
    position = 0
    for char in value:
        if position == offset:
            return True
        position += 2 if ord(char) > 0xFFFF else 1
    return position == offset


def integer(value: object, minimum: int = 0, maximum: int = MAX_SAFE_INTEGER) -> bool:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return False
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        return False
    return minimum <= value <= maximum


def nullable_string(value: object) -> bool:
    return value is None or well_formed(value)


def safe_href(value: object) -> bool:
    return (
        isinstance(value, str)
        and well_formed(value)
        and re.match(r"^(?:https?://|mailto:|#)", value, re.IGNORECASE) is not None
        and not any(ord(char) <= 32 or ord(char) == 127 for char in value)
    )


def attributes(kind: str, value: object) -> JsonObject:
    defaults = DEFAULTS.get(kind, {})
    if not isinstance(value, dict) or set(value) - defaults.keys():
        raise invalid_structure()
    result: JsonObject = {}
    for key, default in defaults.items():
        selected = value.get(key, default)
        valid: bool
        if key == "chapterId":
            valid = selected is None or (
                isinstance(selected, str)
                and well_formed(selected)
                and 1 <= utf16_length(selected) <= 200
            )
        elif key == "level":
            valid = integer(selected, 1, 6)
        elif key in {"start", "colspan", "rowspan"}:
            valid = integer(selected, 1, 10000)
        elif key == "colwidth":
            valid = selected is None or (
                isinstance(selected, list)
                and 1 <= len(selected) <= 10000
                and all(integer(item) for item in selected)
            )
        elif key in {"templateAlign", "align"}:
            choices = (
                (None, "left", "center")
                if key == "templateAlign"
                else (None, "left", "center", "right")
            )
            valid = selected in choices
        elif key == "templateWeight":
            valid = selected in (None, "600", "700")
        elif key == "type":
            valid = selected in (None, "1", "a", "A", "i", "I")
        elif key == "href":
            valid = safe_href(selected)
        else:
            valid = nullable_string(selected)
        if not valid:
            raise invalid_structure()
        if key in {"level", "start", "colspan", "rowspan"}:
            result[key] = int(cast(int | float, selected))
        elif isinstance(selected, list):
            result[key] = [int(item) for item in selected]
        else:
            result[key] = selected
    widths = result.get("colwidth")
    if isinstance(widths, list) and len(widths) != result["colspan"]:
        raise invalid_structure()
    return result


def children(node: JsonObject) -> list[JsonObject]:
    return cast(list[JsonObject], node.get("content", []))


def node_attrs(node: JsonObject) -> JsonObject:
    return cast(JsonObject, node.get("attrs", {}))


def validate_children(node: JsonObject) -> None:
    kind = node["type"]
    content = children(node)
    kinds = [child["type"] for child in content]
    valid = False
    if kind in {"doc", "blockquote", "tableCell", "tableHeader"}:
        valid = bool(kinds) and all(child in BLOCKS for child in kinds)
    elif kind in {"bulletList", "orderedList"}:
        valid = bool(kinds) and all(child == "listItem" for child in kinds)
    elif kind == "listItem":
        valid = (
            bool(kinds) and kinds[0] == "paragraph" and all(child in BLOCKS for child in kinds[1:])
        )
    elif kind in {"paragraph", "heading"}:
        valid = all(child in INLINE for child in kinds)
    elif kind == "codeBlock":
        valid = all(child == "text" for child in kinds)
    elif kind == "table":
        valid = bool(kinds) and all(child == "tableRow" for child in kinds)
    elif kind == "tableRow":
        valid = all(child in {"tableCell", "tableHeader"} for child in kinds)
    elif kind in {"hardBreak", "horizontalRule", "text"}:
        valid = not kinds
    if not valid:
        raise invalid_structure()
    previous: JsonObject | None = None
    for child in content:
        if kind not in {"paragraph", "heading"} and child.get("marks"):
            raise invalid_structure()
        if (
            previous is not None
            and previous["type"] == child["type"] == "text"
            and previous.get("marks", []) == child.get("marks", [])
        ):
            raise invalid_structure()
        previous = child


def validate_table(table: JsonObject) -> None:
    rows = children(table)
    ending: dict[int, int] = {}
    carried = width = 0
    for index, row in enumerate(rows):
        carried -= ending.get(index, 0)
        row_width = carried
        for cell in children(row):
            attrs = node_attrs(cell)
            colspan, rowspan = int(cast(int, attrs["colspan"])), int(cast(int, attrs["rowspan"]))
            if index + rowspan > len(rows):
                raise invalid_structure()
            row_width += colspan
            if rowspan > 1:
                carried += colspan
                ending[index + rowspan] = ending.get(index + rowspan, 0) + colspan
        width = max(width, row_width)
    if not width or width * len(rows) > MAX_NODES:
        raise invalid_structure()
    grid: list[list[int | None]] = [[None] * width for _ in rows]
    column_widths: list[set[int]] = [set() for _ in range(width)]
    for row_index, row in enumerate(rows):
        column = 0
        for cell in children(row):
            while column < width and grid[row_index][column] is not None:
                column += 1
            attrs = node_attrs(cell)
            colspan, rowspan = int(cast(int, attrs["colspan"])), int(cast(int, attrs["rowspan"]))
            if column + colspan > width:
                raise invalid_structure()
            widths = cast(list[int] | None, attrs["colwidth"])
            for down in range(rowspan):
                for across in range(colspan):
                    if grid[row_index + down][column + across] is not None:
                        raise invalid_structure()
                    size = int(widths[across]) if widths else 0
                    grid[row_index + down][column + across] = size
                    column_widths[column + across].add(size)
            column += colspan
        if any(slot is None for slot in grid[row_index]):
            raise invalid_structure()
    # TableMap repairs unknown/mismatched widths when any cell specifies a width.
    if any(len(widths) != 1 for widths in column_widths):
        raise invalid_structure()


def canonical_editor_json(value: object, *, require_chapter_ids: bool = True) -> JsonObject:
    count = 0
    ids: set[str] = set()

    def normalize(raw: object, depth: int) -> JsonObject:
        nonlocal count
        count += 1
        if count > MAX_NODES or depth > MAX_DEPTH or not isinstance(raw, dict):
            raise invalid_structure()
        kind = raw.get("type")
        if not isinstance(kind, str) or kind not in NODE_TYPES:
            raise invalid_structure()
        allowed = (
            {"type", "text", "marks"} if kind == "text" else {"type", "attrs", "content", "marks"}
        )
        if set(raw) - allowed:
            raise invalid_structure()
        result: JsonObject = {"type": kind}
        if kind == "text":
            text = raw.get("text")
            if not isinstance(text, str) or not text or not well_formed(text):
                raise invalid_structure()
            result["text"] = text
        else:
            attrs = attributes(kind, raw.get("attrs", {}))
            if attrs:
                result["attrs"] = attrs
            if kind == "heading":
                chapter_id = attrs["chapterId"]
                if chapter_id is None and require_chapter_ids:
                    raise invalid_structure()
                if isinstance(chapter_id, str):
                    if chapter_id in ids:
                        raise invalid_structure()
                    ids.add(chapter_id)
            if "content" in raw:
                content = raw["content"]
                if not isinstance(content, list) or len(content) > MAX_NODES:
                    raise invalid_structure()
                if content:
                    result["content"] = [normalize(child, depth + 1) for child in content]
        if "marks" in raw:
            marks = raw["marks"]
            if not isinstance(marks, list) or len(marks) > len(MARK_ORDER):
                raise invalid_structure()
            if kind == "doc" and marks:
                raise invalid_structure()
            normalized_marks: list[EditorJsonValue] = []
            previous_rank = -1
            for mark in marks:
                if not isinstance(mark, dict) or set(mark) - {"type", "attrs"}:
                    raise invalid_structure()
                mark_type = mark.get("type")
                if not isinstance(mark_type, str) or mark_type not in MARK_ORDER:
                    raise invalid_structure()
                rank = MARK_ORDER.index(mark_type)
                if rank <= previous_rank or (mark_type == "code" and len(marks) != 1):
                    raise invalid_structure()
                previous_rank = rank
                normalized: JsonObject = {"type": mark_type}
                attrs = attributes(mark_type, mark.get("attrs", {}))
                if attrs:
                    normalized["attrs"] = attrs
                normalized_marks.append(normalized)
            if normalized_marks:
                result["marks"] = normalized_marks
        validate_children(result)
        if kind == "table":
            validate_table(result)
        return result

    normalized = normalize(value, 0)
    if normalized["type"] != "doc":
        raise invalid_structure()
    if len(compact_json(normalized).encode("utf-8")) > MAX_CONTENT_BYTES:
        raise too_large()
    return normalized


def compact_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def node_size(node: JsonObject) -> int:
    """ProseMirror nodeSize for an already validated canonical node."""
    if node["type"] == "text":
        return utf16_length(cast(str, node["text"]))
    if node["type"] in {"hardBreak", "horizontalRule"}:
        return 1
    return sum(node_size(child) for child in children(node)) + 2
