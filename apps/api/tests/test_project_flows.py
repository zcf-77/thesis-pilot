"""SG-18A flow graph validation and immutable version transactions."""

from copy import deepcopy
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.project_flows import service
from thesis_pilot.modules.project_flows.models import ProjectFlow, ProjectFlowVersion
from thesis_pilot.modules.project_flows.router import router
from thesis_pilot.modules.project_flows.schemas import FlowCreate, FlowUpdate


def stages() -> list[dict[str, object]]:
    return [
        {
            "id": "proposal",
            "name": "开题",
            "description": "明确研究范围。",
            "deliverables": ["开题报告"],
            "conditions": ["本人确认范围与来源"],
            "dependencies": [],
            "deadline": "2026-11-01",
        },
        {
            "id": "writing",
            "name": "论文撰写",
            "deliverables": ["论文初稿"],
            "conditions": ["本人核对初稿"],
            "dependencies": ["proposal"],
            "deadline": "2026-11-18",
        },
    ]


@pytest.fixture
def flow_client(app: FastAPI, client: TestClient) -> TestClient:
    # Allows focused module tests before the coordinator registers the router.
    if not any(getattr(route, "path", "") == "/api/v1/project-flows" for route in app.routes):
        app.include_router(router, prefix="/api/v1")
    return client


def test_flow_versions_are_immutable_and_survive_reopen(flow_client: TestClient) -> None:
    created = flow_client.post(
        "/api/v1/project-flows", json={"name": "自制流程", "stages": stages()}
    )
    assert created.status_code == 201
    original = created.json()
    url = f"/api/v1/project-flows/{original['id']}"
    first = flow_client.get(f"{url}/versions/1").json()
    changed_stages = stages()
    changed_stages[0]["name"] = "立项"
    changed = flow_client.patch(
        url, json={"expected_version": 1, "name": "新名称", "stages": changed_stages}
    )
    assert changed.status_code == 200
    assert changed.json()["version"] == 2
    assert changed.json()["current_version_id"] != original["current_version_id"]
    assert flow_client.get(f"{url}/versions/1").json() == first
    assert flow_client.get(url).json() == changed.json()
    history = flow_client.get(f"{url}/versions?limit=1&offset=1").json()
    assert history["total"] == 2
    assert history["items"] == [first]
    page = flow_client.get("/api/v1/project-flows").json()
    assert page["items"] == [changed.json()]


def test_flow_stale_write_and_disable_keep_history(flow_client: TestClient) -> None:
    original = flow_client.post(
        "/api/v1/project-flows", json={"name": "流程", "stages": stages()}
    ).json()
    url = f"/api/v1/project-flows/{original['id']}"
    disabled = flow_client.patch(url, json={"expected_version": 1, "enabled": False})
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False
    stale = flow_client.patch(url, json={"expected_version": 1, "name": "不得覆盖"})
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "PROJECT_FLOW_VERSION_CONFLICT"
    assert flow_client.get(f"{url}/versions/1").status_code == 200
    assert flow_client.get(url).json() == disabled.json()
    assert flow_client.get(f"{url}/versions").json()["total"] == 2


@pytest.mark.parametrize(
    "problem",
    ["duplicate_id", "duplicate_name", "unknown", "self", "cycle", "disabled", "date", "empty"],
)
def test_invalid_flow_graph_never_writes(
    flow_client: TestClient, session_factory: sessionmaker[Session], problem: str
) -> None:
    definitions = stages()
    if problem == "duplicate_id":
        definitions[1]["id"] = "proposal"
    elif problem == "duplicate_name":
        definitions[1]["name"] = "开题"
    elif problem == "unknown":
        definitions[1]["dependencies"] = ["unknown"]
    elif problem == "self":
        definitions[1]["dependencies"] = ["writing"]
    elif problem == "cycle":
        definitions[0]["dependencies"] = ["writing"]
        definitions[0]["deadline"] = None
    elif problem == "disabled":
        definitions[0]["enabled"] = False
    elif problem == "date":
        definitions[0]["start"] = "2026-02-30"
    else:
        definitions[0]["deliverables"] = []
    response = flow_client.post(
        "/api/v1/project-flows", json={"name": "无效流程", "stages": definitions}
    )
    assert response.status_code == 422
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(ProjectFlow)) == 0
        assert session.scalar(select(func.count()).select_from(ProjectFlowVersion)) == 0


@pytest.mark.parametrize("payload", [{}, {"name": None}, {"stages": None}, {"enabled": None}])
def test_flow_patch_rejects_empty_or_null_changes(
    flow_client: TestClient, payload: dict[str, object]
) -> None:
    original = flow_client.post(
        "/api/v1/project-flows", json={"name": "流程", "stages": stages()}
    ).json()
    url = f"/api/v1/project-flows/{original['id']}"
    response = flow_client.patch(url, json={"expected_version": 1, **payload})
    assert response.status_code == 422
    assert flow_client.get(url).json() == original


def test_flow_version_insert_failure_rolls_back_root_and_history(
    session_factory: sessionmaker[Session],
) -> None:
    data = FlowCreate.model_validate({"name": "事务流程", "stages": stages()})
    with session_factory() as session:
        original = service.create_flow(session, data)
        first = service.get_version(session, original.id, 1)

    def fail_commit(session: Session) -> None:
        raise RuntimeError("synthetic flow commit failure")

    with session_factory() as session:
        event.listen(session, "before_commit", fail_commit)
        with pytest.raises(RuntimeError, match="synthetic flow commit failure"):
            service.update_flow(
                session, original.id, FlowUpdate(expected_version=1, name="不得保存")
            )
        assert not session.in_transaction()
    with session_factory() as session:
        assert service.get_flow(session, original.id) == original
        assert service.get_version(session, original.id, 1) == first
        assert service.list_versions(session, original.id, limit=20, offset=0).total == 1


def test_missing_flow_and_snapshot_are_explicit(flow_client: TestClient) -> None:
    url = f"/api/v1/project-flows/{uuid4()}"
    assert flow_client.get(url).json()["error"]["code"] == "PROJECT_FLOW_NOT_FOUND"
    assert flow_client.get(f"{url}/versions/1").json()["error"]["code"] == (
        "PROJECT_FLOW_VERSION_NOT_FOUND"
    )


def test_snapshot_in_memory_is_not_mutated_by_later_update(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        flow = service.create_flow(
            session, FlowCreate.model_validate({"name": "流程", "stages": stages()})
        )
        first = service.get_version(session, flow.id, 1)
        copy = deepcopy(first.model_dump())
        service.update_flow(session, flow.id, FlowUpdate(expected_version=1, name="新流程"))
        assert first.model_dump() == copy
        with pytest.raises(AppError):
            service.get_flow(session, UUID(int=0))
