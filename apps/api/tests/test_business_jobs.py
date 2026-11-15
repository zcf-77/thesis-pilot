"""Fixed manuscript inputs, real deterministic artifacts and task control boundaries."""

from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import event, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentContent, DocumentImport, DocumentSave
from thesis_pilot.modules.documents.service import import_document, save_document
from thesis_pilot.modules.jobs.models import Job, JobArtifact, OutboxEvent, utcnow
from thesis_pilot.modules.jobs.schemas import (
    InspectionConfiguration,
    InspectionInput,
    JobCreate,
    JobDetail,
)
from thesis_pilot.modules.jobs.service import (
    cancel_job,
    claim_job,
    create_job,
    finish_job,
    get_job_detail,
    list_jobs,
    retry_job,
)
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.workers.execution import execute_job
from thesis_pilot.workflows.document_inspection import run_document_inspection


def content(text: str = "自制 A😀") -> DocumentContent:
    return DocumentContent.model_validate(
        {
            "schema_version": 1,
            "json": {
                "type": "doc",
                "content": [
                    {
                        "type": "paragraph",
                        "content": [
                            {"type": "text", "text": text},
                        ],
                    }
                ],
            },
        }
    )


def prepared(factory: sessionmaker[Session]) -> JobCreate:
    with factory() as session:
        project = create_project(session, ProjectCreate(name="业务任务自制项目"))
        document = import_document(session, project.id, DocumentImport(content=content()))
    return JobCreate(
        project_id=project.id,
        kind="document_inspection",
        input_snapshot=InspectionInput(document_id=document.id, document_version=1),
    )


def enqueue(factory: sessionmaker[Session], request: JobCreate) -> UUID:
    with factory() as session:
        return create_job(session, request, str(uuid4())).id


def details(factory: sessionmaker[Session], job_id: UUID) -> JobDetail:
    with factory() as session:
        return JobDetail.model_validate(get_job_detail(session, job_id))


def test_inspection_uses_fixed_saved_version_and_never_writes_manuscript(
    session_factory: sessionmaker[Session],
) -> None:
    request = prepared(session_factory)
    job_id = enqueue(session_factory, request)
    source = request.input_snapshot
    assert source is not None
    with session_factory() as session:
        save_document(
            session,
            request.project_id,
            source.document_id,
            DocumentSave(expected_version=1, content=content("后来的正文内容")),
        )
    assert execute_job(session_factory, job_id, 60)
    assert not execute_job(session_factory, job_id, 60)
    detail = details(session_factory, job_id)
    assert detail.status == "succeeded" and detail.attempt == 1
    assert detail.result is not None and detail.result.kind == "document_inspection"
    assert detail.result.document_version == 1
    assert detail.result.node_count == 3 and detail.result.paragraph_count == 1
    assert detail.result.text_characters == len("自制 A😀")
    assert len(detail.attempts) == len(detail.artifacts) == 1
    assert detail.artifacts[0].result == detail.result
    assert detail.attempts[0].status == "succeeded"
    assert detail.attempts[0].finished_at is not None
    with session_factory() as session:
        assert session.get(Document, source.document_id).current_version == 2
        assert session.scalar(select(func.count()).select_from(DocumentVersion)) == 2


def test_fixed_configuration_and_idempotency_include_input_and_configuration(
    session_factory: sessionmaker[Session],
) -> None:
    request = prepared(session_factory)
    configured = request.model_copy(
        update={"configuration": InspectionConfiguration(include_text_statistics=False)}
    )
    with session_factory() as session:
        job = create_job(session, configured, "fixed-configuration")
        job_id = job.id
        assert create_job(session, configured, "fixed-configuration").id == job.id
        with pytest.raises(AppError) as caught:
            create_job(session, request, "fixed-configuration")
        assert caught.value.code == "JOB_IDEMPOTENCY_CONFLICT"
    assert execute_job(session_factory, job_id, 60)
    result = details(session_factory, job_id).result
    assert result is not None and result.kind == "document_inspection"
    assert result.text_characters is None


def test_cross_project_and_missing_history_do_not_create_job_or_outbox(
    session_factory: sessionmaker[Session],
) -> None:
    request = prepared(session_factory)
    with session_factory() as session:
        other = create_project(session, ProjectCreate(name="另一个项目"))
        with pytest.raises(AppError) as caught:
            create_job(
                session, request.model_copy(update={"project_id": other.id}), "wrong-project"
            )
        assert caught.value.code == "DOCUMENT_NOT_FOUND"
        assert request.input_snapshot is not None
        missing = request.model_copy(
            update={
                "input_snapshot": request.input_snapshot.model_copy(update={"document_version": 9})
            }
        )
        with pytest.raises(AppError) as caught:
            create_job(session, missing, "missing-version")
        assert caught.value.code == "DOCUMENT_VERSION_NOT_FOUND"
        assert session.scalar(select(func.count()).select_from(Job)) == 0
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 0


def test_filtered_empty_page_keeps_total_from_same_scope(
    session_factory: sessionmaker[Session],
) -> None:
    request = prepared(session_factory)
    enqueue(session_factory, request)
    with session_factory() as session:
        create_job(session, JobCreate(project_id=request.project_id), "page-diagnostic")
        page = list_jobs(
            session,
            request.project_id,
            limit=1,
            offset=1,
            kind="document_inspection",
            statuses=["queued"],
            include_diagnostic=False,
        )
        assert page.items == [] and page.total == 1
        empty = list_jobs(
            session,
            request.project_id,
            limit=1,
            offset=0,
            kind="document_inspection",
            statuses=["running"],
            include_diagnostic=False,
        )
        assert empty.items == [] and empty.total == 0


def test_cancel_and_old_lease_cannot_publish_artifacts(
    session_factory: sessionmaker[Session],
) -> None:
    request = prepared(session_factory)
    job_id = enqueue(session_factory, request)
    instant = utcnow()
    first = claim_job(session_factory, job_id, 10, now=instant)
    second = claim_job(session_factory, job_id, 10, now=instant + timedelta(seconds=11))
    assert first is not None and second is not None
    assert not finish_job(
        session_factory, first, result=run_document_inspection(first, content().json_content)
    )
    with session_factory() as session:
        cancel_job(session, job_id)
    assert not finish_job(
        session_factory, second, result=run_document_inspection(second, content().json_content)
    )
    detail = details(session_factory, job_id)
    assert detail.status == "cancelled" and detail.artifacts == []
    assert [attempt.status for attempt in detail.attempts] == ["lease_expired", "cancelled"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("document_id", str(uuid4())),
        ("document_version", 9),
        ("schema_version", True),
        ("node_count", True),
        ("paragraph_count", 999),
        ("model_used", 0),
        ("writes_performed", True),
        ("text_characters", None),
        ("private", "never persist"),
    ],
)
def test_invalid_result_has_no_artifact(
    session_factory: sessionmaker[Session],
    field: str,
    value: object,
) -> None:
    job_id = enqueue(session_factory, prepared(session_factory))
    claim = claim_job(session_factory, job_id, 60)
    assert claim is not None
    result = run_document_inspection(claim, content().json_content)
    result[field] = value
    assert finish_job(session_factory, claim, result=result)
    detail = details(session_factory, job_id)
    assert detail.status == "failed" and detail.error_code == "JOB_RESULT_INVALID"
    assert detail.artifacts == [] and detail.result is None
    assert detail.attempts[0].error_code == "JOB_RESULT_INVALID"


def test_artifact_failure_rolls_back_result_and_attempt(
    session_factory: sessionmaker[Session],
) -> None:
    job_id = enqueue(session_factory, prepared(session_factory))
    claim = claim_job(session_factory, job_id, 60)
    assert claim is not None

    def fail_artifact(session: Session, context: object, instances: object) -> None:
        if any(isinstance(value, JobArtifact) for value in session.new):
            raise RuntimeError("controlled artifact failure")

    event.listen(session_factory, "before_flush", fail_artifact)
    try:
        with pytest.raises(RuntimeError, match="controlled artifact"):
            finish_job(
                session_factory,
                claim,
                result=run_document_inspection(claim, content().json_content),
            )
    finally:
        event.remove(session_factory, "before_flush", fail_artifact)
    detail = details(session_factory, job_id)
    assert detail.status == "running" and detail.result is None and detail.artifacts == []
    assert detail.attempts[0].status == "running" and detail.attempts[0].finished_at is None
    assert finish_job(
        session_factory, claim, result=run_document_inspection(claim, content().json_content)
    )


def test_retry_creates_new_job_once_and_preserves_fixed_scope(
    session_factory: sessionmaker[Session],
) -> None:
    request = prepared(session_factory)
    job_id = enqueue(session_factory, request)
    with session_factory() as session:
        with pytest.raises(AppError) as caught:
            retry_job(session, job_id, "running-not-retryable")
        assert caught.value.code == "JOB_STATE_CONFLICT"
        cancel_job(session, job_id)
        retried = retry_job(session, job_id, "retry-once")
        assert retry_job(session, job_id, "retry-once").id == retried.id
        assert retried.source_job_id == job_id and retried.id != job_id
        assert retried.input_snapshot == request.input_snapshot.model_dump(mode="json")
        assert retried.resource_scope == retried.input_snapshot
        cancel_job(session, retried.id)
        with pytest.raises(AppError) as caught:
            retry_job(session, retried.id, "retry-once")
        assert caught.value.code == "JOB_IDEMPOTENCY_CONFLICT"
    assert details(session_factory, job_id).status == "cancelled"


def test_formal_filters_and_scoped_commands_do_not_expose_diagnostics(
    client: TestClient,
    app: FastAPI,
    session_factory: sessionmaker[Session],
) -> None:
    request = prepared(session_factory)
    job_id = enqueue(session_factory, request)
    with session_factory() as session:
        diagnostic = create_job(
            session, JobCreate(project_id=request.project_id), "diagnostic-only"
        )
        other = create_project(session, ProjectCreate(name="错项目范围"))
    # Existing Bearer authentication stays active while routing enforces formal boundaries.
    app.state.settings.auth_mode = "workspace"
    prefix = "/api/v1/jobs"
    listed = client.get(prefix, params={"project_id": str(request.project_id)}).json()
    assert listed["total"] == 1 and listed["items"][0]["id"] == str(job_id)
    response = client.post(
        prefix,
        json={"project_id": str(request.project_id)},
        headers={"Idempotency-Key": "blocked-diagnostic"},
    )
    assert (
        response.status_code == 422 and response.json()["error"]["code"] == "JOB_KIND_UNAVAILABLE"
    )
    for operation in ("", "/cancel", "/retry"):
        call = client.get if not operation else client.post
        assert (
            call(f"{prefix}/{job_id}{operation}", headers={"Idempotency-Key": "scope"}).status_code
            == 422
        )
        for selected_id, project_id in ((diagnostic.id, request.project_id), (job_id, other.id)):
            response = call(
                f"{prefix}/{selected_id}{operation}",
                params={"project_id": str(project_id)},
                headers={"Idempotency-Key": "scope"},
            )
            assert response.status_code == 404
    response = client.get(f"{prefix}/{job_id}", params={"project_id": str(request.project_id)})
    assert response.status_code == 200 and response.json()["attempts"] == []
    assert details(session_factory, job_id).status == "queued"
    assert details(session_factory, diagnostic.id).status == "queued"


def test_legacy_dispatch_and_corrupt_input_do_not_execute_business_work(
    session_factory: sessionmaker[Session],
) -> None:
    job_id = enqueue(session_factory, prepared(session_factory))
    assert not execute_job(session_factory, job_id, 60, expected_kind="diagnostic")
    assert details(session_factory, job_id).attempt == 0
    with session_factory() as session, session.begin():
        session.execute(
            update(Job).where(Job.id == job_id).values(resource_scope={"invalid": True})
        )
    assert not execute_job(session_factory, job_id, 60)
    # Read the database directly because corrupt source records are not a valid public DTO.
    with session_factory() as session:
        record = session.get(Job, job_id)
        assert record is not None and record.error_code == "JOB_INPUT_INVALID"


@pytest.mark.parametrize(
    "payload",
    [
        {"kind": "document_inspection"},
        {"kind": "arbitrary_task"},
        {"kind": "diagnostic", "configuration": {"include_text_statistics": True}},
    ],
)
def test_disallowed_job_input_is_rejected(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        JobCreate.model_validate({"project_id": uuid4(), **payload})
