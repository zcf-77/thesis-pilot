"""Project backups (per project) and restores into a new project (instance level)."""

from collections.abc import Callable, Coroutine
from typing import Annotated, Any
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Header, Query, Request, Response
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.jobs import service as jobs
from thesis_pilot.modules.project_backups import service
from thesis_pilot.modules.project_backups.contracts import MAX_PACKAGE_BYTES
from thesis_pilot.modules.project_backups.schemas import (
    BackupPage,
    BackupRead,
    RestorePage,
    RestoreRead,
)

TOO_LARGE = "备份文件超过 256MiB 上限。"


class BoundedUploadRoute(APIRoute):
    """Stream the raw package body with a hard limit before the handler runs."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def bounded(request: Request) -> Response:
            if request.method == "POST":
                length = request.headers.get("content-length", "")
                if length.isdecimal() and (len(length) > 10 or int(length) > MAX_PACKAGE_BYTES):
                    raise service.error("PACKAGE_TOO_LARGE", TOO_LARGE, 413)
                chunks: list[bytes] = []
                total = 0
                async for chunk in request.stream():
                    total += len(chunk)
                    if total > MAX_PACKAGE_BYTES:
                        raise service.error("PACKAGE_TOO_LARGE", TOO_LARGE, 413)
                    chunks.append(chunk)
                request._body = b"".join(chunks)
            return await original(request)

        return bounded


router = APIRouter(tags=["backups"])
restore_router = APIRouter(
    prefix="/backups/restores", tags=["backups"], route_class=BoundedUploadRoute
)
SessionDependency = Annotated[Session, Depends(get_session)]
IdempotencyKey = Annotated[
    str, Header(alias="Idempotency-Key", pattern=r"^[A-Za-z0-9._:-]{1,128}$")
]
BACKUPS = "/projects/{project_id}/backups"
DOWNLOAD_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "sandbox",
}


@router.post(BACKUPS, response_model=BackupRead, status_code=202)
def create_backup(project_id: UUID, key: IdempotencyKey, session: SessionDependency) -> BackupRead:
    return service.create_backup(session, project_id, key)


@router.get(BACKUPS, response_model=BackupPage)
def list_backups(
    project_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> BackupPage:
    return service.list_backups(session, project_id, limit=limit, offset=offset)


@router.get(BACKUPS + "/{job_id}", response_model=BackupRead)
def get_backup(project_id: UUID, job_id: UUID, session: SessionDependency) -> BackupRead:
    return service.get_backup(session, project_id, job_id)


@router.post(BACKUPS + "/{job_id}/cancel", response_model=BackupRead)
def cancel_backup(project_id: UUID, job_id: UUID, session: SessionDependency) -> BackupRead:
    service.get_backup(session, project_id, job_id)
    jobs.cancel_job(session, job_id, include_diagnostic=False, project_id=project_id)
    return service.get_backup(session, project_id, job_id)


@router.post(BACKUPS + "/{job_id}/retry", response_model=BackupRead, status_code=202)
def retry_backup(
    project_id: UUID, job_id: UUID, key: IdempotencyKey, session: SessionDependency
) -> BackupRead:
    service.get_backup(session, project_id, job_id)
    job = jobs.retry_job(session, job_id, key, include_diagnostic=False, project_id=project_id)
    return service.get_backup(session, project_id, job.id)


@router.get(BACKUPS + "/{job_id}/download")
def download_backup(project_id: UUID, job_id: UUID, session: SessionDependency) -> Response:
    archive, data = service.get_backup_file(session, project_id, job_id)
    return Response(
        data,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                'attachment; filename="thesispilot-backup.zip"; '
                f"filename*=UTF-8''{quote(archive.filename, safe='')}"
            ),
            **DOWNLOAD_HEADERS,
        },
    )


@restore_router.post("", response_model=RestoreRead, status_code=202)
def upload_restore(
    data: Annotated[bytes, Body(media_type="application/zip")],
    key: IdempotencyKey,
    session: SessionDependency,
    filename: Annotated[str, Query(min_length=1, max_length=255)] = "项目备份.zip",
) -> RestoreRead:
    return service.upload_restore(session, data, filename, key)


@restore_router.get("", response_model=RestorePage)
def list_restores(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> RestorePage:
    return service.list_restores(session, limit=limit, offset=offset)


@restore_router.get("/{job_id}", response_model=RestoreRead)
def get_restore(job_id: UUID, session: SessionDependency) -> RestoreRead:
    return service.get_restore(session, job_id)


@restore_router.post("/{job_id}/cancel", response_model=RestoreRead)
def cancel_restore(job_id: UUID, session: SessionDependency) -> RestoreRead:
    return service.cancel_restore(session, job_id)
