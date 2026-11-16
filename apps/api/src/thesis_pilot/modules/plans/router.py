"""Authenticated plan transport: versions, manual batch adjustment and AI candidates."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.plans import service
from thesis_pilot.modules.plans.schemas import (
    PlanAdjustmentCreate,
    PlanAdjustmentDecide,
    PlanAdjustmentPage,
    PlanAdjustmentRead,
    PlanAdjustmentReceipt,
    PlanAdjustmentRevert,
    PlanRead,
    PlanSchedule,
    PlanVersionPage,
    PlanVersionRead,
)

router = APIRouter(prefix="/projects/{project_id}/plan", tags=["plans"])
SessionDependency = Annotated[Session, Depends(get_session)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100000)]


@router.get("", response_model=PlanRead)
def get_plan(project_id: UUID, session: SessionDependency) -> PlanRead:
    return service.get_plan(session, project_id)


@router.get("/versions", response_model=PlanVersionPage)
def list_versions(
    project_id: UUID, session: SessionDependency, limit: Limit = 20, offset: Offset = 0
) -> PlanVersionPage:
    return service.list_versions(session, project_id, limit=limit, offset=offset)


@router.post("/schedule", response_model=PlanVersionRead)
def schedule(project_id: UUID, data: PlanSchedule, session: SessionDependency) -> PlanVersionRead:
    return service.schedule(session, project_id, data)


@router.post("/adjustments", response_model=PlanAdjustmentReceipt, status_code=202)
def create_adjustment(
    project_id: UUID, data: PlanAdjustmentCreate, session: SessionDependency
) -> PlanAdjustmentReceipt:
    return service.create_adjustment(session, project_id, data)


@router.get("/adjustments", response_model=PlanAdjustmentPage)
def list_adjustments(
    project_id: UUID, session: SessionDependency, limit: Limit = 20, offset: Offset = 0
) -> PlanAdjustmentPage:
    return service.list_adjustments(session, project_id, limit=limit, offset=offset)


@router.get("/adjustments/{adjustment_id}", response_model=PlanAdjustmentRead)
def get_adjustment(
    project_id: UUID, adjustment_id: UUID, session: SessionDependency
) -> PlanAdjustmentRead:
    return service.get_adjustment(session, project_id, adjustment_id)


@router.post("/adjustments/{adjustment_id}/cancel", response_model=PlanAdjustmentRead)
def cancel_adjustment(
    project_id: UUID, adjustment_id: UUID, session: SessionDependency
) -> PlanAdjustmentRead:
    return service.cancel_adjustment(session, project_id, adjustment_id)


@router.post("/adjustments/{adjustment_id}/decisions", response_model=PlanAdjustmentRead)
def decide(
    project_id: UUID, adjustment_id: UUID, data: PlanAdjustmentDecide, session: SessionDependency
) -> PlanAdjustmentRead:
    return service.decide(session, project_id, adjustment_id, data)


@router.post("/adjustments/{adjustment_id}/revert", response_model=PlanAdjustmentRead)
def revert(
    project_id: UUID, adjustment_id: UUID, data: PlanAdjustmentRevert, session: SessionDependency
) -> PlanAdjustmentRead:
    return service.revert(session, project_id, adjustment_id, data)
