"""SG-09 feedback decomposition: runs are started per batch; decisions are explicit commands."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.feedback_splits import service
from thesis_pilot.modules.feedback_splits.schemas import (
    FeedbackSplitCreate,
    FeedbackSplitDecide,
    FeedbackSplitPage,
    FeedbackSplitRead,
    FeedbackSplitReceipt,
    FeedbackSplitRetry,
)

router = APIRouter(tags=["feedback-splits"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "/projects/{project_id}/feedback/{batch_id}/splits",
    response_model=FeedbackSplitReceipt,
    status_code=202,
)
def create_split(
    project_id: UUID, batch_id: UUID, data: FeedbackSplitCreate, session: SessionDependency
) -> FeedbackSplitReceipt:
    return service.create_split(session, project_id, batch_id, data)


@router.get("/projects/{project_id}/feedback/{batch_id}/splits", response_model=FeedbackSplitPage)
def list_splits(
    project_id: UUID,
    batch_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
) -> FeedbackSplitPage:
    return service.list_splits(session, project_id, batch_id, limit=limit, offset=offset)


@router.get("/projects/{project_id}/feedback-splits/{split_id}", response_model=FeedbackSplitRead)
def get_split(project_id: UUID, split_id: UUID, session: SessionDependency) -> FeedbackSplitRead:
    return service.get_split(session, project_id, split_id)


@router.post(
    "/projects/{project_id}/feedback-splits/{split_id}/cancel", response_model=FeedbackSplitRead
)
def cancel_split(project_id: UUID, split_id: UUID, session: SessionDependency) -> FeedbackSplitRead:
    return service.cancel_split(session, project_id, split_id)


@router.post(
    "/projects/{project_id}/feedback-splits/{split_id}/retry",
    response_model=FeedbackSplitReceipt,
    status_code=202,
)
def retry_split(
    project_id: UUID, split_id: UUID, data: FeedbackSplitRetry, session: SessionDependency
) -> FeedbackSplitReceipt:
    return service.retry_split(session, project_id, split_id, data)


@router.post(
    "/projects/{project_id}/feedback-splits/{split_id}/decisions",
    response_model=FeedbackSplitRead,
)
def decide(
    project_id: UUID, split_id: UUID, data: FeedbackSplitDecide, session: SessionDependency
) -> FeedbackSplitRead:
    return service.decide(session, project_id, split_id, data)
