"""API shapes for DOCX imports through the office-server sidecar."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator

from thesis_pilot.modules.documents.schemas import Timestamped, VersionNumber
from thesis_pilot.modules.jobs.schemas import JobStatus

ImportMode = Literal["create", "new_version"]


class OfficeImportCreate(BaseModel):
    """Identifies an immutable material original; the server reads and pins its bytes."""

    model_config = ConfigDict(extra="forbid")

    material_id: UUID
    original_id: UUID


class OfficeImportChapter(BaseModel):
    id: str
    title: str
    level: int


class OfficeImportObject(BaseModel):
    node_id: str
    block_type: str
    excerpt: str


class OfficeImportLoss(BaseModel):
    kind: str
    path: str
    label: str
    action: Literal["protected", "noted"]
    node_id: str | None = None
    detail: str | None = None


class OfficeImportPreview(BaseModel):
    import_id: UUID
    filename: str
    original_sha256: str
    converter: str
    block_count: int
    paragraph_count: int
    table_count: int
    image_count: int
    text_characters: int
    chapters: list[OfficeImportChapter]
    chapters_truncated: bool
    objects: list[OfficeImportObject]
    losses: list[OfficeImportLoss]
    # Live project state at read time; confirmation re-checks under the project lock.
    existing_document_id: UUID | None
    existing_version: int | None
    can_create: bool
    can_append: bool
    append_blocked_reason: str | None


class OfficeImportRead(Timestamped):
    job_id: UUID
    project_id: UUID
    status: JobStatus
    attempt: int
    material_id: UUID
    original_id: UUID
    original_sha256: str
    source_job_id: UUID | None
    error_code: str | None
    preview: OfficeImportPreview | None
    created_at: datetime
    updated_at: datetime


class OfficeImportPage(BaseModel):
    items: list[OfficeImportRead]
    total: int
    limit: int
    offset: int


class OfficeImportConfirm(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    mode: ImportMode
    # Required for a new version: the manuscript version the student saw when confirming.
    expected_version: VersionNumber | None = None

    @model_validator(mode="after")
    def version_matches_mode(self) -> Self:
        if (self.mode == "new_version") != (self.expected_version is not None):
            raise ValueError("作为新版本导入必须提供当前正文版本；新建正式稿不提供版本。")
        return self


class OfficeImportReceipt(BaseModel):
    command_id: UUID
    import_id: UUID
    document_id: UUID
    document_version: int
    mode: ImportMode


class DocumentOfficeSourceRead(Timestamped):
    document_id: UUID
    # The version the import created; preserve-original export diffs against it.
    document_version: int
    import_id: UUID
    material_id: UUID
    original_id: UUID
    original_sha256: str
    filename: str
    imported_at: datetime
