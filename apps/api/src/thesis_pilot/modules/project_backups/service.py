"""Backup requests freeze one project into a Job; restore uploads are validated before storage."""

import json
import re
from datetime import UTC, datetime
from hashlib import sha256
from typing import cast
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.models import Job, OutboxEvent
from thesis_pilot.modules.project_backups.contracts import (
    BACKUP_JOB_KIND,
    BACKUP_JOB_KINDS,
    MAX_PACKAGE_BYTES,
    RESTORE_JOB_KIND,
    BackupConfiguration,
    ProjectBackupInput,
    ProjectRestoreInput,
)
from thesis_pilot.modules.project_backups.models import BackupArchive, ProjectRestore
from thesis_pilot.modules.project_backups.package import read_package
from thesis_pilot.modules.project_backups.schemas import (
    BackupFileRead,
    BackupPage,
    BackupRead,
    RestorePage,
    RestoreRead,
)
from thesis_pilot.modules.project_backups.snapshot import prepare_restore
from thesis_pilot.modules.projects.models import Project

UNSAFE_FILENAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


def error(code: str, message: str, status: int = 422) -> AppError:
    return AppError("BACKUP_" + code, message, status)


def stable_digest(value: object) -> str:
    return sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def safe_filename(value: str, fallback: str) -> str:
    cleaned = UNSAFE_FILENAME.sub("-", value.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]).strip(" .-")
    return (cleaned or fallback)[:200]


def backup_filename(project_name: str, instant: datetime) -> str:
    stamp = instant.astimezone(UTC).strftime("%Y%m%d-%H%M%S")
    stem = safe_filename(project_name, "项目")[:150]
    return f"{stem}-备份-{stamp}.zip"


def _match(job: Job, digest: str) -> Job:
    if job.request_hash != digest:
        raise AppError("JOB_IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求，请使用新键。", 409)
    return job


# ---------------------------------------------------------------- backup


def fixed_backup_input(job: Job) -> ProjectBackupInput | ProjectRestoreInput:
    """The server-fixed input; any divergence between snapshot, scope and kind is invalid."""
    if job.kind not in BACKUP_JOB_KINDS:
        raise ValueError("不是备份任务。")
    model = ProjectBackupInput if job.kind == BACKUP_JOB_KIND else ProjectRestoreInput
    source = model.model_validate(job.input_snapshot)
    if job.resource_scope != source.model_dump(mode="json"):
        raise ValueError("备份范围与固定输入不一致。")
    BackupConfiguration.model_validate(job.configuration)
    if isinstance(source, ProjectBackupInput) and source.project_id != job.project_id:
        raise ValueError("备份项目与任务项目不一致。")
    return source


def _insert_job(
    session: Session,
    project_id: UUID | None,
    source: ProjectBackupInput | ProjectRestoreInput,
    idempotency_key: str,
    digest: str,
    source_job_id: UUID | None = None,
) -> Job:
    fixed = source.model_dump(mode="json")
    job = Job(
        project_id=project_id,
        kind=source.kind,
        idempotency_key=idempotency_key,
        request_hash=digest,
        input_snapshot=fixed,
        resource_scope=dict(fixed),
        configuration=BackupConfiguration().model_dump(mode="json"),
        source_job_id=source_job_id,
    )
    session.add(job)
    session.flush()
    session.add(OutboxEvent(job_id=job.id))
    session.flush()
    return job


def _require_project(session: Session, project_id: UUID) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
    return project


def create_backup(session: Session, project_id: UUID, idempotency_key: str) -> BackupRead:
    digest = stable_digest({"kind": BACKUP_JOB_KIND, "project_id": str(project_id)})
    try:
        with session.begin():
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is not None:
                job = _match(existing, digest)
            else:
                _require_project(session, project_id)
                job = _insert_job(
                    session,
                    project_id,
                    ProjectBackupInput(project_id=project_id),
                    idempotency_key,
                    digest,
                )
            if job.project_id != project_id or job.kind != BACKUP_JOB_KIND:
                raise AppError(
                    "JOB_IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求，请使用新键。", 409
                )
            return _read_backup(session, job)
    except IntegrityError:
        with session.begin():
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is None:
                raise
            return _read_backup(session, _match(existing, digest))


def backup_retry_digest(original: Job) -> str:
    return stable_digest(
        {
            "kind": original.kind,
            "project_id": str(original.project_id),
            "input": original.input_snapshot,
            "source_job_id": str(original.id),
        }
    )


def insert_backup_retry_in_transaction(
    session: Session, original: Job, idempotency_key: str
) -> Job:
    """Called by jobs.retry_job under its row lock. Retry reuses the exact fixed input."""
    digest = backup_retry_digest(original)
    existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
    if existing is not None:
        return _match(existing, digest)
    if original.status not in ("succeeded", "failed", "cancelled"):
        raise AppError("JOB_STATE_CONFLICT", "请等待任务结束或取消后再重新运行。", 409)
    try:
        source = fixed_backup_input(original)
    except (ValidationError, ValueError):
        raise AppError("JOB_INPUT_INVALID", "备份任务固定输入无效。", 422) from None
    if not isinstance(source, ProjectBackupInput):
        raise error("RESTORE_RETRY_REQUIRED", "请重新选择备份文件，建立新的恢复记录。", 409)
    return _insert_job(session, original.project_id, source, idempotency_key, digest, original.id)


def _file_read(archive: BackupArchive | None) -> BackupFileRead | None:
    if archive is None:
        return None
    return BackupFileRead(
        id=archive.id,
        filename=archive.filename,
        sha256=archive.sha256,
        package_sha256=archive.package_sha256,
        byte_size=archive.byte_size,
        schema_head=archive.schema_head,
        object_counts=archive.object_counts,
        created_at=archive.created_at,
    )


def _read_backup(session: Session, job: Job, archive: BackupArchive | None = None) -> BackupRead:
    if archive is None and job.status == "succeeded":
        archive = session.scalar(select(BackupArchive).where(BackupArchive.job_id == job.id))
    return BackupRead.model_validate(
        {
            "job_id": job.id,
            "project_id": job.project_id,
            "status": job.status,
            "attempt": job.attempt,
            "source_job_id": job.source_job_id,
            "error_code": job.error_code,
            "file": _file_read(archive),
            "created_at": job.created_at,
            "updated_at": job.updated_at,
        }
    )


def _backup_job(session: Session, project_id: UUID, job_id: UUID) -> Job:
    job = session.get(Job, job_id)
    if job is None or job.project_id != project_id or job.kind != BACKUP_JOB_KIND:
        raise error("NOT_FOUND", "备份记录不存在。", 404)
    return job


def get_backup(session: Session, project_id: UUID, job_id: UUID) -> BackupRead:
    with session.begin():
        return _read_backup(session, _backup_job(session, project_id, job_id))


def list_backups(session: Session, project_id: UUID, *, limit: int, offset: int) -> BackupPage:
    with session.begin():
        _require_project(session, project_id)
        conditions = (Job.project_id == project_id, Job.kind == BACKUP_JOB_KIND)
        total = session.scalar(select(func.count()).select_from(Job).where(*conditions)) or 0
        rows = session.execute(
            select(Job, BackupArchive)
            .outerjoin(BackupArchive, BackupArchive.job_id == Job.id)
            .where(*conditions)
            .order_by(Job.created_at.desc(), Job.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return BackupPage(
            items=[_read_backup(session, job, archive) for job, archive in rows],
            total=total,
            limit=limit,
            offset=offset,
        )


def get_backup_file(
    session: Session, project_id: UUID, job_id: UUID
) -> tuple[BackupArchive, bytes]:
    with session.begin():
        job = _backup_job(session, project_id, job_id)
        archive = session.scalar(select(BackupArchive).where(BackupArchive.job_id == job.id))
        if job.status != "succeeded" or archive is None:
            raise error("FILE_NOT_READY", "备份尚未完成，暂无可下载文件。", 409)
        data = archive.data
        if len(data) != archive.byte_size or sha256(data).hexdigest() != archive.sha256:
            raise error("FILE_CORRUPT", "备份文件校验失败，请重新生成备份。", 409)
        return archive, data


# ---------------------------------------------------------------- restore


def _read_restore(job: Job, restore: ProjectRestore) -> RestoreRead:
    return RestoreRead.model_validate(
        {
            "job_id": job.id,
            "restore_id": restore.id,
            "status": job.status,
            "attempt": job.attempt,
            "error_code": job.error_code,
            "filename": restore.filename,
            "sha256": restore.sha256,
            "byte_size": restore.byte_size,
            "package_sha256": restore.package_sha256,
            "source_project_id": restore.source_project_id,
            "source_project_name": restore.source_project_name,
            "schema_head": restore.schema_head,
            "exported_at": restore.exported_at,
            "object_counts": restore.object_counts,
            "result_project_id": restore.result_project_id,
            "created_at": restore.created_at,
            "updated_at": job.updated_at,
        }
    )


def upload_restore(
    session: Session, data: bytes, filename: str, idempotency_key: str
) -> RestoreRead:
    """Validate the whole package (no database writes on rejection), then store and enqueue."""
    if not 1 <= len(data) <= MAX_PACKAGE_BYTES:
        raise error("PACKAGE_TOO_LARGE", "备份文件超过 256MiB 上限或为空。", 413)
    digest = sha256(data).hexdigest()
    with session.begin():
        existing = session.scalar(
            select(ProjectRestore).where(ProjectRestore.upload_key == idempotency_key)
        )
        if existing is not None:
            if existing.sha256 != digest:
                raise AppError(
                    "JOB_IDEMPOTENCY_CONFLICT", "幂等键已用于不同文件，请使用新键。", 409
                )
            return _read_restore(cast(Job, session.get(Job, existing.job_id)), existing)
    package = read_package(data)
    prepared = prepare_restore(package)
    project = cast(dict[str, object], package.manifest["project"])
    try:
        exported_at = datetime.fromisoformat(cast(str, package.manifest["exported_at"]))
    except ValueError:
        raise error("PACKAGE_INVALID", "备份清单的导出时间无效。") from None
    restore_id = uuid4()
    try:
        with session.begin():
            job = _insert_job(
                session,
                None,
                ProjectRestoreInput(restore_id=restore_id, upload_sha256=digest),
                f"{RESTORE_JOB_KIND}:{restore_id}",
                digest,
            )
            restore = ProjectRestore(
                id=restore_id,
                job_id=job.id,
                upload_key=idempotency_key,
                filename=safe_filename(filename, "项目备份.zip"),
                sha256=digest,
                byte_size=len(data),
                package_sha256=prepared.package.package_sha256,
                source_project_id=prepared.source_project_id,
                source_project_name=str(project.get("name") or "")[:200],
                schema_head=cast(str, package.manifest["schema_head"])[:64],
                exported_at=exported_at if exported_at.tzinfo else exported_at.replace(tzinfo=UTC),
                object_counts=prepared.counts,
                data=data,
                created_at=job.created_at,
            )
            session.add(restore)
            session.flush()
            return _read_restore(job, restore)
    except IntegrityError:
        # A concurrent upload with the same key committed first.
        with session.begin():
            existing = session.scalar(
                select(ProjectRestore).where(ProjectRestore.upload_key == idempotency_key)
            )
            if existing is None:
                raise
            if existing.sha256 != digest:
                raise AppError(
                    "JOB_IDEMPOTENCY_CONFLICT", "幂等键已用于不同文件，请使用新键。", 409
                ) from None
            return _read_restore(cast(Job, session.get(Job, existing.job_id)), existing)


def _restore_job(session: Session, job_id: UUID) -> tuple[Job, ProjectRestore]:
    restore = session.scalar(select(ProjectRestore).where(ProjectRestore.job_id == job_id))
    job = session.get(Job, job_id)
    if restore is None or job is None or job.kind != RESTORE_JOB_KIND:
        raise error("NOT_FOUND", "恢复记录不存在。", 404)
    return job, restore


def get_restore(session: Session, job_id: UUID) -> RestoreRead:
    with session.begin():
        return _read_restore(*_restore_job(session, job_id))


def list_restores(session: Session, *, limit: int, offset: int) -> RestorePage:
    with session.begin():
        total = session.scalar(select(func.count()).select_from(ProjectRestore)) or 0
        rows = session.execute(
            select(Job, ProjectRestore)
            .join(ProjectRestore, ProjectRestore.job_id == Job.id)
            .order_by(ProjectRestore.created_at.desc(), ProjectRestore.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return RestorePage(
            items=[_read_restore(job, restore) for job, restore in rows],
            total=total,
            limit=limit,
            offset=offset,
        )


def cancel_restore(session: Session, job_id: UUID) -> RestoreRead:
    from thesis_pilot.modules.jobs.service import _cancel_in_transaction

    with session.begin():
        job, restore = _restore_job(session, job_id)
        if job.status not in {"queued", "running", "cancelled"}:
            raise AppError("JOB_STATE_CONFLICT", "恢复已经结束，不能取消。", 409)
        job = _cancel_in_transaction(session, job_id, project_id=job.project_id)
        return _read_restore(job, restore)
