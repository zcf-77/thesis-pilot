"""Deterministic review scope and location checks over one immutable document version."""

from typing import cast

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.structure import JsonObject, children, utf16_length

MAX_SCOPE_CHARACTERS = 24000
MAX_BLOCK_CHARACTERS = 6000
TEXT_BLOCKS = {"paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock"}


def _text(node: JsonObject) -> str:
    if node["type"] == "text":
        return cast(str, node["text"])
    if node["type"] == "hardBreak":
        return "\n"
    parts = [_text(child) for child in children(node)]
    inline = node["type"] in {"paragraph", "heading", "codeBlock"}
    return ("" if inline else "\n").join(part for part in parts if part)


def _chapter_id(node: JsonObject) -> str | None:
    if node["type"] != "heading":
        return None
    attrs = node.get("attrs")
    value = attrs.get("chapterId") if isinstance(attrs, dict) else None
    return value if isinstance(value, str) else None


def _level(node: JsonObject) -> int:
    attrs = node.get("attrs")
    value = attrs.get("level") if isinstance(attrs, dict) else None
    return value if isinstance(value, int) else 1


def chapters(content: JsonObject) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for index, node in enumerate(children(content)):
        chapter_id = _chapter_id(node)
        if chapter_id is not None:
            result.append(
                {
                    "chapter_id": chapter_id,
                    "title": _text(node).strip()[:200] or "未命名章节",
                    "level": _level(node),
                    "block_index": index,
                }
            )
    return result


def extract_scope(content: JsonObject, chapter_id: str | None) -> dict[str, object]:
    """Return the exact text blocks the model may read; nothing outside is reviewed."""
    top = children(content)
    start, end, title = 0, len(top), "整篇论文"
    if chapter_id is not None:
        found = [index for index, node in enumerate(top) if _chapter_id(node) == chapter_id]
        if not found:
            raise AppError("REVIEW_SCOPE_NOT_FOUND", "该章节不在指定正文版本中。", 422)
        start = found[0]
        level = _level(top[start])
        title = _text(top[start]).strip()[:200] or "未命名章节"
        end = next(
            (
                index
                for index in range(start + 1, len(top))
                if top[index]["type"] == "heading" and _level(top[index]) <= level
            ),
            len(top),
        )
    blocks: list[dict[str, object]] = []
    stack: list[tuple[int, str]] = []
    total = 0
    for index in range(start, end):
        node = top[index]
        own = _chapter_id(node)
        if own is not None:
            level = _level(node)
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, own))
        if node["type"] not in TEXT_BLOCKS:
            continue
        text = _text(node).strip()
        if not text:
            continue
        if len(text) > MAX_BLOCK_CHARACTERS:
            raise AppError(
                "REVIEW_SCOPE_TOO_LARGE", "评审范围中有过长的段落，请拆分后再评审。", 413
            )
        total += len(text)
        blocks.append(
            {
                "index": index,
                "kind": node["type"],
                "chapter_id": stack[-1][1] if stack else None,
                "text": text,
            }
        )
    if not blocks:
        raise AppError("REVIEW_SCOPE_EMPTY", "所选范围没有可评审的文字。", 422)
    if total > MAX_SCOPE_CHARACTERS:
        raise AppError("REVIEW_SCOPE_TOO_LARGE", "评审范围过大，请选择单个章节评审。", 413)
    return {"chapter_id": chapter_id, "title": title, "blocks": blocks}


def map_location(
    scope: dict[str, object], titles: dict[str, str], claimed: dict[str, object]
) -> dict[str, object]:
    """Server-side mapping; anything the version cannot confirm stays blank, not guessed."""
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
    }
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
        if isinstance(quote, str) and quote:
            text = cast(str, block["text"])
            offset = text.find(quote)
            if offset < 0:
                return unlocated
            start = utf16_length(text[:offset])
            result.update(status="range", start=start, end=start + utf16_length(quote), quote=quote)
        return result
    if isinstance(chapter_id, str) and any(item["chapter_id"] == chapter_id for item in blocks):
        return {
            **unlocated,
            "status": "chapter",
            "chapter_id": chapter_id,
            "chapter_title": titles.get(chapter_id),
        }
    return unlocated
