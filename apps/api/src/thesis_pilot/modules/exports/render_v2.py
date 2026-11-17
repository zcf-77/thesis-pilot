"""Deterministic HTML / Markdown / TXT renderers for v2 snapshots (MuffinOffice DocsModel).

Same rules as the v1 renderer: same input, same bytes; nothing synthesized, no timestamps.
``lock`` protections are marked like v1 ``aiLock``; ``object`` blocks (constructs the
importer could not bring into the editor) are rendered with an explicit placeholder so the
reader knows the original holds an object that this text format cannot carry.
"""

from __future__ import annotations

import html
import re
from typing import Any, cast

from thesis_pilot.modules.documents.docs_model import (
    OBJECT_ATOM,
    atom_text,
    model_of,
    protections_of,
    top_blocks,
)
from thesis_pilot.modules.exports.render import HTML_STYLE, md_escape

Obj = dict[str, Any]

OBJECT_PLACEHOLDER = "［原件对象，未随正文导出］"
ALIGN = {"start": "left", "center": "center", "end": "right", "justify": "justify"}


class _Context:
    def __init__(self, snapshot: Obj) -> None:
        self.locks: dict[str, list[tuple[int, int]]] = {}
        self.objects: set[str] = set()
        for protection in protections_of(snapshot):
            anchor = cast(Obj, protection["anchor"])
            node = cast(str, anchor["node"])
            if protection["kind"] == "lock" and "start" in anchor:
                self.locks.setdefault(node, []).append(
                    (cast(int, anchor["start"]), cast(int, anchor["end"]))
                )
            elif protection["kind"] == "object":
                self.objects.add(node)
            elif protection["kind"] == "lock":
                self.locks.setdefault(node, []).append((0, 1 << 62))
        self.locked = sum(len(spans) for spans in self.locks.values())


def document_title(model: Obj) -> str:
    for block in top_blocks(model):
        if block.get("type") == "heading":
            title = " ".join(
                atom_text(cast(list[Obj], block["inlines"])).replace(OBJECT_ATOM, "").split()
            )
            if title:
                return title[:120]
    return "论文正文"


def _segments(block: Obj, ctx: _Context) -> list[tuple[Obj, bool]]:
    """Inlines split at lock boundaries (scalar offsets, atoms count one)."""
    spans = ctx.locks.get(cast(str, block["id"]), [])
    result: list[tuple[Obj, bool]] = []
    offset = 0
    for inline in cast(list[Obj], block.get("inlines", [])):
        if inline.get("type") != "run":
            locked = any(start <= offset < end for start, end in spans)
            result.append((inline, locked))
            offset += 1
            continue
        text = cast(str, inline["text"])
        cuts = sorted(
            {0, len(text)}
            | {
                point - offset
                for start, end in spans
                for point in (start, end)
                if offset < point < offset + len(text)
            }
        )
        for left, right in zip(cuts, cuts[1:], strict=False):
            piece = {**inline, "text": text[left:right]}
            locked = any(start <= offset + left < end for start, end in spans)
            result.append((piece, locked))
        offset += len(text)
    return result


# HTML -------------------------------------------------------------------------------------------


def _html_inline(inline: Obj, locked: bool) -> str:
    kind = inline.get("type")
    if kind == "break":
        return "<br>"
    if kind == "tab":
        return "\t"
    if kind == "image":
        alt = inline.get("alt")
        return (
            f"［图：{html.escape(alt, quote=False)}］" if isinstance(alt, str) and alt else "［图］"
        )
    if kind != "run":
        return ""
    value = html.escape(cast(str, inline["text"]), quote=False)
    props = cast(Obj, inline.get("props", {}))
    for flag, tag in (("code", "code"), ("strike", "s"), ("italic", "em"), ("bold", "strong")):
        if props.get(flag):
            value = f"<{tag}>{value}</{tag}>"
    if props.get("underline") not in (None, "none"):
        value = f"<u>{value}</u>"
    if props.get("verticalAlign") == "superscript":
        value = f"<sup>{value}</sup>"
    elif props.get("verticalAlign") == "subscript":
        value = f"<sub>{value}</sub>"
    link = props.get("link")
    if isinstance(link, dict):
        href = html.escape(cast(str, link["href"]))
        value = f'<a href="{href}" rel="noopener noreferrer nofollow">{value}</a>'
    if locked:
        value = f'<span class="tp-locked" data-locked="true" title="锁定内容">{value}</span>'
    return value


def _align(block: Obj) -> str:
    props = block.get("props")
    align = props.get("align") if isinstance(props, dict) else None
    css = ALIGN.get(align) if isinstance(align, str) else None
    return f' style="text-align:{css}"' if css else ""


def _html_text_block(block: Obj, ctx: _Context) -> str:
    inner = "".join(_html_inline(inline, locked) for inline, locked in _segments(block, ctx))
    if cast(str, block["id"]) in ctx.objects:
        inner += f'<span class="tp-object">{OBJECT_PLACEHOLDER}</span>'
    if block["type"] == "heading":
        level = min(6, max(1, cast(int, block["level"])))
        identity = f' id="ch-{html.escape(cast(str, block["id"]))}"'
        return f"<h{level}{identity}{_align(block)}>{inner}</h{level}>\n"
    return f"<p{_align(block)}>{inner}</p>\n"


def _html_blocks(blocks: list[Obj], ctx: _Context) -> str:
    return "".join(_html_block(block, ctx) for block in blocks)


def _html_block(block: Obj, ctx: _Context) -> str:
    kind = block.get("type")
    if kind in {"paragraph", "heading"}:
        return _html_text_block(block, ctx)
    if cast(str, block["id"]) in ctx.objects and kind not in {"table", "list", "quote"}:
        return f'<p class="tp-object">{OBJECT_PLACEHOLDER}</p>\n'
    if kind == "quote":
        inner = _html_blocks(cast(list[Obj], block["blocks"]), ctx)
        return f"<blockquote>\n{inner}</blockquote>\n"
    if kind == "list":
        ordered = block.get("kind") != "bullet"
        tag = "ol" if ordered else "ul"
        start = block.get("start")
        start_attr = (
            f' start="{start}"' if ordered and isinstance(start, int) and start != 1 else ""
        )
        items = "".join(
            f"<li>{_html_blocks(cast(list[Obj], item['blocks']), ctx)}</li>\n"
            for item in cast(list[Obj], block["items"])
        )
        return f"<{tag}{start_attr}>\n{items}</{tag}>\n"
    if kind == "code_block":
        return f"<pre><code>{html.escape(cast(str, block['text']), quote=False)}</code></pre>\n"
    if kind == "rule":
        return "<hr>\n"
    if kind == "image":
        alt = block.get("alt")
        label = html.escape(alt, quote=False) if isinstance(alt, str) and alt else ""
        return f"<p>［图{('：' + label) if label else ''}］</p>\n"
    if kind == "table":
        rows: list[str] = []
        for row in cast(list[Obj], block["rows"]):
            tag = "th" if row.get("header") else "td"
            cells = []
            for cell in cast(list[Obj], row["cells"]):
                inner_blocks = cast(list[Obj], cell["blocks"])
                if len(inner_blocks) == 1 and inner_blocks[0].get("type") == "paragraph":
                    inner = "".join(
                        _html_inline(inline, locked)
                        for inline, locked in _segments(inner_blocks[0], ctx)
                    )
                else:
                    inner = _html_blocks(inner_blocks, ctx).strip()
                spans = "".join(
                    f' {name}="{cell[key]}"'
                    for key, name in (("colSpan", "colspan"), ("rowSpan", "rowspan"))
                    if cell.get(key, 1) != 1
                )
                cells.append(f"<{tag}{spans}>{inner}</{tag}>")
            rows.append("<tr>" + "".join(cells) + "</tr>\n")
        table = f"<table>\n<tbody>\n{''.join(rows)}</tbody>\n</table>\n"
        if cast(str, block["id"]) in ctx.objects:
            table += f'<p class="tp-object">{OBJECT_PLACEHOLDER}</p>\n'
        return table
    # page_break, toc: no text content in a flowing text export.
    return ""


def render_html_v2(snapshot: Obj, version: int) -> str:
    ctx = _Context(snapshot)
    model = model_of(snapshot)
    body = _html_blocks(top_blocks(model), ctx)
    meta = f"ThesisPilot 正文 v{version}"
    if ctx.locked:
        meta += f" · 含 {ctx.locked} 处锁定内容，已按原文保留并标注"
    if ctx.objects:
        meta += f" · 含 {len(ctx.objects)} 处原件对象未随文本导出"
    title = html.escape(document_title(model), quote=False)
    return (
        '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        f"<title>{title}</title>\n<style>{HTML_STYLE}"
        ".tp-object{color:#8a6d1f;font-size:.9em}</style>\n"
        f'</head>\n<body>\n<p class="tp-export-meta">{html.escape(meta, quote=False)}</p>\n'
        f"{body}</body>\n</html>\n"
    )


# Markdown ---------------------------------------------------------------------------------------


def _md_inline(inline: Obj) -> str:
    kind = inline.get("type")
    if kind == "break":
        return "  \n"
    if kind == "tab":
        return "\t"
    if kind == "image":
        alt = inline.get("alt")
        return f"［图：{md_escape(alt)}］" if isinstance(alt, str) and alt else "［图］"
    if kind != "run":
        return ""
    raw = cast(str, inline["text"])
    props = cast(Obj, inline.get("props", {}))
    if props.get("code"):
        fence = "`" * (max((len(run) for run in re.findall(r"`+", raw)), default=0) + 1)
        return (
            f"{fence} {raw} {fence}"
            if raw.startswith("`") or raw.endswith("`")
            else (f"{fence}{raw}{fence}")
        )
    if not raw:
        return ""
    value = md_escape(raw)
    if props.get("underline") not in (None, "none"):
        value = f"<u>{value}</u>"
    if props.get("strike"):
        value = f"~~{value}~~"
    if props.get("italic"):
        value = f"*{value}*"
    if props.get("bold"):
        value = f"**{value}**"
    link = props.get("link")
    if isinstance(link, dict):
        value = f"[{value}](<{cast(str, link['href']).replace('>', '%3E')}>)"
    return value


def _md_inlines(block: Obj, ctx: _Context) -> str:
    text = "".join(_md_inline(inline) for inline in cast(list[Obj], block["inlines"]))
    if cast(str, block["id"]) in ctx.objects:
        text += OBJECT_PLACEHOLDER
    return text


def _md_blocks(blocks: list[Obj], ctx: _Context) -> list[str]:
    lines: list[str] = []
    for block in blocks:
        rendered = _md_block(block, ctx)
        if not rendered:
            continue
        if lines:
            lines.append("")
        lines.extend(rendered)
    return lines


def _md_block(block: Obj, ctx: _Context) -> list[str]:
    kind = block.get("type")
    if kind == "paragraph":
        return _md_inlines(block, ctx).split("\n") or [""]
    if kind == "heading":
        level = min(6, max(1, cast(int, block["level"])))
        text = " ".join(_md_inlines(block, ctx).replace("  \n", " ").split())
        return ["#" * level + " " + text]
    if cast(str, block["id"]) in ctx.objects and kind not in {"table", "list", "quote"}:
        return [OBJECT_PLACEHOLDER]
    if kind == "quote":
        return [f"> {line}".rstrip() for line in _md_blocks(cast(list[Obj], block["blocks"]), ctx)]
    if kind == "list":
        lines: list[str] = []
        number = block.get("start") if isinstance(block.get("start"), int) else 1
        for item in cast(list[Obj], block["items"]):
            marker = "- " if block.get("kind") == "bullet" else f"{number}. "
            number = cast(int, number) + 1
            body = _md_blocks(cast(list[Obj], item["blocks"]), ctx)
            indent = " " * len(marker)
            lines.append(marker + (body[0] if body else ""))
            lines.extend((indent + line) if line else "" for line in body[1:])
        return lines
    if kind == "code_block":
        text = cast(str, block["text"])
        fence = "`" * max(3, max((len(run) for run in re.findall(r"`+", text)), default=0) + 1)
        return [fence, *text.split("\n"), fence]
    if kind == "rule":
        return ["---"]
    if kind == "image":
        alt = block.get("alt")
        return [f"［图：{md_escape(alt)}］" if isinstance(alt, str) and alt else "［图］"]
    if kind == "table":
        simple = all(
            cell.get("colSpan", 1) == 1
            and cell.get("rowSpan", 1) == 1
            and len(cast(list[Obj], cell["blocks"])) == 1
            and cast(list[Obj], cell["blocks"])[0].get("type") == "paragraph"
            for row in cast(list[Obj], block["rows"])
            for cell in cast(list[Obj], row["cells"])
        )
        if not simple:
            return _html_block(block, ctx).rstrip("\n").split("\n")
        rows = [
            [
                _md_inlines(cast(list[Obj], cell["blocks"])[0], ctx).replace("\n", " ") or " "
                for cell in cast(list[Obj], row["cells"])
            ]
            for row in cast(list[Obj], block["rows"])
        ]
        width = max(len(row) for row in rows)
        rows = [row + [" "] * (width - len(row)) for row in rows]
        lines = ["| " + " | ".join(rows[0]) + " |", "|" + "|".join([" --- "] * width) + "|"]
        lines.extend("| " + " | ".join(row) + " |" for row in rows[1:])
        if cast(str, block["id"]) in ctx.objects:
            lines.append(OBJECT_PLACEHOLDER)
        return lines
    return []


def render_markdown_v2(snapshot: Obj, version: int) -> str:
    ctx = _Context(snapshot)
    meta = f"<!-- ThesisPilot 正文 v{version}"
    if ctx.locked:
        meta += f"；含 {ctx.locked} 处锁定内容，已按原文保留"
    if ctx.objects:
        meta += f"；含 {len(ctx.objects)} 处原件对象未随文本导出"
    meta += " -->"
    body = _md_blocks(top_blocks(model_of(snapshot)), ctx)
    return meta + "\n\n" + "\n".join(body) + "\n"


# Plain text -------------------------------------------------------------------------------------


def _txt_inlines(block: Obj, ctx: _Context) -> str:
    parts: list[str] = []
    for inline in cast(list[Obj], block["inlines"]):
        kind = inline.get("type")
        if kind == "run":
            parts.append(cast(str, inline["text"]))
        elif kind == "break":
            parts.append("\n")
        elif kind == "tab":
            parts.append("\t")
        elif kind == "image":
            alt = inline.get("alt")
            parts.append(f"［图：{alt}］" if isinstance(alt, str) and alt else "［图］")
    if cast(str, block["id"]) in ctx.objects:
        parts.append(OBJECT_PLACEHOLDER)
    return "".join(parts)


def _txt_blocks(blocks: list[Obj], ctx: _Context) -> list[str]:
    lines: list[str] = []
    for block in blocks:
        rendered = _txt_block(block, ctx)
        if not rendered:
            continue
        if lines:
            lines.append("")
        lines.extend(rendered)
    return lines


def _txt_block(block: Obj, ctx: _Context) -> list[str]:
    kind = block.get("type")
    if kind in {"paragraph", "heading"}:
        return _txt_inlines(block, ctx).split("\n")
    if cast(str, block["id"]) in ctx.objects and kind not in {"table", "list", "quote"}:
        return [OBJECT_PLACEHOLDER]
    if kind == "quote":
        return [f"> {line}".rstrip() for line in _txt_blocks(cast(list[Obj], block["blocks"]), ctx)]
    if kind == "list":
        lines: list[str] = []
        number = block.get("start") if isinstance(block.get("start"), int) else 1
        for item in cast(list[Obj], block["items"]):
            marker = "• " if block.get("kind") == "bullet" else f"{number}. "
            number = cast(int, number) + 1
            body = _txt_blocks(cast(list[Obj], item["blocks"]), ctx)
            lines.append(marker + (body[0] if body else ""))
            lines.extend(("   " + line) if line else "" for line in body[1:])
        return lines
    if kind == "code_block":
        return ["    " + line for line in cast(str, block["text"]).split("\n")]
    if kind == "rule":
        return ["————————"]
    if kind == "image":
        alt = block.get("alt")
        return [f"［图：{alt}］" if isinstance(alt, str) and alt else "［图］"]
    if kind == "table":

        def cell_text(cell: Obj) -> str:
            parts = (" ".join(_txt_block(child, ctx)) for child in cast(list[Obj], cell["blocks"]))
            return " ".join(" ".join(parts).split())

        lines = [
            "\t".join(cell_text(cell) for cell in cast(list[Obj], row["cells"]))
            for row in cast(list[Obj], block["rows"])
        ]
        if cast(str, block["id"]) in ctx.objects:
            lines.append(OBJECT_PLACEHOLDER)
        return lines
    return []


def render_txt_v2(snapshot: Obj, version: int) -> str:
    ctx = _Context(snapshot)
    body = "\n".join(_txt_blocks(top_blocks(model_of(snapshot)), ctx))
    notes = []
    if ctx.locked:
        notes.append(f"含 {ctx.locked} 处锁定内容，已按原文保留")
    if ctx.objects:
        notes.append(f"含 {len(ctx.objects)} 处原件对象未随文本导出")
    note = f"（{'；'.join(notes)}）\n\n" if notes else ""
    return note + body + "\n"


RENDERERS_V2 = {"html": render_html_v2, "markdown": render_markdown_v2, "txt": render_txt_v2}
