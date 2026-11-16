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

from thesis_pilot.modules.jobs.schemas import JobRead, JobStatus
from thesis_pilot.modules.literature.contracts import LiteratureSource
from thesis_pilot.modules.literature.sources import LiteratureRecord

Verification = Literal["verified", "conflict", "not_found", "unverified"]
Year = Annotated[int, Field(ge=1900, le=2100, strict=True)]
EntryVersion = Annotated[int, Field(ge=1, le=9007199254740991, strict=True)]


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class LiteratureSearchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    query: Annotated[str, StringConstraints(min_length=1, max_length=300, strict=True)]
    source: LiteratureSource = "crossref"
    year_from: Year | None = None
    year_to: Year | None = None
    rows: Annotated[int, Field(ge=1, le=20, strict=True)] = 10

    @field_validator("query")
    @classmethod
    def plain_query(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned or any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF for char in cleaned):
            raise ValueError("请输入不含控制字符的检索式。")
        return cleaned

    @model_validator(mode="after")
    def ordered_years(self) -> Self:
        if (
            self.year_from is not None
            and self.year_to is not None
            and self.year_from > self.year_to
        ):
            raise ValueError("起始年份不能晚于结束年份。")
        return self


class LiteratureSearchRetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID


class LiteratureResultItem(LiteratureRecord):
    """A source record plus the project's current saved entry for the same work."""

    index: Annotated[int, Field(ge=0, le=19)]
    saved_entry_id: UUID | None


class LiteratureSnapshotRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    source: LiteratureSource
    adapter_version: str
    response_sha256: str
    total_results: int
    skipped_count: int
    retrieved_at: datetime
    items: list[LiteratureResultItem]

    @field_validator("retrieved_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)


class LiteratureSearchRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    project_id: UUID
    job_id: UUID
    status: JobStatus
    attempt: int
    error_code: str | None
    query: str
    source: LiteratureSource
    year_from: int | None
    year_to: int | None
    rows: int
    source_search_id: UUID | None
    snapshot: LiteratureSnapshotRead | None
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)


class LiteratureSearchReceipt(BaseModel):
    search: LiteratureSearchRead
    job: JobRead


class LiteratureSearchPage(BaseModel):
    items: list[LiteratureSearchRead]
    total: int
    limit: int
    offset: int


class LiteratureEntryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    search_id: UUID
    result_index: Annotated[int, Field(ge=0, le=19, strict=True)]


class LiteratureEntryCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    expected_version: EntryVersion


class LiteratureVerificationDetail(BaseModel):
    """Deterministic DOI back-check outcome; registry values are kept for comparison."""

    model_config = ConfigDict(extra="forbid")

    checked: bool
    reason: Literal[
        "match", "title_mismatch", "year_mismatch", "doi_not_found", "no_doi", "lookup_failed"
    ]
    error_code: str | None = None
    registry_title: str | None = None
    registry_year: int | None = None


class LiteratureEntryRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    project_id: UUID
    version: int
    removed: bool
    search_id: UUID
    snapshot_id: UUID
    result_index: int
    record: LiteratureRecord
    verification: Verification
    verification_detail: LiteratureVerificationDetail
    verified_at: datetime | None
    retrieved_at: datetime
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at", "retrieved_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)

    @field_validator("verified_at")
    @classmethod
    def utc_optional(cls, value: datetime | None) -> datetime | None:
        return None if value is None else _utc(value)


class LiteratureEntryPage(BaseModel):
    items: list[LiteratureEntryRead]
    total: int
    limit: int
    offset: int


class LiteratureEntryVersionRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int
    action: Literal["saved", "verified", "removed", "restored"]
    removed: bool
    verification: Verification
    verification_detail: LiteratureVerificationDetail
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)


class LiteratureEntryVersionPage(BaseModel):
    items: list[LiteratureEntryVersionRead]
    total: int
    limit: int
    offset: int
