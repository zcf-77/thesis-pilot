"""Database truth for jobs; no model or message broker owns job state."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Literal
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.config import DEFAULT_WORKER_EXECUTION_TIMEOUT_SECONDS
from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.models import Job, OutboxEvent, utcnow
from thesis_pilot.modules.jobs.schemas import (
    DiagnosticResult,
    JobCreate,
    JobPage,
    JobRead,
    JobStatus,
)
from thesis_pilot.modules.projects.models import Project

Publisher = Callable[[UUID], None]
MAX_JOB_ATTEMPTS = 3


def _match_request(job: Job, request_hash: str) -> Job:
    if job.request_hash != request_hash:
        raise AppError("JOB_IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求，请使用新键。", 409)
    return job


def create_job(session: Session, request: JobCreate, idempotency_key: str) -> Job:
    digest = sha256(f"{request.kind}:{request.project_id}".encode()).hexdigest()
    try:
        with session.begin():
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is not None:
                return _match_request(existing, digest)
            if session.get(Project, request.project_id) is None:
                raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
            job = Job(
                project_id=request.project_id,
                kind=request.kind,
                idempotency_key=idempotency_key,
                request_hash=digest,
            )
            session.add(job)
            session.flush()
            session.add(OutboxEvent(job_id=job.id))
            session.flush()
        return job
    except IntegrityError:
        # A concurrent request may have committed the same key after our first read.
        with session.begin():
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is not None:
                return _match_request(existing, digest)
        raise


def list_jobs(
    session: Session,
    project_id: UUID,
    *,
    limit: int,
    offset: int,
    statuses: list[JobStatus] | None = None,
) -> JobPage:
    with session.begin():
        if session.get(Project, project_id) is None:
            raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
        conditions = [Job.project_id == project_id]
        if statuses:
            conditions.append(Job.status.in_(set(statuses)))
        total = session.scalar(select(func.count()).select_from(Job).where(*conditions)) or 0
        jobs = session.scalars(
            select(Job)
            .where(*conditions)
            .order_by(Job.created_at.desc(), Job.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return JobPage(
            items=[JobRead.model_validate(job) for job in jobs],
            total=total,
            limit=limit,
            offset=offset,
        )


def get_job(session: Session, job_id: UUID) -> Job:
    job = session.get(Job, job_id)
    if job is None:
        raise AppError("JOB_NOT_FOUND", "任务不存在。", 404)
    return job


def cancel_job(session: Session, job_id: UUID) -> Job:
    with session.begin():
        session.execute(
            update(Job)
            .where(Job.id == job_id, Job.status.in_(("queued", "running")))
            .values(
                status="cancelled",
                run_token=None,
                lease_until=None,
                execution_deadline_at=None,
                updated_at=utcnow(),
            )
        )
        job = get_job(session, job_id)
        if job.status != "cancelled":
            raise AppError("JOB_STATE_CONFLICT", "任务已经结束，不能取消。", 409)
    return job


@dataclass(frozen=True)
class JobClaim:
    job_id: UUID
    project_id: UUID
    run_token: UUID


def _as_utc(value: datetime) -> datetime:
    # SQLite fast tests store UTC timestamps without timezone metadata.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _database_now(session: Session, now: datetime | None) -> datetime:
    if now is not None:
        return _as_utc(now)
    if session.get_bind().dialect.name == "sqlite":
        return utcnow()
    # PostgreSQL's now() is fixed at transaction start, before a lock wait.
    instant: datetime = session.execute(select(func.clock_timestamp())).scalar_one()
    return _as_utc(instant)


def _lock_job(session: Session, job_id: UUID) -> Job | None:
    return session.scalar(select(Job).where(Job.id == job_id).with_for_update())


def _lease_expired(job: Job, instant: datetime) -> bool:
    return job.lease_until is not None and _as_utc(job.lease_until) <= instant


def _timed_out(job: Job, instant: datetime) -> bool:
    deadline = job.execution_deadline_at
    lease = job.lease_until
    # A heartbeat that stopped before the deadline leaves an earlier lease bound.
    return (
        deadline is not None
        and lease is not None
        and _as_utc(deadline) <= instant
        and _as_utc(lease) >= _as_utc(deadline)
    )


def _expiration_error(job: Job, instant: datetime, max_attempts: int) -> str | None:
    if job.status == "running" and _timed_out(job, instant):
        return "JOB_EXECUTION_TIMEOUT"
    if job.attempt >= max_attempts and (
        job.status == "queued" or (job.status == "running" and _lease_expired(job, instant))
    ):
        return "JOB_ATTEMPTS_EXHAUSTED"
    return None


def _end_execution(
    job: Job,
    instant: datetime,
    *,
    status: Literal["succeeded", "failed"],
    result: DiagnosticResult | None = None,
    error_code: str | None = None,
) -> None:
    job.status = status
    job.result = result.model_dump(mode="json") if result is not None else None
    job.error_code = error_code
    job.run_token = None
    job.lease_until = None
    job.execution_deadline_at = None
    job.updated_at = instant


def claim_job(
    factory: sessionmaker[Session],
    job_id: UUID,
    lease_seconds: int,
    *,
    execution_timeout_seconds: int = DEFAULT_WORKER_EXECUTION_TIMEOUT_SECONDS,
    now: datetime | None = None,
    max_attempts: int = MAX_JOB_ATTEMPTS,
) -> JobClaim | None:
    if lease_seconds < 1 or execution_timeout_seconds < 1 or max_attempts < 1:
        raise ValueError("invalid execution limits")
    with factory() as session, session.begin():
        job = _lock_job(session, job_id)
        if job is None or job.status not in ("queued", "running"):
            return None
        instant = _database_now(session, now)
        error_code = _expiration_error(job, instant, max_attempts)
        if error_code is not None:
            _end_execution(job, instant, status="failed", error_code=error_code)
            return None
        if job.status == "running" and not _lease_expired(job, instant):
            return None
        token = uuid4()
        deadline = instant + timedelta(seconds=execution_timeout_seconds)
        job.status = "running"
        job.run_token = token
        job.lease_until = min(instant + timedelta(seconds=lease_seconds), deadline)
        job.execution_deadline_at = deadline
        job.attempt += 1
        job.updated_at = instant
        job.error_code = None
        return JobClaim(job_id, job.project_id, token)


def _current_execution(
    session: Session, claim: JobClaim, now: datetime | None
) -> tuple[Job, datetime, datetime] | None:
    job = _lock_job(session, claim.job_id)
    if job is None or job.status != "running" or job.run_token != claim.run_token:
        return None
    instant = _database_now(session, now)
    if _timed_out(job, instant):
        _end_execution(job, instant, status="failed", error_code="JOB_EXECUTION_TIMEOUT")
        return None
    deadline = job.execution_deadline_at
    if deadline is None or job.lease_until is None or _lease_expired(job, instant):
        return None
    return job, instant, _as_utc(deadline)


def renew_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    lease_seconds: int,
    *,
    now: datetime | None = None,
) -> bool:
    if lease_seconds < 1:
        raise ValueError("invalid lease duration")
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, now)
        if execution is None:
            return False
        job, instant, deadline = execution
        job.lease_until = min(instant + timedelta(seconds=lease_seconds), deadline)
        return True


def finish_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    *,
    result: object = None,
    failed: bool = False,
    now: datetime | None = None,
) -> bool:
    validated = None
    if not failed and isinstance(result, dict):
        try:
            validated = DiagnosticResult.model_validate(result)
        except ValidationError:
            # Validation errors can contain the runner's raw data.
            validated = None
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, now)
        if execution is None:
            return False
        job, instant, _ = execution
        if failed:
            _end_execution(job, instant, status="failed", error_code="JOB_EXECUTION_FAILED")
        elif (
            validated is None
            or validated.job_id != job.id
            or validated.project_id != job.project_id
        ):
            _end_execution(job, instant, status="failed", error_code="JOB_RESULT_INVALID")
        else:
            _end_execution(job, instant, status="succeeded", result=validated)
        return True


def _close_expired_jobs(
    factory: sessionmaker[Session], batch_size: int, now: datetime | None, max_attempts: int
) -> None:
    with factory() as session, session.begin():
        scan_at = _database_now(session, now)
        expired_jobs = session.scalars(
            select(Job)
            .where(
                or_(
                    and_(Job.status == "queued", Job.attempt >= max_attempts),
                    and_(
                        Job.status == "running",
                        Job.lease_until <= scan_at,
                        or_(
                            Job.lease_until >= Job.execution_deadline_at,
                            Job.attempt >= max_attempts,
                        ),
                    ),
                )
            )
            .order_by(Job.updated_at, Job.id)
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        ).all()
        if not expired_jobs:
            return
        instant = _database_now(session, now)
        for job in expired_jobs:
            error_code = _expiration_error(job, instant, max_attempts)
            if error_code is not None:
                _end_execution(job, instant, status="failed", error_code=error_code)


@dataclass(frozen=True)
class DispatchResult:
    published: int
    failed: int


def dispatch_pending(
    factory: sessionmaker[Session],
    publish: Publisher,
    *,
    batch_size: int = 20,
    redelivery_seconds: int = 120,
    now: datetime | None = None,
    max_attempts: int = MAX_JOB_ATTEMPTS,
) -> DispatchResult:
    """At-least-once dispatch. Duplicate messages are harmless under claim/token checks.

    Locks are held only for a bounded batch and publish must have a transport timeout.
    A crash after broker acceptance but before commit intentionally permits redelivery.
    Expired running leases and queued messages missing at the broker are republished.
    """
    if not 1 <= batch_size <= 100 or redelivery_seconds < 1 or max_attempts < 1:
        raise ValueError("invalid dispatch limits")
    _close_expired_jobs(factory, batch_size, now, max_attempts)
    published = failed = 0
    with factory() as session, session.begin():
        instant = _database_now(session, now)
        events = session.scalars(
            select(OutboxEvent)
            .join(Job, Job.id == OutboxEvent.job_id)
            .where(
                Job.attempt < max_attempts,
                or_(
                    and_(
                        Job.status == "queued",
                        OutboxEvent.next_attempt_at <= instant,
                        or_(
                            OutboxEvent.published_at.is_(None),
                            OutboxEvent.published_at
                            <= instant - timedelta(seconds=redelivery_seconds),
                        ),
                    ),
                    and_(
                        Job.status == "running",
                        Job.lease_until <= instant,
                        or_(
                            Job.execution_deadline_at.is_(None),
                            Job.lease_until < Job.execution_deadline_at,
                        ),
                        or_(
                            OutboxEvent.next_attempt_at <= instant,
                            # Recover a lost lease immediately once, while preserving
                            # backoff after a failed recovery publication.
                            and_(
                                OutboxEvent.last_error_code.is_(None),
                                OutboxEvent.published_at < Job.lease_until,
                            ),
                        ),
                    ),
                ),
            )
            .order_by(OutboxEvent.created_at, OutboxEvent.id)
            .limit(batch_size)
            .with_for_update(skip_locked=True, of=OutboxEvent)
        ).all()
        for event in events:
            event.attempts += 1
            try:
                publish(event.job_id)
            except Exception:
                # Broker exceptions may contain credentials. Persist only a stable code.
                event.last_error_code = "JOB_DISPATCH_FAILED"
                event.next_attempt_at = instant + timedelta(
                    seconds=min(60, 2 ** min(event.attempts, 6))
                )
                failed += 1
            else:
                event.published_at = instant
                event.next_attempt_at = instant + timedelta(seconds=redelivery_seconds)
                event.last_error_code = None
                published += 1
    return DispatchResult(published, failed)
