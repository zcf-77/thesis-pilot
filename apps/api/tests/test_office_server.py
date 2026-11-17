"""office-server client: success, warnings, problem+json mapping, limits, timeouts."""

import base64

import httpx
import pytest
from office_docx import synthetic_thesis_docx
from office_fakes import TOKEN, FakeOffice, problem, warnings_header

from thesis_pilot.providers.office_server import (
    OfficeServerClient,
    OfficeServerError,
    decode_warnings,
)


def test_parse_inspect_and_pdf_round_trip_through_the_envelope() -> None:
    fake = FakeOffice()
    client = fake.client()
    data = synthetic_thesis_docx()
    parsed = client.parse_docx(data)
    assert parsed.model["kind"] == "docs"
    assert any(item["kind"] == "docx.inline" for item in parsed.unsupported)
    inspected = client.inspect(data, ["irMap", "index"])
    assert inspected["irMap"]["entries"]  # type: ignore[index]
    pdf = client.pdf(data)
    assert pdf.data.startswith(b"%PDF-") and pdf.warning_total == 1
    assert pdf.warnings[0].code == "pdf.font_substitution"
    paths = [path for path, _ in fake.requests]
    assert paths == ["/v1/parse", "/v1/docs/inspect", "/v1/pdf"]
    envelope = fake.requests[0][1]
    assert envelope["protocol"] == "office-kernel-1" and envelope["input"] == "office-source/1"
    assert base64.b64decode(envelope["spec"]["dataBase64"]) == data  # type: ignore[index]


def test_problem_issues_keep_only_whitelisted_facts() -> None:
    fake = FakeOffice()
    fake.overrides["/v1/pdf"] = lambda _: problem(
        422,
        "PDF_UNSUPPORTED",
        [
            {
                "rule": "pdf.convert",
                "path": "/spec/docxBase64",
                "message": "docx.inline at word/document.xml/body/8/oMath[0]: 论文原文片段",
            },
            {"rule": "bad rule with spaces", "path": "/x", "message": "m"},
        ],
    )
    with pytest.raises(OfficeServerError) as raised:
        fake.client().pdf(b"PK\x03\x04")
    failure = raised.value
    assert failure.code == "OFFICE_PDF_UNSUPPORTED" and failure.upstream == "PDF_UNSUPPORTED"
    assert [item.as_json() for item in failure.issues] == [
        {"rule": "pdf.convert", "path": "/spec/docxBase64", "kind": "docx.inline"}
    ]
    assert "论文" not in repr(failure.issues)


@pytest.mark.parametrize(
    ("status", "code", "expected"),
    [
        (401, "UNAUTHORIZED", "OFFICE_AUTH_FAILED"),
        (403, "FEATURE_NOT_LICENSED", "OFFICE_NOT_LICENSED"),
        (413, "BODY_TOO_LARGE", "OFFICE_TOO_LARGE"),
        (422, "SOURCE_INVALID", "OFFICE_SOURCE_INVALID"),
        (409, "BASELINE_MISMATCH", "OFFICE_CONFLICT"),
        (400, "SPEC_INVALID", "OFFICE_PROTOCOL_ERROR"),
        (504, "TIMEOUT", "OFFICE_TIMEOUT"),
        (500, "INTERNAL", "OFFICE_FAILED"),
    ],
)
def test_status_and_code_mapping(status: int, code: str, expected: str) -> None:
    fake = FakeOffice()
    fake.overrides["/v1/parse"] = lambda _: problem(status, code)
    with pytest.raises(OfficeServerError) as raised:
        fake.client().parse_docx(b"PK")
    assert raised.value.code == expected and raised.value.status == status


def test_busy_sidecar_reports_retry_after() -> None:
    fake = FakeOffice()
    fake.overrides["/v1/parse"] = lambda _: problem(503, "BUSY", **{"retry-after": "3"})
    with pytest.raises(OfficeServerError) as raised:
        fake.client().parse_docx(b"PK")
    assert raised.value.code == "OFFICE_UNAVAILABLE" and raised.value.retry_after == 3


def test_response_size_limit_is_enforced_while_streaming() -> None:
    fake = FakeOffice()
    fake.overrides["/v1/pdf"] = lambda _: httpx.Response(200, content=b"%PDF-" + b"x" * 2048)
    client = OfficeServerClient(
        "http://office.test",
        TOKEN,
        transport=httpx.MockTransport(fake.handler),
        max_response_bytes=1024,
    )
    with pytest.raises(OfficeServerError) as raised:
        client.pdf(b"PK")
    assert raised.value.code == "OFFICE_TOO_LARGE"


def test_timeouts_and_connection_errors_collapse_to_codes() -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    def refused(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"refused {TOKEN}", request=request)

    for handler, code in ((timeout, "OFFICE_TIMEOUT"), (refused, "OFFICE_UNAVAILABLE")):
        client = OfficeServerClient(
            "http://office.test", TOKEN, transport=httpx.MockTransport(handler)
        )
        with pytest.raises(OfficeServerError) as raised:
            client.parse_docx(b"PK")
        assert raised.value.code == code
        assert TOKEN not in str(raised.value) and raised.value.__cause__ is None
        assert TOKEN not in repr(client)


def test_unconfigured_sidecar_fails_explicitly(monkeypatch: pytest.MonkeyPatch) -> None:
    from thesis_pilot.core.config import get_settings

    monkeypatch.delenv("TP_OFFICE_URL", raising=False)
    monkeypatch.delenv("TP_OFFICE_TOKEN", raising=False)
    get_settings.cache_clear()
    try:
        with pytest.raises(OfficeServerError) as raised:
            OfficeServerClient.from_settings()
        assert raised.value.code == "OFFICE_NOT_CONFIGURED"
    finally:
        get_settings.cache_clear()
    with pytest.raises(OfficeServerError):
        OfficeServerClient("ftp://office.test", TOKEN)


def test_invalid_responses_are_rejected() -> None:
    fake = FakeOffice()
    fake.overrides["/v1/parse"] = lambda _: httpx.Response(200, content=b"not json")
    fake.overrides["/v1/pdf"] = lambda _: httpx.Response(200, content=b"<html>")
    client = fake.client()
    for call in (lambda: client.parse_docx(b"PK"), lambda: client.pdf(b"PK")):
        with pytest.raises(OfficeServerError) as raised:
            call()
        assert raised.value.code == "OFFICE_INVALID_RESPONSE"


def test_warning_header_decoding_is_bounded_and_tolerant() -> None:
    header = warnings_header(
        [{"code": "docx.theme", "path": "word/document.xml", "message": "m" * 500}, {"code": 1}]
    )
    decoded = decode_warnings(header)
    assert len(decoded) == 1 and len(decoded[0].message) == 300
    assert decode_warnings("%%%") == () and decode_warnings(None) == ()
