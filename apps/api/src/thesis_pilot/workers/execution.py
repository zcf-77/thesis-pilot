"""Application execution boundary, independent of the Celery transport."""

from logging import getLogger
from threading import Event, Thread
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.config import DEFAULT_WORKER_EXECUTION_TIMEOUT_SECONDS
from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.material_parse import run_material_parse
from thesis_pilot.modules.jobs.probe import run_configuration_probe
from thesis_pilot.modules.jobs.schemas import JobKind
from thesis_pilot.modules.jobs.service import (
    MAX_JOB_ATTEMPTS,
    JobClaim,
    claim_job,
    finish_job,
    finish_material_parse_job,
    load_inspection_content,
    renew_job,
)
from thesis_pilot.providers.deepseek import DeepSeekError
from thesis_pilot.workflows.diagnostic import run_diagnostic
from thesis_pilot.workflows.document_inspection import run_document_inspection

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


def execute_job(
    factory: sessionmaker[Session],
    job_id: UUID,
    lease_seconds: int,
    *,
    execution_timeout_seconds: int = DEFAULT_WORKER_EXECUTION_TIMEOUT_SECONDS,
    max_attempts: int = MAX_JOB_ATTEMPTS,
    expected_kind: JobKind | None = None,
) -> bool:
    claim = claim_job(
        factory,
        job_id,
        lease_seconds,
        execution_timeout_seconds=execution_timeout_seconds,
        max_attempts=max_attempts,
        expected_kind=expected_kind,
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
            if claim.kind == "diagnostic":
                result = run_diagnostic(claim.job_id, claim.project_id)
            elif claim.kind == "document_inspection":
                content = load_inspection_content(factory, claim)
                if content is None:
                    return False
                result = run_document_inspection(claim, content)
            elif claim.kind == "configuration_probe":
                result = run_configuration_probe(claim)
            elif claim.kind == "material_parse":
                parsed = run_material_parse(factory, claim)
                if parsed is None:
                    return False
                return finish_material_parse_job(factory, claim, parsed)
            else:
                raise ValueError("不支持的任务类型。")
        except DeepSeekError as error:
            return finish_job(factory, claim, failed=True, error_code=error.code)
        except AppError as error:
            return finish_job(factory, claim, failed=True, error_code=error.code)
        except Exception:
            return finish_job(factory, claim, failed=True)
        return finish_job(factory, claim, result=result)
    finally:
        stopped.set()
        heartbeat.join()


# Keep callers and controlled diagnostic fault replay compatible with earlier releases.
execute_diagnostic = execute_job
