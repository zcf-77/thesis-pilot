"""Project-scoped export commands, history and authenticated downloads."""

from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.exports import service
from thesis_pilot.modules.exports.contracts import EXTENSIONS
from thesis_pilot.modules.exports.schemas import (
    ChangeRecordCreate,
    DocumentExportCreate,
    ExportPage,
    ExportRead,
)
from thesis_pilot.modules.jobs import service as jobs

router = APIRouter(prefix="/projects/{project_id}/exports", tags=["exports"])
SessionDependency = Annotated[Session, Depends(get_session)]
IdempotencyKey = Annotated[
    str, Header(alias="Idempotency-Key", pattern=r"^[A-Za-z0-9._:-]{1,128}$")
]


@router.post("/documents", response_model=ExportRead, status_code=202)
def create_document_export(
    project_id: UUID, data: DocumentExportCreate, key: IdempotencyKey, session: SessionDependency
) -> ExportRead:
    return service.create_document_export(session, project_id, data, key)


@router.post("/change-records", response_model=ExportRead, status_code=202)
def create_change_record(
    project_id: UUID, data: ChangeRecordCreate, key: IdempotencyKey, session: SessionDependency
) -> ExportRead:
    return service.create_change_record(session, project_id, data, key)


@router.get("", response_model=ExportPage)
def list_exports(
    project_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ExportPage:
    return service.list_exports(session, project_id, limit=limit, offset=offset)


@router.get("/{job_id}", response_model=ExportRead)
def get_export(project_id: UUID, job_id: UUID, session: SessionDependency) -> ExportRead:
    return service.get_export(session, project_id, job_id)


@router.post("/{job_id}/cancel", response_model=ExportRead)
def cancel_export(project_id: UUID, job_id: UUID, session: SessionDependency) -> ExportRead:
    service.get_export(session, project_id, job_id)
    jobs.cancel_job(session, job_id, include_diagnostic=False, project_id=project_id)
    return service.get_export(session, project_id, job_id)


@router.post("/{job_id}/retry", response_model=ExportRead, status_code=202)
def retry_export(
    project_id: UUID, job_id: UUID, key: IdempotencyKey, session: SessionDependency
) -> ExportRead:
    service.get_export(session, project_id, job_id)
    job = jobs.retry_job(session, job_id, key, include_diagnostic=False, project_id=project_id)
    return service.get_export(session, project_id, job.id)


@router.get("/{job_id}/download")
def download_export(project_id: UUID, job_id: UUID, session: SessionDependency) -> Response:
    file, data = service.get_export_file(session, project_id, job_id)
    fallback = f"thesispilot-{file.kind.replace('_', '-')}-v{file.document_version}"
    return Response(
        data,
        media_type=file.content_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{fallback}.{EXTENSIONS[file.format]}"; '
                f"filename*=UTF-8''{quote(file.filename, safe='')}"
            ),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
            "Content-Security-Policy": "sandbox",
        },
    )
