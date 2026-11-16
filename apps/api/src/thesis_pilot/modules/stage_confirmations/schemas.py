"""Strict stage confirmation contracts; derived facts are read-only and never confirm."""

from datetime import UTC, datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from thesis_pilot.modules.project_flows.schemas import FlowStage, StageId
from thesis_pilot.modules.projects.schemas import ProjectRead

Version = Annotated[int, Field(ge=1, le=9007199254740991, strict=True)]


class Dto(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*")
    @classmethod
    def unicode_complete(cls, value: object) -> object:
        if isinstance(value, str) and any(0xD800 <= ord(c) <= 0xDFFF for c in value):
            raise ValueError("必须使用完整 Unicode 字符。")
        return value


def utc(value: datetime) -> datetime:
    # SQLite fast tests lose timezone metadata; stored timestamps are UTC.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class EvidenceTaskRef(Dto):
    task_id: UUID
    version: Version


class StageConfirm(Dto):
    command_id: UUID
    expected_project_version: Version
    flow_version_id: UUID
    stage_id: StageId
    # The manuscript version the student reviewed; null only when no manuscript exists.
    document_version: Version | None = None
    evidence: list[EvidenceTaskRef] = Field(default_factory=list, max_length=50)
    note: str = Field(min_length=1, max_length=2000, strict=True)
    next_stage_id: StageId | None = None

    @model_validator(mode="after")
    def valid_confirmation(self) -> Self:
        if not self.note.strip():
            raise ValueError("请记录本次核对的产物或线下依据。")
        if len({item.task_id for item in self.evidence}) != len(self.evidence):
            raise ValueError("依据任务不能重复。")
        if self.next_stage_id == self.stage_id:
            raise ValueError("下一阶段不能是当前阶段。")
        return self


class StageRevoke(Dto):
    command_id: UUID
    expected_project_version: Version
    note: str = Field(default="", max_length=2000, strict=True)


class EvidenceTaskSnapshot(Dto):
    task_id: UUID
    version: Version
    title: str


class StageConfirmationRead(Dto):
    id: UUID
    project_id: UUID
    sequence: int
    kind: Literal["confirm", "revoke"]
    flow_version_id: UUID
    stage_id: str
    stage_name: str
    next_stage_id: str | None
    resulting_stage_id: str
    resulting_stage_name: str
    revokes_id: UUID | None
    revoked_by_id: UUID | None
    document_id: UUID | None
    document_version: int | None
    evidence: list[EvidenceTaskSnapshot]
    note: str
    project_version_after: int
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return utc(value)


class StageConfirmationPage(Dto):
    items: list[StageConfirmationRead]
    total: int
    limit: int
    offset: int


class StageCommandRead(Dto):
    confirmation: StageConfirmationRead
    project: ProjectRead


class StagePrerequisite(Dto):
    stage_id: str
    name: str
    confirmed: bool


class StageOption(Dto):
    id: str
    name: str


class DeliverableFact(Dto):
    """Read-only facts. A matching task or material never confirms the stage."""

    name: str
    status: Literal["confirmed_task", "material", "none"]
    task_ids: list[UUID]
    material_ids: list[UUID]


class EvidenceCandidate(Dto):
    task_id: UUID
    version: Version
    title: str


class StageRouteItem(Dto):
    id: str
    name: str
    state: Literal["confirmed", "current", "upcoming"]
    start: str | None
    deadline: str | None
    confirmation_id: UUID | None


class CurrentStageRead(Dto):
    stage: FlowStage
    confirmed: bool
    confirmation_id: UUID | None
    entered_at: datetime | None
    prerequisites: list[StagePrerequisite]
    prerequisites_met: bool
    deliverables: list[DeliverableFact]
    next_stages: list[StageOption]

    @field_validator("entered_at")
    @classmethod
    def utc_timestamp(cls, value: datetime | None) -> datetime | None:
        return None if value is None else utc(value)


class DocumentPointer(Dto):
    document_id: UUID
    version: Version


class StageProgressRead(Dto):
    project_id: UUID
    project_version: Version
    binding: Literal["unbound", "ready", "invalid"]
    flow_id: UUID | None
    flow_version_id: UUID | None
    flow_version: int | None
    flow_name: str | None
    stage_id: str | None
    stages: list[StageRouteItem]
    current: CurrentStageRead | None
    document: DocumentPointer | None
    evidence_candidates: list[EvidenceCandidate]
    revocable_id: UUID | None
