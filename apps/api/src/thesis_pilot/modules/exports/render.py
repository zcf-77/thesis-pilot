"""Deterministic renderers for the frozen editor contract. Same input, same bytes.

Locked text (``aiLock``) and DOCX object placeholders are emitted verbatim; HTML also
marks them. Nothing is dropped or synthesized, and no timestamp enters a document.
"""

import html
import re
from collections.abc import Callable
from typing import cast

from thesis_pilot.modules.documents.structure import (
    JsonObject,
    canonical_editor_json,
    children,
    node_attrs,
)

HTML_STYLE = (
    "body{max-width:46em;margin:3em auto;padding:0 1.25em;font:17px/1.85 serif;color:#1c1b19}"
    "h1,h2,h3,h4,h5,h6{line-height:1.4;margin:1.6em 0 .6em}"
    "table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid #888;padding:.35em .6em;"
    "vertical-align:top}th{background:#f1efe9}pre{background:#f4f2ee;padding:.8em;overflow:auto}"
    "blockquote{margin:1em 0;padding-left:1em;border-left:3px solid #bbb}"
    ".tp-locked{background:#f3ead2;border-bottom:1px dashed #9a7b2c}"
    ".tp-export-meta{color:#666;font-size:.85em;border-bottom:1px solid #ddd;padding-bottom:.6em}"
)


class RenderStats:
    def __init__(self) -> None:
        self.locked = 0
        self.headings = 0
        self.tables = 0


def _text(node: JsonObject) -> str:
    if node["type"] == "text":
        return cast(str, node["text"])
    if node["type"] == "hardBreak":
        return "\n"
    return "".join(_text(child) for child in children(node))


def _marks(node: JsonObject) -> list[JsonObject]:
    return cast(list[JsonObject], node.get("marks", []))


def _is_locked(node: JsonObject) -> bool:
    return any(mark["type"] == "aiLock" for mark in _marks(node))


def document_title(content: JsonObject) -> str:
    for node in children(content):
        if node["type"] == "heading":
            title = " ".join(_text(node).split())
            if title:
                return title[:120]
    return "论文正文"


def _count_locked(content: JsonObject, stats: RenderStats) -> None:
    previous = False
    stack = [content]
    while stack:
        node = stack.pop()
        if node["type"] == "heading":
            stats.headings += 1
        if node["type"] == "table":
            stats.tables += 1
        if node["type"] in {"paragraph", "heading"}:
            previous = False
            for child in children(node):
                locked = child["type"] == "text" and _is_locked(child)
                if locked and not previous:
                    stats.locked += 1
                previous = locked
        else:
            stack.extend(reversed(children(node)))


# HTML -------------------------------------------------------------------------------------------


def _html_inline(node: JsonObject) -> str:
    if node["type"] == "hardBreak":
        return "<br>"
    value = html.escape(cast(str, node["text"]), quote=False)
    for mark in reversed(_marks(node)):
        kind = cast(str, mark["type"])
        if kind == "link":
            href = html.escape(cast(str, cast(JsonObject, mark["attrs"])["href"]))
            value = f'<a href="{href}" rel="noopener noreferrer nofollow">{value}</a>'
        elif kind == "aiLock":
            value = f'<span class="tp-locked" data-locked="true" title="锁定内容">{value}</span>'
        else:
            tag = {"bold": "strong", "italic": "em", "strike": "s", "underline": "u"}.get(
                kind, "code"
            )
            value = f"<{tag}>{value}</{tag}>"
    return value


def _align_style(value: object) -> str:
    return f' style="text-align:{value}"' if isinstance(value, str) else ""


def _html_block(node: JsonObject) -> str:
    kind = node["type"]
    attrs = node_attrs(node)
    inner = "".join(_html_block(child) for child in children(node))
    if kind in {"paragraph", "heading"}:
        inline = "".join(_html_inline(child) for child in children(node))
        if kind == "paragraph":
            return f"<p{_align_style(attrs.get('alignment'))}>{inline}</p>\n"
        level = cast(int, attrs["level"])
        chapter = attrs.get("chapterId")
        identity = f' id="ch-{html.escape(chapter)}"' if isinstance(chapter, str) else ""
        return (
            f"<h{level}{identity}{_align_style(attrs.get('templateAlign'))}>{inline}</h{level}>\n"
        )
    if kind == "blockquote":
        return f"<blockquote>\n{inner}</blockquote>\n"
    if kind == "bulletList":
        return f"<ul>\n{inner}</ul>\n"
    if kind == "orderedList":
        start = cast(int, attrs.get("start", 1))
        start_attr = f' start="{start}"' if start != 1 else ""
        list_type = attrs.get("type")
        type_attr = f' type="{list_type}"' if isinstance(list_type, str) else ""
        return f"<ol{start_attr}{type_attr}>\n{inner}</ol>\n"
    if kind == "listItem":
        return f"<li>{inner}</li>\n"
    if kind == "codeBlock":
        language = attrs.get("language")
        css = f' class="language-{html.escape(language)}"' if isinstance(language, str) else ""
        return f"<pre><code{css}>{html.escape(_text(node), quote=False)}</code></pre>\n"
    if kind == "horizontalRule":
        return "<hr>\n"
    if kind == "table":
        return f"<table>\n<tbody>\n{inner}</tbody>\n</table>\n"
    if kind == "tableRow":
        return f"<tr>{inner}</tr>\n"
    if kind in {"tableCell", "tableHeader"}:
        tag = "th" if kind == "tableHeader" else "td"
        blocks = children(node)
        if len(blocks) == 1 and blocks[0]["type"] == "paragraph" and not node_attrs(blocks[0]):
            inner = "".join(_html_inline(child) for child in children(blocks[0]))
        spans = "".join(
            f' {name}="{attrs[name]}"' for name in ("colspan", "rowspan") if attrs.get(name, 1) != 1
        )
        return f"<{tag}{spans}{_align_style(attrs.get('align'))}>{inner.strip()}</{tag}>"
    return inner


def _html_page(title: str, meta: str, body: str) -> str:
    return (
        '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        f"<title>{html.escape(title, quote=False)}</title>\n<style>{HTML_STYLE}</style>\n"
        f'</head>\n<body>\n<p class="tp-export-meta">{meta}</p>\n{body}</body>\n</html>\n'
    )


def render_html(content: JsonObject, version: int) -> str:
    stats = RenderStats()
    _count_locked(content, stats)
    body = "".join(_html_block(child) for child in children(content))
    meta = f"ThesisPilot 正文 v{version}"
    if stats.locked:
        meta += f" · 含 {stats.locked} 处锁定内容，已按原文保留并标注"
    return _html_page(document_title(content), html.escape(meta, quote=False), body)


# Markdown ---------------------------------------------------------------------------------------

_MD_ESCAPE = re.compile(r"([\\`*_\[\]<>~|])")
# Only sequences that would start a heading, list, rule or setext underline are escaped.
_MD_LINE_START = re.compile(
    r"^(\s*)(#{1,6}(?=\s|$)|[+-](?=\s|$)|\d+[.)](?=\s|$)|-{2,}(?=\s*$)|=+(?=\s*$))",
    re.MULTILINE,
)


def _line_start(match: re.Match[str]) -> str:
    marker = match[2]
    if marker[0].isdigit():
        # "1." is escaped as "1\." — a backslash before a digit is literal in Markdown.
        return f"{match[1]}{marker[:-1]}\\{marker[-1]}"
    return f"{match[1]}\\{marker}"


def md_escape(value: str) -> str:
    return _MD_LINE_START.sub(_line_start, _MD_ESCAPE.sub(r"\\\1", value))


def _md_inline(node: JsonObject) -> str:
    if node["type"] == "hardBreak":
        return "  \n"
    raw = cast(str, node["text"])
    marks = {mark["type"]: mark for mark in _marks(node)}
    if "code" in marks:
        fence = "`" * (max((len(run) for run in re.findall(r"`+", raw)), default=0) + 1)
        return (
            f"{fence} {raw} {fence}"
            if raw.startswith("`") or raw.endswith("`")
            else (f"{fence}{raw}{fence}")
        )
    value = md_escape(raw)
    if "underline" in marks:
        value = f"<u>{value}</u>"
    if "strike" in marks:
        value = f"~~{value}~~"
    if "italic" in marks:
        value = f"*{value}*"
    if "bold" in marks:
        value = f"**{value}**"
    if "link" in marks:
        href = cast(str, cast(JsonObject, marks["link"]["attrs"])["href"])
        value = f"[{value}](<{href.replace('>', '%3E')}>)"
    return value


def _md_inlines(node: JsonObject) -> str:
    return "".join(_md_inline(child) for child in children(node))


def _simple_table(node: JsonObject) -> bool:
    for row in children(node):
        for cell in children(row):
            attrs = node_attrs(cell)
            blocks = children(cell)
            if (
                attrs.get("colspan", 1) != 1
                or attrs.get("rowspan", 1) != 1
                or len(blocks) != 1
                or blocks[0]["type"] != "paragraph"
                or any(child["type"] == "hardBreak" for child in children(blocks[0]))
            ):
                return False
    return True


def _md_table(node: JsonObject) -> list[str]:
    if not _simple_table(node):
        # Merged or block cells cannot be expressed as a pipe table; keep the full structure.
        return _html_block(node).rstrip("\n").split("\n")
    rows = [
        [_md_inlines(children(cell)[0]) or " " for cell in children(row)] for row in children(node)
    ]
    width = max(len(row) for row in rows)
    rows = [row + [" "] * (width - len(row)) for row in rows]
    header, body = rows[0], rows[1:]
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join([" --- "] * width) + "|"]
    lines.extend("| " + " | ".join(row) + " |" for row in body)
    return lines


def _md_blocks(nodes: list[JsonObject]) -> list[str]:
    lines: list[str] = []
    for node in nodes:
        if lines:
            lines.append("")
        lines.extend(_md_block(node))
    return lines


def _md_block(node: JsonObject) -> list[str]:
    kind = node["type"]
    attrs = node_attrs(node)
    if kind == "paragraph":
        return _md_inlines(node).split("\n") or [""]
    if kind == "heading":
        text = " ".join(_md_inlines(node).replace("  \n", " ").split())
        return ["#" * cast(int, attrs["level"]) + " " + text]
    if kind == "blockquote":
        return [f"> {line}".rstrip() for line in _md_blocks(children(node))]
    if kind in {"bulletList", "orderedList"}:
        lines: list[str] = []
        number = cast(int, attrs.get("start", 1))
        for item in children(node):
            marker = "- " if kind == "bulletList" else f"{number}. "
            number += 1
            body = _md_blocks(children(item))
            indent = " " * len(marker)
            lines.append(marker + (body[0] if body else ""))
            lines.extend((indent + line) if line else "" for line in body[1:])
        return lines
    if kind == "codeBlock":
        text = _text(node)
        fence = "`" * max(3, max((len(run) for run in re.findall(r"`+", text)), default=0) + 1)
        language = attrs.get("language")
        return [fence + (language if isinstance(language, str) else ""), *text.split("\n"), fence]
    if kind == "horizontalRule":
        return ["---"]
    if kind == "table":
        return _md_table(node)
    return _md_blocks(children(node))


def render_markdown(content: JsonObject, version: int) -> str:
    stats = RenderStats()
    _count_locked(content, stats)
    meta = f"<!-- ThesisPilot 正文 v{version}"
    if stats.locked:
        meta += f"；含 {stats.locked} 处锁定内容，已按原文保留"
    meta += " -->"
    return meta + "\n\n" + "\n".join(_md_blocks(children(content))) + "\n"


# Plain text -------------------------------------------------------------------------------------


def _txt_blocks(nodes: list[JsonObject]) -> list[str]:
    lines: list[str] = []
    for node in nodes:
        if lines:
            lines.append("")
        lines.extend(_txt_block(node))
    return lines


def _txt_block(node: JsonObject) -> list[str]:
    kind = node["type"]
    attrs = node_attrs(node)
    if kind in {"paragraph", "heading"}:
        return _text(node).split("\n")
    if kind == "blockquote":
        return [f"> {line}".rstrip() for line in _txt_blocks(children(node))]
    if kind in {"bulletList", "orderedList"}:
        lines: list[str] = []
        number = cast(int, attrs.get("start", 1))
        for item in children(node):
            marker = "• " if kind == "bulletList" else f"{number}. "
            number += 1
            body = _txt_blocks(children(item))
            lines.append(marker + (body[0] if body else ""))
            lines.extend(("   " + line) if line else "" for line in body[1:])
        return lines
    if kind == "codeBlock":
        return ["    " + line for line in _text(node).split("\n")]
    if kind == "horizontalRule":
        return ["————————"]
    if kind == "table":
        return [
            "\t".join(" ".join(_text(cell).split()) for cell in children(row))
            for row in children(node)
        ]
    return _txt_blocks(children(node))


def render_txt(content: JsonObject, version: int) -> str:
    stats = RenderStats()
    _count_locked(content, stats)
    body = "\n".join(_txt_blocks(children(content)))
    note = f"（含 {stats.locked} 处锁定内容，已按原文保留）\n\n" if stats.locked else ""
    return note + body + "\n"


RENDERERS: dict[str, Callable[[JsonObject, int], str]] = {
    "html": render_html,
    "markdown": render_markdown,
    "txt": render_txt,
}


def render_document(content: object, version: int, format: str) -> str:
    """Re-validate against the frozen contract before rendering a stored version."""
    canonical = canonical_editor_json(content, require_chapter_ids=False)
    return RENDERERS[format](canonical, version)
