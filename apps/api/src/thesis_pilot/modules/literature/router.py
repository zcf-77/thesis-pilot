"""Project-scoped literature search runs and literature entries."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.literature import service
from thesis_pilot.modules.literature.schemas import (
    LiteratureEntryCommand,
    LiteratureEntryCreate,
    LiteratureEntryPage,
    LiteratureEntryRead,
    LiteratureEntryVersionPage,
    LiteratureSearchCreate,
    LiteratureSearchPage,
    LiteratureSearchRead,
    LiteratureSearchReceipt,
    LiteratureSearchRetry,
)

router = APIRouter(prefix="/projects/{project_id}/literature", tags=["literature"])
SessionDependency = Annotated[Session, Depends(get_session)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


@router.post("/searches", response_model=LiteratureSearchReceipt, status_code=202)
def create_search(
    project_id: UUID, data: LiteratureSearchCreate, session: SessionDependency
) -> LiteratureSearchReceipt:
    return service.create_search(session, project_id, data)


@router.get("/searches", response_model=LiteratureSearchPage)
def list_searches(
    project_id: UUID, session: SessionDependency, limit: Limit = 20, offset: Offset = 0
) -> LiteratureSearchPage:
    return service.list_searches(session, project_id, limit=limit, offset=offset)


@router.get("/searches/{search_id}", response_model=LiteratureSearchRead)
def get_search(
    project_id: UUID, search_id: UUID, session: SessionDependency
) -> LiteratureSearchRead:
    return service.get_search(session, project_id, search_id)


@router.post("/searches/{search_id}/cancel", response_model=LiteratureSearchRead)
def cancel_search(
    project_id: UUID, search_id: UUID, session: SessionDependency
) -> LiteratureSearchRead:
    return service.cancel_search(session, project_id, search_id)


@router.post("/searches/{search_id}/retry", response_model=LiteratureSearchReceipt, status_code=202)
def retry_search(
    project_id: UUID, search_id: UUID, data: LiteratureSearchRetry, session: SessionDependency
) -> LiteratureSearchReceipt:
    return service.retry_search(session, project_id, search_id, data)


@router.post("/entries", response_model=LiteratureEntryRead, status_code=201)
def save_entry(
    project_id: UUID, data: LiteratureEntryCreate, session: SessionDependency
) -> LiteratureEntryRead:
    return service.save_entry(session, project_id, data)


@router.get("/entries", response_model=LiteratureEntryPage)
def list_entries(
    project_id: UUID,
    session: SessionDependency,
    include_removed: bool = False,
    limit: Limit = 50,
    offset: Offset = 0,
) -> LiteratureEntryPage:
    return service.list_entries(
        session, project_id, include_removed=include_removed, limit=limit, offset=offset
    )


@router.get("/entries/{entry_id}", response_model=LiteratureEntryRead)
def get_entry(project_id: UUID, entry_id: UUID, session: SessionDependency) -> LiteratureEntryRead:
    return service.get_entry(session, project_id, entry_id)


@router.get("/entries/{entry_id}/versions", response_model=LiteratureEntryVersionPage)
def list_entry_versions(
    project_id: UUID,
    entry_id: UUID,
    session: SessionDependency,
    limit: Limit = 50,
    offset: Offset = 0,
) -> LiteratureEntryVersionPage:
    return service.list_entry_versions(session, project_id, entry_id, limit=limit, offset=offset)


@router.post("/entries/{entry_id}/remove", response_model=LiteratureEntryRead)
def remove_entry(
    project_id: UUID, entry_id: UUID, data: LiteratureEntryCommand, session: SessionDependency
) -> LiteratureEntryRead:
    return service.remove_entry(session, project_id, entry_id, data)


@router.post("/entries/{entry_id}/restore", response_model=LiteratureEntryRead)
def restore_entry(
    project_id: UUID, entry_id: UUID, data: LiteratureEntryCommand, session: SessionDependency
) -> LiteratureEntryRead:
    return service.restore_entry(session, project_id, entry_id, data)


@router.post("/entries/{entry_id}/verify", response_model=LiteratureEntryRead)
def verify_entry(
    project_id: UUID, entry_id: UUID, data: LiteratureEntryCommand, session: SessionDependency
) -> LiteratureEntryRead:
    return service.verify_entry(session, project_id, entry_id, data)
