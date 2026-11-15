from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from thesis_pilot.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class AssistantSession(Base):
    __tablename__ = "assistant_sessions"
    __table_args__ = (
        CheckConstraint("version >= 1 AND next_message_seq >= 1", name="version_positive"),
        CheckConstraint("role = 'content'", name="role_supported"),
        CheckConstraint("length(trim(title)) >= 1 AND length(title) <= 200", name="title_valid"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(16), default="content")
    version: Mapped[int] = mapped_column(BigInteger, default=1)
    next_message_seq: Mapped[int] = mapped_column(BigInteger, default=1)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"
    __table_args__ = (
        UniqueConstraint("session_id", "seq", name="uq_assistant_messages_session_seq"),
        CheckConstraint("seq >= 1", name="seq_positive"),
        CheckConstraint("role IN ('user', 'assistant')", name="role_supported"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("assistant_sessions.id", ondelete="RESTRICT"), index=True
    )
    seq: Mapped[int] = mapped_column(BigInteger)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    run_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("assistant_runs.id", ondelete="RESTRICT", use_alter=True),
        nullable=True,
        unique=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AssistantRun(Base):
    __tablename__ = "assistant_runs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "document_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_assistant_runs_document_version",
            ondelete="RESTRICT",
        ),
        CheckConstraint("purpose = 'content_revision'", name="purpose_supported"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    session_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("assistant_sessions.id", ondelete="RESTRICT"), index=True
    )
    purpose: Mapped[str] = mapped_column(String(32), default="content_revision")
    document_id: Mapped[UUID] = mapped_column(Uuid)
    document_version: Mapped[int] = mapped_column(BigInteger)
    trigger_message_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("assistant_messages.id", ondelete="RESTRICT")
    )
    job_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=True, unique=True
    )
    candidate_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("revision_candidates.id", ondelete="RESTRICT", use_alter=True),
        nullable=True,
        unique=True,
    )
    result_message_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("assistant_messages.id", ondelete="RESTRICT"), nullable=True, unique=True
    )
    source_run_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("assistant_runs.id", ondelete="RESTRICT"), nullable=True
    )
    command_id: Mapped[UUID] = mapped_column(Uuid, unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    input_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    context_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    configuration_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AssistantCommand(Base):
    __tablename__ = "assistant_commands"
    __table_args__ = (
        CheckConstraint(
            "operation IN ('create_run', 'cancel_run', 'retry_run')", name="operation_supported"
        ),
    )

    command_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    project_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("projects.id", ondelete="RESTRICT"))
    run_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("assistant_runs.id", ondelete="RESTRICT"))
    operation: Mapped[str] = mapped_column(String(16))
    request_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
