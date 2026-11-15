from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints, field_validator

DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
ClockTime = Annotated[str, StringConstraints(pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]


class SessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_key: SecretStr = Field(min_length=1, max_length=4096)


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1, le=2_147_483_646, strict=True)
    display_name: DisplayName
    notifications_enabled: bool = Field(strict=True)
    quiet_start: ClockTime
    quiet_end: ClockTime
    show_deferred: bool = Field(strict=True)


class ProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    version: int
    display_name: str
    notifications_enabled: bool
    quiet_start: str
    quiet_end: str
    show_deferred: bool


class SessionRead(BaseModel):
    workspace_id: UUID
    expires_at: datetime
    profile: ProfileRead

    @field_validator("expires_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
