"""标准库仓库文档检查；不证明产品实现或参赛材料完成。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parent.parent
REQUIRED = (
    "README.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    ".gitignore",
    ".gitattributes",
    "docs/product/proposal.md",
    "docs/product/acceptance.md",
    "docs/competition/requirements.md",
    "docs/competition/sources/README.md",
    "docs/engineering/architecture.md",
    "docs/engineering/roadmap.md",
    "docs/engineering/solo-ai-development.md",
    "docs/evidence/README.md",
    "docs/evidence/templates/task.md",
    "docs/evidence/templates/session.md",
    "docs/evidence/templates/prompt-chain.md",
    "docs/evidence/sessions/2026-11-02-initialization.md",
)


def validate(root: Path) -> tuple[list[str], dict[str, int]]:
    errors: list[str] = []
    stats = {"documents": 0, "links": 0, "snapshots": 0}
    for relative in REQUIRED:
        if not (root / relative).is_file():
            errors.append(f"缺少必要文件: {relative}")

    documents = [root / p for p in ("README.md", "AGENTS.md", "CONTRIBUTING.md")]
    documents += sorted((root / "docs").rglob("*.md"))
    contents: dict[str, str] = {}
    for path in documents:
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        # 本地私人原件不属于公共仓库文档检查范围。
        if "private" in path.relative_to(root).parts:
            continue
        try:
            content = path.read_text(encoding="utf-8-sig")
        except UnicodeError as exc:
            errors.append(f"不是可读 UTF-8: {relative}: {exc}")
            continue
        contents[relative] = content
        stats["documents"] += 1
        without_code = re.sub(r"```.*?```", "", content, flags=re.S)
        for target in re.findall(r"(?<!!)\[[^\]]+\]\(([^)]+)\)", without_code):
            target = target.strip().strip("<>")
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            destination = (path.parent / unquote(parsed.path)).resolve()
            stats["links"] += 1
            if not destination.is_relative_to(root.resolve()):
                errors.append(f"内部链接越出仓库: {relative} -> {target}")
            elif not destination.exists():
                errors.append(f"内部链接目标缺失: {relative} -> {target}")

    for relative, prefix, count in (
        ("docs/competition/requirements.md", "REQ", 12),
        ("docs/product/acceptance.md", "AC", 12),
    ):
        body = contents.get(relative, "")
        ids = re.findall(rf"^\|\s*({prefix}-\d{{3}})\s*\|", body, re.M)
        expected = {f"{prefix}-{i:03d}" for i in range(1, count + 1)}
        if set(ids) != expected or len(ids) != count:
            errors.append(f"{relative}: {prefix} 编号缺失、重复或意外改变，请同步检查与要求")

    proposal = contents.get("docs/product/proposal.md", "")
    ac_refs = set(re.findall(r"AC-\d{3}", proposal))
    if ac_refs != {f"AC-{i:03d}" for i in range(1, 13)}:
        errors.append("产品方案必须映射当前全部 12 项验收，不能遗漏或引用不存在编号")

    source_dir = root / "docs/competition/sources"
    manifest = contents.get("docs/competition/sources/README.md", "")
    entries = re.findall(r"^([0-9A-Fa-f]{64})\s+(\S+\.json)\s*$", manifest, re.M)
    if len(entries) < 2:
        errors.append("官方快照 SHA-256 清单缺失")
    expected_source_ids = {"2026-11-02-track-10039.json": 10039,
                           "2026-11-02-notice-10091.json": 10091}
    listed = {name for _, name in entries}
    if not expected_source_ids.keys() <= listed:
        errors.append("首次官方赛道/通知快照缺失于校验清单")
    for expected_hash, name in entries:
        path = (source_dir / name).resolve()
        if not path.is_relative_to(source_dir.resolve()) or not path.is_file():
            errors.append(f"快照路径无效: {name}")
            continue
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest().lower() != expected_hash.lower():
            errors.append(f"官方快照哈希不匹配: {name}")
        try:
            payload = json.loads(raw.decode("utf-8-sig"))
            if payload.get("code") != 200 or payload.get("success") is not True:
                errors.append(f"快照不是成功响应: {name}")
            if name in expected_source_ids and payload.get("data", {}).get("id") != expected_source_ids[name]:
                errors.append(f"快照内容 ID 不符: {name}")
            if "track-10039" in name and payload.get("data", {}).get("formType") != 1:
                errors.append(f"赛道个人赛标识发生变化: {name}")
        except (UnicodeError, json.JSONDecodeError, AttributeError) as exc:
            errors.append(f"快照解析失败: {name}: {exc}")
        stats["snapshots"] += 1
    return errors, stats


def main() -> int:
    errors, stats = validate(ROOT)
    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1
    print(f"PASS: {stats['documents']} documents; {stats['links']} local file links; "
          f"12 requirements; 12 acceptance scenarios; {stats['snapshots']} source snapshots and hashes.")
    print("Scope: repository documentation only; application, full Prompt chains and contest submission NOT verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
