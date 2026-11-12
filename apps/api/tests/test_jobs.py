from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.modules.jobs.models import Job, OutboxEvent


def project(client: TestClient) -> UUID:
    response = client.post("/api/v1/projects", json={"name": "任务底座样例"})
    assert response.status_code == 201
    return UUID(response.json()["id"])


def test_idempotency_replay_and_different_request_conflict(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    first, second = project(client), project(client)
    headers = {"Idempotency-Key": "diagnostic-test-key"}
    response = client.post("/api/v1/jobs", json={"project_id": str(first)}, headers=headers)
    replay = client.post("/api/v1/jobs", json={"project_id": str(first)}, headers=headers)
    conflict = client.post("/api/v1/jobs", json={"project_id": str(second)}, headers=headers)
    assert response.status_code == replay.status_code == 202
    assert replay.json()["id"] == response.json()["id"]
    assert conflict.status_code == 409
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 1
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_jobs_reject_arbitrary_payload_and_missing_project(client: TestClient) -> None:
    project_id = project(client)
    headers = {"Idempotency-Key": str(uuid4())}
    assert client.post("/api/v1/jobs", json={"project_id": str(project_id)}).status_code == 422
    for extra in ({"kind": "execute-code"}, {"payload": "private manuscript"}):
        assert (
            client.post(
                "/api/v1/jobs", json={"project_id": str(project_id), **extra}, headers=headers
            ).status_code
            == 422
        )
    assert (
        client.post("/api/v1/jobs", json={"project_id": str(uuid4())}, headers=headers).status_code
        == 404
    )
    assert client.get(f"/api/v1/jobs/{uuid4()}").status_code == 404
