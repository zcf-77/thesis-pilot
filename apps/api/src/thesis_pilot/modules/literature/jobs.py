"""Worker side of literature search: claim, call the source outside any transaction, then
store snapshot + artifact + terminal Job state atomically under the same run token.

A cancelled, expired or superseded run stores nothing, so a late source response can
never overwrite a newer search or a cancellation.
"""

from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.models import Job, JobArtifact, JobAttempt
from thesis_pilot.modules.jobs.service import (
    JobClaim,
    _current_execution,
    _database_now,
    _end_execution,
    _expiration_error,
    _finish_attempt,
    _lease_expired,
)
from thesis_pilot.modules.literature import sources
from thesis_pilot.modules.literature.contracts import (
    ADAPTER_VERSION,
    LITERATURE_JOB_KIND,
    LiteratureSearchInput,
    LiteratureSearchJobResult,
)
from thesis_pilot.modules.literature.service import search_for_job, store_snapshot_in_transaction

# Codes a failed search may expose; everything else collapses to JOB_EXECUTION_FAILED.
LITERATURE_FAILURE_CODES = frozenset(
    {
        "LITERATURE_SOURCE_TIMEOUT",
        "LITERATURE_SOURCE_UNAVAILABLE",
        "LITERATURE_SOURCE_RATE_LIMITED",
        "LITERATURE_SOURCE_INVALID",
        "JOB_INPUT_INVALID",
        "JOB_RESULT_INVALID",
    }
)


def claim_literature_in_transaction(
    session: Session,
    job: Job,
    lease_seconds: int,
    execution_timeout_seconds: int,
    max_attempts: int,
    now: datetime | None,
) -> JobClaim | None:
    instant = _database_now(session, now)
    error_code = _expiration_error(job, instant, max_attempts)
    if error_code is not None:
        _end_execution(session, job, instant, status="failed", error_code=error_code)
        return None
    if job.status == "running" and not _lease_expired(job, instant):
        return None
    try:
        search = search_for_job(session, job)
    except AppError:
        _end_execution(session, job, instant, status="failed", error_code="JOB_INPUT_INVALID")
        return None
    if job.status == "running":
        _finish_attempt(session, job, instant, "lease_expired")
    instant = _database_now(session, now)
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
        job.id,
        job.project_id,
        token,
        kind="literature_search",
        literature_input=LiteratureSearchInput(search_id=search.id),
    )


def _load(
    factory: sessionmaker[Session], claim: JobClaim
) -> tuple[str, sources.SearchParams] | None:
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, None)
        if execution is None:
            return None
        search = search_for_job(session, execution[0])
        if claim.literature_input is None or claim.literature_input.search_id != search.id:
            raise AppError("JOB_INPUT_INVALID", "检索任务固定输入无效。", 422)
        return search.source, sources.SearchParams(
            query=search.query,
            rows=search.row_limit,
            year_from=search.year_from,
            year_to=search.year_to,
        )


def _fail(factory: sessionmaker[Session], claim: JobClaim, code: str) -> bool:
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, None)
        if execution is None:
            return False
        job, instant, _ = execution
        _end_execution(
            session,
            job,
            instant,
            status="failed",
            error_code=code if code in LITERATURE_FAILURE_CODES else "JOB_EXECUTION_FAILED",
        )
        return True


def finish_literature_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    response: sources.SearchResponse,
    *,
    now: datetime | None = None,
) -> bool:
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, now)
        if execution is None:
            return False
        job, instant, _ = execution
        attempt = session.scalar(
            select(JobAttempt).where(
                JobAttempt.job_id == job.id, JobAttempt.run_token == claim.run_token
            )
        )
        try:
            search = search_for_job(session, job)
            if attempt is None or claim.literature_input is None:
                raise AppError("JOB_RESULT_INVALID", "检索任务执行记录缺失。", 422)
            if claim.literature_input.search_id != search.id:
                raise AppError("JOB_INPUT_INVALID", "检索任务固定输入无效。", 422)
            snapshot = store_snapshot_in_transaction(session, job, search, response, instant)
        except AppError as failure:
            _end_execution(session, job, instant, status="failed", error_code=failure.code)
            return True
        assert attempt is not None
        result = LiteratureSearchJobResult.model_validate(
            {
                "kind": LITERATURE_JOB_KIND,
                "schema_version": 1,
                "job_id": str(job.id),
                "project_id": str(job.project_id),
                "search_id": str(search.id),
                "snapshot_id": str(snapshot.id),
                "source": search.source,
                "adapter_version": ADAPTER_VERSION,
                "item_count": len(response.items),
                "response_sha256": response.response_sha256,
                "model_used": False,
                "writes_performed": False,
            }
        )
        session.add(
            JobArtifact(
                job_id=job.id,
                attempt_id=attempt.id,
                kind=LITERATURE_JOB_KIND,
                schema_version=1,
                result=result.model_dump(mode="json"),
                created_at=instant,
            )
        )
        _end_execution(session, job, instant, status="succeeded", result=result)
        return True


def run_literature_job(factory: sessionmaker[Session], claim: JobClaim) -> bool:
    try:
        loaded = _load(factory, claim)
        if loaded is None:
            return False
        source, params = loaded
        response = sources.search(source, params)  # type: ignore[arg-type]
    except sources.SourceError as failure:
        return _fail(factory, claim, failure.code)
    except AppError as failure:
        return _fail(factory, claim, failure.code)
    except Exception:
        return _fail(factory, claim, "JOB_EXECUTION_FAILED")
    return finish_literature_job(factory, claim, response)
