from collections.abc import Callable, Coroutine
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.document_sources import service
from thesis_pilot.modules.document_sources.schemas import (
    DocumentSourceImport,
    DocumentSourceImportReceipt,
    DocumentSourcePreview,
    DocumentSourcePreviewRequest,
    DocumentSourceRead,
)


class SourceRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def bounded(request: Request) -> Response:
            if request.method == "POST":
                declared = request.headers.get("content-length", "")
                if declared.isdecimal() and (len(declared) > 7 or int(declared) > 1024 * 1024):
                    raise service.error("TOO_LARGE", "来源导入命令超过大小限制。", 413)
                chunks: list[bytes] = []
                size = 0
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 1024 * 1024:
                        raise service.error("TOO_LARGE", "来源导入命令超过大小限制。", 413)
                    chunks.append(chunk)
                request._body = b"".join(chunks)
            return await original(request)

        return bounded


router = APIRouter(
    prefix="/projects/{project_id}", tags=["document-sources"], route_class=SourceRoute
)
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("/document-import/preview", response_model=DocumentSourcePreview)
def preview_import(
    project_id: UUID, data: DocumentSourcePreviewRequest, session: SessionDependency
) -> DocumentSourcePreview:
    return service.preview_import(session, project_id, data)


@router.post(
    "/document-import",
    response_model=DocumentSourceImportReceipt,
    status_code=status.HTTP_201_CREATED,
)
def import_source(
    project_id: UUID, data: DocumentSourceImport, session: SessionDependency
) -> DocumentSourceImportReceipt:
    return service.import_source(session, project_id, data)


@router.get("/documents/{document_id}/source", response_model=DocumentSourceRead)
def current_source(
    project_id: UUID,
    document_id: UUID,
    session: SessionDependency,
    expected_document_version: Annotated[int | None, Query(ge=1)] = None,
) -> DocumentSourceRead:
    return service.current_source(session, project_id, document_id, expected_document_version)


@router.get("/documents/{document_id}/versions/{version}/source", response_model=DocumentSourceRead)
def get_source(
    project_id: UUID,
    document_id: UUID,
    version: Annotated[int, Path(ge=1)],
    session: SessionDependency,
) -> DocumentSourceRead:
    return service.get_source(session, project_id, document_id, version)
