"""SG-13B export invariants on real PostgreSQL with synthetic manuscripts only."""

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from alembic import command
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import DBAPIError

from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.schemas import DocumentImport, DocumentSave
from thesis_pilot.modules.exports import service
from thesis_pilot.modules.exports.jobs import RenderedExport, finish_export_job
from thesis_pilot.modules.exports.models import ExportFile
from thesis_pilot.modules.exports.schemas import ChangeRecordCreate, DocumentExportCreate
from thesis_pilot.modules.jobs.models import Job, JobArtifact, OutboxEvent
from thesis_pilot.modules.jobs.service import cancel_job, claim_job, retry_job
from thesis_pilot.workers.execution import execute_job

from .conftest import PostgreSQLSandbox
from .test_services import make_project

pytestmark = pytest.mark.integration


def content(body: str) -> dict:
    return {
        "schema_version": 1,
        "json": {
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 1, "chapterId": "intro"},
                    "content": [{"type": "text", "text": "合成论文"}],
                },
                {"type": "paragraph", "content": [{"type": "text", "text": body}]},
            ],
        },
    }


def seeded(postgres: PostgreSQLSandbox) -> tuple[UUID, UUID]:
    project_id = make_project(postgres)
    with postgres.sessions() as session:
        document = documents.import_document(
            session, project_id, DocumentImport.model_validate({"content": content("初稿。")})
        )
    with postgres.sessions() as session:
        documents.save_document(
            session,
            project_id,
            document.id,
            DocumentSave.model_validate({"content": content("第二稿。"), "expected_version": 1}),
        )
    return project_id, document.id


def test_concurrent_same_key_creates_one_job_and_outbox(postgres: PostgreSQLSandbox) -> None:
    project_id, document_id = seeded(postgres)
    data = DocumentExportCreate(document_id=document_id, document_version=1, format="html")
    barrier = Barrier(4)

    def submit(_: int) -> UUID:
        barrier.wait()
        with postgres.sessions() as session:
            return service.create_document_export(session, project_id, data, "same-export").job_id

    with ThreadPoolExecutor(4) as pool:
        ids = set(pool.map(submit, range(4)))
    assert len(ids) == 1
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 1
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_export_and_retry_produce_identical_bytes_from_fixed_version(
    postgres: PostgreSQLSandbox,
) -> None:
    project_id, document_id = seeded(postgres)
    with postgres.sessions() as session:
        first = service.create_document_export(
            session,
            project_id,
            DocumentExportCreate(document_id=document_id, document_version=1, format="txt"),
            str(uuid4()),
        )
    assert execute_job(postgres.sessions, first.job_id, 60)
    with postgres.sessions() as session:
        documents.save_document(
            session,
            project_id,
            document_id,
            DocumentSave.model_validate({"content": content("第三稿。"), "expected_version": 2}),
        )
    with postgres.sessions() as session:
        again = retry_job(
            session, first.job_id, str(uuid4()), include_diagnostic=False, project_id=project_id
        )
    assert execute_job(postgres.sessions, again.id, 60)
    with postgres.sessions() as session:
        _, original = service.get_export_file(session, project_id, first.job_id)
        _, retried = service.get_export_file(session, project_id, again.id)
    assert original == retried and "初稿" in original.decode() and "第三稿" not in original.decode()


def test_change_record_range_is_frozen_at_enqueue(postgres: PostgreSQLSandbox) -> None:
    project_id, document_id = seeded(postgres)
    with postgres.sessions() as session:
        queued = service.create_change_record(
            session,
            project_id,
            ChangeRecordCreate(document_id=document_id, from_version=1, format="markdown"),
            str(uuid4()),
        )
    assert queued.document_version == 2
    with postgres.sessions() as session:
        documents.save_document(
            session,
            project_id,
            document_id,
            DocumentSave.model_validate({"content": content("范围外。"), "expected_version": 2}),
        )
    assert execute_job(postgres.sessions, queued.job_id, 60)
    with postgres.sessions() as session:
        file, data = service.get_export_file(session, project_id, queued.job_id)
    record = data.decode()
    assert file.from_version == 1 and file.document_version == 2
    assert "## v2 · 手动保存" in record and "v3" not in record
    assert "不代表导师已审阅或认可" in record


def test_cancelled_run_rejects_late_file(postgres: PostgreSQLSandbox) -> None:
    project_id, document_id = seeded(postgres)
    with postgres.sessions() as session:
        queued = service.create_document_export(
            session,
            project_id,
            DocumentExportCreate(document_id=document_id, document_version=2, format="html"),
            str(uuid4()),
        )
    claim = claim_job(postgres.sessions, queued.job_id, 60)
    assert claim is not None
    with postgres.sessions() as session:
        cancel_job(session, queued.job_id, include_diagnostic=False, project_id=project_id)
    late = RenderedExport("迟到", "论文正文-v2.html", "text/html; charset=utf-8", 1)
    assert not finish_export_job(postgres.sessions, claim, late)
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ExportFile)) == 0
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 0
        assert session.get(Job, queued.job_id).status == "cancelled"  # type: ignore[union-attr]


def test_database_rejects_export_file_mutation(postgres: PostgreSQLSandbox) -> None:
    project_id, document_id = seeded(postgres)
    with postgres.sessions() as session:
        queued = service.create_document_export(
            session,
            project_id,
            DocumentExportCreate(document_id=document_id, document_version=1, format="markdown"),
            str(uuid4()),
        )
    assert execute_job(postgres.sessions, queued.job_id, 60)
    for statement in (
        update(ExportFile).where(ExportFile.job_id == queued.job_id).values(data=b"tampered"),
        delete(ExportFile).where(ExportFile.job_id == queued.job_id),
    ):
        with postgres.sessions() as session, pytest.raises(DBAPIError), session.begin():
            session.execute(statement)
    with postgres.sessions() as session:
        file, data = service.get_export_file(session, project_id, queued.job_id)
    assert sha256(data).hexdigest() == file.sha256


def test_export_migration_downgrades_only_without_exports(postgres: PostgreSQLSandbox) -> None:
    engine = postgres.sessions.kw["bind"]
    try:
        with engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261118_0012")
            command.upgrade(postgres.alembic, "head")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    project_id, document_id = seeded(postgres)
    with postgres.sessions() as session:
        service.create_document_export(
            session,
            project_id,
            DocumentExportCreate(document_id=document_id, document_version=1, format="html"),
            str(uuid4()),
        )
    try:
        with pytest.raises(DBAPIError), engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261118_0012")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    with postgres.sessions() as session:
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == "20261118_0013"
