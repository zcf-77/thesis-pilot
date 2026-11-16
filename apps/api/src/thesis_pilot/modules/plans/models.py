"""Append-only plan history and immutable adjustment candidates.

Tasks stay the single mutable truth for dates; a plan version is a whole snapshot written
only when the student adopts, reverts or batch-adjusts. Candidates and proposals never change.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
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


class PlanAdjustment(Base):
    __tablename__ = "plan_adjustments"
    __table_args__ = (CheckConstraint("base_plan_version >= 0", name="base_version_nonnegative"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    job_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=True, unique=True
    )
    command_id: Mapped[UUID] = mapped_column(Uuid, unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    agent_config_version_id: Mapped[UUID] = mapped_column(Uuid)
    base_plan_version: Mapped[int] = mapped_column(Integer)
    input_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    configuration_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PlanProposal(Base):
    __tablename__ = "plan_proposals"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    adjustment_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("plan_adjustments.id", ondelete="RESTRICT"), unique=True
    )
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    job_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), unique=True
    )
    requested_model: Mapped[str] = mapped_column(String(200))
    response_model: Mapped[str] = mapped_column(String(200))
    content: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PlanVersion(Base):
    __tablename__ = "plan_versions"
    __table_args__ = (
        UniqueConstraint("project_id", "version", name="uq_plan_versions_project_version"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("action IN ('adopt','revert','manual')", name="action_supported"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(String(500), default="")
    adjustment_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("plan_adjustments.id", ondelete="RESTRICT"), nullable=True
    )
    changes: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    tasks: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PlanDecision(Base):
    __tablename__ = "plan_decisions"
    __table_args__ = (
        UniqueConstraint("adjustment_id", "action", name="uq_plan_decisions_adjustment_action"),
        CheckConstraint("action IN ('adopt','keep','revert')", name="action_supported"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    adjustment_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("plan_adjustments.id", ondelete="RESTRICT"), index=True
    )
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), index=True
    )
    action: Mapped[str] = mapped_column(String(16))
    accepted_item_ids: Mapped[list[str]] = mapped_column(JSON)
    rejected_item_ids: Mapped[list[str]] = mapped_column(JSON)
    plan_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
