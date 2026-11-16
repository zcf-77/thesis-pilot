"""Worker side of plan adjustment: claim, call the model outside a transaction, then store the
verified proposal, artifact and terminal Job state atomically under the same run token.

Reuses the jobs module's lease/attempt primitives so cancellation, deadlines, lease expiry and
late replies behave exactly like every other job kind. Nothing here writes a task.
"""

from datetime import datetime, timedelta
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.models import Job, JobArtifact, JobAttempt
from thesis_pilot.modules.jobs.schemas import (
    ConfigurationProbeConfiguration,
    PlanAdjustmentInput,
    PlanAdjustmentResult,
)
from thesis_pilot.modules.jobs.service import (
    JobClaim,
    _cancel_in_transaction,
    _current_execution,
    _database_now,
    _end_execution,
    _expiration_error,
    _finish_attempt,
    _lease_expired,
    _lock_job,
    _probe_rate_available,
    _timed_out,
    finish_job,
)
from thesis_pilot.modules.plans.schemas import PlanCompletion
from thesis_pilot.modules.plans.service import (
    adjustment_for_job,
    commit_plan_proposal_in_transaction,
    load_plan_snapshot_in_transaction,
)
from thesis_pilot.providers.deepseek import MODEL_ERROR_CODES, DeepSeekError


def cancel_plan_in_transaction(session: Session, project_id: UUID, job_id: UUID) -> Job:
    if not session.in_transaction():
        raise RuntimeError("Plan adjustment cancellation requires the caller's transaction")
    job = _lock_job(session, job_id)
    if job is None or job.project_id != project_id or job.kind != "plan_adjustment":
        raise AppError("JOB_NOT_FOUND", "计划调整执行任务不存在。", 404)
    return _cancel_in_transaction(session, job_id, project_id=project_id)


def claim_plan_in_transaction(
    session: Session,
    job: Job,
    lease_seconds: int,
    execution_timeout_seconds: int,
    max_attempts: int,
    now: datetime | None,
) -> JobClaim | None:
    instant = _database_now(session, now)
    try:
        adjustment = adjustment_for_job(session, job)
        configuration = ConfigurationProbeConfiguration.model_validate(
            adjustment.configuration_snapshot
        )
        if (
            configuration.api is None
            or configuration.agent is None
            or configuration.agent.role != "progress"
        ):
            raise ValueError("Invalid fixed plan configuration")
    except (AppError, ValidationError, ValueError):
        _end_execution(session, job, instant, status="failed", error_code="JOB_INPUT_INVALID")
        return None
    # Redelivery shares the fixed provider call budget; explicit retries create a new record.
    attempts = min(max_attempts, configuration.api.max_retries + 1)
    error_code = _expiration_error(job, instant, attempts)
    if error_code is not None:
        _end_execution(session, job, instant, status="failed", error_code=error_code)
        return None
    if job.status == "running" and not _lease_expired(job, instant):
        return None
    if job.attempt >= attempts:
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
        kind="plan_adjustment",
        plan_input=PlanAdjustmentInput(adjustment_id=adjustment.id),
    )


def load_plan_snapshot(factory: sessionmaker[Session], claim: JobClaim) -> dict[str, object] | None:
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, None)
        if execution is None:
            return None
        if claim.kind != "plan_adjustment" or claim.plan_input is None:
            raise AppError("JOB_INPUT_INVALID", "计划调整执行标识无效。", 422)
        return load_plan_snapshot_in_transaction(
            session, execution[0], claim.plan_input.adjustment_id
        )


class _LeaseLost(Exception):
    pass


def finish_plan_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    completion: PlanCompletion,
    *,
    now: datetime | None = None,
) -> bool:
    try:
        return _finish(factory, claim, completion, now=now)
    except _LeaseLost:
        return finish_job(factory, claim, failed=True, now=now)
    except AppError as error:
        return finish_job(factory, claim, failed=True, error_code=error.code, now=now)


def _finish(
    factory: sessionmaker[Session],
    claim: JobClaim,
    completion: PlanCompletion,
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
        if attempt is None or claim.kind != "plan_adjustment" or claim.plan_input is None:
            _end_execution(session, job, instant, status="failed", error_code="JOB_RESULT_INVALID")
            return True
        try:
            committed = commit_plan_proposal_in_transaction(
                session, job, claim.plan_input.adjustment_id, completion
            )
        except AppError as error:
            if error.code not in MODEL_ERROR_CODES:
                raise
            # A reply that cannot be verified never becomes a candidate.
            _end_execution(session, job, instant, status="failed", error_code=error.code)
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
            # Roll back the provisional proposal; a late reply cannot become a candidate.
            raise _LeaseLost
        result = PlanAdjustmentResult.model_validate(
            {
                "kind": "plan_adjustment",
                "schema_version": 1,
                "job_id": str(job.id),
                "project_id": str(job.project_id),
                "adjustment_id": str(claim.plan_input.adjustment_id),
                "proposal_id": str(committed["proposal_id"]),
                "item_count": committed["item_count"],
                "blocked_count": committed["blocked_count"],
                "requested_model": completion.requested_model,
                "response_model": completion.response_model,
                "model_used": True,
                "writes_performed": False,
            }
        )
        session.add(
            JobArtifact(
                job_id=job.id,
                attempt_id=attempt.id,
                kind="plan_adjustment",
                schema_version=1,
                result=result.model_dump(mode="json"),
                created_at=final_time,
            )
        )
        _end_execution(session, job, final_time, status="succeeded", result=result)
        return True


def run_plan_adjustment_job(factory: sessionmaker[Session], claim: JobClaim) -> bool:
    """Called by the worker execution boundary; failures map to stable codes only."""
    from thesis_pilot.workflows.plan_adjustment import run_plan_adjustment

    snapshot = load_plan_snapshot(factory, claim)
    if snapshot is None:
        return False
    try:
        completion = run_plan_adjustment(snapshot)
    except DeepSeekError as error:
        return finish_job(factory, claim, failed=True, error_code=error.code)
    return finish_plan_job(factory, claim, completion)
