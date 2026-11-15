"""SG-02 DOCX 往返小样。会话 JSON 包含正文，应和原件一起留在本机。"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from xml.dom import Node, minidom
from xml.parsers import expat
from zipfile import ZIP_DEFLATED, ZIP_STORED, BadZipFile, ZipFile

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
OFFICE_DOCUMENT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
XML = "http://www.w3.org/XML/1998/namespace"
MAIN = "word/document.xml"
MAIN_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024
MAX_XML = 8 * 1024 * 1024
MAX_SESSION = 32 * 1024 * 1024
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


def read_bounded(path: Path, limit: int) -> bytes:
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise RoundtripError("文件超出小样大小上限。")
    return data


def xml_document(data: bytes, *, main: bool = False) -> tuple[minidom.Document, list[tuple[int, int]]]:
    if len(data) > MAX_XML:
        raise RoundtripError("XML 部件超出小样大小上限。")
    parser = expat.ParserCreate(namespace_separator=" ")
    spans: list[tuple[int, int]] = []
    active: list[tuple[int, int, int | None]] = []
    depth = 0

    def forbid_doctype(*_args: object) -> None:
        raise RoundtripError("不支持含 DTD 的 XML。")

    def xml_declaration(version: str, encoding: str | None, _standalone: int) -> None:
        if main and (version != "1.0" or encoding and encoding.lower() != "utf-8"):
            raise RoundtripError("主文档须采用 UTF-8 XML 1.0。")

    def start(name: str, _attrs: dict[str, str]) -> None:
        nonlocal depth
        depth += 1
        if depth > 100:
            raise RoundtripError("XML 嵌套超出小样深度上限。")
        if main and name == f"{W} t":
            offset = parser.CurrentByteIndex
            tag = START_TAG.match(data, offset)
            if tag is None:
                raise RoundtripError("无法定位正文文本节点。")
            active.append(
                (len(spans), offset, tag.end() if data[tag.end() - 2 : tag.end()] == b"/>" else None)
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
    return all(part.namespaceURI == W and part.localName in allowed for part in elements(node)) and all(
        part.nodeType not in (Node.TEXT_NODE, Node.CDATA_SECTION_NODE) or not part.data.strip()
        for part in node.childNodes
    )


def text_of(node: minidom.Element) -> str:
    return "".join(
        part.data for part in node.childNodes if part.nodeType in (Node.TEXT_NODE, Node.CDATA_SECTION_NODE)
    )


def check_package(archive: ZipFile) -> None:
    parts = archive.infolist()
    if len(parts) > 4096 or sum(part.file_size for part in parts) > MAX_EXPANDED:
        raise RoundtripError("DOCX 部件数量或解压大小超出小样上限。")
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

    types, _ = xml_document(archive.read("[Content_Types].xml"))
    root = types.documentElement
    if (root.namespaceURI, root.localName) != (CT, "Types"):
        raise RoundtripError("DOCX 内容类型清单无效。")
    main_types = []
    for part in elements(root):
        content_type = part.getAttribute("ContentType")
        if any(flag in content_type.lower() for flag in ("macroenabled", "vba", "digital-signature")):
            raise RoundtripError("不支持带宏或数字签名的 DOCX。")
        if (part.namespaceURI, part.localName) == (CT, "Override") and part.getAttribute(
            "PartName"
        ) == f"/{MAIN}":
            main_types.append(content_type)
    rels, _ = xml_document(archive.read("_rels/.rels"))
    root = rels.documentElement
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
    if not word(root, "styles"):
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
                    category = "citation" if CITATION_FIELD.search("".join(instructions)) else "field"
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
            kinds.add("citation" if CITATION_FIELD.search(part.getAttributeNS(W, "instr")) else "field")
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
        if part.localName in ("pPrChange", "rPrChange", "vertAlign", "vanish", "webHidden", "specVanish"):
            return None
    return target


def node_json(kind: str, content: list[dict] | None = None, attrs: dict | None = None) -> dict:
    node = {"type": kind}
    if attrs:
        node["attrs"] = attrs
    if content:
        node["content"] = content
    return node


def text_json(text: str) -> list[dict]:
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
    if not width or (grid is not None and (not only(grid, "gridCol") or len(elements(grid)) != width)):
        return []
    for row, cells in zip(rows, matrix):
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
                for name in ("gridSpan", "hMerge", "vMerge", "cellIns", "cellDel", "cellMerge", "tcPrChange")
            ):
                return []
    return matrix


@dataclass
class Projection:
    fields: dict[minidom.Element, set[str]]
    styles: dict[str, Style]
    default_style: str
    targets: dict[NodePath, minidom.Element] = field(default_factory=dict)
    counts: Counter = field(default_factory=Counter)
    markers: int = 0

    def record(self, kind: str, mode: str) -> None:
        self.counts[kind, mode] += 1

    def locked(
        self, node: minidom.Element, kinds: set[str], kind: str = "paragraph", attrs: dict | None = None
    ) -> dict:
        self.markers += 1
        for category in kinds:
            self.record(category, "locked")
        visible = " ".join("".join(text_of(part) for part in node.getElementsByTagNameNS(W, "t")).split())
        labels = "、".join(LABELS[category] for category in sorted(kinds))
        marker = f"［锁定对象 {self.markers}］{labels}"
        return node_json(kind, text_json(f"{marker} {visible}" if visible else marker), attrs)

    def paragraph(self, node: minidom.Element, path: NodePath) -> dict:
        level, numbered = paragraph_style(child(node, "pPr"), self.styles, self.default_style)
        kind = "heading" if level is not None else "paragraph"
        attrs = {"level": level} if level is not None else None
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

    def table(self, node: minidom.Element, path: NodePath) -> dict:
        rows = table_rows(node)
        if not rows:
            self.record("table", "locked")
            return self.locked(node, object_kinds(node, set()) | {"complex_table"})
        before = len(self.targets)
        projected = []
        for row_index, (row, cells) in enumerate(zip(children(node, "tr"), rows)):
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

    def document(self, body: minidom.Element) -> dict:
        content = []
        for part in elements(body):
            path = (len(content),)
            if word(part, "p"):
                content.append(self.paragraph(part, path))
            elif word(part, "tbl"):
                content.append(self.table(part, path))
            elif not word(part, "sectPr"):
                content.append(self.locked(part, object_kinds(part, set()) or {"unsupported"}))
        return node_json("doc", content or [node_json("paragraph")])


def import_docx(archive: ZipFile) -> tuple[dict, Projection, bytes, dict[minidom.Element, tuple[int, int]]]:
    check_package(archive)
    original = archive.read(MAIN)
    main, spans = xml_document(original, main=True)
    root = main.documentElement
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
    return projection.document(body), projection, original, dict(zip(texts, spans))


def editable_text(node: dict) -> str:
    parts = node.get("content", [])
    if parts == []:
        return ""
    if not isinstance(parts, list) or len(parts) != 1 or not isinstance(parts[0], dict):
        raise RoundtripError("可编辑段落仅支持单一纯文本节点。")
    part = parts[0]
    if (
        part.keys() != {"type", "text"}
        or part["type"] != "text"
        or not isinstance(part["text"], str)
        or not part["text"]
    ):
        raise RoundtripError("可编辑段落仅支持单一纯文本节点。")
    return part["text"]


def number_tokens(text: str) -> list[str]:
    decimal = "".join(
        "0" if unicodedata.category(char).startswith("N") and not char.isdecimal() else char for char in text
    )
    return [text[match.start() : match.end()] for match in NUMBER.finditer(decimal)]


def validate_text(before: str, after: str) -> None:
    if any(
        not (32 <= ord(char) <= 0xD7FF or 0xE000 <= ord(char) <= 0xFFFD or 0x10000 <= ord(char) <= 0x10FFFF)
        for char in after
    ):
        raise RoundtripError("纯文本编辑含不受支持的控制字符、换行或制表符。")
    if CITATION.search(after) or FORMULA.search(after) or number_tokens(before) != number_tokens(after):
        raise RoundtripError("纯文本编辑改变了数字，或新增了需要保护的公式、引用。")


def validated_edits(
    original: dict, edited: object, targets: dict[NodePath, minidom.Element]
) -> list[tuple[minidom.Element, str]]:
    changes = []
    defaults = {
        "heading": {"chapterId": None, "templateAlign": None, "templateWeight": None},
        "table": {"style": None},
        "tableCell": {"colspan": 1, "rowspan": 1, "colwidth": None, "align": None},
        "tableHeader": {"colspan": 1, "rowspan": 1, "colwidth": None, "align": None},
    }

    def compare(old: dict, new: object, path: NodePath) -> None:
        if not isinstance(new, dict) or new.keys() - old.keys() - {"attrs", "content"}:
            raise RoundtripError("会话含陌生编辑节点或属性。")
        kind = old["type"]
        if new.get("type") != kind:
            raise RoundtripError("正文节点类型发生变更。")
        if "attrs" in new:
            attrs = new["attrs"]
            expected = old.get("attrs", {})
            allowed = defaults.get(kind, {}) | expected
            if (
                not isinstance(attrs, dict)
                or (not expected and kind not in defaults)
                or not expected.keys() <= attrs.keys()
            ):
                raise RoundtripError("正文节点属性发生变更。")
            if any(
                key not in allowed or type(value) is not type(allowed[key]) or value != allowed[key]
                for key, value in attrs.items()
            ):
                raise RoundtripError("正文节点属性发生变更。")
        elif "attrs" in old:
            raise RoundtripError("正文节点属性缺失。")

        if path in targets:
            before, after = editable_text(old), editable_text(new)
            if before != after:
                validate_text(before, after)
                changes.append((targets[path], after))
            return
        if kind == "text" and new.get("text") != old["text"]:
            raise RoundtripError("锁定内容被修改或移动。")
        a, b = old.get("content", []), new.get("content", [])
        if not isinstance(b, list) or len(a) != len(b) or (kind == "text" and "content" in new):
            raise RoundtripError("正文结构或锁定内容被增删或移动。")
        for index, (previous, current) in enumerate(zip(a, b)):
            compare(previous, current, (*path, index))

    compare(original, edited, ())
    return changes


def rewrite_text(
    original: bytes, spans: dict[minidom.Element, tuple[int, int]], changes: list[tuple[minidom.Element, str]]
) -> bytes:
    replacements = []
    for target, text in changes:
        if target.firstChild is not None:
            target.firstChild.data = text
            for remaining in list(target.childNodes[1:]):
                target.removeChild(remaining)
        elif text:
            target.appendChild(target.ownerDocument.createTextNode(text))
        if text.strip() != text:
            target.setAttributeNS(XML, "xml:space", "preserve")
        start, end = spans[target]
        replacements.append((start, end, target.toxml(encoding="utf-8")))
    parts = []
    end = 0
    for start, stop, replacement in sorted(replacements):
        parts.extend((original[end:start], replacement))
        end = stop
    parts.append(original[end:])
    modified = b"".join(parts)
    xml_document(modified, main=True)
    return modified


def write_new(path: Path, content: bytes) -> None:
    """同目录完成写入后原子创建目标，对已存在的路径失败。"""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
        os.link(temporary, path)
    except FileExistsError as exc:
        raise RoundtripError("目标文件已存在，请指定新路径。") from exc
    finally:
        if temporary is not None:
            temporary.unlink()


def unique_properties(pairs: list[tuple[str, object]]) -> dict:
    mapping = dict(pairs)
    if len(mapping) != len(pairs):
        raise RoundtripError("会话 JSON 含重复属性。")
    return mapping


def run(command: str, source: Path, session_path: Path, output: Path | None = None) -> None:
    data = read_bounded(source, MAX_ARCHIVE)
    digest = hashlib.sha256(data).hexdigest()
    with ZipFile(io.BytesIO(data)) as archive:
        document, projection, main_xml, spans = import_docx(archive)
        if command == "import":
            session = {
                "schema_version": 1,
                "source_sha256": digest,
                "document": document,
                "editable_paths": list(projection.targets),
                "objects": [
                    {"kind": kind, "mode": mode, "count": count}
                    for (kind, mode), count in sorted(projection.counts.items())
                ],
            }
            content = json.dumps(session, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
            if len(content) > MAX_SESSION:
                raise RoundtripError("会话 JSON 超出小样大小上限。")
            write_new(session_path, content)
            return

        session = json.loads(
            read_bounded(session_path, MAX_SESSION).decode("utf-8-sig"), object_pairs_hook=unique_properties
        )
        if (
            not isinstance(session, dict)
            or type(session.get("schema_version")) is not int
            or session["schema_version"] != 1
            or session.get("source_sha256") != digest
        ):
            raise RoundtripError("会话版本或 DOCX 原件指纹不匹配。")
        changes = validated_edits(document, session.get("document"), projection.targets)
        if changes:
            modified = rewrite_text(main_xml, spans, changes)
            buffer = io.BytesIO()
            with ZipFile(buffer, "w") as export:
                export.comment = archive.comment
                for part in archive.infolist():
                    export.writestr(part, modified if part.filename == MAIN else archive.read(part))
            data = buffer.getvalue()
    assert output is not None
    write_new(output, data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("import", "export"):
        sub = commands.add_parser(command)
        sub.add_argument("input", type=Path, metavar="INPUT.docx")
        sub.add_argument("session", type=Path, metavar="SESSION.json")
        if command == "export":
            sub.add_argument("output", type=Path, metavar="OUTPUT.docx")
    args = parser.parse_args()
    try:
        run(args.command, args.input, args.session, getattr(args, "output", None))
    except RoundtripError as exc:
        print(f"拒绝处理。{exc}", file=sys.stderr)
        return 1
    except (BadZipFile, KeyError, RuntimeError, ValueError, OSError):
        print("拒绝处理。无法读取 DOCX、解析会话或写入目标路径。", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
