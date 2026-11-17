"""v2 (DocsModel) content candidates: scalar node anchors and program protection checks.

A candidate addresses one body paragraph/heading by node id with Unicode scalar offsets
into its atom text (runs as is, every other inline one scalar). The selection must lie
inside a single text run, so a patch never crosses an inline atom or a formatting
boundary. Besides the v1 lexical rules (numbers, citations, formulas), every snapshot
protection touching the node is enforced by range: a changing patch may not intersect a
protected span, and a whole-node protection on the node or an ancestor freezes it. The
accepted patches are applied with the kernel ``doc.replace_text`` op subset; protection
offsets after an edit move with the text so the save-time rule check re-reads them.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from dataclasses import dataclass
from typing import cast

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.content import ContentView
from thesis_pilot.modules.documents.docs_model import (
    OBJECT_ATOM,
    JsonDict,
    JsonValue,
    atom_text,
    child_block_lists,
    model_of,
    protections_of,
)
from thesis_pilot.modules.documents.docs_ops import DocOpsError, IdGen, apply_ops, ops_app_error
from thesis_pilot.modules.documents.structure import well_formed
from thesis_pilot.modules.revisions.anchors import ResolvedSelection, anchor_error, unsupported
from thesis_pilot.modules.revisions.protection import (
    AUTHOR,
    BRACKET,
    FORMULA,
    NUMBER_PATTERN,
    NUMERIC_OPERATION,
    PAREN,
    UNIT_PATTERN,
    VARIABLE_OPERATION,
    Token,
    citations,
    citations_supported,
    equal_tokens,
    formula,
    numbers,
    numbers_supported,
)
from thesis_pilot.modules.revisions.schemas import (
    MAX_SELECTION_UNITS,
    POLICY_VERSION_V2,
    RevisionCheck,
    RevisionNodePatch,
    RevisionNodeSelection,
    RevisionSelection,
    RuleName,
)

# Protection kind → the rule it fails when a changing patch touches it.
PROTECTION_RULES: dict[str, RuleName] = {
    "number": "number",
    "citation": "citation",
    "formula": "formula",
    "lock": "lock",
    "source": "lock",
    "object": "structure",
}
# Replacement text stays inside one run: no line/tab/paragraph breaks or object atoms.
FORBIDDEN_AFTER = frozenset("\n\r\t\v\f  " + OBJECT_ATOM)
POLICY_DIGEST_V2 = hashlib.sha256(
    (
        POLICY_VERSION_V2
        + NUMBER_PATTERN
        + UNIT_PATTERN
        + BRACKET.pattern
        + PAREN.pattern
        + AUTHOR.pattern
        + FORMULA.pattern
        + VARIABLE_OPERATION.pattern
        + NUMERIC_OPERATION.pattern
        + "exact-lexemes;full-block;per-patch;no-partial-token;scalar;single-run;"
        "snapshot-protections:number,citation,formula,lock,source,object;whole-node-ancestors;"
        "no-break-after;replace-text:v2"
    ).encode()
).hexdigest()


@dataclass(frozen=True)
class ProtectedSpan:
    id: str
    kind: str
    start: int
    end: int
    whole: bool


@dataclass(frozen=True)
class ResolvedNode:
    snapshot: JsonDict
    node_id: str
    kind: str
    text: str
    run_start: int
    run_end: int
    protections: tuple[ProtectedSpan, ...]


def _body_path(model: JsonDict, node_id: str) -> tuple[JsonDict, list[str]] | None:
    """The body block with ``node_id`` and the ids of every enclosing node."""

    def nested(block: JsonDict) -> Iterator[tuple[list[str], list[JsonDict]]]:
        kind = block.get("type")
        if kind == "list":
            for item in cast(list[JsonDict], block["items"]):
                yield [cast(str, item["id"])], cast(list[JsonDict], item["blocks"])
        elif kind == "table":
            for row in cast(list[JsonDict], block["rows"]):
                for cell in cast(list[JsonDict], row["cells"]):
                    yield (
                        [cast(str, row["id"]), cast(str, cell["id"])],
                        cast(list[JsonDict], cell["blocks"]),
                    )
        else:
            for blocks in child_block_lists(block):
                yield [], blocks

    stack: list[tuple[JsonDict, list[str]]] = [
        (block, [])
        for section in reversed(cast(list[JsonDict], model["sections"]))
        for block in reversed(cast(list[JsonDict], section["blocks"]))
    ]
    while stack:
        block, ancestors = stack.pop()
        if block.get("id") == node_id:
            return block, ancestors
        here = [*ancestors, cast(str, block["id"])]
        children = [(child, [*here, *extra]) for extra, blocks in nested(block) for child in blocks]
        stack.extend(reversed(children))
    return None


def resolve_node_selection(snapshot: JsonDict, selection: RevisionNodeSelection) -> ResolvedNode:
    if (
        selection.start >= selection.end
        or selection.end - selection.start > MAX_SELECTION_UNITS
        or not well_formed(selection.expected_text)
    ):
        raise anchor_error()
    found = _body_path(model_of(snapshot), selection.node_id)
    if found is None:
        raise anchor_error()
    block, ancestors = found
    if block.get("type") not in {"paragraph", "heading"}:
        raise unsupported()
    inlines = cast(list[JsonDict], block["inlines"])
    text = atom_text(inlines)
    selected = text[selection.start : selection.end]
    if selection.end > len(text) or selected != selection.expected_text:
        raise anchor_error()
    cursor, run_span = 0, None
    for inline in inlines:
        width = len(cast(str, inline["text"])) if inline.get("type") == "run" else 1
        if (
            inline.get("type") == "run"
            and cursor <= selection.start
            and selection.end <= cursor + width
        ):
            run_span = (cursor, cursor + width)
            break
        cursor += width
    if run_span is None:
        raise unsupported()
    scope = {selection.node_id, *ancestors}
    spans: list[ProtectedSpan] = []
    for protection in protections_of(snapshot):
        anchor = cast(JsonDict, protection["anchor"])
        node = anchor.get("node")
        whole = "start" not in anchor and "end" not in anchor
        if whole and node in scope:
            spans.append(
                ProtectedSpan(
                    cast(str, protection["id"]), cast(str, protection["kind"]), 0, len(text), True
                )
            )
        elif not whole and node == selection.node_id:
            spans.append(
                ProtectedSpan(
                    cast(str, protection["id"]),
                    cast(str, protection["kind"]),
                    cast(int, anchor["start"]),
                    cast(int, anchor["end"]),
                    False,
                )
            )
    return ResolvedNode(
        snapshot,
        selection.node_id,
        cast(str, block["type"]),
        text,
        run_span[0],
        run_span[1],
        tuple(spans),
    )


def resolve_for_view(
    view: ContentView, selection: RevisionSelection | RevisionNodeSelection
) -> ResolvedSelection | ResolvedNode:
    """Exact anchor for either schema; a selection of the other schema is refused."""
    if isinstance(selection, RevisionNodeSelection):
        if view.schema_version != 2:
            from thesis_pilot.modules.documents.content import anchor_schema_mismatch

            raise anchor_schema_mismatch()
        return resolve_node_selection(view.snapshot(), selection)
    return view.resolve_selection(selection)


def _touches(patch: RevisionNodePatch, span: ProtectedSpan) -> bool:
    if patch.before == patch.after:
        return False
    return span.whole or (patch.start < span.end and patch.end > span.start)


def check_node_patches(
    resolved: ResolvedNode,
    selection: RevisionNodeSelection,
    patches: list[RevisionNodePatch],
    *,
    base_version: int,
    current_version: int,
) -> list[RevisionCheck]:
    text = resolved.text
    sorted_patches = sorted(patches, key=lambda patch: patch.start)
    valid = (
        bool(patches)
        and len(patches) <= 100
        and len({patch.id for patch in patches}) == len(patches)
    )
    for patch in sorted_patches:
        valid = valid and (
            selection.start <= patch.start < patch.end <= selection.end
            and text[patch.start : patch.end] == patch.before
            and well_formed(patch.after)
        )
    valid = valid and any(patch.before != patch.after for patch in patches)
    overlap = all(
        a.end <= b.start for a, b in zip(sorted_patches, sorted_patches[1:], strict=False)
    )
    combined = text
    if valid and overlap:
        for patch in reversed(sorted_patches):
            combined = combined[: patch.start] + patch.after + combined[patch.end :]

    def uncut(tokens: Iterator[Token]) -> bool:
        return all(
            all(
                patch.before == patch.after
                or patch.end <= token.start
                or patch.start >= token.end
                or (patch.start <= token.start and patch.end >= token.end)
                for patch in patches
            )
            for token in tokens
        )

    hits: dict[RuleName, RevisionNodePatch] = {}
    for patch in sorted_patches:
        for span in resolved.protections:
            if _touches(patch, span):
                hits.setdefault(PROTECTION_RULES.get(span.kind, "structure"), patch)
        if any(char in FORBIDDEN_AFTER for char in patch.after):
            hits.setdefault("structure", patch)
    number_support = numbers_supported(text) and numbers_supported(combined)
    citation_support = citations_supported(text) and citations_supported(combined)
    number_ok = (
        valid
        and overlap
        and "number" not in hits
        and uncut(numbers(text))
        and all(equal_tokens(numbers(patch.before), numbers(patch.after)) for patch in patches)
        and equal_tokens(numbers(text), numbers(combined))
    )
    citation_ok = (
        valid
        and overlap
        and "citation" not in hits
        and uncut(citations(text))
        and all(equal_tokens(citations(patch.before), citations(patch.after)) for patch in patches)
        and equal_tokens(citations(text), citations(combined))
    )
    lexical_formula = (
        formula(text) or formula(combined) or any(formula(patch.after) for patch in patches)
    )
    items: list[tuple[RuleName, bool, bool, str]] = [
        ("version", base_version == current_version, False, "候选基础版本必须与当前正文一致。"),
        ("range", valid, False, "补丁必须位于原选区，原文与标量边界完全一致。"),
        (
            "number",
            number_ok,
            not number_support and "number" not in hits,
            "数字、区间、单位及受保护数字必须原样保留；未识别计量写法拒绝。",
        ),
        (
            "citation",
            citation_ok,
            not citation_support and "citation" not in hits,
            "完整引用、受保护引用及出现顺序必须保留；疑似而未解析的引文拒绝。",
        ),
        (
            "formula",
            "formula" not in hits,
            lexical_formula and "formula" not in hits,
            "受保护公式不能修改；包含公式的整个文本块暂不支持自动修订。",
        ),
        ("lock", "lock" not in hits, False, "补丁不能修改锁定文字或原件受保护内容。"),
        ("overlap", overlap, False, "接受的补丁不能重叠。"),
        (
            "structure",
            "structure" not in hits,
            False,
            "仅替换同一文字片段，不写入换行、制表或对象，不改动受保护对象。",
        ),
    ]
    located: dict[RuleName, RevisionNodePatch] = dict(hits)
    for patch in sorted_patches:
        if not equal_tokens(numbers(patch.before), numbers(patch.after)):
            located.setdefault("number", patch)
        if not equal_tokens(citations(patch.before), citations(patch.after)):
            located.setdefault("citation", patch)
    for previous_patch, next_patch in zip(sorted_patches, sorted_patches[1:], strict=False):
        if previous_patch.end > next_patch.start:
            located.setdefault("overlap", next_patch)
    checks: list[RevisionCheck] = []
    for rule, passed, unsupported_rule, detail in items:
        where = located.get(rule) if not passed and not unsupported_rule else None
        checks.append(
            RevisionCheck.model_validate(
                {
                    "rule": rule,
                    "result": "unsupported" if unsupported_rule else "pass" if passed else "fail",
                    "detail": detail,
                    "patch_id": where.id if where else None,
                    "start": where.start if where else None,
                    "end": where.end if where else None,
                }
            )
        )
    return checks


def apply_node_patches(resolved: ResolvedNode, patches: list[RevisionNodePatch]) -> JsonDict:
    """Only called after protection; the kernel op edits one run, offsets move with it."""
    ordered = sorted(patches, key=lambda patch: patch.start, reverse=True)
    ops: list[JsonValue] = [
        {
            "op": "doc.replace_text",
            "id": resolved.node_id,
            "range": {"start": patch.start, "end": patch.end},
            "text": patch.after,
        }
        for patch in ordered
    ]
    try:
        result = apply_ops(
            model_of(resolved.snapshot), ops, ids=IdGen(0), now_ms=0, restricted=True
        )
    except DocOpsError as error:
        raise ops_app_error(error) from error
    protections: list[JsonValue] = []
    for protection in protections_of(resolved.snapshot):
        anchor = cast(JsonDict, protection["anchor"])
        if anchor.get("node") != resolved.node_id or "start" not in anchor:
            protections.append(protection)
            continue
        start, end = cast(int, anchor["start"]), cast(int, anchor["end"])
        shift = sum(
            len(patch.after) - (patch.end - patch.start) for patch in patches if patch.end <= start
        )
        if any(_touches(patch, ProtectedSpan("", "", start, end, False)) for patch in patches):
            raise AppError(
                "REVISION_PROTECTION_FAILED", "数字、引用或锁定内容检查未通过，正文保持不变。", 422
            )
        protections.append(
            {**protection, "anchor": {**anchor, "start": start + shift, "end": end + shift}}
        )
    return {"schemaVersion": 2, "model": result.model, "protections": protections}
