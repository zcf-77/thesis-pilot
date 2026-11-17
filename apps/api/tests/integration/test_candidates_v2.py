"""Real PostgreSQL arbitration of v2 content candidates and v2 format adoption."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any, cast
from uuid import uuid4

import pytest

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.docs_model import JsonDict, atom_text, find_block
from thesis_pilot.modules.documents.schemas import DocumentImport
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.revisions import service
from thesis_pilot.modules.revisions.schemas import (
    RevisionApply,
    RevisionCreate,
    RevisionDecide,
    RevisionUndo,
)
from thesis_pilot.modules.revisions.schemas import RevisionProposal as ProposalInput

from .conftest import PostgreSQLSandbox

pytestmark = pytest.mark.integration

TEXT = "甲😀𠀀本研究采用方法甲，样本 120 人。"


def snapshot() -> dict[str, Any]:
    number = TEXT.index("120")
    return {
        "schemaVersion": 2,
        "model": {
            "kind": "docs",
            "schemaVersion": 1,
            "id": "doc",
            "theme": {"name": "minimal"},
            "sections": [
                {
                    "id": "s1",
                    "blocks": [
                        {
                            "type": "paragraph",
                            "id": "p1",
                            "inlines": [{"type": "run", "text": TEXT}],
                        }
                    ],
                }
            ],
        },
        "protections": [
            {
                "id": "lk",
                "kind": "lock",
                "anchor": {"node": "p1", "start": number, "end": number + 3},
            }
        ],
    }


def seeded(postgres: PostgreSQLSandbox) -> tuple:
    with postgres.sessions() as session:
        project = create_project(session, ProjectCreate(name="v2 候选真实PG自制项目"))
        document = documents.import_document(
            session,
            project.id,
            DocumentImport.model_validate({"content": {"schema_version": 2, "json": snapshot()}}),
        )
    return project.id, document.id


def prepared(postgres: PostgreSQLSandbox, ids: tuple, part: str, after: str):
    start = TEXT.index(part)
    with postgres.sessions() as session:
        receipt = service.create_revision(
            session,
            *ids,
            RevisionCreate.model_validate(
                {
                    "command_id": str(uuid4()),
                    "base_version": 1,
                    "selection": {
                        "node_id": "p1",
                        "start": start,
                        "end": start + len(part),
                        "expected_text": part,
                    },
                    "goal": "改写",
                }
            ),
        )
        item = service.get_revision(session, *ids, receipt.candidate_id)
        service.submit_proposal(
            session,
            *ids,
            item.id,
            ProposalInput.model_validate(
                {
                    "command_id": str(uuid4()),
                    "generation_token": str(item.generation_token),
                    "patches": [
                        {
                            "id": "p1",
                            "start": start,
                            "end": start + len(part),
                            "before": part,
                            "after": after,
                        }
                    ],
                }
            ),
        )
        service.decide_revision(
            session,
            *ids,
            item.id,
            RevisionDecide.model_validate(
                {
                    "command_id": str(uuid4()),
                    "expected_revision": 2,
                    "decisions": [{"patch_id": "p1", "decision": "accepted"}],
                }
            ),
        )
        return service.get_revision(session, *ids, item.id)


def current_text(postgres: PostgreSQLSandbox, ids: tuple) -> str:
    with postgres.sessions() as session:
        current = documents.get_current_document(session, ids[0])
        block = find_block(cast(JsonDict, current.content.json_content["model"]), "p1")
        assert block is not None
        return atom_text(cast(list[JsonDict], block["inlines"]))


def test_competing_v2_candidates_and_replayed_command_have_one_version(
    postgres: PostgreSQLSandbox,
) -> None:
    ids = seeded(postgres)
    items = [prepared(postgres, ids, "采用", "使用"), prepared(postgres, ids, "方法甲", "方法乙")]
    assert all(item.applicable and item.content_schema_version == 2 for item in items)
    barrier = Barrier(2, timeout=10)

    def apply(item):
        barrier.wait()
        with postgres.sessions() as session:
            try:
                return service.apply_revision(
                    session,
                    *ids,
                    item.id,
                    RevisionApply(
                        command_id=uuid4(), expected_revision=3, expected_document_version=1
                    ),
                ).result_version
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(apply, items))
    assert sorted(map(str, results)) == ["2", "REVISION_STALE"]
    assert current_text(postgres, ids) in {
        TEXT.replace("采用", "使用"),
        TEXT.replace("方法甲", "方法乙"),
    }
    other = seeded(postgres)
    item = prepared(postgres, other, "采用方法甲", "使用方法乙")
    fixed = RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=1)
    repeat = Barrier(2, timeout=10)

    def replay(_):
        repeat.wait()
        with postgres.sessions() as session:
            return service.apply_revision(session, *other, item.id, fixed)

    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = list(pool.map(replay, range(2)))
    assert receipts[0] == receipts[1] and receipts[0].result_version == 2
    undo = RevisionUndo(command_id=uuid4(), expected_document_version=2)
    race = Barrier(2, timeout=10)

    def undo_once(_):
        race.wait()
        with postgres.sessions() as session:
            return service.undo_revision(session, *other, receipts[0].command_id, undo)

    with ThreadPoolExecutor(max_workers=2) as pool:
        undone = list(pool.map(undo_once, range(2)))
    assert undone[0] == undone[1] and undone[0].result_version == 3
    assert current_text(postgres, other) == TEXT
    with postgres.sessions() as session:
        assert documents.list_versions(session, *ids, limit=100, offset=0).total == 2
        assert documents.list_versions(session, *other, limit=100, offset=0).total == 3


def test_locked_number_rejection_never_writes(postgres: PostgreSQLSandbox) -> None:
    ids = seeded(postgres)
    with pytest.raises(AppError) as captured:
        prepared(postgres, ids, "样本 120 人", "样本 121 人")
    assert captured.value.code == "REVISION_PROTECTION_FAILED"
    with postgres.sessions() as session:
        assert documents.list_versions(session, *ids, limit=100, offset=0).total == 1
    assert current_text(postgres, ids) == TEXT
