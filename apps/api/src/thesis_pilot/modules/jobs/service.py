"""Database truth for jobs; no model or message broker owns job state."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
from uuid import UUID, uuid4

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.models import Job, OutboxEvent, utcnow
from thesis_pilot.modules.jobs.schemas import JobCreate
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
            .values(status="cancelled", run_token=None, lease_until=None, updated_at=utcnow())
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


def _expire_exhausted(
    session: Session, instant: datetime, max_attempts: int, job_id: UUID | None = None
) -> None:
    command = update(Job).where(
        Job.attempt >= max_attempts,
        or_(
            Job.status == "queued",
            and_(Job.status == "running", Job.lease_until <= instant),
        ),
    )
    if job_id is not None:
        command = command.where(Job.id == job_id)
    session.execute(
        command.values(
            status="failed",
            error_code="JOB_ATTEMPTS_EXHAUSTED",
            result=None,
            run_token=None,
            lease_until=None,
            updated_at=instant,
        )
    )


def claim_job(
    factory: sessionmaker[Session],
    job_id: UUID,
    lease_seconds: int,
    *,
    now: datetime | None = None,
    max_attempts: int = MAX_JOB_ATTEMPTS,
) -> JobClaim | None:
    if lease_seconds < 1 or max_attempts < 1:
        raise ValueError("invalid execution limits")
    instant = now or utcnow()
    token = uuid4()
    with factory() as session, session.begin():
        _expire_exhausted(session, instant, max_attempts, job_id)
        row = session.execute(
            update(Job)
            .where(
                Job.id == job_id,
                Job.attempt < max_attempts,
                or_(
                    Job.status == "queued",
                    and_(Job.status == "running", Job.lease_until <= instant),
                ),
            )
            .values(
                status="running",
                run_token=token,
                lease_until=instant + timedelta(seconds=lease_seconds),
                attempt=Job.attempt + 1,
                updated_at=instant,
                error_code=None,
            )
            .returning(Job.project_id)
        ).one_or_none()
        if row is None:
            return None
        return JobClaim(job_id, row[0], token)


def finish_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    *,
    result: dict[str, object] | None = None,
    failed: bool = False,
    now: datetime | None = None,
) -> bool:
    instant = now or utcnow()
    with factory() as session, session.begin():
        completed = session.execute(
            update(Job)
            .where(
                Job.id == claim.job_id,
                Job.status == "running",
                Job.run_token == claim.run_token,
                Job.lease_until > instant,
            )
            .values(
                status="failed" if failed else "succeeded",
                result=None if failed else result,
                error_code="JOB_EXECUTION_FAILED" if failed else None,
                run_token=None,
                lease_until=None,
                updated_at=instant,
            )
            .returning(Job.id)
        ).one_or_none()
        return completed is not None


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
    instant = now or utcnow()
    published = failed = 0
    with factory() as session, session.begin():
        _expire_exhausted(session, instant, max_attempts)
        events = session.scalars(
            select(OutboxEvent)
            .join(Job, Job.id == OutboxEvent.job_id)
            .where(
                OutboxEvent.next_attempt_at <= instant,
                Job.status.in_(("queued", "running")),
                or_(
                    OutboxEvent.published_at.is_(None),
                    and_(
                        Job.status == "queued",
                        OutboxEvent.published_at <= instant - timedelta(seconds=redelivery_seconds),
                    ),
                    and_(Job.status == "running", Job.lease_until <= instant),
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
