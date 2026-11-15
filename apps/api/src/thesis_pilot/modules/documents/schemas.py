"""Public manuscript contract; JSON content also has editor-specific validation."""

from datetime import UTC, datetime
from typing import Annotated, Literal, cast
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    GetCoreSchemaHandler,
    GetJsonSchemaHandler,
    field_validator,
)
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import CoreSchema, core_schema

from thesis_pilot.modules.documents.structure import (
    MAX_SAFE_INTEGER,
    EditorJsonValue,
    JsonObject,
    canonical_editor_json,
)

DocumentSource = Literal[
    "local_import", "manual_edit", "ai_adoption", "adoption_undo", "version_revert", "blank"
]
VersionNumber = Annotated[int, Field(ge=1, le=MAX_SAFE_INTEGER, strict=True)]


def serialized_document(value: JsonObject) -> JsonObject:
    return value


class EditorJsonContract:
    """Complete editor validation without recursive union serializer overhead.

    The generic union reaches Pydantic's recursion guard before 80 editor levels.
    Requests and responses still export the same explicit recursive JSON schema.
    """

    def __get_pydantic_core_schema__(
        self, source: object, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        schema = handler(source)
        return core_schema.no_info_plain_validator_function(
            canonical_editor_json,
            json_schema_input_schema=schema,
            serialization=core_schema.plain_serializer_function_ser_schema(
                serialized_document, return_schema=core_schema.any_schema()
            ),
        )

    def __get_pydantic_json_schema__(
        self, schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        return handler(cast(CoreSchema, schema["json_schema_input_schema"]))


EditorDocument = Annotated[dict[str, EditorJsonValue], EditorJsonContract()]


class DocumentContent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, serialize_by_alias=True)

    schema_version: Literal[1]
    json_content: EditorDocument = Field(alias="json")

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("正文结构版本必须为整数。")
        return value


class DocumentImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: DocumentContent


class DocumentSave(DocumentImport):
    expected_version: VersionNumber


class Timestamped(BaseModel):
    @field_validator("created_at", "updated_at", check_fields=False)
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class DocumentRead(Timestamped):
    id: UUID
    project_id: UUID
    version: VersionNumber
    content: DocumentContent
    created_at: datetime
    updated_at: datetime


class DocumentVersionSummary(Timestamped):
    document_id: UUID
    project_id: UUID
    version: VersionNumber
    source: DocumentSource
    created_at: datetime


class DocumentVersionRead(DocumentVersionSummary):
    content: DocumentContent


class DocumentVersionPage(BaseModel):
    items: list[DocumentVersionSummary]
    total: int
    limit: int
    offset: int
