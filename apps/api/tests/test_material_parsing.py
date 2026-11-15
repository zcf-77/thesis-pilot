"""Only synthetic OOXML and UTF-8; no private templates or parser dependencies."""

import io
import struct
from copy import deepcopy
from hashlib import sha256
from uuid import uuid4
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.structure import canonical_editor_json
from thesis_pilot.parsers import docx_core as core
from thesis_pilot.parsers.materials import (
    MAX_ANCHORS,
    MAX_ORIGINAL_BYTES,
    parse_original,
    validate_projection,
)
from thesis_pilot.parsers.schemas import ParsedMaterial


def paragraph(text: str, properties: str = "") -> str:
    return f"<w:p>{properties}<w:r><w:t>{escape(text)}</w:t></w:r></w:p>"


def package(
    body: str,
    *,
    styles: str | None = None,
    extra: dict[str, bytes] | None = None,
) -> bytes:
    parts = {
        "[Content_Types].xml": (
            f'<Types xmlns="{core.CT}"><Override PartName="/{core.MAIN}" '
            f'ContentType="{core.MAIN_TYPE}"/></Types>'
        ).encode(),
        "_rels/.rels": (
            f'<Relationships xmlns="{core.REL}"><Relationship Id="rId1" '
            f'Type="{core.OFFICE_DOCUMENT}" Target="{core.MAIN}"/></Relationships>'
        ).encode(),
        core.MAIN: (
            f'<w:document xmlns:w="{core.W}" xmlns:m="{core.M}">'
            f"<w:body>{body}</w:body></w:document>"
        ).encode(),
    }
    if styles is not None:
        parts["word/styles.xml"] = f'<w:styles xmlns:w="{core.W}">{styles}</w:styles>'.encode()
    parts.update(extra or {})
    output = io.BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name, content in parts.items():
            archive.writestr(name, content)
    return output.getvalue()


def complex_original() -> bytes:
    body = paragraph("第一章 合成方法", '<w:pPr><w:pStyle w:val="CustomHeading"/></w:pPr>')
    body += paragraph("这是可编辑的自制文本。")
    body += (
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc>'
        + paragraph("表格中的普通文本")
        + "</w:tc></w:tr></w:tbl>"
        + '<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>'
        + paragraph("合并表格仍在原件")
        + "</w:tc></w:tr></w:tbl>"
        + "<w:p><m:oMath><m:r><m:t>x²</m:t></m:r></m:oMath></w:p>"
        + "<w:p><w:r><w:drawing/></w:r></w:p>"
        + '<w:p><w:fldSimple w:instr=" REF Synthetic "><w:r><w:t>原域缓存</w:t>'
        + "</w:r></w:fldSimple></w:p>"
        + paragraph("引用内容 [1] 原样保留。")
        + "<w:sdt><w:sdtContent>"
        + paragraph("未知结构的原文")
        + "</w:sdtContent></w:sdt>"
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        + '<w:pgMar w:top="1440" w:left="1200"/></w:sectPr>'
    )
    styles = (
        '<w:style w:type="paragraph" w:styleId="BaseHeading"><w:pPr>'
        '<w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:eastAsia="合成字体"/>'
        '<w:sz w:val="28"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="CustomHeading">'
        '<w:basedOn w:val="BaseHeading"/></w:style>'
    )
    return package(
        body, styles=styles, extra={"word/media/illustration.bin": b"synthetic-image-original"}
    )


def test_utf8_lines_sources_rules_and_stable_identity() -> None:
    data = (
        "正文字数不少于12000字。\r\n参考文献不少于15篇。\n摘要300–500字。\n建议逻辑清晰。".encode()
    )
    original_version_id = uuid4()
    parsed = parse_original(data, original_version_id, "text/plain")
    assert parsed.status == "complete"
    assert parsed.plain_text == data.decode()
    assert parsed == parse_original(data, original_version_id, "txt")
    assert parsed.roundtrip_manifest is not None
    assert parsed.roundtrip_manifest["source_sha256"] == sha256(data).hexdigest()
    assert [source.line for source in parsed.anchors] == [1, 2, 3, 4]
    for source in parsed.anchors:
        assert source.original_version_id == original_version_id
        assert source.sha256 == sha256(source.original_text.encode()).hexdigest()
    assert [(rule.kind, rule.parameters) for rule in parsed.requirements[:3]] == [
        ("word_count", {"min": 12000}),
        ("reference_count", {"min": 15}),
        ("word_count", {"min": 300, "max": 500}),
    ]
    assert not parsed.requirements[-1].checkable
    assert not parsed.requirements[-1].enabled
    assert all(item.state == "unknown" for item in parsed.template_items)
    other = parse_original(data, uuid4(), "text")
    assert other.anchors[0].id != parsed.anchors[0].id


@pytest.mark.parametrize("data", [b"\xff\xfe\x00\x00", b"hello\x00world", b"\xed\xa0\x80", b""])
def test_invalid_text_is_rejected_without_replacement_or_fake_success(data: bytes) -> None:
    with pytest.raises(AppError) as caught:
        parse_original(data, uuid4(), "txt")
    assert caught.value.code == "MATERIAL_PARSE_INVALID"


def test_pdf_is_explicitly_unsupported_and_keeps_input_untouched() -> None:
    data = b"%PDF-1.7\nSynthetic original only\n%%EOF"
    before = sha256(data).digest()
    with pytest.raises(AppError) as caught:
        parse_original(data, uuid4(), "application/pdf")
    assert caught.value.code == "MATERIAL_UNSUPPORTED_TYPE"
    assert sha256(data).digest() == before


def test_docx_projects_supported_text_and_preserves_all_complex_objects() -> None:
    data = complex_original()
    parsed = parse_original(data, uuid4(), "docx")
    assert parsed.status == "partial"
    assert parsed.editor_json is not None and parsed.roundtrip_manifest is not None
    assert canonical_editor_json(parsed.editor_json) == parsed.editor_json
    assert "合并表格仍在原件" in parsed.plain_text
    assert "x²" in parsed.plain_text
    assert "原域缓存" in parsed.plain_text
    assert "未知结构的原文" in parsed.plain_text
    assert {source.kind for source in parsed.anchors} >= {
        "formula",
        "image",
        "field",
        "table",
        "heading",
        "style",
        "section",
    }
    assert all(source.xml_path for source in parsed.anchors)
    manifest = parsed.roundtrip_manifest
    assert manifest["source_sha256"] == sha256(data).hexdigest()
    assert manifest["locked_nodes"] and manifest["text_targets"]
    with ZipFile(io.BytesIO(data)) as archive:
        expected = {
            part.filename: sha256(archive.read(part)).hexdigest() for part in archive.infolist()
        }
    assert {part["part"]: part["sha256"] for part in manifest["package_parts"]} == expected
    targets = manifest["text_targets"]
    with ZipFile(io.BytesIO(data)) as archive:
        main = archive.read(core.MAIN)
    assert all(
        sha256(main[target["byte_start"] : target["byte_end"]]).hexdigest()
        == target["source_node_sha256"]
        for target in targets
    )
    heading = parsed.editor_json["content"][0]
    assert heading["type"] == "heading" and heading["attrs"]["level"] == 2
    assert any(
        item.field == "font_size" and item.value == 28 and item.unit == "half_point"
        for item in parsed.template_items
    )
    assert any(
        item.field == "page_width" and item.value == 11906 and item.unit == "twip"
        for item in parsed.template_items
    )
    assert any(
        item.state == "unknown" and item.field == "line_spacing" for item in parsed.template_items
    )
    validate_projection(parsed, parsed.editor_json)
    assert ParsedMaterial.model_validate_json(parsed.model_dump_json()) == parsed


def test_protected_skeleton_rejects_manual_object_edit_and_allows_mapped_text() -> None:
    parsed = parse_original(complex_original(), uuid4(), "docx")
    assert parsed.editor_json is not None and parsed.roundtrip_manifest is not None
    edited = deepcopy(parsed.editor_json)
    edited["content"][1]["content"][0]["text"] = "只改变允许映射的合成文本。"
    validate_projection(parsed, edited)
    locked = deepcopy(parsed.editor_json)
    formula_path = next(
        source.editor_path
        for source in parsed.anchors
        if "x²" in source.original_text and source.kind == "paragraph"
    )
    assert formula_path is not None and len(formula_path) == 1
    locked["content"][formula_path[0]]["content"][0]["text"] = "试图替换原公式投影"
    with pytest.raises(AppError) as caught:
        validate_projection(parsed, locked)
    assert caught.value.code == "MATERIAL_PROTECTED_CONTENT_CHANGED"
    reordered = deepcopy(parsed.editor_json)
    reordered["content"].reverse()
    with pytest.raises(AppError):
        validate_projection(parsed, reordered)
    formatted = deepcopy(parsed.editor_json)
    formatted["content"][1]["content"][0]["marks"] = [{"type": "bold"}]
    with pytest.raises(AppError):
        validate_projection(parsed, formatted)
    extra_inline = deepcopy(parsed.editor_json)
    extra_inline["content"][1]["content"].append({"type": "hardBreak"})
    with pytest.raises(AppError):
        validate_projection(parsed, extra_inline)


@pytest.mark.parametrize(
    "extra",
    [
        {"../escape.xml": b"<data/>"},
        {"word/vbaProject.bin": b"synthetic macro marker"},
        {"_xmlsignatures/signature.xml": b"<data/>"},
        {
            "customXml/item.xml": b'<!DOCTYPE data [<!ENTITY secret SYSTEM "file:///unavailable">]><data>&secret;</data>'
        },
        {"word/_rels/unsafe.rels": b"<!DOCTYPE data><data/>"},
    ],
)
def test_unsafe_package_parts_are_rejected_before_projection(extra: dict[str, bytes]) -> None:
    with pytest.raises(AppError) as caught:
        parse_original(package(paragraph("合成正常正文"), extra=extra), uuid4(), "docx")
    assert caught.value.code == "MATERIAL_PARSE_INVALID"


def test_broken_cross_paragraph_field_boundaries_are_rejected() -> None:
    body = '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>' + paragraph("不完整域缓存")
    with pytest.raises(AppError) as caught:
        parse_original(package(body), uuid4(), "docx")
    assert caught.value.code == "MATERIAL_PARSE_INVALID"


def test_source_expansion_xml_part_count_and_anchor_limits_are_enforced() -> None:
    with pytest.raises(AppError) as original_error:
        parse_original(b"x" * (MAX_ORIGINAL_BYTES + 1), uuid4(), "text")
    assert original_error.value.code == "MATERIAL_PARSE_LIMIT_EXCEEDED"
    with pytest.raises(AppError) as anchor_error:
        parse_original(b"\n" * MAX_ANCHORS, uuid4(), "text")
    assert anchor_error.value.code == "MATERIAL_PARSE_LIMIT_EXCEEDED"
    oversized_xml = package(
        paragraph("正文"), extra={"customXml/large.xml": b"x" * (core.MAX_XML + 1)}
    )
    with pytest.raises(AppError):
        parse_original(oversized_xml, uuid4(), "docx")
    oversized_parts = package(
        paragraph("正文"), extra={f"custom/{index}.bin": b"x" for index in range(4094)}
    )
    with pytest.raises(AppError):
        parse_original(oversized_parts, uuid4(), "docx")
    # A malicious central-directory expanded-size claim is rejected before inflation.
    fake_expanded = bytearray(package(paragraph("正文")))
    central = fake_expanded.index(b"PK\x01\x02")
    struct.pack_into("<I", fake_expanded, central + 24, core.MAX_EXPANDED + 1)
    with pytest.raises(AppError):
        parse_original(bytes(fake_expanded), uuid4(), "docx")


def test_conflicting_counts_and_ambiguous_rules_are_not_reported_as_checkable() -> None:
    parsed = parse_original(
        "正文字数不少于12000字。正文字数不超过10000字。\n参考文献尽量丰富。".encode(),
        uuid4(),
        "txt",
    )
    assert len(parsed.requirements) == 3
    assert all(not item.checkable and not item.enabled for item in parsed.requirements)
    assert all("冲突" in item.uncertainty for item in parsed.requirements[:2])


def test_template_style_names_never_create_invented_font_sizes() -> None:
    styles = (
        '<w:style w:type="paragraph" w:styleId="12ptFake"><w:name w:val="小四 宋体"/></w:style>'
    )
    parsed = parse_original(package(paragraph("只有样式名称"), styles=styles), uuid4(), "docx")
    sizes = [item for item in parsed.template_items if item.field == "font_size"]
    assert sizes and all(item.state == "unknown" and item.value is None for item in sizes)


def test_demo_wording_and_serialized_output_budget_are_checked_without_truncation() -> None:
    parsed = parse_original("论文正文不少于8000字。".encode(), uuid4(), "text")
    assert parsed.requirements[0].scope == "正文"
    assert parsed.requirements[0].parameters == {"min": 8000}
    assert parsed.requirements[0].checkable
    # Input is below 8MiB, but text + source quote + editor projection exceeds 16MiB.
    with pytest.raises(AppError) as caught:
        parse_original(b"x" * (6 * 1024 * 1024), uuid4(), "text")
    assert caught.value.code == "MATERIAL_PARSE_LIMIT_EXCEEDED"
