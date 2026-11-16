"""Change records are read only from immutable version, command and source facts.

Candidate status is deliberately ignored: a later undo appends a later version, so a fixed
range always yields the same facts. The record documents student decisions only.
"""

import difflib
import html
from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from thesis_pilot.modules.document_sources.models import DocumentSource, DocumentSourceVersion
from thesis_pilot.modules.documents.models import DocumentVersion
from thesis_pilot.modules.documents.structure import JsonObject, children
from thesis_pilot.modules.exports.render import HTML_STYLE, md_escape
from thesis_pilot.modules.format_revisions.models import FormatCandidate, FormatCommandReceipt
from thesis_pilot.modules.materials.models import MaterialOriginal
from thesis_pilot.modules.revisions.models import (
    RevisionCandidate,
    RevisionCommand,
    RevisionProposal,
)

type Fact = dict[str, object]

STATEMENT = (
    "本说明依据系统中的正文版本与学生的采纳决定生成，"
    "只记录学生的修改与处理，不代表导师已审阅或认可。"
)
REASONS = {
    "blank": "新建空白稿",
    "local_import": "导入正文",
    "manual_edit": "手动保存",
    "ai_adoption": "采纳候选",
    "adoption_undo": "撤销采纳",
    "version_revert": "恢复历史版本",
}
DECISIONS = {
    "accepted": "采纳",
    "accept": "采纳",
    "rejected": "拒绝",
    "reject": "拒绝",
    "pending": "未决定（未写入）",
}
FORMAT_FIELDS = {
    "level": "标题层级",
    "templateAlign": "标题对齐",
    "templateWeight": "标题字重",
    "alignment": "段落对齐",
}


def _stamp(value: datetime) -> str:
    value = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return value.strftime("%Y-%m-%d %H:%M UTC")


def _block_texts(content: JsonObject) -> list[str]:
    texts: list[str] = []

    def walk(node: JsonObject) -> None:
        if node["type"] in {"paragraph", "heading", "codeBlock"}:
            parts: list[str] = []
            for child in children(node):
                parts.append(cast(str, child["text"]) if child["type"] == "text" else "\n")
            texts.append("".join(parts))
            return
        for child in children(node):
            walk(child)

    walk(content)
    return texts


def manual_change_summary(before: JsonObject | None, after: JsonObject) -> Fact:
    old = _block_texts(before) if before is not None else []
    new = _block_texts(after)
    added = removed = changed = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=old, b=new, autojunk=False).get_opcodes():
        if tag == "insert":
            added += j2 - j1
        elif tag == "delete":
            removed += i2 - i1
        elif tag == "replace":
            common = min(i2 - i1, j2 - j1)
            changed += common
            added += (j2 - j1) - common
            removed += (i2 - i1) - common
    characters = sum(len(text) for text in new) - sum(len(text) for text in old)
    return {
        "blocks_added": added,
        "blocks_removed": removed,
        "blocks_changed": changed,
        "character_delta": characters,
        "formatting_only": added == removed == changed == 0 and before != after,
    }


def _revision_detail(session: Session, candidate_id: UUID) -> Fact:
    item = session.get(RevisionCandidate, candidate_id)
    proposal = session.get(RevisionProposal, candidate_id)
    if item is None or proposal is None:
        return {"type": "revision", "candidate_id": str(candidate_id), "patches": []}
    decisions = {
        cast(str, choice["patch_id"]): cast(str, choice["decision"])
        for choice in item.decisions_json
    }
    selection = cast(JsonObject, item.input_json.get("selection") or {})
    return {
        "type": "revision",
        "candidate_id": str(item.id),
        "producer": item.producer,
        "base_version": item.base_version,
        "goal": cast(str, item.input_json.get("goal") or ""),
        "selection": cast(str, selection.get("text") or ""),
        "patches": [
            {
                "id": patch["id"],
                "before": patch["before"],
                "after": patch["after"],
                "decision": decisions.get(cast(str, patch["id"]), "pending"),
            }
            for patch in proposal.patches_json
        ],
    }


def _format_detail(session: Session, candidate_id: UUID) -> Fact:
    item = session.get(FormatCandidate, candidate_id)
    if item is None:
        return {"type": "format", "candidate_id": str(candidate_id), "patches": []}
    decisions = {
        cast(str, choice["patch_id"]): cast(str, choice["decision"])
        for choice in item.decisions_json
    }
    return {
        "type": "format",
        "candidate_id": str(item.id),
        "base_version": item.base_version,
        "patches": [
            {
                "id": patch["id"],
                "field": patch["field"],
                "before": patch.get("before"),
                "after": patch["after"],
                "evidence": patch.get("evidence") or "",
                "decision": decisions.get(cast(str, patch["id"]), "pending"),
            }
            for patch in item.patches_json
        ],
    }


def _version_fact(
    session: Session, document_id: UUID, row: DocumentVersion, previous: JsonObject | None
) -> Fact:
    fact: Fact = {
        "version": row.version,
        "source": row.source,
        "created_at": _stamp(row.created_at),
    }
    number = row.version
    if row.source == "manual_edit":
        fact["manual"] = manual_change_summary(previous, row.content_json)
    elif row.source == "local_import":
        link = session.get(DocumentSourceVersion, (document_id, number))
        source = session.get(DocumentSource, link.source_id) if link else None
        original = session.get(MaterialOriginal, source.original_version_id) if source else None
        fact["import"] = (
            {
                "filename": original.filename if original else None,
                "original_version": original.version if original else None,
                "original_sha256": source.original_sha256,
            }
            if source is not None
            else None
        )
    elif row.source == "ai_adoption":
        applied = session.scalar(
            select(RevisionCommand).where(
                RevisionCommand.document_id == document_id,
                RevisionCommand.operation == "apply",
                RevisionCommand.result_version == number,
            )
        )
        if applied is not None and applied.candidate_id is not None:
            fact["adoption"] = _revision_detail(session, applied.candidate_id)
        else:
            receipt = session.scalar(
                select(FormatCommandReceipt).where(
                    FormatCommandReceipt.document_id == document_id,
                    FormatCommandReceipt.operation == "apply",
                    FormatCommandReceipt.result_version == number,
                )
            )
            fact["adoption"] = _format_detail(session, receipt.candidate_id) if receipt else None
    elif row.source == "adoption_undo":
        undo = session.scalar(
            select(RevisionCommand).where(
                RevisionCommand.document_id == document_id,
                RevisionCommand.operation == "undo",
                RevisionCommand.result_version == number,
            )
        )
        undone: Fact | None = None
        if undo is not None and undo.reverses_command_id is not None:
            applied = session.get(RevisionCommand, (document_id, undo.reverses_command_id))
            if applied is not None:
                undone = {
                    "type": "revision",
                    "candidate_id": str(applied.candidate_id),
                    "undone_version": applied.result_version,
                    "restored_version": applied.base_version,
                }
        else:
            format_undo = session.scalar(
                select(FormatCommandReceipt).where(
                    FormatCommandReceipt.document_id == document_id,
                    FormatCommandReceipt.operation == "undo",
                    FormatCommandReceipt.result_version == number,
                )
            )
            if format_undo is not None and format_undo.reverses_command_id is not None:
                applied_format = session.get(
                    FormatCommandReceipt, (document_id, format_undo.reverses_command_id)
                )
                if applied_format is not None:
                    undone = {
                        "type": "format",
                        "candidate_id": str(applied_format.candidate_id),
                        "undone_version": applied_format.result_version,
                        "restored_version": applied_format.base_version,
                    }
        fact["undo"] = undone
    elif row.source == "version_revert":
        revert = session.scalar(
            select(RevisionCommand).where(
                RevisionCommand.document_id == document_id,
                RevisionCommand.operation == "revert",
                RevisionCommand.result_version == number,
            )
        )
        body = cast(JsonObject, revert.request_json.get("body") or {}) if revert else {}
        target = body.get("target_version")
        fact["restore"] = {"target_version": target if isinstance(target, int) else None}
    return fact


def collect_change_facts(
    session: Session, document_id: UUID, from_version: int, to_version: int
) -> Fact:
    rows = list(
        session.scalars(
            select(DocumentVersion)
            .where(
                DocumentVersion.document_id == document_id,
                DocumentVersion.version >= max(1, from_version - 1),
                DocumentVersion.version <= to_version,
            )
            .order_by(DocumentVersion.version)
        )
    )
    contents = {row.version: row.content_json for row in rows}
    versions = [
        _version_fact(session, document_id, row, contents.get(row.version - 1))
        for row in rows
        if row.version >= from_version
    ]
    return {
        "document_id": str(document_id),
        "from_version": from_version,
        "to_version": to_version,
        "versions": versions,
    }


# Rendering --------------------------------------------------------------------------------------


def _clip(value: object, limit: int = 600) -> str:
    text = value if isinstance(value, str) else "" if value is None else str(value)
    return text if len(text) <= limit else text[:limit] + "…"


def _reason(fact: Fact) -> str:
    if fact["source"] == "ai_adoption":
        adoption = cast(Fact | None, fact.get("adoption"))
        if adoption and adoption["type"] == "format":
            return "采纳格式候选"
        return "采纳修订候选"
    return REASONS.get(cast(str, fact["source"]), cast(str, fact["source"]))


def _lines(fact: Fact) -> list[tuple[str, str]]:
    """(label, text) pairs, shared by both formats so they never disagree."""
    lines: list[tuple[str, str]] = []
    source = fact["source"]
    if source == "manual_edit":
        manual = cast(Fact, fact["manual"])
        if manual["formatting_only"]:
            lines.append(("变化", "仅结构或格式调整，文字未变"))
        else:
            delta = cast(int, manual["character_delta"])
            lines.append(
                (
                    "变化",
                    f"新增 {manual['blocks_added']} 段、删除 {manual['blocks_removed']} 段、"
                    f"修改 {manual['blocks_changed']} 段，字数 {'+' if delta >= 0 else ''}{delta}",
                )
            )
    elif source == "local_import":
        imported = cast(Fact | None, fact.get("import"))
        if imported:
            name = imported.get("filename") or "原件"
            lines.append(("来源", f"{name}（原件 v{imported.get('original_version') or '?'}）"))
            lines.append(("原件摘要", cast(str, imported["original_sha256"])[:16]))
        else:
            lines.append(("来源", "直接导入的正文内容"))
    elif source == "blank":
        lines.append(("变化", "从空白稿开始"))
    elif source == "version_revert":
        target = cast(Fact, fact["restore"]).get("target_version")
        lines.append(("恢复到", f"v{target}" if target else "历史版本（目标未记录）"))
    elif source == "adoption_undo":
        undone = cast(Fact | None, fact.get("undo"))
        if undone:
            kind = "格式候选" if undone["type"] == "format" else "修订候选"
            lines.append(
                (
                    "撤销",
                    f"v{undone['undone_version']} 的{kind}采纳，"
                    f"内容回到 v{undone['restored_version']}",
                )
            )
        else:
            lines.append(("撤销", "采纳记录未找到"))
    elif source == "ai_adoption":
        adoption = cast(Fact | None, fact.get("adoption"))
        if not adoption:
            lines.append(("采纳", "候选记录未找到"))
        elif adoption["type"] == "revision":
            lines.append(("修订目标", _clip(adoption.get("goal"))))
            lines.append(("基于版本", f"v{adoption.get('base_version')}"))
        else:
            lines.append(("基于版本", f"v{adoption.get('base_version')}"))
    return lines


def _patch_rows(fact: Fact) -> list[tuple[str, str, str]]:
    adoption = cast(Fact | None, fact.get("adoption"))
    if not adoption:
        return []
    rows: list[tuple[str, str, str]] = []
    for patch in cast(list[Fact], adoption["patches"]):
        decision = DECISIONS.get(cast(str, patch["decision"]), cast(str, patch["decision"]))
        if adoption["type"] == "format":
            field = FORMAT_FIELDS.get(cast(str, patch["field"]), cast(str, patch["field"]))
            before = "默认" if patch["before"] is None else str(patch["before"])
            rows.append(
                (
                    decision,
                    f"{field}：{before}",
                    f"{patch['after']}（依据：{_clip(patch['evidence'], 200)}）",
                )
            )
        else:
            rows.append((decision, _clip(patch["before"]), _clip(patch["after"]) or "（删除）"))
    return rows


def _summary(facts: Fact) -> list[str]:
    counts: dict[str, int] = {}
    for fact in cast(list[Fact], facts["versions"]):
        label = _reason(fact)
        counts[label] = counts.get(label, 0) + 1
    return [f"{label} {count} 次" for label, count in counts.items()]


def render_change_record(facts: Fact, format: str) -> str:
    title = f"修改说明 · 正文 v{facts['from_version']}–v{facts['to_version']}"
    versions = cast(list[Fact], facts["versions"])
    if format == "markdown":
        out = [f"# {title}", "", f"> {STATEMENT}", "", "概览：" + "；".join(_summary(facts)), ""]
        for fact in versions:
            out.append(f"## v{fact['version']} · {_reason(fact)} · {fact['created_at']}")
            out.append("")
            out.extend(f"- {label}：{md_escape(text)}" for label, text in _lines(fact))
            rows = _patch_rows(fact)
            if rows:
                out.append("")
                out.append("| 决定 | 修改前 | 修改后 |")
                out.append("| --- | --- | --- |")
                for decision, before, after in rows:
                    cells = [
                        md_escape(value).replace("\n", "<br>")
                        for value in (decision, before, after)
                    ]
                    out.append("| " + " | ".join(cells) + " |")
            out.append("")
        return "\n".join(out).rstrip("\n") + "\n"
    body: list[str] = [
        f"<h1>{html.escape(title, quote=False)}</h1>",
        f'<p class="tp-export-meta">{html.escape(STATEMENT, quote=False)}</p>',
        f"<p>概览：{html.escape('；'.join(_summary(facts)), quote=False)}</p>",
    ]
    for fact in versions:
        heading = f"v{fact['version']} · {_reason(fact)} · {fact['created_at']}"
        body.append(f'<section id="v{fact["version"]}">')
        body.append(f"<h2>{html.escape(heading, quote=False)}</h2>")
        details = "".join(
            f"<dt>{html.escape(label, quote=False)}</dt><dd>{html.escape(text, quote=False)}</dd>"
            for label, text in _lines(fact)
        )
        if details:
            body.append(f"<dl>{details}</dl>")
        rows = _patch_rows(fact)
        if rows:
            body.append(
                "<table><thead><tr><th>决定</th><th>修改前</th><th>修改后</th></tr></thead><tbody>"
            )
            body.extend(
                "<tr>"
                + "".join(
                    f"<td>{html.escape(value, quote=False).replace(chr(10), '<br>')}</td>"
                    for value in row
                )
                + "</tr>"
                for row in rows
            )
            body.append("</tbody></table>")
        body.append("</section>")
    return (
        '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        f"<title>{html.escape(title, quote=False)}</title>\n<style>{HTML_STYLE}"
        "dl{display:grid;grid-template-columns:max-content 1fr;gap:.2em 1em}dd{margin:0}</style>\n"
        "</head>\n<body>\n" + "\n".join(body) + "\n</body>\n</html>\n"
    )
