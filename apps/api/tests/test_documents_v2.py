"""Snapshot v2 over HTTP: save/CAS, explicit upgrade, ?as=v2, protections, resources."""

import base64
import struct
import zlib
from copy import deepcopy
from typing import Any
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.modules.documents.content import ContentView, NodeAnchor
from thesis_pilot.modules.documents.models import DocumentVersion
from thesis_pilot.modules.reviews.scope import chapters, extract_scope

LOCK = {"type": "aiLock"}
V1: dict[str, Any] = {
    "type": "doc",
    "content": [
        {
            "type": "heading",
            "attrs": {"chapterId": "chapter-a", "level": 1},
            "content": [{"type": "text", "text": "第一章"}],
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "样本"},
                {"type": "text", "text": "128🙂", "marks": [LOCK]},
                {"type": "text", "text": "例"},
            ],
        },
        {
            "type": "paragraph",
            "content": [{"type": "text", "text": "［锁定对象 1］公式", "marks": [LOCK]}],
        },
    ],
}


def project(client: TestClient) -> str:
    response = client.post("/api/v1/projects", json={"name": "正文 v2 自制项目"})
    assert response.status_code == 201
    return f"/api/v1/projects/{response.json()['id']}/documents"


def imported(client: TestClient) -> tuple[str, dict[str, Any]]:
    path = project(client)
    created = client.post(path, json={"content": {"schema_version": 1, "json": V1}})
    assert created.status_code == 201
    return path, created.json()


def upgrade(client: TestClient, path: str, document: dict[str, Any], **extra: Any) -> Any:
    body = {"command_id": str(uuid4()), "expected_version": document["version"], **extra}
    return client.post(f"{path}/{document['id']}/schema-upgrade", json=body)


def save(client: TestClient, path: str, document_id: str, version: int, snapshot: Any) -> Any:
    return client.patch(
        f"{path}/{document_id}",
        json={"expected_version": version, "content": {"schema_version": 2, "json": snapshot}},
    )


def editable(snapshot: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(snapshot)
    result.pop("chapters")
    return result


def test_upgrade_appends_v2_and_is_idempotent(client: TestClient) -> None:
    path, document = imported(client)
    command = str(uuid4())
    first = client.post(
        f"{path}/{document['id']}/schema-upgrade",
        json={"command_id": command, "expected_version": 1},
    )
    assert first.status_code == 201
    body = first.json()
    assert body["replayed"] is False
    assert body["document"]["version"] == 2
    content = body["document"]["content"]
    assert content["schema_version"] == 2
    assert content["json"]["schemaVersion"] == 2
    # Words: "样本128🙂例" (7) + the object placeholder paragraph "［锁定对象 1］公式" (9).
    assert content["json"]["chapters"] == [
        {"id": "chapter-a", "level": 1, "title": "第一章", "block": 0, "end": 3, "words": 16}
    ]
    kinds = [item["kind"] for item in content["json"]["protections"]]
    assert kinds == ["lock", "object"]
    record = body["upgrade"]
    assert (record["from_version"], record["to_version"], record["loss_report"]) == (1, 2, [])
    assert len(record["converter_sha256"]) == 64
    replay = client.post(
        f"{path}/{document['id']}/schema-upgrade",
        json={"command_id": command, "expected_version": 1},
    )
    assert replay.status_code == 200 and replay.json()["replayed"] is True
    assert replay.json()["upgrade"] == record
    reused = client.post(
        f"{path}/{document['id']}/schema-upgrade",
        json={"command_id": command, "expected_version": 2},
    )
    assert reused.json()["error"]["code"] == "DOCUPGRADE_COMMAND_REUSED"
    again = upgrade(client, path, body["document"])
    assert again.json()["error"]["code"] == "DOCUPGRADE_ALREADY_UPGRADED"
    history = client.get(f"{path}/{document['id']}/versions").json()
    assert [item["source"] for item in history["items"]] == ["schema_upgrade", "local_import"]
    # The stored v1 version is untouched.
    old = client.get(f"{path}/{document['id']}/versions/1").json()
    assert old["content"] == document["content"] and old["converted"] is False


def test_upgrade_requires_current_version(client: TestClient) -> None:
    path, document = imported(client)
    stale = client.post(
        f"{path}/{document['id']}/schema-upgrade",
        json={"command_id": str(uuid4()), "expected_version": 2},
    )
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "DOCUMENT_VERSION_CONFLICT"


def test_schema_rules_on_save(client: TestClient) -> None:
    path, document = imported(client)
    v2 = client.get(f"{path}/{document['id']}/versions/1?as=v2").json()
    assert v2["converted"] is True and v2["content"]["schema_version"] == 2
    early = save(client, path, document["id"], 1, editable(v2["content"]["json"]))
    assert early.status_code == 409 and early.json()["error"]["code"] == "DOCMODEL_SCHEMA_MISMATCH"
    upgraded = upgrade(client, path, document).json()["document"]
    stale_v1 = client.patch(
        f"{path}/{document['id']}",
        json={"expected_version": 2, "content": {"schema_version": 1, "json": V1}},
    )
    assert stale_v1.json()["error"]["code"] == "DOCMODEL_SCHEMA_MISMATCH"
    snapshot = editable(upgraded["content"]["json"])
    # The converter merged the three v1 runs; the lock covers scalars [2, 6).
    assert snapshot["model"]["sections"][0]["blocks"][1]["inlines"] == [
        {"type": "run", "text": "样本128🙂例"}
    ]
    snapshot["model"]["sections"][0]["blocks"][1]["inlines"][0]["text"] = "样本128🙂例数"
    saved = save(client, path, document["id"], 2, snapshot)
    assert saved.status_code == 200 and saved.json()["version"] == 3
    conflict = save(client, path, document["id"], 2, snapshot)
    assert conflict.json()["error"]["code"] == "DOCUMENT_VERSION_CONFLICT"
    # Supplied chapters are only shape-checked; the server recomputes them.
    snapshot["chapters"] = [
        {"id": "chapter-a", "level": 2, "title": "旧", "block": 9, "end": 9, "words": 0}
    ]
    recomputed = save(client, path, document["id"], 3, snapshot)
    assert recomputed.status_code == 200
    assert recomputed.json()["content"]["json"]["chapters"][0]["level"] == 1
    snapshot["chapters"] = [{"id": "chapter-a", "level": 1}]
    malformed = save(client, path, document["id"], 4, snapshot)
    assert malformed.json()["error"]["code"] == "DOCMODEL_INVALID"
    unknown = editable(upgraded["content"]["json"])
    unknown["model"]["sections"][0]["blocks"].append(
        {"type": "container", "id": "x", "kind": "c", "blocks": []}
    )
    assert (
        save(client, path, document["id"], 4, unknown).json()["error"]["code"] == "DOCMODEL_INVALID"
    )


def test_protections_are_preserved_and_cannot_be_forged(client: TestClient) -> None:
    path, document = imported(client)
    upgraded = upgrade(client, path, document).json()["document"]
    base = editable(upgraded["content"]["json"])
    lock, obj = base["protections"]
    paragraph, placeholder = base["model"]["sections"][0]["blocks"][1:3]

    # Inserting text before the lock moves its offsets; same text → accepted.
    moved = deepcopy(base)
    moved["model"]["sections"][0]["blocks"][1]["inlines"][0]["text"] = "全部样本128🙂例"
    moved["protections"][0]["anchor"] = {"node": paragraph["id"], "start": 4, "end": 8}
    first = save(client, path, document["id"], 2, moved)
    assert first.status_code == 200, first.json()
    version = 3

    edited_lock = deepcopy(moved)
    edited_lock["model"]["sections"][0]["blocks"][1]["inlines"][0]["text"] = "全部样本129🙂例"
    response = save(client, path, document["id"], version, edited_lock)
    assert response.json()["error"]["code"] == "DOCMODEL_PROTECTION_VIOLATED"

    edited_object = deepcopy(moved)
    edited_object["model"]["sections"][0]["blocks"][2]["props"] = {"align": "center"}
    response = save(client, path, document["id"], version, edited_object)
    assert response.json()["error"]["code"] == "DOCMODEL_PROTECTION_VIOLATED"

    deleted_object = deepcopy(moved)
    del deleted_object["model"]["sections"][0]["blocks"][2]
    deleted_object["protections"] = [deleted_object["protections"][0]]
    response = save(client, path, document["id"], version, deleted_object)
    assert response.json()["error"]["code"] == "DOCMODEL_PROTECTION_VIOLATED"

    forged = deepcopy(moved)
    forged["protections"].append(
        {"id": "c1", "kind": "citation", "anchor": {"node": paragraph["id"], "start": 0, "end": 1}}
    )
    response = save(client, path, document["id"], version, forged)
    assert response.json()["error"]["code"] == "DOCMODEL_PROTECTION_FORGED"

    # The user may remove their own lock, and add a new one.
    unlocked = deepcopy(moved)
    unlocked["protections"] = [
        obj,
        {"id": "mine", "kind": "lock", "anchor": {"node": placeholder["id"]}},
    ]
    response = save(client, path, document["id"], version, unlocked)
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["content"]["json"]["protections"]] == [
        obj["id"],
        "mine",
    ]
    assert lock["id"] != "mine"


def png(width: int = 2, height: int = 3) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    raw = b"".join(b"\x00" + b"\x00\x00\x00" * width for _ in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def test_resources_are_content_addressed_and_project_scoped(client: TestClient) -> None:
    path, document = imported(client)
    data = png()
    payload = {"mime": "image/png", "content_base64": base64.b64encode(data).decode()}
    first = client.post(f"{path}/resources", json=payload)
    assert first.status_code == 201
    resource = first.json()
    assert (resource["width_px"], resource["height_px"], resource["byte_size"]) == (2, 3, len(data))
    assert resource["uri"] == "tp-resource:" + resource["sha256"]
    again = client.post(f"{path}/resources", json=payload)
    assert again.status_code == 200 and again.json()["sha256"] == resource["sha256"]
    fetched = client.get(f"{path}/resources/{resource['sha256']}")
    assert fetched.content == data and fetched.headers["content-type"] == "image/png"
    assert fetched.headers["x-content-type-options"] == "nosniff"
    wrong = client.post(f"{path}/resources", json={**payload, "mime": "image/jpeg"})
    assert wrong.json()["error"]["code"] == "DOCMODEL_RESOURCE_INVALID"
    other = project(client)
    assert client.get(f"{other}/resources/{resource['sha256']}").status_code == 404

    upgraded = upgrade(client, path, document).json()["document"]
    snapshot = editable(upgraded["content"]["json"])
    snapshot["model"]["resources"] = [
        {"id": "img-1", "mime": "image/png", "data": {"kind": "uri", "value": resource["uri"]}}
    ]
    snapshot["model"]["sections"][0]["blocks"].append(
        {"type": "image", "id": "fig-1", "resource": "img-1"}
    )
    assert save(client, path, document["id"], 2, snapshot).status_code == 200
    missing = deepcopy(snapshot)
    missing["model"]["resources"][0]["data"]["value"] = "tp-resource:" + "0" * 64
    response = save(client, path, document["id"], 3, missing)
    assert response.json()["error"]["code"] == "DOCMODEL_RESOURCE_MISSING"


def test_revert_to_a_v1_target_appends_a_converted_v2_version(client: TestClient) -> None:
    path, document = imported(client)
    upgrade(client, path, document)
    project_id = path.split("/")[4]
    response = client.post(
        f"/api/v1/projects/{project_id}/documents/{document['id']}/revert",
        json={"command_id": str(uuid4()), "expected_document_version": 2, "target_version": 1},
    )
    assert response.status_code == 200, response.json()
    current = client.get(f"{path}/current").json()
    assert current["version"] == 3 and current["content"]["schema_version"] == 2
    assert current["content"]["json"]["chapters"][0]["id"] == "chapter-a"


def test_read_facade_over_both_schemas(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    path, document = imported(client)
    upgrade(client, path, document)
    with session_factory() as session:
        rows = {
            row.version: row
            for row in session.query(DocumentVersion).filter_by(document_id=UUID(document["id"]))
        }
        v1, v2 = ContentView.from_version(rows[1]), ContentView.from_version(rows[2])
    assert [c.chapter_id for c in v1.chapters()] == [c.chapter_id for c in v2.chapters()]
    assert v1.has_chapter("chapter-a") and v2.has_chapter("chapter-a")
    assert v1.textblock_texts() == v2.textblock_texts()
    assert v1.flatten_text() == v2.flatten_text()
    assert [b.text for b in v1.chapter_blocks("chapter-a")] == [
        b.text for b in v2.chapter_blocks("chapter-a")
    ]
    scope_v1, scope_v2 = extract_scope(v1, "chapter-a"), extract_scope(v2, "chapter-a")
    assert [b["text"] for b in scope_v1["blocks"]] == [b["text"] for b in scope_v2["blocks"]]
    assert "schema_version" not in scope_v1 and scope_v2["schema_version"] == 2
    assert chapters(v2) == chapters(v1)
    paragraph = v2.top_blocks()[1]
    assert paragraph.node_id is not None
    span = v2.resolve_node_anchor(
        NodeAnchor(node_id=paragraph.node_id, start=2, end=6, expected_text="128🙂")
    )
    assert span.block_text == "样本128🙂例"
    assert v1.inspection_counts()["heading_count"] == v2.inspection_counts()["heading_count"] == 1
    for call in (
        v2.legacy_json,
        lambda: v1.resolve_node_anchor(NodeAnchor(node_id="x", start=0, end=1, expected_text="x")),
    ):
        try:
            call()
        except Exception as error:  # noqa: BLE001 - asserting the AppError code
            assert getattr(error, "code", "").startswith("DOCMODEL_")
        else:
            raise AssertionError("v1-only access on v2 content must be refused")


def test_v1_only_features_refuse_v2_manuscripts(client: TestClient) -> None:
    path, document = imported(client)
    upgraded = upgrade(client, path, document).json()["document"]
    project_id = path.split("/")[4]
    export = client.post(
        f"/api/v1/projects/{project_id}/exports/documents",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "document_id": document["id"],
            "document_version": upgraded["version"],
            "format": "markdown",
        },
    )
    assert export.json()["error"]["code"] == "DOCMODEL_SCHEMA_UNSUPPORTED"
