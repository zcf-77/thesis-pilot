from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


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
