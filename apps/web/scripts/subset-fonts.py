#!/usr/bin/env python3
"""
展示字体子集化：扫描源码中实际出现的字符，仅保留这些字形并输出 woff2。

为什么需要：思源宋体 / 得意黑 / 霞鹜文楷的完整字库各有数 MB 到数十 MB，
设计展台只需要源码里出现过的字。正式应用接入时改为按 unicode-range 切片的完整 Web 字体
（见 docs/design/DESIGN-SPEC.md「字体」一节），本脚本与产物可以整体移除。

用法：python3 scripts/subset-fonts.py [--src /path/to/font-sources]
依赖：fonttools、brotli
字体来源与许可：见 licenses/fonts/README.md
"""
import argparse
import pathlib
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "design" / "fonts"
SCAN_DIRS = [ROOT / "src", ROOT / "docs", ROOT / "index.html"]
SCAN_EXT = {".vue", ".ts", ".md", ".html", ".css"}
# 始终保留：ASCII、常用中文标点、数字符号
ALWAYS = "".join(chr(c) for c in range(0x20, 0x7F)) + "，。、；：？！“”‘’（）《》〈〉【】—…·￥％～「」『』〔〕＋－×÷≥≤≠≈→←↑↓✓✕★☆●○◆◇■□▲△※№①②③④⑤⑥⑦⑧⑨⑩"


def collect_chars() -> str:
    chars = set(ALWAYS)
    for entry in SCAN_DIRS:
        files = [entry] if entry.is_file() else [p for p in entry.rglob("*") if p.suffix in SCAN_EXT and "generated" not in p.parts]
        for f in files:
            try:
                chars.update(f.read_text(encoding="utf-8"))
            except (UnicodeDecodeError, OSError):
                pass
    return "".join(sorted(c for c in chars if c >= " "))


def build(src: pathlib.Path, dest: str, text: str, font_number: int = -1) -> None:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["kern", "liga", "locl", "palt", "vert"]
    options.name_IDs = [1, 2, 3, 4, 6]
    options.notdef_outline = True
    options.desubroutinize = True
    options.hinting = False
    if font_number >= 0:
        options.font_number = font_number
    font = subset.load_font(str(src), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / dest
    subset.save_font(font, str(target), options)
    cmap = TTFont(str(target)).getBestCmap()
    print(f"  {dest:38s} {target.stat().st_size / 1024:7.1f} KB  {len(cmap)} glyphs")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(ROOT.parent / "fonts-src"), help="字体源文件目录")
    ap.add_argument("--noto", default="/usr/share/fonts/opentype/noto", help="Noto Serif CJK .ttc 所在目录")
    args = ap.parse_args()
    src = pathlib.Path(args.src)
    noto = pathlib.Path(args.noto)
    text = collect_chars()
    print(f"扫描到 {len(text)} 个不同字符")
    jobs = [
        (noto / "NotoSerifCJK-Regular.ttc", "noto-serif-sc-400.subset.woff2", 2),
        (noto / "NotoSerifCJK-SemiBold.ttc", "noto-serif-sc-600.subset.woff2", 2),
        (noto / "NotoSerifCJK-Black.ttc", "noto-serif-sc-900.subset.woff2", 2),
        (src / "smiley" / "SmileySans-Oblique.ttf", "smiley-sans-oblique.subset.woff2", -1),
        (src / "LXGWWenKai-Medium.ttf", "lxgw-wenkai-500.subset.woff2", -1),
    ]
    missing = [str(j[0]) for j in jobs if not j[0].exists()]
    if missing:
        print("缺少字体源文件：\n  " + "\n  ".join(missing), file=sys.stderr)
        return 1
    for path, dest, number in jobs:
        build(path, dest, text, number)
    return 0


if __name__ == "__main__":
    sys.exit(main())
