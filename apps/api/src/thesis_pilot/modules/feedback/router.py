"""Feedback originals and manual interpretations are separate resources."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.feedback import service
from thesis_pilot.modules.feedback.schemas import (
    FeedbackCreate,
    FeedbackDecision,
    FeedbackItemCreate,
    FeedbackItemPage,
    FeedbackItemRead,
    FeedbackItemUpdate,
    FeedbackPage,
    FeedbackRead,
    FeedbackVersionPage,
)

router = APIRouter(prefix="/projects/{project_id}/feedback", tags=["feedback"])
SessionDependency = Annotated[Session, Depends(get_session)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100000)]


@router.get("", response_model=FeedbackPage)
def list_feedback(
    project_id: UUID, session: SessionDependency, limit: Limit = 20, offset: Offset = 0
) -> FeedbackPage:
    return service.list_feedback(session, project_id, limit=limit, offset=offset)


@router.post("", response_model=FeedbackRead, status_code=201)
def create_feedback(
    project_id: UUID, data: FeedbackCreate, session: SessionDependency
) -> FeedbackRead:
    return service.create_feedback(session, project_id, data)


@router.get("/items/{item_id}", response_model=FeedbackItemRead)
def get_item(project_id: UUID, item_id: UUID, session: SessionDependency) -> FeedbackItemRead:
    return service.get_item(session, project_id, item_id)


@router.patch("/items/{item_id}", response_model=FeedbackItemRead)
def update_item(
    project_id: UUID, item_id: UUID, data: FeedbackItemUpdate, session: SessionDependency
) -> FeedbackItemRead:
    return service.update_item(session, project_id, item_id, data)


@router.post("/items/{item_id}/decisions", response_model=FeedbackItemRead)
def decide_item(
    project_id: UUID, item_id: UUID, data: FeedbackDecision, session: SessionDependency
) -> FeedbackItemRead:
    return service.decide_item(session, project_id, item_id, data)


@router.get("/items/{item_id}/versions", response_model=FeedbackVersionPage)
def list_versions(
    project_id: UUID,
    item_id: UUID,
    session: SessionDependency,
    limit: Limit = 20,
    offset: Offset = 0,
) -> FeedbackVersionPage:
    return service.list_versions(session, project_id, item_id, limit=limit, offset=offset)


@router.get("/{batch_id}", response_model=FeedbackRead)
def get_feedback(project_id: UUID, batch_id: UUID, session: SessionDependency) -> FeedbackRead:
    return service.get_feedback(session, project_id, batch_id)


@router.get("/{batch_id}/items", response_model=FeedbackItemPage)
def list_items(
    project_id: UUID,
    batch_id: UUID,
    session: SessionDependency,
    limit: Limit = 20,
    offset: Offset = 0,
) -> FeedbackItemPage:
    return service.list_items(session, project_id, batch_id, limit=limit, offset=offset)


@router.post("/{batch_id}/items", response_model=FeedbackItemRead, status_code=201)
def create_item(
    project_id: UUID, batch_id: UUID, data: FeedbackItemCreate, session: SessionDependency
) -> FeedbackItemRead:
    return service.create_item(session, project_id, batch_id, data)
