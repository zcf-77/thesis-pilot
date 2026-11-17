"""Synthetic thesis DOCX for office-server tests (self-made, contains no user content).

Heading/title styles, body paragraphs, a 2×2 table, an embedded PNG figure, an OMML
formula (the importer drops it, so it becomes a whole-block object protection) and a
references section. Deterministic bytes: fixed ZIP timestamps.
"""

import struct
import sys
import zlib
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _png() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"\x00\x2a\x6f\x9c"))
        + chunk(b"IEND", b"")
    )


def _p(text: str, style: str | None = None) -> str:
    props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f'<w:p>{props}<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'


_IMAGE = (
    "<w:p><w:r><w:drawing>"
    '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
    '<wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="图1" descr="系统示意图"/>'
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    '<pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>'
    '<pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm>'
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"
)

_TABLE = (
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
    '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>'
    f"<w:tr><w:tc>{_p('指标')}</w:tc><w:tc>{_p('数值')}</w:tc></w:tr>"
    f"<w:tr><w:tc>{_p('平均响应时间')}</w:tc><w:tc>{_p('120 毫秒')}</w:tc></w:tr>"
    "</w:tbl>"
)

_FORMULA = (
    '<w:p><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
    "<m:r><m:t>T=n/q</m:t></m:r></m:oMath></w:p>"
)

BODY_TEXTS = {
    "title": "校园图书检索系统设计与实现",
    "intro": "本文以自制的校园图书检索系统为例，说明系统的设计过程。",
    "background": "高校图书馆馆藏持续增长，读者检索效率有待提升。",
    "design": "系统采用前后端分离架构，检索服务独立部署。",
}


def synthetic_thesis_docx() -> bytes:
    body = "".join(
        [
            _p(BODY_TEXTS["title"], "Title"),
            _p("第一章 绪论", "Heading1"),
            _p(BODY_TEXTS["intro"]),
            _p("研究背景", "Heading2"),
            _p(BODY_TEXTS["background"]),
            _TABLE,
            _IMAGE,
            _p("图 1 系统示意图"),
            _FORMULA,
            _p("第二章 系统设计", "Heading1"),
            _p(BODY_TEXTS["design"]),
            _p("参考文献", "Heading1"),
            _p("[1] 示例作者. 信息检索导论[M]. 北京: 示例出版社, 2020."),
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
        ]
    )
    styles = (
        f'<w:styles xmlns:w="{W}">'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>'
        "</w:style>"
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>'
        '<w:basedOn w:val="Normal"/></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
        '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>'
        '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>'
        "</w:styles>"
    )
    parts = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" '
            'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Default Extension="png" ContentType="image/png"/>'
            '<Override PartName="/word/document.xml" ContentType="application/'
            'vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/'
            'vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            "</Types>"
        ),
        "_rels/.rels": (
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/'
            '2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
        ),
        "word/_rels/document.xml.rels": (
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/'
            '2006/relationships/styles" Target="styles.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/'
            '2006/relationships/image" Target="media/image1.png"/></Relationships>'
        ),
        "word/styles.xml": styles,
        "word/document.xml": f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}'
        "</w:body></w:document>",
    }
    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name, content in parts.items():
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, content.encode("utf-8"))
        info = ZipInfo("word/media/image1.png", date_time=(1980, 1, 1, 0, 0, 0))
        archive.writestr(info, _png())
    return output.getvalue()


if __name__ == "__main__":
    with open(sys.argv[1], "wb") as handle:
        handle.write(synthetic_thesis_docx())
