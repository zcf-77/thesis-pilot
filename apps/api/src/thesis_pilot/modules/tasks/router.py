"""Authenticated manual task transport."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.tasks import service
from thesis_pilot.modules.tasks.schemas import (
    BoardRead,
    TaskCreate,
    TaskDecision,
    TaskPage,
    TaskRead,
    TaskReorder,
    TaskUpdate,
    TaskVersionPage,
)

router = APIRouter(prefix="/projects/{project_id}/tasks", tags=["tasks"])
SessionDependency = Annotated[Session, Depends(get_session)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100000)]


@router.get("", response_model=TaskPage)
def list_tasks(
    project_id: UUID, session: SessionDependency, limit: Limit = 20, offset: Offset = 0
) -> TaskPage:
    return service.list_tasks(session, project_id, limit=limit, offset=offset)


@router.post("", response_model=TaskRead, status_code=201)
def create_task(project_id: UUID, data: TaskCreate, session: SessionDependency) -> TaskRead:
    return service.create_task(session, project_id, data)


@router.post("/reorder", response_model=BoardRead)
def reorder_tasks(project_id: UUID, data: TaskReorder, session: SessionDependency) -> BoardRead:
    return service.reorder_tasks(session, project_id, data)


@router.get("/{task_id}", response_model=TaskRead)
def get_task(project_id: UUID, task_id: UUID, session: SessionDependency) -> TaskRead:
    return service.get_task(session, project_id, task_id)


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(
    project_id: UUID, task_id: UUID, data: TaskUpdate, session: SessionDependency
) -> TaskRead:
    return service.update_task(session, project_id, task_id, data)


@router.post("/{task_id}/decisions", response_model=TaskRead)
def decide_task(
    project_id: UUID, task_id: UUID, data: TaskDecision, session: SessionDependency
) -> TaskRead:
    return service.decide_task(session, project_id, task_id, data)


@router.get("/{task_id}/versions", response_model=TaskVersionPage)
def list_versions(
    project_id: UUID,
    task_id: UUID,
    session: SessionDependency,
    limit: Limit = 20,
    offset: Offset = 0,
) -> TaskVersionPage:
    return service.list_versions(session, project_id, task_id, limit=limit, offset=offset)
