"""Immutable rendered files; the owning Job holds status, attempts and the artifact summary."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
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


class ExportFile(Base):
    __tablename__ = "export_files"
    __table_args__ = (
        CheckConstraint("kind IN ('document_export', 'change_record')", name="kind_supported"),
        CheckConstraint(
            "format IN ('html', 'txt', 'markdown', 'docx', 'pdf')", name="format_supported"
        ),
        # Text exports stay ≤ 8 MiB in the service; Word/PDF may reach 64 MiB.
        CheckConstraint("byte_size BETWEEN 1 AND 67108864", name="byte_size_bounded"),
        CheckConstraint("document_version >= 1", name="version_positive"),
        CheckConstraint(
            "(kind = 'change_record') = (from_version IS NOT NULL)", name="range_reference"
        ),
        CheckConstraint(
            "from_version IS NULL OR from_version BETWEEN 1 AND document_version",
            name="range_ordered",
        ),
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
    kind: Mapped[str] = mapped_column(String(32))
    format: Mapped[str] = mapped_column(String(16))
    document_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("documents.id", ondelete="RESTRICT"))
    # For a change record this is the inclusive end of the fixed range.
    document_version: Mapped[int] = mapped_column(BigInteger)
    from_version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    filename: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(128))
    sha256: Mapped[str] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = deferred(mapped_column(LargeBinary, nullable=False))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
