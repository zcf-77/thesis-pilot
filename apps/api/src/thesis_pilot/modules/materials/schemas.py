"""Public material DTOs never serialize stored original bytes."""

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

from thesis_pilot.modules.jobs.schemas import JobRead
from thesis_pilot.parsers.schemas import ParsedMaterial

MAX_ORIGINAL_BYTES = 8 * 1024 * 1024
MAX_BASE64_CHARACTERS = 4 * ((MAX_ORIGINAL_BYTES + 2) // 3)
MAX_UPLOAD_BODY_BYTES = MAX_BASE64_CHARACTERS + 64 * 1024
MaterialKind = Literal["template", "requirements", "literature", "other"]
FileType = Literal["docx", "text", "pdf"]
MaterialName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
SourceNote = Annotated[str, StringConstraints(max_length=4000)]


class MaterialUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: MaterialName
    filename: Annotated[str, StringConstraints(min_length=1, max_length=255)]
    file_type: FileType
    kind: MaterialKind
    source_note: SourceNote = ""
    content_base64: Annotated[
        str, StringConstraints(strict=True, min_length=4, max_length=MAX_BASE64_CHARACTERS)
    ]

    @field_validator("filename")
    @classmethod
    def metadata_filename(cls, value: str) -> str:
        if (
            value in {".", ".."}
            or any(char in value for char in ("/", "\\", ":"))
            or any(ord(char) < 32 or ord(char) == 127 for char in value)
        ):
            raise ValueError("文件名不能包含路径或控制字符。")
        return value


class MaterialOriginalCreate(MaterialUpload):
    expected_version: int = Field(ge=1, strict=True)


class MaterialUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1, strict=True)
    name: MaterialName | None = None
    kind: MaterialKind | None = None
    source_note: SourceNote | None = None
    linked: bool | None = Field(default=None, strict=True)
    removed: bool | None = Field(default=None, strict=True)

    @model_validator(mode="after")
    def explicit_update(self) -> Self:
        fields = self.model_fields_set - {"expected_version"}
        if not fields or any(getattr(self, field) is None for field in fields):
            raise ValueError("请提供非空的资料修改。")
        return self


class MaterialTimestamped(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    @field_validator("created_at", "updated_at", check_fields=False)
    @classmethod
    def utc_timestamp(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class MaterialRead(MaterialTimestamped):
    id: UUID
    project_id: UUID
    name: str
    kind: MaterialKind
    source_note: str
    version: int
    linked: bool
    removed: bool
    current_original_id: UUID
    created_at: datetime
    updated_at: datetime


class MaterialPage(BaseModel):
    items: list[MaterialRead]
    total: int
    limit: int
    offset: int


class MaterialOriginalRead(MaterialTimestamped):
    id: UUID
    material_id: UUID
    version: int
    filename: str
    file_type: FileType
    sha256: str
    byte_size: int
    latest_parse_id: UUID | None
    initial_job_id: UUID | None
    created_at: datetime


class MaterialOriginalPage(BaseModel):
    items: list[MaterialOriginalRead]
    total: int
    limit: int
    offset: int


class MaterialUploadReceipt(BaseModel):
    material: MaterialRead
    original: MaterialOriginalRead
    job: JobRead


class MaterialParseSummary(MaterialTimestamped):
    id: UUID
    original_version_id: UUID
    version: int
    status: Literal["complete", "partial"]
    source_job_id: UUID
    created_at: datetime


class MaterialParseRead(MaterialTimestamped):
    id: UUID
    original_version_id: UUID
    version: int
    source_job_id: UUID
    created_at: datetime
    result: ParsedMaterial


class MaterialParseSummaryPage(BaseModel):
    items: list[MaterialParseSummary]
    total: int
    limit: int
    offset: int


class MaterialReparse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_parse_id: UUID | None


class ProjectSourceBindingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=0, strict=True)
    template_parse_version_id: UUID | None
    requirement_parse_version_ids: list[UUID] = Field(max_length=50)

    @field_validator("requirement_parse_version_ids")
    @classmethod
    def distinct_requirements(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("要求来源版本不能重复。")
        return value


class ProjectSourceBindingRead(MaterialTimestamped):
    project_id: UUID
    version: int
    current_version_id: UUID | None
    template_parse_version_id: UUID | None
    requirement_parse_version_ids: list[UUID]
    updated_at: datetime | None


class ProjectSourceBindingVersionRead(MaterialTimestamped):
    id: UUID
    project_id: UUID
    version: int
    template_parse_version_id: UUID | None
    requirement_parse_version_ids: list[UUID]
    created_at: datetime


class ProjectSourceBindingVersionPage(BaseModel):
    items: list[ProjectSourceBindingVersionRead]
    total: int
    limit: int
    offset: int
