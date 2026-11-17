"""SG-14 backup → restore on real PostgreSQL, including a clean second instance (synthetic data)."""

import os
from collections.abc import Iterator
from contextlib import contextmanager
from hashlib import sha256
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from backup_seed import seed_project
from sqlalchemy import create_engine, func, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentSave
from thesis_pilot.modules.jobs.models import Job
from thesis_pilot.modules.materials.models import MaterialOriginal
from thesis_pilot.modules.project_backups import service
from thesis_pilot.modules.project_backups.models import BackupArchive, ProjectRestore
from thesis_pilot.modules.project_backups.package import read_package
from thesis_pilot.modules.project_backups.registry import PROJECT_TABLES
from thesis_pilot.modules.project_backups.snapshot import (
    INTERRUPTED_CODE,
    RESTORED_SUFFIX,
    collect_project,
)
from thesis_pilot.modules.project_flows.models import ProjectFlow, ProjectFlowVersion
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.workers.execution import execute_job

from .conftest import PostgreSQLSandbox

pytestmark = pytest.mark.integration


@contextmanager
def clean_instance() -> Iterator[sessionmaker[Session]]:
    """A second, empty, fully migrated schema standing in for a clean installation."""
    url = make_url(os.environ["TP_TEST_DATABASE_URL"])
    schema = f"tp_test_{uuid4().hex}"
    admin = create_engine(url, hide_parameters=True)
    engine = create_engine(
        url.update_query_dict({"options": f"-csearch_path={schema}"}), hide_parameters=True
    )
    try:
        with admin.begin() as connection:
            connection.execute(CreateSchema(schema))
        config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        yield sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))
        admin.dispose()


def backup(sessions: sessionmaker[Session], project_id: UUID) -> bytes:
    with sessions() as session:
        queued = service.create_backup(session, project_id, f"b-{uuid4()}")
    assert execute_job(sessions, queued.job_id, 60)
    with sessions() as session:
        _, data = service.get_backup_file(session, project_id, queued.job_id)
    return data


def restore(sessions: sessionmaker[Session], data: bytes) -> UUID:
    with sessions() as session:
        receipt = service.upload_restore(session, data, "backup.zip", f"r-{uuid4()}")
    assert execute_job(sessions, receipt.job_id, 60)
    with sessions() as session:
        done = service.get_restore(session, receipt.job_id)
    assert done.status == "succeeded", done.error_code
    assert done.result_project_id is not None
    return done.result_project_id


def snapshot(sessions: sessionmaker[Session], project_id: UUID) -> dict[str, list[dict]]:
    with sessions() as session, session.begin():
        collected = collect_project(session, project_id)
    return {table: rows for table, (_, rows) in collected.data.items()}


def history(sessions: sessionmaker[Session], project_id: UUID) -> list[tuple[int, str, object]]:
    with sessions() as session:
        document = session.scalar(select(Document).where(Document.project_id == project_id))
        assert document is not None
        return [
            (row.version, row.source, row.content_json)
            for row in session.scalars(
                select(DocumentVersion)
                .where(DocumentVersion.document_id == document.id)
                .order_by(DocumentVersion.version)
            )
        ]


def originals(sessions: sessionmaker[Session], project_id: UUID) -> list[str]:
    from thesis_pilot.modules.materials.models import Material

    with sessions() as session:
        return sorted(
            sha256(row).hexdigest()
            for row in session.scalars(
                select(MaterialOriginal.data)
                .join(Material, Material.id == MaterialOriginal.material_id)
                .where(Material.project_id == project_id)
            )
        )


def test_backup_restore_same_instance_is_complete_and_isolated(
    postgres: PostgreSQLSandbox,
) -> None:
    sessions = postgres.sessions
    seeded = seed_project(sessions)
    source_before = snapshot(sessions, seeded.project_id)
    data = backup(sessions, seeded.project_id)
    package = read_package(data)
    assert {table: len(rows) for table, rows in package.data.items()} == {
        table: len(rows) for table, rows in source_before.items()
    }
    copy_id = restore(sessions, data)

    # The source project is byte-for-byte unchanged in every registered table.
    assert snapshot(sessions, seeded.project_id) == source_before
    copied = snapshot(sessions, copy_id)
    assert {t: len(r) for t, r in copied.items()} == {t: len(r) for t, r in source_before.items()}
    exercised = sorted(table for table, rows in source_before.items() if rows)
    assert len(exercised) >= 25, exercised
    # No identity is shared between source and copy, except configuration references.
    source_ids = {row["id"] for rows in source_before.values() for row in rows if "id" in row}
    copy_ids = {row["id"] for rows in copied.values() for row in rows if "id" in row}
    assert not source_ids & copy_ids
    # Manuscript history: same order, same sources, same snapshots.
    assert history(sessions, copy_id) == history(sessions, seeded.project_id)
    assert originals(sessions, copy_id) == originals(sessions, seeded.project_id)
    with sessions() as session:
        copy = session.get(Project, copy_id)
        source = session.get(Project, seeded.project_id)
        assert copy is not None and source is not None
        assert copy.name == source.name + RESTORED_SUFFIX
        assert copy.flow_version_id == source.flow_version_id
        assert session.scalar(select(ProjectFlow.id).where(ProjectFlow.enabled.is_(False))) is None
        interrupted = session.scalars(
            select(Job).where(Job.project_id == copy_id, Job.kind == "diagnostic")
        ).all()
        assert [(job.status, job.error_code) for job in interrupted] == [
            ("cancelled", INTERRUPTED_CODE)
        ]
        assert session.get(Job, seeded.queued_job_id).status == "queued"  # type: ignore[union-attr]
        restore_row = session.scalar(
            select(ProjectRestore).where(ProjectRestore.result_project_id == copy_id)
        )
        assert restore_row is not None
        assert restore_row.package_sha256 == package.package_sha256

    # The copy is a working project: a CAS save appends version N+1.
    with sessions() as session:
        current = documents.get_current_document(session, copy_id)
    with sessions() as session:
        saved = documents.save_document(
            session,
            copy_id,
            current.id,
            DocumentSave.model_validate(
                {
                    "content": current.content.model_dump(mode="json"),
                    "expected_version": current.version,
                }
            ),
        )
    assert saved.version == current.version + 1

    # Stored packages and restore results are immutable at the database layer.
    with sessions() as session, pytest.raises(DBAPIError), session.begin():
        session.execute(update(BackupArchive).values(filename="改名.zip"))
    with sessions() as session, pytest.raises(DBAPIError), session.begin():
        session.execute(update(ProjectRestore).values(result_project_id=seeded.project_id))


def test_restore_into_clean_instance_copies_flows_and_keeps_digests(
    postgres: PostgreSQLSandbox,
) -> None:
    seeded = seed_project(postgres.sessions)
    source = snapshot(postgres.sessions, seeded.project_id)
    data = backup(postgres.sessions, seeded.project_id)
    with clean_instance() as clean:
        copy_id = restore(clean, data)
        copied = snapshot(clean, copy_id)
        assert {t: len(r) for t, r in copied.items()} == {t: len(r) for t, r in source.items()}
        assert history(clean, copy_id) == history(postgres.sessions, seeded.project_id)
        assert originals(clean, copy_id) == originals(postgres.sessions, seeded.project_id)
        with clean() as session:
            copy = session.get(Project, copy_id)
            assert copy is not None and copy.flow_version_id is not None
            version = session.get(ProjectFlowVersion, copy.flow_version_id)
            flow = session.get(ProjectFlow, version.flow_id)  # type: ignore[union-attr]
            assert flow is not None and flow.enabled is False
            assert version.stages[0]["id"] == "proposal"  # type: ignore[union-attr]
        # Restoring the same package twice yields two independent copies.
        second = restore(clean, data)
        assert second != copy_id
        assert {t: len(r) for t, r in snapshot(clean, second).items()} == {
            t: len(r) for t, r in source.items()
        }


def test_every_registered_table_is_covered_by_the_package(postgres: PostgreSQLSandbox) -> None:
    seeded = seed_project(postgres.sessions)
    package = read_package(backup(postgres.sessions, seeded.project_id))
    assert set(package.data) == {spec.table for spec in PROJECT_TABLES}
    assert set(package.refs) == {"project_flows", "project_flow_versions", "ai_config_versions"}


def test_backup_migration_downgrades_only_without_backup_history(
    postgres: PostgreSQLSandbox,
) -> None:
    engine = postgres.sessions.kw["bind"]
    try:
        with engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261119_0021")
            command.upgrade(postgres.alembic, "head")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    seeded = seed_project(postgres.sessions)
    backup(postgres.sessions, seeded.project_id)
    try:
        with pytest.raises(DBAPIError), engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261119_0021")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    with postgres.sessions() as session:
        head = ScriptDirectory.from_config(postgres.alembic).get_current_head()
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == head
        assert session.scalar(select(func.count()).select_from(BackupArchive)) == 1
