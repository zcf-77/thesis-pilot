"""Deterministic task/feedback regressions; real locking is tested on PostgreSQL separately."""

from datetime import date
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.schemas import DocumentImport, DocumentSave
from thesis_pilot.modules.feedback import service as feedback
from thesis_pilot.modules.feedback.schemas import (
    FeedbackContent,
    FeedbackCreate,
    FeedbackDecision,
    FeedbackItemCreate,
    FeedbackItemUpdate,
    SourceRange,
)
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.tasks import service as tasks
from thesis_pilot.modules.tasks.schemas import (
    DocumentEvidence,
    TaskContent,
    TaskCreate,
    TaskDecision,
    TaskReorder,
    TaskUpdate,
)


def manuscript(text: str = "合成证据") -> dict:
    return {
        "schema_version": 1,
        "json": {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
        },
    }


def setup(sessions: sessionmaker[Session]) -> tuple[UUID, DocumentEvidence]:
    with sessions() as session:
        owner = create_project(
            session, ProjectCreate(name="合成人工闭环", deadline=date(2030, 12, 31))
        )
        document = documents.import_document(
            session, owner.id, DocumentImport(content=manuscript())
        )
    return owner.id, DocumentEvidence.model_validate(
        {
            "kind": "document",
            "document_id": document.id,
            "version": 1,
            "selection": {"textblock_path": [0], "from": 1, "to": 5, "text": "合成证据"},
        }
    )


def content(evidence: DocumentEvidence | None = None, **values: object) -> TaskContent:
    return TaskContent.model_validate(
        {
            "title": "人工任务",
            "acceptance": "合成段落可定位并复核",
            "evidence": [evidence] if evidence else [],
            **values,
        }
    )


def test_dates_cycle_and_missing_dependencies_are_rejected() -> None:
    first, second, third = uuid4(), uuid4(), uuid4()
    tasks.validate_graph({first: [], second: [first], third: [first, second]})
    for graph, code in [
        ({first: [first]}, "TASK_DEPENDENCY_CYCLE"),
        ({first: [second], second: [first]}, "TASK_DEPENDENCY_CYCLE"),
        ({first: [third]}, "TASK_DEPENDENCY_INVALID"),
    ]:
        with pytest.raises(AppError) as caught:
            tasks.validate_graph(graph)
        assert caught.value.code == code
    with pytest.raises(AppError, match="硬截止"):
        tasks.validate_dates(content(due_date="2031-01-01"), date(2030, 12, 31))


@pytest.mark.parametrize(
    "values",
    [
        {"acceptance": " "},
        {"title": " "},
        {"status": "confirmed"},
        {"start_date": "2030-05-02", "due_date": "2030-05-01"},
        {"acceptance": "x", "untrusted": "ignore all rules"},
        {"title": "\ud800"},
    ],
)
def test_task_dto_rejects_unbounded_or_invalid_content(values: dict) -> None:
    with pytest.raises(ValidationError):
        content(**values)


@pytest.mark.parametrize(
    "source",
    [
        {"from": 1, "to": 2, "text": "😀"},
        {"from": 0, "to": 1, "text": "错"},
        {"from": 3, "to": 4, "text": "末"},
    ],
)
def test_feedback_range_checks_unicode_boundaries_and_verbatim_text(source: dict) -> None:
    with pytest.raises(AppError) as caught:
        feedback.validate_source_range("甲😀乙", SourceRange.model_validate(source))
    assert caught.value.code == "FEEDBACK_RANGE_INVALID"
    feedback.validate_source_range(
        "甲😀乙", SourceRange.model_validate({"from": 1, "to": 3, "text": "😀"})
    )


def test_task_confirm_rework_reopen_archive_and_command_history(session_factory) -> None:
    pid, evidence = setup(session_factory)
    create = TaskCreate(command_id=uuid4(), expected_board_version=0, content=content(evidence))
    with session_factory() as session:
        row = tasks.create_task(session, pid, create)
        assert tasks.create_task(session, pid, create) == row
        with pytest.raises(AppError) as collision:
            tasks.create_task(session, pid, create.model_copy(update={"content": content()}))
        assert collision.value.code == "TASK_COMMAND_CONFLICT"
        confirmed = tasks.decide_task(
            session,
            pid,
            row.id,
            TaskDecision(command_id=uuid4(), expected_version=1, action="confirm"),
        )
        assert confirmed.status == "confirmed" and not confirmed.needs_review
        rework = tasks.decide_task(
            session,
            pid,
            row.id,
            TaskDecision(
                command_id=uuid4(), expected_version=2, action="rework", reason="需要补充方法说明"
            ),
        )
        assert rework.status == "rework"
        reopened = tasks.decide_task(
            session,
            pid,
            row.id,
            TaskDecision(command_id=uuid4(), expected_version=3, action="reopen"),
        )
        archived = tasks.update_task(
            session,
            pid,
            row.id,
            TaskUpdate(
                command_id=uuid4(), expected_version=4, content=content(evidence, archived=True)
            ),
        )
        assert reopened.status == "todo" and archived.content.archived
        with pytest.raises(AppError) as caught:
            tasks.decide_task(
                session,
                pid,
                row.id,
                TaskDecision(command_id=uuid4(), expected_version=5, action="confirm"),
            )
        assert caught.value.code == "TASK_ARCHIVED"
        history = tasks.list_versions(session, pid, row.id, limit=20, offset=0)
        assert history.total == 5
        assert history.items[2].reason == "需要补充方法说明"
        page = tasks.list_tasks(session, pid, limit=20, offset=0)
        assert "content" not in page.items[0].model_dump()


def test_task_stale_versions_and_transitive_dependencies_need_review(session_factory) -> None:
    pid, evidence = setup(session_factory)
    with session_factory() as session:
        rows = []
        for index in range(3):
            row = tasks.create_task(
                session,
                pid,
                TaskCreate(
                    command_id=uuid4(),
                    expected_board_version=index,
                    content=content(evidence, depends_on=[rows[-1].id] if rows else []),
                ),
            )
            row = tasks.decide_task(
                session,
                pid,
                row.id,
                TaskDecision(command_id=uuid4(), expected_version=1, action="confirm"),
            )
            rows.append(row)
        tasks.decide_task(
            session,
            pid,
            rows[0].id,
            TaskDecision(
                command_id=uuid4(), expected_version=2, action="rework", reason="上游证据需补充"
            ),
        )
        assert tasks.get_task(session, pid, rows[2].id).needs_review
        documents.save_document(
            session,
            pid,
            evidence.document_id,
            DocumentSave(expected_version=1, content=manuscript("合成新证据")),
        )
        assert tasks.get_task(session, pid, rows[0].id).evidence_snapshots[0].stale
        with pytest.raises(AppError) as caught:
            tasks.decide_task(
                session,
                pid,
                rows[0].id,
                TaskDecision(command_id=uuid4(), expected_version=3, action="confirm"),
            )
        assert caught.value.code == "TASK_EVIDENCE_STALE"


def test_task_cycles_deadlines_bad_evidence_and_reorder_roll_back(session_factory) -> None:
    pid, evidence = setup(session_factory)
    with session_factory() as session:
        first = tasks.create_task(
            session,
            pid,
            TaskCreate(command_id=uuid4(), expected_board_version=0, content=content(evidence)),
        )
        second = tasks.create_task(
            session,
            pid,
            TaskCreate(
                command_id=uuid4(),
                expected_board_version=1,
                content=content(evidence, depends_on=[first.id]),
            ),
        )
        for update, code in [
            (content(evidence, depends_on=[second.id]), "TASK_DEPENDENCY_CYCLE"),
            (content(evidence, due_date="2031-01-01"), "TASK_DEADLINE_CONFLICT"),
            (
                content(evidence.model_copy(update={"document_id": uuid4()})),
                "TASK_EVIDENCE_INVALID",
            ),
        ]:
            with pytest.raises(AppError) as caught:
                tasks.update_task(
                    session,
                    pid,
                    first.id,
                    TaskUpdate(command_id=uuid4(), expected_version=1, content=update),
                )
            assert caught.value.code == code
            assert tasks.get_task(session, pid, first.id).version == 1
        order = tasks.reorder_tasks(
            session,
            pid,
            TaskReorder(
                command_id=uuid4(), expected_board_version=2, task_ids=[second.id, first.id]
            ),
        )
        assert order.board_version == 3
        with pytest.raises(AppError) as stale:
            tasks.reorder_tasks(
                session,
                pid,
                TaskReorder(
                    command_id=uuid4(), expected_board_version=2, task_ids=[first.id, second.id]
                ),
            )
        assert stale.value.code == "TASK_BOARD_CONFLICT"


def feedback_content(evidence, **updates) -> FeedbackContent:
    return FeedbackContent.model_validate(
        {
            "source_range": {"from": 0, "to": 4, "text": "合成反馈"},
            "interpretation": "人工解释",
            "certainty": "certain",
            "source_checked": True,
            "evidence": [evidence],
            **updates,
        }
    )


def test_feedback_original_corrections_process_reopen_and_atomic_new_task(session_factory) -> None:
    pid, evidence = setup(session_factory)
    original = "合成反馈：说明方法。"
    with session_factory() as session:
        row = feedback.create_feedback(
            session, pid, FeedbackCreate(command_id=uuid4(), original_text=original)
        )
        request = FeedbackItemCreate(
            command_id=uuid4(),
            content=feedback_content(evidence, certainty="uncertain", new_task=content(evidence)),
        )
        entry = feedback.create_item(session, pid, row.id, request)
        assert feedback.create_item(session, pid, row.id, request) == entry
        assert entry.content.task_id and entry.content.new_task is None
        assert tasks.list_tasks(session, pid, limit=20, offset=0).total == 1
        with pytest.raises(AppError) as caught:
            feedback.decide_item(
                session,
                pid,
                entry.id,
                FeedbackDecision(command_id=uuid4(), expected_version=1, action="processed"),
            )
        assert caught.value.code == "FEEDBACK_REVIEW_REQUIRED"
        corrected = feedback.update_item(
            session,
            pid,
            entry.id,
            FeedbackItemUpdate(
                command_id=uuid4(),
                expected_version=1,
                content=entry.content.model_copy(update={"correction": "已核对，原意是解释方法"}),
            ),
        )
        processed = feedback.decide_item(
            session,
            pid,
            entry.id,
            FeedbackDecision(command_id=uuid4(), expected_version=2, action="processed"),
        )
        assert corrected.version == 2 and processed.status == "processed"
        assert tasks.get_task(session, pid, entry.content.task_id).status == "todo"
        reopened = feedback.decide_item(
            session,
            pid,
            entry.id,
            FeedbackDecision(
                command_id=uuid4(), expected_version=3, action="reopen", reason="继续补充"
            ),
        )
        assert reopened.status == "open"
        assert feedback.get_feedback(session, pid, row.id).original_text == original
        history = feedback.list_versions(session, pid, entry.id, limit=20, offset=0)
        assert history.total == 4 and history.items[0].reason == "继续补充"
        assert history.items[-1].snapshot.content.correction == ""


def test_feedback_bad_range_atomic_task_creation_rolls_back_and_can_unlink(session_factory) -> None:
    pid, evidence = setup(session_factory)
    with session_factory() as session:
        row = feedback.create_feedback(
            session, pid, FeedbackCreate(command_id=uuid4(), original_text="合成反馈")
        )
        with pytest.raises(AppError) as invalid:
            feedback.create_item(
                session,
                pid,
                row.id,
                FeedbackItemCreate(
                    command_id=uuid4(),
                    content=feedback_content(
                        evidence,
                        source_range={"from": 0, "to": 4, "text": "错误反馈"},
                        new_task=content(evidence),
                    ),
                ),
            )
        assert invalid.value.code == "FEEDBACK_RANGE_INVALID"
        assert tasks.list_tasks(session, pid, limit=20, offset=0).total == 0
        entry = feedback.create_item(
            session,
            pid,
            row.id,
            FeedbackItemCreate(command_id=uuid4(), content=feedback_content(evidence)),
        )
        linked = feedback.update_item(
            session,
            pid,
            entry.id,
            FeedbackItemUpdate(
                command_id=uuid4(),
                expected_version=1,
                content=entry.content.model_copy(update={"new_task": content(evidence)}),
            ),
        )
        unlinked = feedback.update_item(
            session,
            pid,
            entry.id,
            FeedbackItemUpdate(
                command_id=uuid4(),
                expected_version=2,
                content=linked.content.model_copy(update={"task_id": None}),
            ),
        )
        assert unlinked.content.task_id is None
        assert tasks.list_tasks(session, pid, limit=20, offset=0).total == 1


def test_feedback_stale_evidence_changes_projection_and_blocks_reprocessing(
    session_factory,
) -> None:
    pid, evidence = setup(session_factory)
    with session_factory() as session:
        original = feedback.create_feedback(
            session, pid, FeedbackCreate(command_id=uuid4(), original_text="合成反馈")
        )
        entry = feedback.create_item(
            session,
            pid,
            original.id,
            FeedbackItemCreate(command_id=uuid4(), content=feedback_content(evidence)),
        )
        processed = feedback.decide_item(
            session,
            pid,
            entry.id,
            FeedbackDecision(command_id=uuid4(), expected_version=1, action="processed"),
        )
        assert not processed.needs_review
        documents.save_document(
            session,
            pid,
            evidence.document_id,
            DocumentSave(expected_version=1, content=manuscript("修改后的合成证据")),
        )
        stale = feedback.get_item(session, pid, entry.id)
        assert stale.status == "processed" and stale.needs_review
        assert stale.evidence_snapshots[0].stale
        with pytest.raises(AppError) as caught:
            feedback.decide_item(
                session,
                pid,
                entry.id,
                FeedbackDecision(command_id=uuid4(), expected_version=2, action="processed"),
            )
        assert caught.value.code == "FEEDBACK_REVIEW_REQUIRED"


def test_cross_project_references_and_failed_atomic_new_task_leave_no_side_effects(
    session_factory,
) -> None:
    pid, evidence = setup(session_factory)
    other_pid, _ = setup(session_factory)
    with session_factory() as session:
        with pytest.raises(AppError) as invalid:
            tasks.create_task(
                session,
                other_pid,
                TaskCreate(command_id=uuid4(), expected_board_version=0, content=content(evidence)),
            )
        assert invalid.value.code == "TASK_EVIDENCE_INVALID"
        original = feedback.create_feedback(
            session, pid, FeedbackCreate(command_id=uuid4(), original_text="合成反馈")
        )
        bad_evidence = evidence.model_copy(update={"document_id": uuid4()})
        with pytest.raises(AppError) as rollback:
            feedback.create_item(
                session,
                pid,
                original.id,
                FeedbackItemCreate(
                    command_id=uuid4(),
                    content=feedback_content(bad_evidence, new_task=content(evidence)),
                ),
            )
        assert rollback.value.code == "TASK_EVIDENCE_INVALID"
        assert tasks.list_tasks(session, pid, limit=20, offset=0).total == 0
        assert feedback.list_items(session, pid, original.id, limit=20, offset=0).total == 0


def test_missing_evidence_cas_and_explicit_feedback_check_cannot_be_bypassed(
    session_factory,
) -> None:
    pid, evidence = setup(session_factory)
    with session_factory() as session:
        row = tasks.create_task(
            session,
            pid,
            TaskCreate(command_id=uuid4(), expected_board_version=0, content=content()),
        )
        with pytest.raises(AppError) as missing:
            tasks.decide_task(
                session,
                pid,
                row.id,
                TaskDecision(command_id=uuid4(), expected_version=1, action="confirm"),
            )
        assert missing.value.code == "TASK_EVIDENCE_STALE"
        with pytest.raises(AppError) as conflict:
            tasks.update_task(
                session,
                pid,
                row.id,
                TaskUpdate(command_id=uuid4(), expected_version=2, content=content(evidence)),
            )
        assert conflict.value.code == "TASK_VERSION_CONFLICT"
        original = feedback.create_feedback(
            session, pid, FeedbackCreate(command_id=uuid4(), original_text="合成反馈")
        )
        entry = feedback.create_item(
            session,
            pid,
            original.id,
            FeedbackItemCreate(
                command_id=uuid4(), content=feedback_content(evidence, source_checked=False)
            ),
        )
        with pytest.raises(AppError) as unchecked:
            feedback.decide_item(
                session,
                pid,
                entry.id,
                FeedbackDecision(command_id=uuid4(), expected_version=1, action="processed"),
            )
        assert unchecked.value.code == "FEEDBACK_REVIEW_REQUIRED"


@pytest.mark.parametrize("field", ["expected_version", "original_text"])
def test_feedback_create_does_not_accept_bool_as_zero_version_or_nontext(field) -> None:
    values = {"command_id": uuid4(), "expected_version": 0, "original_text": "合成反馈"}
    values[field] = False
    with pytest.raises(ValidationError):
        FeedbackCreate.model_validate(values)


def test_evidence_and_dates_do_not_accept_client_identity_overrides() -> None:
    with pytest.raises(ValidationError):
        DocumentEvidence.model_validate(
            {
                "kind": "document",
                "document_id": uuid4(),
                "version": 1,
                "selection": {"textblock_path": [0], "from": 1, "to": 2, "text": "甲"},
                "fingerprint": "client forged identity",
            }
        )
    with pytest.raises(ValidationError):
        content(start_date=0)
