"""Run separately from API/worker; one dispatcher is sufficient for the first release."""

import argparse
import time
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

from thesis_pilot.core.config import get_settings
from thesis_pilot.db.session import create_session_factory
from thesis_pilot.modules.jobs.service import dispatch_pending
from thesis_pilot.workers.celery_app import TASK_NAME, app


def publish_job(job_id: UUID) -> None:
    app.send_task(TASK_NAME, args=[str(job_id)], task_id=str(job_id), retry=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="派发事务 outbox 中的固定类型任务。")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--poll-seconds", type=float, default=2)
    args = parser.parse_args()
    if args.poll_seconds < 0.1:
        parser.error("--poll-seconds 必须至少为 0.1")
    factory = create_session_factory(get_settings())
    while True:
        try:
            result = dispatch_pending(factory, publish_job)
        except SQLAlchemyError:
            print("error=JOB_DISPATCH_DATABASE_UNAVAILABLE", flush=True)
            if args.once:
                raise SystemExit(1) from None
        else:
            print(f"published={result.published} failed={result.failed}", flush=True)
            if args.once:
                raise SystemExit(1 if result.failed else 0)
        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    main()
