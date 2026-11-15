"""Explicit user commands for bounded, document-scoped revisions."""

import json
import math
from collections.abc import Callable, Coroutine
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.revisions import service
from thesis_pilot.modules.revisions.schemas import (
    MAX_REVISION_BYTES,
    RevisionApply,
    RevisionCancel,
    RevisionCommandRead,
    RevisionCreate,
    RevisionDecide,
    RevisionPage,
    RevisionProposal,
    RevisionRead,
    RevisionRevert,
    RevisionUndo,
)
from thesis_pilot.modules.revisions.transport import revision_response, too_large


def checked_wire(body: bytes) -> None:
    try:
        parsed: object = json.loads(body)
    except (ValueError, RecursionError):
        raise AppError("VALIDATION_ERROR", "请求 JSON 不符合接口约定。", 422) from None
    pending = [(parsed, 0)]
    while pending:
        value, depth = pending.pop()
        if depth > 40 or (isinstance(value, float) and not math.isfinite(value)):
            raise AppError("VALIDATION_ERROR", "请求 JSON 不符合接口约定。", 422)
        if isinstance(value, dict):
            pending.extend((item, depth + 1) for item in value.values())
        elif isinstance(value, list):
            pending.extend((item, depth + 1) for item in value)


class RevisionRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def bounded(request: Request) -> Response:
            if request.method in {"POST", "PUT"}:
                length = request.headers.get("content-length", "")
                if length.isdecimal() and (len(length) > 8 or int(length) > MAX_REVISION_BYTES):
                    raise too_large()
                size = 0
                chunks: list[bytes] = []
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_REVISION_BYTES:
                        raise too_large()
                    chunks.append(chunk)
                body = b"".join(chunks)
                checked_wire(body)
                request._body = body
            return await original(request)

        return bounded


router = APIRouter(
    prefix="/projects/{project_id}/documents/{document_id}",
    tags=["revisions"],
    route_class=RevisionRoute,
)
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("/revisions", response_model=RevisionCommandRead, status_code=201)
def create_revision(
    project_id: UUID, document_id: UUID, data: RevisionCreate, session: SessionDependency
) -> Response:
    return revision_response(
        service.create_revision(session, project_id, document_id, data), status_code=201
    )


@router.get("/revisions", response_model=RevisionPage)
def list_revisions(
    project_id: UUID,
    document_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Response:
    return revision_response(
        service.list_revisions(session, project_id, document_id, limit=limit, offset=offset)
    )


@router.get("/revisions/{candidate_id}", response_model=RevisionRead)
def get_revision(
    project_id: UUID, document_id: UUID, candidate_id: UUID, session: SessionDependency
) -> Response:
    return revision_response(service.get_revision(session, project_id, document_id, candidate_id))


@router.put("/revisions/{candidate_id}/proposal", response_model=RevisionCommandRead)
def submit_proposal(
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    data: RevisionProposal,
    session: SessionDependency,
) -> Response:
    return revision_response(
        service.submit_proposal(session, project_id, document_id, candidate_id, data)
    )


@router.put("/revisions/{candidate_id}/decisions", response_model=RevisionCommandRead)
def decide_revision(
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    data: RevisionDecide,
    session: SessionDependency,
) -> Response:
    return revision_response(
        service.decide_revision(session, project_id, document_id, candidate_id, data)
    )


@router.post("/revisions/{candidate_id}/apply", response_model=RevisionCommandRead)
def apply_revision(
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    data: RevisionApply,
    session: SessionDependency,
) -> Response:
    return revision_response(
        service.apply_revision(session, project_id, document_id, candidate_id, data)
    )


@router.post("/revisions/{candidate_id}/cancel", response_model=RevisionCommandRead)
def cancel_revision(
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    data: RevisionCancel,
    session: SessionDependency,
) -> Response:
    return revision_response(
        service.cancel_revision(session, project_id, document_id, candidate_id, data)
    )


@router.get("/revision-commands/{command_id}", response_model=RevisionCommandRead)
def get_command(
    project_id: UUID, document_id: UUID, command_id: UUID, session: SessionDependency
) -> Response:
    return revision_response(service.get_command(session, project_id, document_id, command_id))


@router.post("/revision-commands/{application_command_id}/undo", response_model=RevisionCommandRead)
def undo_revision(
    project_id: UUID,
    document_id: UUID,
    application_command_id: UUID,
    data: RevisionUndo,
    session: SessionDependency,
) -> Response:
    return revision_response(
        service.undo_revision(session, project_id, document_id, application_command_id, data)
    )


@router.post("/revert", response_model=RevisionCommandRead)
def revert_document(
    project_id: UUID, document_id: UUID, data: RevisionRevert, session: SessionDependency
) -> Response:
    return revision_response(service.revert_document(session, project_id, document_id, data))
