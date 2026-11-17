"""MuffinOffice DocsModel subset (schema v1 of the kernel) and ThesisPilot snapshot v2.

The classes mirror ``crates/office-model`` field names, tags and serde defaults so a
canonical dump equals the kernel's ``serde_json`` serialization (fields skipped when
they equal their serde default). ThesisPilot is stricter than the kernel: unknown
fields are rejected and footnotes, comments, kernel revisions, containers, charts and
embedded resource bytes are outside the supported subset.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated, Any, ClassVar, Literal, cast

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
)
from pydantic.alias_generators import to_camel

from thesis_pilot.core.errors import AppError

type JsonValue = dict[str, JsonValue] | list[JsonValue] | str | bool | int | float | None
type JsonDict = dict[str, JsonValue]

SNAPSHOT_SCHEMA_VERSION = 2
KERNEL_SCHEMA_VERSION = 1
MAX_SAFE_INTEGER = 9007199254740991
# Blocks, list items, table rows and cells (document and sections excluded).
MAX_NODES = 100000
MAX_DEPTH = 80
MAX_JSON_DEPTH = 400
MAX_CONTENT_BYTES = 16 * 1024 * 1024
MAX_ID_LENGTH = 200
MAX_PROTECTIONS = 100000
MAX_RESOURCES = 2000
MAX_UNSUPPORTED = 10000
MAX_TITLE_LENGTH = 200
# Cheap pre-parse bound on JSON objects carrying a type/id (inlines included).
MAX_RAW_OBJECTS = 1_000_000
# The JavaScript ``\s`` set: chapter word counts match the editor exactly.
SPACE = "\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
REFERENCES_TITLE = re.compile(f"^[{SPACE}]*(?:[0-9]*[.、{SPACE}]*)?参考文献[{SPACE}]*$")
WHITESPACE = re.compile(f"[{SPACE}]")
RESOURCE_URI_PREFIX = "tp-resource:"
# One inline atom (break, tab, image, field, bookmark) occupies one scalar offset.
OBJECT_ATOM = "\ufffc"
PROTECTION_KINDS = ("number", "citation", "formula", "lock", "object", "source")
# Kinds a manual save may add or remove; everything else is server-owned.
USER_PROTECTION_KINDS = frozenset({"lock"})


def model_invalid(message: str = "正文模型不符合支持的结构，当前稿保持不变。") -> AppError:
    return AppError("DOCMODEL_INVALID", message, 422)


def model_too_large() -> AppError:
    return AppError("DOCMODEL_TOO_LARGE", "正文模型超过大小或层级限制，请缩减后重试。", 413)


# ---------- base ----------

Emu = Annotated[int, Field(ge=-MAX_SAFE_INTEGER, le=MAX_SAFE_INTEGER, strict=True)]
U8 = Annotated[int, Field(ge=0, le=255, strict=True)]
U32 = Annotated[int, Field(ge=0, le=4294967295, strict=True)]
I32 = Annotated[int, Field(ge=-2147483648, le=2147483647, strict=True)]
NodeId = Annotated[str, Field(min_length=1, max_length=MAX_ID_LENGTH, strict=True)]
Text = Annotated[str, Field(strict=True)]
ShortText = Annotated[str, Field(max_length=4096, strict=True)]


class Strict(BaseModel):
    """Kernel-shaped strict model; dumps omit fields equal to their serde default."""

    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        alias_generator=to_camel,
        validate_by_alias=True,
        validate_by_name=False,
        serialize_by_alias=True,
        frozen=True,
        # One schema for requests and responses (no -Input/-Output split).
        json_schema_mode_override="validation",
    )
    # Fields serialized even when equal to their default (serde without skip).
    always: ClassVar[frozenset[str]] = frozenset()


def to_json(value: object) -> JsonValue:
    """Kernel-canonical dump. Manual recursion avoids Pydantic's serializer depth guard."""
    if isinstance(value, Strict):
        result: JsonDict = {}
        for name, info in type(value).model_fields.items():
            item = getattr(value, name)
            if (
                not info.is_required()
                and name not in value.always
                and item == info.get_default(call_default_factory=True)
            ):
                continue
            result[info.alias or name] = to_json(item)
        return result
    if isinstance(value, list):
        return [to_json(item) for item in value]
    if isinstance(value, dict):
        return {key: to_json(item) for key, item in value.items()}
    return cast(JsonValue, value)


# ---------- colors, fonts, inline props ----------

ThemeColorName = Literal[
    "dk1",
    "lt1",
    "dk2",
    "lt2",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "hlink",
    "folHlink",
]


class DocsRgbColor(Strict):
    kind: Literal["rgb"]
    value: Annotated[str, Field(pattern=r"^[0-9A-Fa-f]{6}$", strict=True)]


class DocsThemeColorValue(Strict):
    kind: Literal["theme"]
    value: ThemeColorName


class DocsAutoColor(Strict):
    kind: Literal["auto"]


Color = Annotated[DocsRgbColor | DocsThemeColorValue | DocsAutoColor, Field(discriminator="kind")]


class DocsThemeFontRef(Strict):
    kind: Literal["theme"]
    value: Literal["body", "heading", "mono"]


class DocsNamedFontRef(Strict):
    kind: Literal["named"]
    value: Annotated[str, Field(min_length=1, max_length=200, strict=True)]


FontRef = Annotated[DocsThemeFontRef | DocsNamedFontRef, Field(discriminator="kind")]
Underline = Literal["none", "single", "double", "dotted", "dashed", "wavy"]


class DocsLink(Strict):
    href: Annotated[str, Field(min_length=1, max_length=4096, strict=True)]
    title: ShortText | None = None


class DocsInlineProps(Strict):
    style: ShortText | None = None
    bold: bool | None = None
    italic: bool | None = None
    underline: Underline | None = None
    strike: bool | None = None
    code: bool | None = None
    color: Color | None = None
    highlight: Color | None = None
    size: U32 | None = None
    font: FontRef | None = None
    font_east_asia: FontRef | None = None
    vertical_align: Literal["baseline", "superscript", "subscript"] | None = None
    link: DocsLink | None = None
    lang: ShortText | None = None
    letter_spacing: Emu | None = None


# ---------- inlines ----------


class DocsAnchorPos(Strict):
    from_: Literal["page", "margin"] = Field(alias="from")
    align: Literal["start", "center", "end"] | None = None
    offset: Emu = 0


class DocsImageAnchor(Strict):
    x: DocsAnchorPos
    y: DocsAnchorPos
    behind_text: bool = False


class DocsRunInline(Strict):
    type: Literal["run"]
    text: Text
    props: DocsInlineProps = Field(default_factory=DocsInlineProps)


class DocsBreakInline(Strict):
    always = frozenset({"kind"})
    type: Literal["break"]
    kind: Literal["line", "column"] = "line"


class DocsTabInline(Strict):
    type: Literal["tab"]


class DocsImageInline(Strict):
    type: Literal["image"]
    resource: NodeId
    title: ShortText | None = None
    width: Emu | None = None
    height: Emu | None = None
    alt: ShortText | None = None
    anchor: DocsImageAnchor | None = None


class DocsFieldInline(Strict):
    type: Literal["field"]
    kind: Literal["page_number", "num_pages", "date", "title", "author"]


class DocsBookmarkInline(Strict):
    type: Literal["bookmark"]
    name: Annotated[str, Field(min_length=1, max_length=200, strict=True)]


Inline = Annotated[
    DocsRunInline
    | DocsBreakInline
    | DocsTabInline
    | DocsImageInline
    | DocsFieldInline
    | DocsBookmarkInline,
    Field(discriminator="type"),
]


# ---------- paragraph props ----------

Align = Literal["start", "center", "end", "justify", "distributed"]


class DocsLineMultiple(Strict):
    kind: Literal["multiple"]
    value: U32


class DocsLineExact(Strict):
    kind: Literal["exact"]
    value: Emu


class DocsLineAtLeast(Strict):
    kind: Literal["at_least"]
    value: Emu


LineSpacing = Annotated[
    DocsLineMultiple | DocsLineExact | DocsLineAtLeast, Field(discriminator="kind")
]


class DocsSpacing(Strict):
    before: Emu | None = None
    after: Emu | None = None
    line: LineSpacing | None = None


class DocsIndent(Strict):
    start: Emu | None = None
    end: Emu | None = None
    first_line: Emu | None = None
    hanging: Emu | None = None
    start_chars: I32 | None = None
    end_chars: I32 | None = None
    first_line_chars: I32 | None = None


class DocsTabStop(Strict):
    pos: Emu
    kind: Literal["start", "center", "end", "decimal", "clear"]
    leader: Literal["none", "dot", "hyphen", "underscore"] | None = None


class DocsBorder(Strict):
    style: Literal["none", "single", "double", "dashed", "dotted"]
    width: Emu | None = None
    color: Color | None = None


class DocsBorders(Strict):
    top: DocsBorder | None = None
    bottom: DocsBorder | None = None
    left: DocsBorder | None = None
    right: DocsBorder | None = None
    inside_h: DocsBorder | None = None
    inside_v: DocsBorder | None = None


class DocsListLabel(Strict):
    always = frozenset({"text"})
    text: ShortText = ""
    suffix: Literal["tab", "space", "nothing"] | None = None
    run: DocsInlineProps = Field(default_factory=DocsInlineProps)
    level: U8 = 0


class DocsParaProps(Strict):
    style: ShortText | None = None
    align: Align | None = None
    spacing: DocsSpacing = Field(default_factory=DocsSpacing)
    indent: DocsIndent = Field(default_factory=DocsIndent)
    keep_with_next: bool | None = None
    keep_lines: bool | None = None
    widow_control: bool | None = None
    auto_space_de: bool | None = None
    auto_space_dn: bool | None = None
    page_break_before: bool | None = None
    outline_level: U8 | None = None
    shading: Color | None = None
    borders: DocsBorders | None = None
    tabs: Annotated[list[DocsTabStop], Field(max_length=64)] = Field(default_factory=list)
    snap_to_grid: bool | None = None
    kinsoku: bool | None = None
    overflow_punct: bool | None = None
    top_line_punct: bool | None = None
    adjust_right_ind: bool | None = None
    run: DocsInlineProps = Field(default_factory=DocsInlineProps)
    list_label: DocsListLabel | None = None


# ---------- blocks ----------

Inlines = list[Inline]


class DocsParagraphBlock(Strict):
    type: Literal["paragraph"]
    id: NodeId
    props: DocsParaProps = Field(default_factory=DocsParaProps)
    inlines: Inlines


class DocsHeadingBlock(Strict):
    type: Literal["heading"]
    id: NodeId
    level: Annotated[int, Field(ge=1, le=6, strict=True)]
    props: DocsParaProps = Field(default_factory=DocsParaProps)
    inlines: Inlines


ListKind = Literal[
    "bullet",
    "decimal",
    "lower_alpha",
    "upper_alpha",
    "lower_roman",
    "upper_roman",
    "chinese_counting",
    "chinese_paren",
    "task",
    "decimal_enclosed_circle",
]


class DocsListItem(Strict):
    id: NodeId
    checked: bool | None = None
    blocks: list[Block]


class DocsListBlock(Strict):
    type: Literal["list"]
    id: NodeId
    kind: ListKind
    start: U32 | None = None
    numbering: ShortText | None = None
    items: list[DocsListItem]


class DocsEmuWidth(Strict):
    kind: Literal["emu"]
    value: Emu


class DocsPctWidth(Strict):
    kind: Literal["pct"]
    value: U32


TableWidth = Annotated[DocsEmuWidth | DocsPctWidth, Field(discriminator="kind")]


class DocsTableContinuation(Strict):
    label: ShortText
    props: DocsParaProps


class DocsTableProps(Strict):
    continuation: DocsTableContinuation | None = None
    style: ShortText | None = None
    width: TableWidth | None = None
    align: Align | None = None
    borders: DocsBorders | None = None
    header_rows: U32 = 0
    cell_margin: Emu | None = None
    cell_margin_vertical: Emu | None = None
    layout: Literal["fixed", "autofit"] | None = None


class DocsCellProps(Strict):
    width: Emu | None = None
    valign: Literal["top", "center", "bottom"] | None = None
    shading: Color | None = None
    borders: DocsBorders | None = None


Span = Annotated[int, Field(ge=1, le=10000, strict=True)]


class DocsTableCell(Strict):
    id: NodeId
    col_span: Span = 1
    row_span: Span = 1
    props: DocsCellProps = Field(default_factory=DocsCellProps)
    blocks: list[Block]


class DocsTableRow(Strict):
    id: NodeId
    height: Emu | None = None
    header: bool = False
    cant_split: bool | None = None
    keep_with_next: bool | None = None
    cells: list[DocsTableCell]


class DocsTableBlock(Strict):
    type: Literal["table"]
    id: NodeId
    props: DocsTableProps = Field(default_factory=DocsTableProps)
    col_widths: list[Emu] = Field(default_factory=list)
    rows: list[DocsTableRow]
    caption: Inlines | None = None


class DocsImageBlock(Strict):
    type: Literal["image"]
    id: NodeId
    resource: NodeId
    width: Emu | None = None
    height: Emu | None = None
    alt: ShortText | None = None
    caption: Inlines | None = None
    align: Align | None = None


class DocsCodeBlock(Strict):
    type: Literal["code_block"]
    id: NodeId
    lang: ShortText | None = None
    text: Text


class DocsQuoteBlock(Strict):
    type: Literal["quote"]
    id: NodeId
    blocks: list[Block]


class DocsPageBreakBlock(Strict):
    type: Literal["page_break"]
    id: NodeId


class DocsRuleBlock(Strict):
    type: Literal["rule"]
    id: NodeId


class DocsTocBlock(Strict):
    always = frozenset({"levels"})
    type: Literal["toc"]
    id: NodeId
    levels: U8 = 3
    title: ShortText | None = None


Block = Annotated[
    DocsParagraphBlock
    | DocsHeadingBlock
    | DocsListBlock
    | DocsTableBlock
    | DocsImageBlock
    | DocsCodeBlock
    | DocsQuoteBlock
    | DocsPageBreakBlock
    | DocsRuleBlock
    | DocsTocBlock,
    Field(discriminator="type"),
]


# ---------- document ----------


class DocsPageSize(Strict):
    width: Emu
    height: Emu


class DocsMargins(Strict):
    top: Emu
    bottom: Emu
    left: Emu
    right: Emu
    header: Emu | None = None
    footer: Emu | None = None
    gutter: Emu | None = None


class DocsDocGrid(Strict):
    kind: Literal["lines", "lines_and_chars", "snap_to_chars"]
    line_pitch: Emu
    char_space: I32 | None = None


class DocsPageProps(Strict):
    size: DocsPageSize
    orientation: Literal["portrait", "landscape"]
    margins: DocsMargins
    columns: U8 | None = None
    grid: DocsDocGrid | None = None


class DocsHeaderFooter(Strict):
    always = frozenset({"blocks"})
    blocks: list[Block] = Field(default_factory=list)
    first_page: list[Block] | None = None
    even_page: list[Block] | None = None


class DocsSection(Strict):
    id: NodeId
    break_kind: Literal["next_page", "continuous", "even_page", "odd_page"] | None = None
    page_number_start: Annotated[int, Field(ge=1, le=4294967295, strict=True)] | None = None
    page: DocsPageProps | None = None
    header: DocsHeaderFooter | None = None
    footer: DocsHeaderFooter | None = None
    blocks: list[Block]


class DocsMeta(Strict):
    title: ShortText | None = None
    subtitle: ShortText | None = None
    author: ShortText | None = None
    date: ShortText | None = None
    keywords: Annotated[list[ShortText], Field(max_length=200)] = Field(default_factory=list)
    lang: ShortText | None = None
    custom: Annotated[dict[str, ShortText], Field(max_length=200)] = Field(default_factory=dict)


class DocsThemeRef(Strict):
    name: Annotated[str, Field(min_length=1, max_length=200, strict=True)]


class DocsUriData(Strict):
    kind: Literal["uri"]
    value: Annotated[str, Field(pattern=r"^tp-resource:[0-9a-f]{64}$", strict=True)]


class DocsResource(Strict):
    id: NodeId
    mime: Literal["image/png", "image/jpeg", "image/gif", "image/webp"]
    name: ShortText | None = None
    data: DocsUriData
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$", strict=True)] | None = None
    width_px: U32 | None = None
    height_px: U32 | None = None


class DocsUnsupported(Strict):
    kind: Annotated[str, Field(min_length=1, max_length=200, strict=True)]
    path: ShortText
    detail: ShortText | None = None


class DocsModel(Strict):
    kind: Literal["docs"]
    schema_version: Literal[1]
    id: NodeId
    meta: DocsMeta = Field(default_factory=DocsMeta)
    theme: DocsThemeRef
    sections: Annotated[list[DocsSection], Field(min_length=1, max_length=1000)]
    resources: Annotated[list[DocsResource], Field(max_length=MAX_RESOURCES)] = Field(
        default_factory=list
    )
    unsupported: Annotated[list[DocsUnsupported], Field(max_length=MAX_UNSUPPORTED)] = Field(
        default_factory=list
    )


# ---------- ThesisPilot snapshot ----------


class DocsProtectionAnchor(Strict):
    node: NodeId
    start: Annotated[int, Field(ge=0, le=MAX_SAFE_INTEGER, strict=True)] | None = None
    end: Annotated[int, Field(ge=0, le=MAX_SAFE_INTEGER, strict=True)] | None = None


class DocsProtection(Strict):
    id: NodeId
    kind: Literal["number", "citation", "formula", "lock", "object", "source"]
    anchor: DocsProtectionAnchor
    binding: Annotated[str, Field(min_length=1, max_length=MAX_ID_LENGTH, strict=True)] | None = (
        None
    )


Count = Annotated[int, Field(ge=0, le=MAX_SAFE_INTEGER, strict=True)]


class DocsChapter(Strict):
    """Derived outline entry; same rule as the editor's ``deriveChapters``."""

    id: NodeId
    level: Annotated[int, Field(ge=1, le=6, strict=True)]
    # Run text of the heading joined as is (no trimming, inline objects excluded).
    title: Text
    # Index of the heading in the concatenated top-level blocks of all sections.
    block: Count
    # Exclusive end: next heading of equal or higher rank, else the block count.
    end: Count
    # Non-whitespace scalars of body blocks, stopping at the references heading.
    words: Count


for _recursive in (
    DocsListItem,
    DocsListBlock,
    DocsTableCell,
    DocsTableRow,
    DocsTableBlock,
    DocsQuoteBlock,
    DocsHeaderFooter,
    DocsSection,
    DocsModel,
):
    _recursive.model_rebuild()


class DocsSnapshot(Strict):
    """Stored in ``document_versions.content_json`` when ``schema_version`` is 2."""

    schema_version: Literal[2]
    model: DocsModel
    protections: Annotated[list[DocsProtection], Field(max_length=MAX_PROTECTIONS)] = Field(
        default_factory=list
    )
    # Derived: input chapters are shape-checked then recomputed; responses always carry them.
    chapters: list[DocsChapter] | None = None


BLOCK_ADAPTER: TypeAdapter[Any] = TypeAdapter(Block)
INLINES_ADAPTER: TypeAdapter[list[Any]] = TypeAdapter(list[Inline])
PARA_PROPS_ADAPTER: TypeAdapter[DocsParaProps] = TypeAdapter(DocsParaProps)
PROTECTIONS_ADAPTER: TypeAdapter[list[DocsProtection]] = TypeAdapter(
    Annotated[list[DocsProtection], Field(max_length=MAX_PROTECTIONS)]
)
CHAPTERS_ADAPTER: TypeAdapter[list[DocsChapter]] = TypeAdapter(list[DocsChapter])


# ---------- raw guards ----------


def _well_formed(value: str) -> bool:
    return not any(0xD800 <= ord(char) <= 0xDFFF for char in value)


def guard_raw(value: object, *, max_nodes: int = MAX_RAW_OBJECTS) -> None:
    """Bound depth/size and reject lone surrogates before Pydantic recursion."""
    nodes = 0
    stack: list[tuple[object, int]] = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        if depth > MAX_JSON_DEPTH:
            raise model_too_large()
        if isinstance(item, dict):
            if "type" in item or "id" in item:
                nodes += 1
                if nodes > max_nodes:
                    raise model_too_large()
            for key, child in item.items():
                if not isinstance(key, str) or not _well_formed(key):
                    raise model_invalid()
                stack.append((child, depth + 1))
        elif isinstance(item, list):
            stack.extend((child, depth + 1) for child in item)
        elif isinstance(item, str):
            if not _well_formed(item):
                raise model_invalid()
        elif isinstance(item, float):
            raise model_invalid()


def compact(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def dump(value: BaseModel) -> JsonDict:
    return cast(JsonDict, to_json(value))


def canonical_block(raw: object) -> JsonDict:
    """Kernel serde round trip of one authored block (strict subset)."""
    guard_raw(raw)
    try:
        return cast(JsonDict, to_json(BLOCK_ADAPTER.validate_python(raw)))
    except ValidationError as error:
        raise model_invalid() from error


def canonical_inlines(raw: object) -> list[JsonDict]:
    guard_raw(raw)
    try:
        return cast(list[JsonDict], to_json(INLINES_ADAPTER.validate_python(raw)))
    except ValidationError as error:
        raise model_invalid() from error


def canonical_para_props(raw: object) -> JsonDict:
    guard_raw(raw)
    try:
        return dump(PARA_PROPS_ADAPTER.validate_python(raw))
    except ValidationError as error:
        raise model_invalid() from error


# ---------- traversal ----------


@dataclass(frozen=True)
class BlockRef:
    """One block in body order with its nesting context."""

    block: JsonDict
    depth: int
    top_index: int
    section_index: int
    top_level: bool


def child_block_lists(block: JsonDict) -> Iterator[list[JsonDict]]:
    kind = block.get("type")
    if kind in {"quote", "container"}:
        yield cast(list[JsonDict], block["blocks"])
    elif kind == "list":
        for item in cast(list[JsonDict], block["items"]):
            yield cast(list[JsonDict], item["blocks"])
    elif kind == "table":
        for row in cast(list[JsonDict], block["rows"]):
            for cell in cast(list[JsonDict], row["cells"]):
                yield cast(list[JsonDict], cell["blocks"])


def walk_blocks(model: JsonDict) -> Iterator[BlockRef]:
    """Body blocks in document order (headers/footers excluded), depth-first."""
    top = 0
    for section_index, section in enumerate(cast(list[JsonDict], model["sections"])):
        for block in cast(list[JsonDict], section["blocks"]):
            stack: list[tuple[JsonDict, int]] = [(block, 0)]
            while stack:
                current, depth = stack.pop()
                yield BlockRef(current, depth, top, section_index, depth == 0)
                nested = [
                    (child, depth + 1) for blocks in child_block_lists(current) for child in blocks
                ]
                stack.extend(reversed(nested))
            top += 1


def top_blocks(model: JsonDict) -> list[JsonDict]:
    return [
        block
        for section in cast(list[JsonDict], model["sections"])
        for block in cast(list[JsonDict], section["blocks"])
    ]


def _all_block_lists(model: JsonDict) -> Iterator[list[JsonDict]]:
    for section in cast(list[JsonDict], model["sections"]):
        yield cast(list[JsonDict], section["blocks"])
        for key in ("header", "footer"):
            part = section.get(key)
            if isinstance(part, dict):
                for variant in ("blocks", "firstPage", "evenPage"):
                    blocks = part.get(variant)
                    if isinstance(blocks, list):
                        yield cast(list[JsonDict], blocks)


def all_node_ids(model: JsonDict) -> Iterator[tuple[str, str, JsonDict]]:
    """Every addressable (id, kind, node): document, sections, blocks, items, rows, cells."""
    yield cast(str, model["id"]), "document", model
    for section in cast(list[JsonDict], model["sections"]):
        yield cast(str, section["id"]), "section", section
    for blocks in _all_block_lists(model):
        yield from _block_nodes(blocks)


def _block_nodes(blocks: list[JsonDict]) -> Iterator[tuple[str, str, JsonDict]]:
    stack = list(reversed(blocks))
    while stack:
        block = stack.pop()
        yield cast(str, block["id"]), "block", block
        if block.get("type") == "list":
            for item in cast(list[JsonDict], block["items"]):
                yield cast(str, item["id"]), "item", item
        elif block.get("type") == "table":
            for row in cast(list[JsonDict], block["rows"]):
                yield cast(str, row["id"]), "row", row
                for cell in cast(list[JsonDict], row["cells"]):
                    yield cast(str, cell["id"]), "cell", cell
        nested = [child for blocks_ in child_block_lists(block) for child in blocks_]
        stack.extend(reversed(nested))


def find_body_node(model: JsonDict, node_id: str) -> tuple[str, JsonDict] | None:
    """A body (section) block, list item, table row or cell; headers/footers excluded."""
    for section in cast(list[JsonDict], model["sections"]):
        for found_id, kind, node in _block_nodes(cast(list[JsonDict], section["blocks"])):
            if found_id == node_id:
                return kind, node
    return None


def find_block(model: JsonDict, node_id: str) -> JsonDict | None:
    for blocks in _all_block_lists(model):
        stack = list(blocks)
        while stack:
            block = stack.pop()
            if block.get("id") == node_id:
                return block
            for nested in child_block_lists(block):
                stack.extend(nested)
    return None


def block_depth(blocks: list[JsonDict]) -> int:
    """Nesting depth like the editor: top blocks are 1, inline lists one deeper."""
    deepest = 0
    stack = [(block, 1) for block in blocks]
    while stack:
        block, depth = stack.pop()
        inline = block.get("type") in {"paragraph", "heading"} or "caption" in block
        deepest = max(deepest, depth + 1 if inline else depth)
        for nested in child_block_lists(block):
            stack.extend((child, depth + 1) for child in nested)
    return deepest


# ---------- text projections ----------


def atom_text(inlines: list[JsonDict]) -> str:
    """Unicode scalar projection: run text as is, every other inline one atom."""
    parts: list[str] = []
    for inline in inlines:
        kind = inline.get("type")
        if kind == "run":
            parts.append(cast(str, inline["text"]))
        elif kind == "break":
            parts.append("\n")
        elif kind == "tab":
            parts.append("\t")
        else:
            parts.append(OBJECT_ATOM)
    return "".join(parts)


def inline_plain_text(inlines: list[JsonDict]) -> str:
    """Kernel ``Inline::plain_text``: break → newline, tab → tab, image → alt."""
    parts: list[str] = []
    for inline in inlines:
        kind = inline.get("type")
        if kind == "run":
            parts.append(cast(str, inline["text"]))
        elif kind == "break":
            parts.append("\n")
        elif kind == "tab":
            parts.append("\t")
        elif kind == "image":
            alt = inline.get("alt")
            parts.append(alt if isinstance(alt, str) else "")
    return "".join(parts)


def block_plain_text(block: JsonDict) -> str:
    """Kernel ``Block::plain_text``."""
    kind = block.get("type")
    if kind in {"paragraph", "heading"}:
        return inline_plain_text(cast(list[JsonDict], block["inlines"]))
    if kind == "code_block":
        return cast(str, block["text"])
    if kind == "list":
        return "\n".join(
            "\n".join(block_plain_text(child) for child in cast(list[JsonDict], item["blocks"]))
            for item in cast(list[JsonDict], block["items"])
        )
    if kind == "table":
        return "\n".join(
            "\t".join(
                " ".join(block_plain_text(child) for child in cast(list[JsonDict], cell["blocks"]))
                for cell in cast(list[JsonDict], row["cells"])
            )
            for row in cast(list[JsonDict], block["rows"])
        )
    if kind == "image":
        alt = block.get("alt")
        return alt if isinstance(alt, str) else ""
    if kind in {"quote", "container"}:
        return "\n".join(block_plain_text(child) for child in cast(list[JsonDict], block["blocks"]))
    return ""


def run_text(inlines: list[JsonDict]) -> str:
    return "".join(cast(str, item["text"]) for item in inlines if item.get("type") == "run")


def count_words(block: JsonDict) -> int:
    """Non-whitespace scalars of paragraphs/code (recursing lists, quotes, containers)."""
    kind = block.get("type")
    if kind == "paragraph":
        text = run_text(cast(list[JsonDict], block["inlines"]))
    elif kind == "code_block":
        text = cast(str, block["text"])
    elif kind == "list":
        return sum(
            count_words(child)
            for item in cast(list[JsonDict], block["items"])
            for child in cast(list[JsonDict], item["blocks"])
        )
    elif kind in {"quote", "container"}:
        return sum(count_words(child) for child in cast(list[JsonDict], block["blocks"]))
    else:
        return 0
    return len(text) - len(WHITESPACE.findall(text))


def derive_chapters(model: JsonDict) -> list[JsonDict]:
    """Top-level headings of all sections; id = heading block id (editor rule)."""
    top = top_blocks(model)
    rows: list[JsonDict] = [
        {
            "id": cast(str, block["id"]),
            "level": cast(int, block["level"]),
            "title": run_text(cast(list[JsonDict], block["inlines"])),
            "block": index,
            "end": len(top),
            "words": 0,
        }
        for index, block in enumerate(top)
        if block.get("type") == "heading"
    ]
    references = next(
        (
            cast(int, row["block"])
            for row in rows
            if REFERENCES_TITLE.match(cast(str, row["title"]))
        ),
        len(top),
    )
    for position, row in enumerate(rows):
        row["end"] = next(
            (
                cast(int, after["block"])
                for after in rows[position + 1 :]
                if cast(int, after["level"]) <= cast(int, row["level"])
            ),
            len(top),
        )
        start = cast(int, row["block"])
        stop = min(cast(int, row["end"]), max(start, references))
        row["words"] = sum(count_words(top[index]) for index in range(start + 1, stop))
    return rows


def resource_uri(sha256: str) -> str:
    return RESOURCE_URI_PREFIX + sha256


def resource_hashes(model: JsonDict) -> set[str]:
    return {
        cast(str, cast(JsonDict, item["data"])["value"])[len(RESOURCE_URI_PREFIX) :]
        for item in cast(list[JsonDict], model.get("resources", []))
    }


# ---------- semantic validation ----------


def _image_resources(model: JsonDict) -> Iterator[str]:
    for blocks in _all_block_lists(model):
        stack = list(blocks)
        while stack:
            block = stack.pop()
            if block.get("type") == "image":
                yield cast(str, block["resource"])
            inline_lists: list[list[JsonDict]] = []
            if block.get("type") in {"paragraph", "heading"}:
                inline_lists.append(cast(list[JsonDict], block["inlines"]))
            caption = block.get("caption")
            if isinstance(caption, list):
                inline_lists.append(cast(list[JsonDict], caption))
            for inlines in inline_lists:
                for inline in inlines:
                    if inline.get("type") == "image":
                        yield cast(str, inline["resource"])
            for nested in child_block_lists(block):
                stack.extend(nested)


def _validate_tables(model: JsonDict) -> None:
    for blocks in _all_block_lists(model):
        stack = list(blocks)
        while stack:
            block = stack.pop()
            if block.get("type") == "table":
                rows = cast(list[JsonDict], block["rows"])
                if (
                    not rows
                    or len(rows)
                    * max(
                        1,
                        sum(
                            cast(int, c.get("colSpan", 1))
                            for c in cast(list[JsonDict], rows[0]["cells"])
                        ),
                    )
                    > MAX_NODES
                ):
                    raise model_invalid()
                for row in rows:
                    for cell in cast(list[JsonDict], row["cells"]):
                        if not cast(list[JsonDict], cell["blocks"]):
                            raise model_invalid()
            for nested in child_block_lists(block):
                stack.extend(nested)


def validate_model(raw: object) -> JsonDict:
    """Strict subset + ThesisPilot limits; returns the kernel-canonical JSON."""
    guard_raw(raw)
    try:
        model = DocsModel.model_validate(raw)
    except ValidationError as error:
        raise model_invalid() from error
    result = dump(model)
    ids: set[str] = set()
    count = 0
    for node_id, kind, _ in all_node_ids(result):
        count += kind not in {"document", "section"}
        if node_id in ids:
            raise model_invalid("正文模型节点 ID 重复，当前稿保持不变。")
        ids.add(node_id)
    if count > MAX_NODES:
        raise model_too_large()
    for blocks in _all_block_lists(result):
        if block_depth(blocks) > MAX_DEPTH:
            raise model_too_large()
    _validate_tables(result)
    resource_ids = [
        cast(str, item["id"]) for item in cast(list[JsonDict], result.get("resources", []))
    ]
    if len(set(resource_ids)) != len(resource_ids):
        raise model_invalid()
    for item in cast(list[JsonDict], result.get("resources", [])):
        digest = item.get("sha256")
        uri = cast(str, cast(JsonDict, item["data"])["value"])
        if digest is not None and uri != resource_uri(cast(str, digest)):
            raise model_invalid()
    if any(reference not in resource_ids for reference in _image_resources(result)):
        raise model_invalid("正文引用了不存在的图片资源，当前稿保持不变。")
    if len(compact(result).encode("utf-8")) > MAX_CONTENT_BYTES:
        raise model_too_large()
    return result


def protection_invalid() -> AppError:
    return AppError(
        "DOCMODEL_PROTECTION_INVALID", "保护区间与正文节点不一致，当前稿保持不变。", 422
    )


def node_plain_text(kind: str, node: JsonDict) -> str:
    if kind == "block":
        return block_plain_text(node)
    if kind == "item":
        return "\n".join(block_plain_text(child) for child in cast(list[JsonDict], node["blocks"]))
    if kind == "cell":
        return " ".join(block_plain_text(child) for child in cast(list[JsonDict], node["blocks"]))
    return "\t".join(node_plain_text("cell", cell) for cell in cast(list[JsonDict], node["cells"]))


def protected_text(model: JsonDict, protection: JsonDict) -> tuple[str, JsonDict]:
    """Protected scalar text and its node. Ranges live in a body paragraph/heading; a
    whole-node protection may target any body block, list item, table row or cell."""
    anchor = cast(JsonDict, protection["anchor"])
    found = find_body_node(model, cast(str, anchor["node"]))
    if found is None:
        raise protection_invalid()
    kind, node = found
    start, end = anchor.get("start"), anchor.get("end")
    if start is None and end is None:
        return node_plain_text(kind, node), node
    if (
        start is None
        or end is None
        or kind != "block"
        or node.get("type") not in {"paragraph", "heading"}
        or not isinstance(start, int)
        or not isinstance(end, int)
    ):
        raise protection_invalid()
    text = atom_text(cast(list[JsonDict], node["inlines"]))
    if not 0 <= start < end <= len(text):
        raise protection_invalid()
    return text[start:end], node


def validate_protections(model: JsonDict, protections: list[JsonDict]) -> None:
    ids: set[str] = set()
    for protection in protections:
        protection_id = cast(str, protection["id"])
        if protection_id in ids:
            raise protection_invalid()
        ids.add(protection_id)
        protected_text(model, protection)


def validate_snapshot(raw: object) -> JsonDict:
    """Canonical v2 snapshot. Input chapters are shape-checked only and recomputed."""
    if (
        not isinstance(raw, dict)
        or set(raw) - {"schemaVersion", "model", "protections", "chapters"}
        or type(raw.get("schemaVersion")) is not int
        or raw.get("schemaVersion") != 2
    ):
        raise model_invalid()
    guard_raw(raw.get("protections", []))
    guard_raw(raw.get("chapters", []))
    try:
        supplied = PROTECTIONS_ADAPTER.validate_python(raw.get("protections", []))
        if raw.get("chapters") is not None:
            CHAPTERS_ADAPTER.validate_python(raw["chapters"])
    except ValidationError as error:
        raise model_invalid() from error
    model = validate_model(raw.get("model"))
    protections = [dump(item) for item in supplied]
    validate_protections(model, protections)
    snapshot: JsonDict = {
        "schemaVersion": SNAPSHOT_SCHEMA_VERSION,
        "model": model,
        "protections": cast(list[JsonValue], protections),
        "chapters": cast(list[JsonValue], derive_chapters(model)),
    }
    if len(compact(snapshot).encode("utf-8")) > MAX_CONTENT_BYTES:
        raise model_too_large()
    return snapshot


def protections_of(snapshot: JsonDict | None) -> list[JsonDict]:
    return [] if snapshot is None else cast(list[JsonDict], snapshot.get("protections", []))


def model_of(snapshot: JsonDict) -> JsonDict:
    return cast(JsonDict, snapshot["model"])


def protection_violated() -> AppError:
    return AppError("DOCMODEL_PROTECTION_VIOLATED", "受保护内容被修改或删除，当前稿保持不变。", 409)


def protection_forged() -> AppError:
    return AppError("DOCMODEL_PROTECTION_FORGED", "保存不能新增或改写系统保护标记。", 422)


def _identity(protection: JsonDict) -> tuple[object, ...]:
    anchor = cast(JsonDict, protection["anchor"])
    return (
        protection["kind"],
        protection.get("binding"),
        anchor["node"],
        "start" in anchor,
    )


def protection_rule_check(base: JsonDict | None, new: JsonDict, *, user_edit: bool) -> None:
    """Every base protection survives with identical text; object nodes stay identical.

    Only user-owned kinds (``lock``) may be added or removed, and only by a manual edit.
    Whole-node ``object`` protections also freeze the node JSON (formatting included).
    Offsets may move: the anchor is re-read by protection id in the new snapshot.
    """
    new_items = {cast(str, item["id"]): item for item in protections_of(new)}
    base_items = {cast(str, item["id"]): item for item in protections_of(base)}
    for protection_id, item in new_items.items():
        if protection_id not in base_items and not (
            user_edit and item["kind"] in USER_PROTECTION_KINDS
        ):
            raise protection_forged()
    if base is None:
        return
    base_model, new_model = model_of(base), model_of(new)
    for protection_id, old in base_items.items():
        current = new_items.get(protection_id)
        if current is None:
            if user_edit and old["kind"] in USER_PROTECTION_KINDS:
                continue
            raise protection_violated()
        if _identity(current) != _identity(old):
            raise protection_violated()
        old_text, old_block = protected_text(base_model, old)
        try:
            new_text, new_block = protected_text(new_model, current)
        except AppError:
            raise protection_violated() from None
        if new_text != old_text:
            raise protection_violated()
        whole = "start" not in cast(JsonDict, old["anchor"])
        if whole and old["kind"] == "object" and new_block != old_block:
            raise protection_violated()
