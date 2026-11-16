"""Append-only stage confirmation log; revocation adds a record and never deletes."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
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


class StageConfirmation(Base):
    __tablename__ = "stage_confirmations"
    __table_args__ = (
        UniqueConstraint("project_id", "sequence", name="uq_stage_confirmations_project_sequence"),
        UniqueConstraint("command_id", name="uq_stage_confirmations_command_id"),
        UniqueConstraint("revokes_id", name="uq_stage_confirmations_revokes_id"),
        CheckConstraint("sequence >= 1", name="sequence_positive"),
        CheckConstraint("kind IN ('confirm', 'revoke')", name="kind_supported"),
        CheckConstraint(
            "(kind = 'confirm' AND revokes_id IS NULL) OR "
            "(kind = 'revoke' AND revokes_id IS NOT NULL AND next_stage_id IS NULL)",
            name="kind_shape",
        ),
        CheckConstraint(
            "(document_id IS NULL AND document_version IS NULL) OR "
            "(document_id IS NOT NULL AND document_version IS NOT NULL)",
            name="document_pair",
        ),
        CheckConstraint("project_version_after >= 2", name="project_version_after_range"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    sequence: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(16))
    flow_version_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("project_flow_versions.id", ondelete="RESTRICT")
    )
    # The stage being confirmed, or whose confirmation is revoked.
    stage_id: Mapped[str] = mapped_column(String(80))
    # Confirm only: the next stage the student chose; null when none was available.
    next_stage_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # The project's stage after this command committed.
    resulting_stage_id: Mapped[str] = mapped_column(String(80))
    revokes_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("stage_confirmations.id", ondelete="RESTRICT"), nullable=True
    )
    document_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="RESTRICT"), nullable=True
    )
    document_version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    evidence: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    note: Mapped[str] = mapped_column(Text)
    project_version_after: Mapped[int] = mapped_column(Integer)
    command_id: Mapped[UUID] = mapped_column(Uuid)
    request_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
