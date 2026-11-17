"""SG-22 E: saved literature entries join the content assistant's fixed context."""

from collections.abc import Iterator
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from test_assistant_sessions import prepared

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.assistant_sessions import service
from thesis_pilot.modules.assistant_sessions.schemas import AssistantRunCreate
from thesis_pilot.modules.literature import sources
from thesis_pilot.workers.execution import execute_job

API = "/api/v1"
WORKS = [
    {
        "DOI": "10.5555/ctx.a",
        "title": ["Collaborative filtering for sparse campus interactions"],
        "author": [{"given": "Ming", "family": "Li"}],
        "issued": {"date-parts": [[2020]]},
        "container-title": ["Journal of Synthetic Recommenders"],
        "abstract": "<jats:p>Sparse interactions are densified.</jats:p>",
        "type": "journal-article",
    }
]


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    def handler(request: httpx.Request) -> httpx.Response:
        if "/works/" in request.url.path:
            return httpx.Response(200, json={"status": "ok", "message": WORKS[0]})
        return httpx.Response(200, json={"message": {"total-results": 1, "items": WORKS}})

    monkeypatch.setattr(sources, "TRANSPORT", httpx.MockTransport(handler))
    monkeypatch.setattr(sources, "MIN_INTERVAL_SECONDS", 0.0)
    yield


def saved_entry(client: TestClient, factory: sessionmaker[Session], project_id: UUID) -> dict:
    receipt = client.post(
        f"{API}/projects/{project_id}/literature/searches",
        json={"command_id": str(uuid4()), "query": "协同过滤"},
    ).json()
    execute_job(factory, UUID(receipt["job"]["id"]), 60)
    response = client.post(
        f"{API}/projects/{project_id}/literature/entries",
        json={"command_id": str(uuid4()), "search_id": receipt["search"]["id"], "result_index": 0},
    )
    assert response.status_code == 201, response.text
    return response.json()


def with_literature(request: AssistantRunCreate, entries: list[dict]) -> AssistantRunCreate:
    payload = request.model_dump(mode="json")
    payload["command_id"] = str(uuid4())
    payload["input"]["literature_entries"] = entries
    return AssistantRunCreate.model_validate(payload)


def test_literature_entries_are_frozen_as_untrusted_with_obtained_scope(
    client: TestClient, session_factory: sessionmaker[Session], fake: None
) -> None:
    project, _, conversation, request = prepared(session_factory)
    entry = saved_entry(client, session_factory, project.id)
    pinned = [{"entry_id": entry["id"], "entry_version": entry["version"]}]
    with session_factory() as session:
        receipt = service.create_run(
            session, project.id, conversation.id, with_literature(request, pinned)
        )
        context = service.get_context(session, project.id, receipt.run.id)
    frozen = context.context_snapshot["literature"]
    assert frozen == [
        {
            "entry_id": entry["id"],
            "entry_version": entry["version"],
            "untrusted": True,
            "obtained": "题录与摘要",
            "full_text": False,
            "verification": entry["verification"],
            "source": "crossref",
            "source_id": "10.5555/ctx.a",
            "doi": "10.5555/ctx.a",
            "title": "Collaborative filtering for sparse campus interactions",
            "authors": ["Ming Li"],
            "year": 2020,
            "venue": "Journal of Synthetic Recommenders",
            "publisher": None,
            "work_type": "journal-article",
            "volume": None,
            "issue": None,
            "pages": None,
            "abstract": "Sparse interactions are densified.",
        }
    ]
    assert context.input.literature_entries[0].entry_version == entry["version"]


def test_runs_without_literature_keep_the_earlier_context_shape(
    session_factory: sessionmaker[Session],
) -> None:
    project, _, conversation, request = prepared(session_factory)
    with session_factory() as session:
        receipt = service.create_run(session, project.id, conversation.id, request)
        context = service.get_context(session, project.id, receipt.run.id)
    assert "literature" not in context.context_snapshot
    assert context.input.literature_entries == []


def test_stale_removed_or_foreign_literature_is_rejected_before_any_write(
    client: TestClient, session_factory: sessionmaker[Session], fake: None
) -> None:
    project, _, conversation, request = prepared(session_factory)
    entry = saved_entry(client, session_factory, project.id)
    stale = [{"entry_id": entry["id"], "entry_version": entry["version"] + 1}]
    with session_factory() as session, pytest.raises(AppError) as raised:
        service.create_run(session, project.id, conversation.id, with_literature(request, stale))
    assert raised.value.code == "ASSISTANT_CONTEXT_STALE"
    other = client.post(f"{API}/projects", json={"name": "另一合成项目"}).json()["id"]
    foreign = saved_entry(client, session_factory, UUID(other))
    pinned = [{"entry_id": foreign["id"], "entry_version": foreign["version"]}]
    with session_factory() as session, pytest.raises(AppError) as raised:
        service.create_run(session, project.id, conversation.id, with_literature(request, pinned))
    assert raised.value.code == "ASSISTANT_SOURCE_INVALID"
    removed = client.post(
        f"{API}/projects/{project.id}/literature/entries/{entry['id']}/remove",
        json={"command_id": str(uuid4()), "expected_version": entry["version"]},
    ).json()
    pinned = [{"entry_id": entry["id"], "entry_version": removed["version"]}]
    with session_factory() as session, pytest.raises(AppError) as raised:
        service.create_run(session, project.id, conversation.id, with_literature(request, pinned))
    assert raised.value.code == "ASSISTANT_SOURCE_INVALID"
    with session_factory() as session:
        assert (
            service.list_runs(session, project.id, conversation.id, limit=10, offset=0).total == 0
        )
    duplicate = [pinned[0], pinned[0]]
    with pytest.raises(ValueError):
        with_literature(request, duplicate)
