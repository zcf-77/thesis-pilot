"""Flow HTTP transport; authentication is supplied by the application router."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.project_flows import service
from thesis_pilot.modules.project_flows.schemas import (
    FlowCreate,
    FlowPage,
    FlowRead,
    FlowUpdate,
    FlowVersionPage,
    FlowVersionRead,
)

router = APIRouter(prefix="/project-flows", tags=["project-flows"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=FlowRead, status_code=status.HTTP_201_CREATED)
def create_flow(data: FlowCreate, session: SessionDependency) -> FlowRead:
    return service.create_flow(session, data)


@router.get("", response_model=FlowPage)
def list_flows(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> FlowPage:
    return service.list_flows(session, limit=limit, offset=offset)


@router.get("/{flow_id}", response_model=FlowRead)
def get_flow(flow_id: UUID, session: SessionDependency) -> FlowRead:
    return service.get_flow(session, flow_id)


@router.patch("/{flow_id}", response_model=FlowRead)
def update_flow(flow_id: UUID, data: FlowUpdate, session: SessionDependency) -> FlowRead:
    return service.update_flow(session, flow_id, data)


@router.get("/{flow_id}/versions", response_model=FlowVersionPage)
def list_versions(
    flow_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> FlowVersionPage:
    return service.list_versions(session, flow_id, limit=limit, offset=offset)


@router.get("/{flow_id}/versions/{version}", response_model=FlowVersionRead)
def get_version(
    flow_id: UUID,
    version: Annotated[int, Path(ge=1)],
    session: SessionDependency,
) -> FlowVersionRead:
    return service.get_version(session, flow_id, version)
