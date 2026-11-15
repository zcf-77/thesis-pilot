"""One source-linked parsing contract shared by storage, jobs and clients."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from thesis_pilot.modules.documents.schemas import EditorDocument
from thesis_pilot.modules.documents.structure import JsonObject


class SourceAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    original_version_id: UUID
    kind: str
    part: str
    xml_path: str | None = None
    line: int | None = Field(default=None, ge=1)
    original_text: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    xml_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    editor_path: list[int] | None = None
    editable: bool = False


class TemplateItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    field: str
    scope: str
    value: str | int | float | bool | None
    unit: str | None = None
    state: Literal["recognized", "unknown", "conflict"]
    anchor_ids: list[str]
    note: str


class ParsedRequirement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    original_text: str
    anchor_ids: list[str]
    scope: str
    rule_type: Literal["hard", "semantic"]
    kind: Literal["word_count", "reference_count", "semantic"]
    parameters: dict[str, int] = Field(default_factory=dict)
    strictness: Literal["required", "suggested", "unknown"]
    enabled: bool
    checkable: bool
    uncertainty: str


class ParsedMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    parser_version: Literal["thesispilot-material-1"] = "thesispilot-material-1"
    status: Literal["complete", "partial"]
    plain_text: str
    anchors: list[SourceAnchor] = Field(max_length=20000)
    editor_json: EditorDocument | None
    roundtrip_manifest: JsonObject | None
    template_items: list[TemplateItem] = Field(max_length=20000)
    requirements: list[ParsedRequirement] = Field(max_length=20000)
    diagnostics: list[str]
