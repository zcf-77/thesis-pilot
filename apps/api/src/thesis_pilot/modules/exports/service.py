"""Export requests freeze project, document, version range and format into one Job."""

import json
from hashlib import sha256
from typing import cast
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.content import view_of
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.structure import compact_json
from thesis_pilot.modules.exports.change_record import collect_change_facts
from thesis_pilot.modules.exports.contracts import (
    EXPORT_JOB_KINDS,
    MAX_CHANGE_RECORD_VERSIONS,
    ChangeRecordInput,
    DocumentExportInput,
    ExportConfiguration,
)
from thesis_pilot.modules.exports.models import ExportFile
from thesis_pilot.modules.exports.schemas import (
    ChangeRecordCreate,
    DocumentExportCreate,
    ExportFileRead,
    ExportPage,
    ExportRead,
)
from thesis_pilot.modules.jobs.models import Job, OutboxEvent
from thesis_pilot.modules.projects.models import Project

ExportInput = DocumentExportInput | ChangeRecordInput


def error(code: str, message: str, status: int = 422) -> AppError:
    return AppError("EXPORT_" + code, message, status)


def stable_digest(value: object) -> str:
    return sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def _require_document(session: Session, project_id: UUID, document_id: UUID) -> Document:
    if session.get(Project, project_id) is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
    document = session.scalar(
        select(Document).where(Document.id == document_id, Document.project_id == project_id)
    )
    if document is None:
        raise AppError("DOCUMENT_NOT_FOUND", "项目中没有指定正式稿。", 404)
    return document


def _require_version(session: Session, document_id: UUID, number: int) -> DocumentVersion:
    version = session.get(DocumentVersion, (document_id, number))
    if version is None:
        raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正式稿版本不存在。", 404)
    return version


def source_digest(session: Session, project_id: UUID, source: ExportInput) -> str:
    """Digest of the exact facts the renderer reads; recomputed by the worker."""
    _require_document(session, project_id, source.document_id)
    if isinstance(source, DocumentExportInput):
        version = _require_version(session, source.document_id, source.document_version)
        view_of(version).legacy_json()
        return sha256(compact_json(version.content_json).encode()).hexdigest()
    _require_version(session, source.document_id, source.from_version)
    _require_version(session, source.document_id, source.to_version)
    facts = collect_change_facts(
        session, source.document_id, source.from_version, source.to_version
    )
    return stable_digest(facts)


def _match(job: Job, digest: str) -> Job:
    if job.request_hash != digest:
        raise AppError("JOB_IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求，请使用新键。", 409)
    return job


def _insert(
    session: Session,
    project_id: UUID,
    source: ExportInput,
    idempotency_key: str,
    digest: str,
    source_job_id: UUID | None = None,
) -> Job:
    configuration = ExportConfiguration(source_sha256=source_digest(session, project_id, source))
    fixed = source.model_dump(mode="json")
    job = Job(
        project_id=project_id,
        kind="document_export" if isinstance(source, DocumentExportInput) else "change_record",
        idempotency_key=idempotency_key,
        request_hash=digest,
        input_snapshot=fixed,
        resource_scope=dict(fixed),
        configuration=configuration.model_dump(mode="json"),
        source_job_id=source_job_id,
    )
    session.add(job)
    session.flush()
    session.add(OutboxEvent(job_id=job.id))
    session.flush()
    return job


def _submit(
    session: Session,
    project_id: UUID,
    idempotency_key: str,
    digest: str,
    source_of: "SourceFactory",
) -> ExportRead:
    try:
        with session.begin():
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is not None:
                job = _match(existing, digest)
            else:
                job = _insert(session, project_id, source_of(session), idempotency_key, digest)
            if job.project_id != project_id or job.kind not in EXPORT_JOB_KINDS:
                raise AppError(
                    "JOB_IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求，请使用新键。", 409
                )
            return _read(session, job)
    except IntegrityError:
        # A concurrent identical request committed the same key after our read.
        with session.begin():
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is None:
                raise
            return _read(session, _match(existing, digest))


class SourceFactory:
    def __init__(self, project_id: UUID, data: DocumentExportCreate | ChangeRecordCreate) -> None:
        self.project_id = project_id
        self.data = data

    def __call__(self, session: Session) -> ExportInput:
        data = self.data
        if isinstance(data, DocumentExportCreate):
            return DocumentExportInput(
                document_id=data.document_id,
                document_version=data.document_version,
                format=data.format,
            )
        document = _require_document(session, self.project_id, data.document_id)
        # "Through the current version" is resolved once, inside the enqueue transaction.
        to_version = data.to_version if data.to_version is not None else document.current_version
        if data.from_version > to_version:
            raise error("RANGE_INVALID", "起始版本不能晚于结束版本。")
        if to_version - data.from_version + 1 > MAX_CHANGE_RECORD_VERSIONS:
            raise error(
                "RANGE_TOO_LARGE", f"一次最多说明 {MAX_CHANGE_RECORD_VERSIONS} 个版本的修改。"
            )
        return ChangeRecordInput(
            document_id=data.document_id,
            from_version=data.from_version,
            to_version=to_version,
            format=data.format,
        )


def _request_digest(project_id: UUID, data: DocumentExportCreate | ChangeRecordCreate) -> str:
    kind = "document_export" if isinstance(data, DocumentExportCreate) else "change_record"
    return stable_digest(
        {"kind": kind, "project_id": str(project_id), "request": data.model_dump(mode="json")}
    )


def create_document_export(
    session: Session, project_id: UUID, data: DocumentExportCreate, idempotency_key: str
) -> ExportRead:
    digest = _request_digest(project_id, data)
    return _submit(session, project_id, idempotency_key, digest, SourceFactory(project_id, data))


def create_change_record(
    session: Session, project_id: UUID, data: ChangeRecordCreate, idempotency_key: str
) -> ExportRead:
    digest = _request_digest(project_id, data)
    return _submit(session, project_id, idempotency_key, digest, SourceFactory(project_id, data))


def fixed_export_input(job: Job) -> tuple[ExportInput, ExportConfiguration]:
    """The server-fixed input; any divergence between snapshot, scope and kind is invalid."""
    model: type[DocumentExportInput] | type[ChangeRecordInput] = (
        DocumentExportInput if job.kind == "document_export" else ChangeRecordInput
    )
    if job.kind not in EXPORT_JOB_KINDS:
        raise ValueError("不是导出任务。")
    source = model.model_validate(job.input_snapshot)
    if job.resource_scope != source.model_dump(mode="json"):
        raise ValueError("导出范围与固定输入不一致。")
    return source, ExportConfiguration.model_validate(job.configuration)


def retry_digest(original: Job) -> str:
    return stable_digest(
        {
            "kind": original.kind,
            "project_id": str(original.project_id),
            "input": original.input_snapshot,
            "source_job_id": str(original.id),
        }
    )


def insert_retry_in_transaction(session: Session, original: Job, idempotency_key: str) -> Job:
    """Called by jobs.retry_job under its row lock. Retry reuses the exact fixed input."""
    digest = retry_digest(original)
    existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
    if existing is not None:
        return _match(existing, digest)
    if original.status not in ("succeeded", "failed", "cancelled"):
        raise AppError("JOB_STATE_CONFLICT", "请等待任务结束或取消后再重新运行。", 409)
    try:
        source, _ = fixed_export_input(original)
    except (ValidationError, ValueError):
        raise AppError("JOB_INPUT_INVALID", "导出任务固定输入无效。", 422) from None
    return _insert(session, original.project_id, source, idempotency_key, digest, original.id)


def _file_read(file: ExportFile | None) -> ExportFileRead | None:
    if file is None:
        return None
    return ExportFileRead(
        id=file.id,
        filename=file.filename,
        content_type=file.content_type,
        sha256=file.sha256,
        byte_size=file.byte_size,
        created_at=file.created_at,
    )


def _read(session: Session, job: Job, file: ExportFile | None = None) -> ExportRead:
    source = cast(dict[str, object], job.input_snapshot or {})
    if file is None and job.status == "succeeded":
        file = session.scalar(select(ExportFile).where(ExportFile.job_id == job.id))
    change = job.kind == "change_record"
    return ExportRead.model_validate(
        {
            "job_id": job.id,
            "project_id": job.project_id,
            "kind": job.kind,
            "status": job.status,
            "attempt": job.attempt,
            "format": source.get("format"),
            "document_id": source.get("document_id"),
            "document_version": source.get("to_version" if change else "document_version"),
            "from_version": source.get("from_version") if change else None,
            "source_job_id": job.source_job_id,
            "error_code": job.error_code,
            "file": _file_read(file),
            "created_at": job.created_at,
            "updated_at": job.updated_at,
        }
    )


def _export_job(session: Session, project_id: UUID, job_id: UUID) -> Job:
    job = session.get(Job, job_id)
    if job is None or job.project_id != project_id or job.kind not in EXPORT_JOB_KINDS:
        raise error("NOT_FOUND", "导出记录不存在。", 404)
    return job


def get_export(session: Session, project_id: UUID, job_id: UUID) -> ExportRead:
    with session.begin():
        return _read(session, _export_job(session, project_id, job_id))


def list_exports(session: Session, project_id: UUID, *, limit: int, offset: int) -> ExportPage:
    with session.begin():
        if session.get(Project, project_id) is None:
            raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
        conditions = (Job.project_id == project_id, Job.kind.in_(sorted(EXPORT_JOB_KINDS)))
        total = session.scalar(select(func.count()).select_from(Job).where(*conditions)) or 0
        rows = session.execute(
            select(Job, ExportFile)
            .outerjoin(ExportFile, ExportFile.job_id == Job.id)
            .where(*conditions)
            .order_by(Job.created_at.desc(), Job.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return ExportPage(
            items=[_read(session, job, file) for job, file in rows],
            total=total,
            limit=limit,
            offset=offset,
        )


def get_export_file(session: Session, project_id: UUID, job_id: UUID) -> tuple[ExportFile, bytes]:
    with session.begin():
        job = _export_job(session, project_id, job_id)
        file = session.scalar(select(ExportFile).where(ExportFile.job_id == job.id))
        if job.status != "succeeded" or file is None:
            raise error("FILE_NOT_READY", "导出尚未完成，暂无可下载文件。", 409)
        data = file.data
        if len(data) != file.byte_size or sha256(data).hexdigest() != file.sha256:
            raise error("FILE_CORRUPT", "导出文件校验失败，请按原输入重新导出。", 409)
        return file, data
