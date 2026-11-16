"""Immutable format inputs and command receipts; mutable review state uses CAS."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from thesis_pilot.db.base import Base
from thesis_pilot.modules.documents.models import utcnow
from thesis_pilot.modules.documents.structure import JsonObject


class FormatCandidate(Base):
    __tablename__ = "format_candidates"
    __table_args__ = (
        UniqueConstraint("document_id", "id", name="uq_format_candidates_document_id_id"),
        ForeignKeyConstraint(
            ["document_id", "base_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_format_candidates_base_version",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["document_id", "result_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_format_candidates_result_version",
            ondelete="RESTRICT",
        ),
        CheckConstraint("revision BETWEEN 1 AND 9007199254740991", name="revision_range"),
        CheckConstraint("status IN ('ready', 'applied', 'undone')", name="status_supported"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("documents.id", ondelete="RESTRICT"))
    base_version: Mapped[int] = mapped_column(BigInteger)
    input_json: Mapped[JsonObject] = mapped_column(JSON)
    patches_json: Mapped[list[JsonObject]] = mapped_column(JSON)
    source_snapshot: Mapped[JsonObject] = mapped_column(JSON)
    decisions_json: Mapped[list[JsonObject]] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(BigInteger, default=1)
    status: Mapped[str] = mapped_column(String(16), default="ready")
    result_version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FormatCommandReceipt(Base):
    __tablename__ = "format_commands"
    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "candidate_id"],
            ["format_candidates.document_id", "format_candidates.id"],
            name="fk_format_commands_candidate",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["document_id", "base_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_format_commands_base_version",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["document_id", "result_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_format_commands_result_version",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["document_id", "reverses_command_id"],
            ["format_commands.document_id", "format_commands.command_id"],
            name="fk_format_commands_reverses",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("document_id", "reverses_command_id", name="uq_format_commands_reversal"),
        CheckConstraint(
            "operation IN ('create', 'decide', 'apply', 'undo')", name="operation_supported"
        ),
        CheckConstraint(
            "candidate_revision BETWEEN 1 AND 9007199254740991", name="candidate_revision_range"
        ),
        CheckConstraint(
            "(operation = 'undo') = (reverses_command_id IS NOT NULL)", name="undo_reference"
        ),
    )
    document_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="RESTRICT"), primary_key=True
    )
    command_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    candidate_id: Mapped[UUID] = mapped_column(Uuid)
    candidate_revision: Mapped[int] = mapped_column(BigInteger)
    operation: Mapped[str] = mapped_column(String(16))
    request_hash: Mapped[str] = mapped_column(String(64))
    request_json: Mapped[JsonObject] = mapped_column(JSON)
    base_version: Mapped[int] = mapped_column(BigInteger)
    result_version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reverses_command_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
