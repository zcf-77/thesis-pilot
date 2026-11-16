"""SG-09A graph, evidence and immutable feedback invariants on real PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, event, func, select, update
from sqlalchemy.exc import DBAPIError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import Document
from thesis_pilot.modules.documents.schemas import DocumentContent, DocumentImport, DocumentSave
from thesis_pilot.modules.feedback import service as feedback
from thesis_pilot.modules.feedback.models import FeedbackBatch, FeedbackItem, FeedbackItemVersion
from thesis_pilot.modules.feedback.schemas import (
    FeedbackContent,
    FeedbackCreate,
    FeedbackDecision,
    FeedbackItemCreate,
    FeedbackItemUpdate,
)
from thesis_pilot.modules.materials import service as materials
from thesis_pilot.modules.materials.schemas import MaterialOriginalCreate, MaterialReparse
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.tasks import service as tasks
from thesis_pilot.modules.tasks.models import (
    ProjectTask,
    TaskBoard,
    TaskFeedbackCommand,
    TaskVersion,
)
from thesis_pilot.modules.tasks.schemas import TaskContent, TaskCreate, TaskDecision, TaskUpdate

from .conftest import PostgreSQLSandbox
from .test_materials import finish_parse, payload, upload

pytestmark = pytest.mark.integration


def manuscript(text: str = "合成证据") -> dict:
    return {
        "schema_version": 1,
        "json": {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
        },
    }


def seed(postgres: PostgreSQLSandbox) -> tuple[UUID, UUID]:
    with postgres.sessions() as session:
        project = create_project(session, ProjectCreate(name="合成任务反馈PG项目"))
        document = documents.import_document(
            session, project.id, DocumentImport(content=manuscript())
        )
    return project.id, document.id


def evidence(document_id: UUID, version: int = 1) -> dict:
    return {
        "kind": "document",
        "document_id": document_id,
        "version": version,
        "selection": {"textblock_path": [0], "from": 1, "to": 5, "text": "合成证据"},
    }


def content(document_id: UUID, **changes: object) -> TaskContent:
    return TaskContent.model_validate(
        {
            "title": "核对合成稿",
            "acceptance": "核对合成证据并由学生明确确认",
            "evidence": [evidence(document_id)],
            **changes,
        }
    )


def create_task(postgres: PostgreSQLSandbox, ids: tuple, *, board: int = 0, **changes: object):
    with postgres.sessions() as session:
        return tasks.create_task(
            session,
            ids[0],
            TaskCreate(
                command_id=uuid4(), expected_board_version=board, content=content(ids[1], **changes)
            ),
        )


def test_graph_and_foreign_evidence_fail_without_changing_board(
    postgres: PostgreSQLSandbox,
) -> None:
    ids = seed(postgres)
    first = create_task(postgres, ids)
    second = create_task(postgres, ids, board=1, depends_on=[first.id])
    foreign = seed(postgres)
    foreign_task = create_task(postgres, foreign)
    with postgres.sessions() as session, pytest.raises(AppError) as cycle:
        tasks.update_task(
            session,
            ids[0],
            first.id,
            TaskUpdate(
                command_id=uuid4(),
                expected_version=1,
                content=content(ids[1], depends_on=[second.id]),
            ),
        )
    assert cycle.value.code == "TASK_DEPENDENCY_CYCLE"
    for changes, expected in [
        ({"depends_on": [foreign_task.id]}, "TASK_DEPENDENCY_INVALID"),
        ({"evidence": [evidence(foreign[1])]}, "TASK_EVIDENCE_INVALID"),
    ]:
        with postgres.sessions() as session, pytest.raises(AppError) as refused:
            tasks.create_task(
                session,
                ids[0],
                TaskCreate(
                    command_id=uuid4(), expected_board_version=2, content=content(ids[1], **changes)
                ),
            )
        assert refused.value.code == expected
    with postgres.sessions() as session:
        board = tasks.list_tasks(session, ids[0], limit=100, offset=0)
        assert board.total == 2 and board.board_version == 2
        assert tasks.get_task(session, ids[0], first.id).version == 1


def test_same_command_concurrently_replays_one_task_and_conflicting_payload_is_rejected(
    postgres: PostgreSQLSandbox,
) -> None:
    ids = seed(postgres)
    request = TaskCreate(command_id=uuid4(), expected_board_version=0, content=content(ids[1]))
    barrier = Barrier(2, timeout=10)

    def create(_: int):
        barrier.wait()
        with postgres.sessions() as session:
            return tasks.create_task(session, ids[0], request)

    with ThreadPoolExecutor(max_workers=2) as pool:
        one, replay = pool.map(create, range(2))
    assert one == replay
    with postgres.sessions() as session, pytest.raises(AppError) as conflict:
        tasks.create_task(
            session,
            ids[0],
            request.model_copy(update={"content": content(ids[1], title="不同命令载荷")}),
        )
    assert conflict.value.code == "TASK_COMMAND_CONFLICT"
    with postgres.sessions() as session:
        for model in (ProjectTask, TaskVersion, TaskFeedbackCommand):
            assert session.scalar(select(func.count()).select_from(model)) == 1
        assert session.get(TaskBoard, ids[0]).version == 1


def test_waiting_confirmation_rechecks_document_after_lock_and_old_evidence_stays_visible(
    postgres: PostgreSQLSandbox,
) -> None:
    ids = seed(postgres)
    task = create_task(postgres, ids)
    entered = Event()

    def confirm():
        entered.set()
        with postgres.sessions() as session:
            try:
                tasks.decide_task(
                    session,
                    ids[0],
                    task.id,
                    TaskDecision(command_id=uuid4(), expected_version=1, action="confirm"),
                )
                return "unexpected-success"
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=1) as pool:
        with postgres.sessions() as locked, locked.begin():
            locked.scalar(select(Document).where(Document.id == ids[1]).with_for_update())
            pending = pool.submit(confirm)
            assert entered.wait(timeout=5)
            documents.append_document_version(
                locked,
                *ids,
                1,
                DocumentContent.model_validate(manuscript("合成证据更新")),
                "manual_edit",
            )
        assert pending.result(timeout=10) == "TASK_EVIDENCE_STALE"
    with postgres.sessions() as session:
        current = tasks.get_task(session, ids[0], task.id)
        assert current.status == "todo" and current.version == 1 and current.needs_review
        assert current.evidence_snapshots[0].stale
        assert current.evidence_snapshots[0].reference.version == 1
        assert documents.get_version(session, *ids, 1).content.json_content == manuscript()["json"]


def test_confirmed_dependency_change_requires_student_review(postgres: PostgreSQLSandbox) -> None:
    ids = seed(postgres)
    predecessor = create_task(postgres, ids)
    successor = create_task(postgres, ids, board=1, depends_on=[predecessor.id])
    with postgres.sessions() as session:
        tasks.decide_task(
            session,
            ids[0],
            predecessor.id,
            TaskDecision(command_id=uuid4(), expected_version=1, action="confirm"),
        )
        tasks.decide_task(
            session,
            ids[0],
            successor.id,
            TaskDecision(command_id=uuid4(), expected_version=1, action="confirm"),
        )
        tasks.decide_task(
            session,
            ids[0],
            predecessor.id,
            TaskDecision(
                command_id=uuid4(),
                expected_version=2,
                action="rework",
                reason="合成复核发现待补证据",
            ),
        )
        changed = tasks.get_task(session, ids[0], successor.id)
        assert changed.status == "confirmed" and changed.needs_review
        assert "依赖任务待确认或已变化" in changed.review_reasons


def feedback_content(document_id: UUID, **changes: object) -> FeedbackContent:
    return FeedbackContent.model_validate(
        {
            "source_range": {"from": 0, "to": 7, "text": "请补充🙂证据"},
            "interpretation": "人工定位的合成反馈",
            "certainty": "certain",
            "source_checked": True,
            "evidence": [evidence(document_id)],
            **changes,
        }
    )


def test_feedback_original_immutable_and_student_processing_never_confirms_task(
    postgres: PostgreSQLSandbox,
) -> None:
    ids = seed(postgres)
    task = create_task(postgres, ids)
    with postgres.sessions() as session:
        original = feedback.create_feedback(
            session,
            ids[0],
            FeedbackCreate(command_id=uuid4(), original_text="请补充🙂证据。保留导师原话。"),
        )
        item = feedback.create_item(
            session,
            ids[0],
            original.id,
            FeedbackItemCreate(
                command_id=uuid4(), content=feedback_content(ids[1], task_id=task.id)
            ),
        )
        processed = feedback.decide_item(
            session,
            ids[0],
            item.id,
            FeedbackDecision(command_id=uuid4(), expected_version=1, action="processed"),
        )
        assert processed.status == "processed" and processed.origin == "manual"
        assert tasks.get_task(session, ids[0], task.id).status == "todo"
        reopened = feedback.decide_item(
            session,
            ids[0],
            item.id,
            FeedbackDecision(
                command_id=uuid4(), expected_version=2, action="reopen", reason="学生撤销已处理"
            ),
        )
        assert reopened.status == "open"
        history = feedback.list_versions(session, ids[0], item.id, limit=100, offset=0)
        assert [entry.action for entry in history.items] == ["reopen", "processed", "create"]
        assert (
            feedback.get_feedback(session, ids[0], original.id).original_text
            == original.original_text
        )
        assert "mentor_approved" not in processed.model_dump()
    engine = postgres.sessions.kw["bind"]
    for statement in (
        update(FeedbackBatch).where(FeedbackBatch.id == original.id).values(original_text="伪造"),
        delete(FeedbackBatch).where(FeedbackBatch.id == original.id),
        update(FeedbackItemVersion)
        .where(FeedbackItemVersion.item_id == item.id)
        .values(reason="伪造"),
        delete(TaskFeedbackCommand).where(TaskFeedbackCommand.project_id == ids[0]),
    ):
        with pytest.raises(DBAPIError), engine.begin() as connection:
            connection.execute(statement)


def test_feedback_requires_exact_unicode_range_and_fresh_checked_evidence(
    postgres: PostgreSQLSandbox,
) -> None:
    ids = seed(postgres)
    with postgres.sessions() as session:
        original = feedback.create_feedback(
            session, ids[0], FeedbackCreate(command_id=uuid4(), original_text="请补充🙂证据")
        )
    with postgres.sessions() as session, pytest.raises(AppError) as bad_range:
        feedback.create_item(
            session,
            ids[0],
            original.id,
            FeedbackItemCreate(
                command_id=uuid4(),
                content=feedback_content(
                    ids[1], source_range={"from": 0, "to": 4, "text": "请补充"}
                ),
            ),
        )
    assert bad_range.value.code == "FEEDBACK_RANGE_INVALID"
    with postgres.sessions() as session:
        item = feedback.create_item(
            session,
            ids[0],
            original.id,
            FeedbackItemCreate(
                command_id=uuid4(), content=feedback_content(ids[1], certainty="uncertain")
            ),
        )
    with postgres.sessions() as session, pytest.raises(AppError) as unchecked:
        feedback.decide_item(
            session,
            ids[0],
            item.id,
            FeedbackDecision(command_id=uuid4(), expected_version=1, action="processed"),
        )
    assert unchecked.value.code == "FEEDBACK_REVIEW_REQUIRED"
    with postgres.sessions() as session:
        corrected = feedback.update_item(
            session,
            ids[0],
            item.id,
            FeedbackItemUpdate(
                command_id=uuid4(),
                expected_version=1,
                content=feedback_content(
                    ids[1], certainty="uncertain", correction="已人工逐字核对"
                ),
            ),
        )
        documents.save_document(
            session, *ids, DocumentSave(expected_version=1, content=manuscript("合成证据新稿"))
        )
    with postgres.sessions() as session, pytest.raises(AppError) as stale:
        feedback.decide_item(
            session,
            ids[0],
            item.id,
            FeedbackDecision(
                command_id=uuid4(), expected_version=corrected.version, action="processed"
            ),
        )
    assert stale.value.code == "FEEDBACK_REVIEW_REQUIRED"
    with postgres.sessions() as session:
        current = feedback.get_item(session, ids[0], item.id)
        assert current.version == 2 and current.status == "open" and current.needs_review


def test_feedback_new_task_receipt_failure_rolls_back_board_item_and_versions(
    postgres: PostgreSQLSandbox,
) -> None:
    ids = seed(postgres)
    with postgres.sessions() as session:
        original = feedback.create_feedback(
            session, ids[0], FeedbackCreate(command_id=uuid4(), original_text="请补充🙂证据")
        )
    request = FeedbackItemCreate(
        command_id=uuid4(), content=feedback_content(ids[1], new_task=content(ids[1]))
    )

    def fail(mapper, connection, target):
        if target.operation.startswith("feedback.item.create:"):
            raise RuntimeError("synthetic task-feedback receipt failure")

    event.listen(TaskFeedbackCommand, "before_insert", fail)
    try:
        with postgres.sessions() as session, pytest.raises(RuntimeError, match="synthetic"):
            feedback.create_item(session, ids[0], original.id, request)
    finally:
        event.remove(TaskFeedbackCommand, "before_insert", fail)
    with postgres.sessions() as session:
        for model in (ProjectTask, TaskVersion, FeedbackItem, FeedbackItemVersion, TaskBoard):
            assert session.scalar(select(func.count()).select_from(model)) == 0
        assert session.scalar(select(func.count()).select_from(TaskFeedbackCommand)) == 1
    with postgres.sessions() as session:
        saved = feedback.create_item(session, ids[0], original.id, request)
        replay = feedback.create_item(session, ids[0], original.id, request)
        assert saved == replay and saved.content.task_id is not None
        assert tasks.list_tasks(session, ids[0], limit=100, offset=0).total == 1


def test_material_evidence_rejects_foreign_project_and_requires_review_after_reparse_or_original(
    postgres: PostgreSQLSandbox,
) -> None:
    ids = seed(postgres)
    uploaded = upload(postgres, ids[0])
    parsed = finish_parse(postgres, uploaded.job.id)

    def reference(parse):
        return {
            "kind": "material",
            "material_id": uploaded.material.id,
            "original_id": uploaded.original.id,
            "parse_version_id": parse.id,
            "anchor_ids": [parse.content["anchors"][0]["id"]],
        }

    task = create_task(postgres, ids, evidence=[reference(parsed)])
    other = seed(postgres)
    with postgres.sessions() as session, pytest.raises(AppError) as foreign:
        tasks.create_task(
            session,
            other[0],
            TaskCreate(
                command_id=uuid4(),
                expected_board_version=0,
                content=content(other[1], evidence=[reference(parsed)]),
            ),
        )
    assert foreign.value.code == "TASK_EVIDENCE_INVALID"
    with postgres.sessions() as session:
        job = materials.reparse_material(
            session,
            ids[0],
            uploaded.material.id,
            uploaded.original.id,
            MaterialReparse(expected_parse_id=parsed.id),
            str(uuid4()),
        )
    reparsed = finish_parse(postgres, job.id)
    assert reparsed.id != parsed.id
    with postgres.sessions() as session:
        stale = tasks.get_task(session, ids[0], task.id)
        assert stale.needs_review and stale.evidence_snapshots[0].stale
    with postgres.sessions() as session, pytest.raises(AppError) as stale_confirm:
        tasks.decide_task(
            session,
            ids[0],
            task.id,
            TaskDecision(command_id=uuid4(), expected_version=1, action="confirm"),
        )
    assert stale_confirm.value.code == "TASK_EVIDENCE_STALE"
    with postgres.sessions() as session:
        refreshed = tasks.update_task(
            session,
            ids[0],
            task.id,
            TaskUpdate(
                command_id=uuid4(),
                expected_version=1,
                content=content(ids[1], evidence=[reference(reparsed)]),
            ),
        )
        assert not refreshed.needs_review
        tasks.decide_task(
            session,
            ids[0],
            task.id,
            TaskDecision(command_id=uuid4(), expected_version=2, action="confirm"),
        )
        materials.append_original(
            session,
            ids[0],
            uploaded.material.id,
            MaterialOriginalCreate.model_validate(
                {
                    **payload("合成资料新原件\n").model_dump(),
                    "expected_version": uploaded.material.version,
                }
            ),
            str(uuid4()),
        )
        changed = tasks.get_task(session, ids[0], task.id)
        assert changed.status == "confirmed" and changed.needs_review
        assert changed.evidence_snapshots[0].reference.parse_version_id == reparsed.id
        assert changed.evidence_snapshots[0].stale


def test_feedback_edit_new_task_failure_does_not_leave_an_orphan_task(
    postgres: PostgreSQLSandbox,
) -> None:
    ids = seed(postgres)
    with postgres.sessions() as session:
        original = feedback.create_feedback(
            session, ids[0], FeedbackCreate(command_id=uuid4(), original_text="请补充🙂证据")
        )
        item = feedback.create_item(
            session,
            ids[0],
            original.id,
            FeedbackItemCreate(command_id=uuid4(), content=feedback_content(ids[1])),
        )
    request = FeedbackItemUpdate(
        command_id=uuid4(),
        expected_version=1,
        content=feedback_content(ids[1], new_task=content(ids[1])),
    )

    def fail(mapper, connection, target):
        if target.operation.startswith("feedback.item.update:"):
            raise RuntimeError("synthetic feedback edit receipt failure")

    event.listen(TaskFeedbackCommand, "before_insert", fail)
    try:
        with postgres.sessions() as session, pytest.raises(RuntimeError, match="synthetic"):
            feedback.update_item(session, ids[0], item.id, request)
    finally:
        event.remove(TaskFeedbackCommand, "before_insert", fail)
    with postgres.sessions() as session:
        for model in (ProjectTask, TaskVersion, TaskBoard):
            assert session.scalar(select(func.count()).select_from(model)) == 0
        assert session.scalar(select(func.count()).select_from(FeedbackItemVersion)) == 1
    with postgres.sessions() as session:
        unchanged = feedback.get_item(session, ids[0], item.id)
        assert unchanged == item and unchanged.content.task_id is None
        saved = feedback.update_item(session, ids[0], item.id, request)
        assert feedback.update_item(session, ids[0], item.id, request) == saved
        assert saved.version == 2 and saved.content.task_id is not None
        assert tasks.list_tasks(session, ids[0], limit=100, offset=0).total == 1
