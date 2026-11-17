"""Preserve-original DOCX export plan: baseline (import) model → target model, per node.

Only same-paragraph text changes of paragraphs the irMap binds to a source path with equal
text are written into the original (``text.replace`` / ``text.insert`` / ``text.delete``,
UTF-16 offsets of the source's final view). Everything else the original cannot express
this way — formatting, inserted/removed/reordered blocks, inline objects, tables, images,
page setup — is listed as an unsupported change; nothing is dropped silently.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, cast

from thesis_pilot.modules.documents.docs_model import (
    find_block,
    top_blocks,
    walk_blocks,
)

Obj = dict[str, Any]

TEXT_BLOCKS = frozenset({"paragraph", "heading"})
MAX_UNSUPPORTED = 500


def utf16_len(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def source_text(inlines: list[Obj]) -> str:
    """The source index projection: run text, break → newline, tab → tab; objects excluded."""
    parts: list[str] = []
    for inline in inlines:
        kind = inline.get("type")
        if kind == "run":
            parts.append(cast(str, inline["text"]))
        elif kind == "break":
            parts.append("\n")
        elif kind == "tab":
            parts.append("\t")
    return "".join(parts)


def _objects(inlines: list[Obj]) -> list[Obj]:
    return [item for item in inlines if item.get("type") not in {"run", "break", "tab"}]


def _format_signature(block: Obj) -> object:
    """Block type/level/props and the set of run formats; text is excluded."""
    inlines = cast(list[Obj], block.get("inlines", []))
    run_props = sorted(
        {
            repr(sorted(cast(Obj, item.get("props", {})).items()))
            for item in inlines
            if item.get("type") == "run" and item.get("text")
        }
    )
    rest = {key: value for key, value in block.items() if key not in {"inlines", "id"}}
    return (repr(sorted(rest.items())), run_props)


def _excerpt(block: Obj | None) -> str:
    if block is None:
        return ""
    text = (
        source_text(cast(list[Obj], block.get("inlines", [])))
        if block.get("type") in TEXT_BLOCKS
        else ""
    )
    return " ".join(text.split())[:40]


@dataclass
class PreservePlan:
    ops: list[Obj] = field(default_factory=list)
    unsupported: list[Obj] = field(default_factory=list)
    # op id → node id, for reporting rejected ops.
    op_nodes: dict[str, str] = field(default_factory=dict)

    def note(self, kind: str, detail: str, node_id: str | None = None) -> None:
        if len(self.unsupported) < MAX_UNSUPPORTED:
            self.unsupported.append({"kind": kind, "node_id": node_id, "detail": detail})


def _diff_op(op_id: str, path: str, before: str, after: str) -> Obj | None:
    if before == after:
        return None
    prefix = 0
    limit = min(len(before), len(after))
    while prefix < limit and before[prefix] == after[prefix]:
        prefix += 1
    suffix = 0
    while (
        suffix < limit - prefix
        and before[len(before) - 1 - suffix] == after[len(after) - 1 - suffix]
    ):
        suffix += 1
    old = before[prefix : len(before) - suffix]
    new = after[prefix : len(after) - suffix]
    start = utf16_len(before[:prefix])
    end = start + utf16_len(old)
    target = {"path": path, "start": start, "end": end}
    if not old:
        return {"op": "text.insert", "id": op_id, "target": target, "text": new}
    if not new:
        return {"op": "text.delete", "id": op_id, "target": target, "expectedText": old}
    return {
        "op": "text.replace",
        "id": op_id,
        "target": target,
        "expectedText": old,
        "text": new,
    }


def _ids_in_order(model: Obj) -> list[str]:
    return [cast(str, ref.block["id"]) for ref in walk_blocks(model)]


def plan_preserve(baseline: Obj, target: Obj, ir_map: Obj) -> PreservePlan:
    plan = PreservePlan()
    entries = cast(list[Obj], ir_map.get("entries", []))
    mapped = {cast(str, entry["node"]): entry for entry in entries}
    base_ids = _ids_in_order(baseline)
    target_ids = _ids_in_order(target)
    base_set, target_set = set(base_ids), set(target_ids)

    if [item for item in base_ids if item in target_set] != [
        item for item in target_ids if item in base_set
    ]:
        plan.note("order", "段落或对象的先后顺序有变化，原件保持原有顺序。")
    for node_id in target_ids:
        if node_id not in base_set:
            block = find_block(target, node_id)
            plan.note(
                "inserted",
                f"新增的{_kind_label(block)}未写入原件：{_excerpt(block)}".rstrip("："),
                node_id,
            )
    for node_id in base_ids:
        if node_id not in target_set:
            block = find_block(baseline, node_id)
            plan.note(
                "removed",
                f"删除的{_kind_label(block)}在原件中保留：{_excerpt(block)}".rstrip("："),
                node_id,
            )

    for index, node_id in enumerate(base_ids):
        if node_id not in target_set:
            continue
        before = cast(Obj, find_block(baseline, node_id))
        after = cast(Obj, find_block(target, node_id))
        if before.get("type") not in TEXT_BLOCKS or after.get("type") not in TEXT_BLOCKS:
            if before.get("type") in TEXT_BLOCKS or after.get("type") in TEXT_BLOCKS:
                plan.note("structure", "块类型有变化，原件保持原样。", node_id)
            elif _shallow(before) != _shallow(after):
                plan.note("object", f"{_kind_label(after)}的属性有变化，原件保持原样。", node_id)
            continue
        old_inlines = cast(list[Obj], before.get("inlines", []))
        new_inlines = cast(list[Obj], after.get("inlines", []))
        if _format_signature(before) != _format_signature(after):
            plan.note("format", f"格式变化未写入原件：{_excerpt(after)}".rstrip("："), node_id)
        if _objects(old_inlines) != _objects(new_inlines):
            plan.note("inline_object", "段内图片或域等对象有变化，原件保持原样。", node_id)
            continue
        old_text, new_text = source_text(old_inlines), source_text(new_inlines)
        if old_text == new_text:
            continue
        entry = mapped.get(node_id)
        if entry is None or entry.get("eq") is not True:
            plan.note(
                "unmapped",
                f"该段与原件无法逐字对应，文字修改未写入：{_excerpt(after)}".rstrip("："),
                node_id,
            )
            continue
        op = _diff_op(f"n{index}", cast(str, entry["path"]), old_text, new_text)
        if op is not None:
            plan.ops.append(op)
            plan.op_nodes[cast(str, op["id"])] = node_id

    for name in ("meta", "theme"):
        if baseline.get(name) != target.get(name):
            plan.note("document", "文档属性或主题有变化，原件保持原样。")
            break
    base_sections = [_section_props(item) for item in cast(list[Obj], baseline["sections"])]
    target_sections = [_section_props(item) for item in cast(list[Obj], target["sections"])]
    if base_sections != target_sections:
        plan.note("page", "页面设置或页眉页脚有变化，原件保持原样。")
    return plan


def _section_props(section: Obj) -> object:
    return {key: value for key, value in section.items() if key != "blocks"}


def _shallow(block: Obj) -> object:
    """A non-text block without its nested text blocks (those are compared one by one)."""
    if block.get("type") == "table":
        rows = cast(list[Obj], block.get("rows", []))
        return (
            {key: value for key, value in block.items() if key not in {"rows", "caption"}},
            [
                [
                    {key: value for key, value in cell.items() if key != "blocks"}
                    for cell in cast(list[Obj], row["cells"])
                ]
                for row in rows
            ],
        )
    if block.get("type") in {"list", "quote", "container"}:
        return {key: value for key, value in block.items() if key not in {"items", "blocks"}}
    return block


def _kind_label(block: Obj | None) -> str:
    kind = block.get("type") if block else None
    return {
        "paragraph": "段落",
        "heading": "标题",
        "table": "表格",
        "image": "图片",
        "list": "列表",
        "quote": "引用",
        "code_block": "代码块",
        "page_break": "分页符",
        "rule": "分隔线",
        "toc": "目录",
    }.get(cast(str, kind), "内容")


def top_level_count(model: Obj) -> int:
    return len(top_blocks(model))
