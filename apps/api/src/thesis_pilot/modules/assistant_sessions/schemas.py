from datetime import UTC, datetime
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

from thesis_pilot.modules.documents.structure import JsonObject
from thesis_pilot.modules.jobs.schemas import JobRead, JobStatus
from thesis_pilot.modules.revisions.schemas import RevisionSelection

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
AnchorId = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class AssistantSessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Title
    role: Literal["content"] = "content"


class AssistantSessionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)
    title: Title | None = None
    archived: bool | None = Field(default=None, strict=True)

    @model_validator(mode="after")
    def explicit_update(self) -> Self:
        fields = self.model_fields_set - {"expected_version"}
        if not fields or any(getattr(self, key) is None for key in fields):
            raise ValueError("请提供非空的会话修改。")
        return self


class AssistantTimestamped(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    @field_validator("created_at", "updated_at", check_fields=False)
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class AssistantSessionRead(AssistantTimestamped):
    id: UUID
    project_id: UUID
    title: str
    role: Literal["content"]
    version: int
    archived: bool
    created_at: datetime
    updated_at: datetime


class AssistantSessionPage(BaseModel):
    items: list[AssistantSessionRead]
    total: int
    limit: int
    offset: int


class AssistantMessageRead(AssistantTimestamped):
    id: UUID
    session_id: UUID
    seq: int
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)
    run_id: UUID | None
    created_at: datetime


class AssistantMessagePage(BaseModel):
    items: list[AssistantMessageRead]
    total: int
    limit: int
    offset: int


class AssistantMaterialRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    material_id: UUID
    original_version_id: UUID
    parse_version_id: UUID
    anchor_ids: list[AnchorId] = Field(min_length=1, max_length=20)

    @field_validator("anchor_ids")
    @classmethod
    def distinct_anchors(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("资料片段不能重复。")
        return value


class AssistantLiteratureRef(BaseModel):
    """A saved project literature entry pinned at the version the student chose."""

    model_config = ConfigDict(extra="forbid")
    entry_id: UUID
    entry_version: int = Field(ge=1, le=9007199254740991, strict=True)


class AssistantContentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: UUID
    document_version: int = Field(ge=1, le=9007199254740991, strict=True)
    selection: RevisionSelection
    goal: Annotated[str, StringConstraints(min_length=1, max_length=2000, strict=True)]
    material_sources: list[AssistantMaterialRef] = Field(default_factory=list, max_length=10)
    literature_entries: list[AssistantLiteratureRef] = Field(default_factory=list, max_length=10)
    agent_config_version_id: UUID
    source_binding_version_id: UUID | None

    @field_validator("goal")
    @classmethod
    def complete_goal(cls, value: str) -> str:
        if "\x00" in value or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
            raise ValueError("目标包含不受支持的控制字符或不完整 Unicode。")
        return value

    @model_validator(mode="after")
    def explicit_content(self) -> Self:
        if not self.goal.strip() or not self.selection.text.strip():
            raise ValueError("请输入目标并明确选择非空正文。")
        sources = [item.parse_version_id for item in self.material_sources]
        if len(sources) != len(set(sources)):
            raise ValueError("同一解析版本请合并选择片段。")
        entries = [item.entry_id for item in self.literature_entries]
        if len(entries) != len(set(entries)):
            raise ValueError("同一文献只能加入一次。")
        return self


class AssistantRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    expected_session_version: int = Field(ge=1, strict=True)
    purpose: Literal["content_revision"] = "content_revision"
    input: AssistantContentInput


class AssistantRunCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID


class AssistantRunRead(AssistantTimestamped):
    id: UUID
    project_id: UUID
    session_id: UUID
    purpose: Literal["content_revision"]
    job_id: UUID
    status: JobStatus
    trigger_message_id: UUID
    result_message_id: UUID | None
    candidate_id: UUID | None
    source_run_id: UUID | None
    document_id: UUID
    document_version: int
    error_code: str | None
    created_at: datetime
    updated_at: datetime


class AssistantRunPage(BaseModel):
    items: list[AssistantRunRead]
    total: int
    limit: int
    offset: int


class AssistantRunReceipt(BaseModel):
    session: AssistantSessionRead
    message: AssistantMessageRead
    run: AssistantRunRead
    job: JobRead


class AssistantRunRetryReceipt(BaseModel):
    session: AssistantSessionRead
    run: AssistantRunRead
    job: JobRead


class AssistantRunContext(BaseModel):
    run_id: UUID
    input: AssistantContentInput
    context_snapshot: JsonObject
    configuration_snapshot: JsonObject
