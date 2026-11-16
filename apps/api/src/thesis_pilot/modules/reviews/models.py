"""Independent review runs and immutable reports; neither references a write path."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from thesis_pilot.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class ReviewRun(Base):
    __tablename__ = "review_runs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "document_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_review_runs_document_version",
            ondelete="RESTRICT",
        ),
        CheckConstraint("document_version >= 1", name="document_version_positive"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    job_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=True, unique=True
    )
    source_review_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("review_runs.id", ondelete="RESTRICT"), nullable=True
    )
    command_id: Mapped[UUID] = mapped_column(Uuid, unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    document_id: Mapped[UUID] = mapped_column(Uuid)
    document_version: Mapped[int] = mapped_column(BigInteger)
    chapter_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rubric_version: Mapped[str] = mapped_column(String(64))
    agent_config_version_id: Mapped[UUID] = mapped_column(Uuid)
    input_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    context_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    configuration_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ReviewReport(Base):
    __tablename__ = "review_reports"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    review_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("review_runs.id", ondelete="RESTRICT"), unique=True
    )
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    job_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), unique=True
    )
    requested_model: Mapped[str] = mapped_column(String(200))
    response_model: Mapped[str] = mapped_column(String(200))
    content: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
