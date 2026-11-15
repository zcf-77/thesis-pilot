from collections.abc import Callable, Coroutine
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.assistant_sessions import service
from thesis_pilot.modules.assistant_sessions.schemas import (
    AssistantMessagePage,
    AssistantRunCommand,
    AssistantRunContext,
    AssistantRunCreate,
    AssistantRunPage,
    AssistantRunRead,
    AssistantRunReceipt,
    AssistantRunRetryReceipt,
    AssistantSessionCreate,
    AssistantSessionPage,
    AssistantSessionRead,
    AssistantSessionUpdate,
)


class AssistantRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def bounded(request: Request) -> Response:
            if request.method in {"POST", "PATCH"}:
                declared = request.headers.get("content-length", "")
                if declared.isdecimal() and (len(declared) > 6 or int(declared) > 256 * 1024):
                    raise service.error("REQUEST_TOO_LARGE", "助手请求超过大小限制。", 413)
                chunks: list[bytes] = []
                size = 0
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 256 * 1024:
                        raise service.error("REQUEST_TOO_LARGE", "助手请求超过大小限制。", 413)
                    chunks.append(chunk)
                request._body = b"".join(chunks)
            response = await original(request)
            if len(response.body) > 1024 * 1024:
                raise service.error("RESPONSE_TOO_LARGE", "助手结果超过读取限制。", 413)
            return response

        return bounded


router = APIRouter(
    prefix="/projects/{project_id}", tags=["assistant-sessions"], route_class=AssistantRoute
)
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "/assistant-sessions", response_model=AssistantSessionRead, status_code=status.HTTP_201_CREATED
)
def create_session(
    project_id: UUID, data: AssistantSessionCreate, session: SessionDependency
) -> AssistantSessionRead:
    return service.create_session(session, project_id, data)


@router.get("/assistant-sessions", response_model=AssistantSessionPage)
def list_sessions(
    project_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    include_archived: bool = False,
) -> AssistantSessionPage:
    return service.list_sessions(
        session, project_id, limit=limit, offset=offset, include_archived=include_archived
    )


@router.get("/assistant-sessions/{session_id}", response_model=AssistantSessionRead)
def get_session_info(
    project_id: UUID, session_id: UUID, session: SessionDependency
) -> AssistantSessionRead:
    return service.get_session(session, project_id, session_id)


@router.patch("/assistant-sessions/{session_id}", response_model=AssistantSessionRead)
def update_session(
    project_id: UUID, session_id: UUID, data: AssistantSessionUpdate, session: SessionDependency
) -> AssistantSessionRead:
    return service.update_session(session, project_id, session_id, data)


@router.get("/assistant-sessions/{session_id}/messages", response_model=AssistantMessagePage)
def list_messages(
    project_id: UUID,
    session_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AssistantMessagePage:
    return service.list_messages(session, project_id, session_id, limit=limit, offset=offset)


@router.get("/assistant-sessions/{session_id}/runs", response_model=AssistantRunPage)
def list_runs(
    project_id: UUID,
    session_id: UUID,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AssistantRunPage:
    return service.list_runs(session, project_id, session_id, limit=limit, offset=offset)


@router.post(
    "/assistant-sessions/{session_id}/runs", response_model=AssistantRunReceipt, status_code=202
)
def create_run(
    project_id: UUID, session_id: UUID, data: AssistantRunCreate, session: SessionDependency
) -> AssistantRunReceipt:
    return service.create_run(session, project_id, session_id, data)


@router.get("/assistant-runs/{run_id}", response_model=AssistantRunRead)
def get_run(project_id: UUID, run_id: UUID, session: SessionDependency) -> AssistantRunRead:
    return service.get_run(session, project_id, run_id)


@router.get("/assistant-runs/{run_id}/context", response_model=AssistantRunContext)
def get_context(project_id: UUID, run_id: UUID, session: SessionDependency) -> AssistantRunContext:
    return service.get_context(session, project_id, run_id)


@router.post("/assistant-runs/{run_id}/cancel", response_model=AssistantRunRead)
def cancel_run(
    project_id: UUID, run_id: UUID, data: AssistantRunCommand, session: SessionDependency
) -> AssistantRunRead:
    return service.cancel_run(session, project_id, run_id, data)


@router.post(
    "/assistant-runs/{run_id}/retry", response_model=AssistantRunRetryReceipt, status_code=202
)
def retry_run(
    project_id: UUID, run_id: UUID, data: AssistantRunCommand, session: SessionDependency
) -> AssistantRunRetryReceipt:
    return service.retry_run(session, project_id, run_id, data)
