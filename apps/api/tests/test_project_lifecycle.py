"""SG-18A project metadata, CAS and fixed flow binding regressions."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.modules.project_flows import service as flows
from thesis_pilot.modules.project_flows.schemas import FlowCreate, FlowUpdate
from thesis_pilot.modules.projects import service
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.projects.schemas import ProjectCreate, ProjectUpdate


def create_flow(session: Session) -> tuple[str, str]:
    flow = flows.create_flow(
        session,
        FlowCreate.model_validate(
            {
                "name": "自制阶段流程",
                "stages": [
                    {
                        "id": stage,
                        "name": name,
                        "deliverables": ["自制产物"],
                        "conditions": ["本人核对"],
                        "dependencies": [],
                    }
                    for stage, name in (("proposal", "开题"), ("writing", "撰写"))
                ],
            }
        ),
    )
    return str(flow.id), str(flow.current_version_id)


def test_project_first_setup_optional_plan_and_partial_updates(client: TestClient) -> None:
    original = client.post(
        "/api/v1/projects",
        json={
            "name": "自制论文",
            "title": "基于自制数据的研究",
            "deadline": "2026-11-18",
            "existing_artifacts": "本人已核对开题报告，来源：自制记录。",
        },
    ).json()
    assert original["planning_mode"] == "none"
    assert original["plan_note"] == ""
    assert original["archived"] is False
    url = f"/api/v1/projects/{original['id']}"
    planned = client.patch(
        url,
        json={"expected_version": 1, "planning_mode": "personal", "plan_note": "每日核对一节"},
    )
    assert planned.status_code == 200
    assert planned.json()["name"] == original["name"]
    assert planned.json()["deadline"] == original["deadline"]
    assert planned.json()["existing_artifacts"] == original["existing_artifacts"]
    assert planned.json()["version"] == 2
    archived = client.patch(url, json={"expected_version": 2, "archived": True})
    assert archived.status_code == 200
    restored = client.patch(url, json={"expected_version": 3, "archived": False})
    assert restored.status_code == 200
    assert restored.json()["plan_note"] == "每日核对一节"
    assert client.get(url).json() == restored.json()
    assert client.get("/api/v1/projects").json()["total"] == 1
    assert client.patch(url, json={"expected_version": 1, "title": "旧稿"}).status_code == 409
    assert client.get(url).json() == restored.json()


@pytest.mark.parametrize(
    "fields",
    [
        {"title": None},
        {"archived": None},
        {"planning_mode": "automatic"},
        {"deadline": "2026-02-30"},
        {"stage_id": "proposal"},
    ],
)
def test_invalid_metadata_does_not_overwrite_project(
    client: TestClient, fields: dict[str, object]
) -> None:
    original = client.post("/api/v1/projects", json={"name": "保留输入"}).json()
    url = f"/api/v1/projects/{original['id']}"
    assert client.patch(url, json={"expected_version": 1, **fields}).status_code == 422
    assert client.get(url).json() == original


def test_old_binding_survives_new_version_and_disable(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    from uuid import UUID

    with session_factory() as session:
        flow_id, version_id = create_flow(session)
    original = client.post(
        "/api/v1/projects",
        json={"name": "固定版本", "flow_version_id": version_id, "stage_id": "proposal"},
    ).json()
    url = f"/api/v1/projects/{original['id']}"
    with session_factory() as session:
        flows.update_flow(session, UUID(flow_id), FlowUpdate(expected_version=1, enabled=False))
    assert client.get(url).json() == original
    same = client.patch(url, json={"expected_version": 1, "name": "旧绑定继续编辑"})
    assert same.status_code == 200
    assert same.json()["flow_version_id"] == version_id
    rejected = client.patch(url, json={"expected_version": 2, "stage_id": "writing"})
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "PROJECT_FLOW_DISABLED"
    new = client.post(
        "/api/v1/projects",
        json={"name": "禁止绑定", "flow_version_id": version_id, "stage_id": "proposal"},
    )
    assert new.status_code == 409
    assert client.get(url).json() == same.json()
    unbound = client.patch(
        url, json={"expected_version": 2, "flow_version_id": None, "stage_id": None}
    )
    assert unbound.status_code == 200
    assert unbound.json()["flow_version_id"] is None


def test_binding_requires_real_version_and_valid_stage(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    with session_factory() as session:
        _, version_id = create_flow(session)
    invalid = client.post(
        "/api/v1/projects",
        json={"name": "无效阶段", "flow_version_id": version_id, "stage_id": "unknown"},
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "PROJECT_FLOW_STAGE_INVALID"
    missing = client.post(
        "/api/v1/projects",
        json={"name": "缺失版本", "flow_version_id": str(uuid4()), "stage_id": "proposal"},
    )
    assert missing.status_code == 404
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Project)) == 0


def test_new_flow_version_does_not_rebind_existing_project(
    session_factory: sessionmaker[Session],
) -> None:
    from uuid import UUID

    with session_factory() as session:
        flow_id, version_id = create_flow(session)
        project = service.create_project(
            session,
            ProjectCreate(name="绑定快照", flow_version_id=UUID(version_id), stage_id="proposal"),
        )
        updated = flows.update_flow(
            session, UUID(flow_id), FlowUpdate(expected_version=1, name="v2")
        )
        assert service.get_project(session, project.id) == project
        rebound = service.update_project(
            session,
            project.id,
            ProjectUpdate(expected_version=1, flow_version_id=updated.current_version_id),
        )
        assert rebound.flow_version_id == updated.current_version_id
        assert rebound.stage_id == "proposal"
