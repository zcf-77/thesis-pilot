"""Immutable proposal/command facts and a versioned candidate review state."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from thesis_pilot.db.base import Base
from thesis_pilot.modules.documents.models import utcnow
from thesis_pilot.modules.documents.structure import JsonObject


class RevisionCandidate(Base):
    __tablename__ = "revision_candidates"
    __table_args__ = (
        UniqueConstraint("document_id", "id", name="uq_revision_candidates_document_id_id"),
        ForeignKeyConstraint(
            ["document_id", "base_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_revision_candidates_base_version",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["document_id", "result_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_revision_candidates_result_version",
            ondelete="RESTRICT",
        ),
        CheckConstraint("revision BETWEEN 1 AND 9007199254740991", name="revision_range"),
        CheckConstraint(
            "status IN ('generating', 'ready', 'invalid', 'cancelled', 'applied', 'undone')",
            name="status_supported",
        ),
        CheckConstraint("producer = 'deterministic_preview'", name="producer_supported"),
        Index("ix_revision_candidates_document_created", "document_id", "created_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="RESTRICT"), nullable=False
    )
    base_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    input_json: Mapped[JsonObject] = mapped_column(JSON, nullable=False)
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False)
    policy_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    generation_token: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    producer: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    decisions_json: Mapped[list[JsonObject]] = mapped_column(JSON, nullable=False, default=list)
    result_version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RevisionProposal(Base):
    __tablename__ = "revision_proposals"

    candidate_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("revision_candidates.id", ondelete="RESTRICT"), primary_key=True
    )
    patches_json: Mapped[list[JsonObject]] = mapped_column(JSON, nullable=False)
    checks_json: Mapped[list[JsonObject]] = mapped_column(JSON, nullable=False)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RevisionCommand(Base):
    __tablename__ = "revision_commands"
    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "candidate_id"],
            ["revision_candidates.document_id", "revision_candidates.id"],
            name="fk_revision_commands_candidate",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["document_id", "base_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_revision_commands_base_version",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["document_id", "result_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_revision_commands_result_version",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["document_id", "reverses_command_id"],
            ["revision_commands.document_id", "revision_commands.command_id"],
            name="fk_revision_commands_reverses",
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "document_id", "reverses_command_id", name="uq_revision_commands_reversal"
        ),
        CheckConstraint(
            "operation IN ('create', 'proposal', 'decide', 'apply', 'cancel', 'undo', 'revert')",
            name="operation_supported",
        ),
        CheckConstraint(
            "candidate_revision IS NULL OR candidate_revision BETWEEN 1 AND 9007199254740991",
            name="candidate_revision_range",
        ),
        CheckConstraint(
            "(operation = 'undo') = (reverses_command_id IS NOT NULL)", name="undo_reference"
        ),
        Index("ix_revision_commands_candidate_operation", "candidate_id", "operation"),
    )

    document_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="RESTRICT"), primary_key=True
    )
    command_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    operation: Mapped[str] = mapped_column(String(16), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    request_json: Mapped[JsonObject] = mapped_column(JSON, nullable=False)
    candidate_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)
    candidate_revision: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    base_version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    result_version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reverses_command_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
