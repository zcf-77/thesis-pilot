"""Flow availability is mutable; each definition is an append-only snapshot."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from thesis_pilot.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class ProjectFlow(Base):
    __tablename__ = "project_flows"
    __table_args__ = (
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("length(trim(name)) >= 1", name="name_nonempty"),
        CheckConstraint("length(name) <= 200", name="name_length"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(200))
    version: Mapped[int] = mapped_column(Integer, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProjectFlowVersion(Base):
    __tablename__ = "project_flow_versions"
    __table_args__ = (
        UniqueConstraint("flow_id", "version", name="uq_project_flow_versions_flow_version"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("length(trim(name)) >= 1", name="name_nonempty"),
        CheckConstraint("length(name) <= 200", name="name_length"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    flow_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("project_flows.id", ondelete="RESTRICT"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(200))
    stages: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
