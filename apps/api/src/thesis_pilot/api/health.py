from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import text

from thesis_pilot.core.errors import AppError

router = APIRouter(tags=["health"])
SCHEMA_REVISION = "20261117_0009"


class HealthResponse(BaseModel):
    status: str


@router.get("/health/live", response_model=HealthResponse)
def live() -> HealthResponse:
    return HealthResponse(status="alive")


@router.get("/health/ready", response_model=HealthResponse)
def ready(request: Request) -> HealthResponse:
    try:
        with request.app.state.session_factory() as session:
            session.execute(text("SELECT 1"))
            revisions = set(session.scalars(text("SELECT version_num FROM alembic_version")))
            if revisions != {SCHEMA_REVISION}:
                raise AppError("NOT_READY", "数据库结构尚未就绪", 503)
        from redis import Redis

        with Redis.from_url(
            request.app.state.settings.redis_url.get_secret_value(),
            socket_connect_timeout=2,
            socket_timeout=2,
        ) as redis:
            redis.ping()
    except AppError:
        raise
    except Exception:
        raise AppError("NOT_READY", "数据库或任务队列尚未就绪", 503) from None
    return HealthResponse(status="ready")
