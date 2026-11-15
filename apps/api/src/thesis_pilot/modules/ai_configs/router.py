from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Request, status
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.core.config import Settings
from thesis_pilot.modules.ai_configs import service
from thesis_pilot.modules.ai_configs.schemas import (
    AIConfigAvailability,
    AIConfigCopy,
    AIConfigCreate,
    AIConfigPage,
    AIConfigRead,
    AIConfigReferences,
    AIConfigUpdate,
    AIConfigVersionPage,
    AIConfigVersionRead,
    ConfigKind,
)

router = APIRouter(prefix="/ai-configs", tags=["ai-configs"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/availability", response_model=AIConfigAvailability)
def availability(request: Request) -> AIConfigAvailability:
    settings: Settings = request.app.state.settings
    return AIConfigAvailability(
        credential_configured=bool(settings.deepseek_api_key.get_secret_value())
    )


@router.post("", response_model=AIConfigRead, status_code=status.HTTP_201_CREATED)
def create_config(data: AIConfigCreate, session: SessionDependency) -> AIConfigRead:
    return service.create_config(session, data)


@router.get("", response_model=AIConfigPage)
def list_configs(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    kind: ConfigKind | None = None,
) -> AIConfigPage:
    return service.list_configs(session, limit=limit, offset=offset, kind=kind)


@router.get("/{config_id}", response_model=AIConfigRead)
def get_config(config_id: UUID, session: SessionDependency) -> AIConfigRead:
    return service.get_config(session, config_id)


@router.patch("/{config_id}", response_model=AIConfigRead)
def update_config(
    config_id: UUID, data: AIConfigUpdate, session: SessionDependency
) -> AIConfigRead:
    return service.update_config(session, config_id, data)


@router.post(
    "/{config_id}/copies", response_model=AIConfigRead, status_code=status.HTTP_201_CREATED
)
def copy_config(config_id: UUID, data: AIConfigCopy, session: SessionDependency) -> AIConfigRead:
    return service.copy_config(session, config_id, data)


@router.get("/{config_id}/versions", response_model=AIConfigVersionPage)
def list_versions(
    config_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AIConfigVersionPage:
    return service.list_versions(session, config_id, limit=limit, offset=offset)


@router.get("/{config_id}/versions/{version}", response_model=AIConfigVersionRead)
def get_version(
    config_id: UUID, version: Annotated[int, Path(ge=1)], session: SessionDependency
) -> AIConfigVersionRead:
    return service.get_version(session, config_id, version)


@router.get("/{config_id}/references", response_model=AIConfigReferences)
def get_references(config_id: UUID, session: SessionDependency) -> AIConfigReferences:
    return service.get_references(session, config_id)
