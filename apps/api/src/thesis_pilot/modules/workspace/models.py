from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from thesis_pilot.db.base import Base


class WorkspaceProfile(Base):
    __tablename__ = "workspace_profiles"
    __table_args__ = (
        CheckConstraint("singleton = 1", name="singleton_one"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("length(trim(display_name)) >= 1", name="display_name_nonempty"),
        CheckConstraint("length(display_name) <= 80", name="display_name_length"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    singleton: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, default=1)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False, default="我")
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    quiet_start: Mapped[str] = mapped_column(String(5), nullable=False, default="22:00")
    quiet_end: Mapped[str] = mapped_column(String(5), nullable=False, default="08:00")
    show_deferred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class WorkspaceSession(Base):
    __tablename__ = "workspace_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspace_profiles.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
