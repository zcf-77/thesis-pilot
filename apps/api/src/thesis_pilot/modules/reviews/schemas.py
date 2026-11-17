from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from thesis_pilot.modules.documents.schemas import VersionNumber
from thesis_pilot.modules.jobs.schemas import JobRead, JobStatus

Severity = Literal["major", "minor", "advice"]
ShortText = Annotated[str, Field(min_length=1, max_length=200)]
LongText = Annotated[str, Field(min_length=1, max_length=2000)]
ChapterId = Annotated[str, StringConstraints(min_length=1, max_length=200)]


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class ReviewCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    document_id: UUID
    document_version: VersionNumber
    chapter_id: ChapterId | None = None
    rubric_version: Annotated[str, Field(min_length=1, max_length=64)]
    agent_config_version_id: UUID
    source_binding_version_id: UUID | None = None


class ReviewRetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID


class ReviewRubricDimension(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    full: int
    description: str


class ReviewRubricRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    title: str
    description: str
    dimensions: list[ReviewRubricDimension]
    limitations: list[str]


class ReviewRubricList(BaseModel):
    items: list[ReviewRubricRead]


class ReviewLocation(BaseModel):
    """Without ``node_id`` (v1 reports): UTF-16 offsets in the reviewed block's plain text.

    With ``node_id`` (v2 versions): the confirmed node — the heading for a chapter, the top
    block for a block, or the paragraph/heading holding the quote — and Unicode scalar
    offsets in that node's text, the writing page's anchor unit.
    """

    model_config = ConfigDict(extra="forbid")

    status: Literal["range", "block", "chapter", "unlocated"]
    chapter_id: str | None
    chapter_title: str | None
    block_index: int | None
    start: int | None
    end: int | None
    quote: str | None
    node_id: str | None = None


class ReviewBasis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    kind: Literal["requirement", "template", "rubric"]
    label: str
    source_id: str | None
    item_id: str


class ReviewIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    severity: Severity
    title: str
    explanation: str
    direction: str
    location: ReviewLocation
    basis: list[ReviewBasis]
    basis_status: Literal["cited", "missing"]


class ReviewScore(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension_id: str
    name: str
    full: int
    score: float | None
    reason: str


class ReviewUnchecked(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item: str
    reason: str
    origin: Literal["model", "system"]


class ReviewScopeRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chapter_id: str | None
    title: str


class ReviewReportContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    summary: str
    rubric: ReviewRubricRead
    scope: ReviewScopeRead
    scores: list[ReviewScore]
    issues: list[ReviewIssue]
    unchecked: list[ReviewUnchecked]
    limitations: list[str]


class ReviewReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    review_id: UUID
    project_id: UUID
    job_id: UUID
    document_id: UUID
    document_version: int
    requested_model: str
    response_model: str
    content: ReviewReportContent
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)


class ReviewRead(BaseModel):
    id: UUID
    project_id: UUID
    job_id: UUID
    status: JobStatus
    error_code: str | None
    attempt: int
    document_id: UUID
    document_version: int
    chapter_id: str | None
    scope_title: str
    rubric_version: str
    agent_config_version_id: UUID
    agent_name: str
    config_version_ids: dict[str, UUID]
    source_binding_version_id: UUID | None
    template_parse_version_id: UUID | None
    requirement_parse_version_ids: list[UUID]
    source_review_id: UUID | None
    report_id: UUID | None
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)


class ReviewPage(BaseModel):
    items: list[ReviewRead]
    total: int
    limit: int
    offset: int


class ReviewReceipt(BaseModel):
    review: ReviewRead
    job: JobRead


# Strict model reply contract. The model proposes; the server maps and verifies.
class ReviewModelLocation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    chapter_id: Annotated[str, Field(max_length=200)] | None = None
    block: Annotated[int, Field(ge=0, le=100000)] | None = None
    quote: Annotated[str, Field(max_length=500)] | None = None


class ReviewModelIssue(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    severity: Severity
    title: ShortText
    location: ReviewModelLocation
    basis: Annotated[list[Annotated[str, Field(max_length=40)]], Field(max_length=10)]
    explanation: LongText
    direction: LongText


class ReviewModelScore(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    dimension: Annotated[str, Field(max_length=40)]
    score: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)] | None
    reason: LongText


class ReviewModelUnchecked(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    item: ShortText
    reason: LongText


class ReviewModelReply(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    summary: LongText
    issues: Annotated[list[ReviewModelIssue], Field(max_length=50)]
    scores: Annotated[list[ReviewModelScore], Field(max_length=20)]
    unchecked: Annotated[list[ReviewModelUnchecked], Field(max_length=30)]

    @field_validator("summary")
    @classmethod
    def complete_text(cls, value: str) -> str:
        if not value.strip() or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
            raise ValueError("模型摘要为空或包含不完整字符。")
        return value


class ReviewCompletion(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    reply: ReviewModelReply
    requested_model: Annotated[str, Field(min_length=1, max_length=200)]
    response_model: Annotated[str, Field(min_length=1, max_length=200)]
