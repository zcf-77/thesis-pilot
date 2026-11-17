"""One current version pointer and append-only manuscript content."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from thesis_pilot.db.base import Base
from thesis_pilot.modules.documents.structure import JsonObject


def utcnow() -> datetime:
    return datetime.now(UTC)


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("project_id", name="uq_documents_project_id"),
        CheckConstraint("current_version BETWEEN 1 AND 9007199254740991", name="version_range"),
        ForeignKeyConstraint(
            ["id", "current_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_documents_current_version_document_versions",
            deferrable=True,
            initially="DEFERRED",
            use_alter=True,
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False
    )
    current_version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (
        CheckConstraint("version BETWEEN 1 AND 9007199254740991", name="version_range"),
        CheckConstraint("schema_version IN (1, 2)", name="schema_version_supported"),
        CheckConstraint(
            "source IN ('local_import', 'manual_edit', 'ai_adoption', "
            "'adoption_undo', 'version_revert', 'blank', 'schema_upgrade', 'office_import')",
            name="source_supported",
        ),
    )

    document_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="RESTRICT"), primary_key=True
    )
    version: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    content_json: Mapped[JsonObject] = mapped_column(JSON, nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DocumentSchemaUpgrade(Base):
    """One explicit, audited v1 → v2 upgrade per document (append-only)."""

    __tablename__ = "document_schema_upgrades"
    __table_args__ = (
        UniqueConstraint("document_id", name="uq_document_schema_upgrades_document_id"),
        UniqueConstraint("command_id", name="uq_document_schema_upgrades_command_id"),
        ForeignKeyConstraint(
            ["document_id", "from_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_document_schema_upgrades_from_version",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["document_id", "to_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_document_schema_upgrades_to_version",
            ondelete="RESTRICT",
        ),
        CheckConstraint("to_version = from_version + 1", name="next_version"),
        CheckConstraint(
            "from_schema_version = 1 AND to_schema_version = 2", name="schema_direction"
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="RESTRICT"), nullable=False
    )
    command_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    from_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    to_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    from_schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    to_schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    converter_version: Mapped[str] = mapped_column(String(64), nullable=False)
    converter_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    loss_report: Mapped[list[JsonObject]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DocumentResource(Base):
    """Content-addressed image bytes referenced from v2 models as ``tp-resource:<sha256>``."""

    __tablename__ = "document_resources"
    __table_args__ = (
        UniqueConstraint("project_id", "sha256", name="uq_document_resources_project_sha256"),
        CheckConstraint(
            "mime IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')",
            name="mime_supported",
        ),
        CheckConstraint("byte_size BETWEEN 1 AND 10485760", name="byte_size_range"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False
    )
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    mime: Mapped[str] = mapped_column(String(32), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    width_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
