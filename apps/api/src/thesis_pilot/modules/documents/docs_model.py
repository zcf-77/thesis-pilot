"""MuffinOffice DocsModel subset (schema v1 of the kernel) and ThesisPilot snapshot v2.

The classes mirror ``crates/office-model`` field names, tags and serde defaults so a
canonical dump equals the kernel's ``serde_json`` serialization (fields skipped when
they equal their serde default). ThesisPilot is stricter than the kernel: unknown
fields are rejected and footnotes, comments, kernel revisions, containers, charts and
embedded resource bytes are outside the supported subset.
"""

from __future__ import annotations

import json
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
MAX_NODES = 110000
MAX_DEPTH = 80
MAX_JSON_DEPTH = 400
MAX_CONTENT_BYTES = 16 * 1024 * 1024
MAX_ID_LENGTH = 200
MAX_PROTECTIONS = 20000
MAX_RESOURCES = 2000
MAX_UNSUPPORTED = 10000
MAX_TITLE_LENGTH = 200
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


class RgbColor(Strict):
    kind: Literal["rgb"]
    value: Annotated[str, Field(pattern=r"^[0-9A-Fa-f]{6}$", strict=True)]


class ThemeColorValue(Strict):
    kind: Literal["theme"]
    value: ThemeColorName


class AutoColor(Strict):
    kind: Literal["auto"]


Color = Annotated[RgbColor | ThemeColorValue | AutoColor, Field(discriminator="kind")]


class ThemeFontRef(Strict):
    kind: Literal["theme"]
    value: Literal["body", "heading", "mono"]


class NamedFontRef(Strict):
    kind: Literal["named"]
    value: Annotated[str, Field(min_length=1, max_length=200, strict=True)]


FontRef = Annotated[ThemeFontRef | NamedFontRef, Field(discriminator="kind")]
Underline = Literal["none", "single", "double", "dotted", "dashed", "wavy"]


class Link(Strict):
    href: Annotated[str, Field(min_length=1, max_length=4096, strict=True)]
    title: ShortText | None = None


class InlineProps(Strict):
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
    link: Link | None = None
    lang: ShortText | None = None
    letter_spacing: Emu | None = None


# ---------- inlines ----------


class AnchorPos(Strict):
    from_: Literal["page", "margin"] = Field(alias="from")
    align: Literal["start", "center", "end"] | None = None
    offset: Emu = 0


class ImageAnchor(Strict):
    x: AnchorPos
    y: AnchorPos
    behind_text: bool = False


class RunInline(Strict):
    type: Literal["run"]
    text: Text
    props: InlineProps = Field(default_factory=InlineProps)


class BreakInline(Strict):
    always = frozenset({"kind"})
    type: Literal["break"]
    kind: Literal["line", "column"] = "line"


class TabInline(Strict):
    type: Literal["tab"]


class ImageInline(Strict):
    type: Literal["image"]
    resource: NodeId
    title: ShortText | None = None
    width: Emu | None = None
    height: Emu | None = None
    alt: ShortText | None = None
    anchor: ImageAnchor | None = None


class FieldInline(Strict):
    type: Literal["field"]
    kind: Literal["page_number", "num_pages", "date", "title", "author"]


class BookmarkInline(Strict):
    type: Literal["bookmark"]
    name: Annotated[str, Field(min_length=1, max_length=200, strict=True)]


Inline = Annotated[
    RunInline | BreakInline | TabInline | ImageInline | FieldInline | BookmarkInline,
    Field(discriminator="type"),
]


# ---------- paragraph props ----------

Align = Literal["start", "center", "end", "justify", "distributed"]


class LineMultiple(Strict):
    kind: Literal["multiple"]
    value: U32


class LineExact(Strict):
    kind: Literal["exact"]
    value: Emu


class LineAtLeast(Strict):
    kind: Literal["at_least"]
    value: Emu


LineSpacing = Annotated[LineMultiple | LineExact | LineAtLeast, Field(discriminator="kind")]


class Spacing(Strict):
    before: Emu | None = None
    after: Emu | None = None
    line: LineSpacing | None = None


class Indent(Strict):
    start: Emu | None = None
    end: Emu | None = None
    first_line: Emu | None = None
    hanging: Emu | None = None
    start_chars: I32 | None = None
    end_chars: I32 | None = None
    first_line_chars: I32 | None = None


class TabStop(Strict):
    pos: Emu
    kind: Literal["start", "center", "end", "decimal", "clear"]
    leader: Literal["none", "dot", "hyphen", "underscore"] | None = None


class Border(Strict):
    style: Literal["none", "single", "double", "dashed", "dotted"]
    width: Emu | None = None
    color: Color | None = None


class Borders(Strict):
    top: Border | None = None
    bottom: Border | None = None
    left: Border | None = None
    right: Border | None = None
    inside_h: Border | None = None
    inside_v: Border | None = None


class ListLabel(Strict):
    always = frozenset({"text"})
    text: ShortText = ""
    suffix: Literal["tab", "space", "nothing"] | None = None
    run: InlineProps = Field(default_factory=InlineProps)
    level: U8 = 0


class ParaProps(Strict):
    style: ShortText | None = None
    align: Align | None = None
    spacing: Spacing = Field(default_factory=Spacing)
    indent: Indent = Field(default_factory=Indent)
    keep_with_next: bool | None = None
    keep_lines: bool | None = None
    widow_control: bool | None = None
    auto_space_de: bool | None = None
    auto_space_dn: bool | None = None
    page_break_before: bool | None = None
    outline_level: U8 | None = None
    shading: Color | None = None
    borders: Borders | None = None
    tabs: Annotated[list[TabStop], Field(max_length=64)] = Field(default_factory=list)
    snap_to_grid: bool | None = None
    kinsoku: bool | None = None
    overflow_punct: bool | None = None
    top_line_punct: bool | None = None
    adjust_right_ind: bool | None = None
    run: InlineProps = Field(default_factory=InlineProps)
    list_label: ListLabel | None = None


# ---------- blocks ----------

Inlines = list[Inline]


class ParagraphBlock(Strict):
    type: Literal["paragraph"]
    id: NodeId
    props: ParaProps = Field(default_factory=ParaProps)
    inlines: Inlines


class HeadingBlock(Strict):
    type: Literal["heading"]
    id: NodeId
    level: Annotated[int, Field(ge=1, le=6, strict=True)]
    props: ParaProps = Field(default_factory=ParaProps)
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


class ListItem(Strict):
    id: NodeId
    checked: bool | None = None
    blocks: list[Block]


class ListBlock(Strict):
    type: Literal["list"]
    id: NodeId
    kind: ListKind
    start: U32 | None = None
    numbering: ShortText | None = None
    items: list[ListItem]


class EmuWidth(Strict):
    kind: Literal["emu"]
    value: Emu


class PctWidth(Strict):
    kind: Literal["pct"]
    value: U32


TableWidth = Annotated[EmuWidth | PctWidth, Field(discriminator="kind")]


class TableContinuation(Strict):
    label: ShortText
    props: ParaProps


class TableProps(Strict):
    continuation: TableContinuation | None = None
    style: ShortText | None = None
    width: TableWidth | None = None
    align: Align | None = None
    borders: Borders | None = None
    header_rows: U32 = 0
    cell_margin: Emu | None = None
    cell_margin_vertical: Emu | None = None
    layout: Literal["fixed", "autofit"] | None = None


class CellProps(Strict):
    width: Emu | None = None
    valign: Literal["top", "center", "bottom"] | None = None
    shading: Color | None = None
    borders: Borders | None = None


Span = Annotated[int, Field(ge=1, le=10000, strict=True)]


class TableCell(Strict):
    id: NodeId
    col_span: Span = 1
    row_span: Span = 1
    props: CellProps = Field(default_factory=CellProps)
    blocks: list[Block]


class TableRow(Strict):
    id: NodeId
    height: Emu | None = None
    header: bool = False
    cant_split: bool | None = None
    keep_with_next: bool | None = None
    cells: list[TableCell]


class TableBlock(Strict):
    type: Literal["table"]
    id: NodeId
    props: TableProps = Field(default_factory=TableProps)
    col_widths: list[Emu] = Field(default_factory=list)
    rows: list[TableRow]
    caption: Inlines | None = None


class ImageBlock(Strict):
    type: Literal["image"]
    id: NodeId
    resource: NodeId
    width: Emu | None = None
    height: Emu | None = None
    alt: ShortText | None = None
    caption: Inlines | None = None
    align: Align | None = None


class CodeBlock(Strict):
    type: Literal["code_block"]
    id: NodeId
    lang: ShortText | None = None
    text: Text


class QuoteBlock(Strict):
    type: Literal["quote"]
    id: NodeId
    blocks: list[Block]


class PageBreakBlock(Strict):
    type: Literal["page_break"]
    id: NodeId


class RuleBlock(Strict):
    type: Literal["rule"]
    id: NodeId


class TocBlock(Strict):
    always = frozenset({"levels"})
    type: Literal["toc"]
    id: NodeId
    levels: U8 = 3
    title: ShortText | None = None


Block = Annotated[
    ParagraphBlock
    | HeadingBlock
    | ListBlock
    | TableBlock
    | ImageBlock
    | CodeBlock
    | QuoteBlock
    | PageBreakBlock
    | RuleBlock
    | TocBlock,
    Field(discriminator="type"),
]


# ---------- document ----------


class PageSize(Strict):
    width: Emu
    height: Emu


class Margins(Strict):
    top: Emu
    bottom: Emu
    left: Emu
    right: Emu
    header: Emu | None = None
    footer: Emu | None = None
    gutter: Emu | None = None


class DocGrid(Strict):
    kind: Literal["lines", "lines_and_chars", "snap_to_chars"]
    line_pitch: Emu
    char_space: I32 | None = None


class PageProps(Strict):
    size: PageSize
    orientation: Literal["portrait", "landscape"]
    margins: Margins
    columns: U8 | None = None
    grid: DocGrid | None = None


class HeaderFooter(Strict):
    always = frozenset({"blocks"})
    blocks: list[Block] = Field(default_factory=list)
    first_page: list[Block] | None = None
    even_page: list[Block] | None = None


class Section(Strict):
    id: NodeId
    break_kind: Literal["next_page", "continuous", "even_page", "odd_page"] | None = None
    page_number_start: Annotated[int, Field(ge=1, le=4294967295, strict=True)] | None = None
    page: PageProps | None = None
    header: HeaderFooter | None = None
    footer: HeaderFooter | None = None
    blocks: list[Block]


class Meta(Strict):
    title: ShortText | None = None
    subtitle: ShortText | None = None
    author: ShortText | None = None
    date: ShortText | None = None
    keywords: Annotated[list[ShortText], Field(max_length=200)] = Field(default_factory=list)
    lang: ShortText | None = None
    custom: Annotated[dict[str, ShortText], Field(max_length=200)] = Field(default_factory=dict)


class ThemeRef(Strict):
    name: Annotated[str, Field(min_length=1, max_length=200, strict=True)]


class UriData(Strict):
    kind: Literal["uri"]
    value: Annotated[str, Field(pattern=r"^tp-resource:[0-9a-f]{64}$", strict=True)]


class Resource(Strict):
    id: NodeId
    mime: Literal["image/png", "image/jpeg", "image/gif", "image/webp"]
    name: ShortText | None = None
    data: UriData
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$", strict=True)] | None = None
    width_px: U32 | None = None
    height_px: U32 | None = None


class Unsupported(Strict):
    kind: Annotated[str, Field(min_length=1, max_length=200, strict=True)]
    path: ShortText
    detail: ShortText | None = None


class DocsModel(Strict):
    kind: Literal["docs"]
    schema_version: Literal[1]
    id: NodeId
    meta: Meta = Field(default_factory=Meta)
    theme: ThemeRef
    sections: Annotated[list[Section], Field(min_length=1, max_length=1000)]
    resources: Annotated[list[Resource], Field(max_length=MAX_RESOURCES)] = Field(
        default_factory=list
    )
    unsupported: Annotated[list[Unsupported], Field(max_length=MAX_UNSUPPORTED)] = Field(
        default_factory=list
    )


# ---------- ThesisPilot snapshot ----------


class ProtectionAnchor(Strict):
    node: NodeId
    start: Annotated[int, Field(ge=0, le=MAX_SAFE_INTEGER, strict=True)] | None = None
    end: Annotated[int, Field(ge=0, le=MAX_SAFE_INTEGER, strict=True)] | None = None


class Protection(Strict):
    id: NodeId
    kind: Literal["number", "citation", "formula", "lock", "object", "source"]
    anchor: ProtectionAnchor
    binding: Annotated[str, Field(min_length=1, max_length=MAX_ID_LENGTH, strict=True)] | None = (
        None
    )
    protect_formatting: bool = False


class Chapter(Strict):
    id: NodeId
    level: Annotated[int, Field(ge=1, le=6, strict=True)]
    title: Annotated[str, Field(max_length=MAX_TITLE_LENGTH, strict=True)]


for _recursive in (
    ListItem,
    ListBlock,
    TableCell,
    TableRow,
    TableBlock,
    QuoteBlock,
    HeaderFooter,
    Section,
    DocsModel,
):
    _recursive.model_rebuild()


class DocsSnapshot(Strict):
    """Stored in ``document_versions.content_json`` when ``schema_version`` is 2."""

    model: DocsModel
    protections: Annotated[list[Protection], Field(max_length=MAX_PROTECTIONS)] = Field(
        default_factory=list
    )
    # Derived; an input may omit it, a stored/response snapshot always carries it.
    chapters: list[Chapter] | None = None


BLOCK_ADAPTER: TypeAdapter[Any] = TypeAdapter(Block)
INLINES_ADAPTER: TypeAdapter[list[Any]] = TypeAdapter(list[Inline])
PARA_PROPS_ADAPTER: TypeAdapter[ParaProps] = TypeAdapter(ParaProps)
PROTECTIONS_ADAPTER: TypeAdapter[list[Protection]] = TypeAdapter(
    Annotated[list[Protection], Field(max_length=MAX_PROTECTIONS)]
)
CHAPTERS_ADAPTER: TypeAdapter[list[Chapter]] = TypeAdapter(list[Chapter])


# ---------- raw guards ----------


def _well_formed(value: str) -> bool:
    return not any(0xD800 <= ord(char) <= 0xDFFF for char in value)


def guard_raw(value: object, *, max_nodes: int = MAX_NODES) -> None:
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


def all_node_ids(model: JsonDict) -> Iterator[tuple[str, JsonDict | None]]:
    """Every addressable id: document, sections, blocks, list items, rows, cells."""
    yield cast(str, model["id"]), None
    for section in cast(list[JsonDict], model["sections"]):
        yield cast(str, section["id"]), None
    for blocks in _all_block_lists(model):
        stack = list(blocks)
        while stack:
            block = stack.pop()
            yield cast(str, block["id"]), block
            if block.get("type") == "list":
                for item in cast(list[JsonDict], block["items"]):
                    yield cast(str, item["id"]), None
            elif block.get("type") == "table":
                for row in cast(list[JsonDict], block["rows"]):
                    yield cast(str, row["id"]), None
                    for cell in cast(list[JsonDict], row["cells"]):
                        yield cast(str, cell["id"]), None
            for nested in child_block_lists(block):
                stack.extend(nested)


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
    deepest = 0
    stack = [(block, 1) for block in blocks]
    while stack:
        block, depth = stack.pop()
        deepest = max(deepest, depth)
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


def derive_chapters(model: JsonDict) -> list[JsonDict]:
    """Chapters are the top-level headings of every section; id = heading block id."""
    return [
        {
            "id": cast(str, block["id"]),
            "level": cast(int, block["level"]),
            "title": inline_plain_text(cast(list[JsonDict], block["inlines"])).strip()[
                :MAX_TITLE_LENGTH
            ],
        }
        for block in top_blocks(model)
        if block.get("type") == "heading"
    ]


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
    for node_id, _ in all_node_ids(result):
        count += 1
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


def protected_text(model: JsonDict, protection: JsonDict) -> tuple[str, JsonDict]:
    """Exact protected scalar text plus the block it lives in (block JSON for whole blocks)."""
    anchor = cast(JsonDict, protection["anchor"])
    block = find_block(model, cast(str, anchor["node"]))
    if block is None:
        raise protection_invalid()
    start, end = anchor.get("start"), anchor.get("end")
    if start is None and end is None:
        return block_plain_text(block), block
    if (
        start is None
        or end is None
        or block.get("type") not in {"paragraph", "heading"}
        or not isinstance(start, int)
        or not isinstance(end, int)
    ):
        raise protection_invalid()
    text = atom_text(cast(list[JsonDict], block["inlines"]))
    if not 0 <= start < end <= len(text):
        raise protection_invalid()
    return text[start:end], block


def range_props(block: JsonDict, start: int, end: int) -> list[JsonValue]:
    """Per-atom formatting fingerprint of a scalar range."""
    result: list[JsonValue] = []
    for inline in cast(list[JsonDict], block["inlines"]):
        if inline.get("type") == "run":
            props = inline.get("props", {})
            result.extend(props for _ in cast(str, inline["text"]))
        else:
            result.append(inline)
    return result[start:end]


def validate_protections(model: JsonDict, protections: list[JsonDict]) -> None:
    ids: set[str] = set()
    for protection in protections:
        protection_id = cast(str, protection["id"])
        if protection_id in ids:
            raise protection_invalid()
        ids.add(protection_id)
        protected_text(model, protection)


def chapters_mismatch() -> AppError:
    return AppError("DOCMODEL_CHAPTERS_MISMATCH", "章节目录与标题块不一致，请重新读取正文。", 422)


def validate_snapshot(raw: object) -> JsonDict:
    """Canonical v2 snapshot; supplied chapters must equal the derived outline."""
    if not isinstance(raw, dict) or set(raw) - {"model", "protections", "chapters"}:
        raise model_invalid()
    guard_raw(raw.get("protections", []))
    guard_raw(raw.get("chapters", []))
    try:
        supplied = PROTECTIONS_ADAPTER.validate_python(raw.get("protections", []))
        claimed = (
            None
            if raw.get("chapters") is None
            else CHAPTERS_ADAPTER.validate_python(raw["chapters"])
        )
    except ValidationError as error:
        raise model_invalid() from error
    model = validate_model(raw.get("model"))
    protections = [dump(item) for item in supplied]
    validate_protections(model, protections)
    chapters = derive_chapters(model)
    if claimed is not None and [dump(item) for item in claimed] != chapters:
        raise chapters_mismatch()
    snapshot: JsonDict = {
        "model": model,
        "protections": cast(list[JsonValue], protections),
        "chapters": cast(list[JsonValue], chapters),
    }
    if len(compact(snapshot).encode("utf-8")) > MAX_CONTENT_BYTES:
        raise model_too_large()
    return snapshot


def protections_of(snapshot: JsonDict) -> list[JsonDict]:
    return cast(list[JsonDict], snapshot.get("protections", []))


def model_of(snapshot: JsonDict) -> JsonDict:
    return cast(JsonDict, snapshot["model"])
