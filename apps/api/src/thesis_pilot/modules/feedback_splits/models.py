"""Frozen split runs, immutable suggestions and an append-only decision log."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from thesis_pilot.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class FeedbackSplitRun(Base):
    __tablename__ = "feedback_split_runs"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    batch_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("feedback_batches.id", ondelete="RESTRICT"), index=True
    )
    job_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=True, unique=True
    )
    source_split_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("feedback_split_runs.id", ondelete="RESTRICT"), nullable=True
    )
    command_id: Mapped[UUID] = mapped_column(Uuid, unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    original_sha256: Mapped[str] = mapped_column(String(64))
    agent_config_version_id: Mapped[UUID] = mapped_column(Uuid)
    context_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    configuration_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FeedbackSplitSuggestion(Base):
    """One model proposal; never edited. Decisions are separate rows."""

    __tablename__ = "feedback_split_suggestions"
    __table_args__ = (
        CheckConstraint("range_from >= 0 AND range_to > range_from", name="range_ordered"),
        CheckConstraint("certainty IN ('certain','uncertain')", name="certainty_supported"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    split_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("feedback_split_runs.id", ondelete="RESTRICT"), index=True
    )
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    batch_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("feedback_batches.id", ondelete="RESTRICT")
    )
    job_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"))
    position: Mapped[int] = mapped_column(Integer)
    range_from: Mapped[int] = mapped_column(Integer)
    range_to: Mapped[int] = mapped_column(Integer)
    range_text: Mapped[str] = mapped_column(Text)
    interpretation: Mapped[str] = mapped_column(Text)
    certainty: Mapped[str] = mapped_column(String(16))
    ambiguous: Mapped[bool] = mapped_column()
    task_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FeedbackSplitDecision(Base):
    """Append-only student decisions; the latest version is the suggestion's state."""

    __tablename__ = "feedback_split_decisions"
    __table_args__ = (
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(
            "action IN ('adopt','adopt_modified','reject','undo')", name="action_supported"
        ),
    )

    suggestion_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("feedback_split_suggestions.id", ondelete="RESTRICT"), primary_key=True
    )
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    action: Mapped[str] = mapped_column(String(16))
    feedback_item_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("feedback_items.id", ondelete="RESTRICT"), nullable=True
    )
    reason: Mapped[str] = mapped_column(String(2000), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
