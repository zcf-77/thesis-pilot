from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Engine

from thesis_pilot.api.dependencies import require_token
from thesis_pilot.api.health import router as health_router
from thesis_pilot.core.config import Settings, get_settings
from thesis_pilot.core.errors import ERROR_RESPONSES, install_error_handlers
from thesis_pilot.core.observability import RequestContextMiddleware
from thesis_pilot.db.session import create_session_factory


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or get_settings()
    factory = create_session_factory(config)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        engine = factory.kw["bind"]
        if isinstance(engine, Engine):
            engine.dispose()

    app = FastAPI(
        title="ThesisPilot API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if config.environment != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if config.environment != "production" else None,
        responses=ERROR_RESPONSES,
    )
    app.state.settings = config
    app.state.session_factory = factory
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "PUT"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"],
        expose_headers=["X-Request-ID"],
    )
    install_error_handlers(app)
    app.include_router(health_router)

    from thesis_pilot.modules.documents.router import router as documents_router
    from thesis_pilot.modules.jobs.router import router as jobs_router
    from thesis_pilot.modules.projects.router import router as projects_router
    from thesis_pilot.modules.revisions.router import router as revisions_router

    for router in (projects_router, jobs_router, documents_router, revisions_router):
        app.include_router(router, prefix="/api/v1", dependencies=[Depends(require_token)])
    return app
