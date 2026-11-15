"""SG-18A lifecycle invariants against isolated, migrated PostgreSQL schemas."""

import socket
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from alembic import command
from sqlalchemy import event, func, select, text
from sqlalchemy.exc import DBAPIError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentImport
from thesis_pilot.modules.project_flows import service as flows
from thesis_pilot.modules.project_flows.models import ProjectFlowVersion
from thesis_pilot.modules.project_flows.schemas import FlowCreate, FlowUpdate
from thesis_pilot.modules.projects import service as projects
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.projects.schemas import ProjectCreate, ProjectUpdate

from .conftest import PostgreSQLSandbox
from .test_workspace import KEY, real_workspace_http

pytestmark = pytest.mark.integration


def stages() -> list[dict]:
    return [
        {
            "id": "proposal",
            "name": "开题",
            "deliverables": ["自制开题报告"],
            "conditions": ["学生核对需求"],
            "dependencies": [],
        },
        {
            "id": "writing",
            "name": "写作",
            "deliverables": ["自制论文草稿"],
            "conditions": ["学生逐项核对"],
            "dependencies": ["proposal"],
        },
    ]


def make_flow(postgres: PostgreSQLSandbox):
    with postgres.sessions() as session:
        return flows.create_flow(session, FlowCreate(name="自制毕业流程", stages=stages()))


def manuscript() -> dict:
    return {
        "schema_version": 1,
        "json": {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "text": "合成论文：样本 42，不得被项目设置改写。"}
                    ],
                }
            ],
        },
    }


@pytest.mark.parametrize("planning_mode", ["none", "personal"])
def test_project_metadata_archive_restore_preserves_manuscript(
    postgres: PostgreSQLSandbox, planning_mode: str
) -> None:
    flow = make_flow(postgres)
    with postgres.sessions() as session:
        project = projects.create_project(
            session,
            ProjectCreate(
                name="自制生命周期项目",
                title="合成论文题目",
                deadline=date(2027, 6, 1),
                planning_mode=planning_mode,
                plan_note="仅测试规划说明" if planning_mode == "personal" else "",
                existing_artifacts="已有合成开题稿",
                flow_version_id=flow.current_version_id,
                stage_id="proposal",
            ),
        )
    assert project.planning_mode == planning_mode
    assert project.title == "合成论文题目"
    assert project.deadline == date(2027, 6, 1)
    with postgres.sessions() as session:
        document = documents.import_document(
            session, project.id, DocumentImport(content=manuscript())
        )
    with postgres.sessions() as session:
        archived = projects.update_project(
            session, project.id, ProjectUpdate(expected_version=1, archived=True)
        )
    assert archived.archived and archived.version == 2
    with postgres.sessions() as session:
        restored = projects.update_project(
            session, project.id, ProjectUpdate(expected_version=2, archived=False)
        )
    assert not restored.archived and restored.version == 3
    assert restored.flow_version_id == flow.current_version_id
    assert restored.stage_id == "proposal"
    assert restored.title == project.title and restored.deadline == project.deadline
    assert restored.existing_artifacts == project.existing_artifacts
    with postgres.sessions() as session:
        saved = documents.get_version(session, project.id, document.id, 1)
    assert saved.content.model_dump(by_alias=True) == manuscript()
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(DocumentVersion)) == 1


def test_concurrent_project_metadata_cas_keeps_complete_winner_and_body(
    postgres: PostgreSQLSandbox,
) -> None:
    with postgres.sessions() as session:
        project = projects.create_project(session, ProjectCreate(name="自制CAS项目"))
    with postgres.sessions() as session:
        document = documents.import_document(
            session, project.id, DocumentImport(content=manuscript())
        )
    barrier = Barrier(2, timeout=10)

    def write(label: str) -> tuple[str, str]:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                changed = projects.update_project(
                    session,
                    project.id,
                    ProjectUpdate(expected_version=1, name=label, title=f"题目{label}"),
                )
                assert changed.version == 2
                return "saved", label
            except AppError as error:
                assert error.code == "PROJECT_VERSION_CONFLICT"
                return "conflict", label

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, ["并发甲", "并发乙"]))
    assert sorted(result[0] for result in results) == ["conflict", "saved"]
    winner = next(label for outcome, label in results if outcome == "saved")
    with postgres.sessions() as session:
        persisted = projects.get_project(session, project.id)
    assert (persisted.name, persisted.title, persisted.version) == (winner, f"题目{winner}", 2)
    with postgres.sessions() as session:
        assert (
            documents.get_version(session, project.id, document.id, 1).content.model_dump(
                by_alias=True
            )
            == manuscript()
        )


def test_flow_versions_do_not_rewrite_bindings_and_disable_blocks_new_binding(
    postgres: PostgreSQLSandbox,
) -> None:
    initial = make_flow(postgres)
    with postgres.sessions() as session:
        project = projects.create_project(
            session,
            ProjectCreate(
                name="绑定旧版本的自制项目",
                flow_version_id=initial.current_version_id,
                stage_id="proposal",
            ),
        )
    changed_stages = stages()
    changed_stages[0]["name"] = "新版开题"
    with postgres.sessions() as session:
        updated = flows.update_flow(
            session,
            initial.id,
            FlowUpdate(expected_version=1, name="新流程名称", stages=changed_stages),
        )
    assert updated.version == 2 and updated.current_version_id != initial.current_version_id
    with postgres.sessions() as session:
        historical = flows.get_version(session, initial.id, 1)
    assert historical.name == initial.name and historical.stages[0].name == "开题"
    with postgres.sessions() as session:
        bound = projects.get_project(session, project.id)
    assert bound.flow_version_id == initial.current_version_id and bound.version == 1
    with postgres.sessions() as session:
        disabled = flows.update_flow(
            session, initial.id, FlowUpdate(expected_version=2, enabled=False)
        )
    assert disabled.version == 3 and not disabled.enabled
    with pytest.raises(AppError) as caught, postgres.sessions() as session:
        projects.create_project(
            session,
            ProjectCreate(
                name="不得落库的自制项目",
                flow_version_id=disabled.current_version_id,
                stage_id="proposal",
            ),
        )
    assert caught.value.code == "PROJECT_FLOW_DISABLED"
    # An unchanged old binding remains usable when editing unrelated metadata.
    with postgres.sessions() as session:
        renamed = projects.update_project(
            session, project.id, ProjectUpdate(expected_version=1, name="旧绑定仍可编辑")
        )
    assert renamed.flow_version_id == initial.current_version_id
    with pytest.raises(AppError) as caught, postgres.sessions() as session:
        projects.update_project(
            session, project.id, ProjectUpdate(expected_version=2, stage_id="writing")
        )
    assert caught.value.code == "PROJECT_FLOW_DISABLED"
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Project)) == 1
    with postgres.sessions() as session:
        persisted = projects.get_project(session, project.id)
    assert persisted.stage_id == "proposal" and persisted.version == 2


def test_concurrent_flow_cas_appends_only_one_snapshot(postgres: PostgreSQLSandbox) -> None:
    flow = make_flow(postgres)
    barrier = Barrier(2, timeout=10)

    def change(name: str) -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                assert (
                    flows.update_flow(
                        session, flow.id, FlowUpdate(expected_version=1, name=name)
                    ).version
                    == 2
                )
                return "saved"
            except AppError as error:
                assert error.code == "PROJECT_FLOW_VERSION_CONFLICT"
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(change, ["流程甲", "流程乙"])) == ["conflict", "saved"]
    with postgres.sessions() as session:
        versions = flows.list_versions(session, flow.id, limit=100, offset=0)
    assert versions.total == 2 and [item.version for item in versions.items] == [2, 1]
    assert versions.items[1].name == flow.name


def test_snapshot_write_failure_rolls_back_root_and_version(postgres: PostgreSQLSandbox) -> None:
    flow = make_flow(postgres)

    def reject_snapshot(*_args: object) -> None:
        raise RuntimeError("synthetic snapshot write failure")

    event.listen(ProjectFlowVersion, "before_insert", reject_snapshot)
    try:
        with (
            pytest.raises(RuntimeError, match="synthetic snapshot"),
            postgres.sessions() as session,
        ):
            flows.update_flow(session, flow.id, FlowUpdate(expected_version=1, name="不可部分保存"))
    finally:
        event.remove(ProjectFlowVersion, "before_insert", reject_snapshot)
    with postgres.sessions() as session:
        actual = flows.get_flow(session, flow.id)
    assert actual.model_dump() == flow.model_dump()
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ProjectFlowVersion)) == 1


def test_real_http_invalid_graphs_and_binding_never_partially_save(
    postgres: PostgreSQLSandbox, tmp_path: Path
) -> None:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    with real_workspace_http(postgres, tmp_path / "lifecycle-http.log", port) as client:
        assert client.post("/api/v1/workspace/session", json={"access_key": KEY}).status_code == 200
        response = client.post(
            "/api/v1/project-flows", json={"name": "HTTP合成流程", "stages": stages()}
        )
        assert response.status_code == 201
        original = response.json()
        flow_path = f"/api/v1/project-flows/{original['id']}"
        duplicate = stages()
        duplicate[1]["id"] = "proposal"
        unknown = stages()
        unknown[1]["dependencies"] = ["unknown"]
        cycle = stages()
        cycle[0]["dependencies"] = ["writing"]
        for invalid in (duplicate, unknown, cycle):
            rejected = client.patch(
                flow_path,
                json={"expected_version": 1, "name": "不可部分改名", "stages": invalid},
            )
            assert rejected.status_code == 422
            assert client.get(flow_path).json() == original
            assert client.get(f"{flow_path}/versions").json()["total"] == 1
        project = client.post("/api/v1/projects", json={"name": "HTTP合成项目"}).json()
        update = {
            "expected_version": 1,
            "title": "不可部分保存的题目",
            "flow_version_id": original["current_version_id"],
            "stage_id": "unknown",
        }
        rejected = client.patch(f"/api/v1/projects/{project['id']}", json=update)
        assert rejected.status_code == 422
        assert client.get(f"/api/v1/projects/{project['id']}").json() == project
        missing_version = deepcopy(update)
        missing_version["flow_version_id"] = str(uuid4())
        assert (
            client.patch(f"/api/v1/projects/{project['id']}", json=missing_version).status_code
            == 404
        )
        assert client.get(f"/api/v1/projects/{project['id']}").json() == project


def test_downgrade_refuses_saved_metadata_and_preserves_project_and_document(
    postgres: PostgreSQLSandbox,
) -> None:
    with postgres.sessions() as session:
        project = projects.create_project(
            session,
            ProjectCreate(
                name="拒绝丢失元数据的合成项目",
                title="已经保存的合成论文题目",
                deadline=date(2027, 6, 1),
                planning_mode="personal",
                plan_note="本人填写的合成规划",
                existing_artifacts="本人核对的合成开题报告",
                archived=True,
            ),
        )
        document = documents.import_document(
            session, project.id, DocumentImport(content=manuscript())
        )
    engine = postgres.sessions.kw["bind"]
    try:
        with (
            pytest.raises(DBAPIError, match="cannot preserve project lifecycle or flow history"),
            engine.begin() as connection,
        ):
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261117_0006")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    with postgres.sessions() as session:
        assert projects.get_project(session, project.id) == project
        assert documents.get_current_document(session, project.id) == document
        assert (
            documents.list_versions(session, project.id, document.id, limit=20, offset=0).total == 1
        )
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == "20261117_0007"


def test_downgrade_refuses_saved_flow_and_preserves_all_versions(
    postgres: PostgreSQLSandbox,
) -> None:
    original = make_flow(postgres)
    with postgres.sessions() as session:
        updated = flows.update_flow(
            session, original.id, FlowUpdate(expected_version=1, name="保存了历史的合成流程")
        )
        snapshots = flows.list_versions(session, original.id, limit=20, offset=0)
    engine = postgres.sessions.kw["bind"]
    try:
        with (
            pytest.raises(DBAPIError, match="cannot preserve project lifecycle or flow history"),
            engine.begin() as connection,
        ):
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261117_0006")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    with postgres.sessions() as session:
        assert flows.get_flow(session, original.id) == updated
        assert flows.list_versions(session, original.id, limit=20, offset=0) == snapshots
        assert snapshots.total == 2
        assert snapshots.items[1].id == original.current_version_id
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == "20261117_0007"
