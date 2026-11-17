"""Snapshot v2 invariants on real PostgreSQL: one upgrade, CAS, protections, migration."""

import base64
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from typing import Any
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import resources, service
from thesis_pilot.modules.documents.models import (
    DocumentResource,
    DocumentSchemaUpgrade,
    DocumentVersion,
)
from thesis_pilot.modules.documents.schemas import (
    DocumentImport,
    DocumentResourceUpload,
    DocumentSave,
    DocumentSchemaUpgradeCreate,
)
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project

from .conftest import PostgreSQLSandbox

pytestmark = pytest.mark.integration
LOCK = {"type": "aiLock"}
V1: dict[str, Any] = {
    "type": "doc",
    "content": [
        {
            "type": "heading",
            "attrs": {"chapterId": "chapter-pg", "level": 1},
            "content": [{"type": "text", "text": "集成章节"}],
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "数值"},
                {"type": "text", "text": "3.14𠮷", "marks": [LOCK]},
            ],
        },
    ],
}
# 1×1 transparent GIF, self-made constant.
GIF = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")


def imported(postgres: PostgreSQLSandbox) -> tuple[UUID, UUID]:
    with postgres.sessions() as session:
        project_id = create_project(session, ProjectCreate(name="正文 v2 集成项目")).id
    with postgres.sessions() as session:
        document = service.import_document(
            session,
            project_id,
            DocumentImport.model_validate({"content": {"schema_version": 1, "json": V1}}),
        )
    return project_id, document.id


def upgrade(postgres: PostgreSQLSandbox, project_id: UUID, document_id: UUID, command_id: UUID):  # type: ignore[no-untyped-def]
    with postgres.sessions() as session:
        return service.upgrade_schema(
            session,
            project_id,
            document_id,
            DocumentSchemaUpgradeCreate(command_id=command_id, expected_version=1),
        )


def save_v2(
    postgres: PostgreSQLSandbox, project_id: UUID, document_id: UUID, version: int, snapshot: Any
):  # type: ignore[no-untyped-def]
    value = deepcopy(snapshot)
    value.pop("chapters", None)
    with postgres.sessions() as session:
        return service.save_document(
            session,
            project_id,
            document_id,
            DocumentSave.model_validate(
                {"expected_version": version, "content": {"schema_version": 2, "json": value}}
            ),
        )


def test_concurrent_upgrades_apply_once(postgres: PostgreSQLSandbox) -> None:
    project_id, document_id = imported(postgres)
    barrier = Barrier(4, timeout=10)
    shared = uuid4()
    commands = [shared, shared, uuid4(), uuid4()]

    def run(command_id: UUID) -> str:
        barrier.wait()
        try:
            result = upgrade(postgres, project_id, document_id, command_id)
            return "replayed" if result.replayed else "applied"
        except AppError as error:
            assert error.code in {"DOCUMENT_VERSION_CONFLICT", "DOCUPGRADE_ALREADY_UPGRADED"}
            return "rejected"

    with ThreadPoolExecutor(max_workers=4) as pool:
        outcomes = list(pool.map(run, commands))
    assert outcomes.count("applied") == 1
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(DocumentSchemaUpgrade)) == 1
        versions = session.scalars(
            select(DocumentVersion.schema_version)
            .where(DocumentVersion.document_id == document_id)
            .order_by(DocumentVersion.version)
        ).all()
        assert versions == [1, 2]
        winner = session.scalar(select(DocumentSchemaUpgrade.command_id))
    # Whoever shared the winning command id sees an idempotent replay, never a second write.
    if winner == shared:
        assert sorted(outcomes) == ["applied", "rejected", "rejected", "replayed"]
    replay = upgrade(postgres, project_id, document_id, winner)
    assert replay.replayed and replay.document.version == 2


def test_v2_cas_and_protection_rejection_keep_state(postgres: PostgreSQLSandbox) -> None:
    project_id, document_id = imported(postgres)
    upgraded = upgrade(postgres, project_id, document_id, uuid4()).document
    snapshot = upgraded.content.model_dump(by_alias=True)["json"]
    paragraph = snapshot["model"]["sections"][0]["blocks"][1]
    assert paragraph["inlines"] == [{"type": "run", "text": "数值3.14𠮷"}]
    assert snapshot["protections"][0]["anchor"] == {"node": paragraph["id"], "start": 2, "end": 7}

    barrier = Barrier(2, timeout=10)

    def write(suffix: str) -> str:
        changed = deepcopy(snapshot)
        changed["model"]["sections"][0]["blocks"][1]["inlines"].append(
            {"type": "run", "text": suffix, "props": {"bold": True}}
        )
        barrier.wait()
        try:
            save_v2(postgres, project_id, document_id, 2, changed)
            return "saved"
        except AppError as error:
            assert error.code == "DOCUMENT_VERSION_CONFLICT"
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(write, ["甲", "乙"])) == ["conflict", "saved"]

    with postgres.sessions() as session:
        current = service.get_current_document(session, project_id)
    tampered = current.content.model_dump(by_alias=True)["json"]
    tampered["model"]["sections"][0]["blocks"][1]["inlines"][0]["text"] = "数值2.71𠮷"
    with pytest.raises(AppError) as raised:
        save_v2(postgres, project_id, document_id, 3, tampered)
    assert raised.value.code == "DOCMODEL_PROTECTION_VIOLATED"
    with postgres.sessions() as session:
        assert service.get_current_document(session, project_id).version == 3
        assert (
            session.scalar(
                select(func.count())
                .select_from(DocumentVersion)
                .where(DocumentVersion.document_id == document_id)
            )
            == 3
        )


def test_resources_dedupe_and_are_immutable(postgres: PostgreSQLSandbox) -> None:
    project_id, _ = imported(postgres)
    upload = DocumentResourceUpload(mime="image/gif", content_base64=base64.b64encode(GIF).decode())
    barrier = Barrier(2, timeout=10)

    def put(_: int) -> bool:
        barrier.wait()
        with postgres.sessions() as session:
            return resources.upload_resource(session, project_id, upload)[1]

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(put, [0, 1])) == [False, True]
    engine = postgres.sessions.kw["bind"]
    with pytest.raises(DBAPIError), engine.begin() as connection:
        connection.execute(update(DocumentResource).values(mime="image/png"))
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(DocumentResource)) == 1


def test_migration_downgrade_refuses_when_v2_data_exists(postgres: PostgreSQLSandbox) -> None:
    engine = postgres.sessions.kw["bind"]
    try:
        with engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261118_0019")
            command.upgrade(postgres.alembic, "head")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    project_id, document_id = imported(postgres)
    upgrade(postgres, project_id, document_id, uuid4())
    try:
        with pytest.raises(DBAPIError), engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261118_0019")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    with postgres.sessions() as session:
        head = ScriptDirectory.from_config(postgres.alembic).get_current_head()
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == head
        assert (
            session.scalar(
                select(func.count())
                .select_from(DocumentVersion)
                .where(DocumentVersion.schema_version == 2)
            )
            == 1
        )
