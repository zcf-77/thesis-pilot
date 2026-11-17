"""SG-22 E: the optional OpenAlex key is sent to OpenAlex only and never stored or logged."""

import logging
from collections.abc import Iterator
from types import SimpleNamespace
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.modules.jobs.models import Job, JobArtifact
from thesis_pilot.modules.literature import jobs as literature_jobs
from thesis_pilot.modules.literature import sources
from thesis_pilot.modules.literature.models import LiteratureSearchSnapshot
from thesis_pilot.workers.execution import execute_job

API = "/api/v1"
CROSSREF_BODY = {"message": {"total-results": 0, "items": []}}


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[httpx.Request]]:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.host == "api.openalex.org":
            return httpx.Response(200, json=OPENALEX_BODY)
        return httpx.Response(200, json=CROSSREF_BODY)

    monkeypatch.setattr(sources, "TRANSPORT", httpx.MockTransport(handler))
    monkeypatch.setattr(sources, "MIN_INTERVAL_SECONDS", 0.0)
    yield calls


SECRET = "tp-test-openalex-key-0123456789"
OPENALEX_BODY = {
    "meta": {"count": 1},
    "results": [
        {
            "id": "https://openalex.org/W9",
            "display_name": "Graph based recommendation",
            "doi": "https://doi.org/10.5555/cite.a",
            "publication_year": 2022,
            "type": "article",
            "primary_location": {"source": {"display_name": "Synthetic Venue"}},
            "biblio": {"volume": "7", "issue": "1", "first_page": "10", "last_page": "19"},
        }
    ],
}


def test_openalex_key_is_sent_but_never_stored_or_logged(
    client: TestClient,
    session_factory: sessionmaker[Session],
    fake: list[httpx.Request],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(
        literature_jobs,
        "get_settings",
        lambda: SimpleNamespace(openalex_api_key=SecretStr(SECRET)),
    )
    project_id = client.post(f"{API}/projects", json={"name": "开放检索"}).json()["id"]
    caplog.set_level(logging.DEBUG)
    for source in ("openalex", "crossref"):
        receipt = client.post(
            f"{API}/projects/{project_id}/literature/searches",
            json={"command_id": str(uuid4()), "query": "graph", "source": source},
        ).json()
        assert execute_job(session_factory, UUID(receipt["job"]["id"]), 60)
    openalex, crossref = fake[0], fake[1]
    assert openalex.url.params["api_key"] == SECRET
    assert "api_key" not in crossref.url.params
    assert SECRET not in caplog.text
    searches = client.get(f"{API}/projects/{project_id}/literature/searches").json()
    item = next(row for row in searches["items"] if row["source"] == "openalex")
    assert item["status"] == "succeeded"
    first = item["snapshot"]["items"][0]
    assert (first["volume"], first["issue"], first["pages"]) == ("7", "1", "10-19")
    assert SECRET not in str(searches)
    with session_factory() as session:
        stored = [
            *session.scalars(select(LiteratureSearchSnapshot)),
            *session.scalars(select(JobArtifact)),
            *session.scalars(select(Job)),
        ]
        assert SECRET not in repr([getattr(row, "__dict__", row) for row in stored])
    # A response URL keeps no key; logging the request line redacts it.
    response = sources.search(
        "openalex", sources.SearchParams("graph", 5, None, None), api_key=SECRET
    )
    assert SECRET not in response.request_url and "api_key" not in response.request_url
    logging.getLogger("httpx").info(
        "HTTP Request: GET %s",
        sources.search_url("openalex", sources.SearchParams("graph", 5, None, None), SECRET),
    )
    assert SECRET not in caplog.text


def test_openalex_failure_does_not_expose_key(
    client: TestClient,
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot reach {request.url}", request=request)

    monkeypatch.setattr(sources, "TRANSPORT", httpx.MockTransport(boom))
    monkeypatch.setattr(sources, "MIN_INTERVAL_SECONDS", 0.0)
    monkeypatch.setattr(
        literature_jobs,
        "get_settings",
        lambda: SimpleNamespace(openalex_api_key=SecretStr(SECRET)),
    )
    caplog.set_level(logging.DEBUG)
    project_id = client.post(f"{API}/projects", json={"name": "开放检索失败"}).json()["id"]
    receipt = client.post(
        f"{API}/projects/{project_id}/literature/searches",
        json={"command_id": str(uuid4()), "query": "graph", "source": "openalex"},
    ).json()
    execute_job(session_factory, UUID(receipt["job"]["id"]), 60)
    search = client.get(
        f"{API}/projects/{project_id}/literature/searches/{receipt['search']['id']}"
    ).json()
    assert search["status"] == "failed" and search["error_code"] == "LITERATURE_SOURCE_UNAVAILABLE"
    assert SECRET not in caplog.text and SECRET not in str(search)
    with pytest.raises(sources.SourceError) as raised:
        sources.search("openalex", sources.SearchParams("g", 1, None, None), api_key=SECRET)
    assert SECRET not in str(raised.value) and raised.value.__cause__ is None
