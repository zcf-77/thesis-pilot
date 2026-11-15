"""Bounded JSON uploads and authenticated project-scoped original downloads."""

from collections.abc import Callable, Coroutine
from typing import Annotated, Any
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Path, Query, Request, Response, status
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.jobs.schemas import JobRead
from thesis_pilot.modules.materials import service
from thesis_pilot.modules.materials.schemas import (
    MAX_UPLOAD_BODY_BYTES,
    MaterialKind,
    MaterialOriginalCreate,
    MaterialOriginalPage,
    MaterialOriginalRead,
    MaterialPage,
    MaterialParseRead,
    MaterialParseSummaryPage,
    MaterialRead,
    MaterialReparse,
    MaterialUpdate,
    MaterialUpload,
    MaterialUploadReceipt,
    ProjectSourceBindingRead,
    ProjectSourceBindingUpdate,
    ProjectSourceBindingVersionPage,
    ProjectSourceBindingVersionRead,
)


class MaterialRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def bounded(request: Request) -> Response:
            if request.method in {"POST", "PATCH"}:
                length = request.headers.get("content-length", "")
                if length.isdecimal() and (len(length) > 8 or int(length) > MAX_UPLOAD_BODY_BYTES):
                    raise service.error("TOO_LARGE", "上传请求超过 8MiB 原件的传输限制。", 413)
                chunks: list[bytes] = []
                total = 0
                async for chunk in request.stream():
                    total += len(chunk)
                    if total > MAX_UPLOAD_BODY_BYTES:
                        raise service.error("TOO_LARGE", "上传请求超过 8MiB 原件的传输限制。", 413)
                    chunks.append(chunk)
                request._body = b"".join(chunks)
            return await original(request)

        return bounded


router = APIRouter(prefix="/projects/{project_id}", tags=["materials"], route_class=MaterialRoute)
SessionDependency = Annotated[Session, Depends(get_session)]
IdempotencyKey = Annotated[
    str, Header(alias="Idempotency-Key", pattern=r"^[A-Za-z0-9._:-]{1,128}$")
]


@router.post(
    "/materials", response_model=MaterialUploadReceipt, status_code=status.HTTP_201_CREATED
)
def upload_material(
    project_id: UUID, data: MaterialUpload, key: IdempotencyKey, session: SessionDependency
) -> MaterialUploadReceipt:
    return service.upload_material(session, project_id, data, key)


@router.get("/materials", response_model=MaterialPage)
def list_materials(
    project_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    kind: MaterialKind | None = None,
    include_removed: bool = False,
) -> MaterialPage:
    return service.list_materials(
        session, project_id, limit=limit, offset=offset, kind=kind, include_removed=include_removed
    )


@router.get("/materials/{material_id}", response_model=MaterialRead)
def get_material(project_id: UUID, material_id: UUID, session: SessionDependency) -> MaterialRead:
    return service.get_material(session, project_id, material_id)


@router.patch("/materials/{material_id}", response_model=MaterialRead)
def update_material(
    project_id: UUID, material_id: UUID, data: MaterialUpdate, session: SessionDependency
) -> MaterialRead:
    return service.update_material(session, project_id, material_id, data)


@router.post(
    "/materials/{material_id}/originals", response_model=MaterialUploadReceipt, status_code=201
)
def append_original(
    project_id: UUID,
    material_id: UUID,
    data: MaterialOriginalCreate,
    key: IdempotencyKey,
    session: SessionDependency,
) -> MaterialUploadReceipt:
    return service.append_original(session, project_id, material_id, data, key)


@router.get("/materials/{material_id}/originals", response_model=MaterialOriginalPage)
def list_originals(
    project_id: UUID,
    material_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MaterialOriginalPage:
    return service.list_originals(session, project_id, material_id, limit=limit, offset=offset)


@router.get("/materials/{material_id}/originals/{original_id}", response_model=MaterialOriginalRead)
def get_original(
    project_id: UUID, material_id: UUID, original_id: UUID, session: SessionDependency
) -> MaterialOriginalRead:
    return service.get_original(session, project_id, material_id, original_id)


@router.get("/materials/{material_id}/originals/{original_id}/download")
def download_original(
    project_id: UUID, material_id: UUID, original_id: UUID, session: SessionDependency
) -> Response:
    original, content = service.get_original_bytes(session, project_id, material_id, original_id)
    mime = {
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text": "text/plain; charset=utf-8",
        "pdf": "application/pdf",
    }[original.file_type]
    extension = {"docx": "docx", "text": "txt", "pdf": "pdf"}[original.file_type]
    return Response(
        content,
        media_type=mime,
        headers={
            "Content-Disposition": (
                f'attachment; filename="original.{extension}"; '
                f"filename*=UTF-8''{quote(original.filename, safe='')}"
            ),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )


@router.post(
    "/materials/{material_id}/originals/{original_id}/parse-jobs",
    response_model=JobRead,
    status_code=201,
)
def reparse_material(
    project_id: UUID,
    material_id: UUID,
    original_id: UUID,
    data: MaterialReparse,
    key: IdempotencyKey,
    session: SessionDependency,
) -> JobRead:
    return service.reparse_material(session, project_id, material_id, original_id, data, key)


@router.get(
    "/materials/{material_id}/originals/{original_id}/parses",
    response_model=MaterialParseSummaryPage,
)
def list_parses(
    project_id: UUID,
    material_id: UUID,
    original_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MaterialParseSummaryPage:
    return service.list_parses(
        session, project_id, material_id, original_id, limit=limit, offset=offset
    )


@router.get(
    "/materials/{material_id}/originals/{original_id}/parses/{parse_id}",
    response_model=MaterialParseRead,
)
def get_parse(
    project_id: UUID,
    material_id: UUID,
    original_id: UUID,
    parse_id: UUID,
    session: SessionDependency,
) -> MaterialParseRead:
    return service.get_parse(session, project_id, material_id, original_id, parse_id)


@router.get("/source-binding", response_model=ProjectSourceBindingRead)
def get_binding(project_id: UUID, session: SessionDependency) -> ProjectSourceBindingRead:
    return service.get_binding(session, project_id)


@router.patch("/source-binding", response_model=ProjectSourceBindingRead)
def update_binding(
    project_id: UUID, data: ProjectSourceBindingUpdate, session: SessionDependency
) -> ProjectSourceBindingRead:
    return service.update_binding(session, project_id, data)


@router.get("/source-binding/versions", response_model=ProjectSourceBindingVersionPage)
def list_binding_versions(
    project_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ProjectSourceBindingVersionPage:
    return service.list_binding_versions(session, project_id, limit=limit, offset=offset)


@router.get("/source-binding/versions/{version}", response_model=ProjectSourceBindingVersionRead)
def get_binding_version(
    project_id: UUID, version: Annotated[int, Path(ge=1)], session: SessionDependency
) -> ProjectSourceBindingVersionRead:
    return service.get_binding_version(session, project_id, version)
