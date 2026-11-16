"""Feedback decomposition transactions.

A split run freezes the batch original and an agent configuration chain. The worker stores
verified suggestions; only a student decision turns a suggestion into a formal feedback item.
"""

import json
from hashlib import sha256
from typing import Literal, cast
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs.models import AIConfigVersion
from thesis_pilot.modules.ai_configs.service import freeze_config_version_chain
from thesis_pilot.modules.feedback.models import FeedbackBatch, FeedbackItem
from thesis_pilot.modules.feedback.schemas import FeedbackContent, SourceRange
from thesis_pilot.modules.feedback.service import (
    append_version,
    batch,
    resolve_content,
)
from thesis_pilot.modules.feedback_splits.contracts import FEEDBACK_SPLIT_KIND, FeedbackSplitInput
from thesis_pilot.modules.feedback_splits.models import (
    FeedbackSplitDecision,
    FeedbackSplitRun,
    FeedbackSplitSuggestion,
)
from thesis_pilot.modules.feedback_splits.schemas import (
    MAX_SUGGESTIONS,
    FeedbackSplitCreate,
    FeedbackSplitDecide,
    FeedbackSplitPage,
    FeedbackSplitRead,
    FeedbackSplitReceipt,
    FeedbackSplitRetry,
    FeedbackSuggestionRead,
    SplitCompletion,
    SuggestionDecision,
    SuggestionHistoryRead,
)
from thesis_pilot.modules.feedback_splits.workflow import (
    SPLIT_CAPABILITY,
    SPLIT_ROLE,
    segments,
    utf16_length,
)
from thesis_pilot.modules.jobs.models import Job, JobAttempt, OutboxEvent
from thesis_pilot.modules.jobs.schemas import JobRead, JobStatus
from thesis_pilot.modules.revisions.anchors import utf16_bytes, utf16_slice
from thesis_pilot.modules.tasks.models import utcnow
from thesis_pilot.modules.tasks.service import project, remember, replay

STALE_SOURCE = "反馈原文已变化"
STALE_OVERLAP = "与已有解释项范围重叠"


def error(code: str, message: str, status: int = 409) -> AppError:
    return AppError("FEEDBACK_SPLIT_" + code, message, status)


def original_digest(text: str) -> str:
    return sha256(text.encode()).hexdigest()


def _hash(operation: str, project_id: UUID, payload: object) -> str:
    return sha256(
        json.dumps(
            {"operation": operation, "project_id": str(project_id), "input": payload},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()
    ).hexdigest()


def _job_digest(run: FeedbackSplitRun, source_job_id: UUID | None) -> str:
    return sha256(
        json.dumps(
            {
                "kind": FEEDBACK_SPLIT_KIND,
                "project_id": str(run.project_id),
                "split_id": str(run.id),
                "batch_id": str(run.batch_id),
                "source_job_id": str(source_job_id) if source_job_id else None,
                "original_sha256": run.original_sha256,
                "context_snapshot": run.context_snapshot,
                "configuration_snapshot": run.configuration_snapshot,
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode()
    ).hexdigest()


def _run(session: Session, project_id: UUID, split_id: UUID) -> FeedbackSplitRun:
    found = session.scalar(
        select(FeedbackSplitRun).where(
            FeedbackSplitRun.id == split_id, FeedbackSplitRun.project_id == project_id
        )
    )
    if found is None:
        raise error("NOT_FOUND", "项目中没有该拆解记录。", 404)
    return found


def _job(session: Session, run: FeedbackSplitRun) -> Job:
    job = session.get(Job, run.job_id) if run.job_id else None
    if job is None or job.project_id != run.project_id or job.kind != FEEDBACK_SPLIT_KIND:
        raise error("RUN_INVALID", "拆解记录与执行任务不一致。")
    return job


def _check_agent(configuration: dict[str, object]) -> None:
    agent, model = configuration.get("agent"), configuration.get("model")
    if (
        configuration.get("config_kind") != "agent"
        or not isinstance(agent, dict)
        or agent.get("role") != SPLIT_ROLE
        or not isinstance(model, dict)
        or SPLIT_CAPABILITY not in cast(list[str], model.get("capabilities") or [])
    ):
        raise error(
            "AGENT_INVALID", "请选择已启用、角色为内容助手且模型具备文本能力的智能体。", 422
        )


def _freeze(
    session: Session, original: FeedbackBatch, agent_version_id: UUID
) -> tuple[dict[str, object], dict[str, object]]:
    configuration = freeze_config_version_chain(session, agent_version_id)
    _check_agent(configuration)
    agent_version = session.get(AIConfigVersion, agent_version_id)
    context: dict[str, object] = {
        "schema_version": 1,
        "batch_id": str(original.id),
        "original_sha256": original_digest(original.original_text),
        "utf16_length": utf16_length(original.original_text),
        "segments": segments(original.original_text),
        "agent": {
            "name": agent_version.name if agent_version else "",
            "version": agent_version.version if agent_version else 0,
        },
    }
    return context, configuration


def _assert_idle(session: Session, batch_id: UUID) -> None:
    active = session.scalar(
        select(FeedbackSplitRun.id)
        .join(Job, Job.id == FeedbackSplitRun.job_id)
        .where(FeedbackSplitRun.batch_id == batch_id, Job.status.in_(["queued", "running"]))
        .limit(1)
    )
    if active is not None:
        raise error("BUSY", "这次反馈已有整理在进行，请等待完成或取消后再发起。")


def _previous(
    session: Session, project_id: UUID, command_id: UUID, digest: str
) -> FeedbackSplitRun | None:
    run = session.scalar(select(FeedbackSplitRun).where(FeedbackSplitRun.command_id == command_id))
    if run is None:
        return None
    if run.project_id != project_id or run.request_hash != digest:
        raise error("COMMAND_CONFLICT", "整理命令已用于不同请求，请核对原整理记录。")
    return run


def _new_run(
    session: Session,
    original: FeedbackBatch,
    agent_version_id: UUID,
    context: dict[str, object],
    configuration: dict[str, object],
    command_id: UUID,
    digest: str,
    source: FeedbackSplitRun | None = None,
    source_job_id: UUID | None = None,
) -> FeedbackSplitRun:
    run = FeedbackSplitRun(
        project_id=original.project_id,
        batch_id=original.id,
        command_id=command_id,
        request_hash=digest,
        original_sha256=cast(str, context["original_sha256"]),
        agent_config_version_id=agent_version_id,
        context_snapshot=context,
        configuration_snapshot=configuration,
        source_split_id=source.id if source else None,
    )
    session.add(run)
    session.flush()
    fixed = FeedbackSplitInput(split_id=run.id).model_dump(mode="json")
    job = Job(
        project_id=original.project_id,
        kind=FEEDBACK_SPLIT_KIND,
        idempotency_key="feedback-split:" + str(command_id),
        request_hash=_job_digest(run, source_job_id),
        input_snapshot=fixed,
        resource_scope=fixed.copy(),
        configuration=None,
        source_job_id=source_job_id,
    )
    session.add(job)
    session.flush()
    session.add(OutboxEvent(job_id=job.id))
    run.job_id = job.id
    session.flush()
    return run


# --- Read model -------------------------------------------------------------------------


def _active_items(session: Session, batch_id: UUID) -> list[FeedbackItem]:
    return list(
        session.scalars(
            select(FeedbackItem).where(
                FeedbackItem.batch_id == batch_id, FeedbackItem.status != "withdrawn"
            )
        )
    )


def _item_range(row: FeedbackItem) -> tuple[int, int]:
    source = cast(dict[str, object], row.content["source_range"])
    return cast(int, source["from"]), cast(int, source["to"])


def _stale_reasons(
    run: FeedbackSplitRun,
    original: FeedbackBatch,
    suggestion: FeedbackSplitSuggestion,
    items: list[FeedbackItem],
) -> list[str]:
    reasons: list[str] = []
    if original_digest(original.original_text) != run.original_sha256:
        reasons.append(STALE_SOURCE)
    for row in items:
        start, end = _item_range(row)
        if start < suggestion.range_to and suggestion.range_from < end:
            reasons.append(STALE_OVERLAP)
            break
    return reasons


def _decisions(session: Session, ids: list[UUID]) -> dict[UUID, list[FeedbackSplitDecision]]:
    result: dict[UUID, list[FeedbackSplitDecision]] = {value: [] for value in ids}
    if not ids:
        return result
    for row in session.scalars(
        select(FeedbackSplitDecision)
        .where(FeedbackSplitDecision.suggestion_id.in_(ids))
        .order_by(FeedbackSplitDecision.suggestion_id, FeedbackSplitDecision.version)
    ):
        result[row.suggestion_id].append(row)
    return result


def _state(
    history: list[FeedbackSplitDecision],
) -> tuple[Literal["pending", "adopted", "rejected"], UUID | None]:
    if not history:
        return "pending", None
    last = history[-1]
    if last.action in {"adopt", "adopt_modified"}:
        return "adopted", last.feedback_item_id
    if last.action == "reject":
        return "rejected", None
    return "pending", None


def _suggestions(session: Session, run: FeedbackSplitRun) -> list[FeedbackSplitSuggestion]:
    return list(
        session.scalars(
            select(FeedbackSplitSuggestion)
            .where(FeedbackSplitSuggestion.split_id == run.id)
            .order_by(FeedbackSplitSuggestion.position)
        )
    )


def _read(session: Session, run: FeedbackSplitRun) -> FeedbackSplitRead:
    job = _job(session, run)
    original = session.get(FeedbackBatch, run.batch_id)
    if original is None or original.project_id != run.project_id:
        raise error("RUN_INVALID", "拆解记录与反馈原文不一致。")
    rows = _suggestions(session, run) if job.status == "succeeded" else []
    histories = _decisions(session, [row.id for row in rows])
    items = _active_items(session, run.batch_id) if rows else []
    suggestions: list[FeedbackSuggestionRead] = []
    for row in rows:
        history = histories[row.id]
        state, item_id = _state(history)
        others = [item for item in items if item.id != item_id]
        reasons = _stale_reasons(run, original, row, others) if state == "pending" else []
        suggestions.append(
            FeedbackSuggestionRead(
                id=row.id,
                position=row.position,
                source_range=SourceRange.model_validate(
                    {"from": row.range_from, "to": row.range_to, "text": row.range_text}
                ),
                interpretation=row.interpretation,
                certainty=cast(Literal["certain", "uncertain"], row.certainty),
                ambiguous=row.ambiguous,
                task_title=row.task_title,
                state=state,
                version=len(history),
                feedback_item_id=item_id,
                stale=bool(reasons),
                stale_reasons=reasons,
                history=[
                    SuggestionHistoryRead(
                        version=value.version,
                        action=cast(
                            Literal["adopt", "adopt_modified", "reject", "undo"], value.action
                        ),
                        feedback_item_id=value.feedback_item_id,
                        reason=value.reason,
                        created_at=value.created_at,
                    )
                    for value in history
                ],
            )
        )
    agent = cast(dict[str, object], run.context_snapshot["agent"])
    version_ids = cast(dict[str, str], run.configuration_snapshot["version_ids"])
    result = cast(dict[str, object], job.result or {}) if job.status == "succeeded" else {}
    return FeedbackSplitRead(
        id=run.id,
        project_id=run.project_id,
        batch_id=run.batch_id,
        job_id=job.id,
        status=cast(JobStatus, job.status),
        error_code=job.error_code,
        attempt=job.attempt,
        agent_config_version_id=run.agent_config_version_id,
        agent_name=f"{agent['name']} · v{agent['version']}",
        config_version_ids={key: UUID(value) for key, value in version_ids.items()},
        source_split_id=run.source_split_id,
        requested_model=cast(str | None, result.get("requested_model")),
        response_model=cast(str | None, result.get("response_model")),
        note=cast(str, result.get("note", "")),
        suggestions=suggestions,
        created_at=run.created_at,
        updated_at=job.updated_at,
    )


def _receipt(session: Session, run: FeedbackSplitRun) -> FeedbackSplitReceipt:
    return FeedbackSplitReceipt(
        split=_read(session, run), job=JobRead.model_validate(_job(session, run))
    )


# --- Commands ---------------------------------------------------------------------------


def create_split(
    session: Session, project_id: UUID, batch_id: UUID, data: FeedbackSplitCreate
) -> FeedbackSplitReceipt:
    payload = {"batch_id": str(batch_id), "agent": str(data.agent_config_version_id)}
    digest = _hash("create", project_id, payload)
    try:
        with session.begin():
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
            project(session, project_id, lock=True)
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
            original = batch(session, project_id, batch_id)
            _assert_idle(session, batch_id)
            context, configuration = _freeze(session, original, data.agent_config_version_id)
            run = _new_run(
                session,
                original,
                data.agent_config_version_id,
                context,
                configuration,
                data.command_id,
                digest,
            )
            return _receipt(session, run)
    except IntegrityError:
        with session.begin():
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
        raise


def list_splits(
    session: Session, project_id: UUID, batch_id: UUID, *, limit: int, offset: int
) -> FeedbackSplitPage:
    with session.begin():
        batch(session, project_id, batch_id)
        query = select(FeedbackSplitRun).where(
            FeedbackSplitRun.project_id == project_id, FeedbackSplitRun.batch_id == batch_id
        )
        total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = session.scalars(
            query.order_by(FeedbackSplitRun.created_at.desc(), FeedbackSplitRun.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return FeedbackSplitPage(
            items=[_read(session, row) for row in rows], total=total, limit=limit, offset=offset
        )


def get_split(session: Session, project_id: UUID, split_id: UUID) -> FeedbackSplitRead:
    with session.begin():
        return _read(session, _run(session, project_id, split_id))


def cancel_split(session: Session, project_id: UUID, split_id: UUID) -> FeedbackSplitRead:
    from thesis_pilot.modules.jobs.service import _cancel_in_transaction, _lock_job

    with session.begin():
        run = _run(session, project_id, split_id)
        job = _lock_job(session, _job(session, run).id)
        if job is None:
            raise error("RUN_INVALID", "拆解记录与执行任务不一致。")
        _cancel_in_transaction(session, job.id, project_id=project_id)
        return _read(session, run)


def _retry_budget(session: Session, source: FeedbackSplitRun) -> None:
    api = source.configuration_snapshot.get("api")
    budget = api.get("max_retries", 0) if isinstance(api, dict) else 0
    if type(budget) is not int or not 0 <= budget <= 3:
        raise error("RUN_INVALID", "重试预算配置无效。")
    if budget == 0:
        raise AppError("MODEL_RETRY_LIMIT_REACHED", "该固定配置不允许重试。", 409)
    root = lineage_root(session, source)
    retries, pending = 0, [root.id]
    while pending:
        pending = list(
            session.scalars(
                select(FeedbackSplitRun.id)
                .where(FeedbackSplitRun.source_split_id.in_(pending))
                .limit(budget + 1)
            )
        )
        retries += len(pending)
        if retries >= budget:
            raise AppError("MODEL_RETRY_LIMIT_REACHED", "已达到该固定配置的显式重试次数。", 409)


def lineage_root(session: Session, run: FeedbackSplitRun) -> FeedbackSplitRun:
    root, seen = run, {run.id}
    while root.source_split_id is not None:
        parent = session.get(FeedbackSplitRun, root.source_split_id)
        if parent is None or parent.project_id != run.project_id or parent.id in seen:
            raise AppError("JOB_INPUT_INVALID", "拆解重试来源链无效。", 422)
        if len(seen) >= 100:
            raise AppError("JOB_INPUT_INVALID", "拆解重试来源链过长。", 422)
        seen.add(parent.id)
        root = parent
    return root


def retry_split(
    session: Session, project_id: UUID, split_id: UUID, data: FeedbackSplitRetry
) -> FeedbackSplitReceipt:
    digest = _hash("retry", project_id, {"split_id": str(split_id)})
    try:
        with session.begin():
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
            project(session, project_id, lock=True)
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
            original_run = _run(session, project_id, split_id)
            old_job = _job(session, original_run)
            if old_job.status not in {"failed", "cancelled"}:
                raise error("RETRY_INVALID", "只能重试失败或已取消的整理。")
            original = batch(session, project_id, original_run.batch_id)
            _assert_idle(session, original.id)
            _retry_budget(session, original_run)
            if original_digest(original.original_text) != original_run.original_sha256:
                raise error("CONTEXT_STALE", "反馈原文已变化，请重新发起整理。")
            # Exact fixed inputs only; a disabled or edited agent is never silently replaced.
            if (
                freeze_config_version_chain(session, original_run.agent_config_version_id)
                != original_run.configuration_snapshot
            ):
                raise error("CONTEXT_STALE", "整理智能体配置已变化或停用，请重新发起整理。")
            run = _new_run(
                session,
                original,
                original_run.agent_config_version_id,
                original_run.context_snapshot,
                original_run.configuration_snapshot,
                data.command_id,
                digest,
                original_run,
                old_job.id,
            )
            return _receipt(session, run)
    except IntegrityError:
        with session.begin():
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
        raise


def suggested_content(row: FeedbackSplitSuggestion) -> FeedbackContent:
    """Adopting as is: the student confirms the range; ambiguity stays visibly uncertain."""
    return FeedbackContent.model_validate(
        {
            "source_range": {"from": row.range_from, "to": row.range_to, "text": row.range_text},
            "interpretation": row.interpretation,
            "certainty": "uncertain"
            if row.ambiguous or row.certainty == "uncertain"
            else "certain",
            "correction": "",
            "source_checked": True,
            "task_id": None,
            "new_task": None,
            "evidence": [],
        }
    )


def _decide_one(
    session: Session,
    owner_id: UUID,
    run: FeedbackSplitRun,
    original: FeedbackBatch,
    row: FeedbackSplitSuggestion,
    history: list[FeedbackSplitDecision],
    decision: SuggestionDecision,
) -> None:
    from thesis_pilot.modules.feedback.service import item as feedback_item
    from thesis_pilot.modules.projects.models import Project

    if len(history) != decision.expected_version:
        raise error("VERSION_CONFLICT", "拆解建议已被决定或撤销，请重新读取。")
    state, item_id = _state(history)
    action: str = decision.action
    created: UUID | None = None
    if decision.action in {"adopt", "reject"} and state != "pending":
        raise error("DECISION_INVALID", "这条建议已经决定，请先撤销再重新决定。")
    if decision.action == "undo" and state == "pending":
        raise error("DECISION_INVALID", "这条建议尚未决定，无需撤销。")
    if decision.action == "adopt":
        reasons = _stale_reasons(run, original, row, _active_items(session, original.id))
        if reasons:
            raise error("SUGGESTION_STALE", f"建议已过期：{'、'.join(reasons)}。请改为手动整理。")
        default = suggested_content(row)
        content = decision.content or default
        if (
            content.source_range.from_position != row.range_from
            or content.source_range.to != row.range_to
            or content.source_range.text != row.range_text
        ):
            raise error("RANGE_INVALID", "采纳时原文范围必须与建议一致；调整范围请手动整理。", 422)
        if content != default:
            action = "adopt_modified"
        owner = session.get(Project, owner_id)
        assert owner is not None
        content = resolve_content(session, owner, original, content)
        count = (
            session.scalar(
                select(func.count())
                .select_from(FeedbackItem)
                .where(FeedbackItem.batch_id == original.id)
            )
            or 0
        )
        if count >= 200:
            raise AppError("FEEDBACK_LIMIT_REACHED", "每批原文最多200个解释项。", 422)
        from thesis_pilot.modules.tasks.evidence import resolve_evidence

        snapshots = resolve_evidence(session, owner_id, content.evidence)
        item_row = FeedbackItem(
            batch_id=original.id,
            project_id=owner_id,
            version=1,
            status="open",
            origin="ai_suggested",
            content=content.model_dump(mode="json"),
            evidence_snapshots=[value.model_dump(mode="json") for value in snapshots],
        )
        session.add(item_row)
        append_version(session, item_row, "adopt", decision.reason)
        created = item_row.id
    elif decision.action == "undo" and state == "adopted":
        if item_id is None:
            raise error("RUN_INVALID", "采纳记录缺少对应解释项。")
        adopted = feedback_item(session, owner_id, item_id)
        if adopted.status != "open" or adopted.version != 1:
            raise error("UNDO_BLOCKED", "解释项在采纳后已修改或标记处理，请直接在该解释项中调整。")
        adopted.status = "withdrawn"
        adopted.version += 1
        adopted.updated_at = utcnow()
        append_version(session, adopted, "withdraw", decision.reason)
        created = adopted.id
    session.add(
        FeedbackSplitDecision(
            suggestion_id=row.id,
            version=len(history) + 1,
            project_id=owner_id,
            action=action,
            feedback_item_id=created,
            reason=decision.reason,
        )
    )
    session.flush()


def decide(
    session: Session, project_id: UUID, split_id: UUID, data: FeedbackSplitDecide
) -> FeedbackSplitRead:
    operation = f"feedback.split.decide:{split_id}"
    with session.begin():
        project(session, project_id, lock=True)
        old = replay(session, project_id, operation, data, FeedbackSplitRead)
        if old:
            return old
        run = _run(session, project_id, split_id)
        if _job(session, run).status != "succeeded":
            raise error("NOT_READY", "整理尚未完成，没有可决定的建议。")
        original = batch(session, project_id, run.batch_id)
        rows = {row.id: row for row in _suggestions(session, run)}
        histories = _decisions(session, list(rows))
        for decision in data.decisions:
            row = rows.get(decision.suggestion_id)
            if row is None:
                raise error("NOT_FOUND", "拆解建议不存在。", 404)
            _decide_one(session, project_id, run, original, row, histories[row.id], decision)
        result = _read(session, run)
        remember(session, project_id, operation, data, result)
        return result


# --- Execution boundary used by the worker inside its own transactions ------------------


def split_for_job(session: Session, job: Job) -> FeedbackSplitRun:
    try:
        source = FeedbackSplitInput.model_validate(job.input_snapshot)
    except ValidationError:
        raise AppError("JOB_INPUT_INVALID", "拆解任务固定输入无效。", 422) from None
    run = session.get(FeedbackSplitRun, source.split_id)
    if (
        job.kind != FEEDBACK_SPLIT_KIND
        or run is None
        or run.project_id != job.project_id
        or run.job_id != job.id
        or job.configuration is not None
        or job.resource_scope != source.model_dump(mode="json")
        or job.request_hash != _job_digest(run, job.source_job_id)
    ):
        raise AppError("JOB_INPUT_INVALID", "拆解任务与固定记录不一致。", 422)
    return run


def lineage_attempts(session: Session, run: FeedbackSplitRun) -> int:
    root = lineage_root(session, run)
    ids, pending = {root.id}, [root.id]
    while pending:
        found = list(
            session.scalars(
                select(FeedbackSplitRun.id)
                .where(FeedbackSplitRun.source_split_id.in_(pending))
                .limit(101)
            )
        )
        if ids.intersection(found) or len(ids) + len(found) > 100:
            raise AppError("JOB_INPUT_INVALID", "拆解重试来源树无效。", 422)
        ids.update(found)
        pending = found
    return (
        session.scalar(
            select(func.count())
            .select_from(JobAttempt)
            .join(FeedbackSplitRun, FeedbackSplitRun.job_id == JobAttempt.job_id)
            .where(FeedbackSplitRun.id.in_(ids))
        )
        or 0
    )


def load_snapshot_in_transaction(session: Session, job: Job, split_id: UUID) -> dict[str, object]:
    if not session.in_transaction():
        raise RuntimeError("Split snapshot requires the caller's transaction")
    run = split_for_job(session, job)
    if run.id != split_id:
        raise AppError("JOB_INPUT_INVALID", "拆解执行标识与固定记录不一致。", 422)
    return {
        "split_id": str(run.id),
        "context_snapshot": run.context_snapshot,
        "configuration_snapshot": run.configuration_snapshot,
    }


def verify_reply(original_text: str, completion: SplitCompletion) -> list[dict[str, object]]:
    """All-or-nothing range verification against the frozen original."""
    encoded = utf16_bytes(original_text)
    items = sorted(completion.reply.items, key=lambda value: value.from_position)
    if len(items) > MAX_SUGGESTIONS:
        raise AppError("MODEL_INVALID_RESPONSE", "模型拆解条目过多。", 422)
    verified: list[dict[str, object]] = []
    previous_end = 0
    for value in items:
        if value.from_position >= value.to or value.to * 2 > len(encoded):
            raise error("RANGE_INVALID", "模型给出的原文区间超出原文。", 422)
        try:
            text = utf16_slice(encoded, value.from_position, value.to)
        except AppError:
            raise error("RANGE_INVALID", "模型给出的原文区间截断了字符。", 422) from None
        if text != value.text:
            raise error("RANGE_INVALID", "模型给出的原文片段与原文不一致。", 422)
        if value.from_position < previous_end:
            raise error("RANGE_OVERLAP", "模型给出的原文区间相互重叠。", 422)
        previous_end = value.to
        verified.append(
            {
                "range_from": value.from_position,
                "range_to": value.to,
                "range_text": value.text,
                "interpretation": value.interpretation.strip(),
                "certainty": "uncertain" if value.ambiguous else value.certainty,
                "ambiguous": value.ambiguous,
                "task_title": value.task_title,
            }
        )
    return verified


def commit_suggestions_in_transaction(
    session: Session, job: Job, split_id: UUID, completion: SplitCompletion
) -> tuple[FeedbackSplitRun, int]:
    from thesis_pilot.modules.jobs.schemas import ConfigurationProbeConfiguration

    run = split_for_job(session, job)
    if run.id != split_id:
        raise AppError("JOB_INPUT_INVALID", "拆解执行标识与固定记录不一致。", 422)
    configuration = ConfigurationProbeConfiguration.model_validate(run.configuration_snapshot)
    if configuration.model is None or completion.requested_model != configuration.model.model_code:
        raise AppError("JOB_RESULT_INVALID", "拆解结果的模型与固定配置不一致。", 422)
    original = session.get(FeedbackBatch, run.batch_id)
    if original is None or original_digest(original.original_text) != run.original_sha256:
        raise error("SOURCE_CHANGED", "反馈原文与发起整理时不一致。")
    existing = (
        session.scalar(
            select(func.count())
            .select_from(FeedbackSplitSuggestion)
            .where(FeedbackSplitSuggestion.split_id == run.id)
        )
        or 0
    )
    if existing:
        return run, existing
    verified = verify_reply(original.original_text, completion)
    for position, values in enumerate(verified):
        session.add(
            FeedbackSplitSuggestion(
                split_id=run.id,
                project_id=run.project_id,
                batch_id=run.batch_id,
                job_id=job.id,
                position=position,
                **values,
            )
        )
    session.flush()
    return run, len(verified)
