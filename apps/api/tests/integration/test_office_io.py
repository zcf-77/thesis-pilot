"""Real PostgreSQL + real office-server sidecar + real Node office-wasm runner.

Synthetic thesis DOCX → import (parse + irMap) → confirm → edit → preserve-original export →
re-import and compare text; tracked export keeps revisions; regenerated DOCX and PDF are real
files. Fails (never skips) without TP_TEST_OFFICE_URL / TP_TEST_OFFICE_TOKEN.
"""

import base64
import io
import os
import re
import zipfile
from copy import deepcopy
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from office_docx import BODY_TEXTS, synthetic_thesis_docx

from thesis_pilot.modules.document_sources import office_service
from thesis_pilot.modules.document_sources.office_schemas import (
    OfficeImportConfirm,
    OfficeImportCreate,
)
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.schemas import DocumentSave
from thesis_pilot.modules.exports import service as exports
from thesis_pilot.modules.exports.schemas import DocumentExportCreate
from thesis_pilot.modules.materials import service as materials
from thesis_pilot.modules.materials.schemas import MaterialUpload
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.providers.office_server import OfficeServerClient
from thesis_pilot.workers.execution import execute_job

from .conftest import PostgreSQLSandbox

pytestmark = pytest.mark.integration
EDITED = "本文以合成的校园图书检索系统为例，说明系统的设计过程与实现。"


@pytest.fixture
def office(monkeypatch: pytest.MonkeyPatch) -> OfficeServerClient:
    url, token = os.environ.get("TP_TEST_OFFICE_URL"), os.environ.get("TP_TEST_OFFICE_TOKEN")
    if not url or not token:
        pytest.fail(
            "office 集成测试必须提供 TP_TEST_OFFICE_URL 与 TP_TEST_OFFICE_TOKEN；不能跳过。"
        )
    client = OfficeServerClient(url, token, timeout_seconds=120)
    monkeypatch.setattr(OfficeServerClient, "from_settings", classmethod(lambda cls: client))
    return client


def body_texts(office: OfficeServerClient, data: bytes) -> list[str]:
    model = office.parse_docx(data).model
    texts: list[str] = []

    def walk(blocks: list[dict[str, Any]]) -> None:
        for block in blocks:
            if block.get("type") in {"paragraph", "heading"}:
                texts.append("".join(i["text"] for i in block["inlines"] if i.get("type") == "run"))
            for row in block.get("rows", []):
                for cell in row["cells"]:
                    walk(cell["blocks"])

    for section in cast(list[dict[str, Any]], model["sections"]):
        walk(section["blocks"])
    return texts


def export_bytes(postgres: PostgreSQLSandbox, project: UUID, **body: Any) -> tuple[bytes, dict]:
    with postgres.sessions() as session:
        queued = exports.create_document_export(
            session, project, DocumentExportCreate.model_validate(body), str(uuid4())
        )
    assert execute_job(postgres.sessions, queued.job_id, 120)
    with postgres.sessions() as session:
        read = exports.get_export(session, project, queued.job_id)
        assert read.status == "succeeded", read.error_code
        _, data = exports.get_export_file(session, project, queued.job_id)
    return data, read.model_dump(mode="json")


def test_office_round_trip_against_real_sidecar(
    postgres: PostgreSQLSandbox, office: OfficeServerClient
) -> None:
    source = synthetic_thesis_docx()
    with postgres.sessions() as session:
        project = create_project(session, ProjectCreate(name="office 集成项目")).id
    with postgres.sessions() as session:
        receipt = materials.upload_material(
            session,
            project,
            MaterialUpload(
                name="自制论文初稿",
                filename="自制论文.docx",
                file_type="docx",
                kind="other",
                content_base64=base64.b64encode(source).decode(),
            ),
            str(uuid4()),
        )
    with postgres.sessions() as session:
        queued = office_service.create_import(
            session,
            project,
            OfficeImportCreate(material_id=receipt.material.id, original_id=receipt.original.id),
            str(uuid4()),
        )
    assert execute_job(postgres.sessions, queued.job_id, 120)
    with postgres.sessions() as session:
        read = office_service.get_import(session, project, queued.job_id)
    assert read.status == "succeeded", read.error_code
    preview = read.preview
    assert preview is not None and preview.can_create
    assert [c.title for c in preview.chapters][:2] == ["第一章 绪论", "研究背景"]
    assert any(loss.kind == "docx.inline" and loss.action == "protected" for loss in preview.losses)
    with postgres.sessions() as session:
        confirmed = office_service.confirm_import(
            session, project, queued.job_id, OfficeImportConfirm(command_id=uuid4(), mode="create")
        )
    with postgres.sessions() as session:
        current = documents.get_current_document(session, project)
    snapshot = deepcopy(current.content.model_dump(by_alias=True)["json"])
    blocks = snapshot["model"]["sections"][0]["blocks"]
    intro = next(
        b for b in blocks if b.get("inlines") and b["inlines"][0].get("text") == BODY_TEXTS["intro"]
    )
    intro["inlines"][0]["text"] = EDITED
    table = next(b for b in blocks if b["type"] == "table")
    table["rows"][1]["cells"][1]["blocks"][0]["inlines"][0]["text"] = "95 毫秒"
    with postgres.sessions() as session:
        saved = documents.save_document(
            session,
            project,
            confirmed.document_id,
            DocumentSave.model_validate(
                {"content": {"schema_version": 2, "json": snapshot}, "expected_version": 1}
            ),
        )
    version = saved.version
    common = {"document_id": confirmed.document_id, "document_version": version}

    preserved, read_preserved = export_bytes(
        postgres, project, **common, format="docx", office_mode="preserve"
    )
    report = read_preserved["report"]
    assert report["applied_changes"] == 2 and report["unsupported_changes"] == []
    texts = body_texts(office, preserved)
    assert EDITED in texts and "95 毫秒" in texts and BODY_TEXTS["intro"] not in texts
    document_xml = zipfile.ZipFile(io.BytesIO(preserved)).read("word/document.xml").decode()
    assert "m:oMath" in document_xml and "<w:ins" not in document_xml  # formula kept, clean
    assert office.inspect(preserved, ["revisions"])["revisions"]["revisions"] == []  # type: ignore[index]

    tracked, _ = export_bytes(
        postgres, project, **common, format="docx", office_mode="preserve", track_changes=True
    )
    revisions = office.inspect(tracked, ["revisions"])["revisions"]["revisions"]  # type: ignore[index]
    assert len(revisions) >= 2
    assert "<w:ins" in zipfile.ZipFile(io.BytesIO(tracked)).read("word/document.xml").decode()

    regenerated, read_regen = export_bytes(
        postgres, project, **common, format="docx", office_mode="regenerate"
    )
    assert regenerated.startswith(b"PK\x03\x04")
    assert EDITED in body_texts(office, regenerated)
    assert any(loss["kind"] == "object" for loss in read_regen["report"]["losses"])

    pdf, read_pdf = export_bytes(
        postgres, project, **common, format="pdf", office_mode="regenerate"
    )
    assert pdf.startswith(b"%PDF-")
    assert len(re.findall(rb"/Type\s*/Page(?!s)", pdf)) >= 1
    assert read_pdf["report"]["warning_total"] >= 0

    # The original's OMML formula is outside the native PDF converter's subset: explicit error.
    with postgres.sessions() as session:
        failing = exports.create_document_export(
            session,
            project,
            DocumentExportCreate.model_validate(
                {**common, "format": "pdf", "office_mode": "preserve"}
            ),
            str(uuid4()),
        )
    execute_job(postgres.sessions, failing.job_id, 120)
    with postgres.sessions() as session:
        failed = exports.get_export(session, project, failing.job_id)
    assert failed.status == "failed" and failed.error_code == "OFFICE_PDF_UNSUPPORTED"
