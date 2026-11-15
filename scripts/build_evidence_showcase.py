"""Refresh the embedded archive and theme in the offline evidence page."""

import argparse
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs/evidence"
PAGE = EVIDENCE / "showcase.html"
THEMES = ROOT / "apps/web/src/design/styles/generated/themes.css"
THEME_BLOCK = re.compile(r"/\* BEGIN THEME \*/.*?/\* END THEME \*/", re.DOTALL)
ARCHIVE_BLOCK = re.compile(r'(<script type="application/json" id="archive-data">)\s*.*?(</script>)', re.DOTALL)
HTML_ESCAPES = str.maketrans({"<": r"\u003c", ">": r"\u003e", "&": r"\u0026"})


def refresh(page):
    history = json.loads((EVIDENCE / "chat-history.json").read_text(encoding="utf-8"))
    data = json.dumps(history, ensure_ascii=False, separators=(",", ":")).translate(HTML_ESCAPES)
    source = THEMES.read_text(encoding="utf-8")
    theme = re.search(r'(?m)^\[data-theme="yingguang"\] \{[\s\S]*?^\}', source)
    if theme is None:
        raise ValueError("找不到荧光笔记主题")
    theme_css = "\n".join("    " + line for line in theme[0].splitlines())
    page, themes = THEME_BLOCK.subn(lambda _: f"/* BEGIN THEME */\n{theme_css}\n    /* END THEME */", page)
    page, archives = ARCHIVE_BLOCK.subn(lambda match: f"{match[1]}\n{data}\n  {match[2]}", page)
    if themes != 1 or archives != 1:
        raise ValueError("展示页需有一处主题和一处档案数据")
    return page


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="核对页面是否与当前数据和主题一致")
    args = parser.parse_args()
    current = PAGE.read_text(encoding="utf-8")
    updated = refresh(current)
    if args.check and updated != current:
        print("FAIL: 展示页与聊天档案或主题不一致。", file=sys.stderr)
        return 1
    if not args.check and updated != current:
        temporary = PAGE.with_suffix(".html.tmp")
        temporary.write_text(updated, encoding="utf-8", newline="\n")
        temporary.replace(PAGE)
    print("PASS: 展示页与聊天档案及荧光笔记主题一致。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
