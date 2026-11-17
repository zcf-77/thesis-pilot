"""Worker side of exports: claim, read fixed facts, render outside a transaction, then
store file + artifact + terminal Job state atomically under the same run token.

This reuses the jobs module's lease/attempt primitives so cancellation, deadlines, lease
expiry and late results behave exactly like every other job kind.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.content import view_of
from thesis_pilot.modules.documents.models import DocumentVersion
from thesis_pilot.modules.documents.structure import compact_json
from thesis_pilot.modules.exports.change_record import (
    collect_change_facts,
    render_change_record,
)
from thesis_pilot.modules.exports.contracts import (
    CONTENT_TYPES,
    EXTENSIONS,
    MAX_EXPORT_BYTES,
    RENDERER_VERSION,
    ChangeRecordInput,
    ChangeRecordResult,
    DocumentExportInput,
    DocumentExportResult,
)
from thesis_pilot.modules.exports.models import ExportFile
from thesis_pilot.modules.exports.render import render_document
from thesis_pilot.modules.exports.service import fixed_export_input, stable_digest
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

# Codes a failed export may expose; everything else collapses to JOB_EXECUTION_FAILED.
EXPORT_FAILURE_CODES = frozenset(
    {
        "EXPORT_SOURCE_CHANGED",
        "EXPORT_TOO_LARGE",
        "JOB_INPUT_INVALID",
        "DOCUMENT_NOT_FOUND",
        "DOCUMENT_VERSION_NOT_FOUND",
        "DOCUMENT_STRUCTURE_INVALID",
        "DOCUMENT_TOO_LARGE",
    }
)


@dataclass(frozen=True)
class RenderedExport:
    text: str
    filename: str
    content_type: str
    version_count: int


def claim_export_in_transaction(
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
        source, configuration = fixed_export_input(job)
        if configuration.renderer_version != RENDERER_VERSION:
            raise ValueError("渲染器版本不可用。")
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
    return JobClaim(job.id, job.project_id, token, kind=job.kind, export_input=source)  # type: ignore[arg-type]


def _load(
    factory: sessionmaker[Session], claim: JobClaim
) -> tuple[DocumentExportInput | ChangeRecordInput, object] | None:
    """Read the fixed facts and prove they still match the digest frozen at enqueue."""
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, None)
        if execution is None:
            return None
        job = execution[0]
        try:
            source, configuration = fixed_export_input(job)
        except (ValidationError, ValueError):
            raise AppError("JOB_INPUT_INVALID", "导出任务固定输入无效。", 422) from None
        if source != claim.export_input or job.project_id != claim.project_id:
            raise AppError("JOB_INPUT_INVALID", "导出任务固定输入无效。", 422)
        facts: object
        if isinstance(source, DocumentExportInput):
            version = session.get(DocumentVersion, (source.document_id, source.document_version))
            if version is None:
                raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正式稿版本不存在。", 404)
            digest = sha256(compact_json(version.content_json).encode()).hexdigest()
            # Rendering still reads v1 Tiptap JSON; v2 exports are refused, never guessed.
            facts = view_of(version).legacy_json()
        else:
            facts = collect_change_facts(
                session, source.document_id, source.from_version, source.to_version
            )
            digest = stable_digest(facts)
        if digest != configuration.source_sha256:
            raise AppError("EXPORT_SOURCE_CHANGED", "固定版本内容与创建时不一致。", 409)
        return source, facts


def render_export(source: DocumentExportInput | ChangeRecordInput, facts: object) -> RenderedExport:
    if isinstance(source, DocumentExportInput):
        text = render_document(facts, source.document_version, source.format)
        filename = f"论文正文-v{source.document_version}.{EXTENSIONS[source.format]}"
        count = 1
    else:
        assert isinstance(facts, dict)
        text = render_change_record(facts, source.format)
        filename = (
            f"修改说明-v{source.from_version}-v{source.to_version}.{EXTENSIONS[source.format]}"
        )
        count = len(facts["versions"])
    if len(text.encode()) > MAX_EXPORT_BYTES:
        raise AppError("EXPORT_TOO_LARGE", "导出文件超过 8MiB 下载上限。", 413)
    return RenderedExport(text, filename, CONTENT_TYPES[source.format], count)


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
            error_code=code if code in EXPORT_FAILURE_CODES else "JOB_EXECUTION_FAILED",
        )
        return True


def finish_export_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    rendered: RenderedExport,
    *,
    now: datetime | None = None,
) -> bool:
    """A cancelled, expired or superseded run returns False and stores nothing."""
    data = rendered.text.encode()
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, now)
        if execution is None:
            return False
        job, instant, _ = execution
        source = claim.export_input
        attempt = session.scalar(
            select(JobAttempt).where(
                JobAttempt.job_id == job.id, JobAttempt.run_token == claim.run_token
            )
        )
        if (
            source is None
            or attempt is None
            or job.input_snapshot != source.model_dump(mode="json")
            or job.resource_scope != source.model_dump(mode="json")
            or not 1 <= len(data) <= MAX_EXPORT_BYTES
        ):
            _end_execution(session, job, instant, status="failed", error_code="JOB_RESULT_INVALID")
            return True
        file = ExportFile(
            id=uuid4(),
            project_id=job.project_id,
            job_id=job.id,
            attempt_id=attempt.id,
            kind=job.kind,
            format=source.format,
            document_id=source.document_id,
            document_version=source.document_version
            if isinstance(source, DocumentExportInput)
            else source.to_version,
            from_version=source.from_version if isinstance(source, ChangeRecordInput) else None,
            filename=rendered.filename,
            content_type=rendered.content_type,
            sha256=sha256(data).hexdigest(),
            byte_size=len(data),
            data=data,
            created_at=instant,
        )
        session.add(file)
        common = {
            "schema_version": 1,
            "job_id": str(job.id),
            "project_id": str(job.project_id),
            "document_id": str(source.document_id),
            "file_id": str(file.id),
            "filename": file.filename,
            "content_type": file.content_type,
            "sha256": file.sha256,
            "byte_size": file.byte_size,
            "format": source.format,
            "model_used": False,
            "writes_performed": False,
        }
        result: DocumentExportResult | ChangeRecordResult
        if isinstance(source, DocumentExportInput):
            result = DocumentExportResult.model_validate(
                {**common, "kind": "document_export", "document_version": source.document_version}
            )
        else:
            result = ChangeRecordResult.model_validate(
                {
                    **common,
                    "kind": "change_record",
                    "from_version": source.from_version,
                    "to_version": source.to_version,
                    "version_count": rendered.version_count,
                }
            )
        session.flush()
        session.add(
            JobArtifact(
                job_id=job.id,
                attempt_id=attempt.id,
                kind=result.kind,
                schema_version=1,
                result=result.model_dump(mode="json"),
                created_at=instant,
            )
        )
        _end_execution(session, job, instant, status="succeeded", result=result)
        return True


def run_export_job(factory: sessionmaker[Session], claim: JobClaim) -> bool:
    try:
        loaded = _load(factory, claim)
        if loaded is None:
            return False
        rendered = render_export(*loaded)
    except AppError as failure:
        return _fail(factory, claim, failure.code)
    except Exception:
        return _fail(factory, claim, "JOB_EXECUTION_FAILED")
    return finish_export_job(factory, claim, rendered)
