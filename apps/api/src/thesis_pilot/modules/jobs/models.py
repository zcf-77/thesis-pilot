from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from thesis_pilot.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')",
            name="job_status",
        ),
        CheckConstraint("kind = 'diagnostic'", name="job_kind"),
        CheckConstraint("attempt >= 0", name="job_attempt_nonnegative"),
        Index("ix_jobs_status_lease_until", "status", "lease_until"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    kind: Mapped[str] = mapped_column(String(32), default="diagnostic")
    status: Mapped[str] = mapped_column(String(16), default="queued")
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    attempt: Mapped[int] = mapped_column(default=0)
    run_token: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    execution_deadline_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    result: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OutboxEvent(Base):
    __tablename__ = "outbox_events"
    __table_args__ = (
        CheckConstraint("attempts >= 0", name="outbox_attempts_nonnegative"),
        Index("ix_outbox_due", "next_attempt_at", "published_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    job_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), unique=True
    )
    attempts: Mapped[int] = mapped_column(default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
