"""Pure citation candidate construction and verification over a v2 snapshot.

Managed citation protections (owned by this module, ``kind = "citation"``):

- marker ``tp-cite-mark:<candidate id>``: the in-text ``[n]`` range, binding = entry id;
- reference ``tp-cite-ref:<block id>``: a whole top-level paragraph under the
  references heading whose text is ``[n] <GB/T 7714 rendering>``, binding = entry id.

Invariants (checked on every candidate result, before it is offered and when adopted):
numbers follow the first appearance of each entry among markers in body order; every
marker reads ``[n]``; references hold exactly one block per cited entry, in number order,
all inside the references section; any other protection keeps the ordinary rules.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from hashlib import sha256
from typing import cast
from uuid import UUID

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.citations import gbt7714
from thesis_pilot.modules.documents.docs_model import (
    REFERENCES_TITLE,
    JsonDict,
    JsonValue,
    atom_text,
    canonical_block,
    canonical_inlines,
    compact,
    find_block,
    find_body_node,
    model_of,
    protection_rule_check,
    protections_of,
    run_text,
    top_blocks,
    validate_snapshot,
    walk_blocks,
)
from thesis_pilot.modules.documents.docs_ops import DocOpsError, IdGen, apply_ops

MARKER_PREFIX = "tp-cite-mark:"
REFERENCE_PREFIX = "tp-cite-ref:"
REFERENCES_HEADING = "参考文献"
POLICY_VERSION = f"citations-1/{gbt7714.RENDERER_VERSION}"
SUPERSCRIPT: JsonDict = {"verticalAlign": "superscript"}


def fail(code: str, message: str, status: int = 409) -> AppError:
    return AppError("CITATION_" + code, message, status)


def is_managed(protection: JsonDict) -> bool:
    identifier = cast(str, protection.get("id", ""))
    return protection.get("kind") == "citation" and identifier.startswith(
        (MARKER_PREFIX, REFERENCE_PREFIX)
    )


def digest(value: object) -> str:
    return sha256(compact(value).encode("utf-8")).hexdigest()


# ---------- reading the managed state ----------


@dataclass(frozen=True)
class Marker:
    protection_id: str
    node: str
    start: int
    end: int
    binding: str
    order: tuple[int, int]


@dataclass(frozen=True)
class Reference:
    protection_id: str
    node: str
    binding: str
    top_index: int


@dataclass
class State:
    model: JsonDict
    protections: list[JsonDict]
    heading: JsonDict | None
    heading_index: int | None
    section_end: int
    markers: list[Marker] = field(default_factory=list)
    references: list[Reference] = field(default_factory=list)
    # body order position of every paragraph/heading id
    positions: dict[str, int] = field(default_factory=dict)
    top_of: dict[str, int] = field(default_factory=dict)

    def numbering(self) -> list[str]:
        seen: list[str] = []
        for item in sorted(self.markers, key=lambda marker: marker.order):
            if item.binding not in seen:
                seen.append(item.binding)
        return seen

    def in_references(self, node: str) -> bool:
        top = self.top_of.get(node)
        return (
            self.heading_index is not None
            and top is not None
            and self.heading_index < top < self.section_end
        )


def read_state(snapshot: JsonDict) -> State:
    model = model_of(snapshot)
    top = top_blocks(model)
    heading_index = next(
        (
            index
            for index, block in enumerate(top)
            if block.get("type") == "heading"
            and REFERENCES_TITLE.match(run_text(cast(list[JsonDict], block["inlines"])))
        ),
        None,
    )
    heading = top[heading_index] if heading_index is not None else None
    end = len(top)
    if heading is not None and heading_index is not None:
        level = cast(int, heading["level"])
        end = next(
            (
                index
                for index in range(heading_index + 1, len(top))
                if top[index].get("type") == "heading" and cast(int, top[index]["level"]) <= level
            ),
            len(top),
        )
    state = State(
        model=model,
        protections=[deepcopy(item) for item in protections_of(snapshot)],
        heading=heading,
        heading_index=heading_index,
        section_end=end,
    )
    for position, ref in enumerate(walk_blocks(model)):
        node = cast(str, ref.block["id"])
        state.positions[node] = position
        state.top_of[node] = ref.top_index
    for protection in state.protections:
        if not is_managed(protection):
            continue
        anchor = cast(JsonDict, protection["anchor"])
        node = cast(str, anchor["node"])
        binding = cast(str | None, protection.get("binding"))
        identifier = cast(str, protection["id"])
        if binding is None or node not in state.positions:
            raise state_invalid()
        if identifier.startswith(MARKER_PREFIX):
            start, end_ = anchor.get("start"), anchor.get("end")
            if not isinstance(start, int) or not isinstance(end_, int):
                raise state_invalid()
            state.markers.append(
                Marker(identifier, node, start, end_, binding, (state.positions[node], start))
            )
        else:
            if "start" in anchor or identifier != REFERENCE_PREFIX + node:
                raise state_invalid()
            state.references.append(Reference(identifier, node, binding, state.top_of[node]))
    state.references.sort(key=lambda item: item.top_index)
    return state


def state_invalid() -> AppError:
    return fail(
        "STATE_INVALID",
        "正文中的引用标记或参考文献条目不一致，无法自动编号；请在历史中比较后恢复。",
    )


def _paragraph(model: JsonDict, node: str) -> JsonDict:
    block = find_block(model, node)
    if block is None or block.get("type") not in {"paragraph", "heading"}:
        raise state_invalid()
    return block


def verify(
    snapshot: JsonDict, records: Mapping[str, gbt7714.Record], *, require_complete: bool = True
) -> State:
    """The managed invariants above; raises ``CITATION_STATE_INVALID`` when broken."""
    state = read_state(snapshot)
    numbering = state.numbering()
    numbers = {binding: index + 1 for index, binding in enumerate(numbering)}
    for marker in state.markers:
        text = atom_text(cast(list[JsonDict], _paragraph(state.model, marker.node)["inlines"]))
        if text[marker.start : marker.end] != gbt7714.marker(numbers[marker.binding]):
            raise state_invalid()
        if state.in_references(marker.node):
            raise state_invalid()
    if not state.markers and not state.references:
        return state
    if state.heading is None or [item.binding for item in state.references] != numbering:
        raise state_invalid()
    for item in state.references:
        if not state.in_references(item.node):
            raise state_invalid()
        block = _paragraph(state.model, item.node)
        if require_complete:
            record = records.get(item.binding)
            if record is None:
                raise state_invalid()
            expected = gbt7714.numbered(numbers[item.binding], record)
            if atom_text(cast(list[JsonDict], block["inlines"])) != expected:
                raise state_invalid()
    return state


# ---------- building a candidate ----------


@dataclass(frozen=True)
class Edit:
    start: int
    end: int
    text: str
    props: JsonDict | None  # None: keep the props of the replaced first atom


def _atoms(inlines: list[JsonDict]) -> list[tuple[str | None, JsonDict]]:
    atoms: list[tuple[str | None, JsonDict]] = []
    for inline in inlines:
        if inline.get("type") == "run":
            props = cast(JsonDict, inline.get("props", {}))
            atoms.extend((char, props) for char in cast(str, inline["text"]))
        else:
            atoms.append((None, inline))
    return atoms


def _runs(atoms: list[tuple[str | None, JsonDict]]) -> list[JsonDict]:
    out: list[JsonDict] = []
    last: JsonDict | None = None
    for char, payload in atoms:
        if char is None:
            out.append(deepcopy(payload))
            last = None
        elif out and last is not None and last == payload and out[-1].get("type") == "run":
            out[-1]["text"] = cast(str, out[-1]["text"]) + char
        else:
            run: JsonDict = {"type": "run", "text": char}
            if payload:
                run["props"] = deepcopy(payload)
            out.append(run)
            last = payload
    return out


def _marker_props(atoms: list[tuple[str | None, JsonDict]], offset: int) -> JsonDict:
    neighbour = next(
        (payload for char, payload in reversed(atoms[:offset]) if char is not None),
        next((payload for char, payload in atoms[offset:] if char is not None), {}),
    )
    props = {key: value for key, value in neighbour.items() if key != "link"}
    props.update(SUPERSCRIPT)
    return props


def _apply_edits(inlines: list[JsonDict], edits: list[Edit]) -> list[JsonDict]:
    atoms = _atoms(inlines)
    for edit in sorted(edits, key=lambda item: (item.start, item.end), reverse=True):
        if edit.props is None:
            first = atoms[edit.start]
            props = first[1] if first[0] is not None else dict(SUPERSCRIPT)
        else:
            props = edit.props
        atoms[edit.start : edit.end] = [(char, props) for char in edit.text]
    return canonical_inlines(_runs(atoms))


def _shift(position: int, edits: list[Edit], *, is_end: bool) -> int:
    moved = position
    for edit in edits:
        delta = len(edit.text) - (edit.end - edit.start)
        if edit.start == edit.end:
            if edit.start < position or (edit.start == position and not is_end):
                moved += delta
        elif edit.end <= position:
            moved += delta
        elif edit.start < position:
            raise fail(
                "RENUMBER_BLOCKED",
                "重新编号会改动其他受保护内容，候选未生成；请先调整该处保护后再引用。",
            )
    return moved


@dataclass(frozen=True)
class Placement:
    node: str
    offset: int


@dataclass(frozen=True)
class Candidate:
    ops: list[JsonDict]
    snapshot: JsonDict
    result_sha256: str
    preview: JsonDict


def _new_ids(candidate_id: UUID, count: int) -> list[str]:
    ids = IdGen(int.from_bytes(candidate_id.bytes[:8], "big"))
    stamp = int.from_bytes(candidate_id.bytes[8:14], "big") & ((1 << 47) - 1)
    return [ids.next(stamp) for _ in range(count)]


def _reference_block(block_id: str, text: str, props: JsonDict | None = None) -> JsonDict:
    block: JsonDict = {
        "type": "paragraph",
        "id": block_id,
        "inlines": [{"type": "run", "text": text}],
    }
    if props:
        block["props"] = props
    return block


def build(
    snapshot: JsonDict,
    *,
    candidate_id: UUID,
    entry_id: str,
    placement: Placement,
    records: Mapping[str, gbt7714.Record],
) -> Candidate:
    """Insert ``[n]`` for ``entry_id`` at ``placement`` and keep references consistent."""
    state = verify(snapshot, records, require_complete=False)
    model = state.model
    block = None
    if placement.node in state.positions:
        found = find_body_node(model, placement.node)
        block = found[1] if found is not None and found[0] == "block" else None
    if block is None or block.get("type") != "paragraph":
        raise fail("ANCHOR_INVALID", "引用位置不是正文段落，请把光标放在正文段落中。", 422)
    if state.in_references(placement.node) or (
        state.heading is not None and placement.node == state.heading["id"]
    ):
        raise fail("ANCHOR_INVALID", "不能在参考文献表内插入引用标记。", 422)
    inlines = cast(list[JsonDict], block["inlines"])
    text = atom_text(inlines)
    if not 0 <= placement.offset <= len(text):
        raise fail("ANCHOR_INVALID", "引用位置超出该段文字，请重新放置光标。", 422)
    for protection in state.protections:
        anchor = cast(JsonDict, protection["anchor"])
        if anchor["node"] != placement.node:
            continue
        start, end = anchor.get("start"), anchor.get("end")
        if start is None or (
            isinstance(start, int) and isinstance(end, int) and start < placement.offset < end
        ):
            raise fail("ANCHOR_PROTECTED", "引用位置位于受保护内容中，请换到保护范围之外。")

    marker_id = MARKER_PREFIX + str(candidate_id)
    order = (state.positions[placement.node], placement.offset)
    markers = [
        *state.markers,
        Marker(marker_id, placement.node, placement.offset, placement.offset, entry_id, order),
    ]
    # A new marker at an existing marker's start is written before it.
    markers.sort(key=lambda item: (item.order, item.protection_id != marker_id))
    numbering: list[str] = []
    for item in markers:
        if item.binding not in numbering:
            numbering.append(item.binding)
    numbers = {binding: index + 1 for index, binding in enumerate(numbering)}
    previous = {binding: index + 1 for index, binding in enumerate(state.numbering())}
    if any(binding not in records for binding in numbering):
        raise state_invalid()

    # In-text edits per paragraph, in that paragraph's own scalar coordinates.
    edits: dict[str, list[Edit]] = {}
    changes: list[JsonDict] = []
    inserted = Edit(
        placement.offset,
        placement.offset,
        gbt7714.marker(numbers[entry_id]),
        _marker_props(_atoms(inlines), placement.offset),
    )
    for item in markers:
        label = gbt7714.marker(numbers[item.binding])
        if item.protection_id == marker_id:
            edits.setdefault(item.node, []).append(inserted)
            changes.append(
                {"kind": "marker", "node": item.node, "start": item.start, "after": label}
            )
            continue
        before = gbt7714.marker(previous[item.binding])
        if label != before:
            edits.setdefault(item.node, []).append(Edit(item.start, item.end, label, None))
            changes.append(
                {
                    "kind": "marker_renumber",
                    "node": item.node,
                    "start": item.start,
                    "end": item.end,
                    "before": before,
                    "after": label,
                }
            )
    ops: list[JsonDict] = []
    for node, node_edits in edits.items():
        paragraph = _paragraph(model, node)
        ops.append(
            {
                "op": "doc.set_inlines",
                "id": node,
                "inlines": cast(
                    list[JsonValue],
                    _apply_edits(cast(list[JsonDict], paragraph["inlines"]), node_edits),
                ),
            }
        )

    # References: rewrite existing managed blocks in place, append one for a new entry.
    new_ids = _new_ids(candidate_id, 2)
    sections = cast(list[JsonDict], model["sections"])
    heading_id = cast(str, state.heading["id"]) if state.heading is not None else new_ids[0]
    heading_new = state.heading is None
    if heading_new:
        ops.append(
            {
                "op": "doc.insert_block",
                "section": cast(str, sections[-1]["id"]),
                "at": {"kind": "end"},
                "block": canonical_block(
                    {
                        "type": "heading",
                        "id": heading_id,
                        "level": 1,
                        "inlines": [{"type": "run", "text": REFERENCES_HEADING}],
                    }
                ),
            }
        )
        changes.append({"kind": "heading_new", "node": heading_id, "after": REFERENCES_HEADING})
    reference_ids = [item.node for item in state.references]
    for index, node in enumerate(reference_ids):
        binding = numbering[index]
        expected = gbt7714.numbered(index + 1, records[binding])
        current = _paragraph(model, node)
        current_text = atom_text(cast(list[JsonDict], current["inlines"]))
        if current_text != expected or state.references[index].binding != binding:
            props = cast(JsonDict | None, current.get("props"))
            ops.append(
                {
                    "op": "doc.replace_block",
                    "id": node,
                    "block": canonical_block(_reference_block(node, expected, props)),
                }
            )
            changes.append(
                {"kind": "reference", "node": node, "before": current_text, "after": expected}
            )
    reference_node: str | None = None
    if len(numbering) > len(reference_ids):
        reference_node = new_ids[1]
        top = top_blocks(model)
        after = (
            reference_ids[-1]
            if reference_ids
            else heading_id
            if heading_new
            else cast(str, top[state.section_end - 1]["id"])
        )
        expected = gbt7714.numbered(len(numbering), records[numbering[-1]])
        ops.append(
            {
                "op": "doc.insert_block",
                "at": {"kind": "after", "id": after},
                "block": canonical_block(_reference_block(reference_node, expected)),
            }
        )
        reference_ids.append(reference_node)
        changes.append({"kind": "reference_new", "node": reference_node, "after": expected})

    # Protections: shift ranges in edited paragraphs, then the managed set in full.
    protections: list[JsonDict] = []
    for protection in state.protections:
        if is_managed(protection):
            continue
        anchor = cast(JsonDict, protection["anchor"])
        paragraph_edits = edits.get(cast(str, anchor["node"]))
        shifted = deepcopy(protection)
        if paragraph_edits and "start" in anchor:
            moved = cast(JsonDict, shifted["anchor"])
            moved["start"] = _shift(cast(int, anchor["start"]), paragraph_edits, is_end=False)
            moved["end"] = _shift(cast(int, anchor["end"]), paragraph_edits, is_end=True)
        protections.append(shifted)
    for marker in markers:
        # The new marker is not shifted by its own insertion; existing ones are.
        own = [
            e
            for e in edits.get(marker.node, [])
            if e is not inserted or marker.protection_id != marker_id
        ]
        label = gbt7714.marker(numbers[marker.binding])
        start = _shift(marker.start, own, is_end=False)
        protections.append(
            {
                "id": marker.protection_id,
                "kind": "citation",
                "anchor": {"node": marker.node, "start": start, "end": start + len(label)},
                "binding": marker.binding,
            }
        )
    for index, node in enumerate(reference_ids):
        protections.append(
            {
                "id": REFERENCE_PREFIX + node,
                "kind": "citation",
                "anchor": {"node": node},
                "binding": numbering[index],
            }
        )

    try:
        result = apply_ops(model, ops, ids=IdGen(0), now_ms=0, restricted=True)
    except DocOpsError as error:
        raise fail("STATE_INVALID", "引用候选无法应用到该正文版本。") from error
    candidate_snapshot = validate_snapshot(
        {
            "schemaVersion": 2,
            "model": result.model,
            "protections": cast(list[JsonValue], protections),
        }
    )
    check_result(snapshot, candidate_snapshot, records)
    preview: JsonDict = {
        "entry_id": entry_id,
        "number": numbers[entry_id],
        "reused": entry_id in previous,
        "marker": {
            "node": placement.node,
            "offset": placement.offset,
            "text": gbt7714.marker(numbers[entry_id]),
        },
        "reference": {
            "node": reference_ids[numbering.index(entry_id)],
            "new": reference_node is not None and numbering[-1] == entry_id,
            "text": gbt7714.numbered(numbers[entry_id], records[entry_id]),
        },
        "heading": {"node": heading_id, "new": heading_new},
        "renumbered": cast(
            list[JsonValue],
            [
                {"entry_id": binding, "before": previous[binding], "after": numbers[binding]}
                for binding in numbering
                if binding in previous and previous[binding] != numbers[binding]
            ],
        ),
        "changes": cast(list[JsonValue], changes),
    }
    return Candidate(ops, candidate_snapshot, digest(candidate_snapshot), preview)


def check_result(base: JsonDict, result: JsonDict, records: Mapping[str, gbt7714.Record]) -> None:
    """Program check of a citation adoption: managed invariants + ordinary rules."""
    verify(result, records)
    try:
        protection_rule_check(base, result, user_edit=False, managed=is_managed)
    except AppError as error:
        if error.code.startswith("DOCMODEL_PROTECTION"):
            raise fail(
                "ANCHOR_PROTECTED", "插入或重新编号会改动受保护内容，请换到保护范围之外再引用。"
            ) from error
        raise
    before = {cast(str, item["id"]): item for item in protections_of(base) if is_managed(item)}
    after = {cast(str, item["id"]): item for item in protections_of(result) if is_managed(item)}
    for identifier, item in before.items():
        kept = after.get(identifier)
        if kept is None:
            raise state_invalid()
        if identifier.startswith(MARKER_PREFIX) and (
            kept.get("binding") != item.get("binding")
            or cast(JsonDict, kept["anchor"])["node"] != cast(JsonDict, item["anchor"])["node"]
        ):
            raise state_invalid()


Records = Mapping[str, gbt7714.Record]
RecordLoader = Callable[[set[str]], Records]
