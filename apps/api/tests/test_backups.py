"""SG-14 package format, validation and restore-as-new-project regressions (SQLite)."""

import io
import json
import zipfile
from collections.abc import Callable
from hashlib import sha256
from uuid import UUID, uuid4

import pytest
from backup_seed import seed_project
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.jobs.models import Job
from thesis_pilot.modules.materials.models import Material, MaterialOriginal
from thesis_pilot.modules.project_backups import package as package_module
from thesis_pilot.modules.project_backups.package import canonical, manifest_digest, read_package
from thesis_pilot.modules.project_backups.registry import PROJECT_TABLES, tables, validate_registry
from thesis_pilot.modules.project_backups.snapshot import INTERRUPTED_CODE, RESTORED_SUFFIX
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.tasks.models import ProjectTask
from thesis_pilot.workers.execution import execute_job

API = "/api/v1"
Entries = dict[str, bytes]


def counts(sessions: sessionmaker[Session], project_id: UUID) -> dict[str, int]:
    from thesis_pilot.modules.project_backups.snapshot import scope_condition

    metadata = tables()
    with sessions() as session:
        return {
            spec.table: session.scalar(
                select(func.count())
                .select_from(metadata[spec.table])
                .where(scope_condition(spec, project_id))
            )
            or 0
            for spec in PROJECT_TABLES
        }


def make_backup(client: TestClient, sessions: sessionmaker[Session], project_id: UUID) -> bytes:
    queued = client.post(
        f"{API}/projects/{project_id}/backups", headers={"Idempotency-Key": f"b-{uuid4()}"}
    )
    assert queued.status_code == 202, queued.text
    job_id = queued.json()["job_id"]
    assert execute_job(sessions, UUID(job_id), 60)
    done = client.get(f"{API}/projects/{project_id}/backups/{job_id}").json()
    assert done["status"] == "succeeded", done
    download = client.get(f"{API}/projects/{project_id}/backups/{job_id}/download")
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/zip"
    assert sha256(download.content).hexdigest() == done["file"]["sha256"]
    return download.content


def upload(client: TestClient, data: bytes, key: str | None = None) -> dict[str, object]:
    response = client.post(
        f"{API}/backups/restores?filename=backup.zip",
        content=data,
        headers={"Idempotency-Key": key or f"r-{uuid4()}", "Content-Type": "application/zip"},
    )
    return {**response.json(), "http": response.status_code}


def entries(data: bytes) -> Entries:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return {info.filename: archive.read(info) for info in archive.infolist()}


def rezip(files: Entries) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, body in files.items():
            archive.writestr(name, body)
    return buffer.getvalue()


def reseal(data: bytes, mutate: Callable[[dict[str, object], Entries], None]) -> bytes:
    """Apply a semantic change and recompute every digest, as a careful forger would."""
    files = entries(data)
    manifest = json.loads(files.pop("manifest.json"))
    mutate(manifest, files)
    manifest["files"] = [
        {"path": path, "sha256": sha256(body).hexdigest(), "bytes": len(body)}
        for path, body in sorted(files.items())
    ]
    manifest["package_sha256"] = manifest_digest(manifest)
    return rezip({"manifest.json": canonical(manifest), **files})


def rows(files: Entries, table: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in files[f"data/{table}.jsonl"].splitlines()]


def put_rows(
    manifest: dict[str, object], files: Entries, table: str, items: list[dict[str, object]]
) -> None:
    files[f"data/{table}.jsonl"] = b"".join(canonical(item) + b"\n" for item in items)
    manifest["tables"][f"data/{table}"]["rows"] = len(items)  # type: ignore[index]


def test_registry_classifies_every_table() -> None:
    assert validate_registry() == []


def test_backup_restores_new_project_with_mapped_identities(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    seeded = seed_project(session_factory)
    before = counts(session_factory, seeded.project_id)
    data = make_backup(client, session_factory, seeded.project_id)
    package = read_package(data)
    assert package.manifest["format"] == "thesispilot-backup/1"
    assert package.manifest["project"] == {"id": str(seeded.project_id), "name": "备份合成项目"}
    # Backup jobs are never part of the backup.
    assert all(row["kind"] != "project_backup" for row in package.data["jobs"])

    receipt = upload(client, data)
    assert receipt["http"] == 202, receipt
    assert receipt["result_project_id"] is None and receipt["source_project_name"] == "备份合成项目"
    # An unattached restore job is invisible to the generic jobs API.
    assert client.get(f"{API}/jobs/{receipt['job_id']}").status_code == 404
    assert execute_job(session_factory, UUID(str(receipt["job_id"])), 60)
    done = client.get(f"{API}/backups/restores/{receipt['job_id']}").json()
    assert done["status"] == "succeeded", done
    copy_id = UUID(done["result_project_id"])
    assert copy_id != seeded.project_id

    # Every registered object type has the same count (backup/restore jobs are not counted);
    # the source project is untouched.
    assert counts(session_factory, copy_id) == before
    assert counts(session_factory, seeded.project_id) == before
    assert sum(before.values()) > 30 and before["document_versions"] == 4

    with session_factory() as session:
        source = session.get(Project, seeded.project_id)
        copy = session.get(Project, copy_id)
        assert source is not None and copy is not None
        assert copy.name == "备份合成项目" + RESTORED_SUFFIX and source.name == "备份合成项目"
        # Same flow version on the same instance is reused, not copied.
        assert copy.flow_version_id == source.flow_version_id
        old_versions = session.scalars(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == seeded.document_id)
            .order_by(DocumentVersion.version)
        ).all()
        new_document = session.scalar(select(Document).where(Document.project_id == copy_id))
        assert new_document is not None and new_document.id != seeded.document_id
        new_versions = session.scalars(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == new_document.id)
            .order_by(DocumentVersion.version)
        ).all()
        assert [(v.version, v.source, v.schema_version) for v in new_versions] == [
            (v.version, v.source, v.schema_version) for v in old_versions
        ]
        assert [v.content_json for v in new_versions] == [v.content_json for v in old_versions]
        old_original = session.scalar(
            select(MaterialOriginal).where(MaterialOriginal.material_id == seeded.material_id)
        )
        new_material = session.scalar(select(Material).where(Material.project_id == copy_id))
        assert old_original is not None and new_material is not None
        new_original = session.get(MaterialOriginal, new_material.current_original_id)
        assert new_original is not None and new_original.data == old_original.data
        assert new_original.sha256 == old_original.sha256 and new_original.id != old_original.id
        assert new_original.latest_parse_id is not None
        # Evidence inside JSON follows the renewed document identity.
        task = session.scalar(select(ProjectTask).where(ProjectTask.project_id == copy_id))
        assert task is not None
        assert task.content["evidence"][0]["document_id"] == str(new_document.id)
        # The queued source job is interrupted in the copy, never re-run.
        copied_jobs = session.scalars(select(Job).where(Job.project_id == copy_id)).all()
        interrupted = [job for job in copied_jobs if job.kind == "diagnostic"]
        assert [job.status for job in interrupted] == ["cancelled"]
        assert interrupted[0].error_code == INTERRUPTED_CODE
        assert session.get(Job, seeded.queued_job_id).status == "queued"  # type: ignore[union-attr]
        restore_job = next(job for job in copied_jobs if job.kind == "project_restore")
        assert restore_job.result["source_project_id"] == str(seeded.project_id)  # type: ignore[index]

    # The copy keeps working: a CAS save appends a new version.
    current = client.get(f"{API}/projects/{copy_id}/documents/current").json()
    saved = client.patch(
        f"{API}/projects/{copy_id}/documents/{current['id']}",
        json={"content": current["content"], "expected_version": current["version"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] == current["version"] + 1
    # The copy can itself be backed up again.
    assert read_package(make_backup(client, session_factory, copy_id)).manifest["project"]


def test_upload_replay_and_key_conflict(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    seeded = seed_project(session_factory)
    data = make_backup(client, session_factory, seeded.project_id)
    first = upload(client, data, "same-upload")
    assert upload(client, data, "same-upload")["job_id"] == first["job_id"]
    other = reseal(
        data, lambda manifest, files: manifest.update(exported_at="2030-01-01T00:00:00+00:00")
    )
    conflict = upload(client, other, "same-upload")
    assert conflict["http"] == 409


def _reject(client: TestClient, data: bytes, code: str) -> None:
    before = client.get(f"{API}/backups/restores").json()["total"]
    result = upload(client, data)
    assert result["http"] in (413, 422), result
    assert result["error"]["code"] == code, result  # type: ignore[index]
    # A rejected package is never stored or queued.
    assert client.get(f"{API}/backups/restores").json()["total"] == before


@pytest.fixture
def backup(client: TestClient, session_factory: sessionmaker[Session]) -> bytes:
    seeded = seed_project(session_factory)
    return make_backup(client, session_factory, seeded.project_id)


def test_tampered_bytes_are_rejected_as_corrupt(client: TestClient, backup: bytes) -> None:
    files = entries(backup)
    path = "data/project_tasks.jsonl"
    files[path] = files[path].replace("核对第一章".encode(), "篡改第一章".encode())
    _reject(client, rezip(files), "BACKUP_PACKAGE_CORRUPT")
    files = entries(backup)
    manifest = json.loads(files["manifest.json"])
    manifest["exported_at"] = "2031-01-01T00:00:00+00:00"
    files["manifest.json"] = canonical(manifest)
    _reject(client, rezip(files), "BACKUP_PACKAGE_CORRUPT")
    _reject(client, b"not a zip at all", "BACKUP_PACKAGE_INVALID")


def test_path_traversal_and_unlisted_entries_are_unsafe(client: TestClient, backup: bytes) -> None:
    files = entries(backup)
    files["../escape.txt"] = b"x"
    _reject(client, rezip(files), "BACKUP_PACKAGE_UNSAFE")
    files = entries(backup)
    files["data/../../etc.jsonl"] = b""
    _reject(client, rezip(files), "BACKUP_PACKAGE_UNSAFE")


def test_compression_bomb_and_size_limits(
    client: TestClient, backup: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    files = entries(backup)
    digest = "0" * 64
    files[f"blobs/{digest}"] = b"\0" * (4 * 1024 * 1024)
    _reject(client, rezip(files), "BACKUP_PACKAGE_UNSAFE")
    monkeypatch.setattr(package_module, "MAX_PACKAGE_BYTES", len(backup) - 1)
    with pytest.raises(package_module.PackageError) as caught:
        read_package(backup)
    assert caught.value.code == "BACKUP_PACKAGE_TOO_LARGE"


def test_unsupported_format_and_schema_are_rejected(client: TestClient, backup: bytes) -> None:
    _reject(
        client,
        reseal(backup, lambda manifest, files: manifest.update(format="thesispilot-backup/2")),
        "BACKUP_FORMAT_UNSUPPORTED",
    )

    def unknown_column(manifest: dict[str, object], files: Entries) -> None:
        items = rows(files, "projects")
        for item in items:
            item["future_column"] = 1
        manifest["tables"]["data/projects"]["columns"].append("future_column")  # type: ignore[index]
        put_rows(manifest, files, "projects", items)

    _reject(client, reseal(backup, unknown_column), "BACKUP_SCHEMA_INCOMPATIBLE")

    def unknown_table(manifest: dict[str, object], files: Entries) -> None:
        files["data/future_objects.jsonl"] = b""
        manifest["tables"]["data/future_objects"] = {"columns": ["id"], "rows": 0}  # type: ignore[index]

    _reject(client, reseal(backup, unknown_table), "BACKUP_SCHEMA_INCOMPATIBLE")


def test_missing_reference_closure_is_rejected(client: TestClient, backup: bytes) -> None:
    def drop_current_version(manifest: dict[str, object], files: Entries) -> None:
        items = rows(files, "document_versions")
        put_rows(manifest, files, "document_versions", items[:-1])

    _reject(client, reseal(backup, drop_current_version), "BACKUP_REFERENCE_MISSING")

    def foreign_project_row(manifest: dict[str, object], files: Entries) -> None:
        items = rows(files, "feedback_batches")
        items[0]["project_id"] = str(uuid4())
        put_rows(manifest, files, "feedback_batches", items)

    _reject(client, reseal(backup, foreign_project_row), "BACKUP_PACKAGE_INVALID")

    def swapped_original(manifest: dict[str, object], files: Entries) -> None:
        items = rows(files, "material_originals")
        forged = b"forged bytes"
        digest = sha256(forged).hexdigest()
        old = items[0]["data"]["$blob"]  # type: ignore[index]
        files.pop(f"blobs/{old}")
        files[f"blobs/{digest}"] = forged
        items[0]["data"] = {"$blob": digest}
        put_rows(manifest, files, "material_originals", items)

    _reject(client, reseal(backup, swapped_original), "BACKUP_PACKAGE_CORRUPT")


def test_failed_restore_leaves_no_partial_project(
    client: TestClient, session_factory: sessionmaker[Session], backup: bytes
) -> None:
    receipt = upload(client, backup)
    with session_factory() as session:
        projects_before = session.scalar(select(func.count()).select_from(Project))

    from thesis_pilot.modules.project_backups import jobs as backup_jobs

    original = backup_jobs.apply_restore

    def explode(*args: object, **kwargs: object) -> object:
        original(*args, **kwargs)  # type: ignore[arg-type]
        raise RuntimeError("simulated failure after inserts")

    backup_jobs.apply_restore = explode  # type: ignore[assignment]
    try:
        assert execute_job(session_factory, UUID(str(receipt["job_id"])), 60)
    finally:
        backup_jobs.apply_restore = original
    done = client.get(f"{API}/backups/restores/{receipt['job_id']}").json()
    assert done["status"] == "failed" and done["error_code"] == "BACKUP_RESTORE_FAILED"
    assert done["result_project_id"] is None
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Project)) == projects_before


def test_cancelled_restore_never_writes(
    client: TestClient, session_factory: sessionmaker[Session], backup: bytes
) -> None:
    receipt = upload(client, backup)
    cancelled = client.post(f"{API}/backups/restores/{receipt['job_id']}/cancel").json()
    assert cancelled["status"] == "cancelled"
    assert not execute_job(session_factory, UUID(str(receipt["job_id"])), 60)
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Project)) == 1
    retry = client.post(
        f"{API}/jobs/{receipt['job_id']}/retry", headers={"Idempotency-Key": "retry-restore"}
    )
    assert retry.status_code == 409
    assert retry.json()["error"]["code"] == "BACKUP_RESTORE_RETRY_REQUIRED"
