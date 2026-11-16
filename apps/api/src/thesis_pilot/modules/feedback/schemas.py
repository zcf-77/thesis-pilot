"""Manual source ranges are UTF-16 offsets and preserve the verbatim original."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field

from thesis_pilot.modules.tasks.schemas import (
    Command,
    Dto,
    EvidenceRef,
    EvidenceSnapshot,
    TaskContent,
    Version,
)

ZeroVersion = Annotated[int, Field(ge=0, le=0, strict=True)]


class SourceRange(Dto):
    from_position: int = Field(alias="from", ge=0, le=20000, strict=True)
    to: int = Field(ge=1, le=20000, strict=True)
    text: str = Field(min_length=1, max_length=10000, strict=True)


class FeedbackCreate(Command):
    expected_version: ZeroVersion = 0
    original_text: str = Field(min_length=1, max_length=10000, strict=True)


class FeedbackContent(Dto):
    source_range: SourceRange
    interpretation: str = Field(min_length=1, max_length=4000, strict=True)
    certainty: Literal["certain", "uncertain"]
    correction: str = Field(default="", max_length=4000, strict=True)
    source_checked: bool = Field(strict=True)
    task_id: UUID | None = None
    new_task: TaskContent | None = None
    evidence: list[EvidenceRef] = Field(default_factory=list, max_length=20)


class FeedbackItemCreate(Command):
    expected_version: ZeroVersion = 0
    content: FeedbackContent


class FeedbackItemUpdate(Command):
    expected_version: Version
    content: FeedbackContent


class FeedbackDecision(Command):
    expected_version: Version
    action: Literal["processed", "reopen"]
    reason: str = Field(default="", max_length=2000, strict=True)


class FeedbackSummary(Dto):
    id: UUID
    project_id: UUID
    origin: Literal["manual"] = "manual"
    preview: str
    item_count: int
    created_at: datetime


class FeedbackRead(FeedbackSummary):
    original_text: str


class FeedbackPage(Dto):
    items: list[FeedbackSummary]
    total: int
    limit: int
    offset: int


class FeedbackItemRead(Dto):
    id: UUID
    batch_id: UUID
    project_id: UUID
    version: Version
    origin: Literal["manual"] = "manual"
    status: Literal["open", "processed"]
    content: FeedbackContent
    evidence_snapshots: list[EvidenceSnapshot]
    needs_review: bool
    review_reasons: list[str]
    created_at: datetime
    updated_at: datetime


class FeedbackItemSummary(Dto):
    id: UUID
    batch_id: UUID
    version: Version
    status: Literal["open", "processed"]
    preview: str
    certainty: Literal["certain", "uncertain"]
    task_id: UUID | None
    needs_review: bool
    review_reasons: list[str]
    updated_at: datetime


class FeedbackItemPage(Dto):
    items: list[FeedbackItemSummary]
    total: int
    limit: int
    offset: int


class FeedbackVersionRead(Dto):
    version: Version
    action: str
    reason: str
    snapshot: FeedbackItemRead
    created_at: datetime


class FeedbackVersionPage(Dto):
    items: list[FeedbackVersionRead]
    total: int
    limit: int
    offset: int
