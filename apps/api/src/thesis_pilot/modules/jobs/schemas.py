from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from thesis_pilot.modules.documents.schemas import Timestamped, VersionNumber

JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
JobKind = Literal["diagnostic", "document_inspection"]


class InspectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    document_id: UUID
    document_version: VersionNumber

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("结构版本必须为整数。")
        return value


class InspectionConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    schema_version: Literal[1] = 1
    include_text_statistics: bool = True

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("结构版本必须为整数。")
        return value


class JobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    kind: JobKind = "diagnostic"
    input_snapshot: InspectionInput | None = None
    configuration: InspectionConfiguration | None = None

    @model_validator(mode="after")
    def fixed_contract(self) -> "JobCreate":
        if self.kind == "diagnostic":
            if self.input_snapshot is not None or self.configuration is not None:
                raise ValueError("诊断任务不接受业务输入或配置。")
        else:
            if self.input_snapshot is None:
                raise ValueError("结构检查需要固定的正式稿版本。")
            if self.configuration is None:
                self.configuration = InspectionConfiguration()
        return self


class DiagnosticResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["diagnostic"]
    job_id: Annotated[UUID, Field(strict=False)]
    project_id: Annotated[UUID, Field(strict=False)]
    checked: Literal[True]
    model_used: Literal[False]
    writes_performed: Literal[False]
    message: Annotated[str, Field(pattern=r"\S")]

    @field_validator("job_id", "project_id", mode="before")
    @classmethod
    def require_uuid_string(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("诊断结果标识必须为 UUID 字符串。")
        return value

    @field_validator("checked", "model_used", "writes_performed", mode="before")
    @classmethod
    def require_boolean(cls, value: object) -> object:
        if not isinstance(value, bool):
            raise ValueError("诊断结果标志必须为布尔值。")
        return value


class InspectionResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["document_inspection"]
    schema_version: Literal[1]
    job_id: Annotated[UUID, Field(strict=False)]
    project_id: Annotated[UUID, Field(strict=False)]
    document_id: Annotated[UUID, Field(strict=False)]
    document_version: VersionNumber
    node_count: Annotated[int, Field(ge=1, le=100000)]
    paragraph_count: Annotated[int, Field(ge=0, le=100000)]
    heading_count: Annotated[int, Field(ge=0, le=100000)]
    table_count: Annotated[int, Field(ge=0, le=100000)]
    text_characters: Annotated[int, Field(ge=0, le=16 * 1024 * 1024)] | None
    model_used: Literal[False]
    writes_performed: Literal[False]

    @field_validator("job_id", "project_id", "document_id", mode="before")
    @classmethod
    def require_uuid_string(cls, value: object) -> object:
        return DiagnosticResult.require_uuid_string(value)

    @field_validator("model_used", "writes_performed", mode="before")
    @classmethod
    def require_boolean(cls, value: object) -> object:
        return DiagnosticResult.require_boolean(value)

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return InspectionInput.exact_schema_version(value)

    @model_validator(mode="after")
    def consistent_counts(self) -> "InspectionResult":
        if self.paragraph_count + self.heading_count + self.table_count >= self.node_count:
            raise ValueError("节点统计不一致。")
        return self


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    kind: JobKind
    status: JobStatus
    attempt: int
    result: DiagnosticResult | InspectionResult | None
    input_snapshot: InspectionInput | None = None
    configuration: InspectionConfiguration | None = None
    resource_scope: InspectionInput | None = None
    source_job_id: UUID | None = None
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


class JobAttemptRead(Timestamped):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    attempt: int
    status: Literal["running", "succeeded", "failed", "cancelled", "lease_expired"]
    error_code: str | None
    started_at: datetime
    finished_at: datetime | None

    @field_validator("started_at", "finished_at")
    @classmethod
    def utc_attempt_timestamp(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class JobArtifactRead(Timestamped):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_id: UUID
    attempt_id: UUID
    kind: Literal["document_inspection"]
    schema_version: Literal[1]
    created_at: datetime
    result: InspectionResult


class JobDetail(JobRead):
    attempts: list[JobAttemptRead]
    artifacts: list[JobArtifactRead]
