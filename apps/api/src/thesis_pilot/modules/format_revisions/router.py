"""Explicit deterministic formatting commands; clients never submit JSON patches."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.format_revisions import service
from thesis_pilot.modules.format_revisions.schemas import (
    FormatApply,
    FormatCommandRead,
    FormatContext,
    FormatCreate,
    FormatDecide,
    FormatPage,
    FormatRead,
    FormatUndo,
)
from thesis_pilot.modules.revisions.router import RevisionRoute

router = APIRouter(
    prefix="/projects/{project_id}/documents/{document_id}",
    tags=["format-revisions"],
    route_class=RevisionRoute,
)
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/format-context", response_model=FormatContext)
def context(project_id: UUID, document_id: UUID, session: SessionDependency) -> FormatContext:
    return service.get_format_context(session, project_id, document_id)


@router.post("/format-revisions", response_model=FormatCommandRead, status_code=201)
def create(
    project_id: UUID, document_id: UUID, data: FormatCreate, session: SessionDependency
) -> FormatCommandRead:
    return service.create_format_revision(session, project_id, document_id, data)


@router.get("/format-revisions", response_model=FormatPage)
def listing(
    project_id: UUID,
    document_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> FormatPage:
    return service.list_format_revisions(
        session, project_id, document_id, limit=limit, offset=offset
    )


@router.get("/format-revisions/{candidate_id}", response_model=FormatRead)
def get(
    project_id: UUID, document_id: UUID, candidate_id: UUID, session: SessionDependency
) -> FormatRead:
    return service.get_format_revision(session, project_id, document_id, candidate_id)


@router.post("/format-revisions/{candidate_id}/decisions", response_model=FormatCommandRead)
def decide(
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    data: FormatDecide,
    session: SessionDependency,
) -> FormatCommandRead:
    return service.decide_format_revision(session, project_id, document_id, candidate_id, data)


@router.post("/format-revisions/{candidate_id}/apply", response_model=FormatCommandRead)
def apply(
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    data: FormatApply,
    session: SessionDependency,
) -> FormatCommandRead:
    return service.apply_format_revision(session, project_id, document_id, candidate_id, data)


@router.post("/format-commands/{command_id}/undo", response_model=FormatCommandRead)
def undo(
    project_id: UUID,
    document_id: UUID,
    command_id: UUID,
    data: FormatUndo,
    session: SessionDependency,
) -> FormatCommandRead:
    return service.undo_format_revision(session, project_id, document_id, command_id, data)


@router.get("/format-commands/{command_id}", response_model=FormatCommandRead)
def command(
    project_id: UUID, document_id: UUID, command_id: UUID, session: SessionDependency
) -> FormatCommandRead:
    return service.get_format_command(session, project_id, document_id, command_id)
