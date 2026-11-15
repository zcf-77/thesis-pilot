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


class AIConfig(Base):
    __tablename__ = "ai_configs"
    __table_args__ = (
        UniqueConstraint("kind", "name", name="uq_ai_configs_kind_name"),
        CheckConstraint("kind IN ('api', 'model', 'prompt', 'agent')", name="kind_supported"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("length(trim(name)) >= 1", name="name_nonempty"),
        CheckConstraint("length(name) <= 200", name="name_length"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    kind: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(200))
    version: Mapped[int] = mapped_column(Integer, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AIConfigVersion(Base):
    __tablename__ = "ai_config_versions"
    __table_args__ = (
        UniqueConstraint("config_id", "version", name="uq_ai_config_versions_config_version"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("length(trim(name)) >= 1", name="name_nonempty"),
        CheckConstraint("length(name) <= 200", name="name_length"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    config_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("ai_configs.id", ondelete="RESTRICT"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(200))
    content: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
