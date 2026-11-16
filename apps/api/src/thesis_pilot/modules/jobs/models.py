from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
        CheckConstraint(
            "kind IN ('diagnostic', 'document_inspection', "
            "'configuration_probe', 'material_parse', 'content_revision', 'review')",
            name="job_kind",
        ),
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
    input_snapshot: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    configuration: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    resource_scope: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    source_job_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=True
    )
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
    attempts: Mapped[list["JobAttempt"]] = relationship(order_by="JobAttempt.attempt")
    artifacts: Mapped[list["JobArtifact"]] = relationship(order_by="JobArtifact.created_at")


class JobAttempt(Base):
    __tablename__ = "job_attempts"
    __table_args__ = (
        UniqueConstraint("job_id", "attempt", name="uq_job_attempts_job_attempt"),
        CheckConstraint("attempt >= 1", name="job_attempt_positive"),
        CheckConstraint(
            "status IN ('running', 'succeeded', 'failed', 'cancelled', 'lease_expired')",
            name="job_attempt_status",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    job_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"))
    attempt: Mapped[int] = mapped_column()
    run_token: Mapped[UUID] = mapped_column(Uuid, unique=True)
    status: Mapped[str] = mapped_column(String(16))
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class JobArtifact(Base):
    __tablename__ = "job_artifacts"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('document_inspection', 'configuration_probe', "
            "'material_parse', 'content_revision', 'review')",
            name="job_artifact_kind",
        ),
        CheckConstraint("schema_version = 1", name="job_artifact_schema_version"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    job_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), unique=True
    )
    attempt_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("job_attempts.id", ondelete="RESTRICT"), unique=True
    )
    kind: Mapped[str] = mapped_column(String(32))
    schema_version: Mapped[int] = mapped_column()
    result: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


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
