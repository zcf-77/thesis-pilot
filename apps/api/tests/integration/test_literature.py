"""SG-11 literature invariants on real PostgreSQL with a fake external source."""

import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID, uuid4

import httpx
import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.literature import service, sources
from thesis_pilot.modules.literature.models import (
    LiteratureEntry,
    LiteratureEntryVersion,
    LiteratureSearch,
    LiteratureSearchSnapshot,
)
from thesis_pilot.modules.literature.schemas import (
    LiteratureEntryCommand,
    LiteratureEntryCreate,
    LiteratureSearchCreate,
)
from thesis_pilot.workers.execution import execute_job

from .conftest import PostgreSQLSandbox
from .test_services import make_project

pytestmark = pytest.mark.integration

ITEM = {
    "DOI": "10.5555/pg.2023.007",
    "title": ["Synthetic collaborative filtering study"],
    "issued": {"date-parts": [[2023]]},
    "abstract": "<jats:p>Synthetic abstract.</jats:p>",
}


def handler(request: httpx.Request) -> httpx.Response:
    if "/works/" in request.url.path:
        return httpx.Response(
            200,
            json={
                "message": {"DOI": ITEM["DOI"], "title": ITEM["title"], "issued": ITEM["issued"]}
            },
        )
    body = {"message": {"total-results": 1, "items": [ITEM]}}
    return httpx.Response(200, content=json.dumps(body).encode())


@pytest.fixture(autouse=True)
def fake_source(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(sources, "TRANSPORT", httpx.MockTransport(handler))
    monkeypatch.setattr(sources, "MIN_INTERVAL_SECONDS", 0.0)
    yield


def searched(postgres: PostgreSQLSandbox) -> tuple[UUID, UUID]:
    project_id = make_project(postgres)
    with postgres.sessions() as session:
        receipt = service.create_search(
            session, project_id, LiteratureSearchCreate(command_id=uuid4(), query="协同过滤")
        )
    assert execute_job(postgres.sessions, receipt.job.id, 60)
    return project_id, receipt.search.id


def test_snapshot_history_and_inputs_are_immutable(postgres: PostgreSQLSandbox) -> None:
    project_id, search_id = searched(postgres)
    with postgres.sessions() as session:
        entry = service.save_entry(
            session,
            project_id,
            LiteratureEntryCreate(command_id=uuid4(), search_id=search_id, result_index=0),
        )
        assert entry.verification == "verified"
        service.remove_entry(
            session,
            project_id,
            entry.id,
            LiteratureEntryCommand(command_id=uuid4(), expected_version=1),
        )
    for statement in (
        update(LiteratureSearchSnapshot).values(total_results=0),
        update(LiteratureEntryVersion).values(removed=True),
        update(LiteratureSearch).values(query="被改写的检索式"),
        update(LiteratureEntry).values(title="被改写的题名", version=LiteratureEntry.version + 1),
        update(LiteratureEntry).values(removed=False),
        text("DELETE FROM literature_entries"),
        text("DELETE FROM literature_searches"),
    ):
        with postgres.sessions() as session, pytest.raises(DBAPIError), session.begin():
            session.execute(statement)
    with postgres.sessions() as session:
        stored = session.get(LiteratureEntry, entry.id)
        assert stored is not None and stored.removed and stored.version == 2
        assert (
            session.scalar(
                select(func.count())
                .select_from(LiteratureEntryVersion)
                .where(LiteratureEntryVersion.entry_id == entry.id)
            )
            == 2
        )


def test_concurrent_saves_of_one_doi_keep_a_single_entry(postgres: PostgreSQLSandbox) -> None:
    project_id, search_id = searched(postgres)
    barrier = Barrier(2)

    def save() -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                service.save_entry(
                    session,
                    project_id,
                    LiteratureEntryCreate(command_id=uuid4(), search_id=search_id, result_index=0),
                )
                return "saved"
            except AppError as failure:
                return failure.code

    with ThreadPoolExecutor(2) as pool:
        outcomes = sorted(pool.map(lambda _: save(), range(2)))
    assert outcomes == ["LITERATURE_ENTRY_DUPLICATE", "saved"]
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(LiteratureEntry)) == 1


def test_concurrent_searches_respect_the_project_busy_rule(postgres: PostgreSQLSandbox) -> None:
    project_id = make_project(postgres)
    barrier = Barrier(2)

    def start(query: str) -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                service.create_search(
                    session, project_id, LiteratureSearchCreate(command_id=uuid4(), query=query)
                )
                return "queued"
            except AppError as failure:
                return failure.code

    with ThreadPoolExecutor(2) as pool:
        outcomes = sorted(pool.map(start, ["推荐系统", "协同过滤"]))
    assert outcomes == ["LITERATURE_SEARCH_BUSY", "queued"]


def test_literature_migration_downgrades_only_without_history(postgres: PostgreSQLSandbox) -> None:
    engine = postgres.sessions.kw["bind"]
    try:
        with engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261118_0016")
            command.upgrade(postgres.alembic, "head")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    searched(postgres)
    try:
        with pytest.raises(DBAPIError), engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261118_0016")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    with postgres.sessions() as session:
        head = ScriptDirectory.from_config(postgres.alembic).get_current_head()
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == head
