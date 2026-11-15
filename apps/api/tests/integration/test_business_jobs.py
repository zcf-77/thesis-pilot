"""Formal HTTP, PostgreSQL, and Redis/prefork regressions for saved-manuscript jobs."""

import signal
import socket
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from hashlib import sha256
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import httpx
import pytest
from alembic import command
from sqlalchemy import MetaData, Table, event, func, select, text
from sqlalchemy.exc import IntegrityError

from thesis_pilot.modules.jobs.models import Job, JobArtifact, JobAttempt, OutboxEvent, utcnow
from thesis_pilot.modules.jobs.schemas import JobCreate
from thesis_pilot.modules.jobs.service import (
    cancel_job,
    claim_job,
    create_job,
    finish_job,
    get_job_detail,
    list_jobs,
)
from thesis_pilot.workers import execution
from thesis_pilot.workers.celery_app import LEGACY_TASK_NAME
from thesis_pilot.workflows.diagnostic import run_diagnostic

from .conftest import PostgreSQLSandbox
from .test_long_jobs import isolated_worker, read_job
from .test_services import make_job, make_project
from .test_workspace import KEY, real_workspace_http

pytestmark = pytest.mark.integration
JOBS = "/api/v1/jobs"
KIND = "document_inspection"
MANUSCRIPT = "自制甲 😀。"
WORKER = "business_job_worker.py"


@pytest.fixture
def workspace_http(postgres: PostgreSQLSandbox, tmp_path: Path) -> Iterator[httpx.Client]:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    with real_workspace_http(postgres, tmp_path / "workspace-http.log", port) as client:
        assert client.get(JOBS, params={"project_id": str(uuid4())}).status_code == 401
        assert client.post("/api/v1/workspace/session", json={"access_key": KEY}).status_code == 200
        yield client


def manuscript(text_value: str = MANUSCRIPT) -> dict:
    return {
        "schema_version": 1,
        "json": {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": text_value}],
                }
            ],
        },
    }


def saved_manuscript(client: httpx.Client) -> tuple[str, str]:
    created_project = client.post("/api/v1/projects", json={"name": "自制结构检查项目"})
    assert created_project.status_code == 201
    project_id = created_project.json()["id"]
    created_doc = client.post(
        f"/api/v1/projects/{project_id}/documents", json={"content": manuscript()}
    )
    assert created_doc.status_code == 201
    assert created_doc.json()["version"] == 1
    return project_id, created_doc.json()["id"]


def job_input(project_id: str, document_id: str, *, include_text: bool = True) -> dict:
    return {
        "project_id": project_id,
        "kind": KIND,
        "input_snapshot": {"schema_version": 1, "document_id": document_id, "document_version": 1},
        "configuration": {"schema_version": 1, "include_text_statistics": include_text},
    }


def command_key() -> dict[str, str]:
    return {"Idempotency-Key": str(uuid4())}


def submit(client: httpx.Client, payload: dict, headers: dict[str, str] | None = None) -> dict:
    reply = client.post(JOBS, json=payload, headers=headers or command_key())
    assert reply.status_code == 202, reply.text
    return reply.json()


def detail(client: httpx.Client, job_id: UUID, project_id: str) -> dict:
    reply = client.get(f"{JOBS}/{job_id}", params={"project_id": project_id})
    assert reply.status_code == 200, reply.text
    return reply.json()


def persisted_attempt(
    postgres: PostgreSQLSandbox, job_id: UUID, expected_status: str
) -> tuple[JobAttempt, JobArtifact | None]:
    with postgres.sessions() as session:
        job = session.get(Job, job_id)
        assert job is not None and job.status == expected_status
        attempt = session.scalars(select(JobAttempt).where(JobAttempt.job_id == job_id)).one()
        artifact = session.scalars(
            select(JobArtifact).where(JobArtifact.job_id == job_id)
        ).one_or_none()
        assert attempt.attempt == 1 and attempt.status == expected_status
        assert attempt.finished_at is not None and job.run_token is None
        return attempt, artifact


@contextmanager
def commit_after_job_select(
    postgres: PostgreSQLSandbox, commit: Callable[[], None]
) -> Iterator[None]:
    """Commit in a second session just after the first job SELECT captures its snapshot."""
    engine = postgres.sessions.kw["bind"]
    committed = False

    def after_query(*args: object) -> None:
        nonlocal committed
        statement = args[2]
        if not committed and isinstance(statement, str) and "FROM jobs" in statement:
            committed = True
            commit()

    event.listen(engine, "after_cursor_execute", after_query)
    try:
        yield
        assert committed
    finally:
        event.remove(engine, "after_cursor_execute", after_query)


def test_formal_http_executes_fixed_saved_version_through_redis_once(
    postgres: PostgreSQLSandbox,
    redis_test_url: str,
    workspace_http: httpx.Client,
    tmp_path: Path,
) -> None:
    client = workspace_http
    project_id, document_id = saved_manuscript(client)
    payload = job_input(project_id, document_id)
    headers = command_key()
    queued = submit(client, payload, headers)
    job_id = UUID(queued["id"])
    assert queued["status"] == "queued"
    assert queued["input_snapshot"] == queued["resource_scope"] == payload["input_snapshot"]
    assert queued["configuration"] == payload["configuration"]
    assert submit(client, payload, headers)["id"] == str(job_id)
    conflicting = client.post(
        JOBS, json=job_input(project_id, document_id, include_text=False), headers=headers
    )
    assert (conflicting.status_code, conflicting.json()["error"]["code"]) == (
        409,
        "JOB_IDEMPOTENCY_CONFLICT",
    )

    document_path = f"/api/v1/projects/{project_id}/documents/{document_id}"
    revised = manuscript("编辑后的版本有另一段正文。")
    saved = client.patch(document_path, json={"content": revised, "expected_version": 1})
    assert saved.status_code == 200 and saved.json()["version"] == 2

    with isolated_worker(postgres, redis_test_url, tmp_path, worker_script=WORKER) as worker:
        worker.publish(job_id, task_name=LEGACY_TASK_NAME)
        worker.wait_until_consumed()
        assert read_job(postgres, job_id).status == "queued"
        assert worker.starts(job_id) == []
        assert worker.dispatch().published == 1
        worker.publish(job_id)
        started = worker.started(job_id)
        running = detail(client, job_id, project_id)
        assert running["status"] == running["attempts"][0]["status"] == "running"
        assert running["result"] is None and running["artifacts"] == []
        started.with_suffix(".release").touch()
        worker.wait_for_status(job_id, "succeeded")
        worker.wait_until_consumed()
        assert worker.starts(job_id) == [started]

        diagnostic = make_job(postgres)
        worker.publish(diagnostic, task_name=LEGACY_TASK_NAME)
        worker.started(diagnostic).with_suffix(".release").touch()
        old_delivery = worker.wait_for_status(diagnostic, "succeeded")
        worker.wait_until_consumed()
        assert old_delivery.result == run_diagnostic(diagnostic, old_delivery.project_id)

    complete = detail(client, job_id, project_id)
    result = complete["result"]
    assert result == {
        "kind": KIND,
        "schema_version": 1,
        "job_id": str(job_id),
        "project_id": project_id,
        "document_id": document_id,
        "document_version": 1,
        "node_count": 3,
        "paragraph_count": 1,
        "heading_count": 0,
        "table_count": 0,
        "text_characters": len(MANUSCRIPT),
        "model_used": False,
        "writes_performed": False,
    }
    attempt, artifact = persisted_attempt(postgres, job_id, "succeeded")
    assert artifact is not None and artifact.attempt_id == attempt.id and artifact.result == result
    assert [item["id"] for item in complete["attempts"]] == [str(attempt.id)]
    assert [item["id"] for item in complete["artifacts"]] == [str(artifact.id)]
    assert complete["artifacts"][0]["result"] == result
    assert client.get(f"{document_path}/versions/1").json()["content"] == manuscript()
    current = client.get(f"/api/v1/projects/{project_id}/documents/current").json()
    assert current["version"] == 2 and current["content"] == revised
    assert client.get(f"{document_path}/versions").json()["total"] == 2


def test_formal_job_schema_scope_and_concurrent_retry(
    postgres: PostgreSQLSandbox, workspace_http: httpx.Client
) -> None:
    client = workspace_http
    project_id, document_id = saved_manuscript(client)
    other_project, other_document = saved_manuscript(client)
    scope = {"project_id": project_id}
    other_scope = {"project_id": other_project}
    payload = job_input(project_id, document_id, include_text=False)
    rejected = [
        (job_input(project_id, other_document), 404, "DOCUMENT_NOT_FOUND"),
        (
            {**payload, "input_snapshot": {**payload["input_snapshot"], "document_version": 99}},
            404,
            "DOCUMENT_VERSION_NOT_FOUND",
        ),
        (
            {
                **payload,
                "configuration": {**payload["configuration"], "include_text_statistics": "false"},
            },
            422,
            "VALIDATION_ERROR",
        ),
    ]
    for invalid, status, code in rejected:
        response = client.post(JOBS, json=invalid, headers=command_key())
        assert (response.status_code, response.json()["error"]["code"]) == (status, code)

    with postgres.sessions() as session:
        diagnostic = create_job(session, JobCreate(project_id=UUID(project_id)), str(uuid4()))
    direct_diagnostic = f"{JOBS}/{diagnostic.id}"
    assert client.get(direct_diagnostic, params=scope).status_code == 404
    assert client.post(f"{direct_diagnostic}/cancel", params=scope).status_code == 404
    assert (
        client.post(f"{direct_diagnostic}/retry", params=scope, headers=command_key()).status_code
        == 404
    )
    diagnostic_create = client.post(JOBS, json={"project_id": project_id}, headers=command_key())
    assert (diagnostic_create.status_code, diagnostic_create.json()["error"]["code"]) == (
        422,
        "JOB_KIND_UNAVAILABLE",
    )

    original = submit(client, payload)
    job_path = f"{JOBS}/{original['id']}"
    assert client.get(job_path).status_code == 422
    for response in (
        client.get(job_path, params=other_scope),
        client.post(f"{job_path}/cancel", params=other_scope),
        client.post(f"{job_path}/retry", params=other_scope, headers=command_key()),
    ):
        assert (response.status_code, response.json()["error"]["code"]) == (404, "JOB_NOT_FOUND")
    assert client.post(f"{job_path}/retry", params=scope, headers=command_key()).status_code == 409
    cancelled = client.post(f"{job_path}/cancel", params=scope)
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    headers = command_key()
    barrier = Barrier(2, timeout=5)

    def retry(_: int) -> dict:
        barrier.wait()
        reply = client.post(f"{job_path}/retry", params=scope, headers=headers)
        assert reply.status_code == 202, reply.text
        return reply.json()

    with ThreadPoolExecutor(max_workers=2) as executor:
        first, second = executor.map(retry, (1, 2))
    assert first["id"] == second["id"] != original["id"]
    assert first["source_job_id"] == original["id"]
    for field in ("input_snapshot", "configuration", "resource_scope"):
        assert first[field] == original[field]
    assert detail(client, UUID(original["id"]), project_id)["status"] == "cancelled"

    other_job = submit(client, job_input(other_project, other_document))
    assert client.post(f"{JOBS}/{other_job['id']}/cancel", params=other_scope).status_code == 200
    different_parent = client.post(
        f"{JOBS}/{other_job['id']}/retry", params=other_scope, headers=headers
    )
    assert (different_parent.status_code, different_parent.json()["error"]["code"]) == (
        409,
        "JOB_IDEMPOTENCY_CONFLICT",
    )

    status_filter = client.get(JOBS, params={"project_id": project_id, "status": "queued"}).json()
    assert status_filter["total"] == 1
    assert [job["id"] for job in status_filter["items"]] == [first["id"]]
    page = client.get(JOBS, params={"project_id": project_id, "kind": KIND, "limit": 1}).json()
    assert page["total"] == 2 and len(page["items"]) == 1
    other_page = client.get(JOBS, params={"project_id": other_project}).json()
    assert other_page["total"] == 1 and other_page["items"][0]["id"] == other_job["id"]
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 4
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 4
        assert session.scalar(select(func.count()).select_from(JobAttempt)) == 0
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 0

    retried_id = UUID(first["id"])

    def cancel_retried_job() -> None:
        with postgres.sessions() as session:
            assert cancel_job(session, retried_id).status == "cancelled"

    with commit_after_job_select(postgres, cancel_retried_job), postgres.sessions() as session:
        listed = list_jobs(
            session,
            UUID(project_id),
            limit=10,
            offset=0,
            statuses=["queued"],
            include_diagnostic=False,
        )
        assert listed.total == 1
        assert [(job.id, job.status) for job in listed.items] == [(retried_id, "queued")]
    assert detail(client, retried_id, project_id)["status"] == "cancelled"


def test_prefork_invalid_business_result_and_cancelled_late_result_leave_no_artifact(
    postgres: PostgreSQLSandbox,
    redis_test_url: str,
    workspace_http: httpx.Client,
    tmp_path: Path,
) -> None:
    client = workspace_http
    project_id, document_id = saved_manuscript(client)
    payload = job_input(project_id, document_id)
    invalid = UUID(submit(client, payload)["id"])
    cancelled = UUID(submit(client, payload)["id"])
    (tmp_path / f"{invalid}.invalid").touch()

    with isolated_worker(postgres, redis_test_url, tmp_path, worker_script=WORKER) as worker:
        assert worker.dispatch().published == 2
        worker.started(invalid).with_suffix(".release").touch()
        held = worker.started(cancelled)
        assert (
            client.post(f"{JOBS}/{cancelled}/cancel", params={"project_id": project_id}).status_code
            == 200
        )
        held.with_suffix(".release").touch()
        worker.wait_for_status(invalid, "failed")
        worker.wait_until_consumed()

    failed_detail = detail(client, invalid, project_id)
    assert failed_detail["error_code"] == "JOB_RESULT_INVALID"
    assert failed_detail["attempts"][0]["error_code"] == "JOB_RESULT_INVALID"
    for job_id, status in ((invalid, "failed"), (cancelled, "cancelled")):
        view = detail(client, job_id, project_id)
        assert view["status"] == view["attempts"][0]["status"] == status
        assert view["result"] is None and view["artifacts"] == []
        assert persisted_attempt(postgres, job_id, status)[1] is None


def test_prefork_reclaimed_business_attempt_rejects_the_old_artifact(
    postgres: PostgreSQLSandbox,
    redis_test_url: str,
    workspace_http: httpx.Client,
    tmp_path: Path,
) -> None:
    client = workspace_http
    project_id, document_id = saved_manuscript(client)
    job_id = UUID(submit(client, job_input(project_id, document_id, include_text=False))["id"])
    with isolated_worker(postgres, redis_test_url, tmp_path, worker_script=WORKER) as worker:
        assert worker.dispatch().published == 1
        old = worker.started(job_id)
        worker.signal(old, signal.SIGSTOP)
        initial = read_job(postgres, job_id)
        assert initial.lease_until is not None
        worker.wait_until_expired(initial.lease_until)
        assert worker.dispatch().published == 1
        fresh = worker.started(job_id, 2)
        assert read_job(postgres, job_id).run_token != initial.run_token
        old.with_suffix(".release").touch()
        worker.signal(old, signal.SIGCONT)
        worker.wait(lambda: worker.broker.hlen(f"{worker.prefix}unacked") == 1, "旧执行确认消息")
        moving = detail(client, job_id, project_id)
        assert moving["status"] == "running" and moving["artifacts"] == []
        assert {row["attempt"]: row["status"] for row in moving["attempts"]} == {
            1: "lease_expired",
            2: "running",
        }
        fresh.with_suffix(".release").touch()
        worker.wait_for_status(job_id, "succeeded")
        worker.wait_until_consumed()

    complete = detail(client, job_id, project_id)
    assert complete["result"]["text_characters"] is None
    assert len(complete["artifacts"]) == 1
    with postgres.sessions() as session:
        artifact = session.scalars(select(JobArtifact).where(JobArtifact.job_id == job_id)).one()
        attempt = session.get(JobAttempt, artifact.attempt_id)
        assert attempt is not None and attempt.attempt == 2 and attempt.status == "succeeded"


def test_artifact_insert_failure_rolls_back_job_and_attempt(
    postgres: PostgreSQLSandbox, workspace_http: httpx.Client
) -> None:
    client = workspace_http
    project_id, document_id = saved_manuscript(client)
    job_id = UUID(submit(client, job_input(project_id, document_id))["id"])
    claim = claim_job(postgres.sessions, job_id, 60)
    assert claim is not None
    result = execution.run_document_inspection(claim, manuscript()["json"])
    table = JobArtifact.__tablename__
    engine = postgres.sessions.kw["bind"]
    with engine.begin() as connection:
        connection.execute(
            text(f"ALTER TABLE {table} ADD CONSTRAINT test_reject_artifact CHECK (false)")
        )
    try:
        with pytest.raises(IntegrityError, match="test_reject_artifact"):
            finish_job(postgres.sessions, claim, result=result)
        running = read_job(postgres, job_id)
        assert running.status == "running" and running.run_token == claim.run_token
        assert running.result is None
        view = detail(client, job_id, project_id)
        assert view["attempts"][0]["status"] == "running"
        assert view["attempts"][0]["finished_at"] is None and view["artifacts"] == []
    finally:
        with engine.begin() as connection:
            connection.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT test_reject_artifact"))

    def finish() -> None:
        assert finish_job(postgres.sessions, claim, result=result)

    with commit_after_job_select(postgres, finish), postgres.sessions() as session:
        previous = get_job_detail(session, job_id, project_id=UUID(project_id))
        assert previous.status == previous.attempts[0].status == "running"
        assert previous.result is None and previous.artifacts == []
    assert persisted_attempt(postgres, job_id, "succeeded")[1] is not None


def test_upgrade_from_0005_preserves_legacy_diagnostic_and_key(postgres: PostgreSQLSandbox) -> None:
    project_id = make_project(postgres)
    job_id, idempotency_key = uuid4(), str(uuid4())
    result = run_diagnostic(job_id, project_id)
    now = utcnow()
    request_hash = sha256(f"diagnostic:{project_id}".encode()).hexdigest()
    engine = postgres.sessions.kw["bind"]
    try:
        with engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261117_0005")
            legacy_jobs = Table("jobs", MetaData(), autoload_with=connection)
            connection.execute(
                legacy_jobs.insert().values(
                    id=job_id,
                    project_id=project_id,
                    kind="diagnostic",
                    status="succeeded",
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                    attempt=2,
                    result=result,
                    created_at=now,
                    updated_at=now,
                )
            )
        with engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.upgrade(postgres.alembic, "head")
            command.check(postgres.alembic)
    finally:
        postgres.alembic.attributes.pop("connection", None)

    with postgres.sessions() as session:
        replay = create_job(session, JobCreate(project_id=project_id), idempotency_key)
        assert replay.id == job_id and replay.attempt == 2
        assert replay.status == "succeeded" and replay.result == result
        assert replay.input_snapshot is replay.configuration is replay.resource_scope is None
        assert session.scalar(select(func.count()).select_from(JobAttempt)) == 0
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 0
