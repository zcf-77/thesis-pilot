from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]


class JobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    kind: Literal["diagnostic"] = "diagnostic"


class DiagnosticResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["diagnostic"]
    job_id: Annotated[UUID, Field(strict=False)]
    project_id: Annotated[UUID, Field(strict=False)]
    checked: Literal[True]
    model_used: Literal[False]
    writes_performed: Literal[False]
    message: Annotated[str, Field(pattern=r"\S")]

    @field_validator("job_id", "project_id", mode="before")
    @classmethod
    def require_uuid_string(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("诊断结果标识必须为 UUID 字符串。")
        return value

    @field_validator("checked", "model_used", "writes_performed", mode="before")
    @classmethod
    def require_boolean(cls, value: object) -> object:
        if not isinstance(value, bool):
            raise ValueError("诊断结果标志必须为布尔值。")
        return value


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    kind: Literal["diagnostic"]
    status: JobStatus
    attempt: int
    result: DiagnosticResult | None
    error_code: str | None
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        # SQLite fast tests lose timezone metadata; stored timestamps are UTC.
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class JobPage(BaseModel):
    items: list[JobRead]
    total: int
    limit: int
    offset: int
