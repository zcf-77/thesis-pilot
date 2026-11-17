"""Document-scoped citation candidates (AC-019) and the managed citation list."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.citations import service
from thesis_pilot.modules.citations.schemas import (
    CitationApply,
    CitationCandidatePage,
    CitationCandidateRead,
    CitationCreate,
    CitationListRead,
    CitationReject,
    CitationUndo,
)

router = APIRouter(
    prefix="/projects/{project_id}/documents/{document_id}/citations", tags=["citations"]
)
SessionDependency = Annotated[Session, Depends(get_session)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]
VersionQuery = Annotated[int | None, Query(ge=1, le=9007199254740991)]
StatusQuery = Annotated[Literal["ready", "applied", "rejected", "undone"] | None, Query()]


@router.get("", response_model=CitationListRead)
def list_citations(
    project_id: UUID, document_id: UUID, session: SessionDependency, version: VersionQuery = None
) -> CitationListRead:
    return service.list_citations(session, project_id, document_id, version)


@router.post("/candidates", response_model=CitationCandidateRead, status_code=201)
def create_candidate(
    project_id: UUID, document_id: UUID, data: CitationCreate, session: SessionDependency
) -> CitationCandidateRead:
    return service.create_candidate(session, project_id, document_id, data)


@router.get("/candidates", response_model=CitationCandidatePage)
def list_candidates(
    project_id: UUID,
    document_id: UUID,
    session: SessionDependency,
    status: StatusQuery = None,
    limit: Limit = 20,
    offset: Offset = 0,
) -> CitationCandidatePage:
    return service.list_candidates(
        session, project_id, document_id, status=status, limit=limit, offset=offset
    )


@router.get("/candidates/{candidate_id}", response_model=CitationCandidateRead)
def get_candidate(
    project_id: UUID, document_id: UUID, candidate_id: UUID, session: SessionDependency
) -> CitationCandidateRead:
    return service.get_candidate(session, project_id, document_id, candidate_id)


@router.post("/candidates/{candidate_id}/apply", response_model=CitationCandidateRead)
def apply_candidate(
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    data: CitationApply,
    session: SessionDependency,
) -> CitationCandidateRead:
    return service.apply_candidate(session, project_id, document_id, candidate_id, data)


@router.post("/candidates/{candidate_id}/reject", response_model=CitationCandidateRead)
def reject_candidate(
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    data: CitationReject,
    session: SessionDependency,
) -> CitationCandidateRead:
    return service.reject_candidate(session, project_id, document_id, candidate_id, data)


@router.post("/candidates/{candidate_id}/undo", response_model=CitationCandidateRead)
def undo_candidate(
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    data: CitationUndo,
    session: SessionDependency,
) -> CitationCandidateRead:
    return service.undo_candidate(session, project_id, document_id, candidate_id, data)
