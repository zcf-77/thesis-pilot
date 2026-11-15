"""Bounded OOXML projection extracted from this repository's SG-02 core.

Source: scripts/docx_roundtrip.py, import-only deterministic core. No CLI, paths,
exports or repository-root imports are used by the installed API package.
"""

import re
from collections import Counter
from dataclasses import dataclass, field
from xml.dom import Node, minidom
from xml.parsers import expat
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

from thesis_pilot.modules.documents.structure import JsonObject

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
OFFICE_DOCUMENT = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
)
XML = "http://www.w3.org/XML/1998/namespace"
MAIN = "word/document.xml"
MAIN_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
MAX_EXPANDED = 64 * 1024 * 1024
MAX_XML = 8 * 1024 * 1024
START_TAG = re.compile(rb"""<(?:"[^"]*"|'[^']*'|[^>"'])*>""")
CITATION = re.compile(
    r"\[[^\]\r\n]+\]|【[^】\r\n]+】|[（(][^）)\r\n]*[,，]\s*\d{4}[a-z]?[）)]", re.IGNORECASE
)
CITATION_FIELD = re.compile(r"\b(?:CITATION|BIBLIOGRAPHY|ADDIN)\b", re.IGNORECASE)
FORMULA = re.compile(r"\$|\\(?:frac|sum|int|sqrt)|[=＝∑∫√]")
NUMBER = re.compile(r"[-+−]?\d+(?:[.,]\d+)*(?:[eE][-+−]?\d+)?(?:\s*[%％])?")
LABELS = {
    "formula": "公式",
    "citation": "引用",
    "image": "图片",
    "field": "域",
    "complex_table": "复杂表格",
    "unsupported": "复杂结构",
}
NodePath = tuple[int, ...]


class RoundtripError(Exception):
    pass


class ProjectionLimitError(RoundtripError):
    pass


def xml_document(
    data: bytes, *, main: bool = False
) -> tuple[minidom.Document, list[tuple[int, int]]]:
    if len(data) > MAX_XML:
        raise ProjectionLimitError("XML 部件超出解析大小上限。")
    parser = expat.ParserCreate(namespace_separator=" ")
    spans: list[tuple[int, int]] = []
    active: list[tuple[int, int, int | None]] = []
    depth = 0
    node_count = 0

    def forbid_doctype(*_args: object) -> None:
        raise RoundtripError("不支持含 DTD 的 XML。")

    def xml_declaration(version: str, encoding: str | None, _standalone: int) -> None:
        if main and (version != "1.0" or encoding and encoding.lower() != "utf-8"):
            raise RoundtripError("主文档须采用 UTF-8 XML 1.0。")

    def start(name: str, _attrs: dict[str, str]) -> None:
        nonlocal depth, node_count
        depth += 1
        node_count += 1
        if node_count > 100000:
            raise ProjectionLimitError("XML 节点数量超过安全上限。")
        if depth > 100:
            raise RoundtripError("XML 嵌套超出小样深度上限。")
        if main and name == f"{W} t":
            offset = parser.CurrentByteIndex
            tag = START_TAG.match(data, offset)
            if tag is None:
                raise RoundtripError("无法定位正文文本节点。")
            active.append(
                (
                    len(spans),
                    offset,
                    tag.end() if data[tag.end() - 2 : tag.end()] == b"/>" else None,
                )
            )
            spans.append((offset, offset))

    def end(name: str) -> None:
        nonlocal depth
        depth -= 1
        if main and name == f"{W} t":
            index, offset, stop = active.pop()
            if stop is None:
                stop = data.index(b">", parser.CurrentByteIndex) + 1
            spans[index] = (offset, stop)

    parser.StartDoctypeDeclHandler = forbid_doctype
    parser.XmlDeclHandler = xml_declaration
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    try:
        if main:
            data.decode("utf-8-sig")
        parser.Parse(data, True)
        return minidom.parseString(data), spans
    except (LookupError, UnicodeError, expat.ExpatError, ValueError) as exc:
        raise RoundtripError("DOCX XML 格式无效。") from exc


def elements(node: minidom.Element) -> list[minidom.Element]:
    return [child for child in node.childNodes if child.nodeType == Node.ELEMENT_NODE]


def word(node: minidom.Element, name: str) -> bool:
    return (node.namespaceURI, node.localName) == (W, name)


def children(node: minidom.Element, name: str) -> list[minidom.Element]:
    return [child for child in elements(node) if word(child, name)]


def child(node: minidom.Element, name: str) -> minidom.Element | None:
    matches = children(node, name)
    return matches[0] if matches else None


def value(node: minidom.Element | None) -> str:
    return node.getAttributeNS(W, "val") if node is not None else ""


def only(node: minidom.Element, *allowed: str) -> bool:
    return all(
        part.namespaceURI == W and part.localName in allowed for part in elements(node)
    ) and all(
        part.nodeType not in (Node.TEXT_NODE, Node.CDATA_SECTION_NODE) or not part.data.strip()
        for part in node.childNodes
    )


def text_of(node: minidom.Element) -> str:
    return "".join(
        part.data
        for part in node.childNodes
        if part.nodeType in (Node.TEXT_NODE, Node.CDATA_SECTION_NODE)
    )


def check_package(archive: ZipFile) -> None:
    parts = archive.infolist()
    if len(parts) > 4096 or sum(part.file_size for part in parts) > MAX_EXPANDED:
        raise ProjectionLimitError("DOCX 部件数量或解压大小超出解析上限。")
    names: set[str] = set()
    for part in parts:
        name = part.filename.casefold()
        if (
            part.orig_filename != part.filename
            or name.rstrip("/") in names
            or "\\" in part.filename
            or any(fragment in ("", ".", "..") for fragment in name.rstrip("/").split("/"))
            or part.flag_bits & 1
            or part.compress_type not in (ZIP_STORED, ZIP_DEFLATED)
        ):
            raise RoundtripError("DOCX 部件路径、加密或压缩方式不受支持。")
        names.add(name.rstrip("/"))
        if name.startswith("_xmlsignatures/") or "vbaproject" in name or "vbadata" in name:
            raise RoundtripError("不支持带宏或数字签名的 DOCX。")
        if name.endswith((".xml", ".rels")):
            if part.file_size > MAX_XML:
                raise ProjectionLimitError("XML 部件超出解析大小上限。")
            xml_document(archive.read(part))

    types, _ = xml_document(archive.read("[Content_Types].xml"))
    root = types.documentElement
    if root is None or (root.namespaceURI, root.localName) != (CT, "Types"):
        raise RoundtripError("DOCX 内容类型清单无效。")
    main_types = []
    for declaration in elements(root):
        content_type = declaration.getAttribute("ContentType")
        if any(
            flag in content_type.lower() for flag in ("macroenabled", "vba", "digital-signature")
        ):
            raise RoundtripError("不支持带宏或数字签名的 DOCX。")
        if (declaration.namespaceURI, declaration.localName) == (
            CT,
            "Override",
        ) and declaration.getAttribute("PartName") == f"/{MAIN}":
            main_types.append(content_type)
    rels, _ = xml_document(archive.read("_rels/.rels"))
    root = rels.documentElement
    if root is None:
        raise RoundtripError("DOCX 关系部件缺少根元素。")
    main_links = [
        link
        for link in elements(root)
        if (link.namespaceURI, link.localName) == (REL, "Relationship")
        and link.getAttribute("Type") == OFFICE_DOCUMENT
    ]
    if (
        (root.namespaceURI, root.localName) != (REL, "Relationships")
        or main_types != [MAIN_TYPE]
        or len(main_links) != 1
        or main_links[0].getAttribute("Target") not in (MAIN, f"/{MAIN}")
        or main_links[0].getAttribute("TargetMode") not in ("", "Internal")
    ):
        raise RoundtripError("DOCX 主文档类型或关系不受支持。")
    if archive.testzip() is not None:
        raise RoundtripError("DOCX 部件完整性校验失败。")


@dataclass(frozen=True)
class Style:
    based_on: str
    outline: str
    name: str
    numbered: bool


def get_styles(archive: ZipFile) -> tuple[dict[str, Style], str]:
    if "word/styles.xml" not in archive.namelist():
        return {}, ""
    document, _ = xml_document(archive.read("word/styles.xml"))
    root = document.documentElement
    if root is None or not word(root, "styles"):
        raise RoundtripError("DOCX 段落样式部件无效。")
    default = ""
    styles = {}
    for node in children(root, "style"):
        if node.getAttributeNS(W, "type") != "paragraph":
            continue
        style_id = node.getAttributeNS(W, "styleId")
        if not style_id or style_id in styles:
            raise RoundtripError("DOCX 段落样式标识缺失或重复。")
        properties = child(node, "pPr")
        styles[style_id] = Style(
            value(child(node, "basedOn")),
            value(child(properties, "outlineLvl")) if properties is not None else "",
            value(child(node, "name")),
            properties is not None and child(properties, "numPr") is not None,
        )
        if node.getAttributeNS(W, "default") in ("1", "true", "on"):
            default = style_id
    return styles, default


def local_heading(name: str) -> str:
    if name.casefold() == "title":
        return "0"
    match = re.fullmatch(r"heading\s*([1-9])", name, re.IGNORECASE)
    return str(int(match[1]) - 1) if match else ""


def paragraph_style(
    properties: minidom.Element | None, styles: dict[str, Style], default: str
) -> tuple[int | None, bool]:
    outline = value(child(properties, "outlineLvl")) if properties is not None else ""
    style_id = value(child(properties, "pStyle")) if properties is not None else ""
    style_id = style_id or default
    fallback = local_heading(style_id)
    numbered = properties is not None and child(properties, "numPr") is not None
    visited: set[str] = set()
    while style_id in styles:
        if style_id in visited:
            raise RoundtripError("DOCX 段落样式循环继承。")
        visited.add(style_id)
        style = styles[style_id]
        outline = outline or style.outline
        fallback = fallback or local_heading(style.name) or local_heading(style.based_on)
        numbered = numbered or style.numbered
        style_id = style.based_on
    outline = outline or fallback
    if outline in ("", "9"):
        return None, numbered
    if outline in {"0", "1", "2", "3", "4", "5"}:
        return int(outline) + 1, numbered
    return None, True


def field_paragraphs(root: minidom.Element) -> dict[minidom.Element, set[str]]:
    """复杂域可以跨段，结果中的普通文本也属于域。"""
    protected: dict[minidom.Element, set[str]] = {}
    active: list[tuple[set[minidom.Element], list[str]]] = []

    def visit(node: minidom.Element, paragraph: minidom.Element | None = None) -> None:
        if word(node, "p"):
            paragraph = node
        if paragraph is not None:
            for paragraphs, _ in active:
                paragraphs.add(paragraph)
            if word(node, "fldChar"):
                kind = node.getAttributeNS(W, "fldCharType")
                if kind == "begin":
                    if len(active) == 100:
                        raise RoundtripError("DOCX 复杂域嵌套超出小样深度上限。")
                    active.append(({paragraph}, []))
                elif kind == "end" and active:
                    paragraphs, instructions = active.pop()
                    category = (
                        "citation" if CITATION_FIELD.search("".join(instructions)) else "field"
                    )
                    for item in paragraphs:
                        protected.setdefault(item, set()).add(category)
                elif kind != "separate" or not active:
                    raise RoundtripError("DOCX 复杂域边界无效。")
            elif word(node, "instrText") and active:
                active[-1][1].append(text_of(node))
        for item in elements(node):
            visit(item, paragraph)

    visit(root)
    if active:
        raise RoundtripError("DOCX 复杂域边界无效。")
    return protected


def object_kinds(node: minidom.Element, field_kinds: set[str]) -> set[str]:
    kinds = set(field_kinds)
    for part in [node, *node.getElementsByTagName("*")]:
        if part.namespaceURI == M and part.localName in ("oMath", "oMathPara"):
            kinds.add("formula")
        if part.namespaceURI != W:
            continue
        if part.localName in ("drawing", "pict", "object"):
            kinds.add("image")
        elif part.localName in ("footnoteReference", "endnoteReference"):
            kinds.add("citation")
        elif part.localName == "fldSimple":
            kinds.add(
                "citation" if CITATION_FIELD.search(part.getAttributeNS(W, "instr")) else "field"
            )
        elif part.localName in ("instrText", "fldChar") and not field_kinds:
            kinds.add("field")
    plain = "".join(text_of(part) for part in node.getElementsByTagNameNS(W, "t"))
    if CITATION.search(plain):
        kinds.add("citation")
    if FORMULA.search(plain):
        kinds.add("formula")
    return kinds


def text_target(node: minidom.Element) -> minidom.Element | None:
    runs = children(node, "r")
    if len(runs) != 1 or len(children(node, "pPr")) > 1 or not only(node, "pPr", "r"):
        return None
    run = runs[0]
    texts = children(run, "t")
    if len(texts) != 1 or len(children(run, "rPr")) > 1 or not only(run, "rPr", "t"):
        return None
    target = texts[0]
    if any(part.nodeType != Node.TEXT_NODE for part in target.childNodes):
        return None
    for part in node.getElementsByTagNameNS(W, "*"):
        if part.localName in (
            "pPrChange",
            "rPrChange",
            "vertAlign",
            "vanish",
            "webHidden",
            "specVanish",
        ):
            return None
    return target


def node_json(
    kind: str, content: list[JsonObject] | None = None, attrs: JsonObject | None = None
) -> JsonObject:
    node: JsonObject = {"type": kind}
    if attrs:
        node["attrs"] = attrs
    if content:
        node["content"] = [item for item in content]
    return node


def text_json(text: str) -> list[JsonObject]:
    return [{"type": "text", "text": text}] if text else []


def table_rows(table: minidom.Element) -> list[list[minidom.Element]]:
    if not only(table, "tblPr", "tblGrid", "tr"):
        return []
    rows = children(table, "tr")
    if not rows:
        return []
    matrix = [children(row, "tc") for row in rows]
    width = len(matrix[0])
    grid = child(table, "tblGrid")
    if not width or (
        grid is not None and (not only(grid, "gridCol") or len(elements(grid)) != width)
    ):
        return []
    for row, cells in zip(rows, matrix, strict=True):
        properties = child(row, "trPr")
        if len(cells) != width or not only(row, "trPr", "tblPrEx", "tc"):
            return []
        if properties is not None and any(
            child(properties, name) is not None
            for name in ("gridBefore", "gridAfter", "ins", "del", "trPrChange")
        ):
            return []
        for cell in cells:
            properties = child(cell, "tcPr")
            if not children(cell, "p") or not only(cell, "tcPr", "p"):
                return []
            if properties is not None and any(
                child(properties, name) is not None
                for name in (
                    "gridSpan",
                    "hMerge",
                    "vMerge",
                    "cellIns",
                    "cellDel",
                    "cellMerge",
                    "tcPrChange",
                )
            ):
                return []
    return matrix


@dataclass
class Projection:
    fields: dict[minidom.Element, set[str]]
    styles: dict[str, Style]
    default_style: str
    targets: dict[NodePath, minidom.Element] = field(default_factory=dict)
    sources: dict[NodePath, minidom.Element] = field(default_factory=dict)
    counts: Counter[tuple[str, str]] = field(default_factory=Counter)
    markers: int = 0

    def record(self, kind: str, mode: str) -> None:
        self.counts[kind, mode] += 1

    def locked(
        self,
        node: minidom.Element,
        kinds: set[str],
        kind: str = "paragraph",
        attrs: JsonObject | None = None,
    ) -> JsonObject:
        self.markers += 1
        for category in kinds:
            self.record(category, "locked")
        visible = " ".join(
            "".join(
                text_of(part)
                for part in node.getElementsByTagName("*")
                if part.localName == "t" and part.namespaceURI in {W, M}
            ).split()
        )
        labels = "、".join(LABELS[category] for category in sorted(kinds))
        marker = f"［锁定对象 {self.markers}］{labels}"
        content = text_json(f"{marker} {visible}" if visible else marker)
        for text in content:
            text["marks"] = [{"type": "aiLock"}]
        return node_json(kind, content, attrs)

    def paragraph(self, node: minidom.Element, path: NodePath) -> JsonObject:
        self.sources[path] = node
        level, numbered = paragraph_style(child(node, "pPr"), self.styles, self.default_style)
        kind = "heading" if level is not None else "paragraph"
        attrs: JsonObject | None = {"level": level} if level is not None else None
        kinds = object_kinds(node, self.fields.get(node, set()))
        if not kinds and not numbered:
            target = text_target(node)
            if target is not None and not any(char in text_of(target) for char in "\r\n\t"):
                self.record(kind, "editable")
                self.targets[path] = target
                return node_json(kind, text_json(text_of(target)), attrs)
            if only(node, "pPr") and len(children(node, "pPr")) <= 1:
                self.record(kind, "locked")
                return node_json(kind, attrs=attrs)
        self.record(kind, "locked")
        return self.locked(node, kinds or {"unsupported"}, kind, attrs)

    def table(self, node: minidom.Element, path: NodePath) -> JsonObject:
        self.sources[path] = node
        rows = table_rows(node)
        if not rows:
            self.record("table", "locked")
            return self.locked(node, object_kinds(node, set()) | {"complex_table"})
        before = len(self.targets)
        projected = []
        for row_index, (row, cells) in enumerate(zip(children(node, "tr"), rows, strict=True)):
            properties = child(row, "trPr")
            header = child(properties, "tblHeader") if properties is not None else None
            kind = (
                "tableHeader"
                if header is not None and value(header) not in ("0", "false", "off")
                else "tableCell"
            )
            projected.append(
                node_json(
                    "tableRow",
                    [
                        node_json(
                            kind,
                            [
                                self.paragraph(paragraph, (*path, row_index, cell_index, index))
                                for index, paragraph in enumerate(children(cell, "p"))
                            ],
                        )
                        for cell_index, cell in enumerate(cells)
                    ],
                )
            )
        self.record("table", "editable" if len(self.targets) > before else "locked")
        return node_json("table", projected)

    def document(self, body: minidom.Element) -> JsonObject:
        content: list[JsonObject] = []
        for part in elements(body):
            path = (len(content),)
            if word(part, "p"):
                content.append(self.paragraph(part, path))
            elif word(part, "tbl"):
                content.append(self.table(part, path))
            elif not word(part, "sectPr"):
                self.sources[path] = part
                content.append(self.locked(part, object_kinds(part, set()) or {"unsupported"}))
        return node_json("doc", content or [node_json("paragraph")])


def import_docx(
    archive: ZipFile,
) -> tuple[JsonObject, Projection, bytes, dict[minidom.Element, tuple[int, int]]]:
    check_package(archive)
    original = archive.read(MAIN)
    main, spans = xml_document(original, main=True)
    root = main.documentElement
    if root is None:
        raise RoundtripError("DOCX 主文档缺少根元素。")
    all_elements = root.getElementsByTagName("*")
    if len(all_elements) > 100000 or len(root.getElementsByTagNameNS(W, "p")) > 20000:
        raise ProjectionLimitError("DOCX 节点数量超过安全上限。")
    bodies = children(root, "body")
    if not word(root, "document") or len(bodies) != 1 or not only(root, "background", "body"):
        raise RoundtripError("DOCX 主文档结构无效或命名空间不受支持。")
    body = bodies[0]
    if any(
        part.nodeType in (Node.TEXT_NODE, Node.CDATA_SECTION_NODE) and part.data.strip()
        for part in body.childNodes
    ):
        raise RoundtripError("DOCX 正文含游离文本。")
    body_parts = elements(body)
    sections = children(body, "sectPr")
    if len(sections) > 1 or sections and body_parts[-1] is not sections[0]:
        raise RoundtripError("DOCX 节属性位置无效。")
    texts = root.getElementsByTagNameNS(W, "t")
    if len(texts) != len(spans):
        raise RoundtripError("无法将正文文本定位到原件。")
    styles, default = get_styles(archive)
    projection = Projection(field_paragraphs(body), styles, default)
    return projection.document(body), projection, original, dict(zip(texts, spans, strict=True))
