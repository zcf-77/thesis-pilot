"""Literature search runs, immutable result snapshots and project literature entries."""

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


class LiteratureSearch(Base):
    __tablename__ = "literature_searches"
    __table_args__ = (
        CheckConstraint("source IN ('crossref', 'openalex')", name="source"),
        CheckConstraint("row_limit BETWEEN 1 AND 20", name="row_limit_bounded"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    job_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=True, unique=True
    )
    source_search_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("literature_searches.id", ondelete="RESTRICT"), nullable=True
    )
    command_id: Mapped[UUID] = mapped_column(Uuid, unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    query: Mapped[str] = mapped_column(String(300))
    source: Mapped[str] = mapped_column(String(16))
    year_from: Mapped[int | None] = mapped_column(Integer, nullable=True)
    year_to: Mapped[int | None] = mapped_column(Integer, nullable=True)
    row_limit: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LiteratureSearchSnapshot(Base):
    """What the source returned for one run; written once with the job terminal state."""

    __tablename__ = "literature_search_snapshots"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    search_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("literature_searches.id", ondelete="RESTRICT"), unique=True
    )
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    job_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), unique=True
    )
    source: Mapped[str] = mapped_column(String(16))
    adapter_version: Mapped[str] = mapped_column(String(64))
    response_sha256: Mapped[str] = mapped_column(String(64))
    total_results: Mapped[int] = mapped_column(BigInteger)
    skipped_count: Mapped[int] = mapped_column(Integer)
    items: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class LiteratureEntry(Base):
    __tablename__ = "literature_entries"
    __table_args__ = (
        UniqueConstraint("project_id", "dedupe_key", name="uq_literature_entries_dedupe"),
        CheckConstraint("coverage IN ('biblio', 'abstract')", name="coverage"),
        CheckConstraint(
            "verification IN ('verified', 'conflict', 'not_found', 'unverified')",
            name="verification",
        ),
        CheckConstraint("version >= 1", name="version_positive"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    command_id: Mapped[UUID] = mapped_column(Uuid, unique=True)
    dedupe_key: Mapped[str] = mapped_column(String(400))
    search_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("literature_searches.id", ondelete="RESTRICT")
    )
    snapshot_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("literature_search_snapshots.id", ondelete="RESTRICT")
    )
    result_index: Mapped[int] = mapped_column(Integer)
    record: Mapped[dict[str, object]] = mapped_column(JSON)
    doi: Mapped[str | None] = mapped_column(String(320), nullable=True)
    title: Mapped[str] = mapped_column(Text)
    coverage: Mapped[str] = mapped_column(String(16))
    verification: Mapped[str] = mapped_column(String(16))
    verification_detail: Mapped[dict[str, object]] = mapped_column(JSON)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    removed: Mapped[bool] = mapped_column(default=False)
    version: Mapped[int] = mapped_column(BigInteger, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LiteratureEntryVersion(Base):
    """Append-only history; removal and restore never delete earlier states."""

    __tablename__ = "literature_entry_versions"
    __table_args__ = (
        UniqueConstraint("entry_id", "version", name="uq_literature_entry_versions_version"),
        CheckConstraint("action IN ('saved', 'verified', 'removed', 'restored')", name="action"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    entry_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("literature_entries.id", ondelete="RESTRICT"), index=True
    )
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    version: Mapped[int] = mapped_column(BigInteger)
    action: Mapped[str] = mapped_column(String(16))
    removed: Mapped[bool] = mapped_column()
    verification: Mapped[str] = mapped_column(String(16))
    verification_detail: Mapped[dict[str, object]] = mapped_column(JSON)
    command_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
