from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


class JobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    kind: Literal["diagnostic"] = "diagnostic"


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    kind: Literal["diagnostic"]
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    attempt: int
    result: dict[str, object] | None
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
