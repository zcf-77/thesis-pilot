from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentImport, DocumentSave
from thesis_pilot.modules.documents.structure import MAX_SAFE_INTEGER
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.revisions import service
from thesis_pilot.modules.revisions.models import (
    RevisionCandidate,
    RevisionCommand,
    RevisionProposal,
)
from thesis_pilot.modules.revisions.schemas import (
    MAX_REVISION_BYTES,
    RevisionApply,
    RevisionCancel,
    RevisionCreate,
    RevisionDecide,
    RevisionRevert,
    RevisionUndo,
)
from thesis_pilot.modules.revisions.schemas import (
    RevisionProposal as ProposalInput,
)
from thesis_pilot.modules.revisions.transport import encoded_resource


def content(text: str) -> dict:
    return {
        "schema_version": 1,
        "json": {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
        },
    }


def seeded(
    sessions: sessionmaker[Session], text: str = "采用方法甲。能够验证。"
) -> tuple[UUID, UUID]:
    with sessions() as session:
        project = create_project(session, ProjectCreate(name="修订自制项目"))
        document = documents.import_document(
            session, project.id, DocumentImport(content=content(text))
        )
    return project.id, document.id


def prepared(
    sessions: sessionmaker[Session],
    project_id: UUID,
    document_id: UUID,
    *,
    text: str = "采用方法甲。能够验证。",
    after: str = "使用方法甲。可以验证。",
    accepted: bool = True,
) -> UUID:
    length = len(text.encode("utf-16-le")) // 2
    with sessions() as session:
        created = service.create_revision(
            session,
            project_id,
            document_id,
            RevisionCreate.model_validate(
                {
                    "command_id": str(uuid4()),
                    "base_version": 1,
                    "selection": {"textblock_path": [0], "from": 1, "to": length + 1, "text": text},
                    "goal": "精简文字",
                }
            ),
        )
        assert created.candidate_id is not None
        item = service.get_revision(session, project_id, document_id, created.candidate_id)
        service.submit_proposal(
            session,
            project_id,
            document_id,
            item.id,
            ProposalInput.model_validate(
                {
                    "command_id": str(uuid4()),
                    "generation_token": str(item.generation_token),
                    "patches": [
                        {"id": "p1", "from": 1, "to": length + 1, "before": text, "after": after}
                    ],
                }
            ),
        )
        if accepted:
            service.decide_revision(
                session,
                project_id,
                document_id,
                item.id,
                RevisionDecide.model_validate(
                    {
                        "command_id": str(uuid4()),
                        "expected_revision": 2,
                        "decisions": [{"patch_id": "p1", "decision": "accepted"}],
                    }
                ),
            )
        return item.id


def test_apply_undo_revert_receipts_survive_new_sessions(
    session_factory: sessionmaker[Session],
) -> None:
    ids = seeded(session_factory, "采用方法甲😀\u0000。")
    candidate_id = prepared(
        session_factory, *ids, text="采用方法甲😀\u0000。", after="使用方法甲😀\u0000。"
    )
    apply = RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=1)
    with session_factory() as session:
        receipt = service.apply_revision(session, *ids, candidate_id, apply)
        assert (receipt.base_version, receipt.result_version, receipt.candidate_revision) == (
            1,
            2,
            4,
        )
        assert service.apply_revision(session, *ids, candidate_id, apply) == receipt
    with session_factory() as session:
        assert service.get_command(session, *ids, apply.command_id) == receipt
        current = service.get_revision(session, *ids, candidate_id)
        assert current.status == "applied" and current.application_command_id == apply.command_id
        assert documents.get_version(session, *ids, 2).source == "ai_adoption"
        undo = RevisionUndo(command_id=uuid4(), expected_document_version=2)
        undone = service.undo_revision(session, *ids, apply.command_id, undo)
        assert (undone.base_version, undone.result_version) == (2, 3)
        assert service.undo_revision(session, *ids, apply.command_id, undo) == undone
        assert (
            documents.get_version(session, *ids, 3).content
            == documents.get_version(session, *ids, 1).content
        )
        assert service.get_revision(session, *ids, candidate_id).status == "undone"
        assert service.get_revision(session, *ids, candidate_id).result_version == 2
        with pytest.raises(AppError, match="已有其他变更") as twice:
            service.undo_revision(
                session,
                *ids,
                apply.command_id,
                RevisionUndo(command_id=uuid4(), expected_document_version=3),
            )
        assert twice.value.code == "REVISION_UNDO_CONFLICT"
        restored = service.revert_document(
            session,
            *ids,
            RevisionRevert(command_id=uuid4(), expected_document_version=3, target_version=2),
        )
        assert restored.candidate_id is None and restored.result_version == 4
        assert documents.get_version(session, *ids, 4).source == "version_revert"
        assert documents.list_versions(session, *ids, limit=100, offset=0).total == 4


def test_partial_decisions_and_review_cas(session_factory: sessionmaker[Session]) -> None:
    ids = seeded(session_factory)
    with session_factory() as session:
        request = RevisionCreate.model_validate(
            {
                "command_id": str(uuid4()),
                "base_version": 1,
                "selection": {
                    "textblock_path": [0],
                    "from": 1,
                    "to": 12,
                    "text": "采用方法甲。能够验证。",
                },
                "goal": "逐项审阅",
            }
        )
        created = service.create_revision(session, *ids, request)
        assert service.create_revision(session, *ids, request) == created
        item = service.get_revision(session, *ids, created.candidate_id)
        proposal = ProposalInput.model_validate(
            {
                "command_id": str(uuid4()),
                "generation_token": str(item.generation_token),
                "patches": [
                    {"id": "p1", "from": 1, "to": 3, "before": "采用", "after": "使用"},
                    {"id": "p2", "from": 7, "to": 9, "before": "能够", "after": "可以"},
                ],
            }
        )
        service.submit_proposal(session, *ids, item.id, proposal)
        decisions = RevisionDecide.model_validate(
            {
                "command_id": str(uuid4()),
                "expected_revision": 2,
                "decisions": [
                    {"patch_id": "p1", "decision": "accepted"},
                    {"patch_id": "p2", "decision": "rejected"},
                ],
            }
        )
        service.decide_revision(session, *ids, item.id, decisions)
        with pytest.raises(AppError) as stale:
            service.decide_revision(
                session, *ids, item.id, decisions.model_copy(update={"command_id": uuid4()})
            )
        assert stale.value.code == "REVISION_REVIEW_CONFLICT"
        assert documents.get_current_document(session, ids[0]).version == 1
        result = service.apply_revision(
            session,
            *ids,
            item.id,
            RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=1),
        )
        assert (
            documents.get_version(session, *ids, result.result_version).content.json_content
            == content("使用方法甲。能够验证。")["json"]
        )
        assert service.submit_proposal(session, *ids, item.id, proposal).candidate_revision == 2
        assert service.get_revision(session, *ids, item.id).revision == 4


@pytest.mark.parametrize(
    "text,after,rule",
    [
        ("样本为 120 人。", "样本为 121 人。", "number"),
        ("Wang（2024）。", "Li（2024）。", "citation"),
        ("采用 x+y。", "使用 x+y。", "formula"),
    ],
)
def test_invalid_candidates_cannot_be_decided_or_applied(
    session_factory: sessionmaker[Session], text: str, after: str, rule: str
) -> None:
    ids = seeded(session_factory, text)
    candidate_id = prepared(session_factory, *ids, text=text, after=after, accepted=False)
    with session_factory() as session:
        item = service.get_revision(session, *ids, candidate_id)
        assert item.status == "invalid" and not item.applicable
        assert next(check for check in item.checks if check.rule == rule).result != "pass"
        with pytest.raises(AppError):
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
        with pytest.raises(AppError):
            service.apply_revision(
                session,
                *ids,
                item.id,
                RevisionApply(command_id=uuid4(), expected_revision=2, expected_document_version=1),
            )
        assert documents.get_current_document(session, ids[0]).version == 1
        assert (
            session.scalar(
                select(func.count())
                .select_from(RevisionCommand)
                .where(RevisionCommand.operation == "apply")
            )
            == 0
        )


def test_stale_same_text_and_undo_after_manual_edit_preserve_new_work(
    session_factory: sessionmaker[Session],
) -> None:
    ids = seeded(session_factory)
    candidate_id = prepared(session_factory, *ids)
    with session_factory() as session:
        documents.save_document(
            session,
            *ids,
            DocumentSave(expected_version=1, content=content("采用方法甲。能够验证。")),
        )
        assert not service.get_revision(session, *ids, candidate_id).applicable
        with pytest.raises(AppError) as stale:
            service.apply_revision(
                session,
                *ids,
                candidate_id,
                RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=2),
            )
        assert stale.value.code == "REVISION_STALE"
    other = seeded(session_factory)
    other_candidate = prepared(session_factory, *other)
    with session_factory() as session:
        applied = service.apply_revision(
            session,
            *other,
            other_candidate,
            RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=1),
        )
        documents.save_document(
            session, *other, DocumentSave(expected_version=2, content=content("后续手动文字"))
        )
        with pytest.raises(AppError) as conflict:
            service.undo_revision(
                session,
                *other,
                applied.command_id,
                RevisionUndo(command_id=uuid4(), expected_document_version=3),
            )
        assert conflict.value.code == "REVISION_UNDO_CONFLICT"
        assert (
            documents.get_current_document(session, other[0]).content.json_content
            == content("后续手动文字")["json"]
        )


def test_cancel_late_result_and_command_identity(session_factory: sessionmaker[Session]) -> None:
    ids = seeded(session_factory, "采用")
    with session_factory() as session:
        data = RevisionCreate.model_validate(
            {
                "command_id": str(uuid4()),
                "base_version": 1,
                "selection": {"textblock_path": [0], "from": 1, "to": 3, "text": "采用"},
                "goal": "精简",
            }
        )
        created = service.create_revision(session, *ids, data)
        item = service.get_revision(session, *ids, created.candidate_id)
        cancel = RevisionCancel(command_id=uuid4())
        cancelled = service.cancel_revision(session, *ids, item.id, cancel)
        assert service.cancel_revision(session, *ids, item.id, cancel) == cancelled
        with pytest.raises(AppError) as late:
            service.submit_proposal(
                session,
                *ids,
                item.id,
                ProposalInput.model_validate(
                    {
                        "command_id": str(uuid4()),
                        "generation_token": str(item.generation_token),
                        "patches": [
                            {"id": "p1", "from": 1, "to": 3, "before": "采用", "after": "使用"}
                        ],
                    }
                ),
            )
        assert late.value.code == "REVISION_STATE_CONFLICT"
        with pytest.raises(AppError) as reused:
            service.create_revision(session, *ids, data.model_copy(update={"goal": "其他目标"}))
        assert reused.value.code == "REVISION_COMMAND_CONFLICT"
        assert service.get_revision(session, *ids, item.id).status == "cancelled"
        assert session.scalar(select(func.count()).select_from(RevisionProposal)) == 0


def test_receipt_insert_failure_rolls_back_version_and_candidate(
    session_factory: sessionmaker[Session],
) -> None:
    ids = seeded(session_factory)
    candidate_id = prepared(session_factory, *ids)

    def fail(mapper: object, connection: object, target: RevisionCommand) -> None:
        if target.operation == "apply":
            raise RuntimeError("synthetic command receipt failure")

    event.listen(RevisionCommand, "before_insert", fail)
    try:
        with session_factory() as session, pytest.raises(RuntimeError, match="synthetic"):
            service.apply_revision(
                session,
                *ids,
                candidate_id,
                RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=1),
            )
    finally:
        event.remove(RevisionCommand, "before_insert", fail)
    with session_factory() as session:
        assert documents.get_current_document(session, ids[0]).version == 1
        item = service.get_revision(session, *ids, candidate_id)
        assert item.status == "ready" and item.revision == 3
        assert session.scalar(select(func.count()).select_from(DocumentVersion)) == 1


def test_cross_project_and_empty_decision_paths(session_factory: sessionmaker[Session]) -> None:
    ids = seeded(session_factory)
    other = seeded(session_factory)
    candidate_id = prepared(session_factory, *ids, accepted=False)
    with session_factory() as session:
        with pytest.raises(AppError) as missing:
            service.get_revision(session, other[0], ids[1], candidate_id)
        assert missing.value.code == "DOCUMENT_NOT_FOUND"
        with pytest.raises(AppError) as wrong:
            service.get_revision(session, *other, candidate_id)
        assert wrong.value.code == "REVISION_NOT_FOUND"
        with pytest.raises(AppError) as empty:
            service.apply_revision(
                session,
                *ids,
                candidate_id,
                RevisionApply(command_id=uuid4(), expected_revision=2, expected_document_version=1),
            )
        assert empty.value.code == "REVISION_NOTHING_ACCEPTED"
        with pytest.raises(AppError) as no_change:
            service.revert_document(
                session,
                *ids,
                RevisionRevert(command_id=uuid4(), expected_document_version=1, target_version=1),
            )
        assert no_change.value.code == "REVISION_NO_CHANGE"
        page = service.list_revisions(session, *ids, limit=1, offset=0)
        assert page.total == 1 and "patches" not in page.items[0].model_dump()
        assert session.scalar(select(func.count()).select_from(RevisionCandidate)) == 1


def test_final_read_budget_rolls_back_apply_and_reserves_derived_version(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    class FixedClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2030, 1, 1, 12, 0, 0, 123456, tzinfo=UTC)

    monkeypatch.setattr(service, "datetime", FixedClock)
    probe_ids = seeded(session_factory, "采用")
    probe_id = prepared(session_factory, *probe_ids, text="采用", after="a", accepted=False)
    with session_factory() as session:
        probe = service.get_revision(session, *probe_ids, probe_id)
    reserved = len(
        encoded_resource(
            probe.model_copy(update={"document_version": MAX_SAFE_INTEGER, "applicable": False})
        )
    )
    after = "a" * (1 + MAX_REVISION_BYTES - reserved - 8)
    ids = seeded(session_factory, "采用")
    candidate_id = prepared(session_factory, *ids, text="采用", after=after, accepted=False)
    with session_factory() as session:
        item = service.get_revision(session, *ids, candidate_id)
        assert (
            len(
                encoded_resource(
                    item.model_copy(
                        update={"document_version": MAX_SAFE_INTEGER, "applicable": False}
                    )
                )
            )
            == MAX_REVISION_BYTES - 8
        )
        service.decide_revision(
            session,
            *ids,
            candidate_id,
            RevisionDecide.model_validate(
                {
                    "command_id": str(uuid4()),
                    "expected_revision": 2,
                    "decisions": [{"patch_id": "p1", "decision": "accepted"}],
                }
            ),
        )
        command_id = uuid4()
        with pytest.raises(AppError) as too_large:
            service.apply_revision(
                session,
                *ids,
                candidate_id,
                RevisionApply(
                    command_id=command_id, expected_revision=3, expected_document_version=1
                ),
            )
        assert too_large.value.code == "REVISION_TOO_LARGE"
        assert service.get_revision(session, *ids, candidate_id).revision == 3
        assert documents.get_current_document(session, ids[0]).version == 1
        with pytest.raises(AppError) as absent:
            service.get_command(session, *ids, command_id)
        assert absent.value.code == "REVISION_COMMAND_NOT_FOUND"
        for old in range(1, 10):
            documents.save_document(
                session, *ids, DocumentSave(expected_version=old, content=content("采用"))
            )
        stale = service.get_revision(session, *ids, candidate_id)
        assert stale.document_version == 10 and not stale.applicable
        assert len(encoded_resource(stale)) <= MAX_REVISION_BYTES
