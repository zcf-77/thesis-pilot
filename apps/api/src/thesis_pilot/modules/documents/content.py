"""Read-only facade over stored manuscript content of either schema version.

Consumers (revisions, format revisions, assistant sessions, task evidence, document
inspection, document sources, exports, reviews) read content through this view
instead of walking ``content_json`` directly. v1 behaviour is unchanged: every v1
projection here is the exact algorithm those modules used before. v2 projections
follow the kernel (``Block::plain_text``, scalar offsets). Write paths are not here.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated, Literal, cast

from pydantic import BaseModel, ConfigDict, Field

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.docs_model import (
    MAX_ID_LENGTH,
    MAX_SAFE_INTEGER,
    JsonDict,
    atom_text,
    block_plain_text,
    derive_chapters,
    find_block,
    model_of,
    top_blocks,
    walk_blocks,
)
from thesis_pilot.modules.documents.structure import JsonObject, children

if TYPE_CHECKING:
    from thesis_pilot.modules.documents.models import DocumentVersion
    from thesis_pilot.modules.revisions.anchors import ResolvedSelection
    from thesis_pilot.modules.revisions.schemas import RevisionSelection

SchemaVersion = Literal[1, 2]
V1_INLINE_TEXT = {"paragraph", "heading", "codeBlock"}


def schema_unsupported() -> AppError:
    return AppError(
        "DOCMODEL_SCHEMA_UNSUPPORTED",
        "该功能暂不支持新版正文结构，正文保持不变；请等待功能升级或使用旧版本。",
        409,
    )


def anchor_schema_mismatch() -> AppError:
    return AppError(
        "DOCMODEL_ANCHOR_SCHEMA_MISMATCH", "选区与正文结构版本不一致，请在当前正文中重新选择。", 409
    )


def node_anchor_invalid() -> AppError:
    return AppError(
        "DOCMODEL_ANCHOR_INVALID", "选区位置或原文与该正文版本不一致，请重新选择。", 422
    )


class NodeAnchor(BaseModel):
    """v2 text anchor: one paragraph/heading, scalar offsets, exact expected text."""

    model_config = ConfigDict(extra="forbid", strict=True)

    node_id: Annotated[str, Field(min_length=1, max_length=MAX_ID_LENGTH)]
    start: Annotated[int, Field(ge=0, le=MAX_SAFE_INTEGER)]
    end: Annotated[int, Field(ge=1, le=MAX_SAFE_INTEGER)]
    expected_text: Annotated[str, Field(min_length=1, max_length=4000)]


@dataclass(frozen=True)
class ResolvedSpan:
    node_id: str
    kind: str
    start: int
    end: int
    text: str
    block_text: str


@dataclass(frozen=True)
class BlockView:
    """A top-level body block; ``kind`` keeps the schema's own type name."""

    index: int
    kind: str
    text: str
    level: int | None
    chapter_id: str | None
    node_id: str | None


@dataclass(frozen=True)
class ChapterView:
    chapter_id: str
    title: str
    level: int
    block_index: int


def _v1_text(node: JsonObject) -> str:
    if node["type"] == "text":
        return cast(str, node["text"])
    if node["type"] == "hardBreak":
        return "\n"
    parts = [_v1_text(child) for child in children(node)]
    inline = node["type"] in V1_INLINE_TEXT
    return ("" if inline else "\n").join(part for part in parts if part)


def _v1_attr(node: JsonObject, name: str) -> object:
    attrs = node.get("attrs")
    return attrs.get(name) if isinstance(attrs, dict) else None


def _v1_has_chapter(node: JsonObject, chapter_id: str) -> bool:
    if node.get("type") == "heading" and _v1_attr(node, "chapterId") == chapter_id:
        return True
    nested = node.get("content")
    return isinstance(nested, list) and any(
        _v1_has_chapter(child, chapter_id) for child in nested if isinstance(child, dict)
    )


@dataclass(frozen=True)
class ContentView:
    schema_version: SchemaVersion
    raw: JsonObject

    @classmethod
    def of(cls, schema_version: int, content: JsonObject) -> ContentView:
        if schema_version not in (1, 2):
            raise schema_unsupported()
        return cls(cast(SchemaVersion, schema_version), content)

    @classmethod
    def from_version(cls, version: DocumentVersion) -> ContentView:
        return cls.of(version.schema_version, version.content_json)

    # ---- raw access ----

    def legacy_json(self) -> JsonObject:
        """The v1 Tiptap document, for modules that have not been ported to v2."""
        if self.schema_version != 1:
            raise schema_unsupported()
        return self.raw

    def snapshot(self) -> JsonDict:
        if self.schema_version != 2:
            raise schema_unsupported()
        return self.raw

    def fingerprint(self) -> str:
        """Same digest as task evidence used for v1 (sorted keys, compact)."""
        raw = json.dumps(self.raw, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    # ---- blocks and chapters ----

    def top_blocks(self) -> list[BlockView]:
        if self.schema_version == 1:
            result: list[BlockView] = []
            for index, node in enumerate(children(self.raw)):
                is_heading = node["type"] == "heading"
                chapter = _v1_attr(node, "chapterId") if is_heading else None
                level = _v1_attr(node, "level")
                result.append(
                    BlockView(
                        index=index,
                        kind=cast(str, node["type"]),
                        text=_v1_text(node),
                        level=(level if isinstance(level, int) else 1) if is_heading else None,
                        chapter_id=chapter if isinstance(chapter, str) else None,
                        node_id=chapter if isinstance(chapter, str) else None,
                    )
                )
            return result
        model = model_of(self.snapshot())
        return [
            BlockView(
                index=index,
                kind=cast(str, block["type"]),
                text=block_plain_text(block),
                level=cast(int, block["level"]) if block["type"] == "heading" else None,
                chapter_id=cast(str, block["id"]) if block["type"] == "heading" else None,
                node_id=cast(str, block["id"]),
            )
            for index, block in enumerate(top_blocks(model))
        ]

    def chapters(self) -> list[ChapterView]:
        """Top-level headings in order (the review outline semantics)."""
        return [
            ChapterView(
                chapter_id=block.chapter_id,
                title=block.text.strip()[:200] or "未命名章节",
                level=block.level or 1,
                block_index=block.index,
            )
            for block in self.top_blocks()
            if block.chapter_id is not None
        ]

    def has_chapter(self, chapter_id: str) -> bool:
        if self.schema_version == 1:
            return _v1_has_chapter(self.raw, chapter_id)
        return any(item["id"] == chapter_id for item in derive_chapters(model_of(self.snapshot())))

    def chapter_blocks(self, chapter_id: str) -> list[BlockView]:
        """The heading and following top-level blocks until a heading of equal/higher rank."""
        blocks = self.top_blocks()
        start = next((b.index for b in blocks if b.chapter_id == chapter_id), None)
        if start is None:
            return []
        level = blocks[start].level or 1
        end = next(
            (
                block.index
                for block in blocks[start + 1 :]
                if block.kind == "heading" and (block.level or 1) <= level
            ),
            len(blocks),
        )
        return blocks[start:end]

    def flatten_text(self) -> str:
        """Whole-body plain text, blocks separated by a newline."""
        return "\n".join(block.text for block in self.top_blocks() if block.text)

    def node_text(self, node_id: str) -> str | None:
        """Scalar text of a v2 paragraph/heading (atoms count 1); v1 has no node ids."""
        if self.schema_version != 2:
            raise anchor_schema_mismatch()
        block = find_block(model_of(self.snapshot()), node_id)
        if block is None or block["type"] not in {"paragraph", "heading"}:
            return None
        return atom_text(cast(list[JsonDict], block["inlines"]))

    def textblock_texts(self) -> list[str]:
        """Text of every paragraph/heading/code block (any depth), in document order."""
        if self.schema_version == 1:
            texts: list[str] = []

            def walk(node: JsonObject) -> None:
                if node["type"] in V1_INLINE_TEXT:
                    texts.append(
                        "".join(
                            cast(str, child["text"]) if child["type"] == "text" else "\n"
                            for child in children(node)
                        )
                    )
                    return
                for child in children(node):
                    walk(child)

            walk(self.raw)
            return texts
        result: list[str] = []
        for ref in walk_blocks(model_of(self.snapshot())):
            kind = ref.block["type"]
            if kind in {"paragraph", "heading"}:
                result.append(atom_text(cast(list[JsonDict], ref.block["inlines"])))
            elif kind == "code_block":
                result.append(cast(str, ref.block["text"]))
        return result

    # ---- anchors ----

    def resolve_selection(self, selection: RevisionSelection) -> ResolvedSelection:
        """v1 ProseMirror selection (UTF-16 positions); a v2 version cannot honour it."""
        if self.schema_version != 1:
            raise anchor_schema_mismatch()
        from thesis_pilot.modules.revisions.anchors import resolve_selection

        return resolve_selection(self.raw, selection)

    def resolve_node_anchor(self, anchor: NodeAnchor) -> ResolvedSpan:
        if self.schema_version != 2:
            raise anchor_schema_mismatch()
        block = find_block(model_of(self.snapshot()), anchor.node_id)
        if block is None or block["type"] not in {"paragraph", "heading"}:
            raise node_anchor_invalid()
        text = atom_text(cast(list[JsonDict], block["inlines"]))
        if not anchor.start < anchor.end <= len(text):
            raise node_anchor_invalid()
        if text[anchor.start : anchor.end] != anchor.expected_text:
            raise node_anchor_invalid()
        return ResolvedSpan(
            anchor.node_id,
            str(block["type"]),
            anchor.start,
            anchor.end,
            anchor.expected_text,
            text,
        )

    # ---- statistics ----

    def inspection_counts(self) -> dict[str, int]:
        """Structural counts for the deterministic inspection job."""
        if self.schema_version == 1:
            from thesis_pilot.modules.documents.structure import canonical_editor_json

            stack = [canonical_editor_json(self.raw)]
            nodes = paragraphs = headings = tables = characters = 0
            while stack:
                node = stack.pop()
                nodes += 1
                paragraphs += node.get("type") == "paragraph"
                headings += node.get("type") == "heading"
                tables += node.get("type") == "table"
                text = node.get("text")
                if isinstance(text, str):
                    characters += len(text)
                nested = node.get("content")
                if isinstance(nested, list):
                    stack.extend(child for child in nested if isinstance(child, dict))
            return {
                "node_count": nodes,
                "paragraph_count": paragraphs,
                "heading_count": headings,
                "table_count": tables,
                "text_characters": characters,
            }
        model = model_of(self.snapshot())
        counts = {"node_count": 0, "paragraph_count": 0, "heading_count": 0, "table_count": 0}
        characters = 0
        for ref in walk_blocks(model):
            block = ref.block
            counts["node_count"] += 1
            kind = block["type"]
            counts["paragraph_count"] += kind == "paragraph"
            counts["heading_count"] += kind == "heading"
            counts["table_count"] += kind == "table"
            if kind in {"paragraph", "heading"}:
                inlines = cast(list[JsonDict], block["inlines"])
                counts["node_count"] += len(inlines)
                characters += sum(
                    len(cast(str, item["text"])) for item in inlines if item["type"] == "run"
                )
            elif kind == "code_block":
                characters += len(cast(str, block["text"]))
        return {**counts, "text_characters": characters}


def view_of(version: DocumentVersion) -> ContentView:
    return ContentView.from_version(version)
