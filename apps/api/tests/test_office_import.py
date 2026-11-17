"""DOCX import through a fake office-server: preview, confirm, idempotency, cancel/late."""

import base64
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from office_docx import synthetic_thesis_docx
from office_fakes import FakeOffice, problem
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.modules.document_sources import office_jobs
from thesis_pilot.modules.document_sources.office_models import DocumentOfficeSource, OfficeImport
from thesis_pilot.modules.documents.models import DocumentResource
from thesis_pilot.modules.jobs.service import claim_job
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


def upload_docx(client: TestClient, project: str, data: bytes | None = None) -> tuple[str, str]:
    response = client.post(
        f"{API}/projects/{project}/materials",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "name": "自制论文初稿",
            "filename": "自制论文.docx",
            "file_type": "docx",
            "kind": "other",
            "content_base64": base64.b64encode(data or synthetic_thesis_docx()).decode(),
        },
    )
    assert response.status_code == 201, response.text
    receipt = response.json()
    return receipt["material"]["id"], receipt["original"]["id"]


def start(client: TestClient, project: str, material: str, original: str) -> dict:
    response = client.post(
        f"{API}/projects/{project}/office-imports",
        headers={"Idempotency-Key": str(uuid4())},
        json={"material_id": material, "original_id": original},
    )
    assert response.status_code == 202, response.text
    return response.json()


def imported_preview(
    client: TestClient, factory: sessionmaker[Session], project: str | None = None
) -> tuple[str, dict]:
    project = project or client.post(f"{API}/projects", json={"name": "导入自制项目"}).json()["id"]
    material, original = upload_docx(client, project)
    queued = start(client, project, material, original)
    assert queued["status"] == "queued" and queued["preview"] is None
    assert execute_job(factory, UUID(queued["job_id"]), 60)
    read = client.get(f"{API}/projects/{project}/office-imports/{queued['job_id']}").json()
    assert read["status"] == "succeeded", read
    return project, read


def confirm(client: TestClient, project: str, job: str, **body: object):
    return client.post(
        f"{API}/projects/{project}/office-imports/{job}/confirm",
        json={"command_id": str(uuid4()), **body},
    )


def test_preview_lists_losses_objects_and_chapters_without_writing(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeOffice
) -> None:
    project, read = imported_preview(client, session_factory)
    preview = read["preview"]
    assert preview["can_create"] and not preview["can_append"]
    assert [c["title"] for c in preview["chapters"]] == [
        "第一章 绪论",
        "研究背景",
        "第二章 系统设计",
        "参考文献",
    ]
    assert preview["table_count"] == 1 and preview["image_count"] == 1
    kinds = {loss["kind"]: loss for loss in preview["losses"]}
    assert kinds["docx.inline"]["action"] == "protected"
    assert kinds["docx.inline"]["node_id"] == preview["objects"][0]["node_id"]
    assert kinds["docx.theme"]["action"] == "noted"
    # Previewing never creates a manuscript.
    assert client.get(f"{API}/projects/{project}/documents/current").status_code == 404
    assert [path for path, _ in fake.requests] == ["/v1/parse", "/v1/docs/inspect"]
    assert fake.requests[1][1]["spec"]["include"] == ["irMap", "index"]  # type: ignore[index]
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(DocumentResource)) == 1


def test_confirm_creates_v2_manuscript_with_object_protection_and_is_idempotent(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeOffice
) -> None:
    project, read = imported_preview(client, session_factory)
    command = str(uuid4())
    url = f"{API}/projects/{project}/office-imports/{read['job_id']}/confirm"
    first = client.post(url, json={"command_id": command, "mode": "create"})
    assert first.status_code == 201, first.text
    again = client.post(url, json={"command_id": command, "mode": "create"})
    assert again.json() == first.json()
    conflict = client.post(
        url, json={"command_id": command, "mode": "new_version", "expected_version": 1}
    )
    assert conflict.json()["error"]["code"] == "OFFICE_IMPORT_COMMAND_CONFLICT"
    document = client.get(f"{API}/projects/{project}/documents/current").json()
    assert document["version"] == 1 and document["content"]["schema_version"] == 2
    snapshot = document["content"]["json"]
    protection = snapshot["protections"][0]
    assert protection["kind"] == "object"
    assert protection["anchor"]["node"] == read["preview"]["objects"][0]["node_id"]
    resources = snapshot["model"]["resources"]
    assert resources[0]["data"]["value"].startswith("tp-resource:")
    source = client.get(f"{API}/projects/{project}/documents/{document['id']}/office-source").json()
    assert source["document_version"] == 1 and source["filename"] == "自制论文.docx"
    versions = client.get(f"{API}/projects/{project}/documents/{document['id']}/versions").json()
    assert versions["items"][0]["source"] == "office_import"
    # A second "create" is refused; the existing manuscript stays.
    again_create = confirm(client, project, read["job_id"], mode="create")
    assert again_create.json()["error"]["code"] == "DOCUMENT_ALREADY_EXISTS"


def test_confirm_as_new_version_checks_the_expected_version(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeOffice
) -> None:
    project, read = imported_preview(client, session_factory)
    assert confirm(client, project, read["job_id"], mode="create").status_code == 201
    second = start(client, project, read["material_id"], read["original_id"])
    assert execute_job(session_factory, UUID(second["job_id"]), 60)
    preview = client.get(f"{API}/projects/{project}/office-imports/{second['job_id']}").json()
    assert preview["preview"]["can_append"] and preview["preview"]["existing_version"] == 1
    stale = confirm(client, project, second["job_id"], mode="new_version", expected_version=7)
    assert stale.json()["error"]["code"] == "DOCUMENT_VERSION_CONFLICT"
    ok = confirm(client, project, second["job_id"], mode="new_version", expected_version=1)
    assert ok.status_code == 201 and ok.json()["document_version"] == 2
    missing = confirm(client, project, second["job_id"], mode="new_version")
    assert missing.status_code == 422
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(DocumentOfficeSource)) == 2


def test_cancelled_or_superseded_run_stores_no_preview(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeOffice
) -> None:
    project = client.post(f"{API}/projects", json={"name": "取消导入"}).json()["id"]
    material, original = upload_docx(client, project)
    queued = start(client, project, material, original)
    job_id = UUID(queued["job_id"])
    claim = claim_job(session_factory, job_id, 60)
    assert claim is not None
    loaded = office_jobs.load_original(session_factory, claim)
    assert loaded is not None
    build = office_jobs.convert(fake.client(), loaded)
    cancelled = client.post(f"{API}/projects/{project}/office-imports/{job_id}/cancel").json()
    assert cancelled["status"] == "cancelled"
    # The late result arrives after cancellation: nothing is stored.
    assert office_jobs.finish_office_import(session_factory, claim, loaded, build) is False
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(OfficeImport)) == 0
        assert session.scalar(select(func.count()).select_from(DocumentResource)) == 0
    late = confirm(client, project, str(job_id), mode="create")
    assert late.json()["error"]["code"] == "OFFICE_IMPORT_NOT_READY"
    retried = client.post(
        f"{API}/projects/{project}/office-imports/{job_id}/retry",
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert retried.status_code == 202 and retried.json()["source_job_id"] == str(job_id)
    assert retried.json()["original_sha256"] == queued["original_sha256"]


def test_sidecar_failure_is_an_explicit_job_error(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeOffice
) -> None:
    fake.overrides["/v1/parse"] = lambda _: problem(422, "SOURCE_INVALID")
    project = client.post(f"{API}/projects", json={"name": "坏原件"}).json()["id"]
    material, original = upload_docx(client, project)
    queued = start(client, project, material, original)
    execute_job(session_factory, UUID(queued["job_id"]), 60)
    read = client.get(f"{API}/projects/{project}/office-imports/{queued['job_id']}").json()
    assert read["status"] == "failed" and read["error_code"] == "OFFICE_SOURCE_INVALID"


def test_mismatched_ir_map_is_refused(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeOffice
) -> None:
    fake.overrides["/v1/docs/inspect"] = lambda _: __import__("httpx").Response(
        200,
        json={"protocol": "office-kernel-1", "result": {"irMap": {"sourceSha256": "0" * 64}}},
    )
    project = client.post(f"{API}/projects", json={"name": "映射不符"}).json()["id"]
    material, original = upload_docx(client, project)
    queued = start(client, project, material, original)
    execute_job(session_factory, UUID(queued["job_id"]), 60)
    read = client.get(f"{API}/projects/{project}/office-imports/{queued['job_id']}").json()
    assert read["error_code"] == "OFFICE_IMPORT_INVALID"


def test_only_docx_originals_and_entry_point(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeOffice
) -> None:
    project = client.post(f"{API}/projects", json={"name": "入口"}).json()["id"]
    text = client.post(
        f"{API}/projects/{project}/materials",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "name": "说明",
            "filename": "说明.txt",
            "file_type": "text",
            "kind": "other",
            "content_base64": base64.b64encode("自制文本".encode()).decode(),
        },
    ).json()
    refused = client.post(
        f"{API}/projects/{project}/office-imports",
        headers={"Idempotency-Key": str(uuid4())},
        json={"material_id": text["material"]["id"], "original_id": text["original"]["id"]},
    )
    assert refused.json()["error"]["code"] == "OFFICE_IMPORT_UNSUPPORTED_TYPE"
    direct = client.post(
        f"{API}/jobs",
        headers={"Idempotency-Key": str(uuid4())},
        json={"project_id": project, "kind": "office_import"},
    )
    assert direct.status_code == 422
    other = client.post(f"{API}/projects", json={"name": "别的项目"}).json()["id"]
    _, read = imported_preview(client, session_factory)
    cross = client.get(f"{API}/projects/{other}/office-imports/{read['job_id']}")
    assert cross.status_code == 404
