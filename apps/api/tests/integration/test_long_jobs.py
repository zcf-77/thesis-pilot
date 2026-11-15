"""Real PostgreSQL lock timing and Redis/prefork diagnostic recovery."""

import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Barrier, Event
from uuid import UUID, uuid4

import pytest
from celery import Celery
from pydantic import SecretStr
from redis import Redis
from sqlalchemy import event, func, select

from thesis_pilot.core.config import Settings
from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.models import Job
from thesis_pilot.modules.jobs.service import (
    DispatchResult,
    cancel_job,
    claim_job,
    dispatch_pending,
    finish_job,
    renew_job,
)
from thesis_pilot.workers.celery_app import TASK_NAME, create_celery
from thesis_pilot.workflows.diagnostic import run_diagnostic

from .conftest import PostgreSQLSandbox
from .test_services import make_job

pytestmark = pytest.mark.integration


def read_job(postgres: PostgreSQLSandbox, job_id: UUID) -> Job:
    with postgres.sessions() as session:
        job = session.get(Job, job_id)
        assert job is not None
        return job


def database_time(postgres: PostgreSQLSandbox) -> datetime:
    with postgres.sessions() as session:
        return session.execute(select(func.clock_timestamp())).scalar_one()


@pytest.mark.parametrize("operation", ["finish", "renew"])
def test_waiting_for_row_lock_cannot_use_an_earlier_clock(
    postgres: PostgreSQLSandbox, operation: str
) -> None:
    job_id = make_job(postgres)
    claim = claim_job(postgres.sessions, job_id, 3, execution_timeout_seconds=30)
    assert claim is not None
    result = run_diagnostic(claim.job_id, claim.project_id)
    trying_lock = Event()
    engine = postgres.sessions.kw["bind"]

    def before_query(*args: object) -> None:
        statement = args[2]
        if isinstance(statement, str) and "FOR UPDATE" in statement:
            trying_lock.set()

    def perform() -> bool:
        if operation == "renew":
            return renew_job(postgres.sessions, claim, 3)
        return finish_job(postgres.sessions, claim, result=result)

    with ThreadPoolExecutor(max_workers=1) as executor:
        with postgres.sessions() as locked, locked.begin():
            job = locked.scalar(select(Job).where(Job.id == job_id).with_for_update())
            assert job is not None
            lease = job.lease_until
            assert lease is not None
            event.listen(engine, "before_cursor_execute", before_query)
            try:
                future = executor.submit(perform)
                assert trying_lock.wait(2)
                assert database_time(postgres) < lease
                while database_time(postgres) < lease:
                    assert not future.done()
                    time.sleep(0.05)
            finally:
                event.remove(engine, "before_cursor_execute", before_query)
        assert not future.result(timeout=5)

    expired = read_job(postgres, job_id)
    assert expired.run_token == claim.run_token
    assert expired.lease_until == lease
    assert expired.result is None


def test_cancel_and_finish_have_one_terminal_winner(postgres: PostgreSQLSandbox) -> None:
    job_id = make_job(postgres)
    claim = claim_job(postgres.sessions, job_id, 30)
    assert claim is not None
    expected = run_diagnostic(claim.job_id, claim.project_id)
    barrier = Barrier(2, timeout=5)

    def finish() -> bool:
        barrier.wait()
        return finish_job(postgres.sessions, claim, result=expected)

    def cancel() -> bool:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                return cancel_job(session, job_id).status == "cancelled"
            except AppError as error:
                assert error.code == "JOB_STATE_CONFLICT"
                return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        finished = executor.submit(finish)
        cancelled = executor.submit(cancel)
        finish_won = finished.result(timeout=5)
        assert finish_won != cancelled.result(timeout=5)

    persisted = read_job(postgres, job_id)
    assert persisted.status == ("succeeded" if finish_won else "cancelled")
    assert persisted.result == (expected if finish_won else None)
    assert persisted.run_token is None and persisted.execution_deadline_at is None


@dataclass
class PreforkWorker:
    postgres: PostgreSQLSandbox
    process: subprocess.Popen[bytes]
    producer: Celery
    broker: Redis
    prefix: str
    queue: str
    directory: Path

    def publish(self, job_id: UUID, *, task_name: str = TASK_NAME) -> None:
        self.producer.send_task(task_name, args=[str(job_id)], queue=self.queue, retry=False)

    def dispatch(self) -> DispatchResult:
        return dispatch_pending(self.postgres.sessions, self.publish)

    def wait(self, ready: Callable[[], bool], description: str, timeout: float = 20) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            assert self.process.poll() is None, (
                f"隔离 worker 提前退出，查看 {self.directory / 'worker.log'}"
            )
            if ready():
                return
            time.sleep(0.05)
        pytest.fail(f"等待 {description} 超时，查看 {self.directory / 'worker.log'}")

    def starts(self, job_id: UUID) -> list[Path]:
        return sorted(
            self.directory.glob(f"{job_id}.*.started"), key=lambda path: path.stat().st_mtime_ns
        )

    def started(self, job_id: UUID, attempt: int = 1) -> Path:
        self.wait(lambda: len(self.starts(job_id)) >= attempt, f"第 {attempt} 次执行")
        started = self.starts(job_id)
        assert len(started) == attempt
        assert read_job(self.postgres, job_id).attempt == attempt
        return started[-1]

    def signal(self, started: Path, sig: signal.Signals) -> None:
        pid = int(started.name.split(".")[1])
        assert os.getpgid(pid) == self.process.pid
        os.kill(pid, sig)

    def wait_until_expired(self, lease: datetime) -> None:
        self.wait(lambda: database_time(self.postgres) >= lease, "固定租约到期")

    def wait_for_status(self, job_id: UUID, status: str) -> Job:
        self.wait(lambda: read_job(self.postgres, job_id).status == status, f"任务进入 {status}")
        return read_job(self.postgres, job_id)

    def wait_until_consumed(self) -> None:
        def drained() -> bool:
            return (
                self.broker.llen(f"{self.prefix}{self.queue}") == 0
                and self.broker.hlen(f"{self.prefix}unacked") == 0
            )

        self.wait(drained, "队列及未确认消息清空")


@contextmanager
def isolated_worker(
    postgres: PostgreSQLSandbox,
    redis_url: str,
    directory: Path,
    *,
    timeout_seconds: int = 60,
    worker_script: str = "long_job_worker.py",
) -> Iterator[PreforkWorker]:
    if not sys.platform.startswith("linux"):
        pytest.fail("真实 Celery prefork 验证必须在 Linux 执行。")
    broker = Redis.from_url(redis_url, socket_connect_timeout=3, socket_timeout=3)
    assert broker.ping()
    prefix = f"tp_test_{uuid4().hex}:"
    queue = f"tp_test_{uuid4().hex}"
    token = "long-job-integration-token-with-32-characters"
    settings = Settings(
        _env_file=None,
        environment="test",
        database_url=SecretStr(postgres.url),
        redis_url=SecretStr(redis_url),
        api_token=SecretStr(token),
        cors_origins=[],
        worker_lease_seconds=10,
        worker_execution_timeout_seconds=timeout_seconds,
    )
    producer = create_celery(settings)
    options = dict(producer.conf.broker_transport_options)
    options["global_keyprefix"] = prefix
    producer.conf.update(broker_transport_options=options, task_default_queue=queue)
    child_env = {
        **os.environ,
        "TP_ENVIRONMENT": "test",
        "TP_DATABASE_URL": postgres.url,
        "TP_REDIS_URL": redis_url,
        "TP_API_TOKEN": token,
        "TP_CORS_ORIGINS": "[]",
        "TP_WORKER_LEASE_SECONDS": "10",
        "TP_WORKER_EXECUTION_TIMEOUT_SECONDS": str(timeout_seconds),
        "TP_TEST_WORKER_QUEUE": queue,
        "TP_TEST_REDIS_PREFIX": prefix,
    }

    try:
        with (directory / "worker.log").open("wb") as log:
            process = subprocess.Popen(
                [sys.executable, str(Path(__file__).resolve().with_name(worker_script))],
                cwd=directory,
                env=child_env,
                start_new_session=True,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            try:
                yield PreforkWorker(postgres, process, producer, broker, prefix, queue, directory)
            finally:
                for started in directory.glob("*.started"):
                    started.with_suffix(".release").touch()
                # The group contains only this test's worker and its prefork children.
                with suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGCONT)
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
    finally:
        producer.close()
        owned_keys = list(broker.scan_iter(match=f"{prefix}*"))
        if owned_keys:
            broker.delete(*owned_keys)
        broker.close()


def test_prefork_renews_past_initial_lease_and_deduplicates(
    postgres: PostgreSQLSandbox, redis_test_url: str, tmp_path: Path
) -> None:
    job_id = make_job(postgres)
    with isolated_worker(postgres, redis_test_url, tmp_path) as worker:
        assert worker.dispatch().published == 1
        worker.publish(job_id)
        started = worker.started(job_id)
        initial = read_job(postgres, job_id)
        assert initial.lease_until is not None
        worker.wait_until_expired(initial.lease_until)
        renewed = read_job(postgres, job_id)
        assert renewed.lease_until is not None and renewed.lease_until > initial.lease_until
        assert renewed.execution_deadline_at == initial.execution_deadline_at
        assert renewed.run_token == initial.run_token
        assert worker.dispatch().published == 0
        started.with_suffix(".release").touch()
        complete = worker.wait_for_status(job_id, "succeeded")
        worker.wait_until_consumed()
        assert complete.attempt == 1 and worker.starts(job_id) == [started]
        assert complete.result == run_diagnostic(job_id, complete.project_id)


def test_prefork_recovers_a_paused_executor_and_rejects_its_late_result(
    postgres: PostgreSQLSandbox, redis_test_url: str, tmp_path: Path
) -> None:
    job_id = make_job(postgres)
    with isolated_worker(postgres, redis_test_url, tmp_path) as worker:
        assert worker.dispatch().published == 1
        old = worker.started(job_id)
        worker.signal(old, signal.SIGSTOP)
        initial = read_job(postgres, job_id)
        assert initial.lease_until is not None
        worker.wait_until_expired(initial.lease_until)
        assert worker.dispatch().published == 1
        new = worker.started(job_id, 2)
        current = read_job(postgres, job_id)
        assert current.run_token != initial.run_token
        old.with_suffix(".release").touch()
        worker.signal(old, signal.SIGCONT)
        worker.wait(
            lambda: worker.broker.hlen(f"{worker.prefix}unacked") == 1,
            "旧执行进程确认消息",
        )
        assert read_job(postgres, job_id).status == "running"
        new.with_suffix(".release").touch()
        complete = worker.wait_for_status(job_id, "succeeded")
        worker.wait_until_consumed()
        assert complete.attempt == 2
        assert complete.result == run_diagnostic(job_id, complete.project_id)


def test_prefork_cancellation_rejects_a_late_result(
    postgres: PostgreSQLSandbox, redis_test_url: str, tmp_path: Path
) -> None:
    job_id = make_job(postgres)
    with isolated_worker(postgres, redis_test_url, tmp_path) as worker:
        assert worker.dispatch().published == 1
        started = worker.started(job_id)
        with postgres.sessions() as session:
            assert cancel_job(session, job_id).status == "cancelled"
        started.with_suffix(".release").touch()
        worker.wait_until_consumed()
        cancelled = read_job(postgres, job_id)
        assert cancelled.status == "cancelled" and cancelled.attempt == 1
        assert cancelled.result is None and cancelled.execution_deadline_at is None


def test_prefork_timeout_and_malformed_result_are_terminal(
    postgres: PostgreSQLSandbox, redis_test_url: str, tmp_path: Path
) -> None:
    timed_out = make_job(postgres)
    with isolated_worker(postgres, redis_test_url, tmp_path, timeout_seconds=3) as worker:
        assert worker.dispatch().published == 1
        started = worker.started(timed_out)
        expired = worker.wait_for_status(timed_out, "failed")
        assert expired.error_code == "JOB_EXECUTION_TIMEOUT" and expired.attempt == 1
        started.with_suffix(".release").touch()
        worker.wait_until_consumed()
        assert read_job(postgres, timed_out).result is None

        malformed = make_job(postgres)
        (tmp_path / f"{malformed}.invalid").touch()
        assert worker.dispatch().published == 1
        invalid = worker.started(malformed)
        invalid.with_suffix(".release").touch()
        failed = worker.wait_for_status(malformed, "failed")
        worker.wait_until_consumed()
        assert failed.error_code == "JOB_RESULT_INVALID" and failed.result is None


def test_prefork_child_exit_exhausts_the_recovery_budget(
    postgres: PostgreSQLSandbox, redis_test_url: str, tmp_path: Path
) -> None:
    job_id = make_job(postgres)
    with isolated_worker(postgres, redis_test_url, tmp_path) as worker:
        assert worker.dispatch().published == 1
        for attempt in range(1, 4):
            started = worker.started(job_id, attempt)
            worker.signal(started, signal.SIGKILL)
            lost = read_job(postgres, job_id)
            assert lost.lease_until is not None
            worker.wait_until_expired(lost.lease_until)
            worker.dispatch()
        failed = worker.wait_for_status(job_id, "failed")
        worker.publish(job_id)
        worker.wait_until_consumed()
        assert len(worker.starts(job_id)) == failed.attempt == 3
        assert failed.error_code == "JOB_ATTEMPTS_EXHAUSTED" and failed.result is None
