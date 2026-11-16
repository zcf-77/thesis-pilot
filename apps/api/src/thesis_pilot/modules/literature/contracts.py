"""Job contracts for literature search. Imported by jobs.schemas, so never imports jobs."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

LITERATURE_JOB_KIND = "literature_search"
ADAPTER_VERSION = "thesispilot-literature-1"
LiteratureSource = Literal["crossref", "openalex"]
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
JsonUUID = Annotated[UUID, Field(strict=False)]


def _exact_schema_version(value: object) -> object:
    if type(value) is not int:
        raise ValueError("结构版本必须为整数。")
    return value


class LiteratureSearchInput(BaseModel):
    """The frozen search run owns the query, source and conditions."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    search_id: UUID

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return _exact_schema_version(value)


class LiteratureSearchJobResult(BaseModel):
    """Only references; the immutable snapshot lives in the literature module."""

    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["literature_search"]
    schema_version: Literal[1]
    job_id: JsonUUID
    project_id: JsonUUID
    search_id: JsonUUID
    snapshot_id: JsonUUID
    source: LiteratureSource
    adapter_version: Literal["thesispilot-literature-1"]
    item_count: Annotated[int, Field(ge=0, le=20)]
    response_sha256: Sha256
    model_used: Literal[False]
    writes_performed: Literal[False]

    @field_validator("job_id", "project_id", "search_id", "snapshot_id", mode="before")
    @classmethod
    def require_uuid_string(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("检索结果标识必须为 UUID 字符串。")
        return value

    @field_validator("model_used", "writes_performed", mode="before")
    @classmethod
    def require_boolean(cls, value: object) -> object:
        if not isinstance(value, bool):
            raise ValueError("检索结果标志必须为布尔值。")
        return value

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return _exact_schema_version(value)
