"""Worker side of backups and restores.

Backup: read the whole project in one snapshot transaction, build the package outside any
transaction, then store archive + artifact + terminal state under the same run token.

Restore: re-read and re-validate the stored upload outside a transaction, then insert the new
project, attach the job to it and finish the job in one transaction under the run token. Any
failure rolls the copy back entirely and records a stable error code in a separate transaction.
"""

from datetime import datetime, timedelta
from hashlib import sha256
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.api.health import SCHEMA_REVISION
from thesis_pilot.core.errors import AppError
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
from thesis_pilot.modules.project_backups.contracts import (
    MAX_PACKAGE_BYTES,
    PACKAGE_FORMAT,
    ProjectBackupInput,
    ProjectBackupResult,
    ProjectRestoreInput,
    ProjectRestoreResult,
)
from thesis_pilot.modules.project_backups.models import BackupArchive, ProjectRestore
from thesis_pilot.modules.project_backups.package import read_package, write_package
from thesis_pilot.modules.project_backups.service import backup_filename, fixed_backup_input
from thesis_pilot.modules.project_backups.snapshot import (
    Collected,
    Prepared,
    apply_restore,
    collect_project,
    prepare_restore,
)

BACKUP_FAILURE_CODES = frozenset(
    {
        "BACKUP_PACKAGE_TOO_LARGE",
        "BACKUP_PACKAGE_INVALID",
        "BACKUP_PACKAGE_CORRUPT",
        "BACKUP_PACKAGE_UNSAFE",
        "BACKUP_FORMAT_UNSUPPORTED",
        "BACKUP_SCHEMA_INCOMPATIBLE",
        "BACKUP_REFERENCE_MISSING",
        "BACKUP_PROJECT_MISSING",
        "BACKUP_RESTORE_FAILED",
        "JOB_INPUT_INVALID",
    }
)


def claim_backup_in_transaction(
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
        source = fixed_backup_input(job)
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
    return JobClaim(job.id, job.project_id, token, kind=job.kind, backup_input=source)  # type: ignore[arg-type]


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
            error_code=code if code in BACKUP_FAILURE_CODES else "JOB_EXECUTION_FAILED",
        )
        return True


def _attempt(session: Session, job: Job, claim: JobClaim) -> JobAttempt | None:
    return session.scalar(
        select(JobAttempt).where(
            JobAttempt.job_id == job.id, JobAttempt.run_token == claim.run_token
        )
    )


# ---------------------------------------------------------------- backup


def _collect(factory: sessionmaker[Session], claim: JobClaim, project_id: UUID) -> Collected | None:
    with factory() as session, session.begin():
        if session.get_bind().dialect.name == "postgresql":
            # All tables are read from one consistent snapshot, never a mix of two moments.
            session.connection(
                execution_options={
                    "isolation_level": "REPEATABLE READ",
                    "postgresql_readonly": True,
                }
            )
        job = session.get(Job, claim.job_id)
        if job is None or job.status != "running" or job.run_token != claim.run_token:
            return None
        return collect_project(session, project_id)


def _build(
    collected: Collected, project_id: UUID, now: datetime
) -> tuple[bytes, dict[str, object]]:
    data, manifest = write_package(
        head={
            "schema_head": SCHEMA_REVISION,
            "exported_at": now.isoformat(),
            "generator": "thesispilot-api",
            "project": {"id": str(project_id), "name": collected.project_name},
        },
        data=collected.data,
        refs=collected.refs,
        blobs=collected.blobs,
    )
    if len(data) > MAX_PACKAGE_BYTES:
        raise AppError("BACKUP_PACKAGE_TOO_LARGE", "项目备份超过 256MiB 上限。", 413)
    return data, manifest


def finish_backup_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    data: bytes,
    manifest: dict[str, object],
    counts: dict[str, int],
    project_name: str,
    *,
    now: datetime | None = None,
) -> bool:
    """A cancelled, expired or superseded run returns False and stores nothing."""
    source = claim.backup_input
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, now)
        if execution is None:
            return False
        job, instant, _ = execution
        attempt = _attempt(session, job, claim)
        if (
            not isinstance(source, ProjectBackupInput)
            or attempt is None
            or job.input_snapshot != source.model_dump(mode="json")
            or not 1 <= len(data) <= MAX_PACKAGE_BYTES
        ):
            _end_execution(session, job, instant, status="failed", error_code="JOB_RESULT_INVALID")
            return True
        archive = BackupArchive(
            id=uuid4(),
            project_id=job.project_id,
            job_id=job.id,
            attempt_id=attempt.id,
            format=PACKAGE_FORMAT,
            schema_head=str(manifest["schema_head"]),
            filename=backup_filename(project_name, instant),
            sha256=sha256(data).hexdigest(),
            package_sha256=str(manifest["package_sha256"]),
            byte_size=len(data),
            object_counts=counts,
            data=data,
            created_at=instant,
        )
        session.add(archive)
        result = ProjectBackupResult.model_validate(
            {
                "schema_version": 1,
                "kind": "project_backup",
                "job_id": str(job.id),
                "project_id": str(job.project_id),
                "archive_id": str(archive.id),
                "filename": archive.filename,
                "sha256": archive.sha256,
                "byte_size": archive.byte_size,
                "package_sha256": archive.package_sha256,
                "format": PACKAGE_FORMAT,
                "object_counts": counts,
                "model_used": False,
                "writes_performed": False,
            }
        )
        session.flush()
        session.add(
            JobArtifact(
                job_id=job.id,
                attempt_id=attempt.id,
                kind="project_backup",
                schema_version=1,
                result=result.model_dump(mode="json"),
                created_at=instant,
            )
        )
        _end_execution(session, job, instant, status="succeeded", result=result)
        return True


def _run_backup(
    factory: sessionmaker[Session], claim: JobClaim, source: ProjectBackupInput
) -> bool:
    try:
        collected = _collect(factory, claim, source.project_id)
        if collected is None:
            return False
        with factory() as session:
            instant = _database_now(session, None)
        data, manifest = _build(collected, source.project_id, instant)
    except AppError as failure:
        return _fail(factory, claim, failure.code)
    except Exception:
        return _fail(factory, claim, "JOB_EXECUTION_FAILED")
    return finish_backup_job(
        factory, claim, data, manifest, collected.counts, collected.project_name
    )


# ---------------------------------------------------------------- restore


def _load_upload(
    factory: sessionmaker[Session], claim: JobClaim, source: ProjectRestoreInput
) -> bytes | None:
    with factory() as session, session.begin():
        job = session.get(Job, claim.job_id)
        if job is None or job.status != "running" or job.run_token != claim.run_token:
            return None
        restore = session.get(ProjectRestore, source.restore_id)
        if restore is None or restore.job_id != job.id or restore.result_project_id is not None:
            raise AppError("JOB_INPUT_INVALID", "恢复任务与上传记录不一致。", 422)
        data = restore.data
    if sha256(data).hexdigest() != source.upload_sha256:
        raise AppError("BACKUP_PACKAGE_CORRUPT", "已上传的备份文件校验失败。", 422)
    return data


def finish_restore_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    prepared: Prepared,
    *,
    now: datetime | None = None,
) -> bool:
    """Insert the copy, attach the job and finish it atomically; a stale run writes nothing."""
    source = claim.backup_input
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, now)
        if execution is None:
            return False
        job, instant, _ = execution
        attempt = _attempt(session, job, claim)
        restore = (
            session.get(ProjectRestore, source.restore_id, with_for_update=True)
            if isinstance(source, ProjectRestoreInput)
            else None
        )
        if (
            not isinstance(source, ProjectRestoreInput)
            or attempt is None
            or restore is None
            or restore.job_id != job.id
            or restore.result_project_id is not None
            or job.input_snapshot != source.model_dump(mode="json")
        ):
            _end_execution(session, job, instant, status="failed", error_code="JOB_RESULT_INVALID")
            return True
        outcome = apply_restore(session, prepared, now=instant)
        restore.result_project_id = outcome.project_id
        job.project_id = outcome.project_id
        result = ProjectRestoreResult.model_validate(
            {
                "schema_version": 1,
                "kind": "project_restore",
                "job_id": str(job.id),
                "project_id": str(outcome.project_id),
                "restore_id": str(restore.id),
                "source_project_id": str(outcome.source_project_id),
                "package_sha256": prepared.package.package_sha256,
                "format": PACKAGE_FORMAT,
                "object_counts": outcome.counts,
                "interrupted_jobs": outcome.interrupted_jobs,
                "model_used": False,
                "writes_performed": True,
            }
        )
        session.flush()
        session.add(
            JobArtifact(
                job_id=job.id,
                attempt_id=attempt.id,
                kind="project_restore",
                schema_version=1,
                result=result.model_dump(mode="json"),
                created_at=instant,
            )
        )
        _end_execution(session, job, instant, status="succeeded", result=result)
        return True


def _run_restore(
    factory: sessionmaker[Session], claim: JobClaim, source: ProjectRestoreInput
) -> bool:
    try:
        data = _load_upload(factory, claim, source)
        if data is None:
            return False
        prepared = prepare_restore(read_package(data))
        return finish_restore_job(factory, claim, prepared)
    except AppError as failure:
        return _fail(factory, claim, failure.code)
    except IntegrityError:
        # A constraint the package violates on this instance: nothing was committed.
        return _fail(factory, claim, "BACKUP_RESTORE_FAILED")
    except SQLAlchemyError:
        return _fail(factory, claim, "JOB_EXECUTION_FAILED")
    except Exception:
        return _fail(factory, claim, "BACKUP_RESTORE_FAILED")


def run_backup_job(factory: sessionmaker[Session], claim: JobClaim) -> bool:
    source = claim.backup_input
    if isinstance(source, ProjectBackupInput):
        return _run_backup(factory, claim, source)
    if isinstance(source, ProjectRestoreInput):
        return _run_restore(factory, claim, source)
    return _fail(factory, claim, "JOB_INPUT_INVALID")
