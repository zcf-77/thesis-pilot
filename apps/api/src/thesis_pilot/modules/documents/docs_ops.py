"""Minimal MuffinOffice Docs op subset, semantically equal to ``crates/office-ops``.

Supported: ``doc.replace_text``, ``doc.set_inlines``, ``doc.set_heading_level``,
``doc.set_para_props``, ``doc.apply_style``, ``doc.insert_block``, ``doc.replace_block``.
A transaction is atomic: every op is parsed first, then applied to a copy; any failure
leaves the input untouched. Error texts reproduce the kernel's ``OpsError`` display so
the shared golden ``error`` substrings match. New node ids come from a port of the
kernel's deterministic ``IdGen`` (ULID, xorshift128+ seeded by splitmix64).
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Annotated, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.docs_model import (
    JsonDict,
    JsonValue,
    canonical_block,
    canonical_inlines,
    canonical_para_props,
)

MASK64 = (1 << 64) - 1
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
SUPPORTED_OPS = (
    "doc.replace_text",
    "doc.set_inlines",
    "doc.set_heading_level",
    "doc.set_para_props",
    "doc.apply_style",
    "doc.insert_block",
    "doc.replace_block",
)
# Paragraph properties a server-built candidate may change (restricted mode).
PARA_PROPS_WHITELIST = frozenset(
    {"align", "spacing", "indent", "keepWithNext", "keepLines", "pageBreakBefore"}
)


class DocOpsError(Exception):
    """Kernel ``OpsError`` equivalent; ``code`` is not_found/invalid/json/not_allowed."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def ops_app_error(error: DocOpsError) -> AppError:
    if error.code == "not_found":
        return AppError("DOCMODEL_OP_TARGET_MISSING", "候选指向的正文节点已不存在。", 409)
    if error.code == "not_allowed":
        return AppError("DOCMODEL_OP_NOT_ALLOWED", "候选包含不允许的正文修改。", 422)
    return AppError("DOCMODEL_OP_INVALID", "候选修改无法应用到该正文版本。", 422)


# ---------- ids ----------


class IdGen:
    """Port of ``office_model::IdGen``: same seed + clock → same ULID sequence."""

    def __init__(self, seed: int) -> None:
        z = (seed + 0x9E3779B97F4A7C15) & MASK64

        def splitmix() -> int:
            nonlocal z
            z = (z + 0x9E3779B97F4A7C15) & MASK64
            x = z
            x = ((x ^ (x >> 30)) * 0xBF58476D1CE4E5B9) & MASK64
            x = ((x ^ (x >> 27)) * 0x94D049BB133111EB) & MASK64
            return x ^ (x >> 31)

        self.s0 = splitmix() | 1
        self.s1 = splitmix() | 1
        self.last_ms = MASK64
        self.last_rand = 0

    def _rand64(self) -> int:
        x, y = self.s0, self.s1
        self.s0 = y
        x = (x ^ (x << 23)) & MASK64
        self.s1 = x ^ y ^ (x >> 17) ^ (y >> 26)
        return (self.s1 + y) & MASK64

    def next(self, now_ms: int) -> str:
        ms = now_ms & ((1 << 48) - 1)
        if ms == self.last_ms:
            rand80 = (self.last_rand + 1) & ((1 << 80) - 1)
        else:
            high = self._rand64() & 0xFFFF
            low = self._rand64()
            rand80 = (high << 64) | low
        self.last_ms, self.last_rand = ms, rand80
        value = (ms << 80) | rand80
        chars = []
        for _ in range(26):
            chars.append(CROCKFORD[value & 31])
            value >>= 5
        return "".join(reversed(chars))


@dataclass
class OpsContext:
    ids: IdGen
    now_ms: int
    new_ids: list[str] = field(default_factory=list)

    def fresh_id(self) -> str:
        node_id = self.ids.next(self.now_ms)
        self.new_ids.append(node_id)
        return node_id

    def assign_block_id(self, block: object) -> None:
        """``Ctx::assign_block_id`` over authored JSON, before strict parsing."""
        if not isinstance(block, dict):
            return
        if block.get("id") == "":
            block["id"] = self.fresh_id()
        kind = block.get("type")
        if kind in {"quote", "container"}:
            self.assign_ids(block.get("blocks"))
        elif kind == "list":
            for item in _list_of(block.get("items")):
                if isinstance(item, dict):
                    if item.get("id") == "":
                        item["id"] = self.fresh_id()
                    self.assign_ids(item.get("blocks"))
        elif kind == "table":
            for row in _list_of(block.get("rows")):
                if not isinstance(row, dict):
                    continue
                if row.get("id") == "":
                    row["id"] = self.fresh_id()
                for cell in _list_of(row.get("cells")):
                    if isinstance(cell, dict):
                        if cell.get("id") == "":
                            cell["id"] = self.fresh_id()
                        self.assign_ids(cell.get("blocks"))

    def assign_ids(self, blocks: object) -> None:
        for block in _list_of(blocks):
            self.assign_block_id(block)


def _list_of(value: object) -> list[object]:
    return value if isinstance(value, list) else []


# ---------- op parsing ----------


class OpModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=False)


NodeIdText = Annotated[str, Field(strict=True)]
U32 = Annotated[int, Field(ge=0, le=4294967295, strict=True)]


class CharRange(OpModel):
    start: U32
    end: U32


class PositionStart(OpModel):
    kind: Literal["start"]


class PositionEnd(OpModel):
    kind: Literal["end"]


class PositionIndex(OpModel):
    kind: Literal["index"]
    index: Annotated[int, Field(ge=0, strict=True)]


class PositionBefore(OpModel):
    kind: Literal["before"]
    id: NodeIdText


class PositionAfter(OpModel):
    kind: Literal["after"]
    id: NodeIdText


Position = Annotated[
    PositionStart | PositionEnd | PositionIndex | PositionBefore | PositionAfter,
    Field(discriminator="kind"),
]


class ReplaceText(OpModel):
    op: Literal["doc.replace_text"]
    id: NodeIdText
    range: CharRange | None = None
    text: Annotated[str, Field(strict=True)]


class SetInlines(OpModel):
    op: Literal["doc.set_inlines"]
    id: NodeIdText
    inlines: list[JsonValue]


class ApplyStyle(OpModel):
    op: Literal["doc.apply_style"]
    ids: list[NodeIdText]
    style: Annotated[str, Field(strict=True)]


class SetHeadingLevel(OpModel):
    op: Literal["doc.set_heading_level"]
    id: NodeIdText
    level: Annotated[int, Field(ge=0, le=255, strict=True)]


class SetParaProps(OpModel):
    op: Literal["doc.set_para_props"]
    ids: list[NodeIdText]
    props: JsonDict


class InsertBlock(OpModel):
    op: Literal["doc.insert_block"]
    section: NodeIdText | None = None
    at: Position
    block: JsonDict


class ReplaceBlock(OpModel):
    op: Literal["doc.replace_block"]
    id: NodeIdText
    block: JsonDict


Op = Annotated[
    ReplaceText
    | SetInlines
    | ApplyStyle
    | SetHeadingLevel
    | SetParaProps
    | InsertBlock
    | ReplaceBlock,
    Field(discriminator="op"),
]
OPS_ADAPTER: TypeAdapter[list[Op]] = TypeAdapter(list[Op])


@dataclass(frozen=True)
class ParsedOp:
    op: (
        ReplaceText
        | SetInlines
        | ApplyStyle
        | SetHeadingLevel
        | SetParaProps
        | InsertBlock
        | (ReplaceBlock)
    )
    # Canonical payloads parsed up front (serde parses the whole transaction first).
    inlines: list[JsonDict] | None = None
    props: JsonDict | None = None


def parse_ops(raw: object) -> list[ParsedOp]:
    if not isinstance(raw, list):
        raise DocOpsError("json", "transaction JSON: `txn` must be an array")
    unknown = [
        item.get("op")
        for item in raw
        if isinstance(item, dict) and item.get("op") not in SUPPORTED_OPS
    ]
    if unknown:
        raise DocOpsError("unsupported", f"transaction JSON: unsupported op {unknown[0]!r}")
    try:
        ops = OPS_ADAPTER.validate_python(raw)
    except ValidationError as error:
        raise DocOpsError("json", f"transaction JSON: {error.error_count()} errors") from error
    parsed: list[ParsedOp] = []
    for op in ops:
        try:
            if isinstance(op, SetInlines):
                parsed.append(ParsedOp(op, inlines=canonical_inlines(op.inlines)))
            elif isinstance(op, SetParaProps):
                parsed.append(ParsedOp(op, props=canonical_para_props(op.props)))
            else:
                parsed.append(ParsedOp(op))
        except AppError as error:
            raise DocOpsError("json", "transaction JSON: invalid payload") from error
    return parsed


# ---------- document navigation (section bodies only, like the kernel) ----------


def _nested_lists(block: JsonDict) -> list[list[JsonDict]]:
    kind = block.get("type")
    if kind in {"quote", "container"}:
        return [cast(list[JsonDict], block["blocks"])]
    if kind == "list":
        return [
            cast(list[JsonDict], item["blocks"]) for item in cast(list[JsonDict], block["items"])
        ]
    if kind == "table":
        return [
            cast(list[JsonDict], cell["blocks"])
            for row in cast(list[JsonDict], block["rows"])
            for cell in cast(list[JsonDict], row["cells"])
        ]
    return []


def _find_block(blocks: list[JsonDict], node_id: str) -> JsonDict | None:
    for block in blocks:
        if block.get("id") == node_id:
            return block
        for nested in _nested_lists(block):
            found = _find_block(nested, node_id)
            if found is not None:
                return found
    return None


def _find_in_doc(doc: JsonDict, node_id: str) -> JsonDict | None:
    for section in cast(list[JsonDict], doc["sections"]):
        found = _find_block(cast(list[JsonDict], section["blocks"]), node_id)
        if found is not None:
            return found
    return None


def _find_siblings(blocks: list[JsonDict], node_id: str) -> tuple[list[JsonDict], int] | None:
    for index, block in enumerate(blocks):
        if block.get("id") == node_id:
            return blocks, index
    for block in blocks:
        for nested in _nested_lists(block):
            found = _find_siblings(nested, node_id)
            if found is not None:
                return found
    return None


def _find_siblings_in_sections(
    sections: list[JsonDict], node_id: str
) -> tuple[list[JsonDict], int] | None:
    for section in sections:
        blocks = cast(list[JsonDict], section["blocks"])
        if any(block.get("id") == node_id for block in blocks):
            return _find_siblings(blocks, node_id)
    for section in sections:
        found = _find_siblings(cast(list[JsonDict], section["blocks"]), node_id)
        if found is not None:
            return found
    return None


# ---------- inline atoms ----------


@dataclass(frozen=True)
class Atom:
    char: str | None
    props: JsonDict | None = None
    other: JsonDict | None = None


def _flatten(inlines: list[JsonDict]) -> list[Atom]:
    atoms: list[Atom] = []
    for inline in inlines:
        if inline.get("type") == "run":
            props = cast(JsonDict, inline.get("props", {}))
            atoms.extend(Atom(char, props) for char in cast(str, inline["text"]))
        else:
            atoms.append(Atom(None, other=inline))
    return atoms


def _run(text: str, props: JsonDict) -> JsonDict:
    run: JsonDict = {"type": "run", "text": text}
    if props:
        run["props"] = deepcopy(props)
    return run


def _rebuild(atoms: list[Atom]) -> list[JsonDict]:
    out: list[JsonDict] = []
    last_props: JsonDict | None = None
    for atom in atoms:
        if atom.char is None:
            out.append(deepcopy(cast(JsonDict, atom.other)))
            last_props = None
            continue
        props = cast(JsonDict, atom.props)
        if out and last_props is not None and out[-1].get("type") == "run" and last_props == props:
            out[-1]["text"] = cast(str, out[-1]["text"]) + atom.char
            continue
        out.append(_run(atom.char, props))
        last_props = props
    return out


# ---------- paragraph properties ----------

_REPLACED = (
    "style",
    "align",
    "keepWithNext",
    "keepLines",
    "widowControl",
    "autoSpaceDe",
    "autoSpaceDn",
    "pageBreakBefore",
    "outlineLevel",
    "shading",
    "borders",
    "snapToGrid",
    "kinsoku",
    "overflowPunct",
    "topLinePunct",
    "adjustRightInd",
    "listLabel",
)


def merge_para(base: JsonDict, over: JsonDict) -> JsonDict:
    """``doc_ops::merge_para`` on canonical JSON (absent key = ``None``)."""
    result = deepcopy(base)
    for key in _REPLACED:
        if key in over:
            result[key] = deepcopy(over[key])
    for group in ("spacing", "indent"):
        if group in over:
            merged = dict(cast(JsonDict, result.get(group, {})))
            merged.update(deepcopy(cast(JsonDict, over[group])))
            result[group] = merged
    if over.get("tabs"):
        result["tabs"] = deepcopy(over["tabs"])
    if "run" in over:
        run = dict(cast(JsonDict, result.get("run", {})))
        run.update(deepcopy(cast(JsonDict, over["run"])))
        result["run"] = run
    return canonical_para_props(result)


def _set_props(block: JsonDict, props: JsonDict) -> None:
    if props:
        block["props"] = props
    else:
        block.pop("props", None)


# ---------- apply ----------


def _not_found(index: int, name: str, node_id: str) -> DocOpsError:
    return DocOpsError("not_found", f"op #{index} {name}: node not found: {node_id}")


def _invalid(index: int, name: str, message: str) -> DocOpsError:
    return DocOpsError("invalid", f"op #{index} {name}: {message}")


def _require(doc: JsonDict, node_id: str, index: int, name: str) -> JsonDict:
    block = _find_in_doc(doc, node_id)
    if block is None:
        raise _not_found(index, name, node_id)
    return block


def _inlines_of(block: JsonDict, index: int, name: str) -> list[JsonDict]:
    if block.get("type") not in {"paragraph", "heading"}:
        raise _invalid(index, name, "block has no inline text (not a paragraph/heading)")
    return cast(list[JsonDict], block["inlines"])


def _para_target(block: JsonDict, index: int, name: str) -> None:
    if block.get("type") not in {"paragraph", "heading"}:
        raise _invalid(index, name, "block has no paragraph properties")


def _authored_block(raw: JsonDict, ctx: OpsContext, inherit: str | None = None) -> JsonDict:
    block = deepcopy(raw)
    if inherit is not None and block.get("id") == "":
        block["id"] = inherit
    ctx.assign_block_id(block)
    return canonical_block(block)


def _apply(doc: JsonDict, parsed: ParsedOp, index: int, ctx: OpsContext) -> None:
    op = parsed.op
    name = op.op
    if isinstance(op, ReplaceText):
        inlines = _inlines_of(_require(doc, op.id, index, name), index, name)
        if op.range is None:
            props = next(
                (cast(JsonDict, i.get("props", {})) for i in inlines if i.get("type") == "run"),
                {},
            )
            kept = [inline for inline in inlines if inline.get("type") == "bookmark"]
            inlines[:] = [*kept, _run(op.text, props)]
            return
        atoms = _flatten(inlines)
        start, end = op.range.start, op.range.end
        if start > end or end > len(atoms):
            raise _invalid(index, name, f"range {start}..{end} out of 0..{len(atoms)}")
        source = atoms[start] if start < len(atoms) else atoms[max(start - 1, 0)] if atoms else None
        props = cast(JsonDict, source.props) if source is not None and source.char else {}
        atoms[start:end] = [Atom(char, props) for char in op.text]
        inlines[:] = _rebuild(atoms)
    elif isinstance(op, SetInlines):
        block = _require(doc, op.id, index, name)
        _inlines_of(block, index, name)
        block["inlines"] = deepcopy(cast(list[JsonValue], parsed.inlines))
    elif isinstance(op, ApplyStyle):
        for node_id in op.ids:
            block = _require(doc, node_id, index, name)
            _para_target(block, index, name)
            props = dict(cast(JsonDict, block.get("props", {})))
            props["style"] = op.style
            _set_props(block, props)
    elif isinstance(op, SetHeadingLevel):
        if not 1 <= op.level <= 6:
            raise _invalid(index, name, f"level {op.level} out of 1..=6")
        block = _require(doc, op.id, index, name)
        if block.get("type") == "heading":
            block["level"] = op.level
        elif block.get("type") == "paragraph":
            rebuilt: JsonDict = {"type": "heading", "id": block["id"], "level": op.level}
            if "props" in block:
                rebuilt["props"] = block["props"]
            rebuilt["inlines"] = block["inlines"]
            block.clear()
            block.update(rebuilt)
        else:
            raise _invalid(index, name, "not a paragraph or heading")
    elif isinstance(op, SetParaProps):
        over = cast(JsonDict, parsed.props)
        for node_id in op.ids:
            block = _require(doc, node_id, index, name)
            _para_target(block, index, name)
            _set_props(block, merge_para(cast(JsonDict, block.get("props", {})), over))
    elif isinstance(op, InsertBlock):
        sections = cast(list[JsonDict], doc["sections"])
        if op.section is None:
            if not sections:
                raise _invalid(index, name, "document has no sections")
            section_index = 0
        else:
            found = next((i for i, s in enumerate(sections) if s.get("id") == op.section), None)
            if found is None:
                raise _not_found(index, name, op.section)
            section_index = found
        block = _authored_block(op.block, ctx)
        at = op.at
        if isinstance(at, PositionBefore | PositionAfter):
            scope = sections[section_index : section_index + 1] if op.section else sections
            located = _find_siblings_in_sections(scope, at.id)
            if located is None:
                raise _not_found(index, name, at.id)
            siblings, position = located
            siblings.insert(position + int(isinstance(at, PositionAfter)), block)
        else:
            blocks = cast(list[JsonDict], sections[section_index]["blocks"])
            if isinstance(at, PositionStart):
                position = 0
            elif isinstance(at, PositionEnd):
                position = len(blocks)
            else:
                position = min(at.index, len(blocks))
            blocks.insert(position, block)
    elif isinstance(op, ReplaceBlock):
        block = _authored_block(op.block, ctx, inherit=op.id)
        located = _find_siblings_in_sections(cast(list[JsonDict], doc["sections"]), op.id)
        if located is None:
            raise _not_found(index, name, op.id)
        siblings, position = located
        siblings[position] = block


@dataclass(frozen=True)
class OpsResult:
    model: JsonDict
    new_ids: list[str]


def apply_ops(
    model: JsonDict,
    ops: object,
    *,
    ids: IdGen,
    now_ms: int,
    restricted: bool = False,
) -> OpsResult:
    """Apply a transaction to a copy of a canonical model (input is never mutated).

    ``restricted`` enforces the ThesisPilot candidate policy (whitelisted paragraph
    properties); conformance runs use the unrestricted kernel semantics.
    """
    parsed = parse_ops(ops)
    if restricted:
        for item in parsed:
            if isinstance(item.op, SetParaProps) and set(cast(JsonDict, item.props)) - (
                PARA_PROPS_WHITELIST
            ):
                raise DocOpsError("not_allowed", "op doc.set_para_props: field not allowed")
    work = deepcopy(model)
    ctx = OpsContext(ids=ids, now_ms=now_ms)
    for index, item in enumerate(parsed):
        try:
            _apply(work, item, index, ctx)
        except AppError as error:
            raise DocOpsError("invalid", f"op #{index} {item.op.op}: invalid block") from error
    return OpsResult(work, ctx.new_ids)
