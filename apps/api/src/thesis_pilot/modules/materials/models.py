"""Metadata is mutable; original bytes and parse/binding snapshots are append-only."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, deferred, mapped_column

from thesis_pilot.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class Material(Base):
    __tablename__ = "materials"
    __table_args__ = (
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(
            "kind IN ('template', 'requirements', 'literature', 'other')", name="kind_supported"
        ),
        CheckConstraint("length(trim(name)) >= 1 AND length(name) <= 200", name="name_valid"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16))
    source_note: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    linked: Mapped[bool] = mapped_column(Boolean, default=True)
    removed: Mapped[bool] = mapped_column(Boolean, default=False)
    current_original_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("material_originals.id", ondelete="RESTRICT", use_alter=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MaterialOriginal(Base):
    __tablename__ = "material_originals"
    __table_args__ = (
        UniqueConstraint("material_id", "version", name="uq_material_originals_material_version"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("byte_size BETWEEN 1 AND 8388608", name="byte_size_bounded"),
        CheckConstraint("file_type IN ('docx', 'text', 'pdf')", name="file_type_supported"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    material_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("materials.id", ondelete="RESTRICT"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    filename: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(16))
    sha256: Mapped[str] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = deferred(mapped_column(LargeBinary, nullable=False))
    upload_key: Mapped[str] = mapped_column(String(128), unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    initial_job_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=True
    )
    latest_parse_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("material_parse_versions.id", ondelete="RESTRICT", use_alter=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MaterialParseVersion(Base):
    __tablename__ = "material_parse_versions"
    __table_args__ = (
        UniqueConstraint(
            "original_id", "version", name="uq_material_parse_versions_original_version"
        ),
        CheckConstraint("version >= 1", name="version_positive"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    original_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("material_originals.id", ondelete="RESTRICT"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="complete")
    source_job_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), unique=True
    )
    content: Mapped[dict[str, object]] = deferred(mapped_column(JSON, nullable=False))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProjectSourceBinding(Base):
    __tablename__ = "project_source_bindings"
    __table_args__ = (CheckConstraint("version >= 1", name="version_positive"),)

    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), primary_key=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    current_version_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("project_source_binding_versions.id", ondelete="RESTRICT", use_alter=True),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProjectSourceBindingVersion(Base):
    __tablename__ = "project_source_binding_versions"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "version", name="uq_project_source_binding_versions_project_version"
        ),
        CheckConstraint("version >= 1", name="version_positive"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    template_parse_version_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("material_parse_versions.id", ondelete="RESTRICT"), nullable=True
    )
    requirement_parse_version_ids: Mapped[list[str]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
