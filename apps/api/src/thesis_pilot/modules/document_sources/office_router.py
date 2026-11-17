"""Project-scoped DOCX import through the office-server sidecar (SG-22 / SG-13A)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.document_sources import office_service as service
from thesis_pilot.modules.document_sources.office_schemas import (
    DocumentOfficeSourceRead,
    OfficeImportConfirm,
    OfficeImportCreate,
    OfficeImportPage,
    OfficeImportRead,
    OfficeImportReceipt,
)
from thesis_pilot.modules.jobs import service as jobs

router = APIRouter(prefix="/projects/{project_id}", tags=["office-imports"])
SessionDependency = Annotated[Session, Depends(get_session)]
IdempotencyKey = Annotated[
    str, Header(alias="Idempotency-Key", pattern=r"^[A-Za-z0-9._:-]{1,128}$")
]


@router.post("/office-imports", response_model=OfficeImportRead, status_code=202)
def create_office_import(
    project_id: UUID, data: OfficeImportCreate, key: IdempotencyKey, session: SessionDependency
) -> OfficeImportRead:
    return service.create_import(session, project_id, data, key)


@router.get("/office-imports", response_model=OfficeImportPage)
def list_office_imports(
    project_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> OfficeImportPage:
    return service.list_imports(session, project_id, limit=limit, offset=offset)


@router.get("/office-imports/{job_id}", response_model=OfficeImportRead)
def get_office_import(
    project_id: UUID, job_id: UUID, session: SessionDependency
) -> OfficeImportRead:
    return service.get_import(session, project_id, job_id)


@router.post("/office-imports/{job_id}/cancel", response_model=OfficeImportRead)
def cancel_office_import(
    project_id: UUID, job_id: UUID, session: SessionDependency
) -> OfficeImportRead:
    service.get_import(session, project_id, job_id)
    jobs.cancel_job(session, job_id, include_diagnostic=False, project_id=project_id)
    return service.get_import(session, project_id, job_id)


@router.post("/office-imports/{job_id}/retry", response_model=OfficeImportRead, status_code=202)
def retry_office_import(
    project_id: UUID, job_id: UUID, key: IdempotencyKey, session: SessionDependency
) -> OfficeImportRead:
    service.get_import(session, project_id, job_id)
    job = jobs.retry_job(session, job_id, key, include_diagnostic=False, project_id=project_id)
    return service.get_import(session, project_id, job.id)


@router.post(
    "/office-imports/{job_id}/confirm",
    response_model=OfficeImportReceipt,
    status_code=status.HTTP_201_CREATED,
)
def confirm_office_import(
    project_id: UUID, job_id: UUID, data: OfficeImportConfirm, session: SessionDependency
) -> OfficeImportReceipt:
    return service.confirm_import(session, project_id, job_id, data)


@router.get("/documents/{document_id}/office-source", response_model=DocumentOfficeSourceRead)
def get_document_office_source(
    project_id: UUID,
    document_id: UUID,
    session: SessionDependency,
    version: Annotated[int | None, Query(ge=1)] = None,
) -> DocumentOfficeSourceRead:
    return service.get_office_source(session, project_id, document_id, version)
