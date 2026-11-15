"""Real PostgreSQL arbitration, immutable facts and restarted HTTP revisions."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from threading import Barrier, Event
from uuid import uuid4

import pytest
from alembic import command
from sqlalchemy import MetaData, Table, delete, event, func, select, update
from sqlalchemy.exc import DBAPIError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentContent, DocumentImport
from thesis_pilot.modules.documents.structure import MAX_CONTENT_BYTES, compact_json
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.revisions import service
from thesis_pilot.modules.revisions.models import (
    RevisionCandidate,
    RevisionCommand,
    RevisionProposal,
)
from thesis_pilot.modules.revisions.schemas import (
    RevisionApply,
    RevisionCancel,
    RevisionCreate,
    RevisionDecide,
    RevisionUndo,
)
from thesis_pilot.modules.revisions.schemas import (
    RevisionProposal as ProposalInput,
)

from .conftest import PostgreSQLSandbox
from .test_documents import real_http

pytestmark = pytest.mark.integration


def content(text: str = "采用方法甲😀\u0000。") -> dict:
    return {
        "schema_version": 1,
        "json": {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
        },
    }


def seeded(postgres: PostgreSQLSandbox) -> tuple:
    with postgres.sessions() as session:
        project = create_project(session, ProjectCreate(name="修订真实PG自制项目"))
        document = documents.import_document(session, project.id, DocumentImport(content=content()))
    return project.id, document.id


def registered(postgres: PostgreSQLSandbox, ids: tuple):
    with postgres.sessions() as session:
        receipt = service.create_revision(
            session,
            *ids,
            RevisionCreate.model_validate(
                {
                    "command_id": str(uuid4()),
                    "base_version": 1,
                    "selection": {"textblock_path": [0], "from": 1, "to": 3, "text": "采用"},
                    "goal": "精简\u0000目标",
                }
            ),
        )
        return service.get_revision(session, *ids, receipt.candidate_id)


def prepared(postgres: PostgreSQLSandbox, ids: tuple, *, accepted: bool = True):
    item = registered(postgres, ids)
    with postgres.sessions() as session:
        service.submit_proposal(
            session,
            *ids,
            item.id,
            ProposalInput.model_validate(
                {
                    "command_id": str(uuid4()),
                    "generation_token": str(item.generation_token),
                    "patches": [
                        {"id": "p1", "from": 1, "to": 3, "before": "采用", "after": "使用"}
                    ],
                }
            ),
        )
        if accepted:
            service.decide_revision(
                session,
                *ids,
                item.id,
                RevisionDecide.model_validate(
                    {
                        "command_id": str(uuid4()),
                        "expected_revision": 2,
                        "decisions": [{"patch_id": "p1", "decision": "accepted"}],
                    }
                ),
            )
        return service.get_revision(session, *ids, item.id)


def test_upgrade_from_documents_preserves_original_versions(postgres: PostgreSQLSandbox) -> None:
    engine = postgres.sessions.kw["bind"]
    ids = (uuid4(), uuid4())
    now = datetime.now(UTC)
    try:
        with engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261117_0003")
            # Historical fixtures must match the actual old schema rather than
            # today's ORM, which now includes lifecycle columns absent in 0003.
            metadata = MetaData()
            old_projects = Table("projects", metadata, autoload_with=connection)
            old_documents = Table("documents", metadata, autoload_with=connection)
            old_versions = Table("document_versions", metadata, autoload_with=connection)
            connection.execute(
                old_projects.insert(),
                {
                    "id": ids[0],
                    "name": "修订真实PG自制项目",
                    "version": 1,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            connection.execute(
                old_documents.insert(),
                {
                    "id": ids[1],
                    "project_id": ids[0],
                    "current_version": 1,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            connection.execute(
                old_versions.insert(),
                {
                    "document_id": ids[1],
                    "version": 1,
                    "schema_version": 1,
                    "content_json": content()["json"],
                    "source": "local_import",
                    "created_at": now,
                },
            )
        with engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.upgrade(postgres.alembic, "head")
            command.check(postgres.alembic)
    finally:
        postgres.alembic.attributes.pop("connection", None)
    item = prepared(postgres, ids)
    with postgres.sessions() as session:
        receipt = service.apply_revision(
            session,
            *ids,
            item.id,
            RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=1),
        )
        assert receipt.result_version == 2
        assert documents.get_version(session, *ids, 1).content.json_content == content()["json"]
        assert "\u0000" in service.get_revision(session, *ids, item.id).goal
        assert (
            documents.get_version(session, *ids, 2).content.json_content
            == content("使用方法甲😀\u0000。")["json"]
        )


def test_competing_candidates_and_same_command_have_one_version(
    postgres: PostgreSQLSandbox,
) -> None:
    ids = seeded(postgres)
    items = [prepared(postgres, ids), prepared(postgres, ids)]
    barrier = Barrier(2, timeout=10)

    def apply(item):
        barrier.wait()
        with postgres.sessions() as session:
            try:
                return service.apply_revision(
                    session,
                    *ids,
                    item.id,
                    RevisionApply(
                        command_id=uuid4(), expected_revision=3, expected_document_version=1
                    ),
                ).result_version
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(apply, items))
    assert sorted(map(str, results)) == ["2", "REVISION_STALE"]
    other = seeded(postgres)
    item = prepared(postgres, other)
    fixed = RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=1)
    repeat = Barrier(2, timeout=10)

    def replay(_):
        repeat.wait()
        with postgres.sessions() as session:
            return service.apply_revision(session, *other, item.id, fixed)

    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = list(pool.map(replay, range(2)))
    assert receipts[0] == receipts[1] and receipts[0].result_version == 2
    with postgres.sessions() as session:
        assert documents.list_versions(session, *ids, limit=100, offset=0).total == 2
        assert documents.list_versions(session, *other, limit=100, offset=0).total == 2


def test_waiting_apply_rechecks_version_after_document_lock(postgres: PostgreSQLSandbox) -> None:
    ids = seeded(postgres)
    item = prepared(postgres, ids)
    entered = Event()

    def waiting():
        entered.set()
        with postgres.sessions() as session:
            try:
                service.apply_revision(
                    session,
                    *ids,
                    item.id,
                    RevisionApply(
                        command_id=uuid4(), expected_revision=3, expected_document_version=1
                    ),
                )
                return "unexpected-success"
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=1) as pool:
        with postgres.sessions() as locked, locked.begin():
            locked.scalar(select(Document).where(Document.id == ids[1]).with_for_update())
            future = pool.submit(waiting)
            assert entered.wait(timeout=5)
            documents.append_document_version(
                locked, *ids, 1, DocumentContent.model_validate(content("手动新稿")), "manual_edit"
            )
        assert future.result(timeout=10) == "REVISION_STALE"
    with postgres.sessions() as session:
        assert (
            documents.get_current_document(session, ids[0]).content.json_content
            == content("手动新稿")["json"]
        )
        assert service.get_revision(session, *ids, item.id).status == "ready"


def test_review_cas_and_cancel_result_race(postgres: PostgreSQLSandbox) -> None:
    ids = seeded(postgres)
    item = prepared(postgres, ids, accepted=False)
    barrier = Barrier(2, timeout=10)

    def decide(decision):
        barrier.wait()
        with postgres.sessions() as session:
            try:
                service.decide_revision(
                    session,
                    *ids,
                    item.id,
                    RevisionDecide.model_validate(
                        {
                            "command_id": str(uuid4()),
                            "expected_revision": 2,
                            "decisions": [{"patch_id": "p1", "decision": decision}],
                        }
                    ),
                )
                return "saved"
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(decide, ["accepted", "rejected"])) == [
            "REVISION_REVIEW_CONFLICT",
            "saved",
        ]
    generating = registered(postgres, ids)
    race = Barrier(2, timeout=10)

    def finish(operation):
        race.wait()
        with postgres.sessions() as session:
            try:
                if operation == "cancel":
                    service.cancel_revision(
                        session, *ids, generating.id, RevisionCancel(command_id=uuid4())
                    )
                else:
                    service.submit_proposal(
                        session,
                        *ids,
                        generating.id,
                        ProposalInput.model_validate(
                            {
                                "command_id": str(uuid4()),
                                "generation_token": str(generating.generation_token),
                                "patches": [
                                    {
                                        "id": "p1",
                                        "from": 1,
                                        "to": 3,
                                        "before": "采用",
                                        "after": "使用",
                                    }
                                ],
                            }
                        ),
                    )
                return operation
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(finish, ["cancel", "proposal"]))
    assert "cancel" in outcomes
    with postgres.sessions() as session:
        assert service.get_revision(session, *ids, generating.id).status == "cancelled"
        assert documents.get_current_document(session, ids[0]).version == 1
        with pytest.raises(AppError) as late:
            service.submit_proposal(
                session,
                *ids,
                generating.id,
                ProposalInput.model_validate(
                    {
                        "command_id": str(uuid4()),
                        "generation_token": str(generating.generation_token),
                        "patches": [
                            {"id": "p1", "from": 1, "to": 3, "before": "采用", "after": "改用"}
                        ],
                    }
                ),
            )
        assert late.value.code == "REVISION_STATE_CONFLICT"


def test_immutable_proposals_commands_and_fixed_candidate_input(
    postgres: PostgreSQLSandbox,
) -> None:
    ids = seeded(postgres)
    item = prepared(postgres, ids)
    engine = postgres.sessions.kw["bind"]
    statements = [
        update(RevisionProposal)
        .where(RevisionProposal.candidate_id == item.id)
        .values(digest="0" * 64),
        delete(RevisionProposal).where(RevisionProposal.candidate_id == item.id),
        update(RevisionCommand)
        .where(RevisionCommand.candidate_id == item.id)
        .values(request_hash="0" * 64),
        delete(RevisionCommand).where(RevisionCommand.candidate_id == item.id),
        update(RevisionCandidate)
        .where(RevisionCandidate.id == item.id)
        .values(policy_version="weaker"),
        update(RevisionCandidate)
        .where(RevisionCandidate.id == item.id)
        .values(input_json={"goal": "replace"}),
        delete(RevisionCandidate).where(RevisionCandidate.id == item.id),
    ]
    for statement in statements:
        with pytest.raises(DBAPIError), engine.begin() as connection:
            connection.execute(statement)
    try:
        with pytest.raises(RuntimeError, match="Refusing"), engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261117_0003")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    with postgres.sessions() as session:
        assert service.get_revision(session, *ids, item.id) == item


def test_real_rollback_and_concurrent_undo_keep_history(postgres: PostgreSQLSandbox) -> None:
    ids = seeded(postgres)
    item = prepared(postgres, ids)

    def injected(mapper, connection, target):
        if target.operation == "apply":
            raise RuntimeError("synthetic receipt failure")

    event.listen(RevisionCommand, "before_insert", injected)
    try:
        with postgres.sessions() as session, pytest.raises(RuntimeError, match="synthetic"):
            service.apply_revision(
                session,
                *ids,
                item.id,
                RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=1),
            )
    finally:
        event.remove(RevisionCommand, "before_insert", injected)
    with postgres.sessions() as session:
        assert documents.get_current_document(session, ids[0]).version == 1
        assert service.get_revision(session, *ids, item.id).revision == 3
        receipt = service.apply_revision(
            session,
            *ids,
            item.id,
            RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=1),
        )
    barrier = Barrier(2, timeout=10)

    def undo(_):
        barrier.wait()
        with postgres.sessions() as session:
            try:
                return service.undo_revision(
                    session,
                    *ids,
                    receipt.command_id,
                    RevisionUndo(command_id=uuid4(), expected_document_version=2),
                ).result_version
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(undo, range(2)))
    assert sorted(map(str, results)) == ["3", "REVISION_UNDO_CONFLICT"]
    with postgres.sessions() as session:
        assert (
            documents.get_version(session, *ids, 3).content
            == documents.get_version(session, *ids, 1).content
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(DocumentVersion)
                .where(DocumentVersion.document_id == ids[1])
            )
            == 3
        )


def test_restarted_real_http_preserves_80_depth_unicode_and_receipt(
    postgres: PostgreSQLSandbox, tmp_path: Path
) -> None:
    payload = content()
    node = payload["json"]["content"][0]
    for _ in range(78):
        node = {"type": "blockquote", "content": [node]}
    payload["json"]["content"] = [node]
    with real_http(postgres, tmp_path / "revisions-http.log") as client:
        project = client.post("/api/v1/projects", json={"name": "修订80层真实HTTP"}).json()
        imported = client.post(
            f"/api/v1/projects/{project['id']}/documents", json={"content": payload}
        )
        assert imported.status_code == 201, imported.text
        prefix = f"/api/v1/projects/{project['id']}/documents/{imported.json()['id']}"
        created = client.post(
            prefix + "/revisions",
            json={
                "command_id": str(uuid4()),
                "base_version": 1,
                "selection": {"textblock_path": [0] * 79, "from": 79, "to": 81, "text": "采用"},
                "goal": "精简\u0000目标",
            },
        )
        assert created.status_code == 201, created.text
        path = prefix + "/revisions/" + created.json()["candidate_id"]
        item = client.get(path).json()
        proposal = client.put(
            path + "/proposal",
            json={
                "command_id": str(uuid4()),
                "generation_token": item["generation_token"],
                "patches": [{"id": "p1", "from": 79, "to": 81, "before": "采用", "after": "使用"}],
            },
        )
        assert proposal.status_code == 200, proposal.text
        assert (
            client.put(
                path + "/decisions",
                json={
                    "command_id": str(uuid4()),
                    "expected_revision": 2,
                    "decisions": [{"patch_id": "p1", "decision": "accepted"}],
                },
            ).status_code
            == 200
        )
        request = {
            "command_id": str(uuid4()),
            "expected_revision": 3,
            "expected_document_version": 1,
        }
        applied = client.post(path + "/apply", json=request)
        assert applied.status_code == 200, applied.text
        fixed = applied.json()
    with real_http(postgres, tmp_path / "revisions-http.log") as client:
        assert client.get(prefix + "/revision-commands/" + request["command_id"]).json() == fixed
        assert client.post(path + "/apply", json=request).json() == fixed
        restored = client.get(path).json()
        assert restored["application_command_id"] == request["command_id"]
        assert restored["status"] == "applied" and restored["goal"].endswith("\u0000目标")
        undo = client.post(
            prefix + "/revision-commands/" + request["command_id"] + "/undo",
            json={"command_id": str(uuid4()), "expected_document_version": 2},
        )
        assert undo.status_code == 200 and undo.json()["result_version"] == 3
        assert client.get(prefix + "/versions/3").json()["content"] == payload


def test_real_16_mib_result_limit_rejects_atomically(postgres: PostgreSQLSandbox) -> None:
    overhead = len(compact_json(content("")["json"]).encode("utf-8"))
    text = "采用" + "a" * (MAX_CONTENT_BYTES - overhead - len("采用".encode()))
    initial = content(text)
    assert len(compact_json(initial["json"]).encode("utf-8")) == MAX_CONTENT_BYTES
    with postgres.sessions() as session:
        project = create_project(session, ProjectCreate(name="修订16MiB自制边界"))
        original = documents.import_document(session, project.id, DocumentImport(content=initial))
    ids = (project.id, original.id)
    item = registered(postgres, ids)
    with postgres.sessions() as session:
        service.submit_proposal(
            session,
            *ids,
            item.id,
            ProposalInput.model_validate(
                {
                    "command_id": str(uuid4()),
                    "generation_token": str(item.generation_token),
                    "patches": [
                        {"id": "p1", "from": 1, "to": 3, "before": "采用", "after": "本次增加文字"}
                    ],
                }
            ),
        )
        service.decide_revision(
            session,
            *ids,
            item.id,
            RevisionDecide.model_validate(
                {
                    "command_id": str(uuid4()),
                    "expected_revision": 2,
                    "decisions": [{"patch_id": "p1", "decision": "accepted"}],
                }
            ),
        )
        apply_id = uuid4()
        with pytest.raises(AppError) as oversized:
            service.apply_revision(
                session,
                *ids,
                item.id,
                RevisionApply(
                    command_id=apply_id, expected_revision=3, expected_document_version=1
                ),
            )
        assert oversized.value.code == "DOCUMENT_TOO_LARGE"
        assert oversized.value.status_code == 413
        preserved = service.get_revision(session, *ids, item.id)
        assert preserved.status == "ready" and preserved.revision == 3
        assert preserved.result_version is None and preserved.application_command_id is None
        assert documents.get_current_document(session, project.id) == original
        with pytest.raises(AppError) as absent:
            service.get_command(session, *ids, apply_id)
        assert absent.value.code == "REVISION_COMMAND_NOT_FOUND"
        assert (
            session.scalar(
                select(func.count())
                .select_from(DocumentVersion)
                .where(DocumentVersion.document_id == original.id)
            )
            == 1
        )
