"""External bibliographic sources: Crossref (primary) and OpenAlex (supplementary).

Only fields the source actually returned are kept. Full text is never fetched; a record
carries an abstract only when the source supplied one. Request politeness: a generic
client name (no personal or project identity), bounded rows and a per-host minimum
interval between calls.

An optional OpenAlex key travels only as the ``api_key`` query parameter. URLs that carry
it never leave this module: the response keeps a redacted URL, transport errors collapse
to stable codes, and httpx request log lines are redacted.
"""

import html
import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from hashlib import sha256
from threading import Lock
from time import monotonic, sleep
from typing import Annotated, Literal
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field

from thesis_pilot.modules.literature.contracts import LiteratureSource

CROSSREF_BASE = "https://api.crossref.org"
OPENALEX_BASE = "https://api.openalex.org"
USER_AGENT = "literature-search-client/0.1"
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
MAX_ABSTRACT_CHARS = 20000
MAX_AUTHORS = 50
REQUEST_TIMEOUT_SECONDS = 12.0
MIN_INTERVAL_SECONDS = 1.0
DOI_PATTERN = re.compile(r"^10\.\d{4,9}/\S{1,300}$")
API_KEY_PARAM = "api_key"
_KEY_IN_TEXT = re.compile(r"(api_key=)[^&\s\"']*")


def redact(text: str) -> str:
    """Remove any ``api_key`` query value from a URL or log text."""
    return _KEY_IN_TEXT.sub(r"\1[redacted]", text)


class _RedactKeyFilter(logging.Filter):
    """httpx logs every request URL at INFO; strip the OpenAlex key from those lines."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if API_KEY_PARAM in message:
            record.msg = redact(message)
            record.args = None
        return True


for _name in ("httpx", "httpcore"):
    _logger = logging.getLogger(_name)
    if not any(isinstance(item, _RedactKeyFilter) for item in _logger.filters):
        _logger.addFilter(_RedactKeyFilter())

# Tests replace these; production uses the real network with the bounds above.
TRANSPORT: httpx.BaseTransport | None = None
SLEEP: Callable[[float], None] = sleep

_throttle_lock = Lock()
_last_call: dict[str, float] = {}

Coverage = Literal["biblio", "abstract"]


class SourceError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class LiteratureRecord(BaseModel):
    """A normalized record. Absent source fields stay None; nothing is inferred."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: LiteratureSource
    source_id: Annotated[str, Field(min_length=1, max_length=400)]
    doi: Annotated[str, Field(max_length=320)] | None
    title: Annotated[str, Field(min_length=1, max_length=1000)]
    authors: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=300)]], Field(max_length=50)
    ]
    year: Annotated[int, Field(ge=1000, le=2100)] | None
    venue: Annotated[str, Field(max_length=500)] | None
    publisher: Annotated[str, Field(max_length=500)] | None
    work_type: Annotated[str, Field(max_length=100)] | None
    abstract: Annotated[str, Field(min_length=1, max_length=MAX_ABSTRACT_CHARS)] | None
    source_url: Annotated[str, Field(max_length=1000)] | None
    coverage: Coverage
    # Bibliographic locators, only when the source returned them (older records lack them).
    volume: Annotated[str, Field(max_length=50)] | None = None
    issue: Annotated[str, Field(max_length=50)] | None = None
    pages: Annotated[str, Field(max_length=50)] | None = None


@dataclass(frozen=True)
class SearchParams:
    query: str
    rows: int
    year_from: int | None
    year_to: int | None


@dataclass(frozen=True)
class SearchResponse:
    total_results: int
    items: list[LiteratureRecord]
    skipped_count: int
    response_sha256: str
    # Redacted: never carries the OpenAlex key.
    request_url: str


@dataclass(frozen=True)
class DoiLookup:
    """found=False means the DOI does not resolve at Crossref (HTTP 404)."""

    found: bool
    title: str | None = None
    year: int | None = None


def normalize_doi(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    doi = value.strip().lower()
    for prefix in (
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi:",
    ):
        if doi.startswith(prefix):
            doi = doi[len(prefix) :]
            break
    return doi if DOI_PATTERN.match(doi) else None


def _text(value: object, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split())
    return cleaned[:limit] if cleaned else None


def _first_text(value: object, limit: int) -> str | None:
    if isinstance(value, list):
        for item in value:
            text = _text(item, limit)
            if text:
                return text
        return None
    return _text(value, limit)


def _year(value: object) -> int | None:
    return value if type(value) is int and 1000 <= value <= 2100 else None


_JATS_TITLE = re.compile(r"<(?:jats:)?title[^>]*>.*?</(?:jats:)?title>", re.S | re.I)
_TAG = re.compile(r"<[^>]+>")


def jats_to_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    without_title = _JATS_TITLE.sub(" ", value)
    return _text(html.unescape(_TAG.sub(" ", without_title)), MAX_ABSTRACT_CHARS)


def inverted_index_to_text(value: object) -> str | None:
    """OpenAlex ships abstracts as word → positions; rebuild the exact word order."""
    if not isinstance(value, dict) or not value:
        return None
    positions: dict[int, str] = {}
    for word, places in value.items():
        if not isinstance(word, str) or not isinstance(places, list):
            raise ValueError("abstract index")
        for place in places:
            if type(place) is not int or not 0 <= place < 100000:
                raise ValueError("abstract index")
            positions[place] = word
    return _text(" ".join(positions[key] for key in sorted(positions)), MAX_ABSTRACT_CHARS)


def _locator(value: object) -> str | None:
    if type(value) is int and value >= 0:
        value = str(value)
    return _text(value, 50)


def _pages(first: object, last: object) -> str | None:
    start, end = _locator(first), _locator(last)
    if start and end and end != start:
        return f"{start}-{end}"[:50]
    return start


def _record(**fields: object) -> LiteratureRecord:
    return LiteratureRecord.model_validate(
        {**fields, "coverage": "abstract" if fields.get("abstract") else "biblio"}
    )


def crossref_item(item: object) -> LiteratureRecord | None:
    if not isinstance(item, dict):
        return None
    title = _first_text(item.get("title"), 1000)
    doi = normalize_doi(item.get("DOI"))
    if not title or not doi:
        return None
    authors: list[str] = []
    for author in item.get("author") or []:
        if not isinstance(author, dict):
            continue
        name = _text(
            " ".join(
                part
                for part in (author.get("given"), author.get("family"))
                if isinstance(part, str)
            )
            or author.get("name"),
            300,
        )
        if name:
            authors.append(name)
    year = None
    for key in ("issued", "published", "published-print", "published-online"):
        parts = (item.get(key) or {}).get("date-parts") if isinstance(item.get(key), dict) else None
        if isinstance(parts, list) and parts and isinstance(parts[0], list) and parts[0]:
            year = _year(parts[0][0])
            if year:
                break
    url = _text(item.get("URL"), 1000)
    return _record(
        source="crossref",
        source_id=doi,
        doi=doi,
        title=title,
        authors=authors[:MAX_AUTHORS],
        year=year,
        venue=_first_text(item.get("container-title"), 500),
        publisher=_text(item.get("publisher"), 500),
        work_type=_text(item.get("type"), 100),
        abstract=jats_to_text(item.get("abstract")),
        source_url=url if url and url.startswith("https://") else f"https://doi.org/{doi}",
        volume=_locator(item.get("volume")),
        issue=_locator(item.get("issue")),
        pages=_text(item.get("page"), 50),
    )


def openalex_item(item: object) -> LiteratureRecord | None:
    if not isinstance(item, dict):
        return None
    title = _text(item.get("display_name") or item.get("title"), 1000)
    source_id = _text(item.get("id"), 400)
    if not title or not source_id:
        return None
    authors: list[str] = []
    for authorship in item.get("authorships") or []:
        author = authorship.get("author") if isinstance(authorship, dict) else None
        name = _text(author.get("display_name"), 300) if isinstance(author, dict) else None
        if name:
            authors.append(name)
    location = item.get("primary_location")
    venue_source = location.get("source") if isinstance(location, dict) else None
    venue = _text(venue_source.get("display_name"), 500) if isinstance(venue_source, dict) else None
    publisher = (
        _text(venue_source.get("host_organization_name"), 500)
        if isinstance(venue_source, dict)
        else None
    )
    doi = normalize_doi(item.get("doi"))
    raw_biblio = item.get("biblio")
    biblio: dict[str, object] = raw_biblio if isinstance(raw_biblio, dict) else {}
    return _record(
        source="openalex",
        source_id=source_id,
        doi=doi,
        title=title,
        authors=authors[:MAX_AUTHORS],
        year=_year(item.get("publication_year")),
        venue=venue,
        publisher=publisher,
        work_type=_text(item.get("type"), 100),
        abstract=inverted_index_to_text(item.get("abstract_inverted_index")),
        source_url=f"https://doi.org/{doi}" if doi else source_id,
        volume=_locator(biblio.get("volume")),
        issue=_locator(biblio.get("issue")),
        pages=_pages(biblio.get("first_page"), biblio.get("last_page")),
    )


def _throttle(host: str) -> None:
    with _throttle_lock:
        wait = _last_call.get(host, -1e9) + MIN_INTERVAL_SECONDS - monotonic()
        if wait > 0:
            SLEEP(wait)
        _last_call[host] = monotonic()


def _get(url: str, *, allow_not_found: bool = False) -> tuple[int, bytes]:
    host = url.split("/")[2]
    _throttle(host)
    try:
        with (
            httpx.Client(
                transport=TRANSPORT,
                timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS, connect=5.0),
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                follow_redirects=False,
            ) as client,
            client.stream("GET", url) as response,
        ):
            if response.status_code == 429:
                raise SourceError("LITERATURE_SOURCE_RATE_LIMITED")
            if response.status_code == 404 and allow_not_found:
                return 404, b""
            if response.status_code != 200:
                raise SourceError("LITERATURE_SOURCE_UNAVAILABLE")
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise SourceError("LITERATURE_SOURCE_INVALID")
            return 200, bytes(body)
    except httpx.TimeoutException:
        raise SourceError("LITERATURE_SOURCE_TIMEOUT") from None
    except httpx.HTTPError:
        # Transport exceptions can include URLs or peer details; keep only a stable code.
        raise SourceError("LITERATURE_SOURCE_UNAVAILABLE") from None


def _json(body: bytes) -> dict[str, object]:
    try:
        value = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise SourceError("LITERATURE_SOURCE_INVALID") from None
    if not isinstance(value, dict):
        raise SourceError("LITERATURE_SOURCE_INVALID")
    return value


def search_url(source: LiteratureSource, params: SearchParams, api_key: str | None = None) -> str:
    if source == "crossref":
        query: dict[str, str | int] = {
            "query.bibliographic": params.query,
            "rows": params.rows,
            "select": (
                "DOI,title,author,issued,published,container-title,abstract,type,publisher,URL,"
                "volume,issue,page"
            ),
        }
        filters = []
        if params.year_from is not None:
            filters.append(f"from-pub-date:{params.year_from}")
        if params.year_to is not None:
            filters.append(f"until-pub-date:{params.year_to}")
        if filters:
            query["filter"] = ",".join(filters)
        return f"{CROSSREF_BASE}/works?{urlencode(query)}"
    query = {"search": params.query, "per_page": params.rows}
    if params.year_from is not None and params.year_to is not None:
        query["filter"] = f"publication_year:{params.year_from}-{params.year_to}"
    elif params.year_from is not None:
        query["filter"] = f"publication_year:>{params.year_from - 1}"
    elif params.year_to is not None:
        query["filter"] = f"publication_year:<{params.year_to + 1}"
    if api_key:
        query[API_KEY_PARAM] = api_key
    return f"{OPENALEX_BASE}/works?{urlencode(query)}"


def without_key(url: str) -> str:
    parts = urlsplit(url)
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != API_KEY_PARAM]
    return urlunsplit(parts._replace(query=urlencode(kept)))


def search(
    source: LiteratureSource, params: SearchParams, *, api_key: str | None = None
) -> SearchResponse:
    """``api_key`` is used for OpenAlex only (Crossref never receives it)."""
    url = search_url(source, params, api_key if source == "openalex" else None)
    _, body = _get(url)
    data = _json(body)
    if source == "crossref":
        message = data.get("message")
        if not isinstance(message, dict):
            raise SourceError("LITERATURE_SOURCE_INVALID")
        raw_items, total = message.get("items"), message.get("total-results")
        parse = crossref_item
    else:
        meta = data.get("meta")
        raw_items = data.get("results")
        total = meta.get("count") if isinstance(meta, dict) else None
        parse = openalex_item
    if not isinstance(raw_items, list) or type(total) is not int or total < 0:
        raise SourceError("LITERATURE_SOURCE_INVALID")
    items: list[LiteratureRecord] = []
    skipped = 0
    seen: set[str] = set()
    for raw in raw_items[: params.rows]:
        try:
            record = parse(raw)
        except ValueError:
            record = None
        if record is None or record.source_id in seen:
            skipped += 1
            continue
        seen.add(record.source_id)
        items.append(record)
    return SearchResponse(
        total_results=total,
        items=items,
        skipped_count=skipped,
        response_sha256=sha256(body).hexdigest(),
        request_url=without_key(url),
    )


def lookup_doi(doi: str) -> DoiLookup:
    """Deterministic DOI back-check against Crossref's registration record."""
    status, body = _get(f"{CROSSREF_BASE}/works/{quote(doi, safe='/')}", allow_not_found=True)
    if status == 404:
        return DoiLookup(found=False)
    message = _json(body).get("message")
    if not isinstance(message, dict) or normalize_doi(message.get("DOI")) != doi:
        raise SourceError("LITERATURE_SOURCE_INVALID")
    try:
        record = crossref_item(message)
    except ValueError:
        raise SourceError("LITERATURE_SOURCE_INVALID") from None
    if record is None:
        raise SourceError("LITERATURE_SOURCE_INVALID")
    return DoiLookup(found=True, title=record.title, year=record.year)


def comparable_title(value: str) -> str:
    return "".join(char for char in value.casefold() if char.isalnum())
