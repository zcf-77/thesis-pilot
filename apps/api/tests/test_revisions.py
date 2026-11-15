import json
from uuid import uuid4

from fastapi.testclient import TestClient

from thesis_pilot.modules.revisions.schemas import MAX_REVISION_BYTES


def imported(client: TestClient, text: str = "采用方法甲😀\u0000。") -> str:
    project = client.post("/api/v1/projects", json={"name": "修订 HTTP 自制项目"}).json()
    response = client.post(
        f"/api/v1/projects/{project['id']}/documents",
        json={
            "content": {
                "schema_version": 1,
                "json": {
                    "type": "doc",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
                },
            }
        },
    )
    assert response.status_code == 201, response.text
    return f"/api/v1/projects/{project['id']}/documents/{response.json()['id']}"


def create_body(text: str) -> dict:
    return {
        "command_id": str(uuid4()),
        "base_version": 1,
        "selection": {
            "textblock_path": [0],
            "from": 1,
            "to": 1 + len(text.encode("utf-16-le")) // 2,
            "text": text,
        },
        "goal": "精简文字",
    }


def test_http_commands_expose_fixed_result_and_application_identity(client: TestClient) -> None:
    text = "采用方法甲😀\u0000。"
    prefix = imported(client, text)
    request = create_body(text)
    created = client.post(prefix + "/revisions", json=request)
    assert created.status_code == 201, created.text
    candidate_id = created.json()["candidate_id"]
    path = prefix + "/revisions/" + candidate_id
    assert client.post(prefix + "/revisions", json=request).json() == created.json()
    candidate = client.get(path).json()
    assert candidate["status"] == "generating" and candidate["application_command_id"] is None
    proposal = {
        "command_id": str(uuid4()),
        "generation_token": candidate["generation_token"],
        "patches": [{"id": "p1", "from": 1, "to": 3, "before": "采用", "after": "使用"}],
    }
    assert client.put(path + "/proposal", json=proposal).status_code == 200
    decided = client.put(
        path + "/decisions",
        json={
            "command_id": str(uuid4()),
            "expected_revision": 2,
            "decisions": [{"patch_id": "p1", "decision": "accepted"}],
        },
    )
    assert decided.status_code == 200, decided.text
    apply = {"command_id": str(uuid4()), "expected_revision": 3, "expected_document_version": 1}
    applied = client.post(path + "/apply", json=apply)
    assert applied.status_code == 200, applied.text
    assert applied.json()["result_version"] == 2
    assert client.get(path).json()["application_command_id"] == apply["command_id"]
    undo = client.post(
        prefix + f"/revision-commands/{apply['command_id']}/undo",
        json={"command_id": str(uuid4()), "expected_document_version": 2},
    )
    assert undo.status_code == 200 and undo.json()["result_version"] == 3
    reverted = client.post(
        prefix + "/revert",
        json={"command_id": str(uuid4()), "expected_document_version": 3, "target_version": 2},
    )
    assert reverted.status_code == 200 and reverted.json()["result_version"] == 4
    assert client.get(prefix + f"/revision-commands/{apply['command_id']}").json() == applied.json()
    assert (
        client.get(prefix + "/versions/4").json()["content"]["json"]["content"][0]["content"][0][
            "text"
        ]
        == "使用方法甲😀\u0000。"
    )
    assert client.get(prefix + "/revisions?limit=1&offset=1").json()["items"] == []


def test_wire_budget_is_utf8_bytes_including_whitespace(client: TestClient) -> None:
    prefix = imported(client, "采用")
    data = create_body("采用")
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    exact = encoded + b" " * (MAX_REVISION_BYTES - len(encoded))
    response = client.post(
        prefix + "/revisions", content=exact, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 201, response.text
    oversized = client.post(
        prefix + "/revisions", content=exact + b" ", headers={"Content-Type": "application/json"}
    )
    assert (
        oversized.status_code == 413 and oversized.json()["error"]["code"] == "REVISION_TOO_LARGE"
    )
    assert client.get(prefix + "/revisions").json()["total"] == 1
    candidate = client.get(prefix + "/revisions/" + response.json()["candidate_id"]).json()
    proposal = {
        "command_id": str(uuid4()),
        "generation_token": candidate["generation_token"],
        "patches": [{"id": "p1", "from": 1, "to": 3, "before": "采用", "after": "汉" * 100000}],
    }
    too_many_bytes = client.put(prefix + f"/revisions/{candidate['id']}/proposal", json=proposal)
    assert too_many_bytes.status_code == 413
    assert client.get(prefix + f"/revisions/{candidate['id']}").json()["status"] == "generating"


def test_read_budget_rejects_unreadable_proposal_and_rolls_back(client: TestClient) -> None:
    text = "\u0000" * 32768
    prefix = imported(client, text)
    created = client.post(prefix + "/revisions", json=create_body(text))
    assert created.status_code == 201
    path = prefix + "/revisions/" + created.json()["candidate_id"]
    candidate = client.get(path).json()
    payload = {
        "command_id": str(uuid4()),
        "generation_token": candidate["generation_token"],
        "patches": [{"id": "p1", "from": 1, "to": 32769, "before": text, "after": "普通替换"}],
    }
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    assert len(encoded) < MAX_REVISION_BYTES
    response = client.put(
        path + "/proposal", content=encoded, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413, response.text
    assert response.json()["error"]["code"] == "REVISION_TOO_LARGE"
    preserved = client.get(path)
    assert preserved.status_code == 200 and len(preserved.content) <= MAX_REVISION_BYTES
    assert preserved.json()["revision"] == 1 and preserved.json()["patches"] == []
    assert client.get(prefix + "/revision-commands/" + payload["command_id"]).status_code == 404


def test_escaped_surrogates_and_excessive_json_depth_are_422(client: TestClient) -> None:
    prefix = imported(client, "采用")
    internal_alias = create_body("采用")
    internal_alias["selection"]["from_position"] = internal_alias["selection"].pop("from")
    assert client.post(prefix + "/revisions", json=internal_alias).status_code == 422
    for field in ("goal", "selection"):
        data = create_body("采用")
        if field == "goal":
            data["goal"] = "\ud800"
        else:
            data["selection"]["text"] = "\udfff"
        response = client.post(
            prefix + "/revisions",
            content=json.dumps(data),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422, response.text
    created = client.post(prefix + "/revisions", json=create_body("采用")).json()
    path = prefix + "/revisions/" + created["candidate_id"]
    item = client.get(path).json()
    proposal = {
        "command_id": str(uuid4()),
        "generation_token": item["generation_token"],
        "patches": [{"id": "p1", "from": 1, "to": 3, "before": "采用", "after": "\ud800"}],
    }
    response = client.put(
        path + "/proposal",
        content=json.dumps(proposal),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    for depth in (41, 1100):
        response = client.post(
            prefix + "/revisions",
            content=b"[" * depth + b"0" + b"]" * depth,
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422
    assert client.get(path).json()["revision"] == 1
    assert client.get(prefix + "/revisions").json()["total"] == 1
