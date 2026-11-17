"""Bounded client for the MuffinOffice office-server sidecar (protocol ``office-kernel-1``).

Only the configured sidecar URL is ever contacted. The bearer token stays in this object and
never enters exceptions, logs, job snapshots or responses. Every failure collapses to a
stable ``OFFICE_*`` code; problem+json issues keep only whitelisted rule/path facts, never
messages (they may quote document text). There is no fallback: an unconfigured or failing
sidecar is an explicit error.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from dataclasses import dataclass, field
from hashlib import sha256
from typing import cast

import httpx

PROTOCOL = "office-kernel-1"
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
MAX_WARNINGS = 200
MAX_ISSUES = 20

OFFICE_ERROR_CODES = frozenset(
    {
        "OFFICE_NOT_CONFIGURED",
        "OFFICE_UNAVAILABLE",
        "OFFICE_TIMEOUT",
        "OFFICE_AUTH_FAILED",
        "OFFICE_NOT_LICENSED",
        "OFFICE_TOO_LARGE",
        "OFFICE_SOURCE_INVALID",
        "OFFICE_UNSUPPORTED",
        "OFFICE_PDF_UNSUPPORTED",
        "OFFICE_CONFLICT",
        "OFFICE_PROTOCOL_ERROR",
        "OFFICE_INVALID_RESPONSE",
        "OFFICE_FAILED",
        "OFFICE_RUNNER_UNAVAILABLE",
        "OFFICE_RUNNER_FAILED",
    }
)

_SAFE_RULE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
_SAFE_PATH = re.compile(r"^[A-Za-z0-9_./\[\]~-]{0,200}$")
_KIND_PREFIX = re.compile(r"^([a-z][a-z0-9_.-]{1,60}) at ([A-Za-z0-9_./\[\]-]{1,200}):")


@dataclass(frozen=True)
class OfficeIssue:
    rule: str
    path: str
    # Kernel-classified object kind (e.g. ``docx.inline``) when the message names one.
    kind: str | None = None

    def as_json(self) -> dict[str, str]:
        value = {"rule": self.rule, "path": self.path}
        if self.kind is not None:
            value["kind"] = self.kind
        return value


@dataclass(frozen=True)
class OfficeWarning:
    code: str
    path: str
    message: str

    def as_json(self) -> dict[str, str]:
        return {"code": self.code, "path": self.path, "message": self.message}


class OfficeServerError(Exception):
    """Stable code only; the raw transport exception never crosses this boundary."""

    def __init__(
        self,
        code: str,
        *,
        upstream: str | None = None,
        status: int | None = None,
        retry_after: int | None = None,
        issues: tuple[OfficeIssue, ...] = (),
    ) -> None:
        self.code = code if code in OFFICE_ERROR_CODES else "OFFICE_FAILED"
        self.upstream = upstream
        self.status = status
        self.retry_after = retry_after
        self.issues = issues
        super().__init__(self.code)


@dataclass(frozen=True)
class BinaryResult:
    data: bytes
    sha256: str
    warnings: tuple[OfficeWarning, ...]
    warning_total: int


@dataclass(frozen=True)
class ParseResult:
    model: dict[str, object]
    preserved: list[str]
    converted: list[str]
    unsupported: list[dict[str, object]]
    engine: str | None


@dataclass
class TransactionResult:
    result: dict[str, object]
    output: bytes | None = None
    ops: list[dict[str, object]] = field(default_factory=list)


def _map_problem(status: int, code: str) -> str:
    if status == 401:
        return "OFFICE_AUTH_FAILED"
    if status == 403:
        return "OFFICE_NOT_LICENSED"
    if status == 413 or code in {"BODY_TOO_LARGE", "OUTPUT_TOO_LARGE", "LIMIT_EXCEEDED"}:
        return "OFFICE_TOO_LARGE"
    if status == 504 or code == "TIMEOUT":
        return "OFFICE_TIMEOUT"
    if status == 503:
        return "OFFICE_UNAVAILABLE"
    if code == "SOURCE_INVALID":
        return "OFFICE_SOURCE_INVALID"
    if code.startswith("PDF_"):
        return "OFFICE_PDF_UNSUPPORTED"
    if code in {"BASELINE_MISMATCH", "CONFLICT"}:
        return "OFFICE_CONFLICT"
    if code in {"SPEC_INVALID", "INPUT_UNSUPPORTED", "PROTOCOL_MISMATCH", "INPUT_INVALID"}:
        return "OFFICE_PROTOCOL_ERROR"
    if status == 422:
        return "OFFICE_UNSUPPORTED"
    return "OFFICE_FAILED"


def _issues(raw: object) -> tuple[OfficeIssue, ...]:
    if not isinstance(raw, list):
        return ()
    result: list[OfficeIssue] = []
    for item in raw[:MAX_ISSUES]:
        if not isinstance(item, dict):
            continue
        rule = item.get("rule")
        path = item.get("path")
        if not isinstance(rule, str) or not _SAFE_RULE.match(rule):
            continue
        safe_path = path if isinstance(path, str) and _SAFE_PATH.match(path) else ""
        message = item.get("message")
        kind = None
        if isinstance(message, str):
            # Kernel conversion messages start with "<kind> at <package path>:"; only that
            # classified prefix is kept, the free text (which may quote content) is dropped.
            matched = _KIND_PREFIX.match(message)
            if matched:
                kind = matched.group(1)
        result.append(OfficeIssue(rule, safe_path, kind))
    return tuple(result)


def decode_warnings(header: str | None) -> tuple[OfficeWarning, ...]:
    """``X-Office-Kernel-Warnings``: base64url (no padding) JSON array, ≤ 4 KiB prefix."""
    if not header:
        return ()
    try:
        padded = header + "=" * (-len(header) % 4)
        items = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (ValueError, binascii.Error, UnicodeError):
        return ()
    if not isinstance(items, list):
        return ()
    warnings: list[OfficeWarning] = []
    for item in items[:MAX_WARNINGS]:
        if not isinstance(item, dict):
            continue
        code, path, message = item.get("code"), item.get("path"), item.get("message")
        if not isinstance(code, str) or not _SAFE_RULE.match(code):
            continue
        warnings.append(
            OfficeWarning(
                code,
                path if isinstance(path, str) and _SAFE_PATH.match(path) else "",
                message[:300] if isinstance(message, str) else "",
            )
        )
    return tuple(warnings)


def _retry_after(value: str | None) -> int | None:
    if value is None or not value.isdecimal() or len(value) > 6:
        return None
    return int(value)


class OfficeServerClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        timeout_seconds: int = 90,
        transport: httpx.BaseTransport | None = None,
        max_response_bytes: int = MAX_RESPONSE_BYTES,
    ) -> None:
        if (
            not base_url.startswith(("http://", "https://"))
            or not token
            or not token.isascii()
            or any(ord(char) < 33 for char in token)
        ):
            raise OfficeServerError("OFFICE_NOT_CONFIGURED")
        if not 1 <= timeout_seconds <= 600:
            raise OfficeServerError("OFFICE_NOT_CONFIGURED")
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout_seconds
        self._transport = transport
        self._max = max_response_bytes

    def __repr__(self) -> str:  # never expose the token through reprs or tracebacks
        return f"OfficeServerClient({self._base_url!r})"

    @classmethod
    def from_settings(cls) -> OfficeServerClient:
        from thesis_pilot.core.config import get_settings

        settings = get_settings()
        token = settings.office_token.get_secret_value()
        if not settings.office_url or not token:
            raise OfficeServerError("OFFICE_NOT_CONFIGURED")
        return cls(settings.office_url, token, timeout_seconds=settings.office_timeout_seconds)

    # ---- transport ----

    def _post(
        self, path: str, input_profile: str, spec: dict[str, object]
    ) -> tuple[bytes, httpx.Headers]:
        body = {"protocol": PROTOCOL, "input": input_profile, "spec": spec}
        try:
            with (
                httpx.Client(
                    base_url=self._base_url,
                    headers={
                        "Authorization": f"Bearer {self._token}",
                        "Accept": "application/json, application/pdf, application/octet-stream",
                    },
                    timeout=httpx.Timeout(self._timeout, connect=min(self._timeout, 10)),
                    follow_redirects=False,
                    trust_env=False,
                    transport=self._transport,
                ) as client,
                client.stream("POST", path, json=body) as response,
            ):
                chunks: list[bytes] = []
                size = 0
                declared = response.headers.get("content-length", "")
                if declared.isdecimal() and int(declared) > self._max:
                    raise OfficeServerError("OFFICE_TOO_LARGE", status=response.status_code)
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > self._max:
                        raise OfficeServerError("OFFICE_TOO_LARGE", status=response.status_code)
                    chunks.append(chunk)
                data = b"".join(chunks)
                if response.status_code != 200:
                    self._raise_problem(response.status_code, response.headers, data)
                return data, response.headers
        except OfficeServerError:
            raise
        except httpx.TimeoutException:
            raise OfficeServerError("OFFICE_TIMEOUT") from None
        except httpx.HTTPError:
            raise OfficeServerError("OFFICE_UNAVAILABLE") from None

    @staticmethod
    def _raise_problem(status: int, headers: httpx.Headers, data: bytes) -> None:
        code = ""
        issues: tuple[OfficeIssue, ...] = ()
        if headers.get("content-type", "").startswith("application/problem+json"):
            try:
                problem = json.loads(data)
            except ValueError:
                problem = None
            if isinstance(problem, dict):
                raw_code = problem.get("code")
                if isinstance(raw_code, str) and _SAFE_RULE.match(raw_code):
                    code = raw_code
                issues = _issues(problem.get("issues"))
        raise OfficeServerError(
            _map_problem(status, code),
            upstream=code or None,
            status=status,
            retry_after=_retry_after(headers.get("retry-after")),
            issues=issues,
        )

    def _json(self, path: str, input_profile: str, spec: dict[str, object]) -> dict[str, object]:
        data, _ = self._post(path, input_profile, spec)
        try:
            value = json.loads(data)
        except ValueError:
            raise OfficeServerError("OFFICE_INVALID_RESPONSE") from None
        if not isinstance(value, dict):
            raise OfficeServerError("OFFICE_INVALID_RESPONSE")
        return value

    def _docs(self, path: str, input_profile: str, spec: dict[str, object]) -> dict[str, object]:
        envelope = self._json(path, input_profile, spec)
        result = envelope.get("result")
        if envelope.get("protocol") != PROTOCOL or not isinstance(result, dict):
            raise OfficeServerError("OFFICE_INVALID_RESPONSE")
        return cast(dict[str, object], result)

    # ---- endpoints ----

    def parse_docx(self, data: bytes) -> ParseResult:
        """``/v1/parse`` (``office-source/1``): DocsModel + preserved/converted/unsupported."""
        value = self._json(
            "/v1/parse",
            "office-source/1",
            {"format": "docx", "dataBase64": base64.b64encode(data).decode("ascii")},
        )
        model = value.get("model")
        unsupported = value.get("unsupported", [])
        if (
            not isinstance(model, dict)
            or model.get("kind") != "docs"
            or not isinstance(unsupported, list)
        ):
            raise OfficeServerError("OFFICE_INVALID_RESPONSE")

        def strings(key: str) -> list[str]:
            items = value.get(key, [])
            return (
                [item[:500] for item in items if isinstance(item, str)][:200]
                if isinstance(items, list)
                else []
            )

        return ParseResult(
            model=cast(dict[str, object], model),
            preserved=strings("preserved"),
            converted=strings("converted"),
            unsupported=[item for item in unsupported if isinstance(item, dict)],
            engine=None,
        )

    def inspect(self, data: bytes, include: list[str]) -> dict[str, object]:
        """``/v1/docs/inspect``: e.g. ``include=["irMap", "index"]``."""
        return self._docs(
            "/v1/docs/inspect",
            "docs-inspect/1",
            {"docxBase64": base64.b64encode(data).decode("ascii"), "include": include},
        )

    def transaction(self, data: bytes, transaction: dict[str, object]) -> TransactionResult:
        """``/v1/docs/transactions``: same-paragraph text edits / revision decisions."""
        spec: dict[str, object] = {
            "docxBase64": base64.b64encode(data).decode("ascii"),
            "baseline": {"sourceSha256": sha256(data).hexdigest()},
            **transaction,
        }
        result = self._docs("/v1/docs/transactions", "docs-transaction/1", spec)
        ops = result.get("ops")
        if not isinstance(ops, list) or not all(isinstance(item, dict) for item in ops):
            raise OfficeServerError("OFFICE_INVALID_RESPONSE")
        output: bytes | None = None
        raw = result.get("output")
        if isinstance(raw, dict):
            encoded = raw.get("base64")
            if not isinstance(encoded, str):
                raise OfficeServerError("OFFICE_INVALID_RESPONSE")
            try:
                output = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError):
                raise OfficeServerError("OFFICE_INVALID_RESPONSE") from None
            if (
                not output.startswith(b"PK\x03\x04")
                or raw.get("sha256") != sha256(output).hexdigest()
            ):
                raise OfficeServerError("OFFICE_INVALID_RESPONSE")
        return TransactionResult(
            result=result, output=output, ops=cast(list[dict[str, object]], ops)
        )

    def pdf(self, docx: bytes) -> BinaryResult:
        """``/v1/pdf`` (``docx-pdf/1``): PDF bytes and decoded kernel warnings."""
        data, headers = self._post(
            "/v1/pdf", "docx-pdf/1", {"docxBase64": base64.b64encode(docx).decode("ascii")}
        )
        return self._binary(data, headers, b"%PDF-")

    @staticmethod
    def _binary(data: bytes, headers: httpx.Headers, magic: bytes) -> BinaryResult:
        digest = sha256(data).hexdigest()
        declared = headers.get("x-office-kernel-sha256")
        if not data.startswith(magic) or (declared is not None and declared != digest):
            raise OfficeServerError("OFFICE_INVALID_RESPONSE")
        total = headers.get("x-office-kernel-warning-total", "0")
        warnings = decode_warnings(headers.get("x-office-kernel-warnings"))
        return BinaryResult(
            data=data,
            sha256=digest,
            warnings=warnings,
            warning_total=int(total) if total.isdecimal() and len(total) < 7 else len(warnings),
        )
