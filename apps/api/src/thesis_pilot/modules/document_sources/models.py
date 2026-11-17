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
from thesis_pilot.modules.documents.structure import JsonObject


def utcnow() -> datetime:
    return datetime.now(UTC)


class DocumentSource(Base):
    __tablename__ = "document_sources"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="RESTRICT"), unique=True
    )
    material_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("materials.id", ondelete="RESTRICT"))
    original_version_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("material_originals.id", ondelete="RESTRICT")
    )
    parse_version_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("material_parse_versions.id", ondelete="RESTRICT")
    )
    original_sha256: Mapped[str] = mapped_column(String(64))
    manifest_sha256: Mapped[str] = mapped_column(String(64))
    import_command_id: Mapped[UUID] = mapped_column(Uuid, unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DocumentSourceVersion(Base):
    __tablename__ = "document_source_versions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "document_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_document_source_versions_document_version",
            ondelete="RESTRICT",
        ),
        CheckConstraint("document_version >= 1", name="version_positive"),
        CheckConstraint(
            "guard_version IN ('source-projection-v1', 'source-projection-v2', 'source-model-v2')",
            name="guard_version_supported",
        ),
    )

    document_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    document_version: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("document_sources.id", ondelete="RESTRICT"), index=True
    )
    guard_version: Mapped[str] = mapped_column(String(32), default="source-projection-v1")
    guard_contract: Mapped[JsonObject] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
