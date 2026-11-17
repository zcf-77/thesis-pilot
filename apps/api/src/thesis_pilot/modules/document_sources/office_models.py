"""SG-22 office-server imports: immutable preview facts and document ↔ original bindings."""

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
from sqlalchemy.orm import Mapped, deferred, mapped_column

from thesis_pilot.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class OfficeImport(Base):
    """One successful ``office_import`` job: the original's v2 snapshot and irMap."""

    __tablename__ = "office_imports"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    job_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), unique=True
    )
    attempt_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("job_attempts.id", ondelete="RESTRICT"), unique=True
    )
    material_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("materials.id", ondelete="RESTRICT"))
    original_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("material_originals.id", ondelete="RESTRICT")
    )
    original_sha256: Mapped[str] = mapped_column(String(64))
    filename: Mapped[str] = mapped_column(String(255))
    converter: Mapped[str] = mapped_column(String(32))
    snapshot: Mapped[dict[str, object]] = deferred(mapped_column(JSON, nullable=False))
    ir_map: Mapped[dict[str, object]] = deferred(mapped_column(JSON, nullable=False))
    losses: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False)
    summary: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DocumentOfficeSource(Base):
    """The manuscript version an import created; preserve-original export starts here."""

    __tablename__ = "document_office_sources"
    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "document_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_document_office_sources_document_version",
            ondelete="RESTRICT",
        ),
        CheckConstraint("document_version >= 1", name="version_positive"),
        CheckConstraint("mode IN ('create', 'new_version')", name="mode_supported"),
    )

    document_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    document_version: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    import_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("office_imports.id", ondelete="RESTRICT"), index=True
    )
    mode: Mapped[str] = mapped_column(String(16))
    command_id: Mapped[UUID] = mapped_column(Uuid, unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
