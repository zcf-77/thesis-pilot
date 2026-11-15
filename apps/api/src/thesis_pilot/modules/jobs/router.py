from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs import service
from thesis_pilot.modules.jobs.schemas import (
    JobCreate,
    JobDetail,
    JobKind,
    JobPage,
    JobRead,
    JobStatus,
)

router = APIRouter(prefix="/jobs", tags=["jobs"])
SessionDep = Annotated[Session, Depends(get_session)]
IdempotencyKey = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
]


def require_project_scope(request: Request, project_id: UUID | None) -> None:
    if request.app.state.settings.auth_mode == "workspace" and project_id is None:
        raise AppError("VALIDATION_ERROR", "请指定当前项目。", 422)


@router.post("", response_model=JobRead, status_code=202)
def create_job(
    request: JobCreate, session: SessionDep, idempotency_key: IdempotencyKey, http_request: Request
) -> JobRead:
    return JobRead.model_validate(
        service.create_job(
            session,
            request,
            idempotency_key,
            include_diagnostic=http_request.app.state.settings.auth_mode != "workspace",
        )
    )


@router.get("/{job_id}", response_model=JobDetail)
def get_job(
    job_id: UUID, session: SessionDep, request: Request, project_id: UUID | None = None
) -> JobDetail:
    require_project_scope(request, project_id)
    return JobDetail.model_validate(
        service.get_job_detail(
            session,
            job_id,
            include_diagnostic=request.app.state.settings.auth_mode != "workspace",
            project_id=project_id,
        )
    )


@router.get("", response_model=JobPage)
def list_jobs(
    project_id: UUID,
    session: SessionDep,
    request: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    status: Annotated[list[JobStatus] | None, Query()] = None,
    kind: Annotated[JobKind | None, Query()] = None,
) -> JobPage:
    return service.list_jobs(
        session,
        project_id,
        limit=limit,
        offset=offset,
        statuses=status,
        kind=kind,
        include_diagnostic=request.app.state.settings.auth_mode != "workspace",
    )


@router.post("/{job_id}/cancel", response_model=JobRead)
def cancel_job(
    job_id: UUID, session: SessionDep, request: Request, project_id: UUID | None = None
) -> JobRead:
    require_project_scope(request, project_id)
    return JobRead.model_validate(
        service.cancel_job(
            session,
            job_id,
            include_diagnostic=request.app.state.settings.auth_mode != "workspace",
            project_id=project_id,
        )
    )


@router.post("/{job_id}/retry", response_model=JobRead, status_code=202)
def retry_job(
    job_id: UUID,
    session: SessionDep,
    request: Request,
    idempotency_key: IdempotencyKey,
    project_id: UUID | None = None,
) -> JobRead:
    require_project_scope(request, project_id)
    return JobRead.model_validate(
        service.retry_job(
            session,
            job_id,
            idempotency_key,
            include_diagnostic=request.app.state.settings.auth_mode != "workspace",
            project_id=project_id,
        )
    )
