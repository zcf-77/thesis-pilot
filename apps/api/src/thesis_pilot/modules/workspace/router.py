import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.core.config import Settings
from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.workspace import service
from thesis_pilot.modules.workspace.dependencies import (
    COOKIE_NAME,
    COOKIE_PATH,
    require_workspace_origin,
    require_workspace_session,
)
from thesis_pilot.modules.workspace.schemas import (
    ProfileRead,
    ProfileUpdate,
    SessionCreate,
    SessionRead,
)

router = APIRouter(prefix="/workspace", tags=["workspace"])
SessionDependency = Annotated[Session, Depends(get_session)]
WorkspaceDependency = Annotated[SessionRead, Depends(require_workspace_session)]


@router.post(
    "/session", response_model=SessionRead, dependencies=[Depends(require_workspace_origin)]
)
def enter_workspace(
    data: SessionCreate, request: Request, response: Response, session: SessionDependency
) -> SessionRead:
    settings: Settings = request.app.state.settings
    if not secrets.compare_digest(
        data.access_key.get_secret_value().encode("utf-8"),
        settings.workspace_access_key.get_secret_value().encode("utf-8"),
    ):
        raise AppError("WORKSPACE_ACCESS_DENIED", "工作区访问密钥无效。", 401)
    token, result = service.create_session(
        session,
        seconds=settings.workspace_session_seconds,
        previous_token=request.cookies.get(COOKIE_NAME),
    )
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.workspace_session_seconds,
        httponly=True,
        secure=settings.workspace_origin.startswith("https://"),
        samesite="strict",
        path=COOKIE_PATH,
    )
    return result


@router.get("/session", response_model=SessionRead)
def current_workspace(workspace: WorkspaceDependency) -> SessionRead:
    return workspace


@router.delete("/session", status_code=204, dependencies=[Depends(require_workspace_origin)])
def leave_workspace(request: Request, session: SessionDependency) -> Response:
    service.revoke_session(session, request.cookies.get(COOKIE_NAME))
    settings: Settings = request.app.state.settings
    response = Response(status_code=204)
    response.delete_cookie(
        COOKIE_NAME,
        path=COOKIE_PATH,
        httponly=True,
        secure=settings.workspace_origin.startswith("https://"),
        samesite="strict",
    )
    return response


@router.patch("/profile", response_model=ProfileRead)
def edit_profile(
    data: ProfileUpdate, workspace: WorkspaceDependency, session: SessionDependency
) -> ProfileRead:
    return service.update_profile(session, workspace.workspace_id, data)
