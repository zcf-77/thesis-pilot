from functools import lru_cache
from uuid import UUID

from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.config import get_settings
from thesis_pilot.db.session import create_session_factory
from thesis_pilot.workers.celery_app import TASK_NAME, app
from thesis_pilot.workers.execution import execute_diagnostic


@lru_cache(maxsize=1)
def worker_sessions() -> sessionmaker[Session]:
    # First called inside the executing worker process; never share a Session.
    return create_session_factory(get_settings())


@app.task(name=TASK_NAME)  # type: ignore[untyped-decorator]
def diagnostic(job_id: str) -> None:
    # The queue receives identifiers only; unknown kinds and arbitrary code are not accepted.
    settings = get_settings()
    execute_diagnostic(
        worker_sessions(),
        UUID(job_id),
        settings.worker_lease_seconds,
        execution_timeout_seconds=settings.worker_execution_timeout_seconds,
    )
