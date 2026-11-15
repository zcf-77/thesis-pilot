"""Project persistence and database-level invariants."""

from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from thesis_pilot.db.base import Base


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("length(trim(name)) >= 1", name="name_nonempty"),
        CheckConstraint("length(name) <= 200", name="name_length"),
        CheckConstraint("planning_mode IN ('none', 'personal')", name="planning_mode"),
        CheckConstraint(
            "(flow_version_id IS NULL AND stage_id IS NULL) OR "
            "(flow_version_id IS NOT NULL AND stage_id IS NOT NULL)",
            name="flow_binding_pair",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    planning_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="none")
    plan_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    existing_artifacts: Mapped[str] = mapped_column(Text, nullable=False, default="")
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    flow_version_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("project_flow_versions.id", ondelete="RESTRICT"), nullable=True
    )
    stage_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
