"""Job contracts for exports. Imported by jobs.schemas, so this module never imports jobs."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from thesis_pilot.modules.documents.schemas import VersionNumber

EXPORT_JOB_KINDS = frozenset({"document_export", "change_record"})
RENDERER_VERSION = "thesispilot-export-1"
MAX_EXPORT_BYTES = 8 * 1024 * 1024
MAX_CHANGE_RECORD_VERSIONS = 200

ExportKind = Literal["document_export", "change_record"]
DocumentFormat = Literal["html", "txt", "markdown"]
ChangeRecordFormat = Literal["html", "markdown"]
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
JsonUUID = Annotated[UUID, Field(strict=False)]


def _exact_schema_version(value: object) -> object:
    if type(value) is not int:
        raise ValueError("结构版本必须为整数。")
    return value


class DocumentExportInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    document_id: UUID
    document_version: VersionNumber
    format: DocumentFormat

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return _exact_schema_version(value)


class ChangeRecordInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    document_id: UUID
    from_version: VersionNumber
    to_version: VersionNumber
    format: ChangeRecordFormat

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return _exact_schema_version(value)

    @model_validator(mode="after")
    def ordered_range(self) -> "ChangeRecordInput":
        if self.from_version > self.to_version:
            raise ValueError("起始版本不能晚于结束版本。")
        if self.to_version - self.from_version + 1 > MAX_CHANGE_RECORD_VERSIONS:
            raise ValueError("修改说明的版本范围过大。")
        return self


class ExportConfiguration(BaseModel):
    """Server-frozen renderer and a digest of the exact facts read at enqueue time."""

    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    schema_version: Literal[1] = 1
    renderer_version: Literal["thesispilot-export-1"] = "thesispilot-export-1"
    source_sha256: Sha256

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return _exact_schema_version(value)


class _ExportResultBase(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: Literal[1]
    job_id: JsonUUID
    project_id: JsonUUID
    document_id: JsonUUID
    file_id: JsonUUID
    filename: Annotated[str, Field(min_length=1, max_length=200)]
    content_type: Literal[
        "text/html; charset=utf-8", "text/plain; charset=utf-8", "text/markdown; charset=utf-8"
    ]
    sha256: Sha256
    byte_size: Annotated[int, Field(ge=1, le=MAX_EXPORT_BYTES)]
    model_used: Literal[False]
    writes_performed: Literal[False]

    @field_validator("job_id", "project_id", "document_id", "file_id", mode="before")
    @classmethod
    def require_uuid_string(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("导出结果标识必须为 UUID 字符串。")
        return value

    @field_validator("model_used", "writes_performed", mode="before")
    @classmethod
    def require_boolean(cls, value: object) -> object:
        if not isinstance(value, bool):
            raise ValueError("导出结果标志必须为布尔值。")
        return value

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return _exact_schema_version(value)


class DocumentExportResult(_ExportResultBase):
    kind: Literal["document_export"]
    document_version: VersionNumber
    format: DocumentFormat


class ChangeRecordResult(_ExportResultBase):
    kind: Literal["change_record"]
    from_version: VersionNumber
    to_version: VersionNumber
    format: ChangeRecordFormat
    version_count: Annotated[int, Field(ge=1, le=MAX_CHANGE_RECORD_VERSIONS)]


CONTENT_TYPES: dict[str, str] = {
    "html": "text/html; charset=utf-8",
    "txt": "text/plain; charset=utf-8",
    "markdown": "text/markdown; charset=utf-8",
}
EXTENSIONS: dict[str, str] = {"html": "html", "txt": "txt", "markdown": "md"}
