"""INT-006: project-scoped task recovery and stable pagination."""

from datetime import UTC, datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.models import Job
from thesis_pilot.modules.jobs.schemas import JobCreate, JobRead
from thesis_pilot.modules.jobs.service import claim_job, create_job, finish_job, list_jobs
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.workflows.diagnostic import run_diagnostic


def make_project(factory: sessionmaker[Session], name: str = "任务列表自制样例") -> UUID:
    with factory() as session:
        return create_project(session, ProjectCreate(name=name)).id


def make_job(factory: sessionmaker[Session], project_id: UUID) -> UUID:
    with factory() as session:
        return create_job(session, JobCreate(project_id=project_id), str(uuid4())).id


def test_job_list_services_filter_project_and_paginate_after_reopen(
    session_factory: sessionmaker[Session],
) -> None:
    selected = make_project(session_factory)
    other = make_project(session_factory, "其他项目")
    ids = [make_job(session_factory, selected) for _ in range(4)]
    other_job = make_job(session_factory, other)
    fixed = datetime(2026, 11, 14, 10, tzinfo=UTC)
    with session_factory() as session, session.begin():
        session.execute(update(Job).where(Job.id.in_(ids)).values(created_at=fixed))
        session.execute(
            update(Job).where(Job.id == ids[0]).values(created_at=fixed + timedelta(seconds=1))
        )
    expected = [ids[0], *sorted(ids[1:], reverse=True)]
    with session_factory() as session:
        first = list_jobs(session, selected, limit=2, offset=0)
        assert not session.in_transaction()
    with session_factory() as reopened:
        second = list_jobs(reopened, selected, limit=2, offset=2)
        exhausted = list_jobs(reopened, selected, limit=2, offset=4)
    assert first.total == second.total == exhausted.total == 4
    assert (first.limit, first.offset, second.limit, second.offset) == (2, 0, 2, 2)
    assert [job.id for job in first.items + second.items] == expected
    assert exhausted.items == []
    assert all(job.project_id == selected for job in first.items + second.items)
    assert other_job not in {job.id for job in first.items + second.items}
    assert all(job.created_at.utcoffset() == timedelta(0) for job in first.items + second.items)


def test_job_list_services_empty_project_and_unknown_project(
    session_factory: sessionmaker[Session],
) -> None:
    selected = make_project(session_factory)
    with session_factory() as session:
        empty = list_jobs(session, selected, limit=20, offset=0)
        assert empty.items == [] and empty.total == 0
        with pytest.raises(AppError) as captured:
            list_jobs(session, uuid4(), limit=20, offset=0)
        assert captured.value.code == "PROJECT_NOT_FOUND"
        assert captured.value.status_code == 404
        assert not session.in_transaction()


def test_job_list_services_preserve_finished_state_and_result(
    session_factory: sessionmaker[Session],
) -> None:
    selected = make_project(session_factory)
    job_id = make_job(session_factory, selected)
    claim = claim_job(session_factory, job_id, 60)
    assert claim is not None
    result = run_diagnostic(claim.job_id, claim.project_id)
    assert finish_job(session_factory, claim, result=result)
    with session_factory() as session:
        page = list_jobs(session, selected, limit=20, offset=0)
        item = page.items[0]
        assert item.id == job_id
        assert item.status == "succeeded" and item.attempt == 1
        assert item.result is not None and item.result.model_dump(mode="json") == result
        persisted = session.get(Job, job_id)
        assert persisted is not None
        assert persisted.status == "succeeded" and persisted.run_token is None


def test_job_list_services_normalize_all_job_timestamps_to_utc() -> None:
    local = datetime(2026, 11, 14, 18, tzinfo=timezone(timedelta(hours=8)))
    job = JobRead(
        id=uuid4(),
        project_id=uuid4(),
        kind="diagnostic",
        status="queued",
        attempt=0,
        result=None,
        error_code=None,
        created_at=local,
        updated_at=local.replace(tzinfo=None),
    )
    assert job.created_at == datetime(2026, 11, 14, 10, tzinfo=UTC)
    assert job.updated_at == datetime(2026, 11, 14, 18, tzinfo=UTC)


@pytest.mark.parametrize(
    "query",
    [
        "",
        "?project_id=bad",
        f"?project_id={uuid4()}&limit=0",
        f"?project_id={uuid4()}&limit=101",
        f"?project_id={uuid4()}&offset=-1",
        f"?project_id={uuid4()}&status=unknown",
    ],
)
def test_job_list_http_rejects_invalid_parameters(client: TestClient, query: str) -> None:
    assert client.get(f"/api/v1/jobs{query}").status_code == 422


def test_job_list_http_requires_authentication(client: TestClient) -> None:
    response = client.get(
        f"/api/v1/jobs?project_id={uuid4()}", headers={"Authorization": "Bearer invalid"}
    )
    assert response.status_code == 401


def test_job_list_http_returns_project_page_and_missing_project(client: TestClient) -> None:
    project = client.post("/api/v1/projects", json={"name": "接口列表自制样例"}).json()
    created = client.post(
        "/api/v1/jobs",
        json={"project_id": project["id"]},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert created.status_code == 202
    response = client.get(f"/api/v1/jobs?project_id={project['id']}")
    assert response.status_code == 200
    assert response.json() == {
        "items": [created.json()],
        "total": 1,
        "limit": 20,
        "offset": 0,
    }
    assert client.get(f"/api/v1/jobs?project_id={uuid4()}").status_code == 404


def test_job_list_http_filters_status_before_pagination(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    project_id, other_id = make_project(session_factory), make_project(session_factory)
    running = make_job(session_factory, project_id)
    queued = make_job(session_factory, project_id)
    finished = make_job(session_factory, project_id)
    make_job(session_factory, other_id)

    assert claim_job(session_factory, running, 60) is not None
    claim = claim_job(session_factory, finished, 60)
    assert claim is not None
    assert finish_job(session_factory, claim, result=run_diagnostic(claim.job_id, claim.project_id))

    url = f"/api/v1/jobs?project_id={project_id}"
    latest = client.get(f"{url}&limit=1")
    assert latest.status_code == 200
    assert latest.json()["total"] == 3
    assert [item["id"] for item in latest.json()["items"]] == [str(finished)]
    active = client.get(f"{url}&status=queued&status=running&limit=1")
    assert active.status_code == 200
    assert active.json()["total"] == 2
    assert [item["id"] for item in active.json()["items"]] == [str(queued)]
    earlier = client.get(f"{url}&status=queued&status=running&limit=1&offset=1")
    assert earlier.json()["total"] == 2
    assert [item["id"] for item in earlier.json()["items"]] == [str(running)]
    running_only = client.get(f"{url}&status=running")
    assert running_only.status_code == 200
    assert running_only.json()["total"] == 1
    assert [item["id"] for item in running_only.json()["items"]] == [str(running)]
