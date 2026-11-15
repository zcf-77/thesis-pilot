"""Application execution boundary, independent of the Celery transport."""

from logging import getLogger
from threading import Event, Thread
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.config import DEFAULT_WORKER_EXECUTION_TIMEOUT_SECONDS
from thesis_pilot.modules.jobs.service import (
    MAX_JOB_ATTEMPTS,
    JobClaim,
    claim_job,
    finish_job,
    renew_job,
)
from thesis_pilot.workflows.diagnostic import run_diagnostic

logger = getLogger(__name__)


def _heartbeat(
    factory: sessionmaker[Session],
    claim: JobClaim,
    lease_seconds: int,
    interval: float,
    stopped: Event,
) -> None:
    while not stopped.wait(interval):
        try:
            if not renew_job(factory, claim, lease_seconds):
                return
        except SQLAlchemyError:
            # Renewal is retried on the next tick; a lost lease cannot be revived.
            logger.warning("任务续租数据库不可用 job_id=%s", claim.job_id)


def execute_diagnostic(
    factory: sessionmaker[Session],
    job_id: UUID,
    lease_seconds: int,
    *,
    execution_timeout_seconds: int = DEFAULT_WORKER_EXECUTION_TIMEOUT_SECONDS,
    max_attempts: int = MAX_JOB_ATTEMPTS,
) -> bool:
    claim = claim_job(
        factory,
        job_id,
        lease_seconds,
        execution_timeout_seconds=execution_timeout_seconds,
        max_attempts=max_attempts,
    )
    if claim is None:
        return False
    stopped = Event()
    interval = min(lease_seconds, execution_timeout_seconds) / 3
    heartbeat = Thread(
        target=_heartbeat,
        args=(factory, claim, lease_seconds, interval, stopped),
        daemon=True,
    )
    heartbeat.start()
    try:
        try:
            result = run_diagnostic(claim.job_id, claim.project_id)
        except Exception:
            return finish_job(factory, claim, failed=True)
        return finish_job(factory, claim, result=result)
    finally:
        stopped.set()
        heartbeat.join()
