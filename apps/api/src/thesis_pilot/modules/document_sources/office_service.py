"""DOCX import through office-server: enqueue, preview read, confirm and source lookup.

The job pins one immutable material original (id + SHA-256). The worker stores an
immutable preview (``office_imports``); the manuscript changes only when the student
confirms, either as the project's first manuscript or as a CAS-checked new version.
"""

import json
from hashlib import sha256
from typing import cast
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources.models import DocumentSource
from thesis_pilot.modules.document_sources.office_contracts import (
    OFFICE_IMPORT_KIND,
    OfficeImportInput,
)
from thesis_pilot.modules.document_sources.office_models import (
    DocumentOfficeSource,
    OfficeImport,
)
from thesis_pilot.modules.document_sources.office_schemas import (
    DocumentOfficeSourceRead,
    ImportMode,
    OfficeImportChapter,
    OfficeImportConfirm,
    OfficeImportCreate,
    OfficeImportLoss,
    OfficeImportObject,
    OfficeImportPage,
    OfficeImportPreview,
    OfficeImportRead,
    OfficeImportReceipt,
)
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentContentV2
from thesis_pilot.modules.documents.service import (
    append_document_version,
    create_document_in_transaction,
)
from thesis_pilot.modules.jobs.models import Job, OutboxEvent
from thesis_pilot.modules.materials.models import MaterialOriginal
from thesis_pilot.modules.materials.service import _original
from thesis_pilot.modules.projects.models import Project


def error(code: str, message: str, status: int = 409) -> AppError:
    return AppError("OFFICE_IMPORT_" + code, message, status)


def stable_digest(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256(raw.encode()).hexdigest()


def _require_project(session: Session, project_id: UUID) -> None:
    if session.get(Project, project_id) is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)


def _match(job: Job, digest: str) -> Job:
    if job.request_hash != digest or job.kind != OFFICE_IMPORT_KIND:
        raise AppError("JOB_IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求，请使用新键。", 409)
    return job


def _fixed_input(session: Session, project_id: UUID, data: OfficeImportCreate) -> OfficeImportInput:
    original = _original(session, project_id, data.material_id, data.original_id)
    if original.file_type != "docx":
        raise error("UNSUPPORTED_TYPE", "只能导入 Word 原件（.docx）。", 422)
    return OfficeImportInput(
        material_id=data.material_id, original_id=data.original_id, original_sha256=original.sha256
    )


def _insert(
    session: Session,
    project_id: UUID,
    source: OfficeImportInput,
    key: str,
    digest: str,
    source_job_id: UUID | None = None,
) -> Job:
    fixed = source.model_dump(mode="json")
    job = Job(
        project_id=project_id,
        kind=OFFICE_IMPORT_KIND,
        idempotency_key=key,
        request_hash=digest,
        input_snapshot=fixed,
        resource_scope=dict(fixed),
        configuration=None,
        source_job_id=source_job_id,
    )
    session.add(job)
    session.flush()
    session.add(OutboxEvent(job_id=job.id))
    session.flush()
    return job


def create_import(
    session: Session, project_id: UUID, data: OfficeImportCreate, key: str
) -> OfficeImportRead:
    digest = stable_digest(
        {"kind": OFFICE_IMPORT_KIND, "project_id": str(project_id), **data.model_dump(mode="json")}
    )
    try:
        with session.begin():
            _require_project(session, project_id)
            existing = session.scalar(select(Job).where(Job.idempotency_key == key))
            if existing is not None:
                job = _match(existing, digest)
            else:
                job = _insert(
                    session, project_id, _fixed_input(session, project_id, data), key, digest
                )
            if job.project_id != project_id:
                raise AppError(
                    "JOB_IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求，请使用新键。", 409
                )
            return _read(session, job)
    except IntegrityError:
        with session.begin():
            existing = session.scalar(select(Job).where(Job.idempotency_key == key))
            if existing is None:
                raise
            return _read(session, _match(existing, digest))


def fixed_import_input(job: Job) -> OfficeImportInput:
    if job.kind != OFFICE_IMPORT_KIND:
        raise ValueError("不是原件导入任务。")
    source = OfficeImportInput.model_validate(job.input_snapshot)
    if job.resource_scope != source.model_dump(mode="json"):
        raise ValueError("导入范围与固定输入不一致。")
    return source


def retry_digest(original: Job) -> str:
    return stable_digest(
        {
            "kind": original.kind,
            "project_id": str(original.project_id),
            "input": original.input_snapshot,
            "source_job_id": str(original.id),
        }
    )


def insert_retry_in_transaction(session: Session, original: Job, key: str) -> Job:
    """Called by jobs.retry_job under its row lock; retry reuses the exact pinned original."""
    digest = retry_digest(original)
    existing = session.scalar(select(Job).where(Job.idempotency_key == key))
    if existing is not None:
        return _match(existing, digest)
    if original.status not in ("succeeded", "failed", "cancelled"):
        raise AppError("JOB_STATE_CONFLICT", "请等待任务结束或取消后再重新运行。", 409)
    try:
        source = fixed_import_input(original)
    except (ValidationError, ValueError):
        raise AppError("JOB_INPUT_INVALID", "原件导入任务固定输入无效。", 422) from None
    return _insert(session, original.project_id, source, key, digest, original.id)


# ---- reads ----


def _append_block(session: Session, document: Document) -> str | None:
    version = session.get(DocumentVersion, (document.id, document.current_version))
    if version is None or version.schema_version != 2:
        return "当前正文仍是旧版结构，请先在写作页升级正文结构，再作为新版本导入。"
    if session.scalar(select(DocumentSource.id).where(DocumentSource.document_id == document.id)):
        return "当前正文来自旧版原件导入并受来源保护，不能整体替换。"
    return None


def _preview(session: Session, row: OfficeImport) -> OfficeImportPreview:
    summary = row.summary
    document = session.scalar(select(Document).where(Document.project_id == row.project_id))
    blocked = _append_block(session, document) if document is not None else None
    return OfficeImportPreview(
        import_id=row.id,
        filename=row.filename,
        original_sha256=row.original_sha256,
        converter=row.converter,
        block_count=cast(int, summary["block_count"]),
        paragraph_count=cast(int, summary["paragraph_count"]),
        table_count=cast(int, summary["table_count"]),
        image_count=cast(int, summary["image_count"]),
        text_characters=cast(int, summary["text_characters"]),
        chapters=[
            OfficeImportChapter.model_validate(item)
            for item in cast(list[dict[str, object]], summary["chapters"])
        ],
        chapters_truncated=bool(summary.get("chapters_truncated")),
        objects=[
            OfficeImportObject.model_validate(item)
            for item in cast(list[dict[str, object]], summary["objects"])
        ],
        losses=[OfficeImportLoss.model_validate(item) for item in row.losses],
        existing_document_id=document.id if document is not None else None,
        existing_version=document.current_version if document is not None else None,
        can_create=document is None,
        can_append=document is not None and blocked is None,
        append_blocked_reason=blocked,
    )


def _read(session: Session, job: Job, row: OfficeImport | None = None) -> OfficeImportRead:
    source = cast(dict[str, object], job.input_snapshot or {})
    if row is None and job.status == "succeeded":
        row = session.scalar(select(OfficeImport).where(OfficeImport.job_id == job.id))
    return OfficeImportRead.model_validate(
        {
            "job_id": job.id,
            "project_id": job.project_id,
            "status": job.status,
            "attempt": job.attempt,
            "material_id": source.get("material_id"),
            "original_id": source.get("original_id"),
            "original_sha256": source.get("original_sha256"),
            "source_job_id": job.source_job_id,
            "error_code": job.error_code,
            "preview": _preview(session, row) if row is not None else None,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
        }
    )


def import_job(session: Session, project_id: UUID, job_id: UUID) -> Job:
    job = session.get(Job, job_id)
    if job is None or job.project_id != project_id or job.kind != OFFICE_IMPORT_KIND:
        raise error("NOT_FOUND", "原件导入记录不存在。", 404)
    return job


def get_import(session: Session, project_id: UUID, job_id: UUID) -> OfficeImportRead:
    with session.begin():
        return _read(session, import_job(session, project_id, job_id))


def list_imports(
    session: Session, project_id: UUID, *, limit: int, offset: int
) -> OfficeImportPage:
    with session.begin():
        _require_project(session, project_id)
        conditions = (Job.project_id == project_id, Job.kind == OFFICE_IMPORT_KIND)
        total = session.scalar(select(func.count()).select_from(Job).where(*conditions)) or 0
        rows = session.execute(
            select(Job, OfficeImport)
            .outerjoin(OfficeImport, OfficeImport.job_id == Job.id)
            .where(*conditions)
            .order_by(Job.created_at.desc(), Job.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return OfficeImportPage(
            items=[_read(session, job, row) for job, row in rows],
            total=total,
            limit=limit,
            offset=offset,
        )


# ---- confirm ----


def _receipt(link: DocumentOfficeSource) -> OfficeImportReceipt:
    return OfficeImportReceipt(
        command_id=link.command_id,
        import_id=link.import_id,
        document_id=link.document_id,
        document_version=link.document_version,
        mode=cast(ImportMode, link.mode),
    )


def _confirm_digest(project_id: UUID, job_id: UUID, data: OfficeImportConfirm) -> str:
    return stable_digest(
        {
            "project_id": str(project_id),
            "job_id": str(job_id),
            "mode": data.mode,
            "expected_version": data.expected_version,
        }
    )


def _replay(
    session: Session, project_id: UUID, command_id: UUID, digest: str
) -> OfficeImportReceipt | None:
    link = session.scalar(
        select(DocumentOfficeSource).where(DocumentOfficeSource.command_id == command_id)
    )
    if link is None:
        return None
    document = session.get(Document, link.document_id)
    if document is None or document.project_id != project_id or link.request_hash != digest:
        raise error("COMMAND_CONFLICT", "导入确认命令已用于不同请求。")
    return _receipt(link)


def confirm_import(
    session: Session, project_id: UUID, job_id: UUID, data: OfficeImportConfirm
) -> OfficeImportReceipt:
    data = OfficeImportConfirm.model_validate(data.model_dump(mode="json"))
    digest = _confirm_digest(project_id, job_id, data)
    try:
        with session.begin():
            replay = _replay(session, project_id, data.command_id, digest)
            if replay is not None:
                return replay
            project = session.scalar(
                select(Project).where(Project.id == project_id).with_for_update()
            )
            if project is None:
                raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
            replay = _replay(session, project_id, data.command_id, digest)
            if replay is not None:
                return replay
            job = import_job(session, project_id, job_id)
            row = session.scalar(select(OfficeImport).where(OfficeImport.job_id == job.id))
            if job.status != "succeeded" or row is None:
                raise error("NOT_READY", "导入预览尚未生成，不能确认导入。")
            original = session.get(MaterialOriginal, row.original_id)
            if original is None or original.sha256 != row.original_sha256:
                raise error("ORIGINAL_CHANGED", "原件与导入预览不一致，请重新导入。")
            content = DocumentContentV2.model_validate({"schema_version": 2, "json": row.snapshot})
            document = session.scalar(select(Document).where(Document.project_id == project_id))
            if data.mode == "create":
                if document is not None:
                    raise AppError(
                        "DOCUMENT_ALREADY_EXISTS",
                        "项目已有正式稿，不能新建；可改为作为新版本导入。",
                        409,
                    )
                created = create_document_in_transaction(
                    session, project_id, content, "office_import", server_built=True
                )
                document_id, version = created.id, created.version
            else:
                if document is None:
                    raise AppError("DOCUMENT_NOT_FOUND", "项目还没有正式稿，请新建导入。", 404)
                blocked = _append_block(session, document)
                if blocked is not None:
                    raise error("APPEND_BLOCKED", blocked)
                appended = append_document_version(
                    session,
                    project_id,
                    document.id,
                    cast(int, data.expected_version),
                    content,
                    "office_import",
                )
                document_id, version = appended.id, appended.version
            link = DocumentOfficeSource(
                document_id=document_id,
                document_version=version,
                import_id=row.id,
                mode=data.mode,
                command_id=data.command_id,
                request_hash=digest,
            )
            session.add(link)
            session.flush()
            return _receipt(link)
    except IntegrityError as failure:
        with session.begin():
            replay = _replay(session, project_id, data.command_id, digest)
            if replay is not None:
                return replay
        diagnostic = getattr(failure.orig, "diag", None)
        constraint = getattr(diagnostic, "constraint_name", None)
        if (
            constraint == "uq_documents_project_id"
            or str(failure.orig) == "UNIQUE constraint failed: documents.project_id"
        ):
            raise AppError(
                "DOCUMENT_ALREADY_EXISTS", "项目已有正式稿，不能新建；可改为作为新版本导入。", 409
            ) from None
        raise


# ---- source lookup (writing page, exports) ----


def baseline_for(
    session: Session, document_id: UUID, version: int
) -> tuple[DocumentOfficeSource, OfficeImport] | None:
    """The latest office import at or before ``version``; a later whole import resets it."""
    link = session.scalar(
        select(DocumentOfficeSource)
        .where(
            DocumentOfficeSource.document_id == document_id,
            DocumentOfficeSource.document_version <= version,
        )
        .order_by(DocumentOfficeSource.document_version.desc())
        .limit(1)
    )
    if link is None:
        return None
    row = session.get(OfficeImport, link.import_id)
    if row is None:
        raise error("SOURCE_INVALID", "正文的原件导入记录缺失。")
    return link, row


def get_office_source(
    session: Session, project_id: UUID, document_id: UUID, version: int | None
) -> DocumentOfficeSourceRead:
    with session.begin():
        document = session.scalar(
            select(Document).where(Document.id == document_id, Document.project_id == project_id)
        )
        if document is None:
            raise AppError("DOCUMENT_NOT_FOUND", "项目中没有该正文。", 404)
        number = document.current_version if version is None else version
        if session.get(DocumentVersion, (document_id, number)) is None:
            raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正文版本不存在。", 404)
        found = baseline_for(session, document_id, number)
        if found is None:
            raise error("SOURCE_NOT_FOUND", "该正文版本没有可保留的 Word 原件。", 404)
        link, row = found
        return DocumentOfficeSourceRead(
            document_id=document_id,
            document_version=link.document_version,
            import_id=row.id,
            material_id=row.material_id,
            original_id=row.original_id,
            original_sha256=row.original_sha256,
            filename=row.filename,
            imported_at=link.created_at,
        )
