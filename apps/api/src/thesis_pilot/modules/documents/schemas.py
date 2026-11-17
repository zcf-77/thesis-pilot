"""Public manuscript contract; JSON content also has editor-specific validation."""

from datetime import UTC, datetime
from typing import Annotated, Literal, cast
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Discriminator,
    Field,
    GetCoreSchemaHandler,
    GetJsonSchemaHandler,
    Tag,
    field_validator,
)
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import CoreSchema, core_schema

from thesis_pilot.modules.documents.docs_model import DocsSnapshot, JsonDict, validate_snapshot
from thesis_pilot.modules.documents.structure import (
    MAX_SAFE_INTEGER,
    EditorJsonValue,
    JsonObject,
    canonical_editor_json,
)

DocumentSource = Literal[
    "local_import",
    "manual_edit",
    "ai_adoption",
    "adoption_undo",
    "version_revert",
    "blank",
    "schema_upgrade",
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


class DocsSnapshotContract:
    """v2 snapshot: strict DocsModel subset + protections + derived chapters.

    Validation is a plain function (canonical kernel JSON out) so deep manuscripts do
    not hit Pydantic's serializer recursion guard; the schema exported is DocsSnapshot.
    """

    def __get_pydantic_core_schema__(
        self, source: object, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        return core_schema.no_info_plain_validator_function(
            validate_snapshot,
            json_schema_input_schema=handler.generate_schema(DocsSnapshot),
            serialization=core_schema.plain_serializer_function_ser_schema(
                serialized_document, return_schema=core_schema.any_schema()
            ),
        )

    def __get_pydantic_json_schema__(
        self, schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        return handler(cast(CoreSchema, schema["json_schema_input_schema"]))


SnapshotDocument = Annotated[JsonDict, DocsSnapshotContract()]


class DocumentContentV2(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, serialize_by_alias=True)

    schema_version: Literal[2]
    json_content: SnapshotDocument = Field(alias="json")


def content_schema_tag(value: object) -> str | None:
    raw = value.get("schema_version") if isinstance(value, dict) else None
    raw = getattr(value, "schema_version", raw)
    # bool/float never select a branch: strict integer tags only.
    return str(raw) if type(raw) is int else None


AnyDocumentContent = Annotated[
    Annotated[DocumentContent, Tag("1")] | Annotated[DocumentContentV2, Tag("2")],
    Discriminator(content_schema_tag),
]


class DocumentImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: AnyDocumentContent


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
    content: AnyDocumentContent
    created_at: datetime
    updated_at: datetime


class DocumentVersionSummary(Timestamped):
    document_id: UUID
    project_id: UUID
    version: VersionNumber
    source: DocumentSource
    created_at: datetime


class DocumentVersionRead(DocumentVersionSummary):
    content: AnyDocumentContent
    # True only for ``?as=v2``: an in-memory, read-only conversion of a stored v1 version.
    converted: bool = False


class DocumentVersionPage(BaseModel):
    items: list[DocumentVersionSummary]
    total: int
    limit: int
    offset: int


class DocumentSchemaUpgradeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    expected_version: VersionNumber


class LossItem(BaseModel):
    kind: str
    path: str
    detail: str | None = None


class DocumentSchemaUpgradeRecord(Timestamped):
    id: UUID
    document_id: UUID
    command_id: UUID
    from_version: VersionNumber
    to_version: VersionNumber
    from_schema_version: Literal[1]
    to_schema_version: Literal[2]
    converter_version: str
    converter_sha256: str
    loss_report: list[LossItem]
    created_at: datetime


class DocumentSchemaUpgradeRead(BaseModel):
    document: DocumentRead
    upgrade: DocumentSchemaUpgradeRecord
    # True when the same command was already applied; nothing new was written.
    replayed: bool


ResourceMime = Literal["image/png", "image/jpeg", "image/gif", "image/webp"]


class DocumentResourceUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mime: ResourceMime
    content_base64: Annotated[str, Field(strict=True, min_length=4, max_length=13981016)]


class DocumentResourceRead(Timestamped):
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    uri: str
    mime: ResourceMime
    byte_size: int
    width_px: int | None
    height_px: int | None
    created_at: datetime
