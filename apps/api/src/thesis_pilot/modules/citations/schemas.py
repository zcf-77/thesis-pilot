from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from thesis_pilot.modules.documents.schemas import VersionNumber

CitationStatus = Literal["ready", "applied", "rejected", "undone"]
NodeId = Annotated[str, StringConstraints(min_length=1, max_length=200, strict=True)]
Offset = Annotated[int, Field(ge=0, le=9007199254740991, strict=True)]


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class CitationPlacement(BaseModel):
    """Collapsed cursor in a v2 body paragraph; ``offset`` counts Unicode scalars."""

    model_config = ConfigDict(extra="forbid")

    node_id: NodeId
    offset: Offset


class CitationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    base_version: VersionNumber
    entry_id: UUID
    placement: CitationPlacement


class CitationApply(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    expected_revision: Annotated[int, Field(ge=1, le=9007199254740991, strict=True)]
    expected_document_version: VersionNumber


class CitationReject(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    expected_revision: Annotated[int, Field(ge=1, le=9007199254740991, strict=True)]


class CitationUndo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    expected_document_version: VersionNumber


class CitationMarkerPreview(BaseModel):
    node: str
    offset: int
    text: str


class CitationReferencePreview(BaseModel):
    node: str
    new: bool
    text: str


class CitationHeadingPreview(BaseModel):
    node: str
    new: bool


class CitationRenumber(BaseModel):
    entry_id: UUID
    before: int
    after: int


class CitationChange(BaseModel):
    """One body change: a new or renumbered marker, a rewritten/new reference, a heading."""

    kind: Literal["marker", "marker_renumber", "reference", "reference_new", "heading_new"]
    node: str
    start: int | None = None
    end: int | None = None
    before: str | None = None
    after: str


class CitationPreview(BaseModel):
    entry_id: UUID
    number: int
    reused: bool
    marker: CitationMarkerPreview
    reference: CitationReferencePreview
    heading: CitationHeadingPreview
    renumbered: list[CitationRenumber]
    changes: list[CitationChange]


class CitationEntrySummary(BaseModel):
    id: UUID
    title: str
    removed: bool


class CitationCandidateRead(BaseModel):
    id: UUID
    project_id: UUID
    document_id: UUID
    base_version: int
    document_version: int
    entry: CitationEntrySummary
    entry_version: int
    placement: CitationPlacement
    number: int
    status: CitationStatus
    revision: int
    policy_version: str
    preview: CitationPreview
    result_version: int | None
    applicable: bool
    stale: bool
    application_command_id: UUID | None
    undoable: bool
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)


class CitationCandidatePage(BaseModel):
    items: list[CitationCandidateRead]
    total: int
    limit: int
    offset: int


class CitationMarkerRead(BaseModel):
    protection_id: str
    node: str
    start: int
    end: int


class CitedEntryRead(BaseModel):
    entry_id: UUID
    number: int
    title: str
    removed: bool
    reference_node: str | None
    reference_text: str | None
    markers: list[CitationMarkerRead]


class CitationListRead(BaseModel):
    """Managed citations of one stored version, numbered by first appearance."""

    document_id: UUID
    document_version: int
    schema_version: Literal[1, 2]
    references_heading: str | None
    consistent: bool
    items: list[CitedEntryRead]
