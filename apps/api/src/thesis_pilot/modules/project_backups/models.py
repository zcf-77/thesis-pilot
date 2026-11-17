"""Immutable backup packages and restore uploads; the owning Job holds status and attempts."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, deferred, mapped_column

from thesis_pilot.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class BackupArchive(Base):
    """One generated ``thesispilot-backup/1`` ZIP, stored once per successful backup job."""

    __tablename__ = "backup_archives"
    __table_args__ = (
        CheckConstraint("format = 'thesispilot-backup/1'", name="format_supported"),
        CheckConstraint("byte_size BETWEEN 1 AND 268435456", name="byte_size_bounded"),
    )

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
    format: Mapped[str] = mapped_column(String(32))
    schema_head: Mapped[str] = mapped_column(String(64))
    filename: Mapped[str] = mapped_column(String(200))
    sha256: Mapped[str] = mapped_column(String(64))
    package_sha256: Mapped[str] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(Integer)
    object_counts: Mapped[dict[str, int]] = mapped_column(JSON)
    data: Mapped[bytes] = deferred(mapped_column(LargeBinary, nullable=False))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProjectRestore(Base):
    """An uploaded package and its restore job. ``result_project_id`` is set only on success.

    The restore job carries no project until it commits the new copy, so a failed or
    cancelled restore never appears inside (or affects) any project.
    """

    __tablename__ = "project_restores"
    __table_args__ = (
        CheckConstraint("byte_size BETWEEN 1 AND 268435456", name="byte_size_bounded"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    job_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), unique=True
    )
    upload_key: Mapped[str] = mapped_column(String(128), unique=True)
    filename: Mapped[str] = mapped_column(String(200))
    sha256: Mapped[str] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(Integer)
    # Facts read from the validated manifest at upload time (display only).
    package_sha256: Mapped[str] = mapped_column(String(64))
    source_project_id: Mapped[UUID] = mapped_column(Uuid)
    source_project_name: Mapped[str] = mapped_column(String(200))
    schema_head: Mapped[str] = mapped_column(String(64))
    exported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    object_counts: Mapped[dict[str, int]] = mapped_column(JSON)
    result_project_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), nullable=True, unique=True
    )
    data: Mapped[bytes] = deferred(mapped_column(LargeBinary, nullable=False))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
