from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, Request
from fastapi.security import APIKeyCookie

from thesis_pilot.core.config import Settings
from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.workspace import service
from thesis_pilot.modules.workspace.schemas import SessionRead

COOKIE_NAME = "tp_workspace_session"
COOKIE_PATH = "/api/v1"
workspace_cookie = APIKeyCookie(name=COOKIE_NAME, auto_error=False)


def require_workspace_origin(request: Request) -> None:
    settings: Settings = request.app.state.settings
    origin = settings.workspace_origin
    allowed_host = urlsplit(origin).netloc
    hosts = request.headers.getlist("host")
    origins = request.headers.getlist("origin")
    if (
        hosts != [allowed_host]
        or (origins and origins != [origin])
        or (request.method not in {"GET", "HEAD", "OPTIONS"} and origins != [origin])
    ):
        raise AppError("WORKSPACE_ORIGIN_REJECTED", "工作区不接受此来源的请求。", 403)


def require_workspace_session(
    request: Request, token: Annotated[str | None, Depends(workspace_cookie)]
) -> SessionRead:
    require_workspace_origin(request)
    # Authentication owns a short separate transaction; business services retain theirs.
    with request.app.state.session_factory() as session:
        return service.read_session(session, token)
