"""Manuscript invariants on PostgreSQL and a real restarted HTTP server."""

import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from threading import Barrier
from uuid import UUID

import httpx
import pytest
from alembic import command
from sqlalchemy import delete, event, func, inspect, select, update
from sqlalchemy.exc import IntegrityError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import service
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentImport, DocumentSave
from thesis_pilot.modules.documents.structure import (
    MAX_CONTENT_BYTES,
    MAX_TRANSPORT_BYTES,
    canonical_editor_json,
    compact_json,
)
from thesis_pilot.modules.jobs.schemas import JobCreate
from thesis_pilot.modules.jobs.service import create_job
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project

from .conftest import PostgreSQLSandbox

pytestmark = pytest.mark.integration
TOKEN = "document-integration-token-at-least-32-characters"


def content(text: str = "中文🙂𠮷\u0000自制原文") -> dict:
    return {
        "schema_version": 1,
        "json": {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
        },
    }


def project(postgres: PostgreSQLSandbox) -> UUID:
    with postgres.sessions() as session:
        return create_project(session, ProjectCreate(name="正文PG集成项目")).id


def imported(postgres: PostgreSQLSandbox) -> tuple[UUID, UUID]:
    project_id = project(postgres)
    with postgres.sessions() as session:
        document = service.import_document(session, project_id, DocumentImport(content=content()))
    return project_id, document.id


def test_parent_upgrade_preserves_existing_project_and_job(postgres: PostgreSQLSandbox) -> None:
    engine = postgres.sessions.kw["bind"]
    # This fixture created an empty random test schema, never an existing user database.
    with engine.begin() as connection:
        postgres.alembic.attributes["connection"] = connection
        command.downgrade(postgres.alembic, "20261117_0002")
    postgres.alembic.attributes.pop("connection")
    project_id = project(postgres)
    with postgres.sessions() as session:
        job = create_job(session, JobCreate(project_id=project_id), "document-upgrade-synthetic")
    with engine.begin() as connection:
        postgres.alembic.attributes["connection"] = connection
        command.upgrade(postgres.alembic, "head")
        command.check(postgres.alembic)
    postgres.alembic.attributes.pop("connection")
    with postgres.sessions() as session:
        assert session.get(Project, project_id).version == 1
        from thesis_pilot.modules.jobs.models import Job

        assert session.get(Job, job.id).status == "queued"
    columns = inspect(engine).get_columns("document_versions")
    assert (
        next(column for column in columns if column["name"] == "content_json")[
            "type"
        ].__class__.__name__
        == "JSON"
    )


def test_concurrent_first_import_has_one_winner(postgres: PostgreSQLSandbox) -> None:
    project_id = project(postgres)
    barrier = Barrier(2, timeout=10)

    def write(text: str) -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                saved = service.import_document(
                    session, project_id, DocumentImport(content=content(text))
                )
                assert saved.version == 1
                return "accepted"
            except AppError as error:
                assert error.code == "DOCUMENT_ALREADY_EXISTS"
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(write, ["并发甲", "并发乙"])) == ["accepted", "conflict"]
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Document)) == 1
        assert session.scalar(select(func.count()).select_from(DocumentVersion)) == 1


def test_nonempty_downgrade_preserves_history(postgres: PostgreSQLSandbox) -> None:
    project_id, document_id = imported(postgres)
    engine = postgres.sessions.kw["bind"]
    try:
        with pytest.raises(RuntimeError, match="Refusing to remove"), engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261117_0002")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    with postgres.sessions() as session:
        restored = service.get_version(session, project_id, document_id, 1)
        assert restored.content.json_content == content()["json"]


def test_concurrent_save_cas_and_repeated_stale_command(postgres: PostgreSQLSandbox) -> None:
    project_id, document_id = imported(postgres)
    barrier = Barrier(2, timeout=10)

    def write(text: str) -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                result = service.save_document(
                    session,
                    project_id,
                    document_id,
                    DocumentSave(expected_version=1, content=content(text)),
                )
                assert result.version == 2
                return "accepted"
            except AppError as error:
                assert error.code == "DOCUMENT_VERSION_CONFLICT"
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(write, ["改稿甲", "改稿乙"])) == ["accepted", "conflict"]
    with postgres.sessions() as session:
        before = service.get_current_document(session, project_id)
        with pytest.raises(AppError) as repeated:
            service.save_document(
                session,
                project_id,
                document_id,
                DocumentSave(expected_version=1, content=content("重复旧命令")),
            )
        assert repeated.value.code == "DOCUMENT_VERSION_CONFLICT"
        assert service.get_current_document(session, project_id) == before
        assert (
            service.list_versions(session, project_id, document_id, limit=100, offset=0).total == 2
        )
        assert session.get(Project, project_id).version == 1


def test_failed_insert_rolls_back_pointer_and_old_version_is_immutable(
    postgres: PostgreSQLSandbox,
) -> None:
    project_id, document_id = imported(postgres)
    with postgres.sessions() as session:
        before = service.get_current_document(session, project_id)

    def fail(mapper: object, connection: object, target: DocumentVersion) -> None:
        if target.version == 2:
            raise RuntimeError("synthetic manuscript insert failure")

    event.listen(DocumentVersion, "before_insert", fail)
    try:
        with postgres.sessions() as session, pytest.raises(RuntimeError, match="synthetic"):
            service.save_document(
                session,
                project_id,
                document_id,
                DocumentSave(expected_version=1, content=content("不得部分提交")),
            )
    finally:
        event.remove(DocumentVersion, "before_insert", fail)

    for statement, sqlstate in [
        (update(DocumentVersion).values(source="manual_edit"), "23514"),
        (delete(DocumentVersion), "23514"),
        (update(Document).values(current_version=999), "23503"),
    ]:
        with postgres.sessions() as session:
            with pytest.raises(IntegrityError) as captured, session.begin():
                session.execute(statement)
            assert captured.value.orig.sqlstate == sqlstate
    with postgres.sessions() as session:
        assert service.get_current_document(session, project_id) == before
        assert service.get_version(session, project_id, document_id, 1).content == before.content
        assert session.scalar(select(func.count()).select_from(DocumentVersion)) == 1


@contextmanager
def real_http(postgres: PostgreSQLSandbox, log: Path) -> Iterator[httpx.Client]:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    environment = {
        **os.environ,
        "TP_ENVIRONMENT": "test",
        "TP_DATABASE_URL": postgres.url,
        "TP_API_TOKEN": TOKEN,
        "TP_CORS_ORIGINS": "[]",
    }
    with log.open("ab") as output:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "thesis_pilot.main:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--no-access-log",
                "--log-level",
                "warning",
            ],
            env=environment,
            stdout=output,
            stderr=subprocess.STDOUT,
        )
        try:
            with httpx.Client(
                base_url=f"http://127.0.0.1:{port}",
                timeout=60,
                headers={"Authorization": f"Bearer {TOKEN}"},
            ) as client:
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    assert process.poll() is None, "isolated HTTP server exited during startup"
                    try:
                        if client.get("/health/live").status_code == 200:
                            break
                    except httpx.ConnectError:
                        pass
                    time.sleep(0.05)
                else:
                    pytest.fail("isolated HTTP server did not become live")
                yield client
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def test_real_http_restart_preserves_80_levels_unicode_and_history(
    postgres: PostgreSQLSandbox,
    tmp_path: Path,
) -> None:
    data = content()
    node = data["json"]["content"][0]
    for _ in range(78):
        node = {"type": "blockquote", "content": [node]}
    data["json"]["content"] = [
        {"type": "heading", "attrs": {"chapterId": "远端章🙂", "templateAlign": "center"}},
        node,
        {
            "type": "table",
            "content": [
                {
                    "type": "tableRow",
                    "content": [
                        {
                            "type": "tableCell",
                            "attrs": {"colwidth": [180]},
                            "content": [{"type": "paragraph"}],
                        }
                    ],
                }
            ],
        },
    ]
    expected = {"schema_version": 1, "json": canonical_editor_json(data["json"])}
    log = tmp_path / "document-http.log"
    with real_http(postgres, log) as client:
        created = client.post("/api/v1/projects", json={"name": "实际HTTP项目"})
        assert created.status_code == 201
        project_id = created.json()["id"]
        path = f"/api/v1/projects/{project_id}/documents"
        response = client.post(path, json={"content": data})
        assert response.status_code == 201
        imported_body = response.json()
        assert imported_body["content"] == expected
        assert len(response.content) <= MAX_TRANSPORT_BYTES
        document_path = path + "/" + imported_body["id"]
        assert client.get(document_path + "/versions/1").json()["content"] == expected
        invalid = content()
        invalid["json"]["content"] = [{"type": "blockquote", "content": [node]}]
        rejected = client.patch(document_path, json={"expected_version": 1, "content": invalid})
        assert rejected.status_code == 422
        assert rejected.json()["error"]["code"] == "DOCUMENT_STRUCTURE_INVALID"
        saved = client.patch(
            document_path, json={"expected_version": 1, "content": content("人工修订")}
        )
        assert saved.status_code == 200 and saved.json()["version"] == 2
        saved_body = saved.json()
        stale = client.patch(
            document_path, json={"expected_version": 1, "content": content("旧草稿")}
        )
        assert stale.status_code == 409
        other = client.post("/api/v1/projects", json={"name": "另一个HTTP项目"}).json()["id"]
        cross = f"/api/v1/projects/{other}/documents/{imported_body['id']}/versions/1"
        assert client.get(cross).status_code == 404
    with real_http(postgres, log) as restarted:
        assert restarted.get(path + "/current").json() == saved_body
        assert restarted.get(document_path + "/versions/1").json()["content"] == expected
        assert restarted.get(document_path + "/versions").json()["total"] == 2
        assert restarted.get(f"/api/v1/projects/{project_id}").json()["version"] == 1
    assert "自制原文" not in log.read_text("utf-8")


def test_real_http_utf8_limit_accepts_exact_content_and_rejects_excess(
    postgres: PostgreSQLSandbox,
    tmp_path: Path,
) -> None:
    remaining = MAX_CONTENT_BYTES - len(compact_json(content("")["json"]).encode("utf-8"))
    text = "🙂" * (remaining // 4) + "a" * (remaining % 4)
    boundary = content(text)
    assert len(compact_json(boundary["json"]).encode("utf-8")) == MAX_CONTENT_BYTES
    with real_http(postgres, tmp_path / "document-limit.log") as client:
        project_id = client.post("/api/v1/projects", json={"name": "UTF8边界"}).json()["id"]
        path = f"/api/v1/projects/{project_id}/documents"
        saved = client.post(path, json={"content": boundary})
        assert saved.status_code == 201
        assert MAX_CONTENT_BYTES < len(saved.content) <= MAX_TRANSPORT_BYTES
        restored = client.get(path + "/current")
        assert restored.status_code == 200 and restored.json()["content"] == boundary
        document_id = saved.json()["id"]
        rejected = client.patch(
            path + "/" + document_id, json={"expected_version": 1, "content": content(text + "a")}
        )
        assert rejected.status_code == 413
        assert rejected.json()["error"]["code"] == "DOCUMENT_TOO_LARGE"
        excessive_body = client.patch(
            path + "/" + document_id,
            content=b" " * (MAX_TRANSPORT_BYTES + 1),
            headers={"Content-Type": "application/json"},
        )
        assert excessive_body.status_code == 413
        assert client.get(path + "/current").json()["version"] == 1
