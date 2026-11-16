"""SG-06A real PostgreSQL invariants using synthetic source material only.

Run through the repository's explicit isolated PostgreSQL/Redis integration setup.
The prefork case must run on Linux; no SQLite or in-process worker substitute.
"""

import base64
import hashlib
import socket
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import undefer

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.models import Document
from thesis_pilot.modules.jobs.material_parse import run_material_parse
from thesis_pilot.modules.jobs.models import Job, JobArtifact, OutboxEvent
from thesis_pilot.modules.jobs.service import (
    cancel_job,
    claim_job,
    finish_material_parse_job,
)
from thesis_pilot.modules.materials import service
from thesis_pilot.modules.materials.models import (
    Material,
    MaterialOriginal,
    MaterialParseVersion,
    ProjectSourceBindingVersion,
)
from thesis_pilot.modules.materials.schemas import (
    MaterialUpload,
    MaterialUploadReceipt,
    ProjectSourceBindingUpdate,
)

from .conftest import PostgreSQLSandbox
from .test_long_jobs import isolated_worker, read_job
from .test_services import make_project
from .test_workspace import KEY, real_workspace_http

pytestmark = pytest.mark.integration
SOURCE = "合成论文规范\n正文字数不少于 12000 字。\n参考文献不少于 15 篇。\n"


def payload(text: str = SOURCE, *, kind: str = "requirements") -> MaterialUpload:
    return MaterialUpload.model_validate(
        {
            "name": "自制资料集成样例",
            "filename": "synthetic-requirements.txt",
            "file_type": "text",
            "kind": kind,
            "source_note": "完全合成，仅供工程验证，不代表任何学校要求。",
            "content_base64": base64.b64encode(text.encode("utf-8")).decode("ascii"),
        }
    )


def upload(
    postgres: PostgreSQLSandbox,
    project_id: UUID,
    data: MaterialUpload | None = None,
) -> MaterialUploadReceipt:
    with postgres.sessions() as session:
        return service.upload_material(session, project_id, data or payload(), str(uuid4()))


def finish_parse(postgres: PostgreSQLSandbox, job_id: UUID) -> MaterialParseVersion:
    claim = claim_job(postgres.sessions, job_id, 60)
    assert claim is not None
    parsed = run_material_parse(postgres.sessions, claim)
    assert parsed is not None
    assert finish_material_parse_job(postgres.sessions, claim, parsed)
    assert read_job(postgres, job_id).status == "succeeded"
    with postgres.sessions() as session:
        return session.scalars(
            select(MaterialParseVersion)
            .options(undefer(MaterialParseVersion.content))
            .where(MaterialParseVersion.source_job_id == job_id)
        ).one()


def test_concurrent_upload_replay_creates_one_original_job_and_outbox(
    postgres: PostgreSQLSandbox,
) -> None:
    project_id = make_project(postgres)
    data, key = payload(), str(uuid4())
    barrier = Barrier(2, timeout=10)

    def create(_: int) -> MaterialUploadReceipt:
        barrier.wait()
        with postgres.sessions() as session:
            return service.upload_material(session, project_id, data, key)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first, replay = list(executor.map(create, [0, 1]))
    assert first.material.id == replay.material.id
    assert first.original.id == replay.original.id
    assert first.job.id == replay.job.id
    assert first.original.sha256 == hashlib.sha256(SOURCE.encode("utf-8")).hexdigest()
    assert first.original.byte_size == len(SOURCE.encode("utf-8"))
    assert first.job.input_snapshot is not None
    frozen = first.job.input_snapshot.model_dump(mode="json")
    assert frozen["original_version_id"] == str(first.original.id)
    assert frozen["original_sha256"] == first.original.sha256
    with postgres.sessions() as session:
        for model in (Material, MaterialOriginal, Job, OutboxEvent):
            assert session.scalar(select(func.count()).select_from(model)) == 1
        assert session.scalar(select(func.count()).select_from(Document)) == 0


def test_upload_key_rejects_changed_content_and_is_scoped_to_project(
    postgres: PostgreSQLSandbox,
) -> None:
    project_id, other_project = make_project(postgres), make_project(postgres)
    key = str(uuid4())
    with postgres.sessions() as session:
        original = service.upload_material(session, project_id, payload(), key)
    with postgres.sessions() as session, pytest.raises(AppError) as caught:
        service.upload_material(session, project_id, payload("另一份合成原件"), key)
    assert caught.value.code == "MATERIAL_UPLOAD_KEY_CONFLICT"
    with postgres.sessions() as session:
        other = service.upload_material(session, other_project, payload(), key)
    assert other.material.project_id == other_project
    assert other.material.id != original.material.id
    assert other.original.id != original.original.id and other.job.id != original.job.id
    with postgres.sessions() as session:
        metadata, data = service.get_original_bytes(
            session, project_id, original.material.id, original.original.id
        )
        assert data == SOURCE.encode("utf-8")
        assert metadata.sha256 == hashlib.sha256(data).hexdigest()
        assert session.scalar(select(func.count()).select_from(MaterialOriginal)) == 2
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 2


def test_enqueue_failure_rolls_back_original_metadata_and_job(
    postgres: PostgreSQLSandbox, monkeypatch: pytest.MonkeyPatch
) -> None:
    project_id = make_project(postgres)

    def fail(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("synthetic enqueue failure")

    with monkeypatch.context() as patch:
        patch.setattr(service, "enqueue_material_parse", fail)
        with postgres.sessions() as session, pytest.raises(RuntimeError, match="synthetic enqueue"):
            service.upload_material(session, project_id, payload(), str(uuid4()))
    with postgres.sessions() as session:
        for model in (Material, MaterialOriginal, Job, OutboxEvent):
            assert session.scalar(select(func.count()).select_from(model)) == 0
    # A failed attempt must not leave an object that blocks a legitimate later upload.
    assert upload(postgres, project_id).original.version == 1


def test_original_reads_require_the_exact_project_material_and_original(
    postgres: PostgreSQLSandbox, tmp_path: Path
) -> None:
    project_id, other_project = make_project(postgres), make_project(postgres)
    original = upload(postgres, project_id)
    unrelated = upload(postgres, project_id, payload("第二份独立合成资料"))
    for pid, material_id, original_id in [
        (other_project, original.material.id, original.original.id),
        (project_id, unrelated.material.id, original.original.id),
        (project_id, original.material.id, uuid4()),
    ]:
        with postgres.sessions() as session, pytest.raises(AppError) as caught:
            service.get_original_bytes(session, pid, material_id, original_id)
        assert caught.value.status_code == 404
    with postgres.sessions() as session:
        metadata, body = service.get_original_bytes(
            session, project_id, original.material.id, original.original.id
        )
    assert body == SOURCE.encode("utf-8")
    assert hashlib.sha256(body).hexdigest() == metadata.sha256
    assert "data" not in metadata.model_dump() and "content_base64" not in metadata.model_dump()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    path = (
        f"/api/v1/projects/{project_id}/materials/{original.material.id}"
        f"/originals/{original.original.id}"
    )
    with real_workspace_http(postgres, tmp_path / "material-download-http.log", port) as client:
        assert client.get(path + "/download").status_code == 401
        assert client.post("/api/v1/workspace/session", json={"access_key": KEY}).status_code == 200
        downloaded = client.get(path + "/download")
        assert downloaded.status_code == 200
        assert hashlib.sha256(downloaded.content).hexdigest() == original.original.sha256
        assert downloaded.content == SOURCE.encode("utf-8")
        assert "attachment" in downloaded.headers["content-disposition"]
        metadata_response = client.get(path)
        assert metadata_response.status_code == 200
        assert "data" not in metadata_response.json()
        assert "content_base64" not in metadata_response.json()
        wrong_project = path.replace(str(project_id), str(other_project))
        assert client.get(wrong_project + "/download").status_code == 404


def test_new_original_does_not_retarget_an_already_queued_parse(
    postgres: PostgreSQLSandbox,
) -> None:
    project_id = make_project(postgres)
    first = upload(postgres, project_id)
    with postgres.sessions() as session:
        second = service.upload_material(
            session,
            project_id,
            payload("新版合成规范\n正文字数不少于 16000 字。"),
            str(uuid4()),
            material_id=first.material.id,
            expected_version=first.material.version,
        )
    assert second.original.id != first.original.id and second.original.version == 2
    parsed = finish_parse(postgres, first.job.id)
    assert parsed.original_id == first.original.id
    assert parsed.content["plain_text"] == SOURCE
    assert read_job(postgres, first.job.id).input_snapshot == first.job.input_snapshot.model_dump(
        mode="json"
    )
    with postgres.sessions() as session:
        for receipt, expected in [
            (first, SOURCE),
            (second, "新版合成规范\n正文字数不少于 16000 字。"),
        ]:
            metadata, body = service.get_original_bytes(
                session, project_id, receipt.material.id, receipt.original.id
            )
            assert body.decode("utf-8") == expected
            assert hashlib.sha256(body).hexdigest() == metadata.sha256


def test_cancelled_parse_rejects_late_result_without_parse_or_artifact(
    postgres: PostgreSQLSandbox,
) -> None:
    receipt = upload(postgres, make_project(postgres))
    claim = claim_job(postgres.sessions, receipt.job.id, 60)
    assert claim is not None
    parsed = run_material_parse(postgres.sessions, claim)
    assert parsed is not None
    with postgres.sessions() as session:
        cancel_job(session, receipt.job.id, project_id=receipt.material.project_id)
    assert not finish_material_parse_job(postgres.sessions, claim, parsed)
    assert not finish_material_parse_job(postgres.sessions, claim, parsed)
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(MaterialParseVersion)) == 0
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 0
        original = session.get(MaterialOriginal, receipt.original.id)
        assert original is not None and original.latest_parse_id is None
    assert read_job(postgres, receipt.job.id).status == "cancelled"


def test_parse_completion_is_once_only_and_keeps_source_anchors(
    postgres: PostgreSQLSandbox,
) -> None:
    receipt = upload(postgres, make_project(postgres))
    claim = claim_job(postgres.sessions, receipt.job.id, 60)
    assert claim is not None
    parsed = run_material_parse(postgres.sessions, claim)
    assert parsed is not None
    assert parsed.anchors and all(
        anchor.original_version_id == receipt.original.id for anchor in parsed.anchors
    )
    assert finish_material_parse_job(postgres.sessions, claim, parsed)
    assert not finish_material_parse_job(postgres.sessions, claim, parsed)
    with postgres.sessions() as session:
        version = session.scalars(select(MaterialParseVersion)).one()
        artifact = session.scalars(select(JobArtifact)).one()
        assert version.source_job_id == artifact.job_id == receipt.job.id
        assert version.original_id == receipt.original.id
        assert version.content == parsed.model_dump(mode="json")
        original = session.get(MaterialOriginal, receipt.original.id)
        assert original is not None and original.latest_parse_id == version.id


def test_binding_cas_keeps_historical_fixed_sources(postgres: PostgreSQLSandbox) -> None:
    project_id = make_project(postgres)
    receipt = upload(postgres, project_id, payload(kind="template"))
    parsed = finish_parse(postgres, receipt.job.id)
    with postgres.sessions() as session:
        initial = service.update_binding(
            session,
            project_id,
            ProjectSourceBindingUpdate(
                expected_version=0,
                template_parse_version_id=parsed.id,
                requirement_parse_version_ids=[],
            ),
        )
    with postgres.sessions() as session:
        newer = service.upload_material(
            session,
            project_id,
            payload("新版合成模板\n正文字数不少于 16000 字。", kind="template"),
            str(uuid4()),
            material_id=receipt.material.id,
            expected_version=receipt.material.version,
        )
    newer_parse = finish_parse(postgres, newer.job.id)
    assert newer_parse.id != parsed.id
    with postgres.sessions() as session:
        still_bound = service.get_binding(session, project_id)
    assert still_bound.version == initial.version
    assert still_bound.template_parse_version_id == parsed.id
    barrier = Barrier(2, timeout=10)

    def bind(template_id: UUID | None) -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                changed = service.update_binding(
                    session,
                    project_id,
                    ProjectSourceBindingUpdate(
                        expected_version=initial.version,
                        template_parse_version_id=template_id,
                        requirement_parse_version_ids=[],
                    ),
                )
                assert changed.version == initial.version + 1
                return "accepted"
            except AppError as error:
                assert error.code == "MATERIAL_BINDING_CONFLICT"
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(bind, [parsed.id, None])) == ["accepted", "conflict"]
    with postgres.sessions() as session:
        versions = session.scalars(
            select(ProjectSourceBindingVersion)
            .where(ProjectSourceBindingVersion.project_id == project_id)
            .order_by(ProjectSourceBindingVersion.version)
        ).all()
    assert [item.version for item in versions] == [1, 2]
    assert versions[0].template_parse_version_id == parsed.id
    assert versions[0].id == initial.current_version_id


def test_binding_rejects_sources_from_another_project(postgres: PostgreSQLSandbox) -> None:
    project_id, other_project = make_project(postgres), make_project(postgres)
    receipt = upload(postgres, project_id, payload(kind="template"))
    parsed = finish_parse(postgres, receipt.job.id)
    with postgres.sessions() as session, pytest.raises(AppError) as caught:
        service.update_binding(
            session,
            other_project,
            ProjectSourceBindingUpdate(
                expected_version=0,
                template_parse_version_id=parsed.id,
                requirement_parse_version_ids=[],
            ),
        )
    assert caught.value.code == "MATERIAL_BINDING_INVALID"
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ProjectSourceBindingVersion)) == 0


def test_text_parse_runs_in_real_linux_prefork_and_preserves_original(
    postgres: PostgreSQLSandbox, redis_test_url: str, tmp_path: Path
) -> None:
    receipt = upload(postgres, make_project(postgres))
    with isolated_worker(postgres, redis_test_url, tmp_path) as worker:
        assert worker.dispatch().published == 1
        worker.publish(receipt.job.id)
        completed = worker.wait_for_status(receipt.job.id, "succeeded")
        worker.wait_until_consumed()
    assert completed.attempt == 1 and completed.result is not None
    with postgres.sessions() as session:
        parsed = session.scalars(select(MaterialParseVersion)).one()
        artifact = session.scalars(select(JobArtifact)).one()
        assert parsed.original_id == receipt.original.id
        assert parsed.content["plain_text"] == SOURCE
        assert parsed.content["anchors"]
        assert artifact.job_id == parsed.source_job_id == receipt.job.id
        assert session.scalar(select(func.count()).select_from(Document)) == 0
    with postgres.sessions() as session:
        metadata, body = service.get_original_bytes(
            session, receipt.material.project_id, receipt.material.id, receipt.original.id
        )
        assert body == SOURCE.encode("utf-8")
        assert hashlib.sha256(body).hexdigest() == metadata.sha256 == receipt.original.sha256


def test_database_rejects_original_and_snapshot_mutation_and_deletion(
    postgres: PostgreSQLSandbox,
) -> None:
    receipt = upload(postgres, make_project(postgres), payload(kind="template"))
    parsed = finish_parse(postgres, receipt.job.id)
    with postgres.sessions() as session:
        binding = service.update_binding(
            session,
            receipt.material.project_id,
            ProjectSourceBindingUpdate(
                expected_version=0,
                template_parse_version_id=parsed.id,
                requirement_parse_version_ids=[],
            ),
        )
    statements = [
        update(MaterialOriginal)
        .where(MaterialOriginal.id == receipt.original.id)
        .values(data=b"tampered"),
        delete(MaterialOriginal).where(MaterialOriginal.id == receipt.original.id),
        update(MaterialParseVersion).where(MaterialParseVersion.id == parsed.id).values(content={}),
        delete(MaterialParseVersion).where(MaterialParseVersion.id == parsed.id),
        update(ProjectSourceBindingVersion)
        .where(ProjectSourceBindingVersion.id == binding.current_version_id)
        .values(template_parse_version_id=None),
        delete(ProjectSourceBindingVersion).where(
            ProjectSourceBindingVersion.id == binding.current_version_id
        ),
    ]
    for statement in statements:
        with postgres.sessions() as session, pytest.raises(DBAPIError), session.begin():
            session.execute(statement)
    with postgres.sessions() as session:
        _, body = service.get_original_bytes(
            session, receipt.material.project_id, receipt.material.id, receipt.original.id
        )
        assert hashlib.sha256(body).hexdigest() == receipt.original.sha256
        saved_parse = session.get(MaterialParseVersion, parsed.id)
        saved_binding = session.get(ProjectSourceBindingVersion, binding.current_version_id)
        assert saved_parse is not None and saved_parse.content == parsed.content
        assert saved_binding is not None and saved_binding.template_parse_version_id == parsed.id


def test_material_migration_downgrades_only_an_empty_store(
    postgres: PostgreSQLSandbox,
) -> None:
    engine = postgres.sessions.kw["bind"]
    try:
        with engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261117_0008")
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == "20261117_0008"
            )
            command.upgrade(postgres.alembic, "head")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    receipt = upload(postgres, make_project(postgres))
    try:
        with pytest.raises(DBAPIError), engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261117_0008")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    with postgres.sessions() as session:
        # The refused downgrade rolls back as one transaction, so the schema stays at head.
        head = ScriptDirectory.from_config(postgres.alembic).get_current_head()
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == head
        assert session.get(Job, receipt.job.id) is not None
    with postgres.sessions() as session:
        _, body = service.get_original_bytes(
            session, receipt.material.project_id, receipt.material.id, receipt.original.id
        )
        assert hashlib.sha256(body).hexdigest() == receipt.original.sha256
