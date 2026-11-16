"""API and strict model-reply contracts for feedback decomposition (UTF-16 ranges)."""

from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from thesis_pilot.modules.feedback.schemas import FeedbackContent, SourceRange
from thesis_pilot.modules.jobs.schemas import JobRead, JobStatus
from thesis_pilot.modules.tasks.schemas import Command

MAX_SUGGESTIONS = 50
SuggestionState = Literal["pending", "adopted", "rejected"]
DecisionAction = Literal["adopt", "reject", "undo"]


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _complete(value: str) -> str:
    if not value.strip() or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise ValueError("文字为空或包含不完整字符。")
    return value


class FeedbackSplitCreate(Command):
    agent_config_version_id: UUID


class FeedbackSplitRetry(Command):
    pass


class SuggestionDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suggestion_id: UUID
    expected_version: int = Field(ge=0, le=10000, strict=True)
    action: DecisionAction
    # Only for adopt: the student's corrected content. Omit to adopt the suggestion as is.
    content: FeedbackContent | None = None
    reason: str = Field(default="", max_length=2000, strict=True)

    @model_validator(mode="after")
    def content_only_on_adopt(self) -> "SuggestionDecision":
        if self.content is not None and self.action != "adopt":
            raise ValueError("只有采纳可以携带修改后的解释。")
        return self


class FeedbackSplitDecide(Command):
    decisions: list[SuggestionDecision] = Field(min_length=1, max_length=MAX_SUGGESTIONS)

    @field_validator("decisions")
    @classmethod
    def distinct(cls, value: list[SuggestionDecision]) -> list[SuggestionDecision]:
        if len({item.suggestion_id for item in value}) != len(value):
            raise ValueError("同一建议在一次提交中只能决定一次。")
        return value


class SuggestionHistoryRead(BaseModel):
    version: int
    action: Literal["adopt", "adopt_modified", "reject", "undo"]
    feedback_item_id: UUID | None
    reason: str
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)


class FeedbackSuggestionRead(BaseModel):
    id: UUID
    position: int
    source_range: SourceRange
    interpretation: str
    certainty: Literal["certain", "uncertain"]
    ambiguous: bool
    task_title: str | None
    state: SuggestionState
    version: int
    feedback_item_id: UUID | None
    stale: bool
    stale_reasons: list[str]
    history: list[SuggestionHistoryRead]


class FeedbackSplitRead(BaseModel):
    id: UUID
    project_id: UUID
    batch_id: UUID
    job_id: UUID
    status: JobStatus
    error_code: str | None
    attempt: int
    agent_config_version_id: UUID
    agent_name: str
    config_version_ids: dict[str, UUID]
    source_split_id: UUID | None
    requested_model: str | None
    response_model: str | None
    note: str
    suggestions: list[FeedbackSuggestionRead]
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)


class FeedbackSplitPage(BaseModel):
    items: list[FeedbackSplitRead]
    total: int
    limit: int
    offset: int


class FeedbackSplitReceipt(BaseModel):
    split: FeedbackSplitRead
    job: JobRead


# Strict model reply. The model proposes ranges; the server verifies every one.
class SplitModelItem(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    from_position: int = Field(alias="from", ge=0, le=20000)
    to: int = Field(ge=1, le=20000)
    text: Annotated[str, Field(min_length=1, max_length=10000)]
    interpretation: Annotated[str, Field(min_length=1, max_length=4000)]
    certainty: Literal["certain", "uncertain"]
    ambiguous: bool
    task_title: Annotated[str, Field(min_length=1, max_length=200)] | None

    @field_validator("interpretation")
    @classmethod
    def complete_interpretation(cls, value: str) -> str:
        return _complete(value)

    @field_validator("task_title")
    @classmethod
    def complete_title(cls, value: str | None) -> str | None:
        return None if value is None else _complete(value).strip()


class SplitModelReply(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    items: Annotated[list[SplitModelItem], Field(max_length=MAX_SUGGESTIONS)]
    note: Annotated[str, Field(max_length=2000)]


class SplitCompletion(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    reply: SplitModelReply
    requested_model: Annotated[str, Field(min_length=1, max_length=200)]
    response_model: Annotated[str, Field(min_length=1, max_length=200)]
