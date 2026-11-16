from hashlib import sha256
from urllib.parse import quote
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.modules.exports.contracts import ChangeRecordInput
from thesis_pilot.modules.exports.jobs import RenderedExport, finish_export_job
from thesis_pilot.modules.exports.models import ExportFile
from thesis_pilot.modules.exports.render import render_document
from thesis_pilot.modules.jobs.models import Job, JobArtifact
from thesis_pilot.modules.jobs.service import claim_job
from thesis_pilot.modules.revisions import service as revisions
from thesis_pilot.modules.revisions.schemas import (
    RevisionApply,
    RevisionCreate,
    RevisionDecide,
    RevisionProposal,
    RevisionRevert,
    RevisionUndo,
)
from thesis_pilot.workers.execution import execute_job

API = "/api/v1"


def text(value: str, *marks: str) -> dict:
    node: dict = {"type": "text", "text": value}
    if marks:
        node["marks"] = [{"type": mark} for mark in marks]
    return node


def para(*parts: dict) -> dict:
    return {"type": "paragraph", "content": list(parts)}


def manuscript(body: str = "采用方法甲。能够验证。") -> dict:
    return {
        "type": "doc",
        "content": [
            {
                "type": "heading",
                "attrs": {"level": 1, "chapterId": "c1"},
                "content": [text("自制论文 <标题>")],
            },
            para(text(body)),
            para(text("［锁定对象 1］图片", "aiLock"), text(" 普通"), text("粗体", "bold")),
            {
                "type": "orderedList",
                "attrs": {"start": 3},
                "content": [{"type": "listItem", "content": [para(text("第三项"))]}],
            },
            {
                "type": "table",
                "content": [
                    {
                        "type": "tableRow",
                        "content": [
                            {"type": "tableHeader", "content": [para(text("指标"))]},
                            {"type": "tableHeader", "content": [para(text("数值|1"))]},
                        ],
                    },
                    {
                        "type": "tableRow",
                        "content": [
                            {"type": "tableCell", "content": [para(text("准确率"))]},
                            {"type": "tableCell", "content": [para(text("0.91"))]},
                        ],
                    },
                ],
            },
        ],
    }


def seeded(client: TestClient, name: str = "导出自制项目") -> tuple[str, str]:
    project = client.post(f"{API}/projects", json={"name": name}).json()["id"]
    created = client.post(
        f"{API}/projects/{project}/documents",
        json={"content": {"schema_version": 1, "json": manuscript()}},
    )
    assert created.status_code == 201
    return project, created.json()["id"]


def save(client: TestClient, project: str, document: str, version: int, body: str) -> None:
    response = client.patch(
        f"{API}/projects/{project}/documents/{document}",
        json={
            "content": {"schema_version": 1, "json": manuscript(body)},
            "expected_version": version,
        },
    )
    assert response.status_code == 200, response.text


def export(client: TestClient, project: str, body: dict, key: str | None = None) -> dict:
    response = client.post(
        f"{API}/projects/{project}/exports/documents",
        json=body,
        headers={"Idempotency-Key": key or str(uuid4())},
    )
    assert response.status_code == 202, response.text
    return response.json()


def test_document_export_renders_fixed_version_and_downloads(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    project, document = seeded(client)
    queued = export(
        client, project, {"document_id": document, "document_version": 1, "format": "html"}
    )
    assert queued["status"] == "queued" and queued["file"] is None
    save(client, project, document, 1, "第二版正文。")
    assert execute_job(session_factory, UUID(queued["job_id"]), 60)
    done = client.get(f"{API}/projects/{project}/exports/{queued['job_id']}").json()
    assert done["status"] == "succeeded" and done["document_version"] == 1
    download = client.get(f"{API}/projects/{project}/exports/{queued['job_id']}/download")
    assert download.status_code == 200
    assert download.headers["content-type"] == "text/html; charset=utf-8"
    assert (
        f"filename*=UTF-8''{quote('论文正文-v1.html', safe='')}"
        in (download.headers["content-disposition"])
    )
    assert download.headers["cache-control"] == "no-store"
    page = download.text
    assert sha256(download.content).hexdigest() == done["file"]["sha256"]
    assert "采用方法甲" in page and "第二版正文" not in page
    assert '<h1 id="ch-c1">自制论文 &lt;标题&gt;</h1>' in page
    assert '<span class="tp-locked" data-locked="true"' in page and "［锁定对象 1］图片" in page
    assert '<ol start="3">' in page and "<th>指标</th>" in page
    assert "含 1 处锁定内容" in page

    detail = client.get(f"{API}/jobs/{queued['job_id']}").json()
    assert detail["kind"] == "document_export"
    assert detail["artifacts"][0]["result"]["sha256"] == done["file"]["sha256"]
    assert detail["result"]["writes_performed"] is False
    current = client.get(f"{API}/projects/{project}/documents/current").json()
    assert current["version"] == 2


def test_markdown_and_text_keep_structure_and_escape() -> None:
    content = manuscript("星号*与[括号]")
    markdown = render_document(content, 4, "markdown")
    assert markdown.startswith("<!-- ThesisPilot 正文 v4；含 1 处锁定内容")
    assert "# 自制论文 \\<标题\\>" in markdown
    assert "星号\\*与\\[括号\\]" in markdown
    assert "3. 第三项" in markdown and "| 指标 | 数值\\|1 |" in markdown
    assert "**粗体**" in markdown and "［锁定对象 1］图片" in markdown
    assert "| 准确率 | 0.91 |" in markdown
    assert render_document(manuscript("1. 不是列表"), 1, "markdown").count("1\\. 不是列表") == 1
    plain = render_document(content, 4, "txt")
    assert "指标\t数值|1" in plain and "3. 第三项" in plain
    merged = manuscript()
    merged["content"][4]["content"][0]["content"] = [
        {"type": "tableHeader", "attrs": {"colspan": 2}, "content": [para(text("合并"))]}
    ]
    assert '<th colspan="2">合并</th>' in render_document(merged, 1, "markdown")
    assert render_document(content, 4, "markdown") == markdown


def test_retry_reuses_fixed_input_and_identical_bytes(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    project, document = seeded(client)
    first = export(
        client, project, {"document_id": document, "document_version": 1, "format": "markdown"}
    )
    assert execute_job(session_factory, UUID(first["job_id"]), 60)
    save(client, project, document, 1, "之后的修改。")
    retry = client.post(
        f"{API}/projects/{project}/exports/{first['job_id']}/retry",
        headers={"Idempotency-Key": "retry-1"},
    )
    assert retry.status_code == 202
    again = retry.json()
    assert again["source_job_id"] == first["job_id"] and again["document_version"] == 1
    assert (
        client.post(
            f"{API}/projects/{project}/exports/{first['job_id']}/retry",
            headers={"Idempotency-Key": "retry-1"},
        ).json()["job_id"]
        == again["job_id"]
    )
    assert execute_job(session_factory, UUID(again["job_id"]), 60)
    items = client.get(f"{API}/projects/{project}/exports").json()["items"]
    assert [item["job_id"] for item in items] == [again["job_id"], first["job_id"]]
    assert items[0]["file"]["sha256"] == items[1]["file"]["sha256"]


def test_idempotency_scope_and_generic_entry_rejected(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    project, document = seeded(client)
    other, _ = seeded(client, "另一自制项目")
    body = {"document_id": document, "document_version": 1, "format": "txt"}
    first = export(client, project, body, "same-key")
    assert export(client, project, body, "same-key")["job_id"] == first["job_id"]
    conflict = client.post(
        f"{API}/projects/{project}/exports/documents",
        json={**body, "format": "html"},
        headers={"Idempotency-Key": "same-key"},
    )
    assert conflict.json()["error"]["code"] == "JOB_IDEMPOTENCY_CONFLICT"
    foreign = client.post(
        f"{API}/projects/{other}/exports/documents",
        json=body,
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert foreign.json()["error"]["code"] == "DOCUMENT_NOT_FOUND"
    missing = client.post(
        f"{API}/projects/{project}/exports/documents",
        json={**body, "document_version": 9},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert missing.json()["error"]["code"] == "DOCUMENT_VERSION_NOT_FOUND"
    hidden = client.get(f"{API}/projects/{other}/exports/{first['job_id']}")
    assert hidden.status_code == 404 and hidden.json()["error"]["code"] == "EXPORT_NOT_FOUND"
    assert client.get(f"{API}/projects/{other}/exports").json()["total"] == 0
    not_ready = client.get(f"{API}/projects/{project}/exports/{first['job_id']}/download")
    assert not_ready.json()["error"]["code"] == "EXPORT_FILE_NOT_READY"
    generic = client.post(
        f"{API}/jobs",
        json={"project_id": project, "kind": "document_export"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert generic.status_code == 422
    listed = client.get(f"{API}/jobs?project_id={project}").json()
    assert listed["items"][0]["kind"] == "document_export"
    assert listed["items"][0]["configuration"]["renderer_version"] == "thesispilot-export-1"


def test_cancel_and_late_completion_store_nothing(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    project, document = seeded(client)
    queued = export(
        client, project, {"document_id": document, "document_version": 1, "format": "txt"}
    )
    job_id = UUID(queued["job_id"])
    claim = claim_job(session_factory, job_id, 60)
    assert claim is not None
    cancelled = client.post(f"{API}/projects/{project}/exports/{job_id}/cancel").json()
    assert cancelled["status"] == "cancelled"
    late = RenderedExport("迟到结果", "论文正文-v1.txt", "text/plain; charset=utf-8", 1)
    assert not finish_export_job(session_factory, claim, late)
    assert not execute_job(session_factory, job_id, 60)
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(ExportFile)) == 0
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 0
    assert client.get(f"{API}/projects/{project}/exports/{job_id}").json()["status"] == "cancelled"


def test_changed_source_fails_without_writing(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    project, document = seeded(client)
    queued = export(
        client, project, {"document_id": document, "document_version": 1, "format": "html"}
    )
    with session_factory() as session, session.begin():
        job = session.get(Job, UUID(queued["job_id"]))
        assert job is not None and job.configuration is not None
        job.configuration = {**job.configuration, "source_sha256": "0" * 64}
    assert execute_job(session_factory, UUID(queued["job_id"]), 60)
    failed = client.get(f"{API}/projects/{project}/exports/{queued['job_id']}").json()
    assert failed["status"] == "failed" and failed["error_code"] == "EXPORT_SOURCE_CHANGED"
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(ExportFile)) == 0


def _adopt(
    session_factory: sessionmaker[Session], project: UUID, document: UUID, base: int
) -> UUID:
    original = "采用方法甲。能够验证。"
    length = len(original.encode("utf-16-le")) // 2
    # Absolute ProseMirror positions: heading node size, then the paragraph's opening token.
    start = len("自制论文 <标题>") + 2 + 1
    with session_factory() as session:
        created = revisions.create_revision(
            session,
            project,
            document,
            RevisionCreate.model_validate(
                {
                    "command_id": str(uuid4()),
                    "base_version": base,
                    # Path [1] is the body paragraph; positions are inside that textblock.
                    "selection": {
                        "textblock_path": [1],
                        "from": start,
                        "to": start + length,
                        "text": original,
                    },
                    "goal": "精简表述",
                }
            ),
        )
        assert created.candidate_id is not None
        item = revisions.get_revision(session, project, document, created.candidate_id)
        revisions.submit_proposal(
            session,
            project,
            document,
            item.id,
            RevisionProposal.model_validate(
                {
                    "command_id": str(uuid4()),
                    "generation_token": str(item.generation_token),
                    "patches": [
                        {
                            "id": "p1",
                            "from": start,
                            "to": start + 3,
                            "before": "采用方",
                            "after": "使用方",
                        },
                        {
                            "id": "p2",
                            "from": start + 6,
                            "to": start + 8,
                            "before": "能够",
                            "after": "可以",
                        },
                    ],
                }
            ),
        )
        revisions.decide_revision(
            session,
            project,
            document,
            item.id,
            RevisionDecide.model_validate(
                {
                    "command_id": str(uuid4()),
                    "expected_revision": 2,
                    "decisions": [
                        {"patch_id": "p1", "decision": "accepted"},
                        {"patch_id": "p2", "decision": "rejected"},
                    ],
                }
            ),
        )
        applied = revisions.apply_revision(
            session,
            project,
            document,
            item.id,
            RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=base),
        )
        return applied.command_id


def test_change_record_uses_real_history_and_decisions(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    project, document = seeded(client)
    pid, did = UUID(project), UUID(document)
    save(client, project, document, 1, "采用方法甲。能够验证。补充一句。")  # v2 manual
    # v2 body differs; adopt on a fresh manual v3 identical to v1 body.
    save(client, project, document, 2, "采用方法甲。能够验证。")  # v3 manual
    command = _adopt(session_factory, pid, did, 3)  # v4 adoption
    with session_factory() as session:
        revisions.undo_revision(
            session,
            pid,
            did,
            command,
            RevisionUndo(command_id=uuid4(), expected_document_version=4),
        )  # v5 undo
        revisions.revert_document(
            session,
            pid,
            did,
            RevisionRevert(command_id=uuid4(), expected_document_version=5, target_version=2),
        )  # v6 restore
    response = client.post(
        f"{API}/projects/{project}/exports/change-records",
        json={"document_id": document, "from_version": 1, "format": "markdown"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 202, response.text
    queued = response.json()
    assert (queued["from_version"], queued["document_version"]) == (1, 6)
    save(client, project, document, 6, "之后又改。")  # v7 must not enter the fixed range
    assert execute_job(session_factory, UUID(queued["job_id"]), 60)
    download = client.get(f"{API}/projects/{project}/exports/{queued['job_id']}/download")
    record = download.text
    assert download.headers["content-type"] == "text/markdown; charset=utf-8"
    assert "# 修改说明 · 正文 v1–v6" in record
    assert "不代表导师已审阅或认可" in record and "导师已认可" not in record
    assert "## v1 · 导入正文" in record and "## v2 · 手动保存" in record
    assert "## v4 · 采纳修订候选" in record and "修订目标：精简表述" in record
    assert "| 采纳 | 采用方 | 使用方 |" in record and "| 拒绝 | 能够 | 可以 |" in record
    assert "## v5 · 撤销采纳" in record and "v4 的修订候选采纳，内容回到 v3" in record
    assert "## v6 · 恢复历史版本" in record and "恢复到：v2" in record
    assert "v7" not in record
    retried = client.post(
        f"{API}/projects/{project}/exports/{queued['job_id']}/retry",
        headers={"Idempotency-Key": str(uuid4())},
    ).json()
    assert (retried["from_version"], retried["document_version"]) == (1, 6)
    assert execute_job(session_factory, UUID(retried["job_id"]), 60)
    files = client.get(f"{API}/projects/{project}/exports").json()["items"]
    assert files[0]["file"]["sha256"] == files[1]["file"]["sha256"]

    html = client.post(
        f"{API}/projects/{project}/exports/change-records",
        json={"document_id": document, "from_version": 4, "to_version": 4, "format": "html"},
        headers={"Idempotency-Key": str(uuid4())},
    ).json()
    assert execute_job(session_factory, UUID(html["job_id"]), 60)
    page = client.get(f"{API}/projects/{project}/exports/{html['job_id']}/download").text
    assert "<td>采纳</td><td>采用方</td><td>使用方</td>" in page


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"from_version": 3, "to_version": 2}, "EXPORT_RANGE_INVALID"),
        ({"from_version": 5}, "EXPORT_RANGE_INVALID"),
        ({"from_version": 1, "to_version": 9}, "DOCUMENT_VERSION_NOT_FOUND"),
    ],
)
def test_change_record_range_errors(client: TestClient, body: dict, code: str) -> None:
    project, document = seeded(client)
    save(client, project, document, 1, "第二版。")
    response = client.post(
        f"{API}/projects/{project}/exports/change-records",
        json={"document_id": document, "format": "html", **body},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.json()["error"]["code"] == code


def test_change_record_input_contract_bounds() -> None:
    with pytest.raises(ValueError):
        ChangeRecordInput(document_id=uuid4(), from_version=1, to_version=201, format="html")
