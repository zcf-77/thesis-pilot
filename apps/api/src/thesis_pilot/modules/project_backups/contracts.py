"""Job contracts for project backup/restore. Imported by jobs.schemas, so never imports jobs."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

BACKUP_JOB_KIND = "project_backup"
RESTORE_JOB_KIND = "project_restore"
BACKUP_JOB_KINDS = frozenset({BACKUP_JOB_KIND, RESTORE_JOB_KIND})
PACKAGE_FORMAT = "thesispilot-backup/1"
# Compressed package size accepted for download and upload.
MAX_PACKAGE_BYTES = 256 * 1024 * 1024
# Expanded size of all entries together and of one entry.
MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
MAX_ENTRY_BYTES = 256 * 1024 * 1024
MAX_ENTRIES = 20000
# A larger ratio on a non-trivial entry is treated as a decompression bomb.
MAX_COMPRESSION_RATIO = 200

Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
JsonUUID = Annotated[UUID, Field(strict=False)]
ObjectCounts = Annotated[
    dict[Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,62}$")], Annotated[int, Field(ge=0)]],
    Field(max_length=200),
]


def _exact_schema_version(value: object) -> object:
    if type(value) is not int:
        raise ValueError("结构版本必须为整数。")
    return value


class _Fixed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return _exact_schema_version(value)


class ProjectBackupInput(_Fixed):
    kind: Literal["project_backup"] = "project_backup"
    project_id: UUID


class ProjectRestoreInput(_Fixed):
    kind: Literal["project_restore"] = "project_restore"
    restore_id: UUID
    # SHA-256 of the exact uploaded bytes the worker must read back.
    upload_sha256: Sha256


class BackupConfiguration(_Fixed):
    """Server-frozen package format; a restore also fixes the uploaded bytes' digest."""

    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    format: Literal["thesispilot-backup/1"] = "thesispilot-backup/1"


class _ResultBase(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: Literal[1]
    job_id: JsonUUID
    project_id: JsonUUID
    package_sha256: Sha256
    format: Literal["thesispilot-backup/1"]
    object_counts: ObjectCounts
    model_used: Literal[False]

    @field_validator("job_id", "project_id", mode="before")
    @classmethod
    def require_uuid_string(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("备份结果标识必须为 UUID 字符串。")
        return value

    @field_validator("model_used", mode="before")
    @classmethod
    def require_boolean(cls, value: object) -> object:
        if not isinstance(value, bool):
            raise ValueError("备份结果标志必须为布尔值。")
        return value

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return _exact_schema_version(value)


class ProjectBackupResult(_ResultBase):
    kind: Literal["project_backup"]
    archive_id: JsonUUID
    filename: Annotated[str, Field(min_length=1, max_length=200)]
    sha256: Sha256
    byte_size: Annotated[int, Field(ge=1, le=MAX_PACKAGE_BYTES)]
    writes_performed: Literal[False]

    @field_validator("archive_id", mode="before")
    @classmethod
    def require_archive_uuid(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("备份结果标识必须为 UUID 字符串。")
        return value


class ProjectRestoreResult(_ResultBase):
    """``project_id`` is the new copy; the source project is never written."""

    kind: Literal["project_restore"]
    restore_id: JsonUUID
    source_project_id: JsonUUID
    interrupted_jobs: Annotated[int, Field(ge=0)]
    writes_performed: Literal[True]

    @field_validator("restore_id", "source_project_id", mode="before")
    @classmethod
    def require_restore_uuid(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("恢复结果标识必须为 UUID 字符串。")
        return value
