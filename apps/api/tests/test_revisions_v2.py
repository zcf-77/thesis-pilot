"""v2 (DocsModel) content candidates: migrated v1 protection samples plus v2-only cases.

Every SG04 v1 protection sample is migrated with the deterministic upgrade converter:
the block becomes a node, the aiLock marks become ``lock`` protections, and UTF-16
positions become scalar offsets into the node text. The verdict (allowed, failed and
unsupported rules, rejected anchors) must match v1. v2-only samples cover emoji and
extension B scalars, inline atoms, snapshot protection boundaries and whole-node
ancestors. Adoption goes through the kernel ``doc.replace_text`` op, cross-checked with
``docs_ops`` directly and with the converter's projection of the v1 expected result.
"""

import json
from copy import deepcopy
from pathlib import Path
from typing import Any, cast
from uuid import UUID

import pytest
from pydantic import ValidationError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.content import ContentView
from thesis_pilot.modules.documents.docs_model import (
    JsonDict,
    atom_text,
    find_block,
    protection_rule_check,
    validate_snapshot,
)
from thesis_pilot.modules.documents.docs_ops import IdGen, apply_ops
from thesis_pilot.modules.documents.legacy_v1 import convert_v1
from thesis_pilot.modules.documents.structure import canonical_editor_json, node_size
from thesis_pilot.modules.revisions.protection import numbers_supported
from thesis_pilot.modules.revisions.protection_v2 import (
    apply_node_patches,
    check_node_patches,
    resolve_for_view,
    resolve_node_selection,
)
from thesis_pilot.modules.revisions.schemas import (
    RevisionNodePatch,
    RevisionNodeSelection,
    RevisionSelection,
)

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures/revision-protection.json").read_text(encoding="utf-8")
)
DOCUMENT = UUID(int=7)
# Samples whose v1 meaning has no v2 counterpart:
# P20 — the v1 document itself is structurally invalid (unknown inline node);
# P26 — a selection splitting a UTF-16 surrogate pair cannot be written in scalars;
# P27 — absolute ProseMirror positions pointing into a different block.
NOT_MIGRATABLE = {"SG04-P20", "SG04-P26", "SG04-P27"}
V1_CASES = [
    item
    for group in FIXTURE["cases"]
    for item in [group, *group.get("variants", [])]
    if item["kind"] == "protection"
]


def case_id(case: dict[str, Any]) -> str:
    return str(case["id"]) + ":" + str(case.get("variant_id", "main"))


def _block_start(document: dict[str, Any], path: list[int]) -> tuple[dict[str, Any], int]:
    node = canonical_editor_json(document)
    start = 0
    for index in path:
        content = cast(list[dict[str, Any]], node.get("content", []))
        start = start + sum(node_size(sibling) for sibling in content[:index])
        node = content[index]
        start += 1
    return node, start


def _scalar(text: str, units: int) -> int | None:
    """UTF-16 offset → scalar offset; out-of-range stays out of range, splits are None."""
    cursor = 0
    for index, char in enumerate(text):
        if cursor == units:
            return index
        cursor += 2 if ord(char) > 0xFFFF else 1
        if cursor > units:
            return None
    return len(text) + (units - cursor)


def migrate(case: dict[str, Any]) -> tuple[JsonDict, RevisionNodeSelection, list[dict[str, Any]]]:
    document = case["document"]["json"]
    conversion = convert_v1(document, document_id=DOCUMENT, version=1)
    selection = case["selection"]
    path = selection["textblock_path"]
    node_id = conversion.node_map[tuple(path)]
    block, start = _block_start(document, path)
    text = "".join(child.get("text", "") for child in block.get("content", []))

    def offset(position: int) -> int:
        value = _scalar(text, position - start)
        assert value is not None and value >= 0, case_id(case)
        return value

    node_selection = RevisionNodeSelection.model_validate(
        {
            "node_id": node_id,
            "start": offset(selection["from"]),
            "end": offset(selection["to"]),
            "expected_text": selection["text"],
        }
    )
    patches = [
        {
            "id": patch["id"],
            "start": offset(patch["from"]),
            "end": offset(patch["to"]),
            "before": patch["before"],
            "after": patch["after"],
        }
        for patch in case["patches"]
    ]
    return conversion.snapshot, node_selection, patches


MIGRATED = [case for case in V1_CASES if case["id"] not in NOT_MIGRATABLE]


def test_migrated_sample_count() -> None:
    assert len(V1_CASES) == 60
    assert len(MIGRATED) == 57


@pytest.mark.parametrize("case", MIGRATED, ids=case_id)
def test_migrated_v1_protection_samples(case: dict[str, Any]) -> None:
    snapshot, selection, raw_patches = migrate(case)
    original = deepcopy(snapshot)
    expected = case["expected"]
    if expected["error_code"]:
        with pytest.raises(AppError) as captured:
            resolve_node_selection(snapshot, selection)
        assert captured.value.code == expected["error_code"]
        return
    resolved = resolve_node_selection(snapshot, selection)
    patches = [RevisionNodePatch.model_validate(patch) for patch in raw_patches]
    checks = check_node_patches(
        resolved,
        selection,
        patches,
        base_version=case["base_version"],
        current_version=case["current_version"],
    )
    results = {check.rule: check.result for check in checks}
    assert all(check.result == "pass" for check in checks) == expected["allowed"], checks
    for rule in expected["failed_rules"]:
        assert results[rule] == "fail", checks
    for rule in expected["unsupported_rules"]:
        assert results[rule] == "unsupported", checks
    if expected["allowed"]:
        adopted = apply_node_patches(resolved, patches)
        target = convert_v1(expected["result_json"], document_id=DOCUMENT, version=1).snapshot
        assert adopted["model"] == target["model"]
        assert adopted["protections"] == target["protections"]
        protection_rule_check(snapshot, validate_snapshot(adopted), user_edit=False)
    assert snapshot == original


# ---------- v2-only samples ----------


def run(text: str, **props: object) -> JsonDict:
    item: JsonDict = {"type": "run", "text": text}
    if props:
        item["props"] = dict(props)
    return item


def snapshot_of(blocks: list[JsonDict], protections: list[JsonDict] | None = None) -> JsonDict:
    return validate_snapshot(
        {
            "schemaVersion": 2,
            "model": {
                "kind": "docs",
                "schemaVersion": 1,
                "id": "doc",
                "theme": {"name": "minimal"},
                "sections": [{"id": "s1", "blocks": blocks}],
            },
            "protections": protections or [],
        }
    )


def paragraph(node_id: str, *inlines: JsonDict) -> JsonDict:
    return {"type": "paragraph", "id": node_id, "inlines": list(inlines)}


def protection(pid: str, kind: str, node: str, start: int | None = None, end: int | None = None):
    anchor: JsonDict = {"node": node}
    if start is not None:
        anchor.update({"start": start, "end": end})
    return {"id": pid, "kind": kind, "anchor": anchor}


def select(node: str, text: str, part: str, occurrence: int = 0) -> RevisionNodeSelection:
    index = -1
    for _ in range(occurrence + 1):
        index = text.index(part, index + 1)
    return RevisionNodeSelection(
        node_id=node, start=index, end=index + len(part), expected_text=part
    )


def patch(pid: str, selection: RevisionNodeSelection, after: str) -> RevisionNodePatch:
    return RevisionNodePatch(
        id=pid,
        start=selection.start,
        end=selection.end,
        before=selection.expected_text,
        after=after,
    )


def verdict(
    snapshot: JsonDict,
    selection: RevisionNodeSelection,
    patches: list[RevisionNodePatch],
    *,
    current_version: int = 1,
) -> dict[str, str]:
    resolved = resolve_node_selection(snapshot, selection)
    checks = check_node_patches(
        resolved, selection, patches, base_version=1, current_version=current_version
    )
    return {check.rule: check.result for check in checks}


def passed(results: dict[str, str]) -> bool:
    return all(value == "pass" for value in results.values())


def node_text(snapshot: JsonDict, node_id: str) -> str:
    block = find_block(cast(JsonDict, snapshot["model"]), node_id)
    assert block is not None
    return atom_text(cast(list[JsonDict], block["inlines"]))


def test_emoji_scalars_and_adoption() -> None:
    text = "甲😀乙采用方法。"
    snapshot = snapshot_of([paragraph("p", run(text))])
    selection = select("p", text, "采用")
    assert (selection.start, selection.end) == (3, 5)
    resolved = resolve_node_selection(snapshot, selection)
    patches = [patch("p1", selection, "使用😀")]
    assert passed(verdict(snapshot, selection, patches))
    adopted = apply_node_patches(resolved, patches)
    assert node_text(adopted, "p") == "甲😀乙使用😀方法。"


def test_extension_b_offsets_are_scalars() -> None:
    text = "𠀀𠀁研究采用方法甲。"
    snapshot = snapshot_of([paragraph("p", run(text))])
    selection = select("p", text, "采用")
    assert selection.start == 4
    adopted = apply_node_patches(
        resolve_node_selection(snapshot, selection), [patch("p1", selection, "使用")]
    )
    assert node_text(adopted, "p") == "𠀀𠀁研究使用方法甲。"


def test_selection_after_inline_atom_counts_atom_as_one() -> None:
    inlines = [run("见"), {"type": "field", "kind": "page_number"}, run("页采用方法。")]
    snapshot = snapshot_of([paragraph("p", *inlines)])
    text = node_text(snapshot, "p")
    assert text == "见￼页采用方法。"
    selection = select("p", text, "采用")
    assert selection.start == 3
    resolved = resolve_node_selection(snapshot, selection)
    adopted = apply_node_patches(resolved, [patch("p1", selection, "使用")])
    block = find_block(cast(JsonDict, adopted["model"]), "p")
    assert block is not None and block["inlines"][1] == inlines[1]
    assert node_text(adopted, "p") == "见￼页使用方法。"


@pytest.mark.parametrize(
    ("inlines", "part"),
    [
        ([run("采用"), {"type": "break"}, run("方法")], "用\n方"),
        ([run("采用", bold=True), run("方法")], "用方"),
        ([run("采用"), {"type": "tab"}, run("方法")], "用\t方"),
        ([run("见"), {"type": "field", "kind": "page_number"}, run("页")], "见￼页"),
        ([run("采用"), run("方法", bold=True), run("完成")], "用方法完"),
        ([run("采用", size=1200), run("方法", size=1050)], "用方"),
    ],
    ids=[
        "across-break",
        "across-format",
        "across-tab",
        "across-object",
        "format-differs-inside",
        "size-differs",
    ],
)
def test_selection_must_stay_in_equal_format_run_text(inlines: list[JsonDict], part: str) -> None:
    snapshot = snapshot_of([paragraph("p", *inlines)])
    with pytest.raises(AppError) as captured:
        resolve_node_selection(snapshot, select("p", node_text(snapshot, "p"), part))
    assert captured.value.code == "REVISION_UNSUPPORTED"


# A Word import keeps the source run boundaries: every number is its own run although all
# runs of the paragraph carry the same props.
IMPORTED_PROPS: JsonDict = {
    "font": {"kind": "named", "value": "Times New Roman"},
    "fontEastAsia": {"kind": "named", "value": "宋体"},
    "lang": "zh-CN",
    "size": 1200,
}
IMPORTED_PARTS = [
    "常规组中，A 修复了 ",
    "6",
    " 条草稿失配，成功",
    "率为 ",
    "71.4%",
    "，说明该方法基本上是有效果的。",
]


def imported_paragraph(protections: list[JsonDict] | None = None) -> tuple[JsonDict, str]:
    inlines = [run(part, **IMPORTED_PROPS) for part in IMPORTED_PARTS]
    snapshot = snapshot_of([paragraph("p", *inlines)], protections)
    block = find_block(cast(JsonDict, snapshot["model"]), "p")
    assert block is not None and len(block["inlines"]) == len(IMPORTED_PARTS)
    return snapshot, "".join(IMPORTED_PARTS)


def test_whole_paragraph_across_equal_format_runs_is_revisable() -> None:
    snapshot, text = imported_paragraph()
    selection = select("p", text, text)
    after = text.replace("基本上是有效果的", "基本有效")
    patches = [patch("model-replacement", selection, after)]
    assert passed(verdict(snapshot, selection, patches))
    adopted = validate_snapshot(
        apply_node_patches(resolve_node_selection(snapshot, selection), patches)
    )
    block = find_block(cast(JsonDict, adopted["model"]), "p")
    source = find_block(cast(JsonDict, snapshot["model"]), "p")
    assert block is not None and source is not None
    assert block["inlines"] == [{**source["inlines"][0], "text": after}]
    golden = apply_ops(
        snapshot["model"],
        [
            {
                "op": "doc.replace_text",
                "id": "p",
                "range": {"start": 0, "end": len(text)},
                "text": after,
            }
        ],
        ids=IdGen(0),
        now_ms=0,
    )
    assert adopted["model"] == golden.model
    protection_rule_check(snapshot, adopted, user_edit=False)


@pytest.mark.parametrize(
    "after",
    [
        "常规组中，A 修复了 6 条草稿失配，成功率约七成，说明该方法基本有效。",
        "常规组中，A 修复了 7 条草稿失配，成功率为 71.4%，说明该方法基本有效。",
    ],
    ids=["number-dropped", "number-changed"],
)
def test_changed_number_across_equal_format_runs_fails(after: str) -> None:
    snapshot, text = imported_paragraph()
    selection = select("p", text, text)
    results = verdict(snapshot, selection, [patch("model-replacement", selection, after)])
    assert results["number"] == "fail" and not passed(results)


@pytest.mark.parametrize(
    ("text", "supported"),
    [
        ("B0 与 B1 均调用 480 次", True),
        ("命中率 33.3% 的差距", True),
        ("阈值 1.00 和 0.80 都偏高", True),
        ("见图5的结果", True),
        # Unknown measure words, classifiers and multipliers stay unrecognised.
        ("运输 480 吨", False),
        ("取 3 对样本", False),
        ("提升 10 倍", False),
        ("B0 and B1", False),
    ],
)
def test_function_word_after_number_is_not_an_unknown_unit(text: str, supported: bool) -> None:
    assert numbers_supported(text) is supported


FUNCTION_TAIL = "B0 与 B1 均调用 480 次，命中率 33.3% 的差距来自阈值 1.00 和 0.80。"


@pytest.mark.parametrize(
    ("before", "after", "result"),
    [
        ("差距来自", "差异源于", "pass"),
        ("B1 均", "B2 均", "fail"),
        ("33.3% 的", "33% 的", "fail"),
        ("1.00 和", "1.0 和", "fail"),
        # A unit slipped in after a unit-less number is never accepted.
        ("1.00 和", "1.00 次和", "fail"),
        ("1.00 和", "1.00 吨和", "unsupported"),
    ],
)
def test_paragraph_with_function_words_after_numbers_is_revisable_and_protected(
    before: str, after: str, result: str
) -> None:
    snapshot = snapshot_of([paragraph("p", run(FUNCTION_TAIL))])
    selection = select("p", FUNCTION_TAIL, FUNCTION_TAIL)
    changed = FUNCTION_TAIL.replace(before, after)
    results = verdict(snapshot, selection, [patch("model-replacement", selection, changed)])
    assert results["number"] == result
    assert passed(results) is (result == "pass")


def test_patch_across_run_boundary_keeps_format_and_moves_protections() -> None:
    text = "".join(IMPORTED_PARTS)
    number = text.index("71.4%")
    snapshot, _ = imported_paragraph([protection("n", "number", "p", number, number + 5)])
    selection = select("p", text, text)
    crossing = select("p", text, "成功率为")
    patches = [patch("p1", crossing, "修复成功率达到")]
    assert passed(verdict(snapshot, selection, patches))
    adopted = validate_snapshot(
        apply_node_patches(resolve_node_selection(snapshot, selection), patches)
    )
    block = find_block(cast(JsonDict, adopted["model"]), "p")
    source = find_block(cast(JsonDict, snapshot["model"]), "p")
    assert block is not None and source is not None
    assert [inline["props"] for inline in block["inlines"]] == [source["inlines"][0]["props"]]
    new_text = node_text(adopted, "p")
    assert new_text == text.replace("成功率为", "修复成功率达到")
    anchor = adopted["protections"][0]["anchor"]
    assert new_text[anchor["start"] : anchor["end"]] == "71.4%"
    protection_rule_check(snapshot, adopted, user_edit=False)
    touching = select("p", text, "为 71.4%")
    results = verdict(snapshot, selection, [patch("p1", touching, "是 71.4%")])
    assert results["number"] == "fail"


@pytest.mark.parametrize(
    ("kind", "rule"),
    [
        ("number", "number"),
        ("citation", "citation"),
        ("formula", "formula"),
        ("lock", "lock"),
        ("source", "lock"),
        ("object", "structure"),
    ],
)
def test_protected_ranges_fail_their_rule(kind: str, rule: str) -> None:
    text = "本研究采用方法甲完成实验。"
    snapshot = snapshot_of(
        [paragraph("p", run(text))], [protection("x", kind, "p", 5, 8)]
    )  # 方法甲
    whole = select("p", text, "采用方法甲")
    results = verdict(snapshot, whole, [patch("p1", whole, "使用方法乙")])
    assert results[rule] == "fail" and not passed(results)
    edge = select("p", text, "采用")
    assert passed(verdict(snapshot, edge, [patch("p1", edge, "使用")]))
    tail = select("p", text, "完成实验")
    assert passed(verdict(snapshot, tail, [patch("p1", tail, "做完实验")]))


def test_protection_boundaries_are_half_open() -> None:
    text = "数值为 120 人参与。"
    snapshot = snapshot_of([paragraph("p", run(text))], [protection("n", "number", "p", 4, 7)])
    before = RevisionNodeSelection(node_id="p", start=0, end=4, expected_text="数值为 ")
    assert passed(verdict(snapshot, before, [patch("p1", before, "数量为 ")]))
    touching = RevisionNodeSelection(node_id="p", start=3, end=5, expected_text=" 1")
    results = verdict(snapshot, touching, [patch("p1", touching, " 2")])
    assert results["number"] == "fail"
    unchanged = RevisionNodeSelection(node_id="p", start=4, end=7, expected_text="120")
    results = verdict(snapshot, unchanged, [patch("p1", unchanged, "120")])
    assert results["range"] == "fail"


def test_whole_node_protection_on_ancestor_freezes_cell_text() -> None:
    table = {
        "type": "table",
        "id": "t",
        "rows": [
            {
                "id": "r",
                "cells": [{"id": "c", "blocks": [paragraph("p", run("单元格采用方法。"))]}],
            }
        ],
    }
    snapshot = snapshot_of([table], [protection("w", "object", "c")])
    selection = select("p", "单元格采用方法。", "采用")
    results = verdict(snapshot, selection, [patch("p1", selection, "使用")])
    assert results["structure"] == "fail"
    free = snapshot_of([table])
    assert passed(verdict(free, selection, [patch("p1", selection, "使用")]))


@pytest.mark.parametrize("after", ["使\n用", "使\t用", "使￼用", "使 用"])
def test_replacement_cannot_inject_breaks_or_atoms(after: str) -> None:
    text = "本研究采用方法。"
    snapshot = snapshot_of([paragraph("p", run(text))])
    selection = select("p", text, "采用")
    assert verdict(snapshot, selection, [patch("p1", selection, after)])["structure"] == "fail"


def test_stale_version_fails_version_rule() -> None:
    text = "本研究采用方法。"
    snapshot = snapshot_of([paragraph("p", run(text))])
    selection = select("p", text, "采用")
    results = verdict(snapshot, selection, [patch("p1", selection, "使用")], current_version=2)
    assert results["version"] == "fail"


def test_overlapping_and_out_of_selection_patches_fail() -> None:
    text = "本研究采用方法甲完成实验。"
    snapshot = snapshot_of([paragraph("p", run(text))])
    selection = select("p", text, "采用方法甲")
    first = RevisionNodePatch(id="a", start=3, end=6, before="采用方", after="使用方")
    second = RevisionNodePatch(id="b", start=5, end=7, before="方法", after="手段")
    assert verdict(snapshot, selection, [first, second])["overlap"] == "fail"
    outside = RevisionNodePatch(id="c", start=8, end=10, before="完成", after="做完")
    assert verdict(snapshot, selection, [outside])["range"] == "fail"
    wrong = RevisionNodePatch(id="d", start=3, end=5, before="使用", after="利用")
    assert verdict(snapshot, selection, [wrong])["range"] == "fail"


@pytest.mark.parametrize(
    ("node", "start", "end", "text", "code"),
    [
        ("missing", 0, 1, "本", "REVISION_ANCHOR_INVALID"),
        ("p", 0, 99, "本研究", "REVISION_ANCHOR_INVALID"),
        ("p", 0, 3, "本研", "REVISION_ANCHOR_INVALID"),
        ("code", 0, 2, "pr", "REVISION_UNSUPPORTED"),
        ("hdr", 0, 2, "页眉", "REVISION_ANCHOR_INVALID"),
    ],
)
def test_anchor_errors(node: str, start: int, end: int, text: str, code: str) -> None:
    raw = {
        "schemaVersion": 2,
        "model": {
            "kind": "docs",
            "schemaVersion": 1,
            "id": "doc",
            "theme": {"name": "minimal"},
            "sections": [
                {
                    "id": "s1",
                    "header": {"blocks": [paragraph("hdr", run("页眉文字"))]},
                    "blocks": [
                        paragraph("p", run("本研究采用方法。")),
                        {"type": "code_block", "id": "code", "text": "print()"},
                    ],
                }
            ],
        },
    }
    snapshot = validate_snapshot(raw)
    selection = RevisionNodeSelection(node_id=node, start=start, end=end, expected_text=text)
    with pytest.raises(AppError) as captured:
        resolve_node_selection(snapshot, selection)
    assert captured.value.code == code


def test_lone_surrogate_selection_is_rejected_by_schema() -> None:
    with pytest.raises(ValidationError):
        RevisionNodeSelection.model_validate(
            {"node_id": "p", "start": 0, "end": 1, "expected_text": "\ud83d"}
        )


def test_schema_mismatch_both_directions() -> None:
    snapshot = snapshot_of([paragraph("p", run("本研究采用方法。"))])
    v2_view = ContentView.of(2, snapshot)
    v1_selection = RevisionSelection.model_validate(
        {"textblock_path": [0], "from": 1, "to": 3, "text": "本研"}
    )
    with pytest.raises(AppError) as captured:
        resolve_for_view(v2_view, v1_selection)
    assert captured.value.code == "DOCMODEL_ANCHOR_SCHEMA_MISMATCH"
    v1_view = ContentView.of(
        1,
        {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "本研究"}]}],
        },
    )
    with pytest.raises(AppError) as captured:
        resolve_for_view(v1_view, select("p", "本研究采用方法。", "本研"))
    assert captured.value.code == "DOCMODEL_ANCHOR_SCHEMA_MISMATCH"


def test_adoption_moves_later_protections_and_passes_rule_check() -> None:
    text = "采用方法甲，样本 120 人，见文献 [3]。"
    number_start = text.index("120")
    cite_start = text.index("[3]")
    snapshot = snapshot_of(
        [paragraph("p", run(text))],
        [
            protection("n", "number", "p", number_start, number_start + 3),
            protection("c", "citation", "p", cite_start, cite_start + 3),
        ],
    )
    selection = select("p", text, "采用方法甲")
    patches = [patch("p1", selection, "使用经过改进的方法甲")]
    assert passed(verdict(snapshot, selection, patches))
    resolved = resolve_node_selection(snapshot, selection)
    adopted = validate_snapshot(apply_node_patches(resolved, patches))
    protection_rule_check(snapshot, adopted, user_edit=False)
    new_text = node_text(adopted, "p")
    for item in adopted["protections"]:
        anchor = item["anchor"]
        assert new_text[anchor["start"] : anchor["end"]] in {"120", "[3]"}


def test_multiple_patches_match_docs_ops_golden() -> None:
    text = "本研究采用方法甲并且能够验证结论。"
    snapshot = snapshot_of([paragraph("p", run("前缀", italic=True), run(text))])
    full = node_text(snapshot, "p")
    selection = RevisionNodeSelection(node_id="p", start=2, end=len(full), expected_text=full[2:])
    first = RevisionNodePatch(id="a", start=5, end=7, before="采用", after="使用")
    second = RevisionNodePatch(id="b", start=12, end=14, before="能够", after="可以")
    resolved = resolve_node_selection(snapshot, selection)
    assert passed(verdict(snapshot, selection, [first, second]))
    adopted = apply_node_patches(resolved, [first, second])
    golden = apply_ops(
        snapshot["model"],
        [
            {
                "op": "doc.replace_text",
                "id": "p",
                "range": {"start": 12, "end": 14},
                "text": second.after,
            },
            {
                "op": "doc.replace_text",
                "id": "p",
                "range": {"start": 5, "end": 7},
                "text": first.after,
            },
        ],
        ids=IdGen(0),
        now_ms=0,
    )
    assert adopted["model"] == golden.model
    block = find_block(cast(JsonDict, adopted["model"]), "p")
    assert block is not None and block["inlines"][0] == run("前缀", italic=True)
    assert node_text(adopted, "p") == "前缀本研究使用方法甲并且可以验证结论。"
