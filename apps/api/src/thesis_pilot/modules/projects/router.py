"""HTTP transport; business rules and commits belong to the service."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.projects import service
from thesis_pilot.modules.projects.schemas import (
    ProjectCreate,
    ProjectPage,
    ProjectRead,
    ProjectUpdate,
)

router = APIRouter(prefix="/projects", tags=["projects"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(data: ProjectCreate, session: SessionDependency) -> ProjectRead:
    return service.create_project(session, data)


@router.get("", response_model=ProjectPage)
def list_projects(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ProjectPage:
    return service.list_projects(session, limit=limit, offset=offset)


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: UUID, session: SessionDependency) -> ProjectRead:
    return service.get_project(session, project_id)


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(
    project_id: UUID, data: ProjectUpdate, session: SessionDependency
) -> ProjectRead:
    return service.update_project(session, project_id, data)
