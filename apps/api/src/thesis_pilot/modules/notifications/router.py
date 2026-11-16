"""Authenticated notification transport; derivation only runs on explicit refresh."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from thesis_pilot.api.dependencies import get_session
from thesis_pilot.modules.notifications import service
from thesis_pilot.modules.notifications.schemas import (
    NotificationEventPage,
    NotificationPage,
    NotificationRead,
    NotificationTab,
    NotificationTransition,
    ProgressNoteCreate,
    RefreshResult,
    UnreadCount,
)

router = APIRouter(prefix="/projects/{project_id}/notifications", tags=["notifications"])
SessionDependency = Annotated[Session, Depends(get_session)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100000)]


@router.get("", response_model=NotificationPage)
def list_notifications(
    project_id: UUID,
    session: SessionDependency,
    tab: NotificationTab = "active",
    limit: Limit = 20,
    offset: Offset = 0,
) -> NotificationPage:
    return service.list_notifications(session, project_id, tab=tab, limit=limit, offset=offset)


@router.get("/unread-count", response_model=UnreadCount)
def unread_count(project_id: UUID, session: SessionDependency) -> UnreadCount:
    return service.unread_count(session, project_id)


@router.post("/refresh", response_model=RefreshResult)
def refresh_notifications(project_id: UUID, session: SessionDependency) -> RefreshResult:
    return service.refresh(session, project_id)


@router.get("/events", response_model=NotificationEventPage)
def list_events(
    project_id: UUID,
    session: SessionDependency,
    notification_id: UUID | None = None,
    limit: Limit = 20,
    offset: Offset = 0,
) -> NotificationEventPage:
    return service.list_events(
        session, project_id, notification_id=notification_id, limit=limit, offset=offset
    )


@router.get("/{notification_id}", response_model=NotificationRead)
def get_notification(
    project_id: UUID, notification_id: UUID, session: SessionDependency
) -> NotificationRead:
    return service.get_notification(session, project_id, notification_id)


@router.post("/{notification_id}/transitions", response_model=NotificationRead)
def transition_notification(
    project_id: UUID,
    notification_id: UUID,
    data: NotificationTransition,
    session: SessionDependency,
) -> NotificationRead:
    return service.transition(session, project_id, notification_id, data)


@router.post("/{notification_id}/progress-notes", response_model=NotificationRead)
def add_progress_note(
    project_id: UUID,
    notification_id: UUID,
    data: ProgressNoteCreate,
    session: SessionDependency,
) -> NotificationRead:
    return service.add_progress_note(session, project_id, notification_id, data)
