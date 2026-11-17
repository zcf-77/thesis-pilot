"""Deterministic v1 (Tiptap JSON) → v2 (DocsModel snapshot) conversion.

Same input, document and version always give the same snapshot: heading ids keep
their ``chapterId``; every other id is a ULID-shaped hash of (document, version,
v1 path). ``aiLock`` marks become ``lock`` protections; a block whose whole text is a
DOCX locked-object placeholder becomes a whole-block ``object`` protection. Anything
the DocsModel cannot carry is listed in the loss report rather than dropped silently.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast
from uuid import UUID

from thesis_pilot.modules.documents.docs_model import (
    JsonDict,
    JsonValue,
    atom_text,
    model_of,
    protected_text,
    validate_snapshot,
    walk_blocks,
)
from thesis_pilot.modules.documents.structure import JsonObject, canonical_editor_json

CONVERTER_VERSION = "legacy-v1-to-docs-v2/1"
CONVERTER_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
DEFAULT_THEME = "minimal"
EMU_PER_PX = 9525
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
OBJECT_MARKER = "［锁定对象 "
ALIGN = {"left": "start", "center": "center", "right": "end", "justify": "justify"}
LIST_KINDS = {
    None: "decimal",
    "1": "decimal",
    "a": "lower_alpha",
    "A": "upper_alpha",
    "i": "lower_roman",
    "I": "upper_roman",
}
LINK_DEFAULTS = {"target": "_blank", "rel": "noopener noreferrer nofollow", "class": None}

type Path_ = tuple[int, ...]


def derived_id(document_id: UUID, version: int, key: str) -> str:
    """128-bit hash rendered as a 26-char Crockford ULID (first char ≤ '7')."""
    value = int.from_bytes(
        hashlib.sha256(f"{document_id}:{version}:{key}".encode()).digest()[:16], "big"
    )
    chars = []
    for _ in range(26):
        chars.append(CROCKFORD[value & 31])
        value >>= 5
    return "".join(reversed(chars))


def path_key(path: Path_) -> str:
    return "/".join(str(index) for index in path)


@dataclass
class Conversion:
    snapshot: JsonDict
    # v1 node path (indices from the doc root) → v2 node id, for blocks/items/rows/cells.
    node_map: dict[Path_, str]
    loss: list[JsonDict]
    converter_version: str = CONVERTER_VERSION
    converter_sha256: str = CONVERTER_SHA256


@dataclass
class _State:
    document_id: UUID
    version: int
    node_map: dict[Path_, str] = field(default_factory=dict)
    loss: list[JsonDict] = field(default_factory=list)
    protections: list[JsonDict] = field(default_factory=list)

    def node_id(self, path: Path_, role: str = "n") -> str:
        node_id = derived_id(self.document_id, self.version, f"{role}:{path_key(path)}")
        self.node_map[path] = node_id
        return node_id

    def lose(self, kind: str, path: Path_, detail: str | None = None) -> None:
        item: JsonDict = {"kind": kind, "path": path_key(path)}
        if detail is not None:
            item["detail"] = detail
        self.loss.append(item)


def _children(node: JsonObject) -> list[JsonObject]:
    return cast(list[JsonObject], node.get("content", []))


def _attrs(node: JsonObject) -> JsonObject:
    return cast(JsonObject, node.get("attrs", {}))


def _inline_props(marks: list[JsonObject], state: _State, path: Path_) -> tuple[JsonDict, bool]:
    props: JsonDict = {}
    locked = False
    for mark in marks:
        kind = mark["type"]
        if kind == "bold":
            props["bold"] = True
        elif kind == "italic":
            props["italic"] = True
        elif kind == "strike":
            props["strike"] = True
        elif kind == "underline":
            props["underline"] = "single"
        elif kind == "code":
            props["code"] = True
        elif kind == "aiLock":
            locked = True
        elif kind == "link":
            attrs = _attrs(mark)
            link: JsonDict = {"href": cast(str, attrs["href"])}
            if attrs.get("title") is not None:
                link["title"] = cast(str, attrs["title"])
            props["link"] = link
            if any(attrs.get(name) != value for name, value in LINK_DEFAULTS.items()):
                state.lose("link.attributes", path, "target/rel/class")
    return props, locked


def _inlines(node: JsonObject, path: Path_, state: _State, block_id: str) -> list[JsonValue]:
    """Runs + line breaks; aiLock ranges recorded as lock/object protections (scalars)."""
    out: list[JsonDict] = []
    locked_ranges: list[tuple[int, int]] = []
    offset = 0
    all_locked = bool(_children(node))
    text_parts: list[str] = []
    for index, child in enumerate(_children(node)):
        if child["type"] == "hardBreak":
            out.append({"type": "break", "kind": "line"})
            offset += 1
            all_locked = False
            text_parts.append("\n")
            continue
        text = cast(str, child["text"])
        props, locked = _inline_props(
            cast(list[JsonObject], child.get("marks", [])), state, (*path, index)
        )
        if locked:
            if locked_ranges and locked_ranges[-1][1] == offset:
                locked_ranges[-1] = (locked_ranges[-1][0], offset + len(text))
            else:
                locked_ranges.append((offset, offset + len(text)))
        else:
            all_locked = False
        text_parts.append(text)
        offset += len(text)
        if out and out[-1]["type"] == "run" and out[-1].get("props", {}) == props:
            out[-1]["text"] = cast(str, out[-1]["text"]) + text
        else:
            run: JsonDict = {"type": "run", "text": text}
            if props:
                run["props"] = props
            out.append(run)
    if all_locked and "".join(text_parts).startswith(OBJECT_MARKER):
        state.protections.append(
            {
                "id": derived_id(state.document_id, state.version, f"object:{path_key(path)}"),
                "kind": "object",
                "anchor": {"node": block_id},
            }
        )
    else:
        for start, end in locked_ranges:
            state.protections.append(
                {
                    "id": derived_id(
                        state.document_id, state.version, f"lock:{path_key(path)}:{start}"
                    ),
                    "kind": "lock",
                    "anchor": {"node": block_id, "start": start, "end": end},
                }
            )
    return cast(list[JsonValue], out)


def _blocks(nodes: list[JsonObject], path: Path_, state: _State) -> list[JsonValue]:
    return [_block(node, (*path, index), state) for index, node in enumerate(nodes)]


def _with_align(block: JsonDict, align: str | None) -> None:
    if align is not None and block["type"] in {"paragraph", "heading"}:
        props = cast(JsonDict, block.setdefault("props", {}))
        props.setdefault("align", align)


def _table(node: JsonObject, path: Path_, state: _State, table_id: str) -> JsonDict:
    rows = _children(node)
    grid_widths: dict[int, int] = {}
    occupied: set[tuple[int, int]] = set()
    converted_rows: list[JsonValue] = []
    for row_index, row in enumerate(rows):
        row_path = (*path, row_index)
        row_id = state.node_id(row_path, "row")
        column = 0
        cells: list[JsonValue] = []
        kinds = set()
        for cell_index, cell in enumerate(_children(row)):
            while (row_index, column) in occupied:
                column += 1
            attrs = _attrs(cell)
            colspan, rowspan = int(cast(int, attrs["colspan"])), int(cast(int, attrs["rowspan"]))
            widths = cast(list[int] | None, attrs.get("colwidth"))
            for across in range(colspan):
                grid_widths.setdefault(column + across, int(widths[across]) if widths else 0)
                for down in range(rowspan):
                    occupied.add((row_index + down, column + across))
            column += colspan
            kinds.add(cell["type"])
            cell_path = (*row_path, cell_index)
            cell_id = state.node_id(cell_path, "cell")
            blocks = _blocks(_children(cell), cell_path, state)
            align = ALIGN.get(cast(str, attrs["align"])) if attrs.get("align") else None
            for block in blocks:
                _with_align(cast(JsonDict, block), align)
            converted: JsonDict = {"id": cell_id}
            if colspan != 1:
                converted["colSpan"] = colspan
            if rowspan != 1:
                converted["rowSpan"] = rowspan
            converted["blocks"] = blocks
            cells.append(converted)
        converted_row: JsonDict = {"id": row_id}
        if kinds == {"tableHeader"}:
            converted_row["header"] = True
        elif "tableHeader" in kinds:
            state.lose("table.header_cell", row_path, "行内混合表头单元格按普通单元格保存")
        converted_row["cells"] = cells
        converted_rows.append(converted_row)
    table: JsonDict = {"type": "table", "id": table_id}
    widths_in_order = [grid_widths[index] for index in sorted(grid_widths)]
    if widths_in_order and all(widths_in_order):
        table["colWidths"] = [width * EMU_PER_PX for width in widths_in_order]
    elif any(widths_in_order):
        state.lose("table.partial_col_widths", path, "部分列未指定宽度，列宽交由排版平均分配")
    table["rows"] = converted_rows
    return table


def _block(node: JsonObject, path: Path_, state: _State) -> JsonValue:
    kind = node["type"]
    attrs = _attrs(node)
    if kind == "heading":
        chapter_id = attrs.get("chapterId")
        if isinstance(chapter_id, str):
            node_id = chapter_id
            state.node_map[path] = node_id
        else:
            node_id = state.node_id(path)
            state.lose("heading.chapter_id", path)
        props: JsonDict = {}
        if attrs.get("templateAlign") is not None:
            props["align"] = ALIGN[cast(str, attrs["templateAlign"])]
        if attrs.get("templateWeight") is not None:
            props["run"] = {"bold": True}
            if attrs["templateWeight"] == "600":
                state.lose("heading.template_weight", path, "600 字重按加粗保存")
        heading: JsonDict = {"type": "heading", "id": node_id, "level": attrs.get("level", 1)}
        if props:
            heading["props"] = props
        heading["inlines"] = _inlines(node, path, state, node_id)
        return heading
    node_id = state.node_id(path)
    if kind == "paragraph":
        paragraph: JsonDict = {"type": "paragraph", "id": node_id}
        alignment = attrs.get("alignment")
        if alignment is not None:
            paragraph["props"] = {"align": ALIGN[cast(str, alignment)]}
        paragraph["inlines"] = _inlines(node, path, state, node_id)
        return paragraph
    if kind == "blockquote":
        return {"type": "quote", "id": node_id, "blocks": _blocks(_children(node), path, state)}
    if kind in {"bulletList", "orderedList"}:
        result: JsonDict = {"type": "list", "id": node_id}
        if kind == "bulletList":
            result["kind"] = "bullet"
        else:
            result["kind"] = LIST_KINDS[cast(str | None, attrs.get("type"))]
            start = attrs.get("start", 1)
            if start != 1:
                result["start"] = start
        items: list[JsonValue] = []
        for index, item in enumerate(_children(node)):
            item_path = (*path, index)
            items.append(
                {
                    "id": state.node_id(item_path, "item"),
                    "blocks": _blocks(_children(item), item_path, state),
                }
            )
        result["items"] = items
        return result
    if kind == "codeBlock":
        code: JsonDict = {"type": "code_block", "id": node_id}
        if attrs.get("language") is not None:
            code["lang"] = cast(str, attrs["language"])
        code["text"] = "".join(cast(str, child["text"]) for child in _children(node))
        return code
    if kind == "horizontalRule":
        return {"type": "rule", "id": node_id}
    if kind == "table":
        return _table(node, path, state, node_id)
    raise ValueError(f"unsupported v1 block {kind}")


def convert_v1(content: JsonObject, *, document_id: UUID, version: int) -> Conversion:
    """Convert one stored v1 version. Pure: no database access, no clock, no randomness."""
    document = canonical_editor_json(content, require_chapter_ids=False)
    state = _State(document_id, version)
    blocks = _blocks(_children(document), (), state)
    model: JsonDict = {
        "kind": "docs",
        "schemaVersion": 1,
        "id": derived_id(document_id, version, "document"),
        "theme": {"name": DEFAULT_THEME},
        "sections": [{"id": derived_id(document_id, version, "section:0"), "blocks": blocks}],
    }
    snapshot = validate_snapshot(
        {
            "schemaVersion": 2,
            "model": model,
            "protections": cast(list[JsonValue], state.protections),
        }
    )
    return Conversion(snapshot, state.node_map, state.loss)


# ---------- invariant projections (tests and upgrade self-checks) ----------


def v1_textblocks(content: JsonObject) -> list[tuple[str, str]]:
    """(kind, text) per v1 paragraph/heading/codeBlock in document order."""
    result: list[tuple[str, str]] = []
    stack = [canonical_editor_json(content, require_chapter_ids=False)]
    while stack:
        node = stack.pop()
        if node["type"] in {"paragraph", "heading", "codeBlock"}:
            text = "".join(
                "\n" if child["type"] == "hardBreak" else cast(str, child["text"])
                for child in _children(node)
            )
            result.append((node["type"], text))
            continue
        stack.extend(reversed(_children(node)))
    return result


def v2_textblocks(model: JsonDict) -> list[tuple[str, str]]:
    names = {"paragraph": "paragraph", "heading": "heading", "code_block": "codeBlock"}
    result: list[tuple[str, str]] = []
    for ref in walk_blocks(model):
        kind = cast(str, ref.block["type"])
        if kind in {"paragraph", "heading"}:
            result.append((names[kind], atom_text(cast(list[JsonDict], ref.block["inlines"]))))
        elif kind == "code_block":
            result.append((names[kind], cast(str, ref.block["text"])))
    return result


def v1_locked_texts(content: JsonObject) -> list[str]:
    """Contiguous aiLock texts per textblock, in document order."""
    result: list[str] = []
    stack = [canonical_editor_json(content, require_chapter_ids=False)]
    while stack:
        node = stack.pop()
        if node["type"] in {"paragraph", "heading"}:
            current: list[str] = []
            for child in _children(node):
                marks = cast(list[JsonObject], child.get("marks", []))
                if child["type"] == "text" and any(mark["type"] == "aiLock" for mark in marks):
                    current.append(cast(str, child["text"]))
                elif current:
                    result.append("".join(current))
                    current = []
            if current:
                result.append("".join(current))
            continue
        stack.extend(reversed(_children(node)))
    return result


def check_invariants(content: JsonObject, conversion: Conversion) -> None:
    """Self-check run before an upgrade is committed; raises on any violation."""
    model = model_of(conversion.snapshot)
    if v1_textblocks(content) != v2_textblocks(model):
        raise ValueError("block text changed")
    document = canonical_editor_json(content, require_chapter_ids=False)
    chapter_ids: list[str] = []
    stack = [document]
    while stack:
        node = stack.pop()
        if node["type"] == "heading" and isinstance(_attrs(node).get("chapterId"), str):
            chapter_ids.append(cast(str, _attrs(node)["chapterId"]))
        stack.extend(reversed(_children(node)))
    v2_heading_ids = [
        cast(str, ref.block["id"]) for ref in walk_blocks(model) if ref.block["type"] == "heading"
    ]
    if chapter_ids != v2_heading_ids:
        raise ValueError("chapter ids changed")
    protected = [
        protected_text(model, protection)[0]
        for protection in cast(list[JsonDict], conversion.snapshot["protections"])
        if protection["kind"] == "lock"
    ]
    object_texts = [
        protected_text(model, protection)[0]
        for protection in cast(list[JsonDict], conversion.snapshot["protections"])
        if protection["kind"] == "object"
    ]
    locked = v1_locked_texts(content)
    if sorted(protected + object_texts) != sorted(locked):
        raise ValueError("protected text changed")
