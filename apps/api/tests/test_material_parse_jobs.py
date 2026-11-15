import base64
from datetime import timedelta
from hashlib import sha256
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.models import Document
from thesis_pilot.modules.jobs import service as job_service
from thesis_pilot.modules.jobs.material_parse import run_material_parse
from thesis_pilot.modules.jobs.models import Job, JobArtifact, OutboxEvent, utcnow
from thesis_pilot.modules.jobs.schemas import JobCreate, JobDetail, MaterialParseInput
from thesis_pilot.modules.jobs.service import (
    cancel_job,
    claim_job,
    create_job,
    enqueue_material_parse,
    finish_material_parse_job,
    get_job_detail,
    retry_job,
)
from thesis_pilot.modules.materials.models import MaterialOriginal, MaterialParseVersion
from thesis_pilot.modules.materials.schemas import MaterialUpload, MaterialUploadReceipt
from thesis_pilot.modules.materials.service import upload_material
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.workers.execution import execute_job

SYNTHETIC_TEXT = "自制学校要求\n论文正文不少于8000字。\n参考文献不少于15篇。"


def uploaded(
    factory: sessionmaker[Session], *, file_type: str = "text", data: bytes | None = None
) -> MaterialUploadReceipt:
    with factory() as session:
        owner = create_project(session, ProjectCreate(name="资料解析任务自制项目"))
        return upload_material(
            session,
            owner.id,
            MaterialUpload.model_validate(
                {
                    "name": "自制要求",
                    "kind": "requirements",
                    "filename": "synthetic.pdf" if file_type == "pdf" else "synthetic.txt",
                    "file_type": file_type,
                    "content_base64": base64.b64encode(data or SYNTHETIC_TEXT.encode()).decode(),
                }
            ),
            str(uuid4()),
        )


def detail(factory: sessionmaker[Session], job_id: UUID) -> JobDetail:
    with factory() as session:
        return JobDetail.model_validate(get_job_detail(session, job_id))


def counts(factory: sessionmaker[Session]) -> tuple[int, int]:
    with factory() as session:
        return (
            session.scalar(select(func.count()).select_from(MaterialParseVersion)) or 0,
            session.scalar(select(func.count()).select_from(JobArtifact)) or 0,
        )


def test_real_text_parser_produces_one_atomic_snapshot_and_small_job_summary(
    session_factory: sessionmaker[Session],
) -> None:
    receipt = uploaded(session_factory)
    assert execute_job(session_factory, receipt.job.id, 60)
    assert not execute_job(session_factory, receipt.job.id, 60)
    finished = detail(session_factory, receipt.job.id)
    assert finished.status == "succeeded" and finished.result is not None
    assert finished.result.kind == "material_parse"
    assert finished.result.original_version_id == receipt.original.id
    assert finished.result.original_sha256 == sha256(SYNTHETIC_TEXT.encode()).hexdigest()
    assert not finished.result.model_used and not finished.result.writes_performed
    assert SYNTHETIC_TEXT not in finished.model_dump_json()
    assert finished.artifacts[0].result == finished.result
    assert counts(session_factory) == (1, 1)
    with session_factory() as session:
        original = session.get(MaterialOriginal, receipt.original.id)
        assert original is not None and original.latest_parse_id == finished.result.parse_version_id
        assert original.data == SYNTHETIC_TEXT.encode()
        assert session.scalar(select(func.count()).select_from(Document)) == 0


def test_cancelled_job_cannot_leave_a_parse_version_or_artifact(
    session_factory: sessionmaker[Session],
) -> None:
    receipt = uploaded(session_factory)
    claim = claim_job(session_factory, receipt.job.id, 60)
    assert claim is not None
    parsed = run_material_parse(session_factory, claim)
    assert parsed is not None and counts(session_factory) == (0, 0)
    with session_factory() as session:
        cancel_job(session, receipt.job.id)
    assert not finish_material_parse_job(session_factory, claim, parsed)
    assert run_material_parse(session_factory, claim) is None
    assert counts(session_factory) == (0, 0)


def test_lost_lease_old_token_cannot_publish_after_recovery(
    session_factory: sessionmaker[Session],
) -> None:
    receipt = uploaded(session_factory)
    start = utcnow()
    old = claim_job(session_factory, receipt.job.id, 1, now=start)
    assert old is not None
    parsed = run_material_parse(session_factory, old)
    assert parsed is not None
    renewed = claim_job(session_factory, receipt.job.id, 60, now=start + timedelta(seconds=2))
    assert renewed is not None and renewed.run_token != old.run_token
    assert not finish_material_parse_job(
        session_factory, old, parsed, now=start + timedelta(seconds=2)
    )
    assert finish_material_parse_job(
        session_factory, renewed, parsed, now=start + timedelta(seconds=2)
    )
    assert counts(session_factory) == (1, 1)


def test_stale_expected_parse_id_never_overwrites_new_parse(
    session_factory: sessionmaker[Session],
) -> None:
    receipt = uploaded(session_factory)
    with session_factory() as session, session.begin():
        second = enqueue_material_parse(
            session,
            receipt.material.project_id,
            receipt.material.id,
            receipt.original.id,
            receipt.original.sha256,
            None,
            "second-before-first-finished",
        )
        second_id = second.id
    first_claim = claim_job(session_factory, receipt.job.id, 60)
    second_claim = claim_job(session_factory, second_id, 60)
    assert first_claim is not None and second_claim is not None
    first = run_material_parse(session_factory, first_claim)
    second = run_material_parse(session_factory, second_claim)
    assert first is not None and second is not None
    assert finish_material_parse_job(session_factory, first_claim, first)
    assert finish_material_parse_job(session_factory, second_claim, second)
    assert detail(session_factory, second_id).error_code == "MATERIAL_PARSE_CONFLICT"
    assert counts(session_factory) == (1, 1)


def test_artifact_failure_rolls_back_parse_pointer_attempt_and_job(
    session_factory: sessionmaker[Session],
) -> None:
    receipt = uploaded(session_factory)
    claim = claim_job(session_factory, receipt.job.id, 60)
    assert claim is not None
    parsed = run_material_parse(session_factory, claim)
    assert parsed is not None

    def reject_artifact(*args: object) -> None:
        raise RuntimeError("synthetic artifact failure")

    event.listen(JobArtifact, "before_insert", reject_artifact)
    try:
        with pytest.raises(RuntimeError, match="synthetic artifact failure"):
            finish_material_parse_job(session_factory, claim, parsed)
    finally:
        event.remove(JobArtifact, "before_insert", reject_artifact)
    assert counts(session_factory) == (0, 0)
    assert detail(session_factory, receipt.job.id).status == "running"
    with session_factory() as session:
        original = session.get(MaterialOriginal, receipt.original.id)
        assert original is not None and original.latest_parse_id is None
    assert finish_material_parse_job(session_factory, claim, parsed)
    assert counts(session_factory) == (1, 1)


def test_worker_rechecks_database_bytes_against_fixed_sha(
    session_factory: sessionmaker[Session],
) -> None:
    receipt = uploaded(session_factory)
    with session_factory() as session, session.begin():
        original = session.get(MaterialOriginal, receipt.original.id)
        assert original is not None
        original.data = b"synthetic database corruption"
    assert execute_job(session_factory, receipt.job.id, 60)
    assert detail(session_factory, receipt.job.id).error_code == "MATERIAL_ORIGINAL_CORRUPT"
    assert counts(session_factory) == (0, 0)


def test_generic_job_create_cannot_spoof_server_material_snapshot(
    session_factory: sessionmaker[Session],
) -> None:
    receipt = uploaded(session_factory)
    request = JobCreate(
        project_id=receipt.material.project_id,
        kind="material_parse",
        input_snapshot=MaterialParseInput(
            material_id=receipt.material.id,
            original_version_id=receipt.original.id,
            original_sha256=receipt.original.sha256,
            expected_parse_id=None,
        ),
    )
    with session_factory() as session:
        with pytest.raises(AppError) as caught:
            create_job(session, request, "client-spoofed-material")
        assert caught.value.code == "JOB_KIND_UNAVAILABLE"
        assert session.scalar(select(func.count()).select_from(Job)) == 1


def test_retry_and_enqueue_replay_preserve_exact_source_and_configuration(
    session_factory: sessionmaker[Session],
) -> None:
    receipt = uploaded(session_factory)
    with session_factory() as session:
        cancel_job(session, receipt.job.id)
        retried = retry_job(session, receipt.job.id, "retry-original")
        retry_id = retried.id
        assert retried.input_snapshot == receipt.job.input_snapshot.model_dump(mode="json")
        assert retried.configuration == receipt.job.configuration.model_dump(mode="json")
        assert retry_job(session, receipt.job.id, "retry-original").id == retry_id
    assert execute_job(session_factory, retry_id, 60)
    with session_factory() as session, session.begin():
        replay = enqueue_material_parse(
            session,
            receipt.material.project_id,
            receipt.material.id,
            receipt.original.id,
            receipt.original.sha256,
            None,
            "retry-original",
            receipt.job.id,
        )
        assert replay.id == retry_id
    assert counts(session_factory) == (1, 1)


def test_unsupported_pdf_and_invalid_utf8_preserve_original_and_safe_errors(
    session_factory: sessionmaker[Session],
) -> None:
    for file_type, data, code in [
        ("pdf", b"%PDF-synthetic", "MATERIAL_UNSUPPORTED_TYPE"),
        ("text", b"\xff\xfe\xff", "MATERIAL_PARSE_INVALID"),
    ]:
        receipt = uploaded(session_factory, file_type=file_type, data=data)
        assert execute_job(session_factory, receipt.job.id, 60)
        assert detail(session_factory, receipt.job.id).error_code == code
        with session_factory() as session:
            original = session.get(MaterialOriginal, receipt.original.id)
            assert (
                original is not None and original.data == data and original.latest_parse_id is None
            )
    assert counts(session_factory) == (0, 0)


def test_other_project_source_is_rejected_before_enqueue(
    session_factory: sessionmaker[Session],
) -> None:
    receipt = uploaded(session_factory)
    with session_factory() as session:
        other = create_project(session, ProjectCreate(name="其他资料项目"))
        with pytest.raises(AppError) as caught, session.begin():
            enqueue_material_parse(
                session,
                other.id,
                receipt.material.id,
                receipt.original.id,
                receipt.original.sha256,
                None,
                "wrong-project",
            )
        assert caught.value.status_code == 404
        assert session.scalar(select(func.count()).select_from(Job)) == 1
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_cross_original_anchor_and_mutated_scope_cannot_publish(
    session_factory: sessionmaker[Session],
) -> None:
    receipt = uploaded(session_factory)
    claim = claim_job(session_factory, receipt.job.id, 60)
    assert claim is not None
    parsed = run_material_parse(session_factory, claim)
    assert parsed is not None and parsed.anchors
    parsed.anchors[0].original_version_id = uuid4()
    assert finish_material_parse_job(session_factory, claim, parsed)
    assert detail(session_factory, receipt.job.id).error_code == "JOB_RESULT_INVALID"
    assert counts(session_factory) == (0, 0)
    fresh = uploaded(session_factory)
    with session_factory() as session, session.begin():
        job = session.get(Job, fresh.job.id)
        assert job is not None
        job.resource_scope = {**job.input_snapshot, "original_version_id": str(uuid4())}
    assert claim_job(session_factory, fresh.job.id, 60) is None
    assert detail(session_factory, fresh.job.id).error_code == "JOB_INPUT_INVALID"
    assert counts(session_factory) == (0, 0)


def test_lease_expiring_during_material_commit_rolls_back_all_parse_writes(
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    receipt = uploaded(session_factory)
    instant = utcnow()
    claim = claim_job(session_factory, receipt.job.id, 1, now=instant)
    assert claim is not None
    parsed = run_material_parse(session_factory, claim)
    assert parsed is not None
    clock = iter([instant, instant + timedelta(seconds=2), instant + timedelta(seconds=2)])
    with monkeypatch.context() as controlled:
        controlled.setattr(job_service, "_database_now", lambda session, now: next(clock))
        assert not finish_material_parse_job(session_factory, claim, parsed)
    assert counts(session_factory) == (0, 0)
    recovered = claim_job(session_factory, receipt.job.id, 60, now=instant + timedelta(seconds=2))
    assert recovered is not None
    assert finish_material_parse_job(
        session_factory, recovered, parsed, now=instant + timedelta(seconds=2)
    )
    assert counts(session_factory) == (1, 1)
