"""Run the real diagnostic Celery task with a controllable, test-only runner."""

import os
import time
from pathlib import Path
from uuid import UUID, uuid4

from thesis_pilot.workers import execution
from thesis_pilot.workers.celery_app import app
from thesis_pilot.workflows.diagnostic import run_diagnostic


def held_diagnostic(job_id: UUID, project_id: UUID) -> dict[str, object]:
    started = Path(f"{job_id}.{os.getpid()}.{uuid4().hex}.started")
    started.touch()
    release = started.with_suffix(".release")
    while not release.exists():
        time.sleep(0.02)
    result = run_diagnostic(job_id, project_id)
    if Path(f"{job_id}.invalid").exists():
        result["checked"] = 1
    return result


def main() -> None:
    execution.run_diagnostic = held_diagnostic
    queue = os.environ["TP_TEST_WORKER_QUEUE"]
    options = dict(app.conf.broker_transport_options)
    options["global_keyprefix"] = os.environ["TP_TEST_REDIS_PREFIX"]
    app.conf.update(
        broker_transport_options=options,
        task_default_queue=queue,
        worker_enable_remote_control=False,
    )
    app.worker_main(
        [
            "worker",
            "--pool=prefork",
            "--concurrency=2",
            "--loglevel=WARNING",
            "--without-gossip",
            "--without-mingle",
            "--without-heartbeat",
            f"--queues={queue}",
            f"--hostname={queue}@%h",
        ]
    )


if __name__ == "__main__":
    main()
