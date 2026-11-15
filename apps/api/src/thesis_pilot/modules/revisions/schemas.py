"""Bounded revision DTOs. Positions are ProseMirror UTF-16 offsets."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from thesis_pilot.modules.documents.schemas import Timestamped, VersionNumber
from thesis_pilot.modules.documents.structure import MAX_SAFE_INTEGER

MAX_REVISION_BYTES = 256 * 1024
MAX_SELECTION_UNITS = 32768
POLICY_VERSION = "text-protection-v1"
Position = Annotated[int, Field(ge=0, le=MAX_SAFE_INTEGER, strict=True)]
RevisionStatus = Literal[
    "generating", "ready", "invalid", "cancelled", "applied", "undone", "failed"
]
RevisionOperation = Literal["create", "proposal", "decide", "apply", "cancel", "undo", "revert"]
DecisionValue = Literal["pending", "accepted", "rejected"]
RuleName = Literal[
    "version", "range", "number", "citation", "formula", "lock", "overlap", "structure"
]


class RevisionDto(BaseModel):
    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)

    @field_validator("*")
    @classmethod
    def complete_unicode(cls, value: object) -> object:
        if isinstance(value, str) and any(0xD800 <= ord(char) <= 0xDFFF for char in value):
            raise ValueError("文本包含不完整的 Unicode 字符。")
        return value


class RevisionSelection(RevisionDto):
    textblock_path: list[Annotated[int, Field(ge=0, le=100000, strict=True)]] = Field(
        min_length=1, max_length=80
    )
    from_position: Position = Field(alias="from")
    to: Position
    text: str = Field(min_length=1, max_length=MAX_SELECTION_UNITS, strict=True)


class RevisionPatch(RevisionDto):
    id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$", strict=True)
    from_position: Position = Field(alias="from")
    to: Position
    before: str = Field(min_length=1, max_length=MAX_SELECTION_UNITS, strict=True)
    after: str = Field(max_length=MAX_REVISION_BYTES, strict=True)


class RevisionDecision(RevisionDto):
    patch_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$", strict=True)
    decision: DecisionValue


class RevisionCheck(RevisionDto):
    rule: RuleName
    result: Literal["pass", "fail", "unsupported"]
    detail: str = Field(max_length=300)
    patch_id: str | None = None
    from_position: Position | None = Field(default=None, alias="from")
    to: Position | None = None


class RevisionCommand(RevisionDto):
    command_id: UUID


class RevisionCreate(RevisionCommand):
    base_version: VersionNumber
    selection: RevisionSelection
    goal: str = Field(min_length=1, max_length=2000, strict=True)

    @field_validator("goal")
    @classmethod
    def nonblank_goal(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("请输入修订目标。")
        return value


class RevisionProposal(RevisionCommand):
    generation_token: UUID
    patches: list[RevisionPatch] = Field(min_length=1, max_length=100)


class RevisionDecide(RevisionCommand):
    expected_revision: VersionNumber
    decisions: list[RevisionDecision] = Field(min_length=1, max_length=100)


class RevisionApply(RevisionCommand):
    expected_revision: VersionNumber
    expected_document_version: VersionNumber


class RevisionCancel(RevisionCommand):
    pass


class RevisionUndo(RevisionCommand):
    expected_document_version: VersionNumber


class RevisionRevert(RevisionUndo):
    target_version: VersionNumber


class RevisionSummary(RevisionDto, Timestamped):
    id: UUID
    project_id: UUID
    document_id: UUID
    base_version: VersionNumber
    document_version: VersionNumber
    revision: VersionNumber
    status: RevisionStatus
    result_version: VersionNumber | None
    created_at: datetime
    updated_at: datetime


class RevisionRead(RevisionSummary):
    selection: RevisionSelection
    goal: str
    policy_version: str
    producer: Literal["deterministic_preview", "model_run"]
    run_id: UUID | None = None
    adoption_blocked_reason: Literal["REVISION_ADOPTION_NOT_APPROVED"] | None = None
    generation_error_code: str | None = Field(
        default=None, max_length=64, pattern=r"^[A-Z][A-Z0-9_]+$"
    )
    generation_token: UUID | None
    patches: list[RevisionPatch]
    decisions: list[RevisionDecision]
    checks: list[RevisionCheck]
    applicable: bool
    application_command_id: UUID | None


class RevisionPage(RevisionDto):
    items: list[RevisionSummary]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=50)
    offset: int = Field(ge=0)


class RevisionCommandRead(RevisionDto, Timestamped):
    command_id: UUID
    document_id: UUID
    candidate_id: UUID | None
    operation: RevisionOperation
    candidate_revision: VersionNumber | None
    base_version: VersionNumber | None
    result_version: VersionNumber | None
    created_at: datetime
