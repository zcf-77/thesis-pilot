"""Stage completion only comes from student confirmation records; tasks are facts."""

from datetime import date
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.schemas import DocumentImport, DocumentSave
from thesis_pilot.modules.project_flows import service as flows
from thesis_pilot.modules.project_flows.schemas import FlowCreate, FlowUpdate
from thesis_pilot.modules.projects import service as projects
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.projects.schemas import ProjectCreate, ProjectUpdate
from thesis_pilot.modules.stage_confirmations import service
from thesis_pilot.modules.stage_confirmations.models import StageConfirmation
from thesis_pilot.modules.stage_confirmations.schemas import StageConfirm, StageRevoke
from thesis_pilot.modules.tasks import service as tasks
from thesis_pilot.modules.tasks.schemas import TaskContent, TaskCreate, TaskDecision, TaskUpdate


def stages() -> list[dict[str, object]]:
    return [
        {
            "id": "proposal",
            "name": "开题",
            "deliverables": ["开题报告", "文献清单", "答辩记录"],
            "conditions": ["学生核对研究范围"],
            "dependencies": [],
            "start": "2030-01-01",
            "deadline": "2030-02-01",
        },
        {
            "id": "writing",
            "name": "写作",
            "deliverables": ["论文初稿"],
            "conditions": ["学生核对初稿"],
            "dependencies": ["proposal"],
        },
        {
            "id": "defense",
            "name": "答辩",
            "deliverables": ["答辩材料"],
            "conditions": ["学生核对材料"],
            "dependencies": ["writing"],
        },
    ]


def manuscript(text: str = "合成开题报告正文") -> dict:
    return {
        "schema_version": 1,
        "json": {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
        },
    }


class World:
    def __init__(self, sessions: sessionmaker[Session], stage: str = "proposal") -> None:
        self.sessions = sessions
        with sessions() as session:
            self.flow = flows.create_flow(session, FlowCreate(name="合成流程", stages=stages()))
        with sessions() as session:
            self.project = projects.create_project(
                session,
                ProjectCreate(
                    name="合成项目",
                    deadline=date(2030, 12, 31),
                    flow_version_id=self.flow.current_version_id,
                    stage_id=stage,
                ),
            )
        with sessions() as session:
            self.document = documents.import_document(
                session, self.project.id, DocumentImport(content=manuscript())
            )

    def task(self, title: str = "完成开题报告", confirm: bool = True) -> tuple[UUID, int]:
        evidence = {
            "kind": "document",
            "document_id": str(self.document.id),
            "version": self.document_version(),
            "selection": {"textblock_path": [0], "from": 1, "to": 3, "text": "合成"},
        }
        with self.sessions() as session:
            board = tasks.list_tasks(session, self.project.id, limit=1, offset=0).board_version
        with self.sessions() as session:
            created = tasks.create_task(
                session,
                self.project.id,
                TaskCreate(
                    command_id=uuid4(),
                    expected_board_version=board,
                    content=TaskContent.model_validate(
                        {"title": title, "acceptance": "可复核", "evidence": [evidence]}
                    ),
                ),
            )
        if not confirm:
            return created.id, created.version
        with self.sessions() as session:
            done = tasks.decide_task(
                session,
                self.project.id,
                created.id,
                TaskDecision(command_id=uuid4(), expected_version=1, action="confirm"),
            )
        return done.id, done.version

    def document_version(self) -> int:
        with self.sessions() as session:
            return documents.get_current_document(session, self.project.id).version

    def version(self) -> int:
        with self.sessions() as session:
            return projects.get_project(session, self.project.id).version

    def confirm(self, **values: object):  # type: ignore[no-untyped-def]
        with self.sessions() as session:
            current = projects.get_project(session, self.project.id)
        payload: dict[str, object] = {
            "command_id": uuid4(),
            "expected_project_version": current.version,
            "flow_version_id": current.flow_version_id,
            "stage_id": current.stage_id,
            "document_version": self.document_version(),
            "note": "已核对开题报告 v1",
            **values,
        }
        with self.sessions() as session:
            return service.confirm_stage(
                session, self.project.id, StageConfirm.model_validate(payload)
            )

    def progress(self):  # type: ignore[no-untyped-def]
        with self.sessions() as session:
            return service.get_progress(session, self.project.id)

    def revoke(self, confirmation_id: UUID, **values: object):  # type: ignore[no-untyped-def]
        payload: dict[str, object] = {
            "command_id": uuid4(),
            "expected_project_version": self.version(),
            **values,
        }
        with self.sessions() as session:
            return service.revoke_stage(
                session, self.project.id, confirmation_id, StageRevoke.model_validate(payload)
            )

    def records(self) -> int:
        with self.sessions() as session:
            return session.scalar(select(func.count()).select_from(StageConfirmation)) or 0


def code_of(call) -> str:  # type: ignore[no-untyped-def]
    with pytest.raises(AppError) as caught:
        call()
    return caught.value.code


def test_progress_reports_facts_without_confirming(session_factory: sessionmaker[Session]) -> None:
    world = World(session_factory)
    task_id, _ = world.task("完成开题报告")
    world.task("未确认的答辩记录", confirm=False)
    progress = world.progress()
    assert progress.binding == "ready"
    assert progress.current is not None
    # A confirmed task matching a deliverable is only a fact; the stage stays unconfirmed.
    assert progress.current.confirmed is False
    assert [(item.name, item.status) for item in progress.current.deliverables] == [
        ("开题报告", "confirmed_task"),
        ("文献清单", "none"),
        ("答辩记录", "none"),
    ]
    assert progress.current.deliverables[0].task_ids == [task_id]
    assert [item.id for item in progress.current.next_stages] == ["writing"]
    assert progress.current.prerequisites_met is True
    assert [item.task_id for item in progress.evidence_candidates] == [task_id]
    assert [item.state for item in progress.stages] == ["current", "upcoming", "upcoming"]
    assert progress.document is not None and progress.document.version == 1
    assert progress.revocable_id is None
    assert world.records() == 0


def test_confirm_advances_project_atomically_and_replays(
    session_factory: sessionmaker[Session],
) -> None:
    world = World(session_factory)
    task_id, task_version = world.task()
    before = world.version()
    command = uuid4()
    body = {
        "command_id": command,
        "next_stage_id": "writing",
        "evidence": [{"task_id": task_id, "version": task_version}],
    }
    result = world.confirm(**body)
    assert result.project.stage_id == "writing"
    assert result.project.version == before + 1
    record = result.confirmation
    assert (record.kind, record.stage_id, record.resulting_stage_id) == (
        "confirm",
        "proposal",
        "writing",
    )
    assert record.document_version == 1
    assert record.evidence[0].title == "完成开题报告"
    assert record.flow_version_id == world.flow.current_version_id
    # A repeated click with the same command returns the original result unchanged.
    payload = {
        "command_id": command,
        "expected_project_version": before,
        "flow_version_id": world.flow.current_version_id,
        "stage_id": "proposal",
        "document_version": 1,
        "note": "已核对开题报告 v1",
        "next_stage_id": "writing",
        "evidence": [{"task_id": task_id, "version": task_version}],
    }
    with session_factory() as session:
        replay = service.confirm_stage(
            session, world.project.id, StageConfirm.model_validate(payload)
        )
    assert replay == result
    assert world.records() == 1
    payload["note"] = "不同内容"
    with session_factory() as session:
        assert (
            code_of(
                lambda: service.confirm_stage(
                    session, world.project.id, StageConfirm.model_validate(payload)
                )
            )
            == "STAGE_COMMAND_CONFLICT"
        )
    progress = world.progress()
    assert [item.state for item in progress.stages] == ["confirmed", "current", "upcoming"]
    assert progress.current is not None and progress.current.entered_at is not None
    assert progress.revocable_id == record.id


def test_stale_version_and_validation_failures_keep_project(
    session_factory: sessionmaker[Session],
) -> None:
    world = World(session_factory)
    other = World(session_factory)
    foreign_task, foreign_version = other.task()
    open_task, open_version = world.task("进行中的任务", confirm=False)
    task_id, task_version = world.task()
    before = world.version()
    cases = [
        ({"expected_project_version": before + 5}, "STAGE_VERSION_CONFLICT"),
        ({"stage_id": "writing"}, "STAGE_NOT_CURRENT"),
        ({"flow_version_id": other.flow.current_version_id}, "STAGE_NOT_CURRENT"),
        ({}, "STAGE_NEXT_INVALID"),
        ({"next_stage_id": "defense"}, "STAGE_NEXT_INVALID"),
        ({"next_stage_id": "writing", "document_version": 9}, "STAGE_DOCUMENT_STALE"),
        ({"next_stage_id": "writing", "document_version": None}, "STAGE_DOCUMENT_STALE"),
        (
            {
                "next_stage_id": "writing",
                "evidence": [{"task_id": foreign_task, "version": foreign_version}],
            },
            "STAGE_EVIDENCE_INVALID",
        ),
        (
            {
                "next_stage_id": "writing",
                "evidence": [{"task_id": open_task, "version": open_version}],
            },
            "STAGE_EVIDENCE_INVALID",
        ),
        (
            {
                "next_stage_id": "writing",
                "evidence": [{"task_id": task_id, "version": task_version + 1}],
            },
            "STAGE_EVIDENCE_STALE",
        ),
    ]
    for values, code in cases:
        assert code_of(lambda values=values: world.confirm(**values)) == code, values
    assert world.version() == before
    assert world.records() == 0
    # Evidence whose manuscript version changed needs review and cannot back a stage.
    with session_factory() as session:
        documents.save_document(
            session,
            world.project.id,
            world.document.id,
            DocumentSave(expected_version=1, content=manuscript("合成开题报告第二版")),
        )
    assert (
        code_of(
            lambda: world.confirm(
                next_stage_id="writing", evidence=[{"task_id": task_id, "version": task_version}]
            )
        )
        == "STAGE_EVIDENCE_STALE"
    )
    assert world.progress().evidence_candidates == []


def test_prerequisite_and_archived_projects_are_refused(
    session_factory: sessionmaker[Session],
) -> None:
    world = World(session_factory, stage="writing")
    progress = world.progress()
    assert progress.current is not None
    assert progress.current.prerequisites_met is False
    assert progress.current.prerequisites[0].name == "开题"
    assert code_of(lambda: world.confirm(next_stage_id="defense")) == (
        "STAGE_PREREQUISITE_UNCONFIRMED"
    )
    with session_factory() as session:
        projects.update_project(
            session,
            world.project.id,
            ProjectUpdate(expected_version=world.version(), archived=True),
        )
    assert code_of(lambda: world.confirm(next_stage_id="defense")) == "STAGE_PROJECT_ARCHIVED"


def test_unbound_project_has_no_stage(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as session:
        owner = projects.create_project(session, ProjectCreate(name="未绑定"))
    with session_factory() as session:
        progress = service.get_progress(session, owner.id)
    assert (progress.binding, progress.current, progress.stages) == ("unbound", None, [])
    payload = StageConfirm.model_validate(
        {
            "command_id": uuid4(),
            "expected_project_version": 1,
            "flow_version_id": uuid4(),
            "stage_id": "proposal",
            "note": "说明",
        }
    )
    with session_factory() as session:
        assert (
            code_of(lambda: service.confirm_stage(session, owner.id, payload))
            == "STAGE_FLOW_REQUIRED"
        )


def test_revoke_latest_appends_record_and_restores_stage(
    session_factory: sessionmaker[Session],
) -> None:
    world = World(session_factory)
    first = world.confirm(next_stage_id="writing").confirmation
    second = world.confirm(next_stage_id="defense").confirmation
    assert world.progress().stage_id == "defense"
    assert code_of(lambda: world.revoke(first.id)) == "STAGE_REVOKE_CONFLICT"
    assert code_of(lambda: world.revoke(uuid4())) == "STAGE_CONFIRMATION_NOT_FOUND"
    assert code_of(lambda: world.revoke(second.id, expected_project_version=1)) == (
        "STAGE_VERSION_CONFLICT"
    )
    undone = world.revoke(second.id, note="答辩材料尚需修改")
    assert undone.project.stage_id == "writing"
    assert (undone.confirmation.kind, undone.confirmation.revokes_id) == ("revoke", second.id)
    assert code_of(lambda: world.revoke(second.id)) == "STAGE_REVOKE_CONFLICT"
    back = world.revoke(first.id)
    assert back.project.stage_id == "proposal"
    with session_factory() as session:
        history = service.list_confirmations(session, world.project.id, limit=10, offset=0)
    assert history.total == 4
    assert [(item.kind, item.stage_name) for item in history.items] == [
        ("revoke", "开题"),
        ("revoke", "写作"),
        ("confirm", "写作"),
        ("confirm", "开题"),
    ]
    assert history.items[2].revoked_by_id == undone.confirmation.id
    assert history.items[3].revoked_by_id == back.confirmation.id
    # Revoked confirmations no longer count; the stage can be confirmed again.
    again = world.confirm(next_stage_id="writing")
    assert again.confirmation.sequence == 5
    with session_factory() as session:
        page = service.list_confirmations(session, world.project.id, limit=2, offset=1)
    assert [item.sequence for item in page.items] == [4, 3]


def test_flow_edit_and_disable_do_not_rewrite_bound_version(
    session_factory: sessionmaker[Session],
) -> None:
    world = World(session_factory)
    changed = stages()
    changed[0]["name"] = "立项"
    changed[0]["deliverables"] = ["新产物"]
    with session_factory() as session:
        flows.update_flow(
            session,
            world.flow.id,
            FlowUpdate(expected_version=1, stages=changed, name="新流程"),
        )
    with session_factory() as session:
        flows.update_flow(session, world.flow.id, FlowUpdate(expected_version=2, enabled=False))
    progress = world.progress()
    assert progress.flow_version == 1
    assert progress.current is not None and progress.current.stage.name == "开题"
    result = world.confirm(next_stage_id="writing")
    assert result.confirmation.stage_name == "开题"
    with session_factory() as session:
        owner = session.get(Project, world.project.id)
        assert owner is not None and owner.flow_version_id == world.flow.current_version_id


def test_last_stage_confirmation_keeps_position(session_factory: sessionmaker[Session]) -> None:
    world = World(session_factory)
    world.confirm(next_stage_id="writing")
    world.confirm(next_stage_id="defense")
    final = world.confirm()
    assert (final.confirmation.next_stage_id, final.project.stage_id) == (None, "defense")
    progress = world.progress()
    assert progress.current is not None and progress.current.confirmed is True
    assert progress.current.next_stages == []
    assert code_of(lambda: world.confirm()) == "STAGE_ALREADY_CONFIRMED"
    assert world.revoke(final.confirmation.id).project.stage_id == "defense"


def test_task_change_after_confirmation_keeps_record(
    session_factory: sessionmaker[Session],
) -> None:
    world = World(session_factory)
    task_id, version = world.task()
    result = world.confirm(
        next_stage_id="writing", evidence=[{"task_id": task_id, "version": version}]
    )
    with session_factory() as session:
        tasks.update_task(
            session,
            world.project.id,
            task_id,
            TaskUpdate(
                command_id=uuid4(),
                expected_version=version,
                content=TaskContent.model_validate({"title": "改名", "acceptance": "可复核"}),
            ),
        )
    with session_factory() as session:
        history = service.list_confirmations(session, world.project.id, limit=1, offset=0)
    assert history.items[0].evidence == result.confirmation.evidence
    assert history.items[0].evidence[0].title == "完成开题报告"


@pytest.mark.parametrize(
    "values",
    [
        {"note": " "},
        {"note": "x" * 2001},
        {"next_stage_id": "proposal"},
        {"evidence": [{"task_id": "00000000-0000-4000-8000-000000000001", "version": 1}] * 2},
        {"stage_id": "bad id"},
        {"note": "\ud800"},
        {"unexpected": True},
    ],
)
def test_confirm_input_is_strict(values: dict) -> None:
    payload = {
        "command_id": str(uuid4()),
        "expected_project_version": 1,
        "flow_version_id": str(uuid4()),
        "stage_id": "proposal",
        "note": "说明",
        **values,
    }
    with pytest.raises(ValidationError):
        StageConfirm.model_validate(payload)


def test_http_routes_are_scoped_to_project(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    world = World(session_factory)
    other = World(session_factory)
    base = f"/api/v1/projects/{world.project.id}"
    progress = client.get(f"{base}/stage-progress")
    assert progress.status_code == 200
    body = {
        "command_id": str(uuid4()),
        "expected_project_version": progress.json()["project_version"],
        "flow_version_id": progress.json()["flow_version_id"],
        "stage_id": "proposal",
        "document_version": 1,
        "note": "已核对",
        "next_stage_id": "writing",
    }
    created = client.post(f"{base}/stage-confirmations", json=body)
    assert created.status_code == 201
    confirmation_id = created.json()["confirmation"]["id"]
    again = client.post(f"{base}/stage-confirmations", json=body)
    assert again.status_code == 201 and again.json() == created.json()
    history = client.get(f"{base}/stage-confirmations?limit=5")
    assert history.json()["total"] == 1
    foreign = client.post(
        f"/api/v1/projects/{other.project.id}/stage-confirmations/{confirmation_id}/revocations",
        json={"command_id": str(uuid4()), "expected_project_version": 2},
    )
    assert foreign.status_code == 404
    assert foreign.json()["error"]["code"] == "STAGE_CONFIRMATION_NOT_FOUND"
    # The same command id cannot be reused by a different project.
    reused = client.post(
        f"/api/v1/projects/{other.project.id}/stage-confirmations",
        json={**body, "flow_version_id": str(other.flow.current_version_id)},
    )
    assert reused.json()["error"]["code"] == "STAGE_COMMAND_CONFLICT"
    revoked = client.post(
        f"{base}/stage-confirmations/{confirmation_id}/revocations",
        json={"command_id": str(uuid4()), "expected_project_version": 2},
    )
    assert revoked.status_code == 201
    assert revoked.json()["project"]["stage_id"] == "proposal"
    missing = client.get(f"/api/v1/projects/{uuid4()}/stage-progress")
    assert missing.status_code == 404
    invalid = client.post(f"{base}/stage-confirmations", json={**body, "note": ""})
    assert invalid.status_code == 422
