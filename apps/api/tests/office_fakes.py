"""In-process fake office-server built on recorded real responses (see fixtures/office_server)."""

from __future__ import annotations

import base64
import json
from collections.abc import Callable
from hashlib import sha256
from pathlib import Path

import httpx

from thesis_pilot.providers.office_server import OfficeServerClient

FIXTURES = Path(__file__).parent / "fixtures" / "office_server"
TOKEN = "fake-office-token-0123456789abcdef"


def recorded(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def problem(status: int, code: str, issues: list[dict[str, str]] | None = None, **headers: str):
    return httpx.Response(
        status,
        headers={"content-type": "application/problem+json", **headers},
        content=json.dumps({"code": code, "message": "x", "issues": issues or []}).encode(),
    )


def warnings_header(items: list[dict[str, str]]) -> str:
    return base64.urlsafe_b64encode(json.dumps(items).encode()).decode().rstrip("=")


class FakeOffice:
    """Records requests; per-path overrides return custom responses."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, dict[str, object]]] = []
        self.overrides: dict[str, Callable[[dict[str, object]], httpx.Response]] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        body = json.loads(request.content)
        path = request.url.path
        self.requests.append((path, body))
        if path in self.overrides:
            return self.overrides[path](body)
        spec = body["spec"]
        if path == "/v1/parse":
            return httpx.Response(200, json=recorded("thesis-parse.json"))
        if path == "/v1/docs/inspect":
            data = base64.b64decode(spec["docxBase64"])
            value = recorded("thesis-inspect.json")
            value["result"]["irMap"]["sourceSha256"] = sha256(data).hexdigest()  # type: ignore[index]
            return httpx.Response(200, json=value)
        if path == "/v1/docs/transactions":
            data = base64.b64decode(spec["docxBase64"])
            accepting = all(op["op"] == "revision.accept" for op in spec["ops"])
            output = data + (b"clean" if accepting else b"tracked")
            ops = [
                {
                    "id": op["id"],
                    "op": op["op"],
                    "status": "applied",
                    "revisionId": op.get("revisionId") or f"rev-{index}",
                }
                for index, op in enumerate(spec["ops"])
            ]
            return httpx.Response(
                200,
                json={
                    "protocol": "office-kernel-1",
                    "result": {
                        "applied": True,
                        "ops": ops,
                        "output": {
                            "sha256": sha256(output).hexdigest(),
                            "size": len(output),
                            "base64": base64.b64encode(output).decode(),
                        },
                    },
                },
            )
        if path == "/v1/pdf":
            pdf = b"%PDF-1.7\n%fake\n"
            return httpx.Response(
                200,
                content=pdf,
                headers={
                    "content-type": "application/pdf",
                    "x-office-kernel-sha256": sha256(pdf).hexdigest(),
                    "x-office-kernel-warning-total": "1",
                    "x-office-kernel-warnings": warnings_header(
                        [{"code": "pdf.font_substitution", "path": "document", "message": "OFL"}]
                    ),
                },
            )
        return problem(404, "NOT_FOUND")

    def client(self) -> OfficeServerClient:
        return OfficeServerClient(
            "http://office.test", TOKEN, transport=httpx.MockTransport(self.handler)
        )
