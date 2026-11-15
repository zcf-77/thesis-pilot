"""Create reproducible synthetic upload inputs without reading user documents."""

import argparse
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

REQUIREMENTS = (
    "第一章 绪论\n论文正文不少于8000字。\n参考文献不少于15篇。\n"
    "以上为自制演示要求，不代表学校真实规范。\n"
)
PARTS = {
    "[Content_Types].xml": (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" '
        'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        "</Types>"
    ),
    "_rels/.rels": (
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/></Relationships>'
    ),
    "word/_rels/document.xml.rels": (
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/></Relationships>'
    ),
    "word/styles.xml": (
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
        '<w:name w:val="Normal"/></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
        '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
        "</w:styles>"
    ),
    "word/document.xml": (
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>'
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 绪论</w:t></w:r></w:p>'
        "<w:p><w:r><w:t>本文件为自制校园图书检索系统演示稿，不含真实用户资料。</w:t></w:r></w:p>"
        "<w:p><w:r><w:t>论文正文不少于8000字。</w:t></w:r></w:p>"
        "<w:p><w:r><w:t>参考文献不少于15篇。</w:t></w:r></w:p>"
        "<w:p><m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath></w:p>"
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
        "</w:body></w:document>"
    ),
}


def synthetic_docx() -> bytes:
    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name, content in PARTS.items():
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, content.encode("utf-8"))
    return output.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for name, data in {
        "synthetic-requirements.txt": REQUIREMENTS.encode("utf-8"),
        "synthetic-manuscript.docx": synthetic_docx(),
    }.items():
        target = args.output / name
        if target.exists():
            if target.read_bytes() != data:
                raise SystemExit(f"Refusing to replace different existing fixture: {target}")
        else:
            with target.open("xb") as handle:
                handle.write(data)
        print(f"Synthetic fixture: {target} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
