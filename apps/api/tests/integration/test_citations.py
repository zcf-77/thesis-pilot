"""SG-22 E citation adoption on real PostgreSQL: one winner, idempotent replay, undo."""

import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any, cast
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import func, select

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.citations import service
from thesis_pilot.modules.citations.models import CitationCandidate, CitationCommand
from thesis_pilot.modules.citations.schemas import (
    CitationApply,
    CitationCandidateRead,
    CitationCreate,
    CitationUndo,
)
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentImport, DocumentSchemaUpgradeCreate
from thesis_pilot.modules.literature import service as literature
from thesis_pilot.modules.literature import sources
from thesis_pilot.modules.literature.schemas import LiteratureEntryCreate, LiteratureSearchCreate
from thesis_pilot.workers.execution import execute_job

from .conftest import PostgreSQLSandbox
from .test_services import make_project

pytestmark = pytest.mark.integration
ITEMS = [
    {
        "DOI": f"10.5555/pg.cite.{index}",
        "title": [f"Synthetic citation study {index}"],
        "issued": {"date-parts": [[2020 + index]]},
        "container-title": ["Journal of Synthetic Studies"],
        "type": "journal-article",
    }
    for index in range(2)
]
V1: dict[str, Any] = {
    "type": "doc",
    "content": [
        {
            "type": "heading",
            "attrs": {"chapterId": "pg-c1", "level": 1},
            "content": [{"type": "text", "text": "集成章节"}],
        },
        {"type": "paragraph", "content": [{"type": "text", "text": "集成测试段落。"}]},
    ],
}


def handler(request: httpx.Request) -> httpx.Response:
    if "/works/" in request.url.path:
        doi = request.url.path.split("/works/", 1)[1]
        item = next(row for row in ITEMS if row["DOI"] == doi)
        return httpx.Response(200, json={"message": item})
    body = {"message": {"total-results": 2, "items": ITEMS}}
    return httpx.Response(200, content=json.dumps(body).encode())


@pytest.fixture(autouse=True)
def fake_source(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(sources, "TRANSPORT", httpx.MockTransport(handler))
    monkeypatch.setattr(sources, "MIN_INTERVAL_SECONDS", 0.0)
    yield


def prepared(postgres: PostgreSQLSandbox) -> tuple[UUID, UUID, str, list[UUID]]:
    project_id = make_project(postgres)
    with postgres.sessions() as session:
        document = documents.import_document(
            session,
            project_id,
            DocumentImport.model_validate({"content": {"schema_version": 1, "json": V1}}),
        )
    with postgres.sessions() as session:
        upgraded = documents.upgrade_schema(
            session,
            project_id,
            document.id,
            DocumentSchemaUpgradeCreate(command_id=uuid4(), expected_version=1),
        ).document
        receipt = literature.create_search(
            session, project_id, LiteratureSearchCreate(command_id=uuid4(), query="引用")
        )
    assert execute_job(postgres.sessions, receipt.job.id, 60)
    entries: list[UUID] = []
    with postgres.sessions() as session:
        for index in range(2):
            entries.append(
                literature.save_entry(
                    session,
                    project_id,
                    LiteratureEntryCreate(
                        command_id=uuid4(), search_id=receipt.search.id, result_index=index
                    ),
                ).id
            )
    blocks = cast(dict[str, Any], upgraded.content.json_content)["model"]["sections"][0]["blocks"]
    return project_id, document.id, cast(str, blocks[1]["id"]), entries


def candidate(
    postgres: PostgreSQLSandbox, project_id: UUID, document_id: UUID, node: str, entry: UUID
) -> CitationCandidateRead:
    with postgres.sessions() as session:
        return service.create_candidate(
            session,
            project_id,
            document_id,
            CitationCreate.model_validate(
                {
                    "command_id": str(uuid4()),
                    "base_version": 2,
                    "entry_id": str(entry),
                    "placement": {"node_id": node, "offset": 2},
                }
            ),
        )


def test_concurrent_adoptions_have_one_winner_and_replay_is_idempotent(
    postgres: PostgreSQLSandbox,
) -> None:
    project_id, document_id, node, (entry_a, entry_b) = prepared(postgres)
    first = candidate(postgres, project_id, document_id, node, entry_a)
    second = candidate(postgres, project_id, document_id, node, entry_b)
    barrier = Barrier(2)
    commands = {first.id: uuid4(), second.id: uuid4()}

    def adopt(item: CitationCandidateRead) -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                service.apply_candidate(
                    session,
                    project_id,
                    document_id,
                    item.id,
                    CitationApply(
                        command_id=commands[item.id],
                        expected_revision=item.revision,
                        expected_document_version=2,
                    ),
                )
                return "applied"
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(2) as pool:
        outcomes = sorted(pool.map(adopt, [first, second]))
    assert outcomes[0] == "CITATION_STALE" and outcomes[1] == "applied"
    with postgres.sessions() as session, session.begin():
        assert (
            session.scalar(
                select(func.max(DocumentVersion.version)).where(
                    DocumentVersion.document_id == document_id
                )
            )
            == 3
        )
        winner = session.scalar(
            select(CitationCandidate).where(CitationCandidate.status == "applied")
        )
        assert winner is not None and winner.result_version == 3
        assert session.scalar(select(func.count()).select_from(CitationCommand)) == 3
    # Replaying the winning command returns the stored result and writes nothing.
    winner_read = first if winner.id == first.id else second
    with postgres.sessions() as session:
        replay = service.apply_candidate(
            session,
            project_id,
            document_id,
            winner_read.id,
            CitationApply(
                command_id=commands[winner_read.id],
                expected_revision=winner_read.revision,
                expected_document_version=2,
            ),
        )
    assert replay.status == "applied" and replay.result_version == 3
    with postgres.sessions() as session:
        undone = service.undo_candidate(
            session,
            project_id,
            document_id,
            winner_read.id,
            CitationUndo(command_id=uuid4(), expected_document_version=3),
        )
        assert undone.status == "undone" and undone.document_version == 4
        current = documents.get_current_document(session, project_id)
    with postgres.sessions() as session, session.begin():
        base = session.get(DocumentVersion, (document_id, 2))
        assert base is not None
        assert current.content.json_content == base.content_json
