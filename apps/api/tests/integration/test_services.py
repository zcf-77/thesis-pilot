"""PostgreSQL concurrency and a real Linux Celery/Redis process boundary."""

import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from threading import Barrier, Event
from uuid import UUID, uuid4

import pytest
from alembic.script import ScriptDirectory
from pydantic import SecretStr
from redis import Redis
from sqlalchemy import func, select

from thesis_pilot.core.config import Settings
from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.models import Job, OutboxEvent, utcnow
from thesis_pilot.modules.jobs.schemas import JobCreate
from thesis_pilot.modules.jobs.service import (
    cancel_job,
    claim_job,
    create_job,
    dispatch_pending,
    finish_job,
)
from thesis_pilot.modules.projects.schemas import ProjectCreate, ProjectUpdate
from thesis_pilot.modules.projects.service import create_project, update_project
from thesis_pilot.workers.celery_app import TASK_NAME, create_celery
from thesis_pilot.workflows.diagnostic import run_diagnostic

from .conftest import PostgreSQLSandbox

pytestmark = pytest.mark.integration


def make_project(postgres: PostgreSQLSandbox) -> UUID:
    with postgres.sessions() as session:
        return create_project(session, ProjectCreate(name="自制集成样例")).id


def make_job(postgres: PostgreSQLSandbox) -> UUID:
    project_id = make_project(postgres)
    with postgres.sessions() as session:
        return create_job(session, JobCreate(project_id=project_id), str(uuid4())).id


def test_migrations_have_single_head_and_no_metadata_drift(postgres: PostgreSQLSandbox) -> None:
    # The fixture already executed upgrade head and alembic check on real PostgreSQL.
    heads = ScriptDirectory.from_config(postgres.alembic).get_heads()
    assert len(heads) == 1
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 0


def test_concurrent_project_cas_has_exactly_one_winner(postgres: PostgreSQLSandbox) -> None:
    project_id = make_project(postgres)
    barrier = Barrier(2, timeout=10)

    def write(name: str) -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                updated = update_project(
                    session, project_id, ProjectUpdate(name=name, expected_version=1)
                )
                assert updated.version == 2
                return "accepted"
            except AppError as error:
                assert error.code == "PROJECT_VERSION_CONFLICT"
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(write, ["并发甲", "并发乙"]))
    assert sorted(outcomes) == ["accepted", "conflict"]


def test_concurrent_idempotency_creates_one_job_and_outbox(postgres: PostgreSQLSandbox) -> None:
    project_id = make_project(postgres)
    barrier = Barrier(2, timeout=10)
    key = str(uuid4())

    def create(_: int) -> UUID:
        barrier.wait()
        with postgres.sessions() as session:
            return create_job(session, JobCreate(project_id=project_id), key).id

    with ThreadPoolExecutor(max_workers=2) as executor:
        ids = list(executor.map(create, [1, 2]))
    assert ids[0] == ids[1]
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 1
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_two_dispatchers_skip_locked_outbox(postgres: PostgreSQLSandbox) -> None:
    job_id = make_job(postgres)
    locked, release = Event(), Event()
    published: list[UUID] = []

    def blocked_publish(value: UUID) -> None:
        published.append(value)
        locked.set()
        if not release.wait(10):
            raise TimeoutError("test dispatcher was not released")

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(dispatch_pending, postgres.sessions, blocked_publish)
        try:
            assert locked.wait(5)
            second = executor.submit(dispatch_pending, postgres.sessions, published.append)
            assert second.result(timeout=5).published == 0
        finally:
            release.set()
        assert first.result(timeout=5).published == 1
    assert published == [job_id]


def test_cancelled_job_rejects_late_result(postgres: PostgreSQLSandbox) -> None:
    job_id = make_job(postgres)
    claim = claim_job(postgres.sessions, job_id, 60)
    assert claim is not None
    with postgres.sessions() as session:
        cancel_job(session, job_id)
    assert not finish_job(postgres.sessions, claim, result={"late": True})
    with postgres.sessions() as session:
        job = session.get(Job, job_id)
        assert job is not None and job.status == "cancelled" and job.result is None


def test_expired_lease_is_republished_and_reclaimed(postgres: PostgreSQLSandbox) -> None:
    job_id = make_job(postgres)
    instant = utcnow() + timedelta(seconds=1)
    deliveries: list[UUID] = []
    dispatch_pending(postgres.sessions, deliveries.append, now=instant, redelivery_seconds=2)
    old_claim = claim_job(postgres.sessions, job_id, 10, now=instant)
    assert old_claim is not None
    after_expiry = instant + timedelta(seconds=11)
    assert dispatch_pending(postgres.sessions, deliveries.append, now=after_expiry).published == 1
    new_claim = claim_job(postgres.sessions, job_id, 60, now=after_expiry)
    assert new_claim is not None and new_claim.run_token != old_claim.run_token
    assert not finish_job(postgres.sessions, old_claim, result={"stale": True}, now=after_expiry)
    result = run_diagnostic(new_claim.job_id, new_claim.project_id)
    assert finish_job(postgres.sessions, new_claim, result=result, now=after_expiry)
    assert deliveries == [job_id, job_id]


WORKER_PROGRAM = """
import os
from thesis_pilot.workers.celery_app import app
queue = os.environ['TP_TEST_WORKER_QUEUE']
prefix = os.environ['TP_TEST_REDIS_PREFIX']
options = dict(app.conf.broker_transport_options)
options['global_keyprefix'] = prefix
app.conf.update(broker_transport_options=options, worker_enable_remote_control=False,
                task_default_queue=queue)
app.worker_main(['worker', '--pool=solo', '--concurrency=1', '--loglevel=WARNING',
                 '--without-gossip', '--without-mingle', '--without-heartbeat',
                 '--queues=' + queue, '--hostname=' + queue + '@%h'])
"""


def test_real_redis_worker_completes_and_deduplicates(
    postgres: PostgreSQLSandbox, redis_test_url: str, tmp_path: Path
) -> None:
    if not sys.platform.startswith("linux"):
        pytest.fail("真实 Celery worker 验证必须在 Linux 执行；Windows 不计为通过。")
    broker = Redis.from_url(redis_test_url, socket_connect_timeout=3, socket_timeout=3)
    assert broker.ping()
    prefix = f"tp_test_{uuid4().hex}:"
    queue = f"tp_test_{uuid4().hex}"
    settings = Settings(
        _env_file=None,
        environment="test",
        database_url=SecretStr(postgres.url),
        redis_url=SecretStr(redis_test_url),
        api_token=SecretStr("integration-only-token-with-32-or-more-characters"),
        cors_origins=[],
    )
    producer = create_celery(settings)
    options = dict(producer.conf.broker_transport_options)
    options["global_keyprefix"] = prefix
    producer.conf.update(broker_transport_options=options, task_default_queue=queue)
    child_env = {
        **os.environ,
        "TP_ENVIRONMENT": "test",
        "TP_DATABASE_URL": postgres.url,
        "TP_REDIS_URL": redis_test_url,
        "TP_API_TOKEN": "integration-only-token-with-32-or-more-characters",
        "TP_CORS_ORIGINS": "[]",
        "TP_WORKER_LEASE_SECONDS": "60",
        "TP_TEST_WORKER_QUEUE": queue,
        "TP_TEST_REDIS_PREFIX": prefix,
    }
    job_id = make_job(postgres)

    def publish(value: UUID) -> None:
        producer.send_task(TASK_NAME, args=[str(value)], queue=queue, retry=False)

    process = None
    try:
        with (tmp_path / "worker.log").open("wb") as log:
            process = subprocess.Popen(
                [sys.executable, "-c", WORKER_PROGRAM],
                env=child_env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            assert dispatch_pending(postgres.sessions, publish).published == 1
            publish(job_id)  # A real duplicate delivery must not execute a second attempt.
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                assert process.poll() is None, "Linux worker 提前退出，检查隔离测试 worker.log。"
                with postgres.sessions() as session:
                    job = session.get(Job, job_id)
                    assert job is not None
                    if job.status == "succeeded":
                        assert job.attempt == 1
                        assert job.result is not None and job.result["model_used"] is False
                        break
                    assert job.status != "failed", "真实队列诊断任务失败。"
                time.sleep(0.1)
            else:
                pytest.fail("真实 Redis/Celery 链路未在 30 秒内完成。")
            # Wait for both queued messages to be consumed; no eager execution is used.
            while (
                broker.llen(f"{prefix}{queue}") or broker.hlen(f"{prefix}unacked")
            ) and time.monotonic() < deadline:
                time.sleep(0.1)
            assert broker.llen(f"{prefix}{queue}") == 0
            assert broker.hlen(f"{prefix}unacked") == 0
            with postgres.sessions() as session:
                assert session.get(Job, job_id).attempt == 1  # type: ignore[union-attr]
    finally:
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        producer.close()
        # No FLUSHDB, shared-queue purge or unscoped key deletion.
        owned_keys = list(broker.scan_iter(match=f"{prefix}*"))
        if owned_keys:
            broker.delete(*owned_keys)
        broker.close()
