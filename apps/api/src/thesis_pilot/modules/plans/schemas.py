"""Strict plan contracts. Candidate items are produced and verified by the server only."""

from datetime import UTC, date, datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from thesis_pilot.modules.jobs.schemas import JobRead, JobStatus
from thesis_pilot.modules.tasks.schemas import Command, Dto, TaskStatus, Version

ItemId = Annotated[str, Field(pattern=r"^A[1-9][0-9]{0,2}$")]
PlanAction = Literal["adopt", "revert", "manual"]
ViolationCode = Literal[
    "UNKNOWN_TASK",
    "ARCHIVED_TASK",
    "CONFIRMED_TASK",
    "DUPLICATE",
    "INVALID_DATE",
    "NO_CHANGE",
    "DATE_ORDER",
    "PAST_DATE",
    "HARD_DEADLINE",
    "PROJECT_DEADLINE",
    "DEPENDENCY_ORDER",
]
AdjustmentState = Literal[
    "queued", "running", "failed", "cancelled", "pending", "expired", "adopted", "kept", "reverted"
]


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class DateRange(Dto):
    start_date: date | None
    due_date: date | None


class PlanTaskState(Dto):
    task_id: UUID
    version: Version
    position: int
    title: str
    status: TaskStatus
    archived: bool
    start_date: date | None
    due_date: date | None
    hard_deadline: date | None
    depends_on: list[UUID]


class PlanChange(Dto):
    task_id: UUID
    title: str
    before: DateRange
    after: DateRange
    before_version: Version
    after_version: Version


class PlanVersionRead(Dto):
    project_id: UUID
    version: Version
    action: PlanAction
    reason: str
    adjustment_id: UUID | None
    changes: list[PlanChange]
    tasks: list[PlanTaskState]
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)


class PlanVersionPage(Dto):
    items: list[PlanVersionRead]
    total: int
    limit: int
    offset: int


class PlanRead(Dto):
    project_id: UUID
    plan_version: int
    deadline: date | None
    planning_mode: Literal["none", "personal"]
    latest_adjustment_id: UUID | None


class ScheduleChange(Dto):
    task_id: UUID
    expected_version: Version
    start_date: date | None
    due_date: date | None


class PlanSchedule(Command):
    changes: list[ScheduleChange] = Field(min_length=1, max_length=100)
    reason: str = Field(default="", max_length=500, strict=True)

    @model_validator(mode="after")
    def distinct_tasks(self) -> Self:
        if len({item.task_id for item in self.changes}) != len(self.changes):
            raise ValueError("同一任务只能出现一次。")
        return self


class PlanAdjustmentCreate(Dto):
    command_id: UUID
    agent_config_version_id: UUID


class PlanAdjustmentDecide(Command):
    action: Literal["adopt", "keep"]
    accepted_item_ids: list[ItemId] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def valid_selection(self) -> Self:
        if len(set(self.accepted_item_ids)) != len(self.accepted_item_ids):
            raise ValueError("采纳条目不能重复。")
        if self.action == "adopt" and not self.accepted_item_ids:
            raise ValueError("请至少选择一项调整再采纳。")
        if self.action == "keep" and self.accepted_item_ids:
            raise ValueError("保留原计划时不能同时采纳条目。")
        return self


class PlanAdjustmentRevert(Command):
    pass


class PlanViolation(Dto):
    code: ViolationCode
    message: str


class PlanAdjustmentItem(Dto):
    id: ItemId
    task_key: str
    task_id: UUID | None
    title: str
    base_version: int | None
    before: DateRange
    after: DateRange
    reason: str
    blocked: bool
    violations: list[PlanViolation]


class PlanProposalContent(Dto):
    schema_version: Literal[1]
    summary: str
    items: list[PlanAdjustmentItem]
    notes: list[str]


class PlanDecisionRead(Dto):
    action: Literal["adopt", "keep", "revert"]
    accepted_item_ids: list[str]
    rejected_item_ids: list[str]
    plan_version: int | None
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)


class PlanAdjustmentRead(Dto):
    id: UUID
    project_id: UUID
    job_id: UUID
    status: JobStatus
    state: AdjustmentState
    error_code: str | None
    attempt: int
    base_plan_version: int
    agent_config_version_id: UUID
    agent_name: str
    config_version_ids: dict[str, UUID]
    deadline: date | None
    planning_mode: Literal["none", "personal"]
    task_count: int
    requested_model: str | None
    response_model: str | None
    proposal: PlanProposalContent | None
    decision: PlanDecisionRead | None
    revert: PlanDecisionRead | None
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)


class PlanAdjustmentPage(Dto):
    items: list[PlanAdjustmentRead]
    total: int
    limit: int
    offset: int


class PlanAdjustmentReceipt(BaseModel):
    adjustment: PlanAdjustmentRead
    job: JobRead


# --- Model reply contract. Dates stay text so invalid values become blocked items.
class PlanModelChange(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    task: Annotated[str, Field(min_length=1, max_length=20)]
    start_date: Annotated[str, Field(max_length=40)] | None = None
    due_date: Annotated[str, Field(max_length=40)] | None = None
    reason: Annotated[str, Field(min_length=1, max_length=500)]


class PlanModelReply(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    summary: Annotated[str, Field(min_length=1, max_length=1000)]
    changes: list[PlanModelChange] = Field(max_length=100)


class PlanCompletion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reply: PlanModelReply
    requested_model: Annotated[str, Field(min_length=1, max_length=200)]
    response_model: Annotated[str, Field(min_length=1, max_length=200)]
