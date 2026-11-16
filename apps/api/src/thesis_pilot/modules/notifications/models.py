"""Notifications are derived facts; only delivery state is mutable, history is appended."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from thesis_pilot.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("project_id", "dedupe_key", name="uq_notifications_project_dedupe"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("source_version >= 0", name="source_version_nonnegative"),
        CheckConstraint(
            "kind IN ('task_due_soon','task_overdue','feedback_stale',"
            "'project_deadline','job_failed')",
            name="kind_supported",
        ),
        CheckConstraint(
            "object_type IN ('task','feedback_item','project','job')",
            name="object_type_supported",
        ),
        CheckConstraint(
            "status IN ('unread','read','snoozed','dismissed')", name="status_supported"
        ),
        CheckConstraint("delivery IN ('alerted','quiet','muted')", name="delivery_supported"),
        CheckConstraint(
            "(status = 'snoozed') = (snooze_until IS NOT NULL)", name="snooze_until_paired"
        ),
        Index("ix_notifications_project_status", "project_id", "status", "created_at"),
        Index("ix_notifications_project_object", "project_id", "kind", "object_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    kind: Mapped[str] = mapped_column(String(32))
    object_type: Mapped[str] = mapped_column(String(32))
    object_id: Mapped[UUID] = mapped_column(Uuid)
    # Owning container needed for deep links (feedback batch of an item); never a permission.
    parent_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)
    source_version: Mapped[int] = mapped_column(Integer)
    dedupe_key: Mapped[str] = mapped_column(String(160))
    title: Mapped[str] = mapped_column(String(300))
    trigger: Mapped[str] = mapped_column(String(500))
    basis: Mapped[list[str]] = mapped_column(JSON)
    uncertainty: Mapped[str] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(16), default="unread")
    delivery: Mapped[str] = mapped_column(String(16), default="alerted")
    snooze_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NotificationEvent(Base):
    """Append-only operation record; the service has no update or delete path."""

    __tablename__ = "notification_events"
    __table_args__ = (
        CheckConstraint(
            "action IN ('created','read','snooze','dismiss','restore',"
            "'progress_note','snooze_expired')",
            name="action_supported",
        ),
        CheckConstraint("actor IN ('student','system')", name="actor_supported"),
        CheckConstraint("version >= 1", name="version_positive"),
        Index("ix_notification_events_project_created", "project_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    notification_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("notifications.id", ondelete="RESTRICT"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(32))
    actor: Mapped[str] = mapped_column(String(16))
    from_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    to_status: Mapped[str] = mapped_column(String(16))
    snooze_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NotificationCommand(Base):
    __tablename__ = "notification_commands"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    operation: Mapped[str] = mapped_column(String(160))
    request_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
