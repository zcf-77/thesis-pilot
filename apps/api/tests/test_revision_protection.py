import json
from pathlib import Path

import pytest

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.structure import canonical_editor_json
from thesis_pilot.modules.revisions.anchors import apply_patches, resolve_selection
from thesis_pilot.modules.revisions.protection import check_patches
from thesis_pilot.modules.revisions.schemas import RevisionPatch, RevisionSelection

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures/revision-protection.json").read_text(encoding="utf-8")
)
CASES = [
    item
    for group in FIXTURE["cases"]
    for item in [group, *group.get("variants", [])]
    if item["kind"] == "protection"
]


@pytest.mark.parametrize(
    "case", CASES, ids=lambda case: case["id"] + ":" + case.get("variant_id", "main")
)
def test_shared_protection_drafts(case: dict) -> None:
    original = json.loads(json.dumps(case["document"]["json"]))
    selection = RevisionSelection.model_validate(case["selection"])
    expected = case["expected"]
    if expected["error_code"]:
        with pytest.raises(AppError) as captured:
            resolve_selection(original, selection)
        assert captured.value.code == expected["error_code"]
        return
    resolved = resolve_selection(original, selection)
    patches = [RevisionPatch.model_validate(patch) for patch in case["patches"]]
    checks = check_patches(
        resolved,
        selection,
        patches,
        base_version=case["base_version"],
        current_version=case["current_version"],
    )
    assert all(check.result == "pass" for check in checks) == expected["allowed"], checks
    results = {check.rule: check.result for check in checks}
    for rule in expected["failed_rules"]:
        assert results[rule] == "fail", checks
    for rule in expected["unsupported_rules"]:
        assert results[rule] == "unsupported", checks
    if expected["allowed"]:
        assert apply_patches(resolved, patches) == canonical_editor_json(expected["result_json"])
    assert original == case["document"]["json"]


def test_fixture_is_draft_not_human_acceptance() -> None:
    assert len(FIXTURE["cases"]) == 42
    assert [group["id"] for group in FIXTURE["cases"]] == [f"SG04-P{n:02d}" for n in range(1, 43)]
    assert FIXTURE["human_review"] == {"status": "pending", "reviewer": None, "confirmed_at": None}
    assert all(group["human_review"] == FIXTURE["human_review"] for group in FIXTURE["cases"])
