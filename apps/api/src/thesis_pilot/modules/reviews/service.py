"""Independent review transactions. Reviews read fixed versions and never write content."""

import json
from datetime import UTC, datetime
from hashlib import sha256
from typing import cast
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs.models import AIConfigVersion
from thesis_pilot.modules.ai_configs.service import freeze_config_version_chain
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.jobs.models import Job, JobAttempt, OutboxEvent
from thesis_pilot.modules.jobs.schemas import (
    ConfigurationProbeConfiguration,
    JobRead,
    JobStatus,
    ReviewInput,
)
from thesis_pilot.modules.materials.service import freeze_project_sources
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.reviews.models import ReviewReport, ReviewRun
from thesis_pilot.modules.reviews.rubric import RUBRICS, rubric_snapshot
from thesis_pilot.modules.reviews.schemas import (
    ReviewCompletion,
    ReviewCreate,
    ReviewPage,
    ReviewRead,
    ReviewReceipt,
    ReviewReportContent,
    ReviewReportRead,
    ReviewRetry,
    ReviewRubricRead,
)
from thesis_pilot.modules.reviews.scope import chapters, extract_scope, map_location

MAX_CONTEXT_BYTES = 160 * 1024
MAX_BASIS_ITEMS = 200


def error(code: str, message: str, status: int = 409) -> AppError:
    return AppError("REVIEW_" + code, message, status)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def list_rubrics() -> list[ReviewRubricRead]:
    return [ReviewRubricRead.model_validate(rubric_snapshot(item)) for item in RUBRICS.values()]


def _lock_project(session: Session, project_id: UUID) -> None:
    # Serializes review creation per project so only one review runs at a time.
    if session.scalar(select(Project.id).where(Project.id == project_id).with_for_update()) is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)


def _require_project(session: Session, project_id: UUID) -> None:
    if session.get(Project, project_id) is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)


def _basis(sources: dict[str, object]) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    for source in cast(list[dict[str, object]], sources.get("requirements") or []):
        for item in cast(list[dict[str, object]], source["items"]):
            if not item.get("enabled", True):
                continue
            items.append(
                {
                    "key": f"R{len(items) + 1}",
                    "kind": "requirement",
                    "label": str(item["original_text"])[:300],
                    "source_id": source["parse_version_id"],
                    "item_id": str(item["id"]),
                }
            )
    template = cast(dict[str, object] | None, sources.get("template"))
    template_items = cast(list[dict[str, object]], template["items"] if template else [])
    for count, item in enumerate(template_items, start=1):
        value = item.get("value")
        unit = item.get("unit") or ""
        items.append(
            {
                "key": f"T{count}",
                "kind": "template",
                "label": f"{item['scope']} · {item['field']}：{value}{unit}"[:300],
                "source_id": template["parse_version_id"] if template else None,
                "item_id": str(item["id"]),
            }
        )
    if len(items) > MAX_BASIS_ITEMS:
        raise error("SCOPE_TOO_LARGE", "绑定的要求与模板条目过多，请缩小适用范围后再评审。", 413)
    return items


def _freeze(
    session: Session, project_id: UUID, data: ReviewCreate
) -> tuple[dict[str, object], dict[str, object]]:
    document = session.scalar(
        select(Document).where(Document.id == data.document_id, Document.project_id == project_id)
    )
    if document is None:
        raise AppError("DOCUMENT_NOT_FOUND", "项目中没有指定正式稿。", 404)
    if document.current_version != data.document_version:
        raise error("CONTEXT_STALE", "正文已更新，请按当前版本重新发起评审。")
    version = session.get(DocumentVersion, (document.id, data.document_version))
    if version is None:
        raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正文版本不存在。", 404)
    rubric = RUBRICS.get(data.rubric_version)
    if rubric is None:
        raise error("RUBRIC_UNAVAILABLE", "评审量表版本不存在。", 422)
    scope = extract_scope(version.content_json, data.chapter_id)
    sources = freeze_project_sources(session, project_id)
    binding = cast(dict[str, object], sources["binding"])
    expected = str(data.source_binding_version_id) if data.source_binding_version_id else None
    if binding.get("current_version_id") != expected:
        raise error("CONTEXT_STALE", "模板或要求绑定已变化，请按当前绑定重新发起评审。")
    configuration = freeze_config_version_chain(session, data.agent_config_version_id)
    _check_agent(configuration)
    agent_version = session.get(AIConfigVersion, data.agent_config_version_id)
    template = cast(dict[str, object] | None, sources.get("template"))
    context: dict[str, object] = {
        "schema_version": 1,
        "scope": scope,
        "chapters": [
            {"chapter_id": item["chapter_id"], "title": item["title"]}
            for item in chapters(version.content_json)
        ],
        "rubric": rubric_snapshot(rubric),
        "basis": _basis(sources),
        "sources": {
            "binding_version_id": binding.get("current_version_id"),
            "template_parse_version_id": template["parse_version_id"] if template else None,
            "requirement_parse_version_ids": [
                item["parse_version_id"]
                for item in cast(list[dict[str, object]], sources.get("requirements") or [])
            ],
        },
        "agent": {
            "name": agent_version.name if agent_version else "",
            "version": agent_version.version if agent_version else 0,
        },
    }
    if len(json.dumps(context, ensure_ascii=False, allow_nan=False).encode()) > MAX_CONTEXT_BYTES:
        raise error("SCOPE_TOO_LARGE", "评审范围或绑定资料过大，请选择单个章节评审。", 413)
    return context, configuration


def _check_agent(configuration: dict[str, object]) -> None:
    agent, model = configuration.get("agent"), configuration.get("model")
    if (
        configuration.get("config_kind") != "agent"
        or not isinstance(agent, dict)
        or agent.get("role") != "review"
        or not isinstance(model, dict)
        or "review" not in cast(list[str], model.get("capabilities") or [])
    ):
        raise error("AGENT_INVALID", "请选择已启用、角色为评审且模型具备评审能力的智能体。", 422)


def _hash(operation: str, project_id: UUID, payload: object) -> str:
    return sha256(
        json.dumps(
            {"operation": operation, "project_id": str(project_id), "input": payload},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()
    ).hexdigest()


def _job_digest(run: ReviewRun, source_job_id: UUID | None) -> str:
    return sha256(
        json.dumps(
            {
                "kind": "review",
                "project_id": str(run.project_id),
                "review_id": str(run.id),
                "source_job_id": str(source_job_id) if source_job_id else None,
                "input_snapshot": run.input_snapshot,
                "context_snapshot": run.context_snapshot,
                "configuration_snapshot": run.configuration_snapshot,
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode()
    ).hexdigest()


def _job(session: Session, run: ReviewRun) -> Job:
    job = session.get(Job, run.job_id) if run.job_id else None
    if job is None or job.project_id != run.project_id or job.kind != "review":
        raise error("RUN_INVALID", "评审记录与执行任务不一致。")
    return job


def _run(session: Session, project_id: UUID, review_id: UUID) -> ReviewRun:
    found = session.scalar(
        select(ReviewRun).where(ReviewRun.id == review_id, ReviewRun.project_id == project_id)
    )
    if found is None:
        raise error("NOT_FOUND", "项目中没有该评审记录。", 404)
    return found


def _read(session: Session, run: ReviewRun) -> ReviewRead:
    job = _job(session, run)
    report_id = session.scalar(select(ReviewReport.id).where(ReviewReport.review_id == run.id))
    context = run.context_snapshot
    scope = cast(dict[str, object], context["scope"])
    sources = cast(dict[str, object], context["sources"])
    agent = cast(dict[str, object], context["agent"])
    version_ids = cast(dict[str, str], run.configuration_snapshot["version_ids"])
    binding = sources.get("binding_version_id")
    template = sources.get("template_parse_version_id")
    return ReviewRead(
        id=run.id,
        project_id=run.project_id,
        job_id=job.id,
        status=cast(JobStatus, job.status),
        error_code=job.error_code,
        attempt=job.attempt,
        document_id=run.document_id,
        document_version=run.document_version,
        chapter_id=run.chapter_id,
        scope_title=cast(str, scope["title"]),
        rubric_version=run.rubric_version,
        agent_config_version_id=run.agent_config_version_id,
        agent_name=f"{agent['name']} · v{agent['version']}",
        config_version_ids={key: UUID(value) for key, value in version_ids.items()},
        source_binding_version_id=UUID(cast(str, binding)) if binding else None,
        template_parse_version_id=UUID(cast(str, template)) if template else None,
        requirement_parse_version_ids=[
            UUID(value) for value in cast(list[str], sources["requirement_parse_version_ids"])
        ],
        source_review_id=run.source_review_id,
        report_id=report_id if job.status == "succeeded" else None,
        created_at=run.created_at,
        updated_at=_utc(job.updated_at),
    )


def _receipt(session: Session, run: ReviewRun) -> ReviewReceipt:
    return ReviewReceipt(review=_read(session, run), job=JobRead.model_validate(_job(session, run)))


def _assert_idle(session: Session, project_id: UUID) -> None:
    active = session.scalar(
        select(ReviewRun.id)
        .join(Job, Job.id == ReviewRun.job_id)
        .where(ReviewRun.project_id == project_id, Job.status.in_(["queued", "running"]))
        .limit(1)
    )
    if active is not None:
        raise error("BUSY", "已有评审在运行，请等待完成或取消后再发起。")


def _previous(
    session: Session, project_id: UUID, command_id: UUID, digest: str
) -> ReviewRun | None:
    run = session.scalar(select(ReviewRun).where(ReviewRun.command_id == command_id))
    if run is None:
        return None
    if run.project_id != project_id or run.request_hash != digest:
        raise error("COMMAND_CONFLICT", "评审命令已用于不同请求，请核对原评审记录。")
    return run


def _new_run(
    session: Session,
    project_id: UUID,
    input_snapshot: dict[str, object],
    context: dict[str, object],
    configuration: dict[str, object],
    command_id: UUID,
    digest: str,
    source_review_id: UUID | None = None,
    source_job_id: UUID | None = None,
) -> ReviewRun:
    data = ReviewCreate.model_validate({**input_snapshot, "command_id": str(command_id)})
    run = ReviewRun(
        project_id=project_id,
        command_id=command_id,
        request_hash=digest,
        document_id=data.document_id,
        document_version=data.document_version,
        chapter_id=data.chapter_id,
        rubric_version=data.rubric_version,
        agent_config_version_id=data.agent_config_version_id,
        input_snapshot=input_snapshot,
        context_snapshot=context,
        configuration_snapshot=configuration,
        source_review_id=source_review_id,
    )
    session.add(run)
    session.flush()
    source = ReviewInput(review_id=run.id).model_dump(mode="json")
    job = Job(
        project_id=project_id,
        kind="review",
        idempotency_key="review:" + str(command_id),
        request_hash=_job_digest(run, source_job_id),
        input_snapshot=source,
        resource_scope=source.copy(),
        configuration=None,
        source_job_id=source_job_id,
    )
    session.add(job)
    session.flush()
    session.add(OutboxEvent(job_id=job.id))
    run.job_id = job.id
    session.flush()
    return run


def create_review(session: Session, project_id: UUID, data: ReviewCreate) -> ReviewReceipt:
    input_snapshot = data.model_dump(mode="json", exclude={"command_id"})
    digest = _hash("create", project_id, input_snapshot)
    try:
        with session.begin():
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
            _lock_project(session, project_id)
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
            _assert_idle(session, project_id)
            context, configuration = _freeze(session, project_id, data)
            run = _new_run(
                session, project_id, input_snapshot, context, configuration, data.command_id, digest
            )
            return _receipt(session, run)
    except IntegrityError:
        with session.begin():
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
        raise


def list_reviews(session: Session, project_id: UUID, *, limit: int, offset: int) -> ReviewPage:
    with session.begin():
        _require_project(session, project_id)
        rows = session.scalars(
            select(ReviewRun)
            .where(ReviewRun.project_id == project_id)
            .order_by(ReviewRun.created_at.desc(), ReviewRun.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return ReviewPage(
            items=[_read(session, row) for row in rows],
            total=session.scalar(
                select(func.count())
                .select_from(ReviewRun)
                .where(ReviewRun.project_id == project_id)
            )
            or 0,
            limit=limit,
            offset=offset,
        )


def get_review(session: Session, project_id: UUID, review_id: UUID) -> ReviewRead:
    with session.begin():
        return _read(session, _run(session, project_id, review_id))


def cancel_review(session: Session, project_id: UUID, review_id: UUID) -> ReviewRead:
    from thesis_pilot.modules.jobs.service import cancel_review_in_transaction

    with session.begin():
        run = _run(session, project_id, review_id)
        cancel_review_in_transaction(session, project_id, _job(session, run).id)
        return _read(session, run)


def _retry_budget(session: Session, source: ReviewRun) -> None:
    api = source.configuration_snapshot.get("api")
    budget = api.get("max_retries", 0) if isinstance(api, dict) else 0
    if type(budget) is not int or not 0 <= budget <= 3:
        raise error("RUN_INVALID", "重试预算配置无效。")
    if budget == 0:
        raise AppError("MODEL_RETRY_LIMIT_REACHED", "该固定配置不允许重试。", 409)
    root = source
    seen = {root.id}
    while root.source_review_id is not None:
        root = _run(session, source.project_id, root.source_review_id)
        if root.id in seen or len(seen) > 100:
            raise error("RUN_INVALID", "重试来源链无效。")
        seen.add(root.id)
    pending, retries = [root.id], 0
    while pending:
        pending = list(
            session.scalars(
                select(ReviewRun.id)
                .where(ReviewRun.source_review_id.in_(pending))
                .limit(budget + 1)
            )
        )
        retries += len(pending)
        if retries >= budget:
            raise AppError("MODEL_RETRY_LIMIT_REACHED", "已达到该固定配置的显式重试次数。", 409)


def retry_review(
    session: Session, project_id: UUID, review_id: UUID, data: ReviewRetry
) -> ReviewReceipt:
    digest = _hash("retry", project_id, {"review_id": str(review_id)})
    try:
        with session.begin():
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
            _lock_project(session, project_id)
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
            original = _run(session, project_id, review_id)
            old_job = _job(session, original)
            if old_job.status not in {"failed", "cancelled"}:
                raise error("RETRY_INVALID", "只能重试失败或已取消的评审。")
            _assert_idle(session, project_id)
            _retry_budget(session, original)
            # Keep the exact fixed inputs; only require the frozen configuration to
            # remain available, so a disabled agent is not silently replaced.
            if (
                freeze_config_version_chain(session, original.agent_config_version_id)
                != original.configuration_snapshot
            ):
                raise error("CONTEXT_STALE", "评审智能体配置已变化或停用，请重新发起评审。")
            run = _new_run(
                session,
                project_id,
                original.input_snapshot,
                original.context_snapshot,
                original.configuration_snapshot,
                data.command_id,
                digest,
                original.id,
                old_job.id,
            )
            return _receipt(session, run)
    except IntegrityError:
        with session.begin():
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
        raise


def get_report(session: Session, project_id: UUID, review_id: UUID) -> ReviewReportRead:
    with session.begin():
        run = _run(session, project_id, review_id)
        report = session.scalar(select(ReviewReport).where(ReviewReport.review_id == run.id))
        if report is None or _job(session, run).status != "succeeded":
            raise error("REPORT_NOT_FOUND", "该评审尚未生成报告。", 404)
        return ReviewReportRead(
            id=report.id,
            review_id=run.id,
            project_id=run.project_id,
            job_id=report.job_id,
            document_id=run.document_id,
            document_version=run.document_version,
            requested_model=report.requested_model,
            response_model=report.response_model,
            content=ReviewReportContent.model_validate(report.content),
            created_at=report.created_at,
        )


def download_report(
    session: Session, project_id: UUID, review_id: UUID, fmt: str
) -> tuple[str, str, bytes]:
    from thesis_pilot.modules.reviews.render import render_html, render_markdown

    report = get_report(session, project_id, review_id)
    review = get_review(session, project_id, review_id)
    if fmt == "html":
        body, media, extension = render_html(review, report), "text/html; charset=utf-8", "html"
    else:
        body, media, extension = (
            render_markdown(review, report),
            "text/markdown; charset=utf-8",
            "md",
        )
    return f"thesispilot-review-v{review.document_version}.{extension}", media, body.encode()


# --- Execution boundary used by the jobs module inside its own transactions.
def review_for_job(session: Session, job: Job) -> ReviewRun:
    try:
        source = ReviewInput.model_validate(job.input_snapshot)
    except ValidationError:
        raise AppError("JOB_INPUT_INVALID", "评审任务固定输入无效。", 422) from None
    run = session.get(ReviewRun, source.review_id)
    if (
        job.kind != "review"
        or run is None
        or run.project_id != job.project_id
        or run.job_id != job.id
        or job.configuration is not None
        or job.resource_scope != source.model_dump(mode="json")
        or job.request_hash != _job_digest(run, job.source_job_id)
    ):
        raise AppError("JOB_INPUT_INVALID", "评审任务与固定记录不一致。", 422)
    return run


def review_lineage_attempts(session: Session, run: ReviewRun) -> int:
    root = run
    seen = {run.id}
    while root.source_review_id is not None:
        parent = session.get(ReviewRun, root.source_review_id)
        if parent is None or parent.project_id != run.project_id or parent.id in seen:
            raise AppError("JOB_INPUT_INVALID", "评审重试来源链无效。", 422)
        if len(seen) >= 100:
            raise AppError("JOB_INPUT_INVALID", "评审重试来源链过长。", 422)
        seen.add(parent.id)
        root = parent
    ids, pending = {root.id}, [root.id]
    while pending:
        found = list(
            session.scalars(
                select(ReviewRun.id).where(ReviewRun.source_review_id.in_(pending)).limit(101)
            )
        )
        if ids.intersection(found) or len(ids) + len(found) > 100:
            raise AppError("JOB_INPUT_INVALID", "评审重试来源树无效。", 422)
        ids.update(found)
        pending = found
    return (
        session.scalar(
            select(func.count())
            .select_from(JobAttempt)
            .join(ReviewRun, ReviewRun.job_id == JobAttempt.job_id)
            .where(ReviewRun.id.in_(ids))
        )
        or 0
    )


def load_review_snapshot_in_transaction(
    session: Session, job: Job, review_id: UUID
) -> dict[str, object]:
    if not session.in_transaction():
        raise RuntimeError("Review snapshot requires the caller's transaction")
    run = review_for_job(session, job)
    if run.id != review_id:
        raise AppError("JOB_INPUT_INVALID", "评审执行标识与固定记录不一致。", 422)
    return {
        "review_id": str(run.id),
        "input_snapshot": run.input_snapshot,
        "context_snapshot": run.context_snapshot,
        "configuration_snapshot": run.configuration_snapshot,
    }


def _invalid_reply() -> AppError:
    return AppError("MODEL_INVALID_RESPONSE", "模型评审输出不满足固定报告结构。", 422)


def build_report(context: dict[str, object], completion: ReviewCompletion) -> ReviewReportContent:
    """Verify every model claim against the frozen context; unverifiable data stays blank."""
    reply = completion.reply
    rubric = cast(dict[str, object], context["rubric"])
    dimensions = cast(list[dict[str, object]], rubric["dimensions"])
    by_id = {cast(str, item["id"]): item for item in dimensions}
    given: dict[str, tuple[float | None, str]] = {}
    for score in reply.scores:
        dimension = by_id.get(score.dimension)
        if dimension is None or score.dimension in given:
            raise _invalid_reply()
        if score.score is not None and score.score > cast(int, dimension["full"]):
            raise _invalid_reply()
        given[score.dimension] = (score.score, score.reason)
    unchecked: list[dict[str, object]] = [
        {"item": item.item, "reason": item.reason, "origin": "model"} for item in reply.unchecked
    ]
    scores: list[dict[str, object]] = []
    for item in dimensions:
        key = cast(str, item["id"])
        value, reason = given.get(key, (None, ""))
        if key not in given:
            unchecked.append(
                {
                    "item": f"{item['name']}评分",
                    "reason": "模型未给出该维度判断，按规则留白，不补默认分。",
                    "origin": "system",
                }
            )
        scores.append(
            {
                "dimension_id": key,
                "name": item["name"],
                "full": item["full"],
                "score": value,
                "reason": reason,
            }
        )
    basis = {
        cast(str, item["key"]): item for item in cast(list[dict[str, object]], context["basis"])
    }
    for item in dimensions:
        basis["D-" + cast(str, item["id"])] = {
            "key": "D-" + cast(str, item["id"]),
            "kind": "rubric",
            "label": f"量表 · {item['name']}",
            "source_id": rubric["version"],
            "item_id": item["id"],
        }
    scope = cast(dict[str, object], context["scope"])
    titles = {
        cast(str, item["chapter_id"]): cast(str, item["title"])
        for item in cast(list[dict[str, object]], context["chapters"])
    }
    issues: list[dict[str, object]] = []
    for index, issue in enumerate(reply.issues, start=1):
        refs = [basis[key] for key in dict.fromkeys(issue.basis) if key in basis]
        issues.append(
            {
                "id": f"I{index}",
                "severity": issue.severity,
                "title": issue.title,
                "explanation": issue.explanation,
                "direction": issue.direction,
                "location": map_location(scope, titles, issue.location.model_dump()),
                "basis": refs,
                "basis_status": "cited" if refs else "missing",
            }
        )
    sources = cast(dict[str, object], context["sources"])
    limitations = list(cast(list[str], rubric["limitations"]))
    if scope["chapter_id"] is not None:
        limitations.append("本次为章节评审，章节以外的内容未检查，不据此判断全文。")
    if not sources.get("template_parse_version_id") and not sources.get(
        "requirement_parse_version_ids"
    ):
        unchecked.append(
            {
                "item": "模板与论文要求",
                "reason": "项目未绑定模板或论文要求，问题依据只能来自量表。",
                "origin": "system",
            }
        )
    try:
        return ReviewReportContent.model_validate(
            {
                "schema_version": 1,
                "summary": reply.summary,
                "rubric": rubric,
                "scope": {"chapter_id": scope["chapter_id"], "title": scope["title"]},
                "scores": scores,
                "issues": issues,
                "unchecked": unchecked,
                "limitations": limitations,
            }
        )
    except ValidationError:
        raise _invalid_reply() from None


def commit_review_report_in_transaction(
    session: Session, job: Job, review_id: UUID, completion: ReviewCompletion
) -> dict[str, object]:
    run = review_for_job(session, job)
    if run.id != review_id:
        raise AppError("JOB_INPUT_INVALID", "评审执行标识与固定记录不一致。", 422)
    configuration = ConfigurationProbeConfiguration.model_validate(run.configuration_snapshot)
    if configuration.model is None or completion.requested_model != configuration.model.model_code:
        raise AppError("JOB_RESULT_INVALID", "评审结果的模型与固定配置不一致。", 422)
    version = session.get(DocumentVersion, (run.document_id, run.document_version))
    frozen_scope = cast(dict[str, object], run.context_snapshot["scope"])
    if version is None or extract_scope(version.content_json, run.chapter_id) != frozen_scope:
        raise AppError("JOB_INPUT_INVALID", "固定正文版本与评审范围不一致。", 422)
    existing = session.scalar(select(ReviewReport).where(ReviewReport.review_id == run.id))
    if existing is None:
        content = build_report(run.context_snapshot, completion)
        existing = ReviewReport(
            review_id=run.id,
            project_id=run.project_id,
            job_id=job.id,
            requested_model=completion.requested_model,
            response_model=completion.response_model,
            content=content.model_dump(mode="json"),
        )
        session.add(existing)
        session.flush()
    return {
        "report_id": existing.id,
        "document_id": run.document_id,
        "document_version": run.document_version,
    }
