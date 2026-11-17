"""Deterministic GB/T 7714-2015 numeric (顺序编码制) reference rendering.

Input is a saved literature record exactly as the source returned it. Missing fields are
omitted with their punctuation; nothing is inferred (no publisher place, no page numbers,
no name re-ordering or initials, since a display name's family/given split is unknown).

    [序号] 主要责任者. 题名[文献类型标识]. 出版项. DOI:xxx.

- 责任者：最多 3 个，超过时加“, 等”（题名含汉字）或“, et al.”，名称按来源原样。
- 期刊 [J]：刊名, 年, 卷(期): 页码.
- 会议 [C] / 图书章节 [M]：//会议录或书名. 出版者, 年: 页码.
- 图书 [M]、学位论文 [D]、报告 [R]、标准 [S]、其他 [Z]：出版者或来源名, 年: 页码.
"""

from __future__ import annotations

import re
from typing import Protocol

RENDERER_VERSION = "gbt7714-2015-numeric-1"
MAX_AUTHORS = 3
CJK = re.compile(r"[㐀-鿿豈-﫿]")
TRAILING = re.compile(r"[\s.。,，;；:：]+$")

# Source work types (Crossref + OpenAlex vocabularies) → GB/T 7714 type identifier.
TYPE_CODES: dict[str, str] = {
    "journal-article": "J",
    "article": "J",
    "review": "J",
    "letter": "J",
    "editorial": "J",
    "proceedings-article": "C",
    "proceedings": "C",
    "book": "M",
    "monograph": "M",
    "edited-book": "M",
    "reference-book": "M",
    "book-chapter": "M",
    "book-part": "M",
    "book-section": "M",
    "dissertation": "D",
    "report": "R",
    "standard": "S",
    "dataset": "DS",
    "posted-content": "Z",
    "preprint": "Z",
}
CONTAINED = frozenset({"proceedings-article", "book-chapter", "book-part", "book-section"})


class Record(Protocol):
    @property
    def title(self) -> str: ...
    @property
    def authors(self) -> list[str]: ...
    @property
    def year(self) -> int | None: ...
    @property
    def venue(self) -> str | None: ...
    @property
    def publisher(self) -> str | None: ...
    @property
    def work_type(self) -> str | None: ...
    @property
    def doi(self) -> str | None: ...
    @property
    def volume(self) -> str | None: ...
    @property
    def issue(self) -> str | None: ...
    @property
    def pages(self) -> str | None: ...


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    text = TRAILING.sub("", " ".join(value.split()))
    return text or None


def type_code(record: Record) -> str:
    kind = (record.work_type or "").strip().lower()
    code = TYPE_CODES.get(kind, "Z")
    # OpenAlex calls journal papers and many proceedings papers "article"; without a venue
    # there is no periodical to name, so the record is not presented as a journal paper.
    if code == "J" and not _clean(record.venue):
        return "Z"
    return code


def authors_part(record: Record) -> str | None:
    names = [name for name in (_clean(item) for item in record.authors) if name]
    if not names:
        return None
    shown = ", ".join(names[:MAX_AUTHORS])
    if len(names) > MAX_AUTHORS:
        shown += ", 等" if CJK.search(record.title) else ", et al"
    return shown


def _locator(record: Record) -> str:
    """年, 卷(期): 页码 — each part only when present."""
    year = str(record.year) if record.year is not None else None
    volume, issue, pages = _clean(record.volume), _clean(record.issue), _clean(record.pages)
    issue_part = f"({issue})" if issue else ""
    if volume:
        head = ", ".join(part for part in (year, volume + issue_part) if part)
    else:
        # 无卷号时期号直接接年：2019(2)
        head = (year or "") + issue_part
    return f"{head}: {pages}" if pages and head else (pages or head)


def publication_part(record: Record, code: str) -> str | None:
    venue, publisher = _clean(record.venue), _clean(record.publisher)
    kind = (record.work_type or "").strip().lower()
    if code == "J":
        return ", ".join(part for part in (venue, _locator(record)) if part) or None
    holder = publisher if kind in CONTAINED or code != "Z" else publisher or venue
    year = str(record.year) if record.year is not None else None
    pages = _clean(record.pages)
    issued = ", ".join(part for part in (holder, year) if part)
    if pages:
        issued = f"{issued}: {pages}" if issued else pages
    if kind in CONTAINED and venue:
        return f"//{venue}. {issued}" if issued else f"//{venue}"
    return issued or None


def render(record: Record) -> str:
    """The reference text without its ``[n] `` number prefix."""
    code = type_code(record)
    title = _clean(record.title) or record.title.strip()
    parts: list[str] = []
    author = authors_part(record)
    if author:
        parts.append(author + ".")
    publication = publication_part(record, code)
    if publication and publication.startswith("//"):
        parts.append(f"{title}[{code}]{publication}.")
    else:
        parts.append(f"{title}[{code}].")
        if publication:
            parts.append(publication + ".")
    if record.doi:
        parts.append(f"DOI:{record.doi}.")
    return " ".join(parts)


def numbered(number: int, record: Record) -> str:
    return f"[{number}] {render(record)}"


def marker(number: int) -> str:
    return f"[{number}]"
