"""Bounded revision DTOs.

v1 (Tiptap) selections and patches use ProseMirror UTF-16 positions (``from``/``to``).
v2 (DocsModel) selections anchor one paragraph/heading by ``node_id`` with Unicode scalar
offsets into its atom text (``start``/``end``); v2 patches use the same node offsets.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Discriminator, Field, Tag, TypeAdapter, field_validator

from thesis_pilot.modules.documents.schemas import Timestamped, VersionNumber
from thesis_pilot.modules.documents.structure import MAX_SAFE_INTEGER

MAX_REVISION_BYTES = 256 * 1024
MAX_SELECTION_UNITS = 32768
POLICY_VERSION = "text-protection-v1"
POLICY_VERSION_V2 = "text-protection-v2"
MAX_NODE_ID_LENGTH = 200
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


class RevisionNodeSelection(RevisionDto):
    """v2 anchor: one body paragraph/heading, scalar offsets, exact expected text."""

    node_id: str = Field(min_length=1, max_length=MAX_NODE_ID_LENGTH, strict=True)
    start: Position
    end: Position
    expected_text: str = Field(min_length=1, max_length=MAX_SELECTION_UNITS, strict=True)

    @property
    def text(self) -> str:
        return self.expected_text


def _selection_tag(value: object) -> str | None:
    if isinstance(value, RevisionNodeSelection):
        return "node"
    if isinstance(value, RevisionSelection):
        return "editor"
    if isinstance(value, dict):
        return "node" if "node_id" in value else "editor"
    return None


ContentSelection = Annotated[
    Annotated[RevisionSelection, Tag("editor")] | Annotated[RevisionNodeSelection, Tag("node")],
    Discriminator(_selection_tag),
]
SELECTION_ADAPTER: TypeAdapter[RevisionSelection | RevisionNodeSelection] = TypeAdapter(
    ContentSelection
)


def parse_selection(raw: object) -> RevisionSelection | RevisionNodeSelection:
    return SELECTION_ADAPTER.validate_python(raw)


def selection_schema(selection: RevisionSelection | RevisionNodeSelection) -> Literal[1, 2]:
    return 2 if isinstance(selection, RevisionNodeSelection) else 1


class RevisionPatch(RevisionDto):
    id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$", strict=True)
    from_position: Position = Field(alias="from")
    to: Position
    before: str = Field(min_length=1, max_length=MAX_SELECTION_UNITS, strict=True)
    after: str = Field(max_length=MAX_REVISION_BYTES, strict=True)


class RevisionNodePatch(RevisionDto):
    """v2 patch: scalar offsets into the selected node's atom text."""

    id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$", strict=True)
    start: Position
    end: Position
    before: str = Field(min_length=1, max_length=MAX_SELECTION_UNITS, strict=True)
    after: str = Field(max_length=MAX_REVISION_BYTES, strict=True)


def _patch_tag(value: object) -> str | None:
    if isinstance(value, RevisionNodePatch):
        return "node"
    if isinstance(value, RevisionPatch):
        return "editor"
    if isinstance(value, dict):
        return "node" if "start" in value else "editor"
    return None


ContentPatch = Annotated[
    Annotated[RevisionPatch, Tag("editor")] | Annotated[RevisionNodePatch, Tag("node")],
    Discriminator(_patch_tag),
]


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
    # v2 only: scalar node offsets of the located patch.
    start: Position | None = None
    end: Position | None = None


class RevisionCommand(RevisionDto):
    command_id: UUID


class RevisionCreate(RevisionCommand):
    base_version: VersionNumber
    selection: ContentSelection
    goal: str = Field(min_length=1, max_length=2000, strict=True)

    @field_validator("goal")
    @classmethod
    def nonblank_goal(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("请输入修订目标。")
        return value


class RevisionProposal(RevisionCommand):
    generation_token: UUID
    patches: list[ContentPatch] = Field(min_length=1, max_length=100)


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
    content_schema_version: Literal[1, 2] = 1
    selection: ContentSelection
    goal: str
    policy_version: str
    producer: Literal["deterministic_preview", "model_run"]
    run_id: UUID | None = None
    generation_error_code: str | None = Field(
        default=None, max_length=64, pattern=r"^[A-Z][A-Z0-9_]+$"
    )
    generation_token: UUID | None
    patches: list[ContentPatch]
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
