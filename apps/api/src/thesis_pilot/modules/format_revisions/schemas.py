"""Clients select evidence and targets; only the server constructs format patches."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from thesis_pilot.modules.documents.schemas import VersionNumber
from thesis_pilot.modules.documents.structure import EditorJsonValue, JsonObject

FormatField = Literal["level", "templateAlign", "templateWeight", "alignment"]
BoundedId = Annotated[str, Field(min_length=1, max_length=300)]


class FormatRule(BaseModel):
    id: str
    parse_version_id: UUID
    anchor_id: str
    field: FormatField
    value: str | int
    evidence: str
    scope: Literal["heading", "paragraph"]


class FormatTarget(BaseModel):
    anchor_id: str
    editor_path: list[int]
    kind: Literal["heading", "paragraph"]
    title: str
    attrs: JsonObject | None


class FormatContext(BaseModel):
    document_version: VersionNumber
    binding_version_id: UUID
    binding_version: VersionNumber
    template_parse_version_id: UUID | None
    requirement_parse_version_ids: list[UUID]
    source_guard_digest: str
    targets: list[FormatTarget]
    rules: list[FormatRule]


class FormatCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID


class FormatSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rule_id: BoundedId
    target_anchor_ids: list[BoundedId] = Field(min_length=1, max_length=1000)


class FormatCreate(FormatCommand):
    base_version: VersionNumber
    binding_version_id: UUID
    source_guard_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    selections: list[FormatSelection] = Field(min_length=1, max_length=100)


class FormatPatch(BaseModel):
    id: str
    anchor_id: str
    editor_path: list[int]
    field: FormatField
    before: EditorJsonValue
    after: str | int
    rule_id: str
    evidence: str


class FormatDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patch_id: BoundedId
    decision: Literal["accept", "reject", "pending"]


class FormatDecide(FormatCommand):
    expected_revision: VersionNumber
    decisions: list[FormatDecision] = Field(min_length=1, max_length=1000)


class FormatApply(FormatCommand):
    expected_revision: VersionNumber
    expected_document_version: VersionNumber


class FormatUndo(FormatCommand):
    expected_document_version: VersionNumber


class FormatCommandRead(BaseModel):
    command_id: UUID
    candidate_id: UUID
    candidate_revision: VersionNumber
    operation: Literal["create", "decide", "apply", "undo"]
    base_version: VersionNumber
    result_version: VersionNumber | None


class FormatRead(BaseModel):
    id: UUID
    document_id: UUID
    project_id: UUID
    base_version: VersionNumber
    document_version: VersionNumber
    revision: VersionNumber
    status: Literal["ready", "applied", "undone"]
    applicable: bool
    patches: list[FormatPatch]
    decisions: list[FormatDecision]
    application_command_id: UUID | None
    created_at: datetime
    updated_at: datetime


class FormatPage(BaseModel):
    items: list[FormatRead]
    total: int
    limit: int
    offset: int
