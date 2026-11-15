import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from thesis_pilot.modules.documents.structure import MAX_TRANSPORT_BYTES


def payload(text: str = "自制HTTP正文🙂\u0000") -> dict:
    return {
        "content": {
            "schema_version": 1,
            "json": {
                "type": "doc",
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
            },
        }
    }


def project_path(client: TestClient) -> str:
    response = client.post("/api/v1/projects", json={"name": "正文接口项目"})
    assert response.status_code == 201
    return f"/api/v1/projects/{response.json()['id']}/documents"


def test_http_import_cas_and_history(client: TestClient) -> None:
    path = project_path(client)
    assert client.get(path + "/current").json()["error"]["code"] == "DOCUMENT_NOT_FOUND"
    first = client.post(path, json=payload())
    assert first.status_code == 201
    body = first.json()
    assert body["version"] == 1 and body["content"] == payload()["content"]
    assert body["created_at"].endswith("Z")
    assert client.get(path + "/current").json() == body
    assert client.post(path, json=payload("不能覆盖")).status_code == 409
    detail = path + "/" + body["id"]
    saved = client.patch(detail, json={**payload("新稿"), "expected_version": 1})
    assert saved.status_code == 200 and saved.json()["version"] == 2
    stale = client.patch(detail, json={**payload("旧稿"), "expected_version": 1})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "DOCUMENT_VERSION_CONFLICT"
    assert client.get(detail + "/versions/1").json()["content"] == body["content"]
    history = client.get(detail + "/versions?limit=1&offset=0").json()
    assert history["total"] == 2 and history["items"][0]["version"] == 2
    assert "content" not in history["items"][0]


def test_http_validation_errors_never_echo_manuscript(
    client: TestClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    path = project_path(client)
    secret = "synthetic-private-manuscript-marker"
    bad = payload(secret)
    bad["content"]["json"]["content"][0]["private"] = secret
    response = client.post(path, json=bad)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "DOCUMENT_STRUCTURE_INVALID"
    assert secret not in response.text and secret not in caplog.text
    response = client.post(path, json={**payload(), "extra": secret})
    assert response.status_code == 422 and response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert secret not in response.text and secret not in caplog.text
    assert client.get(path + "/current").status_code == 404


def test_http_body_limit_covers_declared_and_chunked_lengths(client: TestClient) -> None:
    path = project_path(client)
    declared = client.post(
        path,
        content="{}",
        headers={
            "Content-Type": "application/json",
            "Content-Length": str(MAX_TRANSPORT_BYTES + 1),
        },
    )
    assert declared.status_code == 413
    assert declared.json()["error"]["code"] == "DOCUMENT_TOO_LARGE"
    chunked = client.post(path, content=iter([b" " * MAX_TRANSPORT_BYTES, b" "]))
    assert chunked.status_code == 413
    assert client.get(path + "/current").status_code == 404


def test_http_deep_structure_roundtrip_and_auth(client: TestClient) -> None:
    path = project_path(client)
    data = payload()
    node = data["content"]["json"]["content"][0]
    for _ in range(78):
        node = {"type": "blockquote", "content": [node]}
    data["content"]["json"]["content"] = [node]
    response = client.post(
        path, content=json.dumps(data), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 201
    assert client.get(path + "/current").json()["content"] == data["content"]
    denied = client.get(path + "/current", headers={"Authorization": "Bearer wrong"})
    assert denied.status_code == 401
    wrong_project = f"/api/v1/projects/{uuid4()}/documents/current"
    assert client.get(wrong_project).status_code == 404
