"""Generate independent synthetic SG-19 source fixtures, never real manuscript data."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def create(output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "format-rules.txt").write_text(
        "标题层级：2\n标题对齐：居中\n标题字重：700\n段落对齐：两端对齐\n", encoding="utf-8"
    )
    namespaces = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    body = (
        '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>合成演示章节</w:t></w:r></w:p>'
        "<w:p><w:r><w:t>本演示使用合成论文，样本数量为1200，引用保持[1]，只审阅格式属性。</w:t></w:r></w:p>"
        "<w:p><w:r><w:t>第二段保留原文和顺序，用于逐项拒绝与撤销演示。</w:t></w:r></w:p>"
    )
    with ZipFile(output / "format-manuscript.docx", "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Override PartName="/word/document.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.'
            'wordprocessingml.document.main+xml"/></Types>',
        )
        archive.writestr(
            "_rels/.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/'
            'officeDocument/2006/relationships/officeDocument" '
            'Target="word/document.xml"/></Relationships>',
        )
        archive.writestr(
            "word/document.xml", f"<w:document {namespaces}><w:body>{body}</w:body></w:document>"
        )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    create(parser.parse_args().output)
