"""SG-22 E: GB/T 7714 citation candidates on v2 manuscripts (AC-019)."""

from collections.abc import Iterator
from copy import deepcopy
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.modules.citations import gbt7714
from thesis_pilot.modules.citations.engine import MARKER_PREFIX, REFERENCE_PREFIX
from thesis_pilot.modules.literature import sources
from thesis_pilot.modules.literature.models import LiteratureEntry
from thesis_pilot.modules.literature.sources import LiteratureRecord
from thesis_pilot.workers.execution import execute_job

API = "/api/v1"
LOCK = {"type": "aiLock"}
V1: dict[str, Any] = {
    "type": "doc",
    "content": [
        {
            "type": "heading",
            "attrs": {"chapterId": "chapter-a", "level": 1},
            "content": [{"type": "text", "text": "第一章 绪论"}],
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "协同过滤"},
                {"type": "text", "text": "128", "marks": [LOCK]},
                {"type": "text", "text": "已有研究。"},
            ],
        },
        {"type": "paragraph", "content": [{"type": "text", "text": "第二段讨论评价方法。"}]},
    ],
}
WORKS = [
    {
        "DOI": "10.5555/cite.a",
        "title": ["Collaborative filtering for sparse campus interactions"],
        "author": [{"given": "Ming", "family": "Li"}, {"given": "Hua", "family": "Wang"}],
        "issued": {"date-parts": [[2020]]},
        "container-title": ["Journal of Synthetic Recommenders"],
        "type": "journal-article",
        "volume": "12",
        "issue": "3",
        "page": "45-67",
    },
    {
        "DOI": "10.5555/cite.b",
        "title": ["A survey of recommender evaluation"],
        "issued": {"date-parts": [[2021]]},
        "container-title": ["Proceedings of the Synthetic Conference"],
        "publisher": "Synthetic Press",
        "type": "proceedings-article",
    },
]


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[httpx.Request]]:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if "/works/" in request.url.path:
            doi = request.url.path.split("/works/", 1)[1]
            work = next(item for item in WORKS if item["DOI"] == doi)
            return httpx.Response(200, json={"status": "ok", "message": work})
        return httpx.Response(200, json={"message": {"total-results": 2, "items": WORKS}})

    monkeypatch.setattr(sources, "TRANSPORT", httpx.MockTransport(handler))
    monkeypatch.setattr(sources, "MIN_INTERVAL_SECONDS", 0.0)
    yield calls


def setup(
    client: TestClient, factory: sessionmaker[Session], name: str = "引用自制项目"
) -> tuple[str, str, dict[str, Any], list[str]]:
    project_id = client.post(f"{API}/projects", json={"name": name}).json()["id"]
    docs = f"{API}/projects/{project_id}/documents"
    created = client.post(docs, json={"content": {"schema_version": 1, "json": V1}}).json()
    upgraded = client.post(
        f"{docs}/{created['id']}/schema-upgrade",
        json={"command_id": str(uuid4()), "expected_version": 1},
    ).json()["document"]
    receipt = client.post(
        f"{API}/projects/{project_id}/literature/searches",
        json={"command_id": str(uuid4()), "query": "推荐系统"},
    ).json()
    execute_job(factory, UUID(receipt["job"]["id"]), 60)
    entries = [
        client.post(
            f"{API}/projects/{project_id}/literature/entries",
            json={
                "command_id": str(uuid4()),
                "search_id": receipt["search"]["id"],
                "result_index": index,
            },
        ).json()["id"]
        for index in range(2)
    ]
    return project_id, f"{docs}/{upgraded['id']}", upgraded, entries


def blocks(document: dict[str, Any]) -> list[dict[str, Any]]:
    return document["content"]["json"]["model"]["sections"][0]["blocks"]


def text(block: dict[str, Any]) -> str:
    return "".join(item.get("text", "￼") for item in block["inlines"])


def current(client: TestClient, path: str) -> dict[str, Any]:
    project_path = path.rsplit("/documents/", 1)[0]
    return client.get(f"{project_path}/documents/current").json()


def propose(
    client: TestClient, path: str, version: int, entry: str, node: str, offset: int, **extra: Any
) -> Any:
    return client.post(
        f"{path}/citations/candidates",
        json={
            "command_id": extra.pop("command_id", str(uuid4())),
            "base_version": version,
            "entry_id": entry,
            "placement": {"node_id": node, "offset": offset},
            **extra,
        },
    )


def apply(client: TestClient, path: str, candidate: dict[str, Any], **extra: Any) -> Any:
    return client.post(
        f"{path}/citations/candidates/{candidate['id']}/apply",
        json={
            "command_id": extra.pop("command_id", str(uuid4())),
            "expected_revision": candidate["revision"],
            "expected_document_version": candidate["document_version"],
            **extra,
        },
    )


# ---------- GB/T 7714 rendering ----------


def record(**fields: Any) -> LiteratureRecord:
    base: dict[str, Any] = {
        "source": "crossref",
        "source_id": "x",
        "doi": None,
        "title": "Title",
        "authors": [],
        "year": None,
        "venue": None,
        "publisher": None,
        "work_type": None,
        "abstract": None,
        "source_url": None,
        "coverage": "biblio",
    }
    return LiteratureRecord.model_validate({**base, **fields})


def test_gbt7714_rendering_omits_missing_fields() -> None:
    journal = record(
        title="Collaborative filtering.",
        authors=["Ming Li", "Hua Wang", "Lei Zhao", "Jun Chen"],
        year=2020,
        venue="Journal of Synthetic Recommenders",
        work_type="journal-article",
        volume="12",
        issue="3",
        pages="45-67",
        doi="10.5555/cite.a",
    )
    assert gbt7714.render(journal) == (
        "Ming Li, Hua Wang, Lei Zhao, et al. Collaborative filtering[J]. "
        "Journal of Synthetic Recommenders, 2020, 12(3): 45-67. DOI:10.5555/cite.a."
    )
    chinese = record(
        title="校园推荐系统研究",
        authors=["张三", "李四", "王五", "赵六"],
        year=2019,
        venue="合成学报",
        work_type="journal-article",
        issue="2",
    )
    assert (
        gbt7714.render(chinese) == "张三, 李四, 王五, 等. 校园推荐系统研究[J]. 合成学报, 2019(2)."
    )
    conference = record(
        title="A survey",
        year=2021,
        venue="Proceedings of X",
        publisher="Synthetic Press",
        work_type="proceedings-article",
    )
    assert gbt7714.render(conference) == "A survey[C]//Proceedings of X. Synthetic Press, 2021."
    # An OpenAlex "article" without a venue is not presented as a journal paper.
    bare = record(title="Untitled preprint", work_type="article")
    assert gbt7714.render(bare) == "Untitled preprint[Z]."
    assert gbt7714.numbered(3, bare) == "[3] Untitled preprint[Z]."
    book = record(title="Recommender Systems", publisher="Synthetic Press", work_type="book")
    assert gbt7714.render(book) == "Recommender Systems[M]. Synthetic Press."


# ---------- candidates ----------


def test_candidate_adopt_list_and_undo(
    client: TestClient, session_factory: sessionmaker[Session], fake: list[httpx.Request]
) -> None:
    _, path, document, (entry_a, _) = setup(client, session_factory)
    paragraph = blocks(document)[1]
    base_text = text(paragraph)
    offset = len(base_text)
    created = propose(client, path, document["version"], entry_a, paragraph["id"], offset)
    assert created.status_code == 201, created.text
    candidate = created.json()
    preview = candidate["preview"]
    assert candidate["status"] == "ready" and candidate["applicable"] is True
    assert preview["number"] == 1 and preview["heading"]["new"] is True
    assert preview["marker"] == {"node": paragraph["id"], "offset": offset, "text": "[1]"}
    assert preview["reference"]["text"] == (
        "[1] Ming Li, Hua Wang. Collaborative filtering for sparse campus interactions[J]. "
        "Journal of Synthetic Recommenders, 2020, 12(3): 45-67. DOI:10.5555/cite.a."
    )
    # A candidate never writes the manuscript.
    assert current(client, path)["version"] == document["version"]

    applied = apply(client, path, candidate)
    assert applied.status_code == 200, applied.text
    adopted = applied.json()
    assert adopted["status"] == "applied" and adopted["result_version"] == document["version"] + 1
    assert adopted["undoable"] is True
    after = current(client, path)
    new_blocks = blocks(after)
    assert text(new_blocks[1]) == base_text + "[1]"
    marker_run = new_blocks[1]["inlines"][-1]
    assert marker_run == {
        "type": "run",
        "text": "[1]",
        "props": {"verticalAlign": "superscript"},
    }
    assert text(new_blocks[-2]) == "参考文献" and new_blocks[-2]["type"] == "heading"
    assert text(new_blocks[-1]) == preview["reference"]["text"]
    protections = after["content"]["json"]["protections"]
    managed = [item for item in protections if item["kind"] == "citation"]
    assert managed == [
        {
            "id": MARKER_PREFIX + candidate["id"],
            "kind": "citation",
            "anchor": {"node": paragraph["id"], "start": offset, "end": offset + 3},
            "binding": entry_a,
        },
        {
            "id": REFERENCE_PREFIX + new_blocks[-1]["id"],
            "kind": "citation",
            "anchor": {"node": new_blocks[-1]["id"]},
            "binding": entry_a,
        },
    ]
    listed = client.get(f"{path}/citations").json()
    assert listed["consistent"] is True and listed["references_heading"] == new_blocks[-2]["id"]
    assert [(item["entry_id"], item["number"]) for item in listed["items"]] == [(entry_a, 1)]
    assert listed["items"][0]["markers"][0]["start"] == offset

    # The marker is protected against ordinary saves.
    tampered = deepcopy(after["content"]["json"])
    tampered.pop("chapters")
    tampered["model"]["sections"][0]["blocks"][1]["inlines"][-1]["text"] = "[9]"
    saved = client.patch(
        path,
        json={
            "expected_version": after["version"],
            "content": {"schema_version": 2, "json": tampered},
        },
    )
    assert saved.json()["error"]["code"] == "DOCMODEL_PROTECTION_VIOLATED"

    undo = client.post(
        f"{path}/citations/candidates/{candidate['id']}/undo",
        json={"command_id": str(uuid4()), "expected_document_version": after["version"]},
    )
    assert undo.status_code == 200 and undo.json()["status"] == "undone"
    restored = current(client, path)
    assert restored["version"] == after["version"] + 1
    assert restored["content"]["json"]["model"] == document["content"]["json"]["model"]
    history = client.get(f"{path}/versions").json()["items"]
    assert [item["source"] for item in history[:2]] == ["adoption_undo", "ai_adoption"]


def test_earlier_citation_renumbers_and_reuse_keeps_number(
    client: TestClient, session_factory: sessionmaker[Session], fake: list[httpx.Request]
) -> None:
    _, path, document, (entry_a, entry_b) = setup(client, session_factory)
    first, second = blocks(document)[1], blocks(document)[2]
    cand_a = propose(client, path, 2, entry_a, second["id"], len(text(second))).json()
    assert apply(client, path, cand_a).status_code == 200
    # B cited earlier in the body takes [1]; A is renumbered to [2] in the same candidate.
    cand_b = propose(client, path, 3, entry_b, first["id"], 0).json()
    assert cand_b["number"] == 1
    assert cand_b["preview"]["renumbered"] == [{"entry_id": entry_a, "before": 1, "after": 2}]
    kinds = [change["kind"] for change in cand_b["preview"]["changes"]]
    assert kinds == ["marker", "marker_renumber", "reference", "reference_new"]
    assert apply(client, path, cand_b).status_code == 200
    after = current(client, path)
    body = blocks(after)
    assert text(body[1]).startswith("[1]协同过滤128")
    assert text(body[2]).endswith("[2]")
    references = [text(block) for block in body[-2:]]
    assert references[0].startswith("[1] A survey of recommender evaluation[C]//")
    assert references[1].startswith("[2] Ming Li, Hua Wang.")
    # The lock after the inserted marker moved with its text.
    lock = next(item for item in after["content"]["json"]["protections"] if item["kind"] == "lock")
    assert text(body[1])[lock["anchor"]["start"] : lock["anchor"]["end"]] == "128"
    # Citing A again reuses [2]; no new reference block.
    again = propose(client, path, 4, entry_a, first["id"], len(text(body[1]))).json()
    assert again["preview"]["reused"] is True and again["number"] == 2
    assert [change["kind"] for change in again["preview"]["changes"]] == ["marker"]
    assert apply(client, path, again).status_code == 200
    listed = client.get(f"{path}/citations").json()
    assert [(item["number"], len(item["markers"])) for item in listed["items"]] == [(1, 1), (2, 2)]
    assert listed["consistent"] is True


def test_stale_conflict_idempotency_and_rejection(
    client: TestClient, session_factory: sessionmaker[Session], fake: list[httpx.Request]
) -> None:
    _, path, document, (entry_a, entry_b) = setup(client, session_factory)
    paragraph = blocks(document)[2]
    command = str(uuid4())
    one = propose(client, path, 2, entry_a, paragraph["id"], 0, command_id=command)
    replay = propose(client, path, 2, entry_a, paragraph["id"], 0, command_id=command)
    assert replay.status_code == 201 and replay.json()["id"] == one.json()["id"]
    reused = propose(client, path, 2, entry_b, paragraph["id"], 0, command_id=command)
    assert reused.json()["error"]["code"] == "CITATION_COMMAND_CONFLICT"
    two = propose(client, path, 2, entry_b, paragraph["id"], 1).json()
    apply_command = str(uuid4())
    assert apply(client, path, one.json(), command_id=apply_command).status_code == 200
    again = apply(client, path, one.json(), command_id=apply_command)
    assert again.status_code == 200 and again.json()["result_version"] == 3
    assert current(client, path)["version"] == 3
    # The other candidate was built on version 2: stale, and nothing is written.
    stale_read = client.get(f"{path}/citations/candidates/{two['id']}").json()
    assert stale_read["stale"] is True and stale_read["applicable"] is False
    stale = apply(client, path, two, expected_document_version=3)
    assert stale.json()["error"]["code"] == "CITATION_STALE"
    assert current(client, path)["version"] == 3
    rejected = client.post(
        f"{path}/citations/candidates/{two['id']}/reject",
        json={"command_id": str(uuid4()), "expected_revision": two["revision"]},
    )
    assert rejected.json()["status"] == "rejected"
    after_reject = apply(client, path, rejected.json(), expected_document_version=3)
    assert after_reject.json()["error"]["code"] == "CITATION_STATE_CONFLICT"
    page = client.get(f"{path}/citations/candidates", params={"status": "applied"}).json()
    assert page["total"] == 1 and page["items"][0]["id"] == one.json()["id"]


def test_invalid_placements_and_entries(
    client: TestClient, session_factory: sessionmaker[Session], fake: list[httpx.Request]
) -> None:
    project_id, path, document, (entry_a, _) = setup(client, session_factory)
    heading, paragraph = blocks(document)[0], blocks(document)[1]
    lock = next(
        item for item in document["content"]["json"]["protections"] if item["kind"] == "lock"
    )
    inside = propose(client, path, 2, entry_a, paragraph["id"], lock["anchor"]["start"] + 1)
    assert inside.json()["error"]["code"] == "CITATION_ANCHOR_PROTECTED"
    on_heading = propose(client, path, 2, entry_a, heading["id"], 0)
    assert on_heading.json()["error"]["code"] == "CITATION_ANCHOR_INVALID"
    beyond = propose(client, path, 2, entry_a, paragraph["id"], 999)
    assert beyond.json()["error"]["code"] == "CITATION_ANCHOR_INVALID"
    assert propose(client, path, 1, entry_a, paragraph["id"], 0).json()["error"]["code"] == (
        "CITATION_STALE"
    )
    missing = propose(client, path, 2, str(uuid4()), paragraph["id"], 0)
    assert missing.json()["error"]["code"] == "CITATION_ENTRY_NOT_FOUND"
    # Entries are project scoped.
    _, other_path, other_document, (other_entry, _) = setup(client, session_factory, "另一项目")
    foreign = propose(client, path, 2, other_entry, paragraph["id"], 0)
    assert foreign.json()["error"]["code"] == "CITATION_ENTRY_NOT_FOUND"
    removed = client.post(
        f"{API}/projects/{project_id}/literature/entries/{entry_a}/remove",
        json={"command_id": str(uuid4()), "expected_version": 1},
    )
    assert removed.status_code == 200, removed.text
    gone = propose(client, path, 2, entry_a, paragraph["id"], 0)
    assert gone.json()["error"]["code"] == "CITATION_ENTRY_REMOVED"
    # A v1 manuscript is not edited by citation candidates.
    legacy_project = client.post(f"{API}/projects", json={"name": "旧版正文"}).json()["id"]
    legacy = client.post(
        f"{API}/projects/{legacy_project}/documents",
        json={"content": {"schema_version": 1, "json": V1}},
    ).json()
    legacy_path = f"{API}/projects/{legacy_project}/documents/{legacy['id']}"
    assert propose(client, legacy_path, 1, entry_a, "chapter-a", 0).json()["error"]["code"] in {
        "CITATION_ENTRY_NOT_FOUND",
        "CITATION_SCHEMA_UNSUPPORTED",
    }
    assert client.get(f"{legacy_path}/citations").json()["items"] == []
    assert other_path != path and other_document["id"] != document["id"]


def test_unverifiable_entries_cannot_become_citations(
    client: TestClient, session_factory: sessionmaker[Session], fake: list[httpx.Request]
) -> None:
    """设计 L-08：DOI 回查冲突或未找到的条目不得生成引用候选。"""
    _, path, document, (entry_a, _) = setup(client, session_factory)
    paragraph = blocks(document)[1]
    for verdict in ("conflict", "not_found"):
        with session_factory() as session, session.begin():
            row = session.get(LiteratureEntry, UUID(entry_a))
            assert row is not None
            row.verification = verdict
        refused = propose(client, path, 2, entry_a, paragraph["id"], 0)
        assert refused.json()["error"]["code"] == "CITATION_ENTRY_UNVERIFIABLE"
