"""Database truth for jobs; no model or message broker owns job state."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Literal
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy import and_, func, or_, select, true, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased, joinedload, sessionmaker

from thesis_pilot.core.config import DEFAULT_WORKER_EXECUTION_TIMEOUT_SECONDS
from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.structure import JsonObject
from thesis_pilot.modules.jobs.models import Job, JobArtifact, JobAttempt, OutboxEvent, utcnow
from thesis_pilot.modules.jobs.schemas import (
    DiagnosticResult,
    InspectionConfiguration,
    InspectionInput,
    InspectionResult,
    JobCreate,
    JobKind,
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


def _request_digest(request: JobCreate, source_job_id: UUID | None = None) -> str:
    if request.kind == "diagnostic" and source_job_id is None:
        # Keep previously persisted idempotency keys valid across this upgrade.
        return sha256(f"{request.kind}:{request.project_id}".encode()).hexdigest()
    payload = request.model_dump(mode="json")
    payload["source_job_id"] = str(source_job_id) if source_job_id else None
    return sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _document_version(
    session: Session, project_id: UUID, source: InspectionInput
) -> DocumentVersion:
    document = session.get(Document, source.document_id)
    if document is None or document.project_id != project_id:
        raise AppError("DOCUMENT_NOT_FOUND", "项目中没有指定正式稿。", 404)
    version = session.get(DocumentVersion, (source.document_id, source.document_version))
    if version is None:
        raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正式稿版本不存在。", 404)
    return version


def _insert_job(
    session: Session,
    request: JobCreate,
    idempotency_key: str,
    digest: str,
    source_job_id: UUID | None = None,
) -> Job:
    if session.get(Project, request.project_id) is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
    source = request.input_snapshot
    if source is not None:
        document_id = session.scalar(
            select(Document.id).where(
                Document.id == source.document_id, Document.project_id == request.project_id
            )
        )
        if document_id is None:
            raise AppError("DOCUMENT_NOT_FOUND", "项目中没有指定正式稿。", 404)
        version = session.scalar(
            select(DocumentVersion.version).where(
                DocumentVersion.document_id == source.document_id,
                DocumentVersion.version == source.document_version,
            )
        )
        if version is None:
            raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正式稿版本不存在。", 404)
    job = Job(
        project_id=request.project_id,
        kind=request.kind,
        idempotency_key=idempotency_key,
        request_hash=digest,
        input_snapshot=source.model_dump(mode="json") if source else None,
        configuration=request.configuration.model_dump(mode="json")
        if request.configuration
        else None,
        resource_scope=source.model_dump(mode="json") if source else None,
        source_job_id=source_job_id,
    )
    session.add(job)
    session.flush()
    session.add(OutboxEvent(job_id=job.id))
    session.flush()
    return job


def create_job(
    session: Session, request: JobCreate, idempotency_key: str, *, include_diagnostic: bool = True
) -> Job:
    if not include_diagnostic and request.kind == "diagnostic":
        raise AppError("JOB_KIND_UNAVAILABLE", "此任务类型不在正式工作区提供。", 422)
    digest = _request_digest(request)
    try:
        with session.begin():
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is not None:
                return _match_request(existing, digest)
            job = _insert_job(session, request, idempotency_key, digest)
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
    kind: JobKind | None = None,
    include_diagnostic: bool = True,
) -> JobPage:
    with session.begin():
        if session.get(Project, project_id) is None:
            raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
        conditions = [Job.project_id == project_id]
        if not include_diagnostic:
            conditions.append(Job.kind != "diagnostic")
        if kind is not None:
            conditions.append(Job.kind == kind)
        if statuses:
            conditions.append(Job.status.in_(set(statuses)))
        totals = (
            select(func.count().label("total")).select_from(Job).where(*conditions).cte("totals")
        )
        page = (
            select(Job)
            .where(*conditions)
            .order_by(Job.created_at.desc(), Job.id.desc())
            .limit(limit)
            .offset(offset)
        ).subquery("page")
        page_job = aliased(Job, page)
        rows = session.execute(
            select(totals.c.total, page_job)
            .select_from(totals.outerjoin(page, true()))
            .order_by(page_job.created_at.desc(), page_job.id.desc())
        ).all()
        return JobPage(
            items=[JobRead.model_validate(row[1]) for row in rows if row[1] is not None],
            total=rows[0][0],
            limit=limit,
            offset=offset,
        )


def get_job(
    session: Session,
    job_id: UUID,
    *,
    include_diagnostic: bool = True,
    project_id: UUID | None = None,
) -> Job:
    job = session.get(Job, job_id)
    if (
        job is None
        or (not include_diagnostic and job.kind == "diagnostic")
        or (project_id is not None and job.project_id != project_id)
    ):
        raise AppError("JOB_NOT_FOUND", "任务不存在。", 404)
    return job


def get_job_detail(
    session: Session,
    job_id: UUID,
    *,
    include_diagnostic: bool = True,
    project_id: UUID | None = None,
) -> Job:
    conditions = [Job.id == job_id]
    if not include_diagnostic:
        conditions.append(Job.kind != "diagnostic")
    if project_id is not None:
        conditions.append(Job.project_id == project_id)
    job = (
        session.execute(
            select(Job)
            .options(joinedload(Job.attempts), joinedload(Job.artifacts))
            .where(*conditions)
        )
        .unique()
        .scalar_one_or_none()
    )
    if job is None:
        raise AppError("JOB_NOT_FOUND", "任务不存在。", 404)
    return job


def cancel_job(
    session: Session,
    job_id: UUID,
    *,
    include_diagnostic: bool = True,
    project_id: UUID | None = None,
) -> Job:
    with session.begin():
        conditions = [Job.id == job_id, Job.status.in_(("queued", "running"))]
        if not include_diagnostic:
            conditions.append(Job.kind != "diagnostic")
        if project_id is not None:
            conditions.append(Job.project_id == project_id)
        instant = utcnow()
        session.execute(
            update(Job)
            .where(*conditions)
            .values(
                status="cancelled",
                run_token=None,
                lease_until=None,
                execution_deadline_at=None,
                updated_at=instant,
            )
        )
        job = get_job(session, job_id, include_diagnostic=include_diagnostic, project_id=project_id)
        if job.status != "cancelled":
            raise AppError("JOB_STATE_CONFLICT", "任务已经结束，不能取消。", 409)
        session.execute(
            update(JobAttempt)
            .where(JobAttempt.job_id == job_id, JobAttempt.status == "running")
            .values(status="cancelled", finished_at=instant)
        )
    return job


def retry_job(
    session: Session,
    job_id: UUID,
    idempotency_key: str,
    *,
    include_diagnostic: bool = True,
    project_id: UUID | None = None,
) -> Job:
    digest = ""
    try:
        with session.begin():
            original = _lock_job(session, job_id)
            if (
                original is None
                or (not include_diagnostic and original.kind == "diagnostic")
                or (project_id is not None and original.project_id != project_id)
            ):
                raise AppError("JOB_NOT_FOUND", "任务不存在。", 404)
            request = JobCreate.model_validate(
                {
                    "project_id": original.project_id,
                    "kind": original.kind,
                    "input_snapshot": original.input_snapshot,
                    "configuration": original.configuration,
                }
            )
            digest = _request_digest(request, job_id)
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is not None:
                return _match_request(existing, digest)
            if original.status not in ("succeeded", "failed", "cancelled"):
                raise AppError("JOB_STATE_CONFLICT", "请等待任务结束或取消后再重新运行。", 409)
            return _insert_job(session, request, idempotency_key, digest, job_id)
    except IntegrityError:
        with session.begin():
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is not None:
                return _match_request(existing, digest)
        raise


@dataclass(frozen=True)
class JobClaim:
    job_id: UUID
    project_id: UUID
    run_token: UUID
    kind: JobKind = "diagnostic"
    input_snapshot: InspectionInput | None = None
    configuration: InspectionConfiguration | None = None
    resource_scope: InspectionInput | None = None


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


def _finish_attempt(
    session: Session, job: Job, instant: datetime, status: str, error_code: str | None = None
) -> JobAttempt | None:
    attempt = session.scalar(
        select(JobAttempt).where(JobAttempt.job_id == job.id, JobAttempt.run_token == job.run_token)
    )
    if attempt is not None:
        attempt.status = status
        attempt.error_code = error_code
        attempt.finished_at = instant
    return attempt


def _end_execution(
    session: Session,
    job: Job,
    instant: datetime,
    *,
    status: Literal["succeeded", "failed"],
    result: DiagnosticResult | InspectionResult | None = None,
    error_code: str | None = None,
) -> None:
    _finish_attempt(session, job, instant, status, error_code)
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
    expected_kind: JobKind | None = None,
) -> JobClaim | None:
    if lease_seconds < 1 or execution_timeout_seconds < 1 or max_attempts < 1:
        raise ValueError("invalid execution limits")
    with factory() as session, session.begin():
        job = _lock_job(session, job_id)
        if (
            job is None
            or job.status not in ("queued", "running")
            or (expected_kind is not None and job.kind != expected_kind)
        ):
            return None
        instant = _database_now(session, now)
        error_code = _expiration_error(job, instant, max_attempts)
        if error_code is not None:
            _end_execution(session, job, instant, status="failed", error_code=error_code)
            return None
        if job.status == "running" and not _lease_expired(job, instant):
            return None
        if job.status == "running":
            _finish_attempt(session, job, instant, "lease_expired")
        try:
            request = JobCreate.model_validate(
                {
                    "project_id": job.project_id,
                    "kind": job.kind,
                    "input_snapshot": job.input_snapshot,
                    "configuration": job.configuration,
                }
            )
            scope = (
                InspectionInput.model_validate(job.resource_scope) if job.resource_scope else None
            )
            if scope != request.input_snapshot:
                raise ValueError("任务范围与固定输入不一致。")
        except (ValidationError, ValueError):
            _end_execution(session, job, instant, status="failed", error_code="JOB_INPUT_INVALID")
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
        session.add(
            JobAttempt(
                job_id=job.id,
                attempt=job.attempt,
                run_token=token,
                status="running",
                started_at=instant,
            )
        )
        return JobClaim(
            job_id,
            job.project_id,
            token,
            request.kind,
            request.input_snapshot,
            request.configuration,
            scope,
        )


def _current_execution(
    session: Session, claim: JobClaim, now: datetime | None
) -> tuple[Job, datetime, datetime] | None:
    job = _lock_job(session, claim.job_id)
    if job is None or job.status != "running" or job.run_token != claim.run_token:
        return None
    instant = _database_now(session, now)
    if _timed_out(job, instant):
        _end_execution(session, job, instant, status="failed", error_code="JOB_EXECUTION_TIMEOUT")
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


def load_inspection_content(factory: sessionmaker[Session], claim: JobClaim) -> JsonObject | None:
    with factory() as session, session.begin():
        if _current_execution(session, claim, None) is None:
            return None
        if claim.input_snapshot is None or claim.resource_scope != claim.input_snapshot:
            raise AppError("JOB_INPUT_INVALID", "任务固定输入无效。", 422)
        return _document_version(session, claim.project_id, claim.input_snapshot).content_json


def finish_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    *,
    result: object = None,
    failed: bool = False,
    now: datetime | None = None,
) -> bool:
    validated: DiagnosticResult | InspectionResult | None = None
    if not failed and isinstance(result, dict):
        try:
            if claim.kind == "diagnostic":
                validated = DiagnosticResult.model_validate(result)
            elif claim.kind == "document_inspection":
                validated = InspectionResult.model_validate(result)
        except ValidationError:
            # Validation errors can contain the runner's raw data.
            validated = None
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, now)
        if execution is None:
            return False
        job, instant, _ = execution
        if failed:
            _end_execution(
                session, job, instant, status="failed", error_code="JOB_EXECUTION_FAILED"
            )
        elif (
            validated is None
            or validated.job_id != job.id
            or validated.project_id != job.project_id
            or validated.kind != job.kind
            or (
                isinstance(validated, InspectionResult)
                and (
                    claim.input_snapshot is None
                    or claim.configuration is None
                    or validated.document_id != claim.input_snapshot.document_id
                    or validated.document_version != claim.input_snapshot.document_version
                    or (validated.text_characters is not None)
                    != claim.configuration.include_text_statistics
                    or job.input_snapshot != claim.input_snapshot.model_dump(mode="json")
                    or job.resource_scope != claim.input_snapshot.model_dump(mode="json")
                    or job.configuration != claim.configuration.model_dump(mode="json")
                )
            )
        ):
            _end_execution(session, job, instant, status="failed", error_code="JOB_RESULT_INVALID")
        else:
            if isinstance(validated, InspectionResult):
                attempt = session.scalar(
                    select(JobAttempt).where(
                        JobAttempt.job_id == job.id, JobAttempt.run_token == claim.run_token
                    )
                )
                if attempt is None:
                    _end_execution(
                        session, job, instant, status="failed", error_code="JOB_RESULT_INVALID"
                    )
                    return True
                session.add(
                    JobArtifact(
                        job_id=job.id,
                        attempt_id=attempt.id,
                        kind=validated.kind,
                        schema_version=1,
                        result=validated.model_dump(mode="json"),
                        created_at=instant,
                    )
                )
            _end_execution(session, job, instant, status="succeeded", result=validated)
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
                _end_execution(session, job, instant, status="failed", error_code=error_code)


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
