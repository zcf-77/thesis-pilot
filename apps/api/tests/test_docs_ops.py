"""DocsModel subset + op subset against the MuffinOffice kernel golden (rev cfb8352)."""

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from thesis_pilot.modules.documents.docs_model import DocsModel, to_json
from thesis_pilot.modules.documents.docs_ops import (
    SUPPORTED_OPS,
    DocOpsError,
    IdGen,
    apply_ops,
)

FIXTURE = Path(__file__).parent / "fixtures" / "muffin_office" / "doc-ops-conformance.json"
GOLDEN = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES: list[dict[str, Any]] = GOLDEN["cases"]


def in_subset(model: object) -> bool:
    try:
        DocsModel.model_validate(model)
    except ValidationError:
        return False
    return True


def classify(case: dict[str, Any]) -> str:
    if any(op.get("op") not in SUPPORTED_OPS for op in case["txn"]):
        return "op-outside-subset"
    if not in_subset(case["model"]) or ("expected" in case and not in_subset(case["expected"])):
        return "model-outside-subset"
    return "run"


def test_golden_source_and_partition() -> None:
    assert GOLDEN["schema"] == "doc-ops-conformance/1"
    assert len(CASES) == 144
    counts: dict[str, int] = {}
    for case in CASES:
        kind = classify(case)
        counts[kind] = counts.get(kind, 0) + 1
    # Skipped cases are explicit: ops not in the ThesisPilot subset (delete/move/run
    # props/table/section/meta) and models using containers or footnotes.
    assert counts == {"run": 96, "op-outside-subset": 45, "model-outside-subset": 3}


# Only in-subset cases are parametrized; the partition test above pins what is excluded.
RUNNABLE = [case for case in CASES if classify(case) == "run"]


@pytest.mark.parametrize("case", RUNNABLE, ids=[case["name"] for case in RUNNABLE])
def test_kernel_conformance(case: dict[str, Any]) -> None:
    model = case["model"]
    # Our canonical dump is byte-for-byte the kernel's serde serialization.
    assert to_json(DocsModel.model_validate(model)) == model
    snapshot = deepcopy(model)
    if "error" in case:
        with pytest.raises(DocOpsError) as raised:
            apply_ops(model, case["txn"], ids=IdGen(1), now_ms=0)
        assert case["error"] in raised.value.message
    else:
        result = apply_ops(model, case["txn"], ids=IdGen(1), now_ms=0)
        assert result.model == case["expected"]
        assert bool(result.new_ids) == bool(case.get("kernelOnly"))
        assert to_json(DocsModel.model_validate(result.model)) == result.model
    assert model == snapshot


def test_idgen_matches_kernel_sequence() -> None:
    minted = next(
        case for case in CASES if case["name"] == "insert_block: an empty id gets a kernel id"
    )
    generated = IdGen(1).next(0)
    assert generated in json.dumps(minted["expected"])
    assert len(generated) == 26 and generated[0] <= "7"


def test_restricted_mode_rejects_non_whitelisted_para_props() -> None:
    model = CASES[0]["model"]
    with pytest.raises(DocOpsError) as raised:
        apply_ops(
            model,
            [{"op": "doc.set_para_props", "ids": ["p1"], "props": {"style": "Body"}}],
            ids=IdGen(1),
            now_ms=0,
            restricted=True,
        )
    assert raised.value.code == "not_allowed"
    result = apply_ops(
        model,
        [{"op": "doc.set_para_props", "ids": ["p1"], "props": {"align": "center"}}],
        ids=IdGen(1),
        now_ms=0,
        restricted=True,
    )
    assert result.model["sections"][0]["blocks"][0]["props"] == {"align": "center"}


def test_unsupported_ops_fail_before_any_change() -> None:
    model = CASES[0]["model"]
    with pytest.raises(DocOpsError) as raised:
        apply_ops(
            model,
            [
                {"op": "doc.replace_text", "id": "p1", "text": "x"},
                {"op": "doc.delete_block", "id": "p1"},
            ],
            ids=IdGen(1),
            now_ms=0,
        )
    assert raised.value.code == "unsupported"
