"""Explicit API inputs prevent accidental writes to protected fields."""

from datetime import UTC, date, datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from thesis_pilot.modules.project_flows.schemas import StageId

ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ProjectTitle = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
ProjectNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)]


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ProjectName
    title: ProjectTitle = ""
    deadline: date | None = None
    planning_mode: Literal["none", "personal"] = "none"
    plan_note: ProjectNote = ""
    existing_artifacts: ProjectNote = ""
    archived: bool = Field(default=False, strict=True)
    flow_version_id: UUID | None = None
    stage_id: StageId | None = None

    @model_validator(mode="after")
    def complete_binding(self) -> Self:
        if (self.flow_version_id is None) != (self.stage_id is None):
            raise ValueError("请选择完整的流程版本与当前阶段。")
        return self


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1, strict=True)
    name: ProjectName | None = None
    title: ProjectTitle | None = None
    deadline: date | None = None
    planning_mode: Literal["none", "personal"] | None = None
    plan_note: ProjectNote | None = None
    existing_artifacts: ProjectNote | None = None
    archived: bool | None = Field(default=None, strict=True)
    flow_version_id: UUID | None = None
    stage_id: StageId | None = None

    @model_validator(mode="after")
    def explicit_changes(self) -> Self:
        fields = self.model_fields_set - {"expected_version"}
        if not fields:
            raise ValueError("请提供需要修改的项目字段。")
        nullable = {"deadline", "flow_version_id", "stage_id"}
        if any(getattr(self, field) is None for field in fields - nullable):
            raise ValueError("项目文本、规划模式及归档状态不能为 null。")
        return self


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    title: str
    deadline: date | None
    planning_mode: Literal["none", "personal"]
    plan_note: str
    existing_artifacts: str
    archived: bool
    flow_version_id: UUID | None
    stage_id: str | None
    version: int
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        # SQLite fast tests lose timezone metadata; stored timestamps are UTC.
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class ProjectPage(BaseModel):
    items: list[ProjectRead]
    total: int
    limit: int
    offset: int
