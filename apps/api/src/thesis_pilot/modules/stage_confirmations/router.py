"""Authenticated stage confirmation transport; rules and commits live in the service."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.stage_confirmations import service
from thesis_pilot.modules.stage_confirmations.schemas import (
    StageCommandRead,
    StageConfirm,
    StageConfirmationPage,
    StageProgressRead,
    StageRevoke,
)

router = APIRouter(prefix="/projects/{project_id}", tags=["stage-confirmations"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/stage-progress", response_model=StageProgressRead)
def get_progress(project_id: UUID, session: SessionDependency) -> StageProgressRead:
    return service.get_progress(session, project_id)


@router.get("/stage-confirmations", response_model=StageConfirmationPage)
def list_confirmations(
    project_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
) -> StageConfirmationPage:
    return service.list_confirmations(session, project_id, limit=limit, offset=offset)


@router.post(
    "/stage-confirmations", response_model=StageCommandRead, status_code=status.HTTP_201_CREATED
)
def confirm_stage(
    project_id: UUID, data: StageConfirm, session: SessionDependency
) -> StageCommandRead:
    return service.confirm_stage(session, project_id, data)


@router.post(
    "/stage-confirmations/{confirmation_id}/revocations",
    response_model=StageCommandRead,
    status_code=status.HTTP_201_CREATED,
)
def revoke_stage(
    project_id: UUID, confirmation_id: UUID, data: StageRevoke, session: SessionDependency
) -> StageCommandRead:
    return service.revoke_stage(session, project_id, confirmation_id, data)
