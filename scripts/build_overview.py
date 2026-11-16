"""Assemble the standalone competition site in deliverables/overview."""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from build_evidence_showcase import refresh

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "apps/overview"
OUTPUT = ROOT / "deliverables/overview"


def build_archive() -> None:
    template = subprocess.check_output(["git", "show", "HEAD:docs/evidence/showcase.html"], cwd=ROOT)
    page = refresh(template.decode("utf-8"))
    page = page.replace("</head>", '<link rel="stylesheet" href="/overview/archive.css"></head>', 1)
    page = page.replace('class="brand" href="#top"', 'class="brand" href="/overview" aria-label="返回参赛作品首页"', 1)
    page = re.sub(r'(<img id="notebook-illustration" src=")[^"]+', r'\g<1>/overview/thesis-goose.webp', page, count=1)
    old = 'return link(title, "../../" + path);'
    if old not in page:
        raise ValueError("开发档案的记录链接结构已变化，请更新交付映射")
    page = page.replace(old, 'return link(title, "/overview/records/" + path);', 1)
    history_file = ROOT / "docs/evidence/chat-history.json"
    history = json.loads(history_file.read_text(encoding="utf-8"))
    documents = {s["document"] for c in history["prompt_chains"] for s in c.get("evidence", []) if s.get("document")}
    documents.update(p for agent in history["agents"] for p in agent.get("related_artifacts", []))
    for name in sorted(documents):
        document = (ROOT / name).resolve(strict=True)
        if document.suffix != ".md" or not any(document.is_relative_to(ROOT / p) for p in ("docs/design", "docs/evidence/sessions")):
            raise ValueError(f"未知的档案附件范围：{name}")
        destination = OUTPUT / "records" / document.relative_to(ROOT)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(document, destination)
    shutil.copyfile(history_file, OUTPUT / "chat-history.json")
    (OUTPUT / "archive.html").write_text(page, encoding="utf-8")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name in ("index.html", "install.html", "work.html", "guide.html", "guide.pdf",
                 "theme.css", "overview.css", "archive.css", "overview.js", "thesis-goose.webp"):
        shutil.copyfile(SOURCE / name, OUTPUT / name)
    build_archive()
    subprocess.run([sys.executable, str(ROOT / "scripts/package_overview_source.py"), "--output", str(OUTPUT / "source.zip")], check=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
