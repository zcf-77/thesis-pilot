"""Strict, bounded manual task contracts; evidence identities come from the server."""

from datetime import date, datetime
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

from thesis_pilot.modules.revisions.schemas import ContentSelection

Version = Annotated[int, Field(ge=1, le=9007199254740991, strict=True)]
Nonblank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
TaskStatus = Literal["todo", "doing", "verify", "confirmed", "rework"]


class Dto(BaseModel):
    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)

    @field_validator("*")
    @classmethod
    def unicode_complete(cls, value: object) -> object:
        if isinstance(value, str) and any(0xD800 <= ord(c) <= 0xDFFF for c in value):
            raise ValueError("必须使用完整 Unicode 字符。")
        return value


class ChapterRef(Dto):
    document_id: UUID
    version: Version
    chapter_id: Nonblank


class DocumentEvidence(Dto):
    kind: Literal["document"]
    document_id: UUID
    version: Version
    selection: ContentSelection


class MaterialEvidence(Dto):
    kind: Literal["material"]
    material_id: UUID
    original_id: UUID
    parse_version_id: UUID
    anchor_ids: list[Nonblank] = Field(min_length=1, max_length=20)

    @field_validator("anchor_ids")
    @classmethod
    def distinct(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("来源锚点不能重复。")
        return value


EvidenceRef = Annotated[DocumentEvidence | MaterialEvidence, Field(discriminator="kind")]


class EvidenceSnapshot(Dto):
    reference: EvidenceRef
    label: str
    fingerprint: str
    stale: bool = False


class TaskContent(Dto):
    title: Nonblank
    description: str = Field(default="", max_length=4000, strict=True)
    acceptance: str = Field(min_length=1, max_length=4000, strict=True)
    start_date: date | None = None
    due_date: date | None = None
    hard_deadline: date | None = None
    depends_on: list[UUID] = Field(default_factory=list, max_length=100)
    chapter: ChapterRef | None = None
    evidence: list[EvidenceRef] = Field(default_factory=list, max_length=20)
    archived: bool = Field(default=False, strict=True)
    status: Literal["todo", "doing", "verify"] = "todo"

    @field_validator("start_date", "due_date", "hard_deadline", mode="before")
    @classmethod
    def date_input(cls, value: object) -> object:
        if value is not None and not isinstance(value, date | str):
            raise ValueError("日期必须使用 ISO 日期文本。")
        return value

    @model_validator(mode="after")
    def valid_content(self) -> Self:
        if not self.acceptance.strip():
            raise ValueError("请填写验收条件。")
        if len(set(self.depends_on)) != len(self.depends_on):
            raise ValueError("依赖任务不能重复。")
        dates = [d for d in (self.start_date, self.due_date, self.hard_deadline) if d is not None]
        if dates != sorted(dates):
            raise ValueError("开始、预计完成和硬截止日期顺序无效。")
        return self


class Command(Dto):
    command_id: UUID


class TaskCreate(Command):
    expected_board_version: int = Field(ge=0, le=9007199254740991, strict=True)
    content: TaskContent


class TaskUpdate(Command):
    expected_version: Version
    content: TaskContent


class TaskDecision(Command):
    expected_version: Version
    action: Literal["confirm", "rework", "reopen"]
    reason: str = Field(default="", max_length=2000, strict=True)

    @model_validator(mode="after")
    def reason_for_rework(self) -> Self:
        if self.action == "rework" and not self.reason.strip():
            raise ValueError("返工必须保留原因。")
        return self


class TaskReorder(Command):
    expected_board_version: int = Field(ge=0, le=9007199254740991, strict=True)
    task_ids: list[UUID] = Field(max_length=500)


class TaskRead(Dto):
    id: UUID
    project_id: UUID
    version: Version
    position: int
    origin: Literal["manual"] = "manual"
    status: TaskStatus
    content: TaskContent
    evidence_snapshots: list[EvidenceSnapshot]
    needs_review: bool
    review_reasons: list[str]
    created_at: datetime
    updated_at: datetime


class TaskSummary(Dto):
    id: UUID
    project_id: UUID
    version: Version
    position: int
    title: str
    status: TaskStatus
    archived: bool
    due_date: date | None
    needs_review: bool
    review_reasons: list[str]
    updated_at: datetime
    # SG-10 timeline fields; optional so earlier clients and fixtures stay valid.
    start_date: date | None = None
    hard_deadline: date | None = None
    depends_on: list[UUID] = Field(default_factory=list)


class TaskPage(Dto):
    items: list[TaskSummary]
    total: int
    limit: int
    offset: int
    board_version: int


class BoardRead(Dto):
    board_version: int
    task_ids: list[UUID]


class TaskVersionRead(Dto):
    version: Version
    action: str
    reason: str
    snapshot: TaskRead
    created_at: datetime


class TaskVersionPage(Dto):
    items: list[TaskVersionRead]
    total: int
    limit: int
    offset: int
