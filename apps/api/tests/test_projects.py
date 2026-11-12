"""BE-003: project persistence, safe updates and rollback regressions."""

from datetime import datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.modules.projects import service
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.projects.schemas import ProjectCreate, ProjectUpdate


def test_create_and_read_project_after_session_reopen(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    response = client.post("/api/v1/projects", json={"name": "  自制测试项目  "})
    assert response.status_code == 201
    created = response.json()
    project_id = UUID(created["id"])
    assert created["name"] == "自制测试项目"
    assert created["version"] == 1
    assert datetime.fromisoformat(created["created_at"]).utcoffset() is not None
    with session_factory() as session:
        persisted = session.get(Project, project_id)
        assert persisted is not None
        assert persisted.name == "自制测试项目"
    fetched = client.get(f"/api/v1/projects/{project_id}")
    assert fetched.status_code == 200
    assert fetched.json() == created


def test_list_projects_has_bounded_pagination(client: TestClient) -> None:
    ids = {
        client.post("/api/v1/projects", json={"name": name}).json()["id"]
        for name in ["甲项目", "乙项目", "丙项目"]
    }
    first = client.get("/api/v1/projects?limit=2&offset=0")
    second = client.get("/api/v1/projects?limit=2&offset=2")
    assert first.status_code == second.status_code == 200
    assert first.json()["total"] == second.json()["total"] == 3
    assert len(first.json()["items"]) == 2
    assert len(second.json()["items"]) == 1
    assert {item["id"] for item in first.json()["items"] + second.json()["items"]} == ids
    assert client.get("/api/v1/projects?limit=101").status_code == 422
    assert client.get("/api/v1/projects?offset=-1").status_code == 422


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"name": ""},
        {"name": " \t\n "},
        {"name": "甲" * 201},
        {"name": "有效项目", "version": 99},
        {"name": "有效项目", "body": "不允许夹带论文正文"},
    ],
)
def test_reject_invalid_project_without_writing(
    client: TestClient, session_factory: sessionmaker[Session], payload: dict[str, object]
) -> None:
    assert client.post("/api/v1/projects", json=payload).status_code == 422
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Project)) == 0


def test_stale_update_cannot_overwrite_newer_project(client: TestClient) -> None:
    original = client.post("/api/v1/projects", json={"name": "原名"}).json()
    url = f"/api/v1/projects/{original['id']}"
    accepted = client.patch(url, json={"name": "用户新名称", "expected_version": 1})
    assert accepted.status_code == 200
    assert accepted.json()["version"] == 2
    assert accepted.json()["created_at"] == original["created_at"]
    stale = client.patch(url, json={"name": "过期编辑", "expected_version": 1})
    assert stale.status_code == 409
    assert "PROJECT_VERSION_CONFLICT" in stale.text
    assert client.get(url).json() == accepted.json()
    retry = client.patch(url, json={"name": "再次保存", "expected_version": 2})
    assert retry.status_code == 200
    assert retry.json()["version"] == 3


@pytest.mark.parametrize("expected_version", [0, -1, "1", True])
def test_update_requires_valid_explicit_version(
    client: TestClient, expected_version: object
) -> None:
    original = client.post("/api/v1/projects", json={"name": "原名"}).json()
    url = f"/api/v1/projects/{original['id']}"
    response = client.patch(url, json={"name": "修改", "expected_version": expected_version})
    assert response.status_code == 422
    assert client.get(url).json() == original


def test_missing_project_is_not_a_version_conflict(client: TestClient) -> None:
    url = f"/api/v1/projects/{uuid4()}"
    missing_read = client.get(url)
    missing_update = client.patch(url, json={"name": "修改", "expected_version": 1})
    assert missing_read.status_code == missing_update.status_code == 404
    assert "PROJECT_NOT_FOUND" in missing_read.text
    assert "PROJECT_NOT_FOUND" in missing_update.text


def test_update_without_version_is_rejected(client: TestClient) -> None:
    original = client.post("/api/v1/projects", json={"name": "原名"}).json()
    url = f"/api/v1/projects/{original['id']}"
    assert client.patch(url, json={"name": "修改"}).status_code == 422
    assert client.get(url).json() == original


def test_flush_failure_rolls_back_created_project(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with session_factory() as session:
        original_flush = session.flush

        def fail_after_insert() -> None:
            original_flush()
            raise RuntimeError("synthetic transaction failure")

        monkeypatch.setattr(session, "flush", fail_after_insert)
        with pytest.raises(RuntimeError, match="synthetic transaction failure"):
            service.create_project(session, ProjectCreate(name="必须回滚的测试项目"))
        assert not session.in_transaction()
    with session_factory() as reopened:
        assert reopened.scalar(select(func.count()).select_from(Project)) == 0


def test_update_commit_failure_preserves_name_and_version(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        original = service.create_project(session, ProjectCreate(name="原名"))

    def fail_before_commit(session: Session) -> None:
        raise RuntimeError("synthetic commit failure")

    with session_factory() as session:
        event.listen(session, "before_commit", fail_before_commit)
        with pytest.raises(RuntimeError, match="synthetic commit failure"):
            service.update_project(
                session, original.id, ProjectUpdate(name="不能落库", expected_version=1)
            )
        assert not session.in_transaction()
    with session_factory() as reopened:
        persisted = reopened.get(Project, original.id)
        assert persisted is not None
        assert persisted.name == original.name
        assert persisted.version == original.version
