from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.jobs import service
from thesis_pilot.modules.jobs.schemas import JobCreate, JobPage, JobRead, JobStatus

router = APIRouter(prefix="/jobs", tags=["jobs"])
SessionDep = Annotated[Session, Depends(get_session)]
IdempotencyKey = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
]


@router.post("", response_model=JobRead, status_code=202)
def create_job(request: JobCreate, session: SessionDep, idempotency_key: IdempotencyKey) -> JobRead:
    return JobRead.model_validate(service.create_job(session, request, idempotency_key))


@router.get("/{job_id}", response_model=JobRead)
def get_job(job_id: UUID, session: SessionDep) -> JobRead:
    return JobRead.model_validate(service.get_job(session, job_id))


@router.get("", response_model=JobPage)
def list_jobs(
    project_id: UUID,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    status: Annotated[list[JobStatus] | None, Query()] = None,
) -> JobPage:
    return service.list_jobs(session, project_id, limit=limit, offset=offset, statuses=status)


@router.post("/{job_id}/cancel", response_model=JobRead)
def cancel_job(job_id: UUID, session: SessionDep) -> JobRead:
    return JobRead.model_validate(service.cancel_job(session, job_id))
