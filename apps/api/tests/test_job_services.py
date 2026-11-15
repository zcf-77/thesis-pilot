"""Job transaction/recovery invariants without an HTTP event-loop dependency."""

import json
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.models import Job, OutboxEvent, utcnow
from thesis_pilot.modules.jobs.schemas import JobCreate, JobRead
from thesis_pilot.modules.jobs.service import (
    cancel_job,
    claim_job,
    create_job,
    dispatch_pending,
    finish_job,
    renew_job,
)
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.workers import execution as tasks
from thesis_pilot.workflows.diagnostic import run_diagnostic


def project(factory: sessionmaker[Session]) -> UUID:
    with factory() as session:
        return create_project(session, ProjectCreate(name="任务底座样例")).id


def job(factory: sessionmaker[Session], project_id: UUID | None = None) -> UUID:
    selected_project = project_id or project(factory)
    with factory() as session:
        return create_job(session, JobCreate(project_id=selected_project), str(uuid4())).id


def read_job(factory: sessionmaker[Session], job_id: UUID) -> dict[str, object]:
    with factory() as session:
        record = session.get(Job, job_id)
        assert record is not None
        return JobRead.model_validate(record).model_dump(mode="json")


def cancel(factory: sessionmaker[Session], job_id: UUID) -> JobRead:
    with factory() as session:
        return JobRead.model_validate(cancel_job(session, job_id))


def test_idempotency_replay_and_conflict_in_service(session_factory: sessionmaker[Session]) -> None:
    first, other = project(session_factory), project(session_factory)
    with session_factory() as session:
        original = create_job(session, JobCreate(project_id=first), "stable-request")
        replay = create_job(session, JobCreate(project_id=first), "stable-request")
        assert replay.id == original.id
        with pytest.raises(AppError) as captured:
            create_job(session, JobCreate(project_id=other), "stable-request")
        assert captured.value.code == "JOB_IDEMPOTENCY_CONFLICT"
        assert captured.value.status_code == 409
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 1
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_job_and_outbox_are_one_transaction(session_factory: sessionmaker[Session]) -> None:
    project_id = project(session_factory)

    def fail_outbox(session: Session, flush_context: object, instances: object) -> None:
        if any(isinstance(item, OutboxEvent) for item in session.new):
            raise RuntimeError("simulated outbox persistence failure")

    with session_factory() as session:
        event.listen(session, "before_flush", fail_outbox)
        with pytest.raises(RuntimeError, match="simulated outbox"):
            create_job(session, JobCreate(project_id=project_id), "rollback-key")
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 0
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 0


def test_dispatch_failure_is_retryable_and_does_not_expose_error(
    session_factory: sessionmaker[Session],
) -> None:
    job_id = job(session_factory)
    instant = utcnow() + timedelta(seconds=1)

    def unavailable(_: UUID) -> None:
        raise RuntimeError("redis://private-password@private-host:6379/0")

    result = dispatch_pending(session_factory, unavailable, now=instant)
    assert result.failed == 1
    with session_factory() as session:
        record = session.scalar(select(OutboxEvent))
        assert record is not None
        assert record.last_error_code == "JOB_DISPATCH_FAILED"
        assert record.published_at is None
        assert session.get(Job, job_id).status == "queued"  # type: ignore[union-attr]
    published: list[UUID] = []
    retry = dispatch_pending(session_factory, published.append, now=instant + timedelta(seconds=3))
    assert retry.published == 1
    assert published == [job_id]
    assert (
        dispatch_pending(
            session_factory, published.append, now=instant + timedelta(seconds=4)
        ).published
        == 0
    )


def test_published_but_unclaimed_message_is_redelivered(
    session_factory: sessionmaker[Session],
) -> None:
    job_id = job(session_factory)
    instant = utcnow() + timedelta(seconds=1)
    published: list[UUID] = []
    dispatch_pending(session_factory, published.append, now=instant, redelivery_seconds=10)
    dispatch_pending(
        session_factory,
        published.append,
        now=instant + timedelta(seconds=11),
        redelivery_seconds=10,
    )
    assert published == [job_id, job_id]
    assert tasks.execute_diagnostic(session_factory, job_id, 60)
    assert not tasks.execute_diagnostic(session_factory, job_id, 60)
    response = read_job(session_factory, job_id)
    assert response["status"] == "succeeded"
    assert response["attempt"] == 1
    assert response["result"]["model_used"] is False


def test_cancel_rejects_late_result_and_duplicate_cancel_is_safe(
    session_factory: sessionmaker[Session],
) -> None:
    job_id = job(session_factory)
    claim = claim_job(session_factory, job_id, 60)
    assert claim is not None
    assert claim_job(session_factory, job_id, 60) is None
    assert cancel(session_factory, job_id).status == "cancelled"
    assert cancel(session_factory, job_id).status == "cancelled"
    assert not finish_job(session_factory, claim, result={"late": True})
    assert claim_job(session_factory, job_id, 60) is None
    response = read_job(session_factory, job_id)
    assert response["status"] == "cancelled"
    assert response["result"] is None


def test_expired_lease_reclaimed_and_old_executor_cannot_finish(
    session_factory: sessionmaker[Session],
) -> None:
    job_id = job(session_factory)
    instant = utcnow()
    old_claim = claim_job(session_factory, job_id, 10, now=instant)
    assert old_claim is not None
    assert not finish_job(
        session_factory, old_claim, result={"expired": True}, now=instant + timedelta(seconds=11)
    )
    new_claim = claim_job(session_factory, job_id, 10, now=instant + timedelta(seconds=11))
    assert new_claim is not None and new_claim.run_token != old_claim.run_token
    assert not finish_job(
        session_factory, old_claim, result={"stale": True}, now=instant + timedelta(seconds=12)
    )
    result = run_diagnostic(new_claim.job_id, new_claim.project_id)
    assert finish_job(
        session_factory, new_claim, result=result, now=instant + timedelta(seconds=12)
    )
    response = read_job(session_factory, job_id)
    assert response["attempt"] == 2
    assert response["result"] == result
    with pytest.raises(AppError) as conflict:
        cancel(session_factory, job_id)
    assert conflict.value.status_code == 409
    assert conflict.value.code == "JOB_STATE_CONFLICT"


def test_cancel_before_dispatch_never_publishes(session_factory: sessionmaker[Session]) -> None:
    job_id = job(session_factory)
    with session_factory() as session:
        cancel_job(session, job_id)
    published: list[UUID] = []
    assert dispatch_pending(session_factory, published.append).published == 0
    assert published == []


@pytest.mark.parametrize("recovery", ["claim", "dispatch"])
def test_repeated_executor_loss_has_a_finite_budget(
    session_factory: sessionmaker[Session], recovery: str
) -> None:
    job_id = job(session_factory)
    instant = utcnow()
    last_claim = None
    for attempt in range(3):
        last_claim = claim_job(
            session_factory, job_id, 10, now=instant + timedelta(seconds=attempt * 11)
        )
        assert last_claim is not None
    exhausted_at = instant + timedelta(seconds=33)
    if recovery == "claim":
        assert claim_job(session_factory, job_id, 10, now=exhausted_at) is None
    else:
        published: list[UUID] = []
        dispatch_pending(session_factory, published.append, now=exhausted_at)
        assert published == []
    assert last_claim is not None
    assert not finish_job(session_factory, last_claim, result={"late": True}, now=exhausted_at)
    response = read_job(session_factory, job_id)
    assert response["status"] == "failed"
    assert response["attempt"] == 3
    assert response["error_code"] == "JOB_ATTEMPTS_EXHAUSTED"
    assert response["result"] is None


def test_dispatch_republishes_expired_running_lease(session_factory: sessionmaker[Session]) -> None:
    job_id = job(session_factory)
    instant = utcnow() + timedelta(seconds=1)
    published: list[UUID] = []
    dispatch_pending(session_factory, published.append, now=instant)
    assert (
        claim_job(session_factory, job_id, 10, now=instant, execution_timeout_seconds=20)
        is not None
    )
    # The original outbox delay is still active and the old business deadline
    # has passed, but the earlier lease expiry makes it recoverable.
    dispatch_pending(session_factory, published.append, now=instant + timedelta(seconds=21))
    dispatch_pending(session_factory, published.append, now=instant + timedelta(seconds=22))
    assert published == [job_id, job_id]
    fresh_claim = claim_job(session_factory, job_id, 10, now=instant + timedelta(seconds=22))
    assert fresh_claim is not None
    assert read_job(session_factory, job_id)["attempt"] == 2


def test_old_running_job_with_only_a_lease_is_recoverable(
    session_factory: sessionmaker[Session],
) -> None:
    job_id = job(session_factory)
    instant = utcnow()
    old = claim_job(session_factory, job_id, 10, now=instant)
    assert old is not None
    with session_factory() as session, session.begin():
        session.execute(update(Job).where(Job.id == job_id).values(execution_deadline_at=None))
    assert claim_job(session_factory, job_id, 10, now=instant + timedelta(seconds=9)) is None
    assert not renew_job(session_factory, old, 10, now=instant + timedelta(seconds=9))
    fresh = claim_job(session_factory, job_id, 10, now=instant + timedelta(seconds=10))
    assert fresh is not None and fresh.run_token != old.run_token


@pytest.mark.parametrize("observer", ["renew", "finish", "claim", "dispatch"])
def test_heartbeat_is_capped_and_timeout_is_terminal(
    session_factory: sessionmaker[Session], observer: str
) -> None:
    job_id = job(session_factory)
    instant = utcnow()
    claim = claim_job(session_factory, job_id, 10, now=instant, execution_timeout_seconds=25)
    assert claim is not None
    for elapsed in (9, 18, 24):
        assert renew_job(session_factory, claim, 10, now=instant + timedelta(seconds=elapsed))
    deadline = instant + timedelta(seconds=25)
    with session_factory() as session:
        record = session.get(Job, job_id)
        assert record is not None
        assert record.lease_until == record.execution_deadline_at == deadline.replace(tzinfo=None)
    result = run_diagnostic(claim.job_id, claim.project_id)
    if observer == "renew":
        assert not renew_job(session_factory, claim, 10, now=deadline)
    elif observer == "finish":
        assert not finish_job(session_factory, claim, result=result, now=deadline)
    elif observer == "claim":
        assert claim_job(session_factory, job_id, 10, now=deadline) is None
    else:

        def unexpected_delivery(_: UUID) -> None:
            pytest.fail("超时任务不应再次派发。")

        assert dispatch_pending(session_factory, unexpected_delivery, now=deadline).published == 0
    assert not finish_job(session_factory, claim, result=result, now=deadline)
    response = read_job(session_factory, job_id)
    assert response["status"] == "failed"
    assert response["error_code"] == "JOB_EXECUTION_TIMEOUT"
    assert response["result"] is None
    assert response["attempt"] == 1


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("", None),
        ("", []),
        ("", {}),
        ("checked", 1),
        ("checked", "true"),
        ("model_used", 0),
        ("model_used", True),
        ("writes_performed", True),
        ("job_id", str(uuid4())),
        ("project_id", str(uuid4())),
        ("message", " "),
        ("extra", "private sample that must not be saved"),
    ],
)
def test_invalid_diagnostic_never_persists_a_result(
    session_factory: sessionmaker[Session], field: str, value: object
) -> None:
    job_id = job(session_factory)
    claim = claim_job(session_factory, job_id, 10)
    assert claim is not None
    result = {**run_diagnostic(claim.job_id, claim.project_id), field: value} if field else value
    assert finish_job(session_factory, claim, result=result)
    response = read_job(session_factory, job_id)
    assert response["status"] == "failed"
    assert response["error_code"] == "JOB_RESULT_INVALID"
    assert response["result"] is None


def test_broker_acceptance_followed_by_db_failure_allows_safe_redelivery(
    session_factory: sessionmaker[Session],
) -> None:
    job_id = job(session_factory)
    instant = utcnow() + timedelta(seconds=1)
    published: list[UUID] = []

    def fail_commit(session: Session) -> None:
        if published:
            raise RuntimeError("simulated transaction commit failure")

    event.listen(session_factory, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="simulated transaction"):
            dispatch_pending(session_factory, published.append, now=instant)
    finally:
        event.remove(session_factory, "before_commit", fail_commit)
    assert published == [job_id]
    with session_factory() as session:
        record = session.scalar(select(OutboxEvent))
        assert record is not None and record.published_at is None
    dispatch_pending(session_factory, published.append, now=instant)
    assert published == [job_id, job_id]
    assert tasks.execute_diagnostic(session_factory, job_id, 60)
    assert not tasks.execute_diagnostic(session_factory, job_id, 60)


def test_execution_failure_records_only_stable_error_code(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    job_id = job(session_factory)

    def fail(*args: object) -> dict[str, object]:
        raise RuntimeError("private manuscript or secret")

    monkeypatch.setattr(tasks, "run_diagnostic", fail)
    assert tasks.execute_diagnostic(session_factory, job_id, 60)
    response = read_job(session_factory, job_id)
    assert response["status"] == "failed"
    assert response["error_code"] == "JOB_EXECUTION_FAILED"
    assert "private" not in json.dumps(response)
