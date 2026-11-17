"""Pure conversion of an office-server DOCX import into a ThesisPilot v2 snapshot.

Inputs are the ``/v1/parse`` result (DocsModel + unsupported/preserved/converted) and the
``/v1/docs/inspect`` irMap of the same original bytes. Node ids are the importer's seeded
ids, identical in both responses, so the irMap binds model paragraphs to source paths.

* Embedded image bytes move out of the model into content-addressed resources.
* Body constructs the importer drops (OMML formulas, VML, fields …) become whole-block
  ``object`` protections on the block that holds them; the original keeps the real object
  for preserve-original export. Every loss is listed in the loss report.
"""

from __future__ import annotations

import base64
import binascii
import re
from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, cast

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.docs_model import (
    resource_uri,
    top_blocks,
    validate_snapshot,
)
from thesis_pilot.modules.documents.resources import MAX_RESOURCE_BYTES, SNIFFERS

Obj = dict[str, Any]

OFFICE_IMPORT_CONVERTER = "office-import-v1"
BODY_PATH = re.compile(r"^word/document\.xml/body/(\d+)(?:/|$)")
MAX_LOSSES = 500
MAX_IR_ENTRIES = 100_000

KIND_LABELS = {
    "docx.theme": (
        "原文主题与命名样式只保留支持的部分，编辑器按内置主题显示；保留原件导出不受影响。"
    ),
    "docx.inline": "公式、域、内容控件等行内对象未导入编辑器，所在段落已整块保护，原件中保留。",
    "docx.block": "不支持的块级对象未导入编辑器，所在位置已整块保护，原件中保留。",
    "docx.field_cached": "域只保留显示文字，不保留域代码。",
    "docx.image": "图片格式不受支持，未导入编辑器，原件中保留。",
    "resource.unsupported": "图片格式不受支持，未导入编辑器，所在段落已整块保护，原件中保留。",
    "converted": "原文样式继承已展开为逐段格式。",
}


def office_import_invalid() -> AppError:
    return AppError(
        "OFFICE_IMPORT_INVALID", "边车返回的导入结果与原件映射不一致，未生成导入预览。", 422
    )


@dataclass(frozen=True)
class ImportedResource:
    sha256: str
    mime: str
    data: bytes
    width_px: int
    height_px: int


@dataclass(frozen=True)
class ImportBuild:
    snapshot: Obj
    ir_map: Obj
    resources: list[ImportedResource]
    losses: list[Obj]


def _label(kind: str) -> str:
    return KIND_LABELS.get(kind, "该对象未导入编辑器，原件中保留。")


def _ir_map(raw: object, source_sha256: str) -> Obj:
    if not isinstance(raw, dict) or raw.get("sourceSha256") != source_sha256:
        raise office_import_invalid()
    entries = raw.get("entries")
    if not isinstance(entries, list) or len(entries) > MAX_IR_ENTRIES:
        raise office_import_invalid()
    clean: list[Obj] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise office_import_invalid()
        path, node, equal = entry.get("path"), entry.get("nodeId"), entry.get("textEqual")
        objects = entry.get("objects", [])
        if (
            not isinstance(path, str)
            or not isinstance(node, str)
            or not isinstance(equal, bool)
            or not isinstance(objects, list)
            or not all(type(item) is int and item >= 0 for item in objects)
        ):
            raise office_import_invalid()
        clean.append({"path": path, "node": node, "eq": equal, "objects": objects})
    return {
        "bridgeVersion": str(raw.get("bridgeVersion", ""))[:40],
        "sourceSha256": source_sha256,
        "entries": clean,
    }


def _ids(value: object) -> set[str]:
    found: set[str] = set()
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            identity = item.get("id")
            if isinstance(identity, str):
                found.add(identity)
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
    return found


def _resources(model: Obj, losses: list[Obj]) -> tuple[list[ImportedResource], set[str]]:
    kept: list[Obj] = []
    imported: dict[str, ImportedResource] = {}
    dropped: set[str] = set()
    for resource in cast(list[Obj], model.get("resources", [])):
        data = cast(Obj, resource.get("data") or {})
        resource_id = cast(str, resource.get("id"))
        mime = resource.get("mime")
        raw: bytes | None = None
        if data.get("kind") == "bytes" and isinstance(data.get("value"), str):
            try:
                raw = base64.b64decode(cast(str, data["value"]), validate=True)
            except (binascii.Error, ValueError):
                raw = None
        sniffer = SNIFFERS.get(mime) if isinstance(mime, str) else None
        size = sniffer(raw) if raw and sniffer and len(raw) <= MAX_RESOURCE_BYTES else None
        if raw is None or size is None or not all(0 < value <= 100000 for value in size):
            dropped.add(resource_id)
            losses.append(
                {
                    "kind": "resource.unsupported",
                    "path": str(resource.get("name") or resource_id)[:200],
                    "label": _label("resource.unsupported"),
                    "action": "protected",
                }
            )
            continue
        digest = sha256(raw).hexdigest()
        imported.setdefault(
            digest, ImportedResource(digest, cast(str, mime), raw, size[0], size[1])
        )
        entry = {key: value for key, value in resource.items() if key != "data"}
        entry["data"] = {"kind": "uri", "value": resource_uri(digest)}
        entry["sha256"] = digest
        entry["widthPx"] = size[0]
        entry["heightPx"] = size[1]
        kept.append(entry)
    model["resources"] = kept
    return list(imported.values()), dropped


def _strip_dropped(blocks: list[Obj], dropped: set[str], hit: set[str]) -> None:
    """Remove image references to dropped resources; the block id is remembered."""
    for index, block in enumerate(blocks):
        if block.get("type") == "image" and block.get("resource") in dropped:
            blocks[index] = {"type": "paragraph", "id": block["id"], "inlines": []}
            hit.add(cast(str, block["id"]))
            continue
        for key in ("inlines", "caption"):
            inlines = block.get(key)
            if isinstance(inlines, list):
                kept = [
                    item
                    for item in inlines
                    if not (item.get("type") == "image" and item.get("resource") in dropped)
                ]
                if len(kept) != len(inlines):
                    block[key] = kept
                    hit.add(cast(str, block["id"]))
        for nested_key, child_key in (("blocks", None), ("items", "blocks"), ("rows", "cells")):
            nested = block.get(nested_key)
            if not isinstance(nested, list):
                continue
            if child_key is None:
                _strip_dropped(cast(list[Obj], nested), dropped, hit)
            elif nested_key == "items":
                for item in cast(list[Obj], nested):
                    _strip_dropped(cast(list[Obj], item["blocks"]), dropped, hit)
            else:
                for row in cast(list[Obj], nested):
                    for cell in cast(list[Obj], row["cells"]):
                        _strip_dropped(cast(list[Obj], cell["blocks"]), dropped, hit)


def _top_of(model: Obj) -> dict[str, str]:
    owner: dict[str, str] = {}
    for block in top_blocks(model):
        top = cast(str, block["id"])
        for identity in _ids(block):
            owner[identity] = top
    return owner


def build_import(
    parse_model: Obj,
    unsupported: list[Obj],
    converted: list[str],
    raw_ir_map: object,
    source_sha256: str,
) -> ImportBuild:
    model = deepcopy(parse_model)
    ir_map = _ir_map(raw_ir_map, source_sha256)
    losses: list[Obj] = []
    resources, dropped = _resources(model, losses)
    protect_nodes: list[str] = []
    if dropped:
        hit: set[str] = set()
        for section in cast(list[Obj], model.get("sections", [])):
            _strip_dropped(cast(list[Obj], section.get("blocks", [])), dropped, hit)
        protect_nodes.extend(sorted(hit))
    owner = _top_of(model)
    by_path = {cast(str, entry["path"]): cast(str, entry["node"]) for entry in ir_map["entries"]}
    for item in unsupported[:MAX_LOSSES]:
        kind = str(item.get("kind", "unknown"))[:80]
        path = str(item.get("path", ""))[:200]
        loss: Obj = {"kind": kind, "path": path, "label": _label(kind), "action": "noted"}
        matched = BODY_PATH.match(path)
        if matched:
            index = matched.group(1)
            node = by_path.get(f"b{index}") or next(
                (node for source, node in by_path.items() if source.startswith(f"b{index}/")),
                None,
            )
            target = owner.get(node) if node is not None else None
            if target is not None:
                protect_nodes.append(target)
                loss["node_id"] = target
                loss["action"] = "protected"
        losses.append(loss)
    if converted:
        # Kernel conversion notes are English internals; one localized entry is shown.
        losses.append(
            {"kind": "converted", "path": "", "label": _label("converted"), "action": "noted"}
        )
    seen: set[str] = set()
    protections: list[Obj] = []
    for node in protect_nodes:
        top = owner.get(node, node)
        if top in seen:
            continue
        seen.add(top)
        protections.append({"id": f"object-{top}", "kind": "object", "anchor": {"node": top}})
    model.pop("unsupported", None)
    try:
        snapshot = validate_snapshot(
            {"schemaVersion": 2, "model": model, "protections": protections}
        )
    except AppError as error:
        raise AppError(
            "OFFICE_IMPORT_MODEL_INVALID",
            "原件解析结果不符合编辑器支持的正文结构，未生成导入预览。",
            422,
        ) from error
    return ImportBuild(snapshot, ir_map, resources, losses[:MAX_LOSSES])
