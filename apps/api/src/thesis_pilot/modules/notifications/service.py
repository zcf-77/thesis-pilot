"""Notification commands: CAS on the row, idempotent command receipts, append-only events."""

import hashlib
import json
from datetime import datetime, timedelta
from typing import cast
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.notifications.derivation import (
    COOLDOWN_HOURS,
    Candidate,
    aware,
    derive,
    is_quiet,
)
from thesis_pilot.modules.notifications.models import (
    Notification,
    NotificationCommand,
    NotificationEvent,
    utcnow,
)
from thesis_pilot.modules.notifications.schemas import (
    Actor,
    Command,
    Delivery,
    EventAction,
    NotificationEventPage,
    NotificationEventRead,
    NotificationKind,
    NotificationPage,
    NotificationRead,
    NotificationStatus,
    NotificationTab,
    NotificationTransition,
    ObjectRef,
    ObjectType,
    ProgressNote,
    ProgressNoteCreate,
    RefreshResult,
    UnreadCount,
)
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.workspace.models import WorkspaceProfile

ALLOWED: dict[str, tuple[set[str], str]] = {
    "read": ({"unread", "snoozed"}, "read"),
    "snooze": ({"unread", "read", "snoozed"}, "snoozed"),
    "dismiss": ({"unread", "read", "snoozed"}, "dismissed"),
    "restore": ({"snoozed", "dismissed"}, "unread"),
}
EVENT_ACTIONS = {"read": "read", "snooze": "snooze", "dismiss": "dismiss", "restore": "restore"}
OPEN_STATUSES = ("unread", "read", "snoozed")
MAX_SNOOZE = timedelta(days=365)


def project(session: Session, project_id: UUID, *, lock: bool = False) -> Project:
    query = select(Project).where(Project.id == project_id)
    value = session.scalar(query.with_for_update() if lock else query)
    if value is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
    return value


def fingerprint(value: object) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def replay(
    session: Session, project_id: UUID, operation: str, data: Command
) -> NotificationRead | None:
    command = session.get(NotificationCommand, data.command_id)
    if command is None:
        return None
    if (
        command.project_id != project_id
        or command.operation != operation
        or command.request_hash != fingerprint(data.model_dump(mode="json"))
    ):
        raise AppError("NOTICE_COMMAND_CONFLICT", "命令编号已用于不同操作。", 409)
    return NotificationRead.model_validate(command.result)


def remember(
    session: Session, project_id: UUID, operation: str, data: Command, result: NotificationRead
) -> None:
    session.add(
        NotificationCommand(
            id=data.command_id,
            project_id=project_id,
            operation=operation,
            request_hash=fingerprint(data.model_dump(mode="json")),
            result=result.model_dump(mode="json"),
        )
    )


def notification(session: Session, project_id: UUID, notification_id: UUID) -> Notification:
    value = session.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.project_id == project_id
        )
    )
    if value is None:
        raise AppError("NOTICE_NOT_FOUND", "通知不存在。", 404)
    return value


def object_ref(row: Notification) -> ObjectRef:
    return ObjectRef(
        type=cast(ObjectType, row.object_type),
        id=row.object_id,
        parent_id=row.parent_id,
        source_version=row.source_version,
    )


def notes_for(session: Session, ids: list[UUID]) -> dict[UUID, list[ProgressNote]]:
    result: dict[UUID, list[ProgressNote]] = {key: [] for key in ids}
    if not ids:
        return result
    rows = session.scalars(
        select(NotificationEvent)
        .where(
            NotificationEvent.notification_id.in_(ids),
            NotificationEvent.action == "progress_note",
        )
        .order_by(NotificationEvent.created_at, NotificationEvent.version)
    )
    for row in rows:
        result[row.notification_id].append(
            ProgressNote(text=row.note, created_at=aware(row.created_at))
        )
    return result


def read_rows(session: Session, rows: list[Notification]) -> list[NotificationRead]:
    notes = notes_for(session, [row.id for row in rows])
    return [
        NotificationRead(
            id=row.id,
            project_id=row.project_id,
            kind=cast(NotificationKind, row.kind),
            object=object_ref(row),
            dedupe_key=row.dedupe_key,
            title=row.title,
            trigger=row.trigger,
            basis=list(row.basis),
            uncertainty=row.uncertainty,
            status=cast(NotificationStatus, row.status),
            delivery=cast(Delivery, row.delivery),
            snooze_until=aware(row.snooze_until) if row.snooze_until else None,
            progress_notes=notes[row.id],
            version=row.version,
            created_at=aware(row.created_at),
            updated_at=aware(row.updated_at),
        )
        for row in rows
    ]


def append_event(
    session: Session,
    row: Notification,
    action: EventAction,
    *,
    actor: Actor,
    from_status: str | None,
    note: str = "",
    now: datetime,
) -> None:
    session.add(
        NotificationEvent(
            project_id=row.project_id,
            notification_id=row.id,
            version=row.version,
            action=action,
            actor=actor,
            from_status=from_status,
            to_status=row.status,
            snooze_until=row.snooze_until,
            note=note,
            created_at=now,
        )
    )


def unread(session: Session, project_id: UUID) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.project_id == project_id, Notification.status == "unread")
        )
        or 0
    )


def preferences(session: Session) -> tuple[bool, str, str, bool]:
    profile = session.scalar(select(WorkspaceProfile).where(WorkspaceProfile.singleton == 1))
    if profile is None:
        return True, "22:00", "08:00", False
    return (
        profile.notifications_enabled,
        profile.quiet_start,
        profile.quiet_end,
        profile.show_deferred,
    )


def list_notifications(
    session: Session, project_id: UUID, *, tab: NotificationTab, limit: int, offset: int
) -> NotificationPage:
    with session.begin():
        project(session, project_id)
        statuses: tuple[str, ...]
        if tab == "active":
            statuses = OPEN_STATUSES if preferences(session)[3] else ("unread", "read")
        else:
            statuses = (tab,)
        query = select(Notification).where(
            Notification.project_id == project_id, Notification.status.in_(statuses)
        )
        total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = list(
            session.scalars(
                query.order_by(Notification.created_at.desc(), Notification.id.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        return NotificationPage(
            items=read_rows(session, rows),
            total=total,
            limit=limit,
            offset=offset,
            unread_count=unread(session, project_id),
        )


def unread_count(session: Session, project_id: UUID) -> UnreadCount:
    with session.begin():
        project(session, project_id)
        return UnreadCount(project_id=project_id, unread_count=unread(session, project_id))


def get_notification(session: Session, project_id: UUID, notification_id: UUID) -> NotificationRead:
    with session.begin():
        project(session, project_id)
        return read_rows(session, [notification(session, project_id, notification_id)])[0]


def change(
    session: Session,
    row: Notification,
    expected_version: int,
    allowed: set[str],
    values: dict[str, object],
) -> None:
    """Version and current state are both part of the UPDATE condition."""
    changed = session.execute(
        update(Notification)
        .where(
            Notification.id == row.id,
            Notification.project_id == row.project_id,
            Notification.version == expected_version,
            Notification.status.in_(allowed),
        )
        .values(**values, version=Notification.version + 1)
        .execution_options(synchronize_session=False)
    )
    if getattr(changed, "rowcount", 0) != 1:
        session.refresh(row)
        if row.version != expected_version:
            raise AppError("NOTICE_VERSION_CONFLICT", "通知已变化，请重新读取后重试。", 409)
        raise AppError("NOTICE_TRANSITION_INVALID", "通知当前状态不支持此操作。", 409)
    session.refresh(row)


def transition(
    session: Session,
    project_id: UUID,
    notification_id: UUID,
    data: NotificationTransition,
    *,
    now: datetime | None = None,
) -> NotificationRead:
    moment = now or utcnow()
    with session.begin():
        project(session, project_id, lock=True)
        operation = f"notification.transition:{notification_id}"
        old = replay(session, project_id, operation, data)
        if old:
            return old
        row = notification(session, project_id, notification_id)
        allowed, target = ALLOWED[data.action]
        until = data.snooze_until
        if until is not None and not (moment < until <= moment + MAX_SNOOZE):
            raise AppError("NOTICE_SNOOZE_INVALID", "请选择一年内的未来时间。", 422)
        previous = row.status
        change(
            session,
            row,
            data.expected_version,
            allowed,
            {"status": target, "snooze_until": until, "updated_at": moment},
        )
        append_event(
            session,
            row,
            cast(EventAction, EVENT_ACTIONS[data.action]),
            actor="student",
            from_status=previous,
            now=moment,
        )
        session.flush()
        result = read_rows(session, [row])[0]
        remember(session, project_id, operation, data, result)
        return result


def add_progress_note(
    session: Session,
    project_id: UUID,
    notification_id: UUID,
    data: ProgressNoteCreate,
    *,
    now: datetime | None = None,
) -> NotificationRead:
    """Keeps the student's words; never confirms a task or implies a mentor's approval."""
    moment = now or utcnow()
    with session.begin():
        project(session, project_id, lock=True)
        operation = f"notification.progress:{notification_id}"
        old = replay(session, project_id, operation, data)
        if old:
            return old
        row = notification(session, project_id, notification_id)
        previous = row.status
        change(
            session,
            row,
            data.expected_version,
            {"unread", "read"},
            {"status": "read", "updated_at": moment},
        )
        append_event(
            session,
            row,
            "progress_note",
            actor="student",
            from_status=previous,
            note=data.text,
            now=moment,
        )
        session.flush()
        result = read_rows(session, [row])[0]
        remember(session, project_id, operation, data, result)
        return result


def should_create(session: Session, project_id: UUID, item: Candidate, moment: datetime) -> bool:
    same_object = (
        Notification.project_id == project_id,
        Notification.kind == item.kind,
        Notification.object_id == item.object_id,
    )
    blocked = session.scalar(
        select(Notification.id)
        .where(
            *same_object,
            (Notification.dedupe_key == item.dedupe_key)
            | Notification.status.in_(OPEN_STATUSES)
            | (Notification.created_at > moment - timedelta(hours=COOLDOWN_HOURS)),
        )
        .limit(1)
    )
    return blocked is None


def refresh(session: Session, project_id: UUID, *, now: datetime | None = None) -> RefreshResult:
    """Idempotent: the same fact (kind, object, source version) is stored at most once."""
    moment = now or utcnow()
    with session.begin():
        owner = project(session, project_id, lock=True)
        enabled, quiet_start, quiet_end, _ = preferences(session)
        quiet = is_quiet(quiet_start, quiet_end, moment)
        alerting = enabled and not quiet
        woken = 0
        if alerting:
            due = session.scalars(
                select(Notification).where(
                    Notification.project_id == project_id,
                    Notification.status == "snoozed",
                    Notification.snooze_until <= moment,
                )
            ).all()
            for row in due:
                change(
                    session,
                    row,
                    row.version,
                    {"snoozed"},
                    {"status": "unread", "snooze_until": None, "updated_at": moment},
                )
                append_event(
                    session,
                    row,
                    "snooze_expired",
                    actor="system",
                    from_status="snoozed",
                    now=moment,
                )
                woken += 1
        created = 0
        if not owner.archived:
            for item in derive(session, owner, moment):
                if not should_create(session, project_id, item, moment):
                    continue
                delivery = "alerted" if alerting else ("quiet" if enabled else "muted")
                row = Notification(
                    project_id=project_id,
                    kind=item.kind,
                    object_type=item.object_type,
                    object_id=item.object_id,
                    parent_id=item.parent_id,
                    source_version=item.source_version,
                    dedupe_key=item.dedupe_key,
                    title=item.title,
                    trigger=item.trigger,
                    basis=item.basis,
                    uncertainty=item.uncertainty,
                    status="unread" if alerting else "read",
                    delivery=delivery,
                    snooze_until=None,
                    version=1,
                    created_at=moment,
                    updated_at=moment,
                )
                session.add(row)
                session.flush()
                append_event(session, row, "created", actor="system", from_status=None, now=moment)
                created += 1
        session.flush()
        return RefreshResult(
            project_id=project_id,
            created=created,
            woken=woken,
            unread_count=unread(session, project_id),
        )


def list_events(
    session: Session,
    project_id: UUID,
    *,
    notification_id: UUID | None,
    limit: int,
    offset: int,
) -> NotificationEventPage:
    with session.begin():
        project(session, project_id)
        query = (
            select(NotificationEvent, Notification)
            .join(Notification, Notification.id == NotificationEvent.notification_id)
            .where(NotificationEvent.project_id == project_id)
        )
        if notification_id is not None:
            notification(session, project_id, notification_id)
            query = query.where(NotificationEvent.notification_id == notification_id)
        total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = session.execute(
            query.order_by(
                NotificationEvent.created_at.desc(),
                NotificationEvent.version.desc(),
                NotificationEvent.id.desc(),
            )
            .limit(limit)
            .offset(offset)
        ).all()
        return NotificationEventPage(
            items=[
                NotificationEventRead(
                    id=event.id,
                    notification_id=event.notification_id,
                    notification_title=owner.title,
                    object=object_ref(owner),
                    version=event.version,
                    action=cast(EventAction, event.action),
                    actor=cast(Actor, event.actor),
                    from_status=cast(NotificationStatus | None, event.from_status),
                    to_status=cast(NotificationStatus, event.to_status),
                    snooze_until=aware(event.snooze_until) if event.snooze_until else None,
                    note=event.note,
                    created_at=aware(event.created_at),
                )
                for event, owner in rows
            ],
            total=total,
            limit=limit,
            offset=offset,
        )
