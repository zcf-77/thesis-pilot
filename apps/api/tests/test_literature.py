"""SG-11 literature search and entries against fake external sources (no network)."""

import json
from collections.abc import Callable, Iterator
from hashlib import sha256
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.modules.jobs.models import JobArtifact
from thesis_pilot.modules.jobs.service import claim_job
from thesis_pilot.modules.literature import sources
from thesis_pilot.modules.literature.jobs import finish_literature_job
from thesis_pilot.modules.literature.models import LiteratureSearchSnapshot
from thesis_pilot.workers.execution import execute_job

API = "/api/v1"
Handler = Callable[[httpx.Request], httpx.Response]

CF_ITEMS = [
    {
        "DOI": "10.5555/CF.2020.001",
        "title": ["Collaborative filtering for sparse campus interactions"],
        "author": [{"given": "Ming", "family": "Li"}, {"name": "Synthetic Lab"}, {}],
        "issued": {"date-parts": [[2020, 3, 1]]},
        "container-title": ["Journal of Synthetic Recommenders"],
        "abstract": "<jats:title>Abstract</jats:title><jats:p>We study &amp; compare.</jats:p>",
        "type": "journal-article",
        "publisher": "Synthetic Press",
        "URL": "https://doi.org/10.5555/cf.2020.001",
    },
    {
        "DOI": "10.5555/cf.2021.002",
        "title": ["A survey of recommender evaluation"],
        "issued": {"date-parts": [[None]]},
        "type": "proceedings-article",
    },
    {"DOI": "not-a-doi", "title": ["Dropped because the DOI is malformed"]},
    {"title": []},
]


def crossref_body(items: list[dict] | None = None, total: int = 120) -> bytes:
    return json.dumps(
        {"status": "ok", "message": {"total-results": total, "items": items or CF_ITEMS}}
    ).encode()


def registry(doi: str, title: str, year: int | None = 2020) -> httpx.Response:
    message = {"DOI": doi, "title": [title], "issued": {"date-parts": [[year]]}}
    return httpx.Response(200, json={"status": "ok", "message": message})


class FakeSource:
    """Routes search and DOI lookups; each test replaces the handlers it needs."""

    def __init__(self) -> None:
        self.calls: list[httpx.Request] = []
        self.search: Handler = lambda request: httpx.Response(200, content=crossref_body())
        self.lookup: Handler = lambda request: registry(
            request.url.path.split("/works/", 1)[1],
            "Collaborative filtering for sparse campus interactions",
        )

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if "/works/" in request.url.path:
            return self.lookup(request)
        return self.search(request)


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeSource]:
    source = FakeSource()
    monkeypatch.setattr(sources, "TRANSPORT", httpx.MockTransport(source))
    monkeypatch.setattr(sources, "MIN_INTERVAL_SECONDS", 0.0)
    yield source


def project(client: TestClient, name: str = "文献自制项目") -> str:
    return client.post(f"{API}/projects", json={"name": name}).json()["id"]


def start(client: TestClient, project_id: str, **body: object) -> dict:
    payload = {"command_id": str(uuid4()), "query": "协同过滤 推荐系统", **body}
    response = client.post(f"{API}/projects/{project_id}/literature/searches", json=payload)
    assert response.status_code == 202, response.text
    return response.json()


def run(
    client: TestClient, factory: sessionmaker[Session], project_id: str, **body: object
) -> dict:
    receipt = start(client, project_id, **body)
    execute_job(factory, UUID(receipt["job"]["id"]), 60)
    return client.get(
        f"{API}/projects/{project_id}/literature/searches/{receipt['search']['id']}"
    ).json()


def save(
    client: TestClient, project_id: str, search_id: str, index: int, command: str | None = None
):
    return client.post(
        f"{API}/projects/{project_id}/literature/entries",
        json={"command_id": command or str(uuid4()), "search_id": search_id, "result_index": index},
    )


def test_search_snapshot_keeps_only_returned_fields(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeSource
) -> None:
    project_id = project(client)
    receipt = start(client, project_id, year_from=2018, year_to=2024, rows=5)
    assert receipt["search"]["status"] == "queued" and receipt["search"]["snapshot"] is None
    assert receipt["job"]["kind"] == "literature_search"
    assert execute_job(session_factory, UUID(receipt["job"]["id"]), 60)
    search = client.get(
        f"{API}/projects/{project_id}/literature/searches/{receipt['search']['id']}"
    ).json()
    assert search["status"] == "succeeded"
    request = fake.calls[0]
    assert request.headers["user-agent"] == sources.USER_AGENT
    assert "@" not in request.headers["user-agent"]
    assert request.url.params["rows"] == "5"
    assert request.url.params["filter"] == "from-pub-date:2018,until-pub-date:2024"
    snapshot = search["snapshot"]
    assert snapshot["total_results"] == 120 and snapshot["skipped_count"] == 2
    assert snapshot["response_sha256"] == sha256(crossref_body()).hexdigest()
    first, second = snapshot["items"]
    assert first["doi"] == "10.5555/cf.2020.001"
    assert first["authors"] == ["Ming Li", "Synthetic Lab"]
    assert first["abstract"] == "We study & compare."
    assert first["coverage"] == "abstract" and first["year"] == 2020
    # Nothing is inferred for fields the source did not return.
    assert second["coverage"] == "biblio" and second["abstract"] is None
    assert second["year"] is None and second["venue"] is None and second["authors"] == []
    assert second["source_url"] == "https://doi.org/10.5555/cf.2021.002"
    with session_factory() as session:
        artifact = session.scalar(
            select(JobArtifact).where(JobArtifact.job_id == UUID(receipt["job"]["id"]))
        )
        assert artifact is not None and artifact.result["item_count"] == 2
        assert (
            artifact.result["model_used"] is False and artifact.result["writes_performed"] is False
        )


@pytest.mark.parametrize(
    ("handler", "code"),
    [
        (
            lambda request: (_ for _ in ()).throw(httpx.ReadTimeout("slow", request=request)),
            "LITERATURE_SOURCE_TIMEOUT",
        ),
        (lambda request: httpx.Response(429), "LITERATURE_SOURCE_RATE_LIMITED"),
        (lambda request: httpx.Response(503), "LITERATURE_SOURCE_UNAVAILABLE"),
        (
            lambda request: httpx.Response(200, content=b"<html>oops</html>"),
            "LITERATURE_SOURCE_INVALID",
        ),
        (
            lambda request: httpx.Response(200, json={"message": {"items": "x"}}),
            "LITERATURE_SOURCE_INVALID",
        ),
    ],
)
def test_source_failures_are_explicit_and_store_nothing(
    client: TestClient,
    session_factory: sessionmaker[Session],
    fake: FakeSource,
    handler: Handler,
    code: str,
) -> None:
    fake.search = handler
    project_id = project(client)
    search = run(client, session_factory, project_id)
    assert search["status"] == "failed" and search["error_code"] == code
    assert search["snapshot"] is None
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(LiteratureSearchSnapshot)) == 0


def test_cancel_then_late_response_is_discarded(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeSource
) -> None:
    project_id = project(client)
    receipt = start(client, project_id)
    claim = claim_job(session_factory, UUID(receipt["job"]["id"]), 60)
    assert claim is not None
    cancelled = client.post(
        f"{API}/projects/{project_id}/literature/searches/{receipt['search']['id']}/cancel"
    )
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    late = sources.search("crossref", sources.SearchParams("q", 10, None, None))
    assert finish_literature_job(session_factory, claim, late) is False
    search = client.get(
        f"{API}/projects/{project_id}/literature/searches/{receipt['search']['id']}"
    ).json()
    assert search["status"] == "cancelled" and search["snapshot"] is None

    # A cancellation that lands while the source call is in flight is honoured too.
    second = start(client, project_id)

    def cancel_in_flight(request: httpx.Request) -> httpx.Response:
        client.post(
            f"{API}/projects/{project_id}/literature/searches/{second['search']['id']}/cancel"
        )
        return httpx.Response(200, content=crossref_body())

    fake.search = cancel_in_flight
    assert execute_job(session_factory, UUID(second["job"]["id"]), 60) is False
    after = client.get(
        f"{API}/projects/{project_id}/literature/searches/{second['search']['id']}"
    ).json()
    assert after["status"] == "cancelled" and after["snapshot"] is None


def test_commands_busy_retry_and_closed_generic_paths(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeSource
) -> None:
    project_id = project(client)
    command = str(uuid4())
    first = start(client, project_id, command_id=command)
    replay = start(client, project_id, command_id=command)
    assert replay["search"]["id"] == first["search"]["id"]
    conflict = client.post(
        f"{API}/projects/{project_id}/literature/searches",
        json={"command_id": command, "query": "另一个检索式"},
    )
    assert conflict.json()["error"]["code"] == "LITERATURE_COMMAND_CONFLICT"
    busy = client.post(
        f"{API}/projects/{project_id}/literature/searches",
        json={"command_id": str(uuid4()), "query": "推荐系统"},
    )
    assert busy.status_code == 409 and busy.json()["error"]["code"] == "LITERATURE_SEARCH_BUSY"
    assert client.post(
        f"{API}/jobs/{first['job']['id']}/retry", headers={"Idempotency-Key": "lit-bypass"}
    ).json()["error"]["code"] in {"LITERATURE_RETRY_REQUIRED", "JOB_STATE_CONFLICT"}
    generic = client.post(
        f"{API}/jobs",
        json={"project_id": project_id, "kind": "literature_search"},
        headers={"Idempotency-Key": "lit-generic"},
    )
    assert generic.status_code == 422

    fake.search = lambda request: httpx.Response(503)
    execute_job(session_factory, UUID(first["job"]["id"]), 60)
    assert (
        client.post(
            f"{API}/jobs/{first['job']['id']}/retry", headers={"Idempotency-Key": "lit-bypass-2"}
        ).json()["error"]["code"]
        == "LITERATURE_RETRY_REQUIRED"
    )
    fake.search = lambda request: httpx.Response(200, content=crossref_body())
    retry_command = str(uuid4())
    retried = client.post(
        f"{API}/projects/{project_id}/literature/searches/{first['search']['id']}/retry",
        json={"command_id": retry_command},
    )
    assert retried.status_code == 202, retried.text
    body = retried.json()
    assert body["search"]["source_search_id"] == first["search"]["id"]
    assert body["search"]["query"] == "协同过滤 推荐系统"
    assert body["job"]["source_job_id"] == first["job"]["id"]
    execute_job(session_factory, UUID(body["job"]["id"]), 60)
    again = client.post(
        f"{API}/projects/{project_id}/literature/searches/{body['search']['id']}/retry",
        json={"command_id": str(uuid4())},
    )
    assert again.json()["error"]["code"] == "LITERATURE_RETRY_INVALID"
    history = client.get(f"{API}/projects/{project_id}/literature/searches").json()
    assert history["total"] == 2 and history["items"][0]["status"] == "succeeded"


def test_save_dedupes_by_doi_and_verifies_against_registry(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeSource
) -> None:
    project_id = project(client)
    search = run(client, session_factory, project_id)
    not_ready = start(client, project(client, "另一个项目"))
    command = str(uuid4())
    saved = save(client, project_id, search["id"], 0, command)
    assert saved.status_code == 201, saved.text
    entry = saved.json()
    assert entry["verification"] == "verified" and entry["version"] == 1
    assert entry["verification_detail"]["reason"] == "match"
    assert entry["record"]["doi"] == "10.5555/cf.2020.001"
    assert entry["retrieved_at"] == search["snapshot"]["retrieved_at"]
    assert save(client, project_id, search["id"], 0, command).json()["id"] == entry["id"]
    duplicate = save(client, project_id, search["id"], 0)
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "LITERATURE_ENTRY_DUPLICATE"

    # A second search returning the same DOI with different casing is still a duplicate.
    fake.search = lambda request: httpx.Response(
        200, content=crossref_body([{**CF_ITEMS[0], "DOI": "10.5555/cf.2020.001"}])
    )
    other = run(client, session_factory, project_id)
    assert other["snapshot"]["items"][0]["saved_entry_id"] == entry["id"]
    assert (
        save(client, project_id, other["id"], 0).json()["error"]["code"]
        == "LITERATURE_ENTRY_DUPLICATE"
    )
    assert (
        save(client, project_id, other["id"], 5).json()["error"]["code"]
        == "LITERATURE_RESULT_NOT_FOUND"
    )

    # Title mismatch at the registry is a conflict; registry values are kept for comparison.
    fake.lookup = lambda request: registry("10.5555/cf.2021.002", "Different registered title")
    conflict = save(client, project_id, search["id"], 1).json()
    assert conflict["verification"] == "conflict"
    assert conflict["verification_detail"]["registry_title"] == "Different registered title"

    # Cross-project reads and saves are isolated.
    stranger = project(client, "隔离项目")
    assert (
        client.get(f"{API}/projects/{stranger}/literature/searches/{search['id']}").status_code
        == 404
    )
    assert save(client, stranger, search["id"], 0).status_code == 404
    assert (
        client.get(f"{API}/projects/{stranger}/literature/entries/{entry['id']}").status_code == 404
    )
    assert (
        save(client, not_ready["search"]["project_id"], not_ready["search"]["id"], 0).json()[
            "error"
        ]["code"]
        == "LITERATURE_SEARCH_NOT_READY"
    )


def test_lookup_outcomes_and_reverification_cas(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeSource
) -> None:
    project_id = project(client)
    search = run(client, session_factory, project_id)
    fake.lookup = lambda request: httpx.Response(404)
    missing = save(client, project_id, search["id"], 1).json()
    assert missing["verification"] == "not_found"

    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow", request=request)

    fake.lookup = slow
    pending = save(client, project_id, search["id"], 0).json()
    assert pending["verification"] == "unverified"
    assert pending["verification_detail"] == {
        "checked": False,
        "reason": "lookup_failed",
        "error_code": "LITERATURE_SOURCE_TIMEOUT",
        "registry_title": None,
        "registry_year": None,
    }
    assert pending["verified_at"] is None

    fake.lookup = lambda request: registry(
        "10.5555/cf.2020.001", "Collaborative Filtering for Sparse Campus Interactions!", 2020
    )
    url = f"{API}/projects/{project_id}/literature/entries/{pending['id']}"
    command = str(uuid4())
    verified = client.post(f"{url}/verify", json={"command_id": command, "expected_version": 1})
    assert verified.status_code == 200, verified.text
    assert verified.json()["verification"] == "verified" and verified.json()["version"] == 2
    replay = client.post(f"{url}/verify", json={"command_id": command, "expected_version": 1})
    assert replay.json()["version"] == 2
    stale = client.post(f"{url}/verify", json={"command_id": str(uuid4()), "expected_version": 1})
    assert stale.json()["error"]["code"] == "LITERATURE_ENTRY_VERSION_CONFLICT"


def test_remove_restore_keeps_history_and_blocks_resave(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeSource
) -> None:
    project_id = project(client)
    search = run(client, session_factory, project_id)
    entry = save(client, project_id, search["id"], 0).json()
    url = f"{API}/projects/{project_id}/literature/entries/{entry['id']}"
    removed = client.post(f"{url}/remove", json={"command_id": str(uuid4()), "expected_version": 1})
    assert removed.json()["removed"] is True and removed.json()["version"] == 2
    again = client.post(f"{url}/remove", json={"command_id": str(uuid4()), "expected_version": 2})
    assert again.json()["error"]["code"] == "LITERATURE_ENTRY_STATE_CONFLICT"
    listed = client.get(f"{API}/projects/{project_id}/literature/entries").json()
    assert listed["total"] == 0
    assert (
        client.get(f"{API}/projects/{project_id}/literature/entries?include_removed=true").json()[
            "total"
        ]
        == 1
    )
    refreshed = client.get(f"{API}/projects/{project_id}/literature/searches/{search['id']}").json()
    assert refreshed["snapshot"]["items"][0]["saved_entry_id"] is None
    resave = save(client, project_id, search["id"], 0).json()
    assert resave["error"]["code"] == "LITERATURE_ENTRY_REMOVED_DUPLICATE"
    restored = client.post(
        f"{url}/restore", json={"command_id": str(uuid4()), "expected_version": 2}
    ).json()
    assert restored["removed"] is False and restored["version"] == 3
    versions = client.get(f"{url}/versions").json()
    assert [item["action"] for item in versions["items"]] == ["restored", "removed", "saved"]


def test_openalex_normalization_and_title_dedupe(
    client: TestClient, session_factory: sessionmaker[Session], fake: FakeSource
) -> None:
    body = {
        "meta": {"count": 2},
        "results": [
            {
                "id": "https://openalex.org/W1",
                "display_name": "Graph based recommendation",
                "doi": None,
                "publication_year": 2022,
                "authorships": [{"author": {"display_name": "A. Author"}}],
                "primary_location": {"source": {"display_name": "Synthetic Venue"}},
                "abstract_inverted_index": {"graphs": [1], "Using": [0], "helps.": [2]},
                "type": "article",
            },
            {
                "id": "https://openalex.org/W2",
                "display_name": "Graph Based Recommendation",
                "publication_year": 2022,
            },
        ],
    }
    fake.search = lambda request: httpx.Response(200, json=body)
    project_id = project(client)
    search = run(client, session_factory, project_id, source="openalex", year_from=2020)
    assert fake.calls[0].url.host == "api.openalex.org"
    assert fake.calls[0].url.params["filter"] == "publication_year:>2019"
    first, second = search["snapshot"]["items"]
    assert first["abstract"] == "Using graphs helps." and first["coverage"] == "abstract"
    assert first["source_url"] == "https://openalex.org/W1" and first["venue"] == "Synthetic Venue"
    saved = save(client, project_id, search["id"], 0).json()
    assert saved["verification"] == "unverified"
    assert saved["verification_detail"]["reason"] == "no_doi"
    # Without a DOI the normalized title and year identify the same work.
    assert (
        save(client, project_id, search["id"], 1).json()["error"]["code"]
        == "LITERATURE_ENTRY_DUPLICATE"
    )


def test_search_input_validation(client: TestClient, fake: FakeSource) -> None:
    project_id = project(client)
    url = f"{API}/projects/{project_id}/literature/searches"
    for body in (
        {"query": "   "},
        {"query": "a\u0000b"},
        {"query": "x", "rows": 21},
        {"query": "x", "year_from": 2024, "year_to": 2020},
        {"query": "x", "source": "scholar"},
    ):
        response = client.post(url, json={"command_id": str(uuid4()), **body})
        assert response.status_code == 422, body
    assert (
        client.post(
            f"{API}/projects/{uuid4()}/literature/searches",
            json={"command_id": str(uuid4()), "query": "x"},
        ).status_code
        == 404
    )
