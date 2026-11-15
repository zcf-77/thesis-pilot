"""Project-scoped manuscript transport with a bounded request body."""

from collections.abc import Callable, Coroutine
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.documents import service
from thesis_pilot.modules.documents.schemas import (
    DocumentImport,
    DocumentRead,
    DocumentSave,
    DocumentVersionPage,
    DocumentVersionRead,
)
from thesis_pilot.modules.documents.structure import (
    MAX_SAFE_INTEGER,
    MAX_TRANSPORT_BYTES,
    too_large,
)
from thesis_pilot.modules.documents.transport import document_response


class DocumentRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        # Any is the exact coroutine boundary exposed by FastAPI's route handler.
        original = super().get_route_handler()

        async def bounded(request: Request) -> Response:
            if request.method in {"POST", "PATCH"}:
                length = request.headers.get("content-length", "")
                if length.isdecimal() and int(length) > MAX_TRANSPORT_BYTES:
                    raise too_large()
                size = 0
                chunks: list[bytes] = []
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_TRANSPORT_BYTES:
                        raise too_large()
                    chunks.append(chunk)
                # Starlette's body cache lets FastAPI parse the already bounded bytes once.
                request._body = b"".join(chunks)
            return await original(request)

        return bounded


router = APIRouter(
    prefix="/projects/{project_id}/documents", tags=["documents"], route_class=DocumentRoute
)
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
def import_document(project_id: UUID, data: DocumentImport, session: SessionDependency) -> Response:
    return document_response(service.import_document(session, project_id, data), status_code=201)


@router.get("/current", response_model=DocumentRead)
def get_current_document(project_id: UUID, session: SessionDependency) -> Response:
    return document_response(service.get_current_document(session, project_id))


@router.patch("/{document_id}", response_model=DocumentRead)
def save_document(
    project_id: UUID, document_id: UUID, data: DocumentSave, session: SessionDependency
) -> Response:
    return document_response(service.save_document(session, project_id, document_id, data))


@router.get("/{document_id}/versions", response_model=DocumentVersionPage)
def list_versions(
    project_id: UUID,
    document_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Response:
    return document_response(
        service.list_versions(session, project_id, document_id, limit=limit, offset=offset)
    )


@router.get("/{document_id}/versions/{version}", response_model=DocumentVersionRead)
def get_version(
    project_id: UUID,
    document_id: UUID,
    version: Annotated[int, Path(ge=1, le=MAX_SAFE_INTEGER)],
    session: SessionDependency,
) -> Response:
    return document_response(service.get_version(session, project_id, document_id, version))
