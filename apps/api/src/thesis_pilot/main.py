from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
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
    workspace_mode = config.auth_mode == "workspace"
    app.add_middleware(RequestContextMiddleware, private_api=workspace_mode)
    if not workspace_mode:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=config.cors_origins,
            allow_methods=["GET", "POST", "PATCH", "PUT"],
            allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"],
            expose_headers=["X-Request-ID"],
        )
    install_error_handlers(app)
    app.include_router(health_router)

    from thesis_pilot.modules.ai_configs.router import router as ai_configs_router
    from thesis_pilot.modules.assistant_sessions.router import router as assistant_sessions_router
    from thesis_pilot.modules.document_sources.router import router as document_sources_router
    from thesis_pilot.modules.documents.router import router as documents_router
    from thesis_pilot.modules.feedback.router import router as feedback_router
    from thesis_pilot.modules.format_revisions.router import router as format_revisions_router
    from thesis_pilot.modules.jobs.router import router as jobs_router
    from thesis_pilot.modules.materials.router import router as materials_router
    from thesis_pilot.modules.project_flows.router import router as project_flows_router
    from thesis_pilot.modules.projects.router import router as projects_router
    from thesis_pilot.modules.revisions.router import router as revisions_router
    from thesis_pilot.modules.tasks.router import router as tasks_router
    from thesis_pilot.modules.workspace.dependencies import require_workspace_session
    from thesis_pilot.modules.workspace.router import router as workspace_router

    auth = require_workspace_session if workspace_mode else require_token
    for router in (
        ai_configs_router,
        assistant_sessions_router,
        projects_router,
        project_flows_router,
        jobs_router,
        materials_router,
        document_sources_router,
        documents_router,
        tasks_router,
        feedback_router,
        format_revisions_router,
        revisions_router,
    ):
        app.include_router(router, prefix="/api/v1", dependencies=[Depends(auth)])
    if workspace_mode:
        app.include_router(workspace_router, prefix="/api/v1")
        if config.workspace_web_root is not None:
            directory = config.workspace_web_root.resolve()
            index = directory / "index.html"
            favicon = directory / "favicon.svg"
            if not index.is_file() or not favicon.is_file() or not (directory / "assets").is_dir():
                raise ValueError("未找到正式工作区构建目录，请先构建并检查目录配置")
            if (directory / "thesispilot-design-lab.html").exists():
                raise ValueError("正式工作区必须使用独立构建目录")

            @app.get("/", include_in_schema=False)
            def workspace_index() -> FileResponse:
                return FileResponse(index, headers={"Cache-Control": "no-cache"})

            @app.get("/favicon.svg", include_in_schema=False)
            def workspace_favicon() -> FileResponse:
                return FileResponse(favicon)

            app.mount(
                "/assets", StaticFiles(directory=directory / "assets"), name="workspace-assets"
            )
    return app
