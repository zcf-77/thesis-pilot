"""Worker side of office imports: claim, read the pinned original, call the sidecar outside
any transaction, then store resources + preview + artifact + terminal state atomically under
the same run token. A cancelled, expired or superseded run stores nothing.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
from typing import Any, cast
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources.office_contracts import (
    OFFICE_IMPORT_KIND,
    OfficeImportInput,
    OfficeImportResult,
)
from thesis_pilot.modules.document_sources.office_models import OfficeImport
from thesis_pilot.modules.document_sources.office_service import fixed_import_input
from thesis_pilot.modules.document_sources.office_snapshot import (
    OFFICE_IMPORT_CONVERTER,
    ImportBuild,
    build_import,
)
from thesis_pilot.modules.documents.content import ContentView
from thesis_pilot.modules.documents.docs_model import (
    block_plain_text,
    find_block,
    model_of,
    walk_blocks,
)
from thesis_pilot.modules.documents.models import DocumentResource
from thesis_pilot.modules.jobs.models import Job, JobArtifact, JobAttempt
from thesis_pilot.modules.jobs.service import (
    JobClaim,
    _current_execution,
    _database_now,
    _end_execution,
    _expiration_error,
    _finish_attempt,
    _lease_expired,
)
from thesis_pilot.modules.materials.models import MaterialOriginal
from thesis_pilot.providers.office_server import (
    OFFICE_ERROR_CODES,
    OfficeServerClient,
    OfficeServerError,
)

Obj = dict[str, Any]

IMPORT_FAILURE_CODES = OFFICE_ERROR_CODES | {
    "OFFICE_IMPORT_INVALID",
    "OFFICE_IMPORT_MODEL_INVALID",
    "OFFICE_IMPORT_ORIGINAL_CHANGED",
    "DOCMODEL_TOO_LARGE",
    "JOB_INPUT_INVALID",
    "JOB_RESULT_INVALID",
}
MAX_PREVIEW_CHAPTERS = 200
MAX_PREVIEW_OBJECTS = 200


@dataclass(frozen=True)
class LoadedOriginal:
    source: OfficeImportInput
    filename: str
    data: bytes


def claim_office_import_in_transaction(
    session: Session,
    job: Job,
    lease_seconds: int,
    execution_timeout_seconds: int,
    max_attempts: int,
    now: datetime | None,
) -> JobClaim | None:
    instant = _database_now(session, now)
    error_code = _expiration_error(job, instant, max_attempts)
    if error_code is not None:
        _end_execution(session, job, instant, status="failed", error_code=error_code)
        return None
    if job.status == "running" and not _lease_expired(job, instant):
        return None
    try:
        source = fixed_import_input(job)
    except (ValidationError, ValueError):
        _end_execution(session, job, instant, status="failed", error_code="JOB_INPUT_INVALID")
        return None
    if job.status == "running":
        _finish_attempt(session, job, instant, "lease_expired")
    instant = _database_now(session, now)
    token = uuid4()
    deadline = instant + timedelta(seconds=execution_timeout_seconds)
    job.status = "running"
    job.run_token = token
    job.lease_until = min(instant + timedelta(seconds=lease_seconds), deadline)
    job.execution_deadline_at = deadline
    job.attempt += 1
    job.updated_at = instant
    job.error_code = None
    session.add(
        JobAttempt(
            job_id=job.id,
            attempt=job.attempt,
            run_token=token,
            status="running",
            started_at=instant,
        )
    )
    return JobClaim(job.id, job.project_id, token, kind="office_import", office_import_input=source)


def load_original(factory: sessionmaker[Session], claim: JobClaim) -> LoadedOriginal | None:
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, None)
        if execution is None:
            return None
        job = execution[0]
        try:
            source = fixed_import_input(job)
        except (ValidationError, ValueError):
            raise AppError("JOB_INPUT_INVALID", "原件导入任务固定输入无效。", 422) from None
        if source != claim.office_import_input or job.project_id != claim.project_id:
            raise AppError("JOB_INPUT_INVALID", "原件导入任务固定输入无效。", 422)
        original = session.get(MaterialOriginal, source.original_id)
        if original is None or original.material_id != source.material_id:
            raise AppError("JOB_INPUT_INVALID", "原件导入任务固定输入无效。", 422)
        data = original.data
        if (
            original.sha256 != source.original_sha256
            or len(data) != original.byte_size
            or sha256(data).hexdigest() != source.original_sha256
        ):
            raise AppError(
                "OFFICE_IMPORT_ORIGINAL_CHANGED", "原件字节与导入时固定的摘要不一致。", 409
            )
        return LoadedOriginal(source, original.filename, bytes(data))


def convert(client: OfficeServerClient, loaded: LoadedOriginal) -> ImportBuild:
    """Sidecar calls only; no database session is open here."""
    parsed = client.parse_docx(loaded.data)
    inspected = client.inspect(loaded.data, ["irMap", "index"])
    return build_import(
        cast(Obj, parsed.model),
        cast(list[Obj], parsed.unsupported),
        parsed.converted,
        inspected.get("irMap"),
        loaded.source.original_sha256,
    )


def summarize(build: ImportBuild) -> dict[str, object]:
    snapshot = build.snapshot
    model = model_of(snapshot)
    counts = ContentView.of(2, snapshot).inspection_counts()
    images = 0
    blocks = 0
    for ref in walk_blocks(model):
        blocks += 1
        current: Obj = ref.block
        if current.get("type") == "image":
            images += 1
        for key in ("inlines", "caption"):
            inlines = current.get(key)
            if isinstance(inlines, list):
                images += sum(
                    1 for item in inlines if isinstance(item, dict) and item.get("type") == "image"
                )
    chapters = cast(list[Obj], snapshot["chapters"])
    objects: list[dict[str, object]] = []
    for protection in cast(list[Obj], snapshot["protections"])[:MAX_PREVIEW_OBJECTS]:
        node = cast(str, cast(Obj, protection["anchor"])["node"])
        block = find_block(model, node)
        objects.append(
            {
                "node_id": node,
                "block_type": str(block.get("type")) if block else "unknown",
                "excerpt": " ".join(block_plain_text(block).split())[:60] if block else "",
            }
        )
    return {
        "block_count": blocks,
        "paragraph_count": counts["paragraph_count"],
        "table_count": counts["table_count"],
        "image_count": images,
        "text_characters": counts["text_characters"],
        "chapters": [
            {"id": item["id"], "title": cast(str, item["title"])[:200], "level": item["level"]}
            for item in chapters[:MAX_PREVIEW_CHAPTERS]
        ],
        "chapters_truncated": len(chapters) > MAX_PREVIEW_CHAPTERS,
        "objects": objects,
    }


def _fail(factory: sessionmaker[Session], claim: JobClaim, code: str) -> bool:
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, None)
        if execution is None:
            return False
        job, instant, _ = execution
        _end_execution(
            session,
            job,
            instant,
            status="failed",
            error_code=code if code in IMPORT_FAILURE_CODES else "JOB_EXECUTION_FAILED",
        )
        return True


def _store_resources(
    session: Session, project_id: object, build: ImportBuild, instant: datetime
) -> None:
    for resource in build.resources:
        existing = session.scalar(
            select(DocumentResource).where(
                DocumentResource.project_id == project_id,
                DocumentResource.sha256 == resource.sha256,
            )
        )
        if existing is not None:
            if existing.mime != resource.mime:
                raise AppError("OFFICE_IMPORT_INVALID", "原件图片与已有资源类型不一致。", 422)
            continue
        try:
            with session.begin_nested():
                session.add(
                    DocumentResource(
                        id=uuid4(),
                        project_id=project_id,
                        sha256=resource.sha256,
                        mime=resource.mime,
                        byte_size=len(resource.data),
                        width_px=resource.width_px,
                        height_px=resource.height_px,
                        content=resource.data,
                        created_at=instant,
                    )
                )
        except IntegrityError:
            # A concurrent identical image won the unique (project, sha256) race.
            continue


def finish_office_import(
    factory: sessionmaker[Session],
    claim: JobClaim,
    loaded: LoadedOriginal,
    build: ImportBuild,
    *,
    now: datetime | None = None,
) -> bool:
    summary = summarize(build)
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, now)
        if execution is None:
            return False
        job, instant, _ = execution
        attempt = session.scalar(
            select(JobAttempt).where(
                JobAttempt.job_id == job.id, JobAttempt.run_token == claim.run_token
            )
        )
        source = claim.office_import_input
        if (
            attempt is None
            or source is None
            or job.input_snapshot != source.model_dump(mode="json")
            or loaded.source != source
        ):
            _end_execution(session, job, instant, status="failed", error_code="JOB_RESULT_INVALID")
            return True
        _store_resources(session, job.project_id, build, instant)
        row = OfficeImport(
            id=uuid4(),
            project_id=job.project_id,
            job_id=job.id,
            attempt_id=attempt.id,
            material_id=source.material_id,
            original_id=source.original_id,
            original_sha256=source.original_sha256,
            filename=loaded.filename[:255],
            converter=OFFICE_IMPORT_CONVERTER,
            snapshot=build.snapshot,
            ir_map=build.ir_map,
            losses=build.losses,
            summary=summary,
            created_at=instant,
        )
        session.add(row)
        session.flush()
        result = OfficeImportResult.model_validate(
            {
                "kind": OFFICE_IMPORT_KIND,
                "schema_version": 1,
                "job_id": str(job.id),
                "project_id": str(job.project_id),
                "import_id": str(row.id),
                "original_sha256": source.original_sha256,
                "block_count": summary["block_count"],
                "chapter_count": len(cast(list[object], build.snapshot["chapters"])),
                "object_count": len(cast(list[object], build.snapshot["protections"])),
                "loss_count": len(build.losses),
                "model_used": False,
                "writes_performed": False,
            }
        )
        session.add(
            JobArtifact(
                job_id=job.id,
                attempt_id=attempt.id,
                kind=OFFICE_IMPORT_KIND,
                schema_version=1,
                result=result.model_dump(mode="json"),
                created_at=instant,
            )
        )
        _end_execution(session, job, instant, status="succeeded", result=result)
        return True


def run_office_import_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    client: OfficeServerClient | None = None,
) -> bool:
    try:
        loaded = load_original(factory, claim)
        if loaded is None:
            return False
        build = convert(client or OfficeServerClient.from_settings(), loaded)
    except OfficeServerError as failure:
        return _fail(factory, claim, failure.code)
    except AppError as failure:
        return _fail(factory, claim, failure.code)
    except Exception:
        return _fail(factory, claim, "JOB_EXECUTION_FAILED")
    try:
        return finish_office_import(factory, claim, loaded, build)
    except AppError as failure:
        return _fail(factory, claim, failure.code)
