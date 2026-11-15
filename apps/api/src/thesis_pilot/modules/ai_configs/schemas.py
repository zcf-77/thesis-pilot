"""Strict library-specific content; arbitrary URLs, secrets and tools are forbidden."""

import re
from datetime import UTC, datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

ConfigKind = Literal["api", "model", "prompt", "agent"]
Capability = Literal["text", "search", "format", "plan", "review"]
Variable = Literal["context", "goal", "requirements", "materials"]
FieldType = Literal["string", "number", "boolean", "array", "object"]
AllowedTool = Literal["read_context", "return_suggestion"]
ConfigName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]
SchemaField = Annotated[str, StringConstraints(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,79}$")]
FieldSchema = Annotated[dict[SchemaField, FieldType], Field(max_length=50)]
TEMPLATE_VARIABLE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def default_tools() -> list[AllowedTool]:
    return ["read_context", "return_suggestion"]


class ConfigContentBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: Description = ""


class APIConfigContent(ConfigContentBase):
    kind: Literal["api"]
    provider: Literal["deepseek"] = "deepseek"
    base_url: Literal["https://api.deepseek.com"] = "https://api.deepseek.com"
    credential_ref: Literal["deepseek-default"] = "deepseek-default"
    timeout_seconds: int = Field(default=30, ge=1, le=300, strict=True)
    max_retries: int = Field(default=2, ge=0, le=3, strict=True)
    rate_limit_per_minute: int = Field(default=20, ge=1, le=1000, strict=True)


class ModelConfigContent(ConfigContentBase):
    kind: Literal["model"]
    api_version_id: UUID
    model_code: Literal["deepseek-flash", "deepseek-v4-pro"]
    capabilities: list[Capability] = Field(min_length=1, max_length=5)
    context_limit: int = Field(default=64000, ge=256, le=1000000, strict=True)
    temperature: float = Field(default=0.7, ge=0, le=2, allow_inf_nan=False, strict=True)
    max_output_tokens: int = Field(default=2048, ge=1, le=8192, strict=True)

    @field_validator("capabilities")
    @classmethod
    def distinct_capabilities(cls, value: list[Capability]) -> list[Capability]:
        if len(set(value)) != len(value):
            raise ValueError("模型能力不能重复。")
        return value


class PromptConfigContent(ConfigContentBase):
    kind: Literal["prompt"]
    template: Annotated[str, StringConstraints(min_length=1, max_length=20000)]
    variables: list[Variable] = Field(default_factory=list, max_length=4)
    input_schema: FieldSchema = Field(default_factory=dict)
    output_schema: FieldSchema = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid_template(self) -> Self:
        used = set(TEMPLATE_VARIABLE.findall(self.template))
        remainder = TEMPLATE_VARIABLE.sub("", self.template)
        if not self.template.strip() or "{{" in remainder or "}}" in remainder:
            raise ValueError("提示词为空或变量占位符不完整。")
        if len(set(self.variables)) != len(self.variables) or used != set(self.variables):
            raise ValueError("提示词变量声明必须与实际占位符一一对应。")
        if not set(self.input_schema).issubset(self.variables):
            raise ValueError("输入结构只能约束已声明变量。")
        return self


class AgentConfigContent(ConfigContentBase):
    kind: Literal["agent"]
    role: Literal["general", "literature", "content", "format", "progress", "review"]
    instructions: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
    ]
    model_version_id: UUID
    prompt_version_id: UUID
    allowed_tools: list[AllowedTool] = Field(
        default_factory=default_tools, min_length=1, max_length=2
    )
    input_schema: FieldSchema = Field(default_factory=dict)
    output_schema: FieldSchema = Field(default_factory=dict)

    @field_validator("allowed_tools")
    @classmethod
    def distinct_tools(
        cls, value: list[Literal["read_context", "return_suggestion"]]
    ) -> list[Literal["read_context", "return_suggestion"]]:
        if len(set(value)) != len(value):
            raise ValueError("允许工具不能重复。")
        return value


ConfigContent = Annotated[
    APIConfigContent | ModelConfigContent | PromptConfigContent | AgentConfigContent,
    Field(discriminator="kind"),
]


class AIConfigCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ConfigName
    enabled: bool = Field(default=True, strict=True)
    content: ConfigContent


class AIConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1, strict=True)
    name: ConfigName | None = None
    enabled: bool | None = Field(default=None, strict=True)
    content: ConfigContent | None = None

    @model_validator(mode="after")
    def explicit_update(self) -> Self:
        changed = self.model_fields_set - {"expected_version"}
        if not changed or any(getattr(self, key) is None for key in changed):
            raise ValueError("请提供非空的配置修改。")
        return self


class AIConfigCopy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ConfigName
    source_version: int | None = Field(default=None, ge=1, strict=True)


class AIConfigVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    config_id: UUID
    version: int
    name: str
    content: ConfigContent
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class AIConfigRead(BaseModel):
    id: UUID
    kind: ConfigKind
    name: str
    enabled: bool
    version: int
    current_version_id: UUID
    content: ConfigContent
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class AIConfigPage(BaseModel):
    items: list[AIConfigRead]
    total: int
    limit: int
    offset: int


class AIConfigVersionPage(BaseModel):
    items: list[AIConfigVersionRead]
    total: int
    limit: int
    offset: int


class AIConfigReference(BaseModel):
    config_id: UUID
    version_id: UUID
    kind: ConfigKind
    name: str
    version: int
    enabled: bool
    current: bool
    referenced_version_id: UUID


class AIConfigJobReference(BaseModel):
    job_id: UUID
    project_id: UUID
    kind: str
    status: str
    matched_version_ids: list[UUID]


class AIConfigReferences(BaseModel):
    configs: list[AIConfigReference]
    jobs: list[AIConfigJobReference]
    configs_truncated: bool
    jobs_truncated: bool


class AIConfigAvailability(BaseModel):
    provider: Literal["deepseek"] = "deepseek"
    credential_configured: bool
