"""Resolve exact, version-bound ProseMirror positions without a Node runtime."""

from dataclasses import dataclass
from typing import cast

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.structure import (
    EditorJsonValue,
    JsonObject,
    canonical_editor_json,
    node_size,
    utf16_length,
    well_formed,
)
from thesis_pilot.modules.revisions.schemas import (
    MAX_SELECTION_UNITS,
    RevisionPatch,
    RevisionSelection,
)


def anchor_error() -> AppError:
    return AppError("REVISION_ANCHOR_INVALID", "选区位置或原文不一致，请重新选择。", 422)


def unsupported() -> AppError:
    return AppError(
        "REVISION_UNSUPPORTED", "仅支持同一文本块中格式一致的文字，当前对象不能自动修订。", 422
    )


def children(node: JsonObject) -> list[JsonObject]:
    return cast(list[JsonObject], node.get("content", []))


def utf16_bytes(text: str) -> bytes:
    if not well_formed(text):
        raise anchor_error()
    return text.encode("utf-16-le")


def utf16_slice(encoded: bytes, start: int, end: int) -> str:
    if start < 0 or start > end or end * 2 > len(encoded):
        raise anchor_error()
    try:
        return encoded[start * 2 : end * 2].decode("utf-16-le")
    except UnicodeDecodeError:
        raise anchor_error() from None


@dataclass(frozen=True)
class TextRun:
    index: int
    start: int
    end: int
    text: str
    marks: list[JsonObject]

    @property
    def locked(self) -> bool:
        return any(mark["type"] == "aiLock" for mark in self.marks)


@dataclass(frozen=True)
class ResolvedSelection:
    document: JsonObject
    block: JsonObject
    start: int
    text: str
    encoded: bytes
    runs: list[TextRun]
    selected_run: TextRun

    def slice(self, start: int, end: int) -> str:
        left, right = start - self.start, end - self.start
        return utf16_slice(self.encoded, left, right)


def resolve_selection(document: JsonObject, selection: RevisionSelection) -> ResolvedSelection:
    fixed = canonical_editor_json(document)
    node = fixed
    content_start = 0
    for index in selection.textblock_path:
        content = children(node)
        if index >= len(content):
            raise anchor_error()
        position = content_start + sum(node_size(sibling) for sibling in content[:index])
        node = content[index]
        content_start = position + 1
    if node["type"] not in {"paragraph", "heading"}:
        raise unsupported()
    content = children(node)
    if not content or any(child["type"] != "text" for child in content):
        raise unsupported()
    runs: list[TextRun] = []
    cursor = content_start
    for index, child in enumerate(content):
        text = cast(str, child["text"])
        end = cursor + utf16_length(text)
        runs.append(
            TextRun(index, cursor, end, text, cast(list[JsonObject], child.get("marks", [])))
        )
        cursor = end
    text = "".join(run.text for run in runs)
    if (
        selection.from_position >= selection.to
        or selection.to - selection.from_position > MAX_SELECTION_UNITS
        or not well_formed(selection.text)
    ):
        raise anchor_error()
    encoded = utf16_bytes(text)
    left, right = selection.from_position - content_start, selection.to - content_start
    if utf16_slice(encoded, left, right) != selection.text:
        raise anchor_error()
    selected = next(
        (run for run in runs if run.start <= selection.from_position < selection.to <= run.end),
        None,
    )
    if selected is None:
        raise unsupported()
    return ResolvedSelection(fixed, node, content_start, text, encoded, runs, selected)


def apply_patches(resolved: ResolvedSelection, patches: list[RevisionPatch]) -> JsonObject:
    """Only called after protection; edit one run and retain surrounding marks/structure."""
    run = resolved.selected_run
    encoded = utf16_bytes(run.text)
    for patch in sorted(patches, key=lambda item: item.from_position, reverse=True):
        left, right = patch.from_position - run.start, patch.to - run.start
        utf16_slice(encoded, left, right)
        encoded = encoded[: left * 2] + utf16_bytes(patch.after) + encoded[right * 2 :]
    text = encoded.decode("utf-16-le")
    content = children(resolved.block)
    replacement = content[run.index].copy()
    replacement["text"] = text
    edited = content[: run.index] + ([replacement] if text else []) + content[run.index + 1 :]
    merged: list[JsonObject] = []
    for node in edited:
        if merged and merged[-1].get("marks", []) == node.get("marks", []):
            merged[-1] = {
                **merged[-1],
                "text": cast(str, merged[-1]["text"]) + cast(str, node["text"]),
            }
        else:
            merged.append(node)
    if merged:
        resolved.block["content"] = cast(list[EditorJsonValue], merged)
    else:
        resolved.block.pop("content", None)
    return canonical_editor_json(resolved.document)
