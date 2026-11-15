"""Bounded, explicit flow definitions; stage position never means completion."""

from datetime import UTC, date, datetime
from typing import Annotated, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

FlowName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
StageId = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$"
    ),
]
StageText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]
StageRequirement = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
]


class FlowStage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: StageId
    name: FlowName
    description: StageText = ""
    deliverables: list[StageRequirement] = Field(max_length=50)
    conditions: list[StageRequirement] = Field(max_length=50)
    dependencies: list[StageId] = Field(default_factory=list, max_length=50)
    enabled: bool = Field(default=True, strict=True)
    start: date | None = None
    deadline: date | None = None

    @model_validator(mode="after")
    def valid_stage(self) -> Self:
        if self.enabled and (not self.deliverables or not self.conditions):
            raise ValueError("启用阶段必须填写所需产物与完成条件。")
        if len(set(self.dependencies)) != len(self.dependencies):
            raise ValueError("阶段前置关系不能重复。")
        if self.id in self.dependencies:
            raise ValueError("阶段不能依赖自身。")
        if self.start and self.deadline and self.start > self.deadline:
            raise ValueError("阶段开始日期不能晚于截止日期。")
        return self


Stages = Annotated[list[FlowStage], Field(min_length=1, max_length=50)]


def validate_stages(stages: list[FlowStage]) -> list[FlowStage]:
    by_id = {stage.id: stage for stage in stages}
    if len(by_id) != len(stages):
        raise ValueError("阶段标识不能重复。")
    if len({stage.name for stage in stages}) != len(stages):
        raise ValueError("阶段名称不能重复。")
    if not any(stage.enabled for stage in stages):
        raise ValueError("流程至少需要一个启用阶段。")
    for stage in stages:
        for dependency in stage.dependencies:
            previous = by_id.get(dependency)
            if previous is None or (stage.enabled and not previous.enabled):
                raise ValueError("前置阶段不存在或已停用。")
            if (
                stage.enabled
                and stage.deadline
                and previous.deadline
                and previous.deadline > stage.deadline
            ):
                raise ValueError("阶段截止日期不能早于前置阶段。")
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(stage_id: str) -> None:
        if stage_id in visiting:
            raise ValueError("阶段依赖存在循环。")
        if stage_id in visited:
            return
        visiting.add(stage_id)
        for dependency in by_id[stage_id].dependencies:
            visit(dependency)
        visiting.remove(stage_id)
        visited.add(stage_id)

    for stage in stages:
        visit(stage.id)
    return stages


class FlowCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: FlowName
    stages: Stages

    @field_validator("stages")
    @classmethod
    def valid_stages(cls, value: list[FlowStage]) -> list[FlowStage]:
        return validate_stages(value)


class FlowUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1, strict=True)
    name: FlowName | None = None
    stages: Stages | None = None
    enabled: bool | None = Field(default=None, strict=True)

    @model_validator(mode="after")
    def valid_update(self) -> Self:
        fields = self.model_fields_set - {"expected_version"}
        if not fields or any(getattr(self, field) is None for field in fields):
            raise ValueError("请提供非空的流程修改。")
        if self.stages is not None:
            validate_stages(self.stages)
        return self


class FlowVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    flow_id: UUID
    version: int
    name: str
    stages: list[FlowStage]
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class FlowRead(BaseModel):
    id: UUID
    name: str
    version: int
    enabled: bool
    current_version_id: UUID
    stages: list[FlowStage]
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class FlowPage(BaseModel):
    items: list[FlowRead]
    total: int
    limit: int
    offset: int


class FlowVersionPage(BaseModel):
    items: list[FlowVersionRead]
    total: int
    limit: int
    offset: int
