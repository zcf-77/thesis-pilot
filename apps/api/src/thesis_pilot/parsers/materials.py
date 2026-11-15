"""Parse immutable original bytes without network, paths or model interpretation.

DOCX projection reuses the repository's SG-02 deterministic import core, copied
into docx_core.py from scripts/docx_roundtrip.py (f964ebb1). Its support matrix
remains deliberately narrow: single-run text and regular tables are editable;
formulas, fields, citations, images and unknown structures retain source hashes
and protected projections. A parse is not a DOCX export or an import acceptance.
"""

import io
import json
import re
from copy import deepcopy
from hashlib import sha256
from typing import Literal, cast
from uuid import UUID
from xml.dom import minidom
from zipfile import BadZipFile, ZipFile

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.structure import (
    EditorJsonValue,
    JsonObject,
    canonical_editor_json,
)
from thesis_pilot.parsers import docx_core as core
from thesis_pilot.parsers.schemas import (
    ParsedMaterial,
    ParsedRequirement,
    SourceAnchor,
    TemplateItem,
)

MAX_ORIGINAL_BYTES = 8 * 1024 * 1024
MAX_TEXT_BYTES = 8 * 1024 * 1024
MAX_ANCHORS = 20000
MAX_DERIVED_ITEMS = 20000
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
PARSER_VERSION = "thesispilot-material-1"
DOCX_TYPES = {"docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
TEXT_TYPES = {"txt", "text", "text/plain"}


def invalid() -> AppError:
    return AppError("MATERIAL_PARSE_INVALID", "原件格式无效或含不支持的安全结构。", 422)


def limit_exceeded() -> AppError:
    return AppError(
        "MATERIAL_PARSE_LIMIT_EXCEEDED", "原件或解析结果超过安全上限，未截断保存。", 413
    )


def stable_id(original_version_id: UUID, location: str) -> str:
    return "source-" + sha256(f"{original_version_id}:{location}".encode()).hexdigest()[:32]


def xml_path(node: minidom.Element) -> str:
    segments = []
    cursor: minidom.Element | None = node
    while cursor is not None:
        parent = cursor.parentNode
        siblings = (
            [
                item
                for item in parent.childNodes
                if isinstance(item, minidom.Element)
                and item.namespaceURI == cursor.namespaceURI
                and item.localName == cursor.localName
            ]
            if parent is not None
            else [cursor]
        )
        segments.append(
            f"{{{cursor.namespaceURI or ''}}}{cursor.localName}[{siblings.index(cursor) + 1}]"
        )
        cursor = parent if isinstance(parent, minidom.Element) else None
    return "/" + "/".join(reversed(segments))


def _xml_paths(root: minidom.Element) -> dict[minidom.Element, str]:
    """Index once; repeated paragraphs must not cause quadratic sibling scans."""
    result: dict[minidom.Element, str] = {}

    def visit(node: minidom.Element, location: str) -> None:
        result[node] = location
        counts: dict[tuple[str | None, str | None], int] = {}
        for child in core.elements(node):
            key = (child.namespaceURI, child.localName)
            counts[key] = counts.get(key, 0) + 1
            visit(child, f"{location}/{{{key[0] or ''}}}{key[1]}[{counts[key]}]")

    visit(root, f"/{{{root.namespaceURI or ''}}}{root.localName}[1]")
    return result


def source_text(node: minidom.Element) -> str:
    parts = []
    for item in [node, *node.getElementsByTagName("*")]:
        if (item.namespaceURI, item.localName) in {
            (core.W, "t"),
            (core.W, "instrText"),
            (core.M, "t"),
        }:
            parts.append(core.text_of(item))
        elif core.word(item, "tab"):
            parts.append("\t")
        elif core.word(item, "br"):
            parts.append("\n")
    return "".join(parts)


def anchor(
    original_version_id: UUID,
    part: str,
    node: minidom.Element,
    kind: str,
    *,
    path: tuple[int, ...] | None = None,
    editable: bool = False,
    locations: dict[minidom.Element, str] | None = None,
) -> SourceAnchor:
    location = locations[node] if locations is not None else xml_path(node)
    text = source_text(node)
    if kind in {"style", "section"}:
        text = node.toxml()
    return SourceAnchor(
        id=stable_id(original_version_id, f"{part}:{location}"),
        original_version_id=original_version_id,
        kind=kind,
        part=part,
        xml_path=location,
        original_text=text,
        sha256=sha256(text.encode()).hexdigest(),
        xml_sha256=sha256(node.toxml(encoding="utf-8")).hexdigest(),
        editor_path=list(path) if path is not None else None,
        editable=editable,
    )


def _node_at(document: JsonObject, path: tuple[int, ...]) -> JsonObject:
    node = document
    for index in path:
        content = node.get("content")
        if (
            not isinstance(content, list)
            or index >= len(content)
            or not isinstance(content[index], dict)
        ):
            raise invalid()
        selected = content[index]
        if not isinstance(selected, dict):
            raise invalid()
        node = selected
    return node


def _json_digest(value: object) -> str:
    return sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def projection_skeleton(document: JsonObject, editable_paths: list[list[int]]) -> JsonObject:
    """Keep all structure/locked objects, replacing only mapped editable text."""
    result = deepcopy(document)
    for path in editable_paths:
        node = _node_at(result, tuple(path))
        content = node.get("content", [])
        if not isinstance(content, list) or len(content) > 1:
            raise invalid()
        text: JsonObject = {"type": "text", "text": "MAPPED_EDITABLE_TEXT"}
        if content:
            part = content[0]
            if not isinstance(part, dict) or part.get("type") != "text":
                raise invalid()
            text = deepcopy(part)
            text["text"] = "MAPPED_EDITABLE_TEXT"
        node["content"] = [text]
    return result


def validate_projection(parsed: ParsedMaterial, document: JsonObject) -> None:
    """SG-13A can reject manual changes to protected skeletons, beyond AI marks."""
    manifest = parsed.roundtrip_manifest
    if manifest is None:
        raise invalid()
    raw_paths = manifest.get("editable_paths")
    if not isinstance(raw_paths, list) or not all(
        isinstance(path, list) and all(type(index) is int and index >= 0 for index in path)
        for path in raw_paths
    ):
        raise invalid()
    paths = cast(list[list[int]], raw_paths)
    try:
        normalized = canonical_editor_json(document)
        skeleton = projection_skeleton(normalized, paths)
    except (AppError, IndexError, TypeError, ValueError) as error:
        raise invalid() from error
    if _json_digest(skeleton) != manifest.get("skeleton_sha256"):
        raise AppError(
            "MATERIAL_PROTECTED_CONTENT_CHANGED", "原件的受保护对象或正文结构已改变。", 409
        )


def _template_items(source: SourceAnchor, node: minidom.Element) -> list[TemplateItem]:
    items: list[TemplateItem] = []
    scope = f"{source.kind}:{source.id}"

    def item(field: str, value: str | int, unit: str | None) -> None:
        items.append(
            TemplateItem(
                id=f"{source.id}:{field}",
                field=field,
                scope=scope,
                value=value,
                unit=unit,
                state="recognized",
                anchor_ids=[source.id],
                note="仅记录该来源节点的显式 XML 值，不推断全局适用范围。",
            )
        )

    for element in [node, *node.getElementsByTagName("*")]:
        if element.namespaceURI != core.W:
            continue
        fields: dict[str, tuple[str, str | None]] = {}
        if element.localName == "pgSz":
            fields = {
                "w": ("page_width", "twip"),
                "h": ("page_height", "twip"),
                "orient": ("page_orientation", None),
            }
        elif element.localName == "pgMar":
            fields = {
                name: (f"margin_{name}", "twip")
                for name in ("top", "bottom", "left", "right", "header", "footer", "gutter")
            }
        elif element.localName == "rFonts":
            fields = {
                name: (f"font_family_{name}", None) for name in ("ascii", "hAnsi", "eastAsia", "cs")
            }
        elif element.localName == "sz":
            fields = {"val": ("font_size", "half_point")}
        elif element.localName == "jc":
            fields = {"val": ("alignment", None)}
        elif element.localName == "outlineLvl":
            fields = {"val": ("outline_level", "zero_based")}
        elif element.localName == "spacing":
            fields = {
                name: (f"spacing_{name}", "raw_ooxml")
                for name in ("before", "after", "line", "lineRule")
            }
        for attribute, (field, unit) in fields.items():
            raw = element.getAttributeNS(core.W, attribute)
            if raw:
                item(field, int(raw) if re.fullmatch(r"\d{1,9}", raw) else raw, unit)
    # Repeated contradictory direct properties remain visible rather than picking a winner.
    groups: dict[str, list[TemplateItem]] = {}
    for entry in items:
        groups.setdefault(entry.field, []).append(entry)
    for entries in groups.values():
        if len(entries) > 1:
            for index, entry in enumerate(entries):
                entry.id += f":{index}"
                entry.state = "conflict"
                entry.note = "同一来源范围含重复显式属性；未选择一个值冒充最终格式。"
    return items


def _requirements(anchors: list[SourceAnchor]) -> list[ParsedRequirement]:
    results: list[ParsedRequirement] = []
    scopes = r"(?:论文)?(正文|全文|摘要)(?:字数)?(?:应)?"
    patterns: list[tuple[re.Pattern[str], Literal["word_count", "reference_count"], str]] = [
        (re.compile(scopes + r"(?:不少于|至少|不得少于)\s*(\d{1,7})\s*字"), "word_count", "min"),
        (re.compile(scopes + r"(?:不超过|至多|不得超过)\s*(\d{1,7})\s*字"), "word_count", "max"),
        (
            re.compile(scopes + r"(?:为)?\s*(\d{1,7})\s*[-–—~至到]\s*(\d{1,7})\s*字"),
            "word_count",
            "range",
        ),
        (
            re.compile(
                r"(参考文献)(?:数量|篇数)?(?:应)?(?:不少于|至少|不得少于)\s*(\d{1,5})\s*(?:篇|条)"
            ),
            "reference_count",
            "min",
        ),
    ]
    for source in anchors:
        if source.kind not in {"text", "paragraph", "heading"}:
            continue
        for index, raw in enumerate(re.split(r"[。；;\n]", source.original_text)):
            sentence = raw.strip()
            if not sentence:
                continue
            requirement: ParsedRequirement | None = None
            for expression, kind, bound in patterns:
                match = expression.fullmatch(sentence)
                if not match:
                    continue
                parameters = (
                    {"min": int(match[2]), "max": int(match[3])}
                    if bound == "range"
                    else {bound: int(match[2])}
                )
                if any(value <= 0 for value in parameters.values()) or parameters.get(
                    "min", 0
                ) > parameters.get("max", 10**8):
                    continue
                requirement = ParsedRequirement(
                    id=f"{source.id}:rule:{index}",
                    original_text=sentence,
                    anchor_ids=[source.id],
                    scope=match[1],
                    rule_type="hard",
                    kind=kind,
                    parameters=parameters,
                    strictness="required",
                    enabled=True,
                    checkable=True,
                    uncertainty="仅识别原句中的窄数量约束；统计口径仍须按原文范围执行。",
                )
                break
            if requirement is None and re.search(
                r"必须|不得|不少于|不超过|应当|建议|字数|参考文献", sentence
            ):
                requirement = ParsedRequirement(
                    id=f"{source.id}:rule:{index}",
                    original_text=sentence,
                    anchor_ids=[source.id],
                    scope="原文范围待确认",
                    rule_type="semantic",
                    kind="semantic",
                    parameters={},
                    strictness="unknown",
                    enabled=False,
                    checkable=False,
                    uncertainty="未匹配可执行的窄规则，保留原句，不能据此判定通过。",
                )
            if requirement is not None:
                results.append(requirement)
                if len(results) > MAX_DERIVED_ITEMS:
                    raise limit_exceeded()
    groups: dict[tuple[str, str], list[ParsedRequirement]] = {}
    for entry in results:
        if entry.rule_type == "hard":
            groups.setdefault((entry.kind, entry.scope), []).append(entry)
    for peers in groups.values():
        lower = max((item.parameters.get("min", 0) for item in peers), default=0)
        upper = min((item.parameters.get("max", 10**8) for item in peers), default=10**8)
        if lower > upper:
            for entry in peers:
                entry.enabled = entry.checkable = False
                entry.uncertainty = "来源中的数量约束相互冲突，保留原句且不执行。"
    return results


def _finish(
    plain_text: str,
    anchors: list[SourceAnchor],
    document: JsonObject,
    manifest: JsonObject,
    template_items: list[TemplateItem],
    diagnostics: list[str],
    *,
    partial: bool,
) -> ParsedMaterial:
    if (
        len(plain_text.encode()) > MAX_TEXT_BYTES
        or len(anchors) > MAX_ANCHORS
        or len(template_items) > MAX_DERIVED_ITEMS - 5
    ):
        raise limit_exceeded()
    recognized = {item.field for item in template_items}
    for field in ("page_width", "page_height", "font_family", "font_size", "line_spacing"):
        if field not in recognized and not (
            field == "font_family" and any(name.startswith("font_family_") for name in recognized)
        ):
            template_items.append(
                TemplateItem(
                    id=f"unknown:{field}",
                    field=field,
                    scope="document",
                    value=None,
                    state="unknown",
                    anchor_ids=[],
                    note="未取得可核验的该项全局显式值，不从样例排版或字体名称反推。",
                )
            )
    result = ParsedMaterial(
        status="partial" if partial else "complete",
        plain_text=plain_text,
        anchors=anchors,
        editor_json=canonical_editor_json(document),
        roundtrip_manifest=manifest,
        template_items=template_items,
        requirements=_requirements(anchors),
        diagnostics=diagnostics,
    )
    if len(result.model_dump_json().encode()) > MAX_OUTPUT_BYTES:
        raise limit_exceeded()
    return result


def _text(data: bytes, original_version_id: UUID) -> ParsedMaterial:
    try:
        text = data.decode("utf-8")
    except UnicodeError as error:
        raise invalid() from error
    if any(ord(char) < 32 and char not in "\r\n\t" for char in text):
        raise invalid()
    bom = text.startswith("\ufeff")
    if bom:
        text = text[1:]
    lines = re.split(r"\r\n|\n|\r", text)
    if len(lines) > MAX_ANCHORS:
        raise limit_exceeded()
    anchors = [
        SourceAnchor(
            id=stable_id(original_version_id, f"text:line:{number}"),
            original_version_id=original_version_id,
            kind="text",
            part="text",
            line=number,
            original_text=line,
            sha256=sha256(line.encode()).hexdigest(),
            editor_path=[number - 1],
            editable=True,
        )
        for number, line in enumerate(lines, 1)
    ]
    document = core.node_json(
        "doc", [core.node_json("paragraph", core.text_json(line)) for line in lines]
    )
    canonical = canonical_editor_json(document)
    paths = [[index] for index in range(len(lines))]
    manifest: JsonObject = {
        "schema_version": 1,
        "original_version_id": str(original_version_id),
        "source_sha256": sha256(data).hexdigest(),
        "file_type": "text",
        "bom": bom,
        "editable_paths": cast(list[EditorJsonValue], paths),
        "skeleton_sha256": _json_digest(projection_skeleton(canonical, paths)),
        "locked_nodes": [],
    }
    return _finish(
        text,
        anchors,
        document,
        manifest,
        [],
        ["仅接受严格 UTF-8 文本；不推断字体、标题或页面样式。"],
        partial=False,
    )


def _docx(data: bytes, original_version_id: UUID) -> ParsedMaterial:
    try:
        with ZipFile(io.BytesIO(data)) as archive:
            document, projection, main_bytes, spans = core.import_docx(archive)
            anchors: list[SourceAnchor] = []
            mapped: dict[minidom.Element, SourceAnchor] = {}
            template_items: list[TemplateItem] = []
            owner = (
                next(iter(projection.sources.values())).ownerDocument
                if projection.sources
                else core.xml_document(main_bytes)[0]
            )
            root = owner.documentElement if owner is not None else None
            if root is None:
                raise invalid()
            main_paths = _xml_paths(root)
            for path, node in projection.sources.items():
                kind = (
                    "table"
                    if core.word(node, "tbl")
                    else "heading"
                    if _node_at(document, path).get("type") == "heading"
                    else "paragraph"
                )
                source = anchor(
                    original_version_id,
                    core.MAIN,
                    node,
                    kind,
                    path=path,
                    editable=path in projection.targets,
                    locations=main_paths,
                )
                anchors.append(source)
                mapped[node] = source
                projected = _node_at(document, path)
                if projected.get("type") == "heading":
                    attributes = projected.get("attrs")
                    if isinstance(attributes, dict):
                        attributes["chapterId"] = source.id
                if core.word(node, "p"):
                    template_items.extend(_template_items(source, node))
                if len(anchors) > MAX_ANCHORS or len(template_items) > MAX_DERIVED_ITEMS:
                    raise limit_exceeded()
            for node in root.getElementsByTagName("*"):
                object_kind = None
                if node.namespaceURI == core.M and node.localName in {"oMath", "oMathPara"}:
                    object_kind = "formula"
                elif node.namespaceURI == core.W:
                    object_kind = {
                        "drawing": "image",
                        "pict": "image",
                        "object": "image",
                        "fldSimple": "field",
                        "fldChar": "field",
                        "instrText": "field",
                        "sectPr": "section",
                    }.get(node.localName or "")
                if object_kind is not None:
                    source = anchor(
                        original_version_id, core.MAIN, node, object_kind, locations=main_paths
                    )
                    anchors.append(source)
                    if object_kind == "section":
                        template_items.extend(_template_items(source, node))
                if len(anchors) > MAX_ANCHORS or len(template_items) > MAX_DERIVED_ITEMS:
                    raise limit_exceeded()
            if "word/styles.xml" in archive.namelist():
                styles, _ = core.xml_document(archive.read("word/styles.xml"))
                style_root = styles.documentElement
                if style_root is not None:
                    style_paths = _xml_paths(style_root)
                    for node in core.elements(style_root):
                        source = anchor(
                            original_version_id,
                            "word/styles.xml",
                            node,
                            "style",
                            locations=style_paths,
                        )
                        anchors.append(source)
                        template_items.extend(_template_items(source, node))
                        if len(anchors) > MAX_ANCHORS or len(template_items) > MAX_DERIVED_ITEMS:
                            raise limit_exceeded()
            if len(anchors) > MAX_ANCHORS:
                raise limit_exceeded()
            canonical = canonical_editor_json(document)
            paths = [list(path) for path in projection.targets]
            locked_nodes: list[EditorJsonValue] = []
            targets: list[EditorJsonValue] = []
            editable_ancestors = {
                path[:depth] for path in projection.targets for depth in range(1, len(path) + 1)
            }
            for path, node in projection.sources.items():
                if path not in editable_ancestors:
                    locked_nodes.append(
                        {
                            "editor_path": list(path),
                            "anchor_id": mapped[node].id,
                            "projection_sha256": _json_digest(_node_at(canonical, path)),
                            "source_xml_sha256": mapped[node].xml_sha256,
                        }
                    )
            for path, target in projection.targets.items():
                start, end = spans[target]
                targets.append(
                    {
                        "editor_path": list(path),
                        "xml_path": main_paths[target],
                        "part": core.MAIN,
                        "byte_start": start,
                        "byte_end": end,
                        "source_node_sha256": sha256(main_bytes[start:end]).hexdigest(),
                    }
                )
            parts: list[EditorJsonValue] = [
                {
                    "part": part.filename,
                    "bytes": part.file_size,
                    "sha256": sha256(archive.read(part)).hexdigest(),
                }
                for part in archive.infolist()
            ]
            manifest: JsonObject = {
                "schema_version": 1,
                "original_version_id": str(original_version_id),
                "source_sha256": sha256(data).hexdigest(),
                "file_type": "docx",
                "main_part": core.MAIN,
                "main_sha256": sha256(main_bytes).hexdigest(),
                "package_parts": parts,
                "editable_paths": cast(list[EditorJsonValue], paths),
                "text_targets": targets,
                "locked_nodes": locked_nodes,
                "skeleton_sha256": _json_digest(projection_skeleton(canonical, paths)),
                "support_matrix": (
                    "single-run text and regular tables; original required for protected objects"
                ),
            }
            paragraphs = [
                source_text(paragraph) for paragraph in root.getElementsByTagNameNS(core.W, "p")
            ]
            locked = bool(locked_nodes)
            diagnostics = ["解析保留原件及逐部件 SHA；编辑投影不等于任意 DOCX 保真导出。"]
            if locked:
                diagnostics.append(
                    "公式、图片、域、引用或未知结构存在受保护投影；原包与映射必须共同保留。"
                )
            return _finish(
                "\n".join(paragraphs),
                anchors,
                document,
                manifest,
                template_items,
                diagnostics,
                partial=locked,
            )
    except core.ProjectionLimitError as error:
        raise limit_exceeded() from error
    except AppError as error:
        if error.code.startswith("MATERIAL_"):
            raise
        raise invalid() from error
    except (
        core.RoundtripError,
        BadZipFile,
        KeyError,
        OSError,
        UnicodeError,
        ValueError,
        RecursionError,
    ) as error:
        raise invalid() from error


def parse_original(data: bytes, original_version_id: UUID, file_type: str) -> ParsedMaterial:
    if not data:
        raise invalid()
    if len(data) > MAX_ORIGINAL_BYTES:
        raise limit_exceeded()
    normalized = file_type.strip().lower()
    if normalized in TEXT_TYPES:
        return _text(data, original_version_id)
    if normalized in DOCX_TYPES:
        return _docx(data, original_version_id)
    raise AppError(
        "MATERIAL_UNSUPPORTED_TYPE", "该原件类型暂不支持解析；原件仍保留，PDF 未生成伪造文本。", 422
    )
