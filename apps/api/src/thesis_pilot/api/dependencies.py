import secrets
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError

bearer = HTTPBearer(auto_error=False)


def require_token(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> None:
    expected = request.app.state.settings.api_token.get_secret_value()
    if not expected:
        raise AppError("AUTH_NOT_CONFIGURED", "尚未配置接口访问令牌", 503)
    if credentials is None or not secrets.compare_digest(
        credentials.credentials.encode("utf-8"), expected.encode("utf-8")
    ):
        raise AppError("UNAUTHORIZED", "访问令牌无效或缺失", 401)


def get_session(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        yield session
