"""Word/PDF exports and v2 text exports with a fake sidecar and a fake Node runner."""

import json
from copy import deepcopy
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from office_docx import synthetic_thesis_docx
from office_fakes import FakeOffice, problem, recorded
from sqlalchemy.orm import Session, sessionmaker
from test_office_import import confirm, imported_preview

from thesis_pilot.modules.document_sources.office_snapshot import build_import
from thesis_pilot.modules.exports import office_render
from thesis_pilot.modules.exports.office_plan import plan_preserve
from thesis_pilot.providers.office_runner import RunnerResult
from thesis_pilot.providers.office_server import OfficeServerClient
from thesis_pilot.workers.execution import execute_job

API = "/api/v1"


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeOffice:
    office = FakeOffice()
    monkeypatch.setattr(
        OfficeServerClient, "from_settings", classmethod(lambda cls: office.client())
    )
    return office


@pytest.fixture
def runner(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    calls: list[dict] = []

    def fake_runner(model: dict, **_: object) -> RunnerResult:
        calls.append(model)
        return RunnerResult(
            b"PK\x03\x04regenerated", "0.1.0", [{"kind": "docx.toc", "path": "/sections/0"}]
        )

    monkeypatch.setattr(office_render, "model_to_docx", fake_runner)
    return calls


def baseline() -> tuple[dict, dict]:
    from hashlib import sha256

    parsed = recorded("thesis-parse.json")
    ir_map = recorded("thesis-inspect.json")["result"]["irMap"]  # type: ignore[index]
    ir_map["sourceSha256"] = sha256(synthetic_thesis_docx()).hexdigest()  # type: ignore[index]
    build = build_import(
        parsed["model"],  # type: ignore[arg-type]
        parsed["unsupported"],  # type: ignore[arg-type]
        parsed["converted"],  # type: ignore[arg-type]
        ir_map,
        ir_map["sourceSha256"],  # type: ignore[index]
    )
    return build.snapshot, build.ir_map


def blocks(snapshot: dict) -> list[dict]:
    return snapshot["model"]["sections"][0]["blocks"]


def set_text(block: dict, text: str) -> None:
    block["inlines"] = [{"type": "run", "text": text}]


def test_plan_maps_same_paragraph_text_edits_and_reports_the_rest() -> None:
    snapshot, ir_map = baseline()
    target = deepcopy(snapshot)
    body = blocks(target)
    set_text(body[2], "本文以自制的校园图书检索系统为例，详细说明系统的设计过程。")
    body[4]["inlines"][0]["text"] = "高校图书馆馆藏持续增长。"
    cell = body[5]["rows"][1]["cells"][1]["blocks"][0]
    set_text(cell, "95 毫秒")
    body[3]["level"] = 3
    body.insert(
        6, {"type": "paragraph", "id": "new-block", "inlines": [{"type": "run", "text": "补充"}]}
    )
    body[2]["inlines"][0]["props"] = {"bold": True}
    plan = plan_preserve(snapshot["model"], target["model"], ir_map)
    ops = {op["target"]["path"]: op for op in plan.ops}
    assert ops["b2"] == {
        "op": "text.insert",
        "id": "n2",
        "target": {"path": "b2", "start": 17, "end": 17},
        "text": "详细",
    }
    assert (
        ops["b4"]["op"] == "text.delete" and ops["b4"]["expectedText"] == "，读者检索效率有待提升"
    )
    assert ops["b5/r1/c1/p0"]["expectedText"] == "120" and ops["b5/r1/c1/p0"]["text"] == "95"
    kinds = sorted(item["kind"] for item in plan.unsupported)
    assert kinds == ["format", "format", "inserted"]
    # UTF-16 offsets: a supplementary-plane character counts two code units.
    surrogate = deepcopy(snapshot)
    set_text(blocks(surrogate)[2], "𠀀" + "本文以自制的校园图书检索系统为例，说明系统的设计过程。")
    after = deepcopy(surrogate)
    set_text(blocks(after)[2], "𠀀" + "本文以合成的校园图书检索系统为例，说明系统的设计过程。")
    edit = plan_preserve(surrogate["model"], after["model"], ir_map).ops[0]
    assert edit["target"]["start"] == 5 and edit["expectedText"] == "自制"


def test_plan_reports_removed_reordered_and_object_changes() -> None:
    snapshot, ir_map = baseline()
    target = deepcopy(snapshot)
    body = blocks(target)
    removed = body.pop(4)
    body[0], body[1] = body[1], body[0]
    body[5]["inlines"][0]["alt"] = "改过的替代文字"
    plan = plan_preserve(snapshot["model"], target["model"], ir_map)
    kinds = {item["kind"] for item in plan.unsupported}
    assert {"removed", "order", "inline_object"} <= kinds
    assert any(item["node_id"] == removed["id"] for item in plan.unsupported)
    assert plan.ops == []


def edited_manuscript(client: TestClient, project: str) -> tuple[str, int]:
    document = client.get(f"{API}/projects/{project}/documents/current").json()
    snapshot = document["content"]["json"]
    set_text(blocks(snapshot)[2], "本文以合成的校园图书检索系统为例，说明系统的设计过程。")
    saved = client.patch(
        f"{API}/projects/{project}/documents/{document['id']}",
        json={"content": {"schema_version": 2, "json": snapshot}, "expected_version": 1},
    )
    assert saved.status_code == 200, saved.text
    return document["id"], saved.json()["version"]


def export(client: TestClient, project: str, body: dict):
    return client.post(
        f"{API}/projects/{project}/exports/documents",
        json=body,
        headers={"Idempotency-Key": str(uuid4())},
    )


def run(client: TestClient, factory: sessionmaker[Session], project: str, body: dict) -> dict:
    queued = export(client, project, body)
    assert queued.status_code == 202, queued.text
    execute_job(factory, UUID(queued.json()["job_id"]), 60)
    return client.get(f"{API}/projects/{project}/exports/{queued.json()['job_id']}").json()


def test_preserve_docx_writes_text_edits_into_the_original_and_accepts_them(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeOffice
) -> None:
    project, read = imported_preview(client, session_factory)
    assert confirm(client, project, read["job_id"], mode="create").status_code == 201
    document, version = edited_manuscript(client, project)
    fake.requests.clear()
    body = {"document_id": document, "document_version": version, "format": "docx"}
    result = run(client, session_factory, project, {**body, "office_mode": "preserve"})
    assert result["status"] == "succeeded", result
    report = result["report"]
    assert report["mode"] == "preserve" and report["applied_changes"] == 1
    assert report["baseline_version"] == 1 and report["unsupported_changes"] == []
    first, second = fake.requests
    assert first[0] == second[0] == "/v1/docs/transactions"
    assert first[1]["spec"]["ops"] == [  # type: ignore[index]
        {
            "op": "text.replace",
            "id": "n2",
            "target": {"path": "b2", "start": 3, "end": 5},
            "expectedText": "自制",
            "text": "合成",
        }
    ]
    assert first[1]["spec"]["author"] == "ThesisPilot"  # type: ignore[index]
    assert second[1]["spec"]["ops"][0]["op"] == "revision.accept"  # type: ignore[index]
    download = client.get(f"{API}/projects/{project}/exports/{result['job_id']}/download")
    assert download.content == synthetic_thesis_docx() + b"tracked" + b"clean"
    assert download.headers["content-type"].startswith("application/vnd.openxmlformats")
    tracked = run(
        client,
        session_factory,
        project,
        {**body, "office_mode": "preserve", "track_changes": True},
    )
    assert tracked["file"]["filename"] == f"论文正文-修订版-v{version}.docx"
    assert tracked["report"]["track_changes"] is True
    tracked_bytes = client.get(f"{API}/projects/{project}/exports/{tracked['job_id']}/download")
    assert tracked_bytes.content.endswith(b"tracked")


def test_pdf_reports_kernel_warnings_and_unsupported_pdf_is_explicit(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeOffice, runner: list
) -> None:
    project, read = imported_preview(client, session_factory)
    assert confirm(client, project, read["job_id"], mode="create").status_code == 201
    document = client.get(f"{API}/projects/{project}/documents/current").json()["id"]
    body = {"document_id": document, "document_version": 1, "format": "pdf"}
    pdf = run(client, session_factory, project, {**body, "office_mode": "regenerate"})
    assert pdf["status"] == "succeeded", pdf
    assert pdf["report"]["warnings"][0]["code"] == "pdf.font_substitution"
    assert pdf["report"]["warning_total"] == 1
    losses = {loss["kind"] for loss in pdf["report"]["losses"]}
    assert losses == {"docx.toc", "object"}
    # The runner receives image bytes inline, never the tp-resource URI.
    resource = runner[0]["resources"][0]
    assert resource["data"]["kind"] == "bytes"
    assert "header" not in runner[0]["sections"][0]
    fake.overrides["/v1/pdf"] = lambda _: problem(422, "PDF_UNSUPPORTED")
    failed = run(client, session_factory, project, {**body, "office_mode": "preserve"})
    assert failed["status"] == "failed" and failed["error_code"] == "OFFICE_PDF_UNSUPPORTED"


def test_preserve_requires_an_imported_original_and_options_are_validated(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    project = client.post(f"{API}/projects", json={"name": "无原件"}).json()["id"]
    created = client.post(
        f"{API}/projects/{project}/documents",
        json={
            "content": {
                "schema_version": 1,
                "json": {"type": "doc", "content": [{"type": "paragraph"}]},
            }
        },
    ).json()["id"]
    base = {"document_id": created, "document_version": 1}
    missing = export(client, project, {**base, "format": "docx", "office_mode": "preserve"})
    assert missing.json()["error"]["code"] == "EXPORT_OFFICE_SOURCE_MISSING"
    assert export(client, project, {**base, "format": "docx"}).status_code == 422
    assert (
        export(client, project, {**base, "format": "html", "office_mode": "regenerate"}).status_code
        == 422
    )
    tracked = {**base, "format": "docx", "office_mode": "regenerate", "track_changes": True}
    assert export(client, project, tracked).status_code == 422
    assert (
        export(client, project, {**base, "format": "pdf", "office_mode": "regenerate"}).status_code
        == 202
    )


def test_runner_missing_node_fails_explicitly(
    client: TestClient, session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    from thesis_pilot.providers import office_runner

    monkeypatch.setattr(office_runner, "node_binary", lambda: None)
    project = client.post(f"{API}/projects", json={"name": "无 Node"}).json()["id"]
    created = client.post(
        f"{API}/projects/{project}/documents",
        json={
            "content": {
                "schema_version": 1,
                "json": {"type": "doc", "content": [{"type": "paragraph"}]},
            }
        },
    ).json()["id"]
    result = run(
        client,
        session_factory,
        project,
        {
            "document_id": created,
            "document_version": 1,
            "format": "docx",
            "office_mode": "regenerate",
        },
    )
    assert result["status"] == "failed" and result["error_code"] == "OFFICE_RUNNER_UNAVAILABLE"


def test_v2_text_exports_render_the_snapshot(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeOffice
) -> None:
    project, read = imported_preview(client, session_factory)
    assert confirm(client, project, read["job_id"], mode="create").status_code == 201
    document = client.get(f"{API}/projects/{project}/documents/current").json()["id"]
    outputs = {}
    for fmt in ("html", "markdown", "txt"):
        result = run(
            client,
            session_factory,
            project,
            {"document_id": document, "document_version": 1, "format": fmt},
        )
        assert result["status"] == "succeeded", result
        assert result["report"] is None
        outputs[fmt] = client.get(
            f"{API}/projects/{project}/exports/{result['job_id']}/download"
        ).text
    assert "<h1" in outputs["html"] and "<table>" in outputs["html"]
    assert "［原件对象，未随正文导出］" in outputs["html"]
    assert "# 第一章 绪论" in outputs["markdown"] and "| 指标 | 数值 |" in outputs["markdown"]
    assert "［图：系统示意图］" in outputs["txt"] and "1 处原件对象" in outputs["txt"]
    # Same input, same bytes.
    again = run(
        client,
        session_factory,
        project,
        {"document_id": document, "document_version": 1, "format": "markdown"},
    )
    assert (
        client.get(f"{API}/projects/{project}/exports/{again['job_id']}/download").text
        == outputs["markdown"]
    )
    assert json.dumps(outputs, ensure_ascii=False).count("tp-resource") == 0
