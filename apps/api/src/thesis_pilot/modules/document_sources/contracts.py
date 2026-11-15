"""Frozen chapter overlays over an unchanged original parsing manifest.

Only initial import may correct supported paragraph/heading fields. Subsequent
validation checks the target fields, reverses them on a temporary copy, and asks
the original parser guard to validate every protected source slot and structure.
"""

from __future__ import annotations

import json
from copy import deepcopy
from hashlib import sha256
from typing import TYPE_CHECKING, Annotated, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.structure import JsonObject, canonical_editor_json
from thesis_pilot.parsers.materials import validate_projection
from thesis_pilot.parsers.schemas import ParsedMaterial, SourceAnchor

if TYPE_CHECKING:
    from thesis_pilot.modules.document_sources.schemas import ChapterCorrection

GUARD_VERSION: Literal["source-projection-v1"] = "source-projection-v1"
Index = Annotated[int, Field(ge=0, strict=True)]
EditorPath = Annotated[list[Index], Field(min_length=1, max_length=80)]


class ChapterOverlay(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    anchor_id: str
    editor_path: EditorPath
    original_type: Literal["paragraph", "heading"]
    original_attrs: JsonObject | None
    target_type: Literal["paragraph", "heading"]
    target_attrs: JsonObject | None


class SourceGuardContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    guard_version: Literal["source-projection-v1"] = GUARD_VERSION
    parser_version: Literal["thesispilot-material-1"] = "thesispilot-material-1"
    manifest_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    skeleton_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    editable_paths: list[EditorPath] = Field(max_length=20000)
    chapter_overrides: list[ChapterOverlay] = Field(max_length=1000)


def guard_invalid() -> AppError:
    return AppError(
        "DOCUMENT_SOURCE_GUARD_INVALID", "正式稿来源保护映射缺失或不一致，当前稿保持不变。", 409
    )


def protected() -> AppError:
    return AppError(
        "DOCUMENT_SOURCE_PROTECTED",
        "此原件仅支持映射文字编辑，章节、格式和受保护对象保持不变。",
        409,
    )


def chapter_invalid() -> AppError:
    return AppError(
        "DOCUMENT_SOURCE_CHAPTER_INVALID", "章节校正仅支持唯一可编辑来源段落及 1—6 级标题。", 422
    )


def manifest_sha256(manifest: JsonObject | None) -> str:
    if manifest is None:
        raise guard_invalid()
    return sha256(
        json.dumps(manifest, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def node_at(document: JsonObject, path: list[int]) -> JsonObject:
    node = document
    for index in path:
        content = node.get("content")
        if (
            type(index) is not int
            or index < 0
            or not isinstance(content, list)
            or index >= len(content)
        ):
            raise guard_invalid()
        part = content[index]
        if not isinstance(part, dict):
            raise guard_invalid()
        node = part
    return node


def _attrs(node: JsonObject) -> JsonObject | None:
    attrs = node.get("attrs")
    if attrs is not None and not isinstance(attrs, dict):
        raise guard_invalid()
    return deepcopy(attrs)


def _base(parsed: ParsedMaterial) -> tuple[JsonObject, list[list[int]]]:
    if parsed.editor_json is None or parsed.roundtrip_manifest is None:
        raise guard_invalid()
    try:
        document = canonical_editor_json(parsed.editor_json)
        validate_projection(parsed, document)
        paths = SourceGuardContract.model_validate(
            {
                "manifest_sha256": manifest_sha256(parsed.roundtrip_manifest),
                "skeleton_sha256": parsed.roundtrip_manifest.get("skeleton_sha256"),
                "editable_paths": parsed.roundtrip_manifest.get("editable_paths"),
                "chapter_overrides": [],
            }
        ).editable_paths
    except (AppError, ValidationError, TypeError, ValueError) as error:
        raise guard_invalid() from error
    if len({tuple(path) for path in paths}) != len(paths):
        raise guard_invalid()
    return document, paths


def _anchor(parsed: ParsedMaterial, anchor_id: str, paths: list[list[int]]) -> SourceAnchor:
    matches = [source for source in parsed.anchors if source.id == anchor_id]
    if len(matches) != 1:
        raise chapter_invalid()
    source = matches[0]
    if (
        not source.editable
        or source.kind not in {"text", "paragraph", "heading"}
        or source.editor_path is None
        or source.editor_path not in paths
        or sum(item.editor_path == source.editor_path for item in parsed.anchors) != 1
    ):
        raise chapter_invalid()
    return source


def _target_fields(
    original: JsonObject, anchor_id: str, kind: str, level: int | None
) -> tuple[Literal["paragraph", "heading"], JsonObject | None]:
    if original.get("type") not in {"paragraph", "heading"}:
        raise chapter_invalid()
    if kind == "paragraph" and level is None:
        return "paragraph", None
    if kind != "heading" or type(level) is not int or not 1 <= level <= 6:
        raise chapter_invalid()
    old = _attrs(original) or {}
    chapter_id = old.get("chapterId")
    if original.get("type") != "heading":
        chapter_id = "chapter-" + sha256(anchor_id.encode()).hexdigest()[:32]
    if not isinstance(chapter_id, str) or not chapter_id:
        raise chapter_invalid()
    return "heading", {
        "level": level,
        "chapterId": chapter_id,
        "templateAlign": old.get("templateAlign"),
        "templateWeight": old.get("templateWeight"),
    }


def _set_fields(node: JsonObject, kind: str, attrs: JsonObject | None) -> None:
    node["type"] = kind
    if attrs is None:
        node.pop("attrs", None)
    else:
        node["attrs"] = deepcopy(attrs)


def build_import_projection(
    parsed: ParsedMaterial, corrections: list[ChapterCorrection]
) -> tuple[JsonObject, JsonObject]:
    document, paths = _base(parsed)
    manifest = parsed.roundtrip_manifest
    if manifest is None:
        raise guard_invalid()
    if len(corrections) > 1000 or len({item.anchor_id for item in corrections}) != len(corrections):
        raise chapter_invalid()
    overlays: list[ChapterOverlay] = []
    for correction in corrections:
        source = _anchor(parsed, correction.anchor_id, paths)
        assert source.editor_path is not None
        node = node_at(document, source.editor_path)
        original_type = cast(Literal["paragraph", "heading"], node["type"])
        original_attrs = _attrs(node)
        kind, attrs = _target_fields(node, source.id, correction.kind, correction.level)
        overlays.append(
            ChapterOverlay(
                anchor_id=source.id,
                editor_path=source.editor_path,
                original_type=original_type,
                original_attrs=original_attrs,
                target_type=kind,
                target_attrs=attrs,
            )
        )
        _set_fields(node, kind, attrs)
    contract = SourceGuardContract(
        manifest_sha256=manifest_sha256(parsed.roundtrip_manifest),
        editable_paths=paths,
        skeleton_sha256=cast(str, manifest["skeleton_sha256"]),
        chapter_overrides=overlays,
    )
    projection = canonical_editor_json(document)
    serialized = cast(JsonObject, contract.model_dump(mode="json"))
    validate_guard_contract(parsed, serialized, projection)
    return projection, serialized


def build_guard_contract(
    parsed: ParsedMaterial, corrections: list[ChapterCorrection]
) -> JsonObject:
    return build_import_projection(parsed, corrections)[1]


def validate_guard_contract(
    parsed: ParsedMaterial, contract: JsonObject, document: JsonObject
) -> None:
    original, paths = _base(parsed)
    manifest = parsed.roundtrip_manifest
    if manifest is None:
        raise guard_invalid()
    try:
        frozen = SourceGuardContract.model_validate(contract)
    except ValidationError as error:
        raise guard_invalid() from error
    if (
        frozen.manifest_sha256 != manifest_sha256(parsed.roundtrip_manifest)
        or frozen.skeleton_sha256 != manifest["skeleton_sha256"]
        or frozen.editable_paths != paths
        or frozen.parser_version != parsed.parser_version
        or len({tuple(item.editor_path) for item in frozen.chapter_overrides})
        != len(frozen.chapter_overrides)
        or len({item.anchor_id for item in frozen.chapter_overrides})
        != len(frozen.chapter_overrides)
    ):
        raise guard_invalid()
    try:
        candidate = canonical_editor_json(document)
    except AppError as error:
        raise protected() from error
    for overlay in frozen.chapter_overrides:
        try:
            source = _anchor(parsed, overlay.anchor_id, paths)
            if source.editor_path != overlay.editor_path:
                raise guard_invalid()
            base_node = node_at(original, overlay.editor_path)
            if overlay.original_type != base_node["type"] or overlay.original_attrs != _attrs(
                base_node
            ):
                raise guard_invalid()
            target_type, target_attrs = _target_fields(
                base_node,
                source.id,
                overlay.target_type,
                cast(int | None, (overlay.target_attrs or {}).get("level")),
            )
            if target_type != overlay.target_type or target_attrs != overlay.target_attrs:
                raise guard_invalid()
        except AppError as error:
            raise guard_invalid() from error
        node = node_at(candidate, overlay.editor_path)
        if node.get("type") != overlay.target_type or _attrs(node) != overlay.target_attrs:
            raise protected()
        _set_fields(node, overlay.original_type, overlay.original_attrs)
    try:
        validate_projection(parsed, canonical_editor_json(candidate))
    except AppError as error:
        raise protected() from error
