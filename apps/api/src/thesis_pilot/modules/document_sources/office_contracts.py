"""Job contracts for office imports. Imported by jobs.schemas, so this module never imports jobs."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

OFFICE_IMPORT_KIND = "office_import"
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
JsonUUID = Annotated[UUID, Field(strict=False)]
Count = Annotated[int, Field(ge=0, le=10_000_000)]


def _exact_one(value: object) -> object:
    if type(value) is not int:
        raise ValueError("结构版本必须为整数。")
    return value


class OfficeImportInput(BaseModel):
    """Server-fixed: one immutable material original, identified by id and digest."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    material_id: UUID
    original_id: UUID
    original_sha256: Sha256

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return _exact_one(value)


class OfficeImportResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["office_import"]
    schema_version: Literal[1]
    job_id: JsonUUID
    project_id: JsonUUID
    import_id: JsonUUID
    original_sha256: Sha256
    block_count: Count
    chapter_count: Count
    object_count: Count
    loss_count: Count
    model_used: Literal[False]
    # The preview is stored; the manuscript changes only after the student confirms.
    writes_performed: Literal[False]

    @field_validator("job_id", "project_id", "import_id", mode="before")
    @classmethod
    def require_uuid_string(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("导入结果标识必须为 UUID 字符串。")
        return value

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return _exact_one(value)
