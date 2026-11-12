"""Application execution boundary, independent of the Celery transport."""

from uuid import UUID

from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.modules.jobs.service import MAX_JOB_ATTEMPTS, claim_job, finish_job
from thesis_pilot.workflows.diagnostic import run_diagnostic


def execute_diagnostic(
    factory: sessionmaker[Session],
    job_id: UUID,
    lease_seconds: int,
    *,
    max_attempts: int = MAX_JOB_ATTEMPTS,
) -> bool:
    claim = claim_job(factory, job_id, lease_seconds, max_attempts=max_attempts)
    if claim is None:
        return False
    try:
        result = run_diagnostic(claim.job_id, claim.project_id)
    except Exception:
        return finish_job(factory, claim, failed=True)
    return finish_job(factory, claim, result=result)
