"""Synthetic OOXML only. School document fixtures are never generated here."""

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from xml.etree import ElementTree
from zipfile import ZipFile

ADAPTER = Path(__file__).resolve().parents[1] / "docx_roundtrip.py"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PR = "http://schemas.openxmlformats.org/package/2006/relationships"


def paragraph(text, properties=""):
    return f"<w:p>{properties}<w:r><w:t>{text}</w:t></w:r></w:p>"


def fixture(path):
    def row(left, right):
        return f"<w:tr><w:tc>{paragraph(left)}</w:tc><w:tc>{paragraph(right)}</w:tc></w:tr>"

    body = (
        paragraph("第一章 验证方法", '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>')
        + paragraph("用于验证的普通段落，编号 12")
        + paragraph("样例表格与引用", '<w:pPr><w:pStyle w:val="CustomHeading"/></w:pPr>')
        + '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="3600"/></w:tblGrid>'
        + row("名称", "说明")
        + row("样例", "文本")
        + "</w:tbl>"
        + '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="3600"/></w:tblGrid>'
        + '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>'
        + paragraph("合并单元格样例")
        + "</w:tc></w:tr></w:tbl>"
        + "<w:p><m:oMath><m:r><m:t>x²</m:t></m:r></m:oMath></w:p>"
        + paragraph("正文引用 [1]。")
        + '<w:p><w:fldSimple w:instr=" CITATION Synthetic "><w:r><w:t>[2]</w:t></w:r></w:fldSimple></w:p>'
        + paragraph("参考文献", '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>')
        + paragraph("[1] 自制参考条目。")
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" '
        'w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    )
    parts = {
        "[Content_Types].xml": (
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
        ),
        "_rels/.rels": f'<Relationships xmlns="{PR}"><Relationship Id="rId1" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        "word/_rels/document.xml.rels": f'<Relationships xmlns="{PR}"><Relationship Id="rId1" Type="{R}/styles" Target="styles.xml"/></Relationships>',
        "word/styles.xml": (
            f'<w:styles xmlns:w="{W}"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
            '<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
            '<w:style w:type="paragraph" w:styleId="BaseHeading"><w:name w:val="base heading"/>'
            '<w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>'
            '<w:style w:type="paragraph" w:styleId="CustomHeading"><w:name w:val="custom heading"/>'
            '<w:basedOn w:val="BaseHeading"/></w:style></w:styles>'
        ),
        "word/document.xml": f'<w:document xmlns:w="{W}" xmlns:m="{M}"><w:body>{body}</w:body></w:document>',
    }
    with ZipFile(path, "x") as archive:
        for name, data in parts.items():
            archive.writestr(name, data)


def block_at(document, path):
    for index in path:
        document = document["content"][index]
    return document


class RoundtripTest(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.source = self.root / "synthetic.docx"
        self.session = self.root / "session.json"
        self.output = self.root / "out.docx"
        fixture(self.source)
        self.original = self.source.read_bytes()
        result = self.run_adapter("import", self.source, self.session)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.projection = json.loads(self.session.read_text(encoding="utf-8"))

    def run_adapter(self, *args):
        return subprocess.run(
            [sys.executable, "-X", "utf8", str(ADAPTER), *map(str, args)],
            check=False,
            capture_output=True,
            encoding="utf-8",
        )

    def save(self):
        self.session.write_text(json.dumps(self.projection, ensure_ascii=False), encoding="utf-8")

    def test_editable_heading_paragraph_and_table_roundtrip(self):
        document = self.projection["document"]
        self.assertEqual(
            [node["attrs"]["level"] for node in document["content"] if node["type"] == "heading"], [1, 2, 1]
        )
        self.assertIn({"kind": "complex_table", "mode": "locked", "count": 1}, self.projection["objects"])
        self.assertEqual(
            {
                block_at(document, path)["type"] if len(path) == 1 else "table"
                for path in self.projection["editable_paths"]
            },
            {"heading", "paragraph", "table"},
        )
        for path in self.projection["editable_paths"]:
            block_at(document, path)["content"][0]["text"] += "校验"
        self.save()
        result = self.run_adapter("export", self.source, self.session, self.output)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.source.read_bytes(), self.original)
        with ZipFile(self.source) as original, ZipFile(self.output) as exported:
            self.assertEqual(original.namelist(), exported.namelist())
            for name in original.namelist():
                if name != "word/document.xml":
                    self.assertEqual(original.read(name), exported.read(name), name)
            source = ElementTree.fromstring(original.read("word/document.xml"))
            output = ElementTree.fromstring(exported.read("word/document.xml"))
            for tag in (f"{{{M}}}oMath", f"{{{W}}}fldSimple", f"{{{W}}}gridSpan"):
                self.assertEqual(
                    ElementTree.tostring(source.find(f".//{tag}")),
                    ElementTree.tostring(output.find(f".//{tag}")),
                )
            self.assertIn("正文引用 [1]。", [item.text for item in output.iter(f"{{{W}}}t")])
            self.assertIn("名称校验", [item.text for item in output.iter(f"{{{W}}}t")])

    def test_protected_marker_and_base_hash_are_enforced(self):
        document = self.projection["document"]
        editable = {path[0] for path in self.projection["editable_paths"] if len(path) == 1}
        locked = next(
            node
            for index, node in enumerate(document["content"])
            if index not in editable and node["type"] == "paragraph"
        )
        text = locked["content"][0]
        original = text["text"]
        text["text"] += "试图改写"
        self.save()
        self.assertNotEqual(self.run_adapter("export", self.source, self.session, self.output).returncode, 0)
        self.assertFalse(self.output.exists())
        text["text"] = original
        self.projection["source_sha256"] = "0" * 64
        self.save()
        self.assertNotEqual(self.run_adapter("export", self.source, self.session, self.output).returncode, 0)
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertFalse(self.output.exists())

    def test_reject_number_changes_in_editable_text(self):
        document = self.projection["document"]
        editable = [block_at(document, path) for path in self.projection["editable_paths"]]
        target = next(node for node in editable if "编号 12" in node["content"][0]["text"])
        target["content"][0]["text"] = "用于验证的普通段落，编号 13"
        self.save()
        self.assertNotEqual(self.run_adapter("export", self.source, self.session, self.output).returncode, 0)
        self.assertFalse(self.output.exists())

    def test_refuse_to_overwrite_original(self):
        result = self.run_adapter("export", self.source, self.session, self.source)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.source.read_bytes(), self.original)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--fixture":
        fixture(Path(sys.argv[2]))
    else:
        unittest.main()
