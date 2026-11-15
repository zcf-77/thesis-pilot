"""Import commands identify server facts and never accept client manuscript JSON."""

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

from thesis_pilot.modules.documents.structure import JsonObject

AnchorId = Annotated[str, StringConstraints(min_length=1, max_length=200)]
ChapterKind = Literal["heading", "paragraph"]


class ChapterCorrection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    anchor_id: AnchorId
    kind: ChapterKind
    level: int | None = Field(default=None, ge=1, le=6, strict=True)

    @model_validator(mode="after")
    def matching_level(self) -> Self:
        if (self.kind == "heading") != (self.level is not None):
            raise ValueError("标题必须选择 1—6 层级，段落不能指定标题层级。")
        return self


class DocumentSourcePreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    material_id: UUID
    original_version_id: UUID
    parse_version_id: UUID


class DocumentSourceImport(DocumentSourcePreviewRequest):
    command_id: UUID
    chapter_corrections: list[ChapterCorrection] = Field(default_factory=list, max_length=1000)

    @field_validator("chapter_corrections")
    @classmethod
    def distinct_anchors(cls, value: list[ChapterCorrection]) -> list[ChapterCorrection]:
        if len({item.anchor_id for item in value}) != len(value):
            raise ValueError("同一来源节点不能重复指定章节校正。")
        return value


class DocumentSourceChapter(BaseModel):
    anchor_id: str
    editor_path: list[int]
    title: str
    kind: ChapterKind
    level: int | None
    editable: bool
    allowed_kinds: list[ChapterKind]


class DocumentSourcePreview(BaseModel):
    project_id: UUID
    material_id: UUID
    original_version_id: UUID
    parse_version_id: UUID
    filename: str
    file_type: Literal["docx", "text"]
    original_sha256: str
    manifest_sha256: str
    parser_version: str
    status: Literal["complete", "partial"]
    can_import: bool
    existing_document_id: UUID | None
    chapters: list[DocumentSourceChapter]
    chapters_truncated: bool
    diagnostics: list[str]


class DocumentSourceImportReceipt(BaseModel):
    command_id: UUID
    document_id: UUID
    document_version: Literal[1] = 1
    source_id: UUID
    material_id: UUID
    original_version_id: UUID
    parse_version_id: UUID


class DocumentSourceRead(BaseModel):
    document_id: UUID
    document_version: int
    source_id: UUID
    material_id: UUID
    original_version_id: UUID
    parse_version_id: UUID
    original_sha256: str
    manifest_sha256: str
    filename: str
    file_type: Literal["docx", "text"]
    guard_version: str
    guard_contract: JsonObject
    imported_at: datetime

    @field_validator("imported_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
