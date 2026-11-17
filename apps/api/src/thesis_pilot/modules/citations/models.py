"""Citation candidates (frozen against one base version) and their idempotent commands."""

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
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from thesis_pilot.db.base import Base
from thesis_pilot.modules.documents.models import utcnow


class CitationCandidate(Base):
    __tablename__ = "citation_candidates"
    __table_args__ = (
        UniqueConstraint("document_id", "id", name="uq_citation_candidates_document_id_id"),
        ForeignKeyConstraint(
            ["document_id", "base_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_citation_candidates_base_version",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["document_id", "result_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_citation_candidates_result_version",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "status IN ('ready', 'applied', 'rejected', 'undone')", name="status_supported"
        ),
        CheckConstraint("revision BETWEEN 1 AND 9007199254740991", name="revision_range"),
        CheckConstraint(
            "(status IN ('applied', 'undone')) = (result_version IS NOT NULL)",
            name="result_version_state",
        ),
        Index("ix_citation_candidates_document_created", "document_id", "created_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    document_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="RESTRICT"), nullable=False
    )
    base_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    entry_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("literature_entries.id", ondelete="RESTRICT"), nullable=False
    )
    entry_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    node_id: Mapped[str] = mapped_column(String(200), nullable=False)
    offset: Mapped[int] = mapped_column(BigInteger, nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False)
    ops_json: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False)
    preview_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    result_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    result_version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CitationCommand(Base):
    __tablename__ = "citation_commands"
    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "candidate_id"],
            ["citation_candidates.document_id", "citation_candidates.id"],
            name="fk_citation_commands_candidate",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "operation IN ('create', 'apply', 'reject', 'undo')", name="operation_supported"
        ),
        Index("ix_citation_commands_candidate_operation", "candidate_id", "operation"),
    )

    document_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="RESTRICT"), primary_key=True
    )
    command_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    operation: Mapped[str] = mapped_column(String(16), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    candidate_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    base_version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    result_version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
