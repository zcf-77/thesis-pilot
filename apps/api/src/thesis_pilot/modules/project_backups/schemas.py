from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from thesis_pilot.modules.documents.schemas import Timestamped
from thesis_pilot.modules.jobs.schemas import JobStatus


class BackupFileRead(Timestamped):
    id: UUID
    filename: str
    sha256: str
    package_sha256: str
    byte_size: int
    schema_head: str
    object_counts: dict[str, int]
    created_at: datetime


class BackupRead(Timestamped):
    job_id: UUID
    project_id: UUID
    status: JobStatus
    attempt: int
    source_job_id: UUID | None
    error_code: str | None
    file: BackupFileRead | None
    created_at: datetime
    updated_at: datetime


class BackupPage(BaseModel):
    items: list[BackupRead]
    total: int
    limit: int
    offset: int


class RestoreRead(Timestamped):
    """``result_project_id`` is set only when the new copy has been committed."""

    job_id: UUID
    restore_id: UUID
    status: JobStatus
    attempt: int
    error_code: str | None
    filename: str
    sha256: str
    byte_size: int
    package_sha256: str
    source_project_id: UUID
    source_project_name: str
    schema_head: str
    exported_at: datetime
    object_counts: dict[str, int]
    result_project_id: UUID | None
    created_at: datetime
    updated_at: datetime


class RestorePage(BaseModel):
    items: list[RestoreRead]
    total: int
    limit: int
    offset: int
