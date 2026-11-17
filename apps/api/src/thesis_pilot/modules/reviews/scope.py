"""Deterministic review scope and location checks over one immutable document version."""

from typing import cast

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.content import ContentView
from thesis_pilot.modules.documents.docs_model import (
    JsonDict,
    atom_text,
    child_block_lists,
    model_of,
    top_blocks,
)
from thesis_pilot.modules.documents.structure import utf16_length

MAX_SCOPE_CHARACTERS = 24000
MAX_BLOCK_CHARACTERS = 6000
TEXT_BLOCKS = {"paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock"}
TEXT_BLOCKS_V2 = {"paragraph", "heading", "quote", "list", "code_block"}


def chapters(content: ContentView) -> list[dict[str, object]]:
    return [
        {
            "chapter_id": item.chapter_id,
            "title": item.title,
            "level": item.level,
            "block_index": item.block_index,
        }
        for item in content.chapters()
    ]


def extract_scope(content: ContentView, chapter_id: str | None) -> dict[str, object]:
    """Return the exact text blocks the model may read; nothing outside is reviewed."""
    top = content.top_blocks()
    start, end, title = 0, len(top), "整篇论文"
    if chapter_id is not None:
        selected = content.chapter_blocks(chapter_id)
        if not selected:
            raise AppError("REVIEW_SCOPE_NOT_FOUND", "该章节不在指定正文版本中。", 422)
        start, end = selected[0].index, selected[-1].index + 1
        title = selected[0].text.strip()[:200] or "未命名章节"
    text_kinds = TEXT_BLOCKS if content.schema_version == 1 else TEXT_BLOCKS_V2
    blocks: list[dict[str, object]] = []
    stack: list[tuple[int, str]] = []
    total = 0
    for node in top[start:end]:
        if node.chapter_id is not None:
            level = node.level or 1
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, node.chapter_id))
        if node.kind not in text_kinds:
            continue
        text = node.text.strip()
        if not text:
            continue
        if len(text) > MAX_BLOCK_CHARACTERS:
            raise AppError(
                "REVIEW_SCOPE_TOO_LARGE", "评审范围中有过长的段落，请拆分后再评审。", 413
            )
        total += len(text)
        blocks.append(
            {
                "index": node.index,
                "kind": node.kind,
                "chapter_id": stack[-1][1] if stack else None,
                "text": text,
            }
        )
    if not blocks:
        raise AppError("REVIEW_SCOPE_EMPTY", "所选范围没有可评审的文字。", 422)
    if total > MAX_SCOPE_CHARACTERS:
        raise AppError("REVIEW_SCOPE_TOO_LARGE", "评审范围过大，请选择单个章节评审。", 413)
    scope: dict[str, object] = {"chapter_id": chapter_id, "title": title, "blocks": blocks}
    if content.schema_version == 2:
        # v2 offsets are Unicode scalars; v1 scopes keep their frozen shape unchanged.
        scope["schema_version"] = 2
    return scope


def _text_nodes(block: JsonDict) -> list[tuple[str, str]]:
    """Paragraphs/headings under one top-level v2 block, in order: (node id, scalar text)."""
    found: list[tuple[str, str]] = []
    stack = [block]
    while stack:
        current = stack.pop()
        if current.get("type") in {"paragraph", "heading"}:
            found.append(
                (cast(str, current["id"]), atom_text(cast(list[JsonDict], current["inlines"])))
            )
            continue
        nested = [child for blocks in child_block_lists(current) for child in blocks]
        stack.extend(reversed(nested))
    return found


def node_anchor(content: ContentView, block_index: int, quote: str) -> tuple[str, int, int] | None:
    """v2: the first paragraph/heading under the reviewed top block whose own text contains
    the quote verbatim; offsets are Unicode scalars in that node (the editor's anchor unit)."""
    blocks = top_blocks(model_of(content.snapshot()))
    if not 0 <= block_index < len(blocks):
        return None
    for node_id, text in _text_nodes(blocks[block_index]):
        offset = text.find(quote)
        if offset >= 0:
            return node_id, offset, offset + len(quote)
    return None


def map_location(
    scope: dict[str, object],
    titles: dict[str, str],
    claimed: dict[str, object],
    content: ContentView | None = None,
) -> dict[str, object]:
    """Server-side mapping; anything the version cannot confirm stays blank, not guessed.

    For a v2 version (``content`` given) a confirmed location also names the node:
    ``node_id`` is the top block (block status) or the paragraph/heading holding the quote
    (range status, scalar offsets in that node), so the writing page can scroll to it.
    """
    blocks = cast(list[dict[str, object]], scope["blocks"])
    chapter_id = claimed.get("chapter_id")
    block_index = claimed.get("block")
    quote = claimed.get("quote")
    unlocated: dict[str, object] = {
        "status": "unlocated",
        "chapter_id": None,
        "chapter_title": None,
        "block_index": None,
        "start": None,
        "end": None,
        "quote": None,
        "node_id": None,
    }
    v2 = content is not None and content.schema_version == 2 and scope.get("schema_version") == 2
    if isinstance(block_index, int):
        block = next((item for item in blocks if item["index"] == block_index), None)
        if block is None or (chapter_id is not None and chapter_id != block["chapter_id"]):
            return unlocated
        owner = cast(str | None, block["chapter_id"])
        result = {
            **unlocated,
            "status": "block",
            "chapter_id": owner,
            "chapter_title": titles.get(owner) if owner else None,
            "block_index": block_index,
        }
        if v2 and content is not None:
            top = content.top_blocks()
            result["node_id"] = top[block_index].node_id if block_index < len(top) else None
            if result["node_id"] is None:
                return unlocated
            if isinstance(quote, str) and quote:
                if quote not in cast(str, block["text"]):
                    return unlocated
                anchored = node_anchor(content, block_index, quote)
                if anchored is None:
                    return unlocated
                node_id, start, end = anchored
                result.update(status="range", node_id=node_id, start=start, end=end, quote=quote)
            return result
        if isinstance(quote, str) and quote:
            text = cast(str, block["text"])
            offset = text.find(quote)
            if offset < 0:
                return unlocated
            scalar = scope.get("schema_version") == 2
            start = offset if scalar else utf16_length(text[:offset])
            length = len(quote) if scalar else utf16_length(quote)
            result.update(status="range", start=start, end=start + length, quote=quote)
        return result
    if isinstance(chapter_id, str) and any(item["chapter_id"] == chapter_id for item in blocks):
        return {
            **unlocated,
            "status": "chapter",
            "chapter_id": chapter_id,
            "chapter_title": titles.get(chapter_id),
            # v2 chapter ids are heading block ids.
            "node_id": chapter_id if v2 else None,
        }
    return unlocated
