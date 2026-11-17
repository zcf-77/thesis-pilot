"""Worker side of feedback decomposition: claim, call the model outside any transaction,
then verify and store suggestions + artifact + terminal state atomically under the run token.

Reuses the jobs module's lease/attempt primitives so cancellation, deadlines, lease expiry and
late replies behave like every other job kind: a cancelled or superseded run stores nothing.
"""

from datetime import datetime, timedelta
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.feedback_splits.contracts import (
    FEEDBACK_SPLIT_KIND,
    FeedbackSplitInput,
    FeedbackSplitResult,
)
from thesis_pilot.modules.feedback_splits.schemas import SplitCompletion
from thesis_pilot.modules.feedback_splits.service import (
    commit_suggestions_in_transaction,
    lineage_attempts,
    load_snapshot_in_transaction,
    split_for_job,
)
from thesis_pilot.modules.feedback_splits.workflow import SPLIT_ROLE, run_feedback_split
from thesis_pilot.modules.jobs.models import Job, JobArtifact, JobAttempt
from thesis_pilot.modules.jobs.schemas import ConfigurationProbeConfiguration
from thesis_pilot.modules.jobs.service import (
    JobClaim,
    _current_execution,
    _database_now,
    _end_execution,
    _expiration_error,
    _finish_attempt,
    _lease_expired,
    _probe_rate_available,
    _timed_out,
)
from thesis_pilot.providers.deepseek import MODEL_ERROR_CODES, DeepSeekError

# Codes a failed split may expose; everything else collapses to JOB_EXECUTION_FAILED.
SPLIT_FAILURE_CODES = MODEL_ERROR_CODES | {
    "FEEDBACK_SPLIT_RANGE_INVALID",
    "FEEDBACK_SPLIT_RANGE_OVERLAP",
    "FEEDBACK_SPLIT_SOURCE_CHANGED",
    "JOB_INPUT_INVALID",
    "JOB_RESULT_INVALID",
}


def claim_split_in_transaction(
    session: Session,
    job: Job,
    lease_seconds: int,
    execution_timeout_seconds: int,
    max_attempts: int,
    now: datetime | None,
) -> JobClaim | None:
    instant = _database_now(session, now)
    try:
        run = split_for_job(session, job)
        configuration = ConfigurationProbeConfiguration.model_validate(run.configuration_snapshot)
        if (
            configuration.api is None
            or configuration.agent is None
            or configuration.agent.role != SPLIT_ROLE
        ):
            raise ValueError("Invalid fixed split configuration")
    except (AppError, ValidationError, ValueError):
        _end_execution(session, job, instant, status="failed", error_code="JOB_INPUT_INVALID")
        return None
    attempts = min(max_attempts, configuration.api.max_retries + 1)
    error_code = _expiration_error(job, instant, attempts)
    if error_code is not None:
        _end_execution(session, job, instant, status="failed", error_code=error_code)
        return None
    if job.status == "running" and not _lease_expired(job, instant):
        return None
    # Redelivery and explicit retries share one fixed provider call budget.
    try:
        used = lineage_attempts(session, run)
    except AppError:
        _end_execution(session, job, instant, status="failed", error_code="JOB_INPUT_INVALID")
        return None
    if used >= configuration.api.max_retries + 1:
        _end_execution(session, job, instant, status="failed", error_code="JOB_ATTEMPTS_EXHAUSTED")
        return None
    if not _probe_rate_available(session, configuration, instant):
        _end_execution(session, job, instant, status="failed", error_code="MODEL_RATE_LIMITED")
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
        kind="feedback_decomposition",
        feedback_split_input=FeedbackSplitInput(split_id=run.id),
    )


def load_split_snapshot(
    factory: sessionmaker[Session], claim: JobClaim
) -> dict[str, object] | None:
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, None)
        if execution is None:
            return None
        if claim.kind != FEEDBACK_SPLIT_KIND or claim.feedback_split_input is None:
            raise AppError("JOB_INPUT_INVALID", "拆解执行标识无效。", 422)
        return load_snapshot_in_transaction(
            session, execution[0], claim.feedback_split_input.split_id
        )


def fail_split(factory: sessionmaker[Session], claim: JobClaim, code: str) -> bool:
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
            error_code=code if code in SPLIT_FAILURE_CODES else "JOB_EXECUTION_FAILED",
        )
        return True


class _LeaseLost(Exception):
    pass


def finish_split(
    factory: sessionmaker[Session],
    claim: JobClaim,
    completion: SplitCompletion,
    *,
    now: datetime | None = None,
) -> bool:
    """A cancelled, expired or superseded run returns False and stores no suggestion."""
    try:
        return _finish_split(factory, claim, completion, now=now)
    except _LeaseLost:
        return fail_split(factory, claim, "JOB_EXECUTION_FAILED")
    except AppError as failure:
        return fail_split(factory, claim, failure.code)


def _finish_split(
    factory: sessionmaker[Session],
    claim: JobClaim,
    completion: SplitCompletion,
    *,
    now: datetime | None,
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
        source = claim.feedback_split_input
        if attempt is None or claim.kind != FEEDBACK_SPLIT_KIND or source is None:
            _end_execution(session, job, instant, status="failed", error_code="JOB_RESULT_INVALID")
            return True
        try:
            run, count, note = commit_suggestions_in_transaction(
                session, job, source.split_id, completion
            )
        except AppError as failure:
            if failure.code not in SPLIT_FAILURE_CODES:
                raise
            # A reply that fails verification never becomes a suggestion; nothing was added.
            _end_execution(session, job, instant, status="failed", error_code=failure.code)
            return True
        final_time = _database_now(session, now)
        if (
            job.status != "running"
            or job.run_token != claim.run_token
            or job.execution_deadline_at is None
            or _timed_out(job, final_time)
            or job.lease_until is None
            or _lease_expired(job, final_time)
        ):
            # Roll back the provisional suggestions; a late reply cannot become history.
            raise _LeaseLost
        result = FeedbackSplitResult.model_validate(
            {
                "kind": FEEDBACK_SPLIT_KIND,
                "schema_version": 1,
                "job_id": str(job.id),
                "project_id": str(job.project_id),
                "split_id": str(run.id),
                "batch_id": str(run.batch_id),
                "suggestion_count": count,
                "requested_model": completion.requested_model,
                "response_model": completion.response_model,
                "note": note,
                "model_used": True,
                "writes_performed": False,
            }
        )
        session.add(
            JobArtifact(
                job_id=job.id,
                attempt_id=attempt.id,
                kind=FEEDBACK_SPLIT_KIND,
                schema_version=1,
                result=result.model_dump(mode="json"),
                created_at=final_time,
            )
        )
        _end_execution(session, job, final_time, status="succeeded", result=result)
        return True


def run_split_job(factory: sessionmaker[Session], claim: JobClaim) -> bool:
    try:
        snapshot = load_split_snapshot(factory, claim)
        if snapshot is None:
            return False
        completion = run_feedback_split(snapshot)
    except DeepSeekError as failure:
        return fail_split(factory, claim, failure.code)
    except AppError as failure:
        return fail_split(factory, claim, failure.code)
    except Exception:
        return fail_split(factory, claim, "JOB_EXECUTION_FAILED")
    return finish_split(factory, claim, completion)
