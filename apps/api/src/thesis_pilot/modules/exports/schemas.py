from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from thesis_pilot.modules.documents.schemas import Timestamped, VersionNumber
from thesis_pilot.modules.exports.contracts import ChangeRecordFormat, DocumentFormat, ExportKind
from thesis_pilot.modules.jobs.schemas import JobStatus


class DocumentExportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: UUID
    document_version: VersionNumber
    format: DocumentFormat


class ChangeRecordCreate(BaseModel):
    """``to_version`` omitted means the current version, frozen when the job is created."""

    model_config = ConfigDict(extra="forbid")

    document_id: UUID
    from_version: VersionNumber
    to_version: VersionNumber | None = None
    format: ChangeRecordFormat


class ExportFileRead(Timestamped):
    id: UUID
    filename: str
    content_type: str
    sha256: str
    byte_size: int
    created_at: datetime


class ExportRead(Timestamped):
    job_id: UUID
    project_id: UUID
    kind: ExportKind
    status: JobStatus
    attempt: int
    format: DocumentFormat
    document_id: UUID
    document_version: VersionNumber
    from_version: VersionNumber | None
    source_job_id: UUID | None
    error_code: str | None
    file: ExportFileRead | None
    created_at: datetime
    updated_at: datetime


class ExportPage(BaseModel):
    items: list[ExportRead]
    total: int
    limit: int
    offset: int
