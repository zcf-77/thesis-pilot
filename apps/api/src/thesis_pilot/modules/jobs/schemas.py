from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from thesis_pilot.modules.ai_configs.schemas import (
    AgentConfigContent,
    APIConfigContent,
    ModelConfigContent,
    PromptConfigContent,
)
from thesis_pilot.modules.documents.schemas import Timestamped, VersionNumber

JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
JobKind = Literal[
    "diagnostic",
    "document_inspection",
    "configuration_probe",
    "material_parse",
    "content_revision",
    "review",
]
ConfigKind = Literal["api", "model", "prompt", "agent"]
JsonUUID = Annotated[UUID, Field(strict=False)]


class ConfigurationProbeInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    config_version_id: UUID
    variables: Annotated[
        dict[
            Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,79}$")],
            Annotated[str, Field(strict=True, max_length=10000)],
        ],
        Field(max_length=50),
    ] = Field(default_factory=dict)

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("结构版本必须为整数。")
        return value

    @field_validator("variables")
    @classmethod
    def bounded_variables(cls, values: dict[str, str]) -> dict[str, str]:
        if sum(len(value) for value in values.values()) > 50000:
            raise ValueError("试跑输入过长。")
        return values


class ConfigurationProbeScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    config_version_id: UUID
    version_ids: dict[ConfigKind, UUID]

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return ConfigurationProbeInput.exact_schema_version(value)


class ConfigurationProbeConfiguration(ConfigurationProbeScope):
    config_kind: ConfigKind
    api: APIConfigContent | None = None
    model: ModelConfigContent | None = None
    prompt: PromptConfigContent | None = None
    agent: AgentConfigContent | None = None

    @model_validator(mode="after")
    def fixed_version_chain(self) -> "ConfigurationProbeConfiguration":
        if self.version_ids.get(self.config_kind) != self.config_version_id:
            raise ValueError("试跑配置版本不一致。")
        for kind in ("api", "model", "prompt", "agent"):
            if (getattr(self, kind) is not None) != (kind in self.version_ids):
                raise ValueError("试跑配置链不完整。")
        if self.config_kind == "api" and set(self.version_ids) != {"api"}:
            raise ValueError("API试跑不得附带其他配置。")
        if self.config_kind == "prompt" and set(self.version_ids) != {"prompt"}:
            raise ValueError("提示词预览不得隐式调用模型。")
        if self.config_kind in {"model", "agent"}:
            if self.api is None or self.model is None:
                raise ValueError("模型试跑缺少固定供应商版本。")
            if self.model.api_version_id != self.version_ids.get("api"):
                raise ValueError("模型的API版本不一致。")
        if self.config_kind == "model" and set(self.version_ids) != {"api", "model"}:
            raise ValueError("模型单项试跑不得隐式附加提示词。")
        if self.config_kind == "agent":
            if (
                self.agent is None
                or self.prompt is None
                or set(self.version_ids) != {"api", "model", "prompt", "agent"}
            ):
                raise ValueError("智能体试跑需要完整固定版本链。")
            if (
                self.agent.model_version_id != self.version_ids["model"]
                or self.agent.prompt_version_id != self.version_ids["prompt"]
            ):
                raise ValueError("智能体的模型或提示词版本不一致。")
        return self


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


class MaterialParseInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    material_id: UUID
    original_version_id: UUID
    original_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    expected_parse_id: UUID | None

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return InspectionInput.exact_schema_version(value)


class MaterialParseConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    schema_version: Literal[1] = 1
    parser_version: Literal["thesispilot-material-1"] = "thesispilot-material-1"
    file_type: Literal["docx", "text", "pdf"]

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return InspectionInput.exact_schema_version(value)


class ContentRevisionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    run_id: UUID

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return InspectionInput.exact_schema_version(value)


class ReviewInput(BaseModel):
    """Independent review: the frozen review run owns every input version."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    review_id: UUID

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return InspectionInput.exact_schema_version(value)


class JobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    kind: JobKind = "diagnostic"
    input_snapshot: (
        InspectionInput | ConfigurationProbeInput | MaterialParseInput | ContentRevisionInput | None
    ) = None
    configuration: InspectionConfiguration | None = None

    @model_validator(mode="after")
    def fixed_contract(self) -> "JobCreate":
        if self.kind == "content_revision":
            raise ValueError("内容修订只能从助手会话入口发起，不能直接创建后台任务。")
        if self.kind == "review":
            raise ValueError("论文评审只能从评审入口发起，不能直接创建后台任务。")
        if self.kind == "diagnostic":
            if self.input_snapshot is not None or self.configuration is not None:
                raise ValueError("诊断任务不接受业务输入或配置。")
        elif self.kind == "document_inspection":
            if not isinstance(self.input_snapshot, InspectionInput):
                raise ValueError("结构检查需要固定的正式稿版本。")
            if self.configuration is None:
                self.configuration = InspectionConfiguration()
        elif self.kind == "material_parse":
            if (
                not isinstance(self.input_snapshot, MaterialParseInput)
                or self.configuration is not None
            ):
                raise ValueError("资料解析需要服务器固定的原件输入，不接受客户端配置。")
        elif (
            not isinstance(self.input_snapshot, ConfigurationProbeInput)
            or self.configuration is not None
        ):
            raise ValueError("配置试跑需要固定版本输入，不接受客户端配置快照。")
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


class ConfigurationProbeResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["configuration_probe"]
    schema_version: Literal[1]
    job_id: JsonUUID
    project_id: JsonUUID
    config_version_id: JsonUUID
    config_kind: ConfigKind
    version_ids: Annotated[dict[ConfigKind, JsonUUID], Field(min_length=1, max_length=4)]
    model_used: bool
    requested_model: Annotated[str, Field(min_length=1, max_length=200)] | None
    response_model: Annotated[str, Field(min_length=1, max_length=200)] | None
    content: Annotated[str, Field(min_length=1, max_length=50000)]
    writes_performed: Literal[False]

    @field_validator("job_id", "project_id", "config_version_id", mode="before")
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
        return ConfigurationProbeInput.exact_schema_version(value)

    @model_validator(mode="after")
    def exact_execution_mode(self) -> "ConfigurationProbeResult":
        if self.model_used != (self.config_kind in {"model", "agent"}):
            raise ValueError("试跑模型使用声明不一致。")
        if self.model_used != (
            self.requested_model is not None and self.response_model is not None
        ):
            raise ValueError("试跑模型来源不完整。")
        if not self.model_used and (
            self.requested_model is not None or self.response_model is not None
        ):
            raise ValueError("确定性预览不得声明模型响应。")
        if self.version_ids.get(self.config_kind) != self.config_version_id:
            raise ValueError("试跑结果版本不一致。")
        return self


class MaterialParseResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["material_parse"]
    schema_version: Literal[1]
    job_id: JsonUUID
    project_id: JsonUUID
    material_id: JsonUUID
    original_version_id: JsonUUID
    original_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    parser_version: Literal["thesispilot-material-1"]
    parse_version_id: JsonUUID
    anchor_count: Annotated[int, Field(ge=0, le=100000)]
    text_characters: Annotated[int, Field(ge=0, le=64 * 1024 * 1024)]
    model_used: Literal[False]
    writes_performed: Literal[False]

    @field_validator(
        "job_id",
        "project_id",
        "material_id",
        "original_version_id",
        "parse_version_id",
        mode="before",
    )
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


class ContentRevisionResult(BaseModel):
    """Only references; private assistant text stays in its project-scoped session."""

    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["content_revision"]
    schema_version: Literal[1]
    job_id: JsonUUID
    project_id: JsonUUID
    run_id: JsonUUID
    session_id: JsonUUID
    document_id: JsonUUID
    document_version: VersionNumber
    assistant_message_id: JsonUUID
    candidate_id: JsonUUID
    requested_model: Annotated[str, Field(min_length=1, max_length=200)]
    response_model: Annotated[str, Field(min_length=1, max_length=200)]
    model_used: Literal[True]
    writes_performed: Literal[False]

    @field_validator(
        "job_id",
        "project_id",
        "run_id",
        "session_id",
        "document_id",
        "assistant_message_id",
        "candidate_id",
        mode="before",
    )
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


class ReviewResult(BaseModel):
    """Only references; the immutable report lives in the project-scoped review module."""

    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["review"]
    schema_version: Literal[1]
    job_id: JsonUUID
    project_id: JsonUUID
    review_id: JsonUUID
    report_id: JsonUUID
    document_id: JsonUUID
    document_version: VersionNumber
    requested_model: Annotated[str, Field(min_length=1, max_length=200)]
    response_model: Annotated[str, Field(min_length=1, max_length=200)]
    model_used: Literal[True]
    writes_performed: Literal[False]

    @field_validator("job_id", "project_id", "review_id", "report_id", "document_id", mode="before")
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


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    kind: JobKind
    status: JobStatus
    attempt: int
    result: (
        DiagnosticResult
        | InspectionResult
        | ConfigurationProbeResult
        | MaterialParseResult
        | ContentRevisionResult
        | ReviewResult
        | None
    )
    input_snapshot: (
        InspectionInput
        | ConfigurationProbeInput
        | MaterialParseInput
        | ContentRevisionInput
        | ReviewInput
        | None
    ) = None
    configuration: (
        InspectionConfiguration
        | ConfigurationProbeConfiguration
        | MaterialParseConfiguration
        | None
    ) = None
    resource_scope: (
        InspectionInput
        | ConfigurationProbeScope
        | MaterialParseInput
        | ContentRevisionInput
        | ReviewInput
        | None
    ) = None
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
    kind: Literal[
        "document_inspection", "configuration_probe", "material_parse", "content_revision", "review"
    ]
    schema_version: Literal[1]
    created_at: datetime
    result: (
        InspectionResult
        | ConfigurationProbeResult
        | MaterialParseResult
        | ContentRevisionResult
        | ReviewResult
    )


class JobDetail(JobRead):
    attempts: list[JobAttemptRead]
    artifacts: list[JobArtifactRead]
