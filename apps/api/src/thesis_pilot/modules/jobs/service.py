"""Database truth for jobs; no model or message broker owns job state."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import TYPE_CHECKING, Literal
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy import String, and_, cast, func, or_, select, true, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased, joinedload, sessionmaker

from thesis_pilot.core.config import DEFAULT_WORKER_EXECUTION_TIMEOUT_SECONDS
from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.structure import JsonObject
from thesis_pilot.modules.exports.contracts import (
    EXPORT_JOB_KINDS,
    ChangeRecordInput,
    ChangeRecordResult,
    DocumentExportInput,
    DocumentExportResult,
)
from thesis_pilot.modules.jobs.models import Job, JobArtifact, JobAttempt, OutboxEvent, utcnow
from thesis_pilot.modules.jobs.schemas import (
    ConfigurationProbeConfiguration,
    ConfigurationProbeInput,
    ConfigurationProbeResult,
    ConfigurationProbeScope,
    ContentRevisionInput,
    ContentRevisionResult,
    DiagnosticResult,
    InspectionConfiguration,
    InspectionInput,
    InspectionResult,
    JobCreate,
    JobKind,
    JobPage,
    JobRead,
    JobStatus,
    MaterialParseConfiguration,
    MaterialParseInput,
    MaterialParseResult,
)
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.parsers.schemas import ParsedMaterial
from thesis_pilot.providers.deepseek import MODEL_ERROR_CODES
from thesis_pilot.workflows.content_revision import ContentRevisionCompletion

if TYPE_CHECKING:
    from thesis_pilot.modules.assistant_sessions.models import AssistantRun

Publisher = Callable[[UUID], None]
MAX_JOB_ATTEMPTS = 3
MATERIAL_ERROR_CODES = frozenset(
    {
        "MATERIAL_UNSUPPORTED_TYPE",
        "MATERIAL_PARSE_INVALID",
        "MATERIAL_PARSE_LIMIT_EXCEEDED",
        "MATERIAL_ORIGINAL_CORRUPT",
        "MATERIAL_PARSER_VERSION_UNAVAILABLE",
        "MATERIAL_PARSE_CONFLICT",
        "MATERIAL_NOT_FOUND",
        "MATERIAL_ORIGINAL_NOT_FOUND",
        "JOB_INPUT_INVALID",
    }
)


def _match_request(job: Job, request_hash: str) -> Job:
    if job.request_hash != request_hash:
        raise AppError("JOB_IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求，请使用新键。", 409)
    return job


def _request_digest(request: JobCreate, source_job_id: UUID | None = None) -> str:
    if request.kind == "diagnostic" and source_job_id is None:
        # Keep previously persisted idempotency keys valid across this upgrade.
        return sha256(f"{request.kind}:{request.project_id}".encode()).hexdigest()
    payload = request.model_dump(mode="json")
    payload["source_job_id"] = str(source_job_id) if source_job_id else None
    return sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _document_version(
    session: Session, project_id: UUID, source: InspectionInput
) -> DocumentVersion:
    document = session.get(Document, source.document_id)
    if document is None or document.project_id != project_id:
        raise AppError("DOCUMENT_NOT_FOUND", "项目中没有指定正式稿。", 404)
    version = session.get(DocumentVersion, (source.document_id, source.document_version))
    if version is None:
        raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正式稿版本不存在。", 404)
    return version


def _insert_job(
    session: Session,
    request: JobCreate,
    idempotency_key: str,
    digest: str,
    source_job_id: UUID | None = None,
    frozen_configuration: ConfigurationProbeConfiguration | None = None,
    material_configuration: MaterialParseConfiguration | None = None,
) -> Job:
    if session.get(Project, request.project_id) is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
    source = request.input_snapshot
    if isinstance(source, MaterialParseInput) and material_configuration is None:
        raise AppError("JOB_INPUT_INVALID", "资料解析缺少服务器固定配置。", 422)
    if isinstance(source, InspectionInput):
        document_id = session.scalar(
            select(Document.id).where(
                Document.id == source.document_id, Document.project_id == request.project_id
            )
        )
        if document_id is None:
            raise AppError("DOCUMENT_NOT_FOUND", "项目中没有指定正式稿。", 404)
        version = session.scalar(
            select(DocumentVersion.version).where(
                DocumentVersion.document_id == source.document_id,
                DocumentVersion.version == source.document_version,
            )
        )
        if version is None:
            raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正式稿版本不存在。", 404)
    probe_configuration = frozen_configuration
    if isinstance(source, ConfigurationProbeInput):
        if probe_configuration is None:
            from thesis_pilot.modules.ai_configs.service import freeze_config_version_chain

            probe_configuration = ConfigurationProbeConfiguration.model_validate(
                freeze_config_version_chain(session, source.config_version_id)
            )
        if probe_configuration.config_version_id != source.config_version_id:
            raise AppError("JOB_INPUT_INVALID", "固定配置与输入版本不一致。", 422)
        if probe_configuration.config_kind != "api":
            from thesis_pilot.modules.ai_configs.service import render_prompt

            render_prompt(
                probe_configuration.model_dump(mode="json", exclude_none=True), source.variables
            )
    scope = (
        ConfigurationProbeScope(
            config_version_id=probe_configuration.config_version_id,
            version_ids=probe_configuration.version_ids,
        ).model_dump(mode="json")
        if probe_configuration
        else source.model_dump(mode="json")
        if source
        else None
    )
    job = Job(
        project_id=request.project_id,
        kind=request.kind,
        idempotency_key=idempotency_key,
        request_hash=digest,
        input_snapshot=source.model_dump(mode="json") if source else None,
        configuration=material_configuration.model_dump(mode="json")
        if material_configuration
        else probe_configuration.model_dump(mode="json", exclude_none=True)
        if probe_configuration
        else request.configuration.model_dump(mode="json")
        if request.configuration
        else None,
        resource_scope=scope,
        source_job_id=source_job_id,
    )
    session.add(job)
    session.flush()
    session.add(OutboxEvent(job_id=job.id))
    session.flush()
    return job


def enqueue_material_parse(
    session: Session,
    project_id: UUID,
    material_id: UUID,
    original_version_id: UUID,
    sha256: str,
    expected_parse_id: UUID | None,
    idempotency_key: str,
    source_job_id: UUID | None = None,
) -> Job:
    """Caller owns the upload/reparse transaction, including original bytes and outbox."""
    from thesis_pilot.modules.materials.service import load_material_parse_source

    request = JobCreate(
        project_id=project_id,
        kind="material_parse",
        input_snapshot=MaterialParseInput(
            material_id=material_id,
            original_version_id=original_version_id,
            original_sha256=sha256,
            expected_parse_id=expected_parse_id,
        ),
    )
    digest = _request_digest(request, source_job_id)
    existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
    if existing is not None:
        return _match_request(existing, digest)
    source = load_material_parse_source(
        session, project_id, material_id, original_version_id, for_update=True
    )
    if source["sha256"] != sha256:
        raise AppError("MATERIAL_ORIGINAL_CORRUPT", "原件摘要与固定来源不一致。", 422)
    if source["expected_parse_id"] != expected_parse_id:
        raise AppError("MATERIAL_PARSE_CONFLICT", "解析版本已变化，请重新读取后再解析。", 409)
    config = MaterialParseConfiguration.model_validate({"file_type": source["file_type"]})
    return _insert_job(
        session, request, idempotency_key, digest, source_job_id, material_configuration=config
    )


def _content_digest(run: "AssistantRun", source_job_id: UUID | None) -> str:
    return sha256(
        json.dumps(
            {
                "kind": "content_revision",
                "project_id": str(run.project_id),
                "run_id": str(run.id),
                "source_job_id": str(source_job_id) if source_job_id else None,
                "input_snapshot": run.input_snapshot,
                "context_snapshot": run.context_snapshot,
                "configuration_snapshot": run.configuration_snapshot,
            },
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
    ).hexdigest()


def enqueue_content_revision(
    session: Session,
    project_id: UUID,
    run_id: UUID,
    idempotency_key: str,
    source_job_id: UUID | None = None,
) -> Job:
    from thesis_pilot.modules.assistant_sessions.models import AssistantRun

    if not session.in_transaction():
        raise RuntimeError("Content revision enqueue requires the caller's transaction")
    run = session.get(AssistantRun, run_id)
    if run is None or run.project_id != project_id or run.purpose != "content_revision":
        raise AppError("JOB_INPUT_INVALID", "助手运行不属于指定项目。", 422)
    digest = _content_digest(run, source_job_id)
    existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
    if existing is not None:
        return _match_request(existing, digest)
    if run.job_id is not None:
        raise AppError("JOB_INPUT_INVALID", "助手运行已经关联执行任务。", 409)
    source = ContentRevisionInput(run_id=run_id).model_dump(mode="json")
    job = Job(
        project_id=project_id,
        kind="content_revision",
        idempotency_key=idempotency_key,
        request_hash=digest,
        input_snapshot=source,
        resource_scope=source.copy(),
        configuration=None,
        source_job_id=source_job_id,
    )
    session.add(job)
    session.flush()
    session.add(OutboxEvent(job_id=job.id))
    session.flush()
    return job


def _content_run(session: Session, job: Job) -> "AssistantRun":
    from thesis_pilot.modules.assistant_sessions.models import AssistantRun

    try:
        source = ContentRevisionInput.model_validate(job.input_snapshot)
    except ValidationError:
        raise AppError("JOB_INPUT_INVALID", "助手任务固定输入无效。", 422) from None
    run = session.get(AssistantRun, source.run_id)
    if (
        job.kind != "content_revision"
        or run is None
        or run.project_id != job.project_id
        or run.job_id != job.id
        or run.purpose != "content_revision"
        or job.configuration is not None
        or job.resource_scope != source.model_dump(mode="json")
        or job.request_hash != _content_digest(run, job.source_job_id)
    ):
        raise AppError("JOB_INPUT_INVALID", "助手任务与固定运行不一致。", 422)
    return run


def _end_content_run(session: Session, job: Job, error_code: str | None) -> None:
    if job.kind != "content_revision":
        return
    from thesis_pilot.modules.assistant_sessions.models import AssistantRun
    from thesis_pilot.modules.assistant_sessions.service import end_run_in_transaction

    # Resolve by the server link even if a corrupt job input cannot be decoded.
    run = session.scalar(select(AssistantRun).where(AssistantRun.job_id == job.id))
    if run is not None and run.project_id == job.project_id:
        end_run_in_transaction(session, job.project_id, run.id, job.id, error_code)


def create_job(
    session: Session, request: JobCreate, idempotency_key: str, *, include_diagnostic: bool = True
) -> Job:
    if request.kind == "content_revision":
        raise AppError("JOB_KIND_UNAVAILABLE", "请通过助手会话发起内容修订。", 422)
    if request.kind == "material_parse":
        raise AppError("JOB_KIND_UNAVAILABLE", "请从资料上传或重新解析入口创建资料解析任务。", 422)
    if request.kind in EXPORT_JOB_KINDS:
        raise AppError("JOB_KIND_UNAVAILABLE", "请从导出入口创建导出任务。", 422)
    if not include_diagnostic and request.kind == "diagnostic":
        raise AppError("JOB_KIND_UNAVAILABLE", "此任务类型不在正式工作区提供。", 422)
    digest = _request_digest(request)
    try:
        with session.begin():
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is not None:
                return _match_request(existing, digest)
            job = _insert_job(session, request, idempotency_key, digest)
        return job
    except IntegrityError:
        # A concurrent request may have committed the same key after our first read.
        with session.begin():
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is not None:
                return _match_request(existing, digest)
        raise


def list_jobs(
    session: Session,
    project_id: UUID,
    *,
    limit: int,
    offset: int,
    statuses: list[JobStatus] | None = None,
    kind: JobKind | None = None,
    include_diagnostic: bool = True,
) -> JobPage:
    with session.begin():
        if session.get(Project, project_id) is None:
            raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
        conditions = [Job.project_id == project_id]
        if not include_diagnostic:
            conditions.append(Job.kind != "diagnostic")
        if kind is not None:
            conditions.append(Job.kind == kind)
        if statuses:
            conditions.append(Job.status.in_(set(statuses)))
        totals = (
            select(func.count().label("total")).select_from(Job).where(*conditions).cte("totals")
        )
        page = (
            select(Job)
            .where(*conditions)
            .order_by(Job.created_at.desc(), Job.id.desc())
            .limit(limit)
            .offset(offset)
        ).subquery("page")
        page_job = aliased(Job, page)
        rows = session.execute(
            select(totals.c.total, page_job)
            .select_from(totals.outerjoin(page, true()))
            .order_by(page_job.created_at.desc(), page_job.id.desc())
        ).all()
        return JobPage(
            items=[JobRead.model_validate(row[1]) for row in rows if row[1] is not None],
            total=rows[0][0],
            limit=limit,
            offset=offset,
        )


def get_job(
    session: Session,
    job_id: UUID,
    *,
    include_diagnostic: bool = True,
    project_id: UUID | None = None,
) -> Job:
    job = session.get(Job, job_id)
    if (
        job is None
        or (not include_diagnostic and job.kind == "diagnostic")
        or (project_id is not None and job.project_id != project_id)
    ):
        raise AppError("JOB_NOT_FOUND", "任务不存在。", 404)
    return job


def get_job_detail(
    session: Session,
    job_id: UUID,
    *,
    include_diagnostic: bool = True,
    project_id: UUID | None = None,
) -> Job:
    conditions = [Job.id == job_id]
    if not include_diagnostic:
        conditions.append(Job.kind != "diagnostic")
    if project_id is not None:
        conditions.append(Job.project_id == project_id)
    job = (
        session.execute(
            select(Job)
            .options(joinedload(Job.attempts), joinedload(Job.artifacts))
            .where(*conditions)
        )
        .unique()
        .scalar_one_or_none()
    )
    if job is None:
        raise AppError("JOB_NOT_FOUND", "任务不存在。", 404)
    return job


def cancel_job(
    session: Session,
    job_id: UUID,
    *,
    include_diagnostic: bool = True,
    project_id: UUID | None = None,
) -> Job:
    with session.begin():
        return _cancel_in_transaction(
            session, job_id, include_diagnostic=include_diagnostic, project_id=project_id
        )


def _cancel_in_transaction(
    session: Session,
    job_id: UUID,
    *,
    include_diagnostic: bool = True,
    project_id: UUID | None = None,
) -> Job:
    job = _lock_job(session, job_id)
    if (
        job is None
        or (project_id is not None and job.project_id != project_id)
        or (not include_diagnostic and job.kind == "diagnostic")
    ):
        raise AppError("JOB_NOT_FOUND", "任务不存在。", 404)
    if job.status not in {"queued", "running", "cancelled"}:
        raise AppError("JOB_STATE_CONFLICT", "任务已经结束，不能取消。", 409)
    instant = utcnow()
    job.status = "cancelled"
    job.run_token = job.lease_until = job.execution_deadline_at = None
    job.updated_at = instant
    session.execute(
        update(JobAttempt)
        .where(JobAttempt.job_id == job.id, JobAttempt.status == "running")
        .values(status="cancelled", finished_at=instant)
    )
    session.flush()
    _end_content_run(session, job, None)
    return job


def cancel_content_revision_in_transaction(session: Session, project_id: UUID, job_id: UUID) -> Job:
    if not session.in_transaction():
        raise RuntimeError("Content revision cancellation requires the caller's transaction")
    job = _lock_job(session, job_id)
    if job is None or job.project_id != project_id or job.kind != "content_revision":
        raise AppError("JOB_NOT_FOUND", "助手执行任务不存在。", 404)
    return _cancel_in_transaction(session, job_id, project_id=project_id)


def retry_job(
    session: Session,
    job_id: UUID,
    idempotency_key: str,
    *,
    include_diagnostic: bool = True,
    project_id: UUID | None = None,
) -> Job:
    digest = ""
    try:
        with session.begin():
            original = _lock_job(session, job_id)
            if (
                original is None
                or (not include_diagnostic and original.kind == "diagnostic")
                or (project_id is not None and original.project_id != project_id)
            ):
                raise AppError("JOB_NOT_FOUND", "任务不存在。", 404)
            if original.kind == "content_revision":
                raise AppError(
                    "ASSISTANT_RUN_RETRY_REQUIRED",
                    "请从助手会话重新运行，建立新的固定运行与任务。",
                    409,
                )
            if original.kind in EXPORT_JOB_KINDS:
                # Exports retry with the exact frozen input and digest of the original job.
                from thesis_pilot.modules.exports.service import (
                    insert_retry_in_transaction,
                    retry_digest,
                )

                digest = retry_digest(original)
                return insert_retry_in_transaction(session, original, idempotency_key)
            request = JobCreate.model_validate(
                {
                    "project_id": original.project_id,
                    "kind": original.kind,
                    "input_snapshot": original.input_snapshot,
                    "configuration": None
                    if original.kind in {"configuration_probe", "material_parse"}
                    else original.configuration,
                }
            )
            digest = _request_digest(request, job_id)
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is not None:
                return _match_request(existing, digest)
            if original.status not in ("succeeded", "failed", "cancelled"):
                raise AppError("JOB_STATE_CONFLICT", "请等待任务结束或取消后再重新运行。", 409)
            frozen = None
            if original.kind == "configuration_probe":
                frozen = ConfigurationProbeConfiguration.model_validate(original.configuration)
                _check_probe_retry_budget(session, original, frozen)
            material = (
                MaterialParseConfiguration.model_validate(original.configuration)
                if original.kind == "material_parse"
                else None
            )
            return _insert_job(session, request, idempotency_key, digest, job_id, frozen, material)
    except IntegrityError:
        with session.begin():
            existing = session.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
            if existing is not None:
                return _match_request(existing, digest)
        raise


@dataclass(frozen=True)
class JobClaim:
    job_id: UUID
    project_id: UUID
    run_token: UUID
    kind: JobKind = "diagnostic"
    input_snapshot: InspectionInput | None = None
    configuration: InspectionConfiguration | None = None
    resource_scope: InspectionInput | None = None
    probe_input: ConfigurationProbeInput | None = None
    probe_configuration: ConfigurationProbeConfiguration | None = None
    probe_scope: ConfigurationProbeScope | None = None
    material_input: MaterialParseInput | None = None
    material_configuration: MaterialParseConfiguration | None = None
    material_scope: MaterialParseInput | None = None
    content_input: ContentRevisionInput | None = None
    export_input: DocumentExportInput | ChangeRecordInput | None = None


def _check_probe_retry_budget(
    session: Session, original: Job, configuration: ConfigurationProbeConfiguration
) -> None:
    if configuration.api is None:
        return
    cursor = original
    seen = {original.id}
    while cursor.source_job_id is not None:
        ancestor = session.get(Job, cursor.source_job_id)
        if ancestor is None or ancestor.id in seen:
            raise AppError("JOB_INPUT_INVALID", "试跑重试来源无效。", 422)
        seen.add(ancestor.id)
        if len(seen) > 100:
            raise AppError("JOB_INPUT_INVALID", "试跑重试来源超出支持范围。", 422)
        cursor = ancestor
    # Lock the root as well as the requested source: siblings share one retry budget.
    root = _lock_job(session, cursor.id)
    if root is None:
        raise AppError("JOB_INPUT_INVALID", "试跑重试来源无效。", 422)
    retries, pending = 0, [root.id]
    while pending and retries < configuration.api.max_retries:
        pending = list(
            session.scalars(
                select(Job.id)
                .where(Job.source_job_id.in_(pending))
                .limit(configuration.api.max_retries + 1)
            )
        )
        retries += len(pending)
    if retries >= configuration.api.max_retries:
        raise AppError("MODEL_RETRY_LIMIT_REACHED", "已达到固定配置的显式重试总次数。", 409)


def _probe_rate_available(
    session: Session, configuration: ConfigurationProbeConfiguration, instant: datetime
) -> bool:
    from thesis_pilot.modules.assistant_sessions.models import AssistantRun

    api = configuration.api
    if api is None:
        return True
    if session.get_bind().dialect.name == "postgresql":
        lock_id = int.from_bytes(sha256(api.credential_ref.encode()).digest()[:8], signed=True)
        session.execute(select(func.pg_advisory_xact_lock(lock_id)))
    recent = session.scalars(
        select(Job)
        .join(JobAttempt, JobAttempt.job_id == Job.id)
        .where(
            Job.kind == "configuration_probe",
            Job.configuration["api"]["credential_ref"].as_string() == api.credential_ref,
            JobAttempt.started_at > instant - timedelta(seconds=60),
        )
        .limit(1001)
    ).all()
    count, limit = 0, api.rate_limit_per_minute
    content_configs = session.scalars(
        select(AssistantRun.configuration_snapshot)
        .join(Job, Job.id == AssistantRun.job_id)
        .join(JobAttempt, JobAttempt.job_id == Job.id)
        .where(
            Job.kind == "content_revision",
            AssistantRun.configuration_snapshot["api"]["credential_ref"].as_string()
            == api.credential_ref,
            JobAttempt.started_at > instant - timedelta(seconds=60),
        )
        .limit(1001)
    ).all()
    for config in [*(job.configuration for job in recent), *content_configs]:
        provider = config.get("api") if isinstance(config, dict) else None
        if isinstance(provider, dict) and provider.get("credential_ref") == api.credential_ref:
            count += 1
            rate = provider.get("rate_limit_per_minute")
            if isinstance(rate, int) and not isinstance(rate, bool) and rate > 0:
                limit = min(limit, rate)
    return count < limit


def _content_lineage_attempts(session: Session, run: "AssistantRun") -> int:
    from thesis_pilot.modules.assistant_sessions.models import AssistantRun

    root = run
    seen = {run.id}
    while root.source_run_id is not None:
        parent = session.get(AssistantRun, root.source_run_id)
        if (
            parent is None
            or parent.project_id != run.project_id
            or parent.session_id != run.session_id
            or parent.id in seen
            or len(seen) >= 100
        ):
            raise AppError("JOB_INPUT_INVALID", "助手重试来源链无效。", 422)
        seen.add(parent.id)
        root = parent
    ids, pending = {root.id}, [root.id]
    while pending:
        children = list(
            session.scalars(
                select(AssistantRun.id).where(AssistantRun.source_run_id.in_(pending)).limit(101)
            )
        )
        if ids.intersection(children) or len(ids) + len(children) > 100:
            raise AppError("JOB_INPUT_INVALID", "助手重试来源树无效。", 422)
        ids.update(children)
        pending = children
    return (
        session.scalar(
            select(func.count())
            .select_from(JobAttempt)
            .join(AssistantRun, AssistantRun.job_id == JobAttempt.job_id)
            .where(AssistantRun.id.in_(ids))
        )
        or 0
    )


def _claim_content_in_transaction(
    session: Session,
    job: Job,
    lease_seconds: int,
    execution_timeout_seconds: int,
    max_attempts: int,
    now: datetime | None,
) -> JobClaim | None:
    instant = _database_now(session, now)
    try:
        run = _content_run(session, job)
        configuration = ConfigurationProbeConfiguration.model_validate(run.configuration_snapshot)
        if (
            configuration.api is None
            or configuration.agent is None
            or configuration.agent.role != "content"
        ):
            raise ValueError("Invalid fixed content configuration")
    except (AppError, ValidationError, ValueError):
        _end_execution(session, job, instant, status="failed", error_code="JOB_INPUT_INVALID")
        return None
    attempts = min(max_attempts, configuration.api.max_retries + 1)
    error_code = _expiration_error(job, instant, attempts)
    if error_code is not None:
        _end_execution(session, job, instant, status="failed", error_code=error_code)
        return None
    if job.status == "running" and not _lease_expired(job, instant):
        return None
    # Automatic redelivery and explicit new-run retries share the same fixed
    # provider call budget instead of multiplying each other's retry allowance.
    try:
        total_attempts = _content_lineage_attempts(session, run)
    except AppError:
        _end_execution(session, job, instant, status="failed", error_code="JOB_INPUT_INVALID")
        return None
    if total_attempts >= configuration.api.max_retries + 1:
        _end_execution(session, job, instant, status="failed", error_code="JOB_ATTEMPTS_EXHAUSTED")
        return None
    if not _probe_rate_available(session, configuration, instant):
        _end_execution(session, job, instant, status="failed", error_code="MODEL_RATE_LIMITED")
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
    return JobClaim(
        job.id,
        job.project_id,
        token,
        kind="content_revision",
        content_input=ContentRevisionInput(run_id=run.id),
    )


def get_config_job_references(
    session: Session, config_id: UUID, *, limit: int = 101
) -> list[dict[str, object]]:
    from thesis_pilot.modules.ai_configs.models import AIConfigVersion

    if not 1 <= limit <= 101:
        raise ValueError("invalid reference limit")
    # UUID text storage differs in SQLite and PostgreSQL. Canonical comparison is portable.
    wanted_versions = select(func.replace(cast(AIConfigVersion.id, String), "-", "")).where(
        AIConfigVersion.config_id == config_id
    )
    conditions = [
        func.replace(Job.configuration["version_ids"][kind].as_string(), "-", "").in_(
            wanted_versions
        )
        for kind in ("api", "model", "prompt", "agent")
    ]
    jobs = list(
        session.scalars(
            select(Job)
            .where(Job.kind == "configuration_probe", or_(*conditions))
            .order_by(Job.created_at.desc(), Job.id.desc())
            .limit(limit)
        )
    )
    candidates: set[UUID] = set()
    for job in jobs:
        configuration = ConfigurationProbeConfiguration.model_validate(job.configuration)
        candidates.update(configuration.version_ids.values())
    wanted = (
        {
            str(value)
            for value in session.scalars(
                select(AIConfigVersion.id).where(
                    AIConfigVersion.config_id == config_id, AIConfigVersion.id.in_(candidates)
                )
            )
        }
        if candidates
        else set()
    )
    references: list[dict[str, object]] = []
    for job in jobs:
        config = job.configuration
        ids = config.get("version_ids") if isinstance(config, dict) else None
        if not isinstance(ids, dict):
            continue
        matched = sorted(
            value for value in ids.values() if isinstance(value, str) and value in wanted
        )
        if matched:
            references.append(
                {
                    "job_id": job.id,
                    "project_id": job.project_id,
                    "kind": job.kind,
                    "status": job.status,
                    "matched_version_ids": [UUID(value) for value in matched],
                }
            )
    return references


def _as_utc(value: datetime) -> datetime:
    # SQLite fast tests store UTC timestamps without timezone metadata.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _database_now(session: Session, now: datetime | None) -> datetime:
    if now is not None:
        return _as_utc(now)
    if session.get_bind().dialect.name == "sqlite":
        return utcnow()
    # PostgreSQL's now() is fixed at transaction start, before a lock wait.
    instant: datetime = session.execute(select(func.clock_timestamp())).scalar_one()
    return _as_utc(instant)


def _lock_job(session: Session, job_id: UUID) -> Job | None:
    return session.scalar(select(Job).where(Job.id == job_id).with_for_update())


def _lease_expired(job: Job, instant: datetime) -> bool:
    return job.lease_until is not None and _as_utc(job.lease_until) <= instant


def _timed_out(job: Job, instant: datetime) -> bool:
    deadline = job.execution_deadline_at
    lease = job.lease_until
    # A heartbeat that stopped before the deadline leaves an earlier lease bound.
    return (
        deadline is not None
        and lease is not None
        and _as_utc(deadline) <= instant
        and _as_utc(lease) >= _as_utc(deadline)
    )


def _expiration_error(job: Job, instant: datetime, max_attempts: int) -> str | None:
    if job.status == "running" and _timed_out(job, instant):
        return "JOB_EXECUTION_TIMEOUT"
    if job.attempt >= max_attempts and (
        job.status == "queued" or (job.status == "running" and _lease_expired(job, instant))
    ):
        return "JOB_ATTEMPTS_EXHAUSTED"
    return None


def _finish_attempt(
    session: Session, job: Job, instant: datetime, status: str, error_code: str | None = None
) -> JobAttempt | None:
    attempt = session.scalar(
        select(JobAttempt).where(JobAttempt.job_id == job.id, JobAttempt.run_token == job.run_token)
    )
    if attempt is not None:
        attempt.status = status
        attempt.error_code = error_code
        attempt.finished_at = instant
    return attempt


def _end_execution(
    session: Session,
    job: Job,
    instant: datetime,
    *,
    status: Literal["succeeded", "failed"],
    result: DiagnosticResult
    | InspectionResult
    | ConfigurationProbeResult
    | MaterialParseResult
    | ContentRevisionResult
    | DocumentExportResult
    | ChangeRecordResult
    | None = None,
    error_code: str | None = None,
) -> None:
    _finish_attempt(session, job, instant, status, error_code)
    job.status = status
    job.result = result.model_dump(mode="json") if result is not None else None
    job.error_code = error_code
    job.run_token = None
    job.lease_until = None
    job.execution_deadline_at = None
    job.updated_at = instant
    if status == "failed" and job.kind == "content_revision":
        session.flush()
        _end_content_run(session, job, error_code or "JOB_EXECUTION_FAILED")


def claim_job(
    factory: sessionmaker[Session],
    job_id: UUID,
    lease_seconds: int,
    *,
    execution_timeout_seconds: int = DEFAULT_WORKER_EXECUTION_TIMEOUT_SECONDS,
    now: datetime | None = None,
    max_attempts: int = MAX_JOB_ATTEMPTS,
    expected_kind: JobKind | None = None,
) -> JobClaim | None:
    if lease_seconds < 1 or execution_timeout_seconds < 1 or max_attempts < 1:
        raise ValueError("invalid execution limits")
    with factory() as session, session.begin():
        job = _lock_job(session, job_id)
        if (
            job is None
            or job.status not in ("queued", "running")
            or (expected_kind is not None and job.kind != expected_kind)
        ):
            return None
        if job.kind == "content_revision":
            return _claim_content_in_transaction(
                session,
                job,
                lease_seconds,
                execution_timeout_seconds,
                max_attempts,
                now,
            )
        if job.kind in EXPORT_JOB_KINDS:
            from thesis_pilot.modules.exports.jobs import claim_export_in_transaction

            return claim_export_in_transaction(
                session, job, lease_seconds, execution_timeout_seconds, max_attempts, now
            )
        instant = _database_now(session, now)
        error_code = _expiration_error(job, instant, max_attempts)
        if error_code is not None:
            _end_execution(session, job, instant, status="failed", error_code=error_code)
            return None
        if job.status == "running" and not _lease_expired(job, instant):
            return None
        if job.status == "running":
            _finish_attempt(session, job, instant, "lease_expired")
        probe_source = None
        probe_configuration = None
        probe_scope = None
        material_source = None
        material_configuration = None
        material_scope = None
        try:
            request = JobCreate.model_validate(
                {
                    "project_id": job.project_id,
                    "kind": job.kind,
                    "input_snapshot": job.input_snapshot,
                    "configuration": None
                    if job.kind in {"configuration_probe", "material_parse"}
                    else job.configuration,
                }
            )
            if isinstance(request.input_snapshot, ConfigurationProbeInput):
                probe_source = request.input_snapshot
                probe_configuration = ConfigurationProbeConfiguration.model_validate(
                    job.configuration
                )
                probe_scope = ConfigurationProbeScope.model_validate(job.resource_scope)
                expected_scope = ConfigurationProbeScope(
                    config_version_id=probe_configuration.config_version_id,
                    version_ids=probe_configuration.version_ids,
                )
                if (
                    probe_scope != expected_scope
                    or probe_source.config_version_id != probe_scope.config_version_id
                ):
                    raise ValueError("试跑范围与固定输入不一致。")
                scope = None
            elif isinstance(request.input_snapshot, MaterialParseInput):
                material_source = request.input_snapshot
                material_configuration = MaterialParseConfiguration.model_validate(
                    job.configuration
                )
                material_scope = MaterialParseInput.model_validate(job.resource_scope)
                if material_source != material_scope:
                    raise ValueError("资料解析范围与固定输入不一致。")
                scope = None
            else:
                scope = (
                    InspectionInput.model_validate(job.resource_scope)
                    if job.resource_scope
                    else None
                )
                if scope != request.input_snapshot:
                    raise ValueError("任务范围与固定输入不一致。")
        except (ValidationError, ValueError):
            _end_execution(session, job, instant, status="failed", error_code="JOB_INPUT_INVALID")
            return None
        if probe_configuration is not None and not _probe_rate_available(
            session, probe_configuration, instant
        ):
            _end_execution(session, job, instant, status="failed", error_code="MODEL_RATE_LIMITED")
            return None
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
        return JobClaim(
            job_id,
            job.project_id,
            token,
            request.kind,
            request.input_snapshot if isinstance(request.input_snapshot, InspectionInput) else None,
            request.configuration,
            scope,
            probe_source,
            probe_configuration,
            probe_scope,
            material_source,
            material_configuration,
            material_scope,
        )


def _current_execution(
    session: Session, claim: JobClaim, now: datetime | None
) -> tuple[Job, datetime, datetime] | None:
    job = _lock_job(session, claim.job_id)
    if job is None or job.status != "running" or job.run_token != claim.run_token:
        return None
    instant = _database_now(session, now)
    if _timed_out(job, instant):
        _end_execution(session, job, instant, status="failed", error_code="JOB_EXECUTION_TIMEOUT")
        return None
    deadline = job.execution_deadline_at
    if deadline is None or job.lease_until is None or _lease_expired(job, instant):
        return None
    return job, instant, _as_utc(deadline)


def renew_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    lease_seconds: int,
    *,
    now: datetime | None = None,
) -> bool:
    if lease_seconds < 1:
        raise ValueError("invalid lease duration")
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, now)
        if execution is None:
            return False
        job, instant, deadline = execution
        job.lease_until = min(instant + timedelta(seconds=lease_seconds), deadline)
        return True


def load_inspection_content(factory: sessionmaker[Session], claim: JobClaim) -> JsonObject | None:
    with factory() as session, session.begin():
        if _current_execution(session, claim, None) is None:
            return None
        if claim.input_snapshot is None or claim.resource_scope != claim.input_snapshot:
            raise AppError("JOB_INPUT_INVALID", "任务固定输入无效。", 422)
        return _document_version(session, claim.project_id, claim.input_snapshot).content_json


def _matches_probe_result(job: Job, claim: JobClaim, result: ConfigurationProbeResult) -> bool:
    source, config, scope = claim.probe_input, claim.probe_configuration, claim.probe_scope
    if source is None or config is None or scope is None:
        return False
    if result.model_used:
        from thesis_pilot.modules.jobs.probe import checked_output

        try:
            checked_output(config.model_dump(mode="json", exclude_none=True), result.content)
        except Exception:
            # Schema exceptions can contain the supplier's text; only the validity flag survives.
            return False
    return (
        result.config_version_id == source.config_version_id == config.config_version_id
        and result.config_kind == config.config_kind
        and result.version_ids == config.version_ids
        and result.requested_model
        == (config.model.model_code if config.model is not None else None)
        and job.input_snapshot == source.model_dump(mode="json")
        and job.configuration == config.model_dump(mode="json", exclude_none=True)
        and job.resource_scope == scope.model_dump(mode="json")
    )


def finish_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    *,
    result: object = None,
    failed: bool = False,
    error_code: str | None = None,
    now: datetime | None = None,
) -> bool:
    validated: DiagnosticResult | InspectionResult | ConfigurationProbeResult | None = None
    if not failed and isinstance(result, dict):
        try:
            if claim.kind == "diagnostic":
                validated = DiagnosticResult.model_validate(result)
            elif claim.kind == "document_inspection":
                validated = InspectionResult.model_validate(result)
            elif claim.kind == "configuration_probe":
                validated = ConfigurationProbeResult.model_validate(result)
        except ValidationError:
            # Validation errors can contain the runner's raw data.
            validated = None
    with factory() as session, session.begin():
        execution = _current_execution(session, claim, now)
        if execution is None:
            return False
        job, instant, _ = execution
        if failed:
            _end_execution(
                session,
                job,
                instant,
                status="failed",
                error_code=error_code
                if error_code in MODEL_ERROR_CODES
                or (claim.kind == "material_parse" and error_code in MATERIAL_ERROR_CODES)
                or (
                    claim.kind == "content_revision"
                    and error_code in {"JOB_INPUT_INVALID", "JOB_RESULT_INVALID"}
                )
                else "JOB_EXECUTION_FAILED",
            )
        elif (
            validated is None
            or validated.job_id != job.id
            or validated.project_id != job.project_id
            or validated.kind != job.kind
            or (
                isinstance(validated, ConfigurationProbeResult)
                and not _matches_probe_result(job, claim, validated)
            )
            or (
                isinstance(validated, InspectionResult)
                and (
                    claim.input_snapshot is None
                    or claim.configuration is None
                    or validated.document_id != claim.input_snapshot.document_id
                    or validated.document_version != claim.input_snapshot.document_version
                    or (validated.text_characters is not None)
                    != claim.configuration.include_text_statistics
                    or job.input_snapshot != claim.input_snapshot.model_dump(mode="json")
                    or job.resource_scope != claim.input_snapshot.model_dump(mode="json")
                    or job.configuration != claim.configuration.model_dump(mode="json")
                )
            )
        ):
            _end_execution(session, job, instant, status="failed", error_code="JOB_RESULT_INVALID")
        else:
            if isinstance(validated, InspectionResult | ConfigurationProbeResult):
                attempt = session.scalar(
                    select(JobAttempt).where(
                        JobAttempt.job_id == job.id, JobAttempt.run_token == claim.run_token
                    )
                )
                if attempt is None:
                    _end_execution(
                        session, job, instant, status="failed", error_code="JOB_RESULT_INVALID"
                    )
                    return True
                session.add(
                    JobArtifact(
                        job_id=job.id,
                        attempt_id=attempt.id,
                        kind=validated.kind,
                        schema_version=1,
                        result=validated.model_dump(mode="json"),
                        created_at=instant,
                    )
                )
            _end_execution(session, job, instant, status="succeeded", result=validated)
        return True


def load_content_revision_snapshot(
    factory: sessionmaker[Session], claim: JobClaim
) -> dict[str, object] | None:
    from thesis_pilot.modules.assistant_sessions.service import load_run_snapshot_in_transaction

    with factory() as session, session.begin():
        execution = _current_execution(session, claim, None)
        if execution is None:
            return None
        job = execution[0]
        run = _content_run(session, job)
        if claim.content_input is None or claim.content_input.run_id != run.id:
            raise AppError("JOB_INPUT_INVALID", "助手执行标识与固定运行不一致。", 422)
        return load_run_snapshot_in_transaction(session, job.project_id, run.id, job.id)


class _ContentRevisionLeaseLost(Exception):
    pass


def finish_content_revision_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    completion: ContentRevisionCompletion,
    *,
    now: datetime | None = None,
) -> bool:
    try:
        return _finish_content_revision_job(factory, claim, completion, now=now)
    except _ContentRevisionLeaseLost:
        return finish_job(factory, claim, failed=True, now=now)
    except AppError as error:
        return finish_job(factory, claim, failed=True, error_code=error.code, now=now)


def _finish_content_revision_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    completion: ContentRevisionCompletion,
    *,
    now: datetime | None = None,
) -> bool:
    from thesis_pilot.modules.assistant_sessions.service import commit_run_result_in_transaction

    with factory() as session, session.begin():
        execution = _current_execution(session, claim, now)
        if execution is None:
            return False
        job, instant, _ = execution
        try:
            run = _content_run(session, job)
            configuration = ConfigurationProbeConfiguration.model_validate(
                run.configuration_snapshot
            )
            completion = ContentRevisionCompletion.model_validate(completion.model_dump())
            if (
                claim.kind != "content_revision"
                or claim.content_input is None
                or claim.content_input.run_id != run.id
                or configuration.model is None
                or completion.requested_model != configuration.model.model_code
            ):
                raise ValueError("Invalid content revision completion identity")
        except (ValidationError, ValueError, AppError):
            _end_execution(session, job, instant, status="failed", error_code="JOB_RESULT_INVALID")
            return True
        attempt = session.scalar(
            select(JobAttempt).where(
                JobAttempt.job_id == job.id, JobAttempt.run_token == claim.run_token
            )
        )
        if attempt is None:
            _end_execution(session, job, instant, status="failed", error_code="JOB_RESULT_INVALID")
            return True
        committed = commit_run_result_in_transaction(
            session,
            job.project_id,
            run.id,
            job.id,
            completion.model_dump(),
        )
        final_time = _database_now(session, now)
        if (
            job.status != "running"
            or job.run_token != claim.run_token
            or job.execution_deadline_at is None
            or _timed_out(job, final_time)
            or job.lease_until is None
            or _lease_expired(job, final_time)
        ):
            # Roll back the provisional message/proposal before the ordinary
            # timeout hook terminates the still-generating candidate.
            raise _ContentRevisionLeaseLost
        instant = final_time
        result = ContentRevisionResult.model_validate(
            {
                "kind": "content_revision",
                "schema_version": 1,
                "job_id": str(job.id),
                "project_id": str(job.project_id),
                "run_id": str(committed["run_id"]),
                "session_id": str(committed["session_id"]),
                "document_id": str(run.document_id),
                "document_version": run.document_version,
                "assistant_message_id": str(committed["message_id"]),
                "candidate_id": str(committed["candidate_id"]),
                "requested_model": completion.requested_model,
                "response_model": completion.response_model,
                "model_used": True,
                "writes_performed": False,
            }
        )
        if (
            result.run_id != run.id
            or result.session_id != run.session_id
            or result.candidate_id != run.candidate_id
            or result.assistant_message_id != run.result_message_id
        ):
            raise AppError("JOB_INPUT_INVALID", "助手产物与固定运行不一致。", 422)
        session.add(
            JobArtifact(
                job_id=job.id,
                attempt_id=attempt.id,
                kind="content_revision",
                schema_version=1,
                result=result.model_dump(mode="json"),
                created_at=instant,
            )
        )
        _end_execution(session, job, instant, status="succeeded", result=result)
        return True


def load_material_parse_bytes(factory: sessionmaker[Session], claim: JobClaim) -> bytes | None:
    from thesis_pilot.modules.materials.service import load_material_parse_source

    with factory() as session, session.begin():
        execution = _current_execution(session, claim, None)
        if execution is None:
            return None
        job = execution[0]
        source, config = claim.material_input, claim.material_configuration
        if (
            source is None
            or config is None
            or claim.material_scope != source
            or job.input_snapshot != source.model_dump(mode="json")
            or job.resource_scope != source.model_dump(mode="json")
            or job.configuration != config.model_dump(mode="json")
        ):
            raise AppError("JOB_INPUT_INVALID", "资料解析固定输入无效。", 422)
        original = load_material_parse_source(
            session, claim.project_id, source.material_id, source.original_version_id
        )
        data = original["data"]
        if (
            not isinstance(data, bytes)
            or not 1 <= len(data) <= 8 * 1024 * 1024
            or original["sha256"] != source.original_sha256
            or sha256(data).hexdigest() != source.original_sha256
        ):
            raise AppError("MATERIAL_ORIGINAL_CORRUPT", "原件内容与固定摘要不一致。", 422)
        if original["file_type"] != config.file_type:
            raise AppError("JOB_INPUT_INVALID", "固定文件类型与原件不一致。", 422)
        if original["expected_parse_id"] != source.expected_parse_id:
            raise AppError("MATERIAL_PARSE_CONFLICT", "解析版本已变化，请重新读取后再解析。", 409)
        return data


class _MaterialParseLeaseLost(Exception):
    pass


def finish_material_parse_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    parsed: ParsedMaterial,
    *,
    now: datetime | None = None,
) -> bool:
    try:
        return _finish_material_parse_job(factory, claim, parsed, now=now)
    except _MaterialParseLeaseLost:
        # Recheck after rollback so a lost lease can recover and a deadline stays terminal.
        return finish_job(factory, claim, failed=True, now=now)
    except AppError as error:
        # A rejected CAS rolls back the complete material transaction first.
        # The ordinary failure path then rechecks token, cancellation and lease.
        return finish_job(factory, claim, failed=True, error_code=error.code, now=now)


def _finish_material_parse_job(
    factory: sessionmaker[Session],
    claim: JobClaim,
    parsed: ParsedMaterial,
    *,
    now: datetime | None = None,
) -> bool:
    """One transaction owns the parse version, pointer CAS, artifact and Job terminal state."""
    from thesis_pilot.modules.materials.service import commit_material_parse

    with factory() as session, session.begin():
        execution = _current_execution(session, claim, now)
        if execution is None:
            return False
        job, instant, _ = execution
        source, config = claim.material_input, claim.material_configuration
        if (
            claim.kind != "material_parse"
            or job.kind != "material_parse"
            or source is None
            or config is None
            or claim.material_scope != source
            or job.input_snapshot != source.model_dump(mode="json")
            or job.resource_scope != source.model_dump(mode="json")
            or job.configuration != config.model_dump(mode="json")
        ):
            _end_execution(session, job, instant, status="failed", error_code="JOB_INPUT_INVALID")
            return True
        try:
            parsed = ParsedMaterial.model_validate(parsed.model_dump(mode="json"))
            if (
                parsed.parser_version != config.parser_version
                or len(parsed.anchors) > 20000
                or len(parsed.plain_text.encode()) > 8 * 1024 * 1024
                or any(
                    anchor.original_version_id != source.original_version_id
                    for anchor in parsed.anchors
                )
            ):
                raise ValueError("解析结果超出固定原件范围。")
            if len(parsed.model_dump_json().encode()) > 16 * 1024 * 1024:
                raise ValueError("解析结果超出有界传输大小。")
        except (ValidationError, ValueError):
            _end_execution(session, job, instant, status="failed", error_code="JOB_RESULT_INVALID")
            return True
        attempt = session.scalar(
            select(JobAttempt).where(
                JobAttempt.job_id == job.id, JobAttempt.run_token == claim.run_token
            )
        )
        if attempt is None:
            _end_execution(session, job, instant, status="failed", error_code="JOB_RESULT_INVALID")
            return True
        version = commit_material_parse(
            session,
            claim.project_id,
            source.material_id,
            source.original_version_id,
            source.expected_parse_id,
            job.id,
            parsed,
        )
        if (
            version.original_version_id != source.original_version_id
            or version.source_job_id != job.id
        ):
            raise AppError("JOB_INPUT_INVALID", "解析版本与固定来源不一致。", 422)
        if _current_execution(session, claim, now) is None:
            raise _MaterialParseLeaseLost
        result = MaterialParseResult.model_validate(
            {
                "kind": "material_parse",
                "schema_version": 1,
                "job_id": str(job.id),
                "project_id": str(job.project_id),
                "material_id": str(source.material_id),
                "original_version_id": str(source.original_version_id),
                "original_sha256": source.original_sha256,
                "parser_version": config.parser_version,
                "parse_version_id": str(version.id),
                "anchor_count": len(parsed.anchors),
                "text_characters": len(parsed.plain_text),
                "model_used": False,
                "writes_performed": False,
            }
        )
        session.add(
            JobArtifact(
                job_id=job.id,
                attempt_id=attempt.id,
                kind="material_parse",
                schema_version=1,
                result=result.model_dump(mode="json"),
                created_at=instant,
            )
        )
        _end_execution(session, job, instant, status="succeeded", result=result)
        return True


def _close_expired_jobs(
    factory: sessionmaker[Session], batch_size: int, now: datetime | None, max_attempts: int
) -> None:
    with factory() as session, session.begin():
        scan_at = _database_now(session, now)
        expired_jobs = session.scalars(
            select(Job)
            .where(
                or_(
                    and_(Job.status == "queued", Job.attempt >= max_attempts),
                    and_(
                        Job.status == "running",
                        Job.lease_until <= scan_at,
                        or_(
                            Job.lease_until >= Job.execution_deadline_at,
                            Job.attempt >= max_attempts,
                        ),
                    ),
                )
            )
            .order_by(Job.updated_at, Job.id)
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        ).all()
        if not expired_jobs:
            return
        instant = _database_now(session, now)
        for job in expired_jobs:
            error_code = _expiration_error(job, instant, max_attempts)
            if error_code is not None:
                _end_execution(session, job, instant, status="failed", error_code=error_code)


@dataclass(frozen=True)
class DispatchResult:
    published: int
    failed: int


def dispatch_pending(
    factory: sessionmaker[Session],
    publish: Publisher,
    *,
    batch_size: int = 20,
    redelivery_seconds: int = 120,
    now: datetime | None = None,
    max_attempts: int = MAX_JOB_ATTEMPTS,
) -> DispatchResult:
    """At-least-once dispatch. Duplicate messages are harmless under claim/token checks.

    Locks are held only for a bounded batch and publish must have a transport timeout.
    A crash after broker acceptance but before commit intentionally permits redelivery.
    Expired running leases and queued messages missing at the broker are republished.
    """
    if not 1 <= batch_size <= 100 or redelivery_seconds < 1 or max_attempts < 1:
        raise ValueError("invalid dispatch limits")
    _close_expired_jobs(factory, batch_size, now, max_attempts)
    published = failed = 0
    with factory() as session, session.begin():
        instant = _database_now(session, now)
        events = session.scalars(
            select(OutboxEvent)
            .join(Job, Job.id == OutboxEvent.job_id)
            .where(
                Job.attempt < max_attempts,
                or_(
                    and_(
                        Job.status == "queued",
                        OutboxEvent.next_attempt_at <= instant,
                        or_(
                            OutboxEvent.published_at.is_(None),
                            OutboxEvent.published_at
                            <= instant - timedelta(seconds=redelivery_seconds),
                        ),
                    ),
                    and_(
                        Job.status == "running",
                        Job.lease_until <= instant,
                        or_(
                            Job.execution_deadline_at.is_(None),
                            Job.lease_until < Job.execution_deadline_at,
                        ),
                        or_(
                            OutboxEvent.next_attempt_at <= instant,
                            # Recover a lost lease immediately once, while preserving
                            # backoff after a failed recovery publication.
                            and_(
                                OutboxEvent.last_error_code.is_(None),
                                OutboxEvent.published_at < Job.lease_until,
                            ),
                        ),
                    ),
                ),
            )
            .order_by(OutboxEvent.created_at, OutboxEvent.id)
            .limit(batch_size)
            .with_for_update(skip_locked=True, of=OutboxEvent)
        ).all()
        for event in events:
            event.attempts += 1
            try:
                publish(event.job_id)
            except Exception:
                # Broker exceptions may contain credentials. Persist only a stable code.
                event.last_error_code = "JOB_DISPATCH_FAILED"
                event.next_attempt_at = instant + timedelta(
                    seconds=min(60, 2 ** min(event.attempts, 6))
                )
                failed += 1
            else:
                event.published_at = instant
                event.next_attempt_at = instant + timedelta(seconds=redelivery_seconds)
                event.last_error_code = None
                published += 1
    return DispatchResult(published, failed)
