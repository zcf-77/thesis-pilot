"""Real PostgreSQL review boundaries; model replies are explicit TEST STUBS.

No test here calls a provider or proves a real model invocation. Stubs exercise
fixed inputs, atomic report persistence, immutability and late-reply handling.
"""

import json
import socket
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace
from uuid import UUID, uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs.schemas import (
    AgentConfigContent,
    APIConfigContent,
    ModelConfigContent,
    PromptConfigContent,
)
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import Document
from thesis_pilot.modules.documents.schemas import DocumentImport
from thesis_pilot.modules.jobs.models import Job, JobArtifact
from thesis_pilot.modules.jobs.service import claim_job, finish_review_job, load_review_snapshot
from thesis_pilot.modules.reviews import service as reviews
from thesis_pilot.modules.reviews.models import ReviewReport, ReviewRun
from thesis_pilot.modules.reviews.schemas import (
    ReviewCompletion,
    ReviewCreate,
    ReviewModelReply,
)
from thesis_pilot.modules.revisions.models import RevisionCandidate
from thesis_pilot.modules.tasks.models import TaskBoard
from thesis_pilot.workers.execution import execute_job
from thesis_pilot.workflows import review as review_workflow

from .conftest import PostgreSQLSandbox
from .test_ai_configs import config
from .test_services import make_project
from .test_workspace import KEY, real_workspace_http

pytestmark = pytest.mark.integration
STUB_MODEL = "teststub-no-provider-call"
DOC = {
    "type": "doc",
    "content": [
        {
            "type": "heading",
            "attrs": {"chapterId": "c1", "level": 1},
            "content": [{"type": "text", "text": "第一章 引言"}],
        },
        {"type": "paragraph", "content": [{"type": "text", "text": "合成背景，样本量 42。"}]},
    ],
}


def prepare(postgres: PostgreSQLSandbox) -> tuple[UUID, UUID, UUID]:
    project_id = make_project(postgres)
    with postgres.sessions() as session:
        document = documents.import_document(
            session,
            project_id,
            DocumentImport.model_validate({"content": {"schema_version": 1, "json": DOC}}),
        )
    api = config(postgres, APIConfigContent(kind="api", max_retries=1))
    model = config(
        postgres,
        ModelConfigContent(
            kind="model",
            api_version_id=api.current_version_id,
            model_code="deepseek-flash",
            capabilities=["review"],
        ),
    )
    prompt = config(
        postgres,
        PromptConfigContent(kind="prompt", template="评审：{{context}}", variables=["context"]),
    )
    agent = config(
        postgres,
        AgentConfigContent(
            kind="agent",
            role="review",
            instructions="只评审。",
            model_version_id=model.current_version_id,
            prompt_version_id=prompt.current_version_id,
        ),
    )
    return project_id, document.id, agent.current_version_id


def request(document_id: UUID, agent_id: UUID) -> ReviewCreate:
    return ReviewCreate(
        command_id=uuid4(),
        document_id=document_id,
        document_version=1,
        rubric_version="thesispilot-review-1",
        agent_config_version_id=agent_id,
    )


def completion() -> ReviewCompletion:
    return ReviewCompletion(
        reply=ReviewModelReply.model_validate(
            {
                "summary": "TEST STUB 摘要",
                "issues": [
                    {
                        "severity": "major",
                        "title": "样本量缺依据",
                        "location": {"chapter_id": "c1", "block": 1, "quote": "样本量 42"},
                        "basis": ["D-evidence"],
                        "explanation": "未说明来源。",
                        "direction": "补充来源。",
                    }
                ],
                "scores": [{"dimension": "structure", "score": 18, "reason": "清楚。"}],
                "unchecked": [],
            }
        ),
        requested_model="deepseek-flash",
        response_model=STUB_MODEL,
    )


def test_report_is_atomic_immutable_and_survives_restart(postgres: PostgreSQLSandbox) -> None:
    project_id, document_id, agent_id = prepare(postgres)
    with postgres.sessions() as session:
        board_before = session.scalar(select(func.count()).select_from(TaskBoard))
    with postgres.sessions() as session:
        receipt = reviews.create_review(session, project_id, request(document_id, agent_id))
    claim = claim_job(postgres.sessions, receipt.job.id, 60)
    assert claim is not None and load_review_snapshot(postgres.sessions, claim) is not None
    assert finish_review_job(postgres.sessions, claim, completion())

    # A fresh engine stands in for an API restart: the report is read from PostgreSQL.
    engine = create_engine(postgres.url, hide_parameters=True)
    try:
        restarted = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
        with restarted() as session:
            report = reviews.get_report(session, project_id, receipt.review.id)
        assert report.content.issues[0].location.status == "range"
        assert report.response_model == STUB_MODEL
        with restarted() as session:
            assert reviews.get_review(session, project_id, receipt.review.id).status == "succeeded"
            document = session.scalar(select(Document).where(Document.id == document_id))
            assert document is not None and document.current_version == 1
            assert session.scalar(select(func.count()).select_from(RevisionCandidate)) == 0
            assert session.scalar(select(func.count()).select_from(TaskBoard)) == board_before
    finally:
        engine.dispose()

    for statement in (
        "UPDATE review_reports SET content = '{}'",
        "DELETE FROM review_reports",
        "UPDATE review_runs SET context_snapshot = '{}'",
        "UPDATE review_runs SET document_version = 2",
    ):
        with postgres.sessions() as session, pytest.raises(DBAPIError):
            session.execute(text(statement))
            session.flush()


def test_late_reply_after_cancel_and_timeout_leaves_no_report(postgres: PostgreSQLSandbox) -> None:
    project_id, document_id, agent_id = prepare(postgres)
    with postgres.sessions() as session:
        receipt = reviews.create_review(session, project_id, request(document_id, agent_id))
    claim = claim_job(postgres.sessions, receipt.job.id, 60)
    assert claim is not None
    with postgres.sessions() as session:
        assert reviews.cancel_review(session, project_id, receipt.review.id).status == "cancelled"
    assert finish_review_job(postgres.sessions, claim, completion()) is False
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ReviewReport)) == 0
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 0


def test_concurrent_creates_allow_one_active_review(postgres: PostgreSQLSandbox) -> None:
    project_id, document_id, agent_id = prepare(postgres)
    barrier = Barrier(2)

    def submit(_: int) -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                reviews.create_review(session, project_id, request(document_id, agent_id))
                return "created"
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(2) as pool:
        results = sorted(pool.map(submit, range(2)))
    assert results == ["REVIEW_BUSY", "created"]
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ReviewRun)) == 1


def test_missing_credentials_fail_in_worker_boundary(
    postgres: PostgreSQLSandbox, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Guarantee the boundary has no credential, so no provider request can be sent.
    monkeypatch.setattr(
        review_workflow, "get_settings", lambda: SimpleNamespace(deepseek_api_key=SecretStr(""))
    )
    project_id, document_id, agent_id = prepare(postgres)
    with postgres.sessions() as session:
        receipt = reviews.create_review(session, project_id, request(document_id, agent_id))
    assert execute_job(postgres.sessions, receipt.job.id, 60)
    with postgres.sessions() as session:
        job = session.get(Job, receipt.job.id)
        assert job is not None and job.status == "failed"
        assert job.error_code == "MODEL_NOT_CONFIGURED"
        assert session.scalar(select(func.count()).select_from(ReviewReport)) == 0


@pytest.fixture
def workspace_http(postgres: PostgreSQLSandbox, tmp_path: Path) -> Iterator[httpx.Client]:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    with real_workspace_http(postgres, tmp_path / "workspace-http.log", port) as client:
        assert client.post("/api/v1/workspace/session", json={"access_key": KEY}).status_code == 200
        yield client


def test_formal_http_create_report_download_and_isolation(
    postgres: PostgreSQLSandbox, workspace_http: httpx.Client
) -> None:
    project_id, document_id, agent_id = prepare(postgres)
    other = make_project(postgres)
    base = f"/api/v1/projects/{project_id}/reviews"
    created = workspace_http.post(base, json=request(document_id, agent_id).model_dump(mode="json"))
    assert created.status_code == 202, created.text
    review_id, job_id = created.json()["review"]["id"], created.json()["job"]["id"]
    assert workspace_http.get(f"{base}/{review_id}/report").status_code == 404
    claim = claim_job(postgres.sessions, UUID(job_id), 60)
    assert claim is not None and finish_review_job(postgres.sessions, claim, completion())
    page = workspace_http.get(base).json()
    assert page["total"] == 1 and page["items"][0]["report_id"]
    download = workspace_http.get(
        f"{base}/{review_id}/report/download", params={"format": "markdown"}
    )
    assert download.status_code == 200 and "样本量缺依据" in download.text
    assert json.loads(workspace_http.get(f"{base}/{review_id}/report").text)["content"]["scores"]
    isolated = workspace_http.get(f"/api/v1/projects/{other}/reviews/{review_id}")
    assert isolated.status_code == 404 and isolated.json()["error"]["code"] == "REVIEW_NOT_FOUND"
