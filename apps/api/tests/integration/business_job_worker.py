"""Run the real prefork task and control when the inspection returns."""

import os
import time
from pathlib import Path
from uuid import uuid4

from long_job_worker import main

from thesis_pilot.modules.documents.structure import JsonObject
from thesis_pilot.modules.jobs.service import JobClaim
from thesis_pilot.workers import execution

inspect_document = execution.run_document_inspection


def held_inspection(claim: JobClaim, content: JsonObject) -> dict[str, object]:
    job_id = claim.job_id
    started = Path(f"{job_id}.{os.getpid()}.{uuid4().hex}.started")
    started.touch()
    release = started.with_suffix(".release")
    while not release.exists():
        time.sleep(0.02)
    result = inspect_document(claim, content)
    if Path(f"{job_id}.invalid").exists():
        result["schema_version"] = 2
    return result


if __name__ == "__main__":
    execution.run_document_inspection = held_inspection
    main()
