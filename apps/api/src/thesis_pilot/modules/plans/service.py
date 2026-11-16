"""Plan versions and AI adjustment candidates.

Only three paths change task dates here: adopting selected candidate items, reverting an
adoption, and a student's manual batch adjustment. Each runs in one transaction under the
project lock, checks every touched task version (CAS) and the deterministic constraints, and
appends one immutable plan version. Candidates themselves never write a task.
"""

import json
import re
from datetime import date, datetime
from hashlib import sha256
from typing import cast
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs.service import freeze_config_version_chain
from thesis_pilot.modules.jobs.models import Job, OutboxEvent
from thesis_pilot.modules.jobs.schemas import (
    ConfigurationProbeConfiguration,
    JobRead,
    JobStatus,
    PlanAdjustmentInput,
)
from thesis_pilot.modules.notifications.derivation import local_today
from thesis_pilot.modules.plans.constraints import (
    Proposed,
    TaskFacts,
    check_changes,
    consistent_subset,
)
from thesis_pilot.modules.plans.models import (
    PlanAdjustment,
    PlanDecision,
    PlanProposal,
    PlanVersion,
    utcnow,
)
from thesis_pilot.modules.plans.schemas import (
    AdjustmentState,
    DateRange,
    PlanAdjustmentCreate,
    PlanAdjustmentDecide,
    PlanAdjustmentItem,
    PlanAdjustmentPage,
    PlanAdjustmentRead,
    PlanAdjustmentReceipt,
    PlanAdjustmentRevert,
    PlanChange,
    PlanCompletion,
    PlanDecisionRead,
    PlanProposalContent,
    PlanRead,
    PlanSchedule,
    PlanTaskState,
    PlanVersionPage,
    PlanVersionRead,
)
from thesis_pilot.modules.project_flows.models import ProjectFlowVersion
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.tasks.models import ProjectTask
from thesis_pilot.modules.tasks.models import utcnow as task_now
from thesis_pilot.modules.tasks.schemas import TaskContent
from thesis_pilot.modules.tasks.service import append_version, remember, replay, validate_dates

MAX_OPEN_TASKS = 100
NOTE_NO_PLANNING = "未填写个人规划：建议只依据任务、依赖与截止，不推测你的效率或可用时间。"


def error(code: str, message: str, status: int = 409) -> AppError:
    return AppError("PLAN_" + code, message, status)


def _project(session: Session, project_id: UUID, *, lock: bool = False) -> Project:
    query = select(Project).where(Project.id == project_id)
    owner = session.scalar(query.with_for_update() if lock else query)
    if owner is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
    if lock and owner.archived:
        raise error("PROJECT_ARCHIVED", "归档项目不能调整计划。")
    return owner


def _rows(session: Session, project_id: UUID) -> list[ProjectTask]:
    return list(
        session.scalars(
            select(ProjectTask)
            .where(ProjectTask.project_id == project_id)
            .order_by(ProjectTask.position, ProjectTask.id)
        )
    )


def _state(row: ProjectTask) -> PlanTaskState:
    content = TaskContent.model_validate(row.content)
    return PlanTaskState(
        task_id=row.id,
        version=row.version,
        position=row.position,
        title=content.title,
        status=row.status,  # type: ignore[arg-type]
        archived=content.archived,
        start_date=content.start_date,
        due_date=content.due_date,
        hard_deadline=content.hard_deadline,
        depends_on=content.depends_on,
    )


def _facts(states: list[PlanTaskState]) -> dict[UUID, TaskFacts]:
    return {
        item.task_id: TaskFacts(
            task_id=item.task_id,
            title=item.title,
            version=item.version,
            status=item.status,
            archived=item.archived,
            start_date=item.start_date,
            due_date=item.due_date,
            hard_deadline=item.hard_deadline,
            depends_on=tuple(item.depends_on),
        )
        for item in states
    }


def _plan_version(session: Session, project_id: UUID) -> int:
    return (
        session.scalar(
            select(func.max(PlanVersion.version)).where(PlanVersion.project_id == project_id)
        )
        or 0
    )


def _violation_message(
    facts: dict[UUID, TaskFacts], found: dict[UUID, list[tuple[str, str]]]
) -> str:
    parts = []
    for task_id, items in list(found.items())[:3]:
        title = facts[task_id].title if task_id in facts else "未知任务"
        parts.append(f"「{title}」{items[0][1]}")
    more = f"等 {len(found)} 项" if len(found) > 3 else ""
    return "调整未通过计划约束检查：" + "；".join(parts) + more + " 原计划保持不变。"


def _apply(
    session: Session,
    owner: Project,
    changes: dict[UUID, Proposed],
    expected: dict[UUID, int],
    *,
    action: str,
    reason: str,
    adjustment_id: UUID | None,
    today: date | None,
    stale_code: str,
) -> PlanVersion:
    """CAS every touched task, verify all constraints on the whole set, then write atomically."""
    rows = _rows(session, owner.id)
    by_id = {row.id: row for row in rows}
    for task_id, version in expected.items():
        row = by_id.get(task_id)
        if row is None:
            raise error("TASK_NOT_FOUND", "计划涉及的任务不存在或不属于本项目。", 404)
        if row.version != version:
            raise error(stale_code, "相关任务已变化，本次调整整体未写入，请按当前计划重新核对。")
    states = [_state(row) for row in rows]
    facts = _facts(states)
    found = check_changes(facts, changes, owner.deadline, today)
    if found:
        raise error("CONSTRAINT_VIOLATION", _violation_message(facts, found), 422)
    recorded: list[PlanChange] = []
    instant = task_now()
    for task_id, change in changes.items():
        row = by_id[task_id]
        before = TaskContent.model_validate(row.content)
        try:
            content = TaskContent.model_validate(
                {
                    **before.model_dump(mode="json"),
                    "start_date": change.start_date.isoformat() if change.start_date else None,
                    "due_date": change.due_date.isoformat() if change.due_date else None,
                }
            )
        except ValidationError:
            raise error(
                "CONSTRAINT_VIOLATION",
                f"「{before.title}」的开始、预计完成与硬截止顺序无效，原计划保持不变。",
                422,
            ) from None
        try:
            validate_dates(content, owner.deadline)
        except AppError:
            raise error(
                "CONSTRAINT_VIOLATION", f"「{before.title}」越过项目截止，原计划保持不变。", 422
            ) from None
        previous_version = row.version
        row.content = content.model_dump(mode="json")
        row.version += 1
        row.updated_at = instant
        append_version(session, row, "plan_" + action, reason)
        recorded.append(
            PlanChange(
                task_id=task_id,
                title=before.title,
                before=DateRange(start_date=before.start_date, due_date=before.due_date),
                after=DateRange(start_date=content.start_date, due_date=content.due_date),
                before_version=previous_version,
                after_version=row.version,
            )
        )
    session.flush()
    appended = PlanVersion(
        project_id=owner.id,
        version=_plan_version(session, owner.id) + 1,
        action=action,
        reason=reason,
        adjustment_id=adjustment_id,
        changes=[item.model_dump(mode="json") for item in recorded],
        tasks=[_state(row).model_dump(mode="json") for row in _rows(session, owner.id)],
        created_at=utcnow(),
    )
    session.add(appended)
    session.flush()
    return appended


def _version_read(row: PlanVersion) -> PlanVersionRead:
    return PlanVersionRead(
        project_id=row.project_id,
        version=row.version,
        action=row.action,  # type: ignore[arg-type]
        reason=row.reason,
        adjustment_id=row.adjustment_id,
        changes=[PlanChange.model_validate(item) for item in row.changes],
        tasks=[PlanTaskState.model_validate(item) for item in row.tasks],
        created_at=row.created_at,
    )


# --- Plan state and manual batch adjustment.
def get_plan(session: Session, project_id: UUID) -> PlanRead:
    with session.begin():
        owner = _project(session, project_id)
        latest = session.scalar(
            select(PlanAdjustment.id)
            .where(PlanAdjustment.project_id == project_id)
            .order_by(PlanAdjustment.created_at.desc(), PlanAdjustment.id.desc())
            .limit(1)
        )
        return PlanRead(
            project_id=project_id,
            plan_version=_plan_version(session, project_id),
            deadline=owner.deadline,
            planning_mode=owner.planning_mode,  # type: ignore[arg-type]
            latest_adjustment_id=latest,
        )


def list_versions(
    session: Session, project_id: UUID, *, limit: int, offset: int
) -> PlanVersionPage:
    with session.begin():
        _project(session, project_id)
        query = select(PlanVersion).where(PlanVersion.project_id == project_id)
        rows = session.scalars(
            query.order_by(PlanVersion.version.desc()).limit(limit).offset(offset)
        ).all()
        return PlanVersionPage(
            items=[_version_read(row) for row in rows],
            total=session.scalar(select(func.count()).select_from(query.subquery())) or 0,
            limit=limit,
            offset=offset,
        )


def schedule(session: Session, project_id: UUID, data: PlanSchedule) -> PlanVersionRead:
    with session.begin():
        owner = _project(session, project_id, lock=True)
        old = replay(session, project_id, "plan.schedule", data, PlanVersionRead)
        if old:
            return old
        changes = {item.task_id: Proposed(item.start_date, item.due_date) for item in data.changes}
        expected = {item.task_id: item.expected_version for item in data.changes}
        version = _apply(
            session,
            owner,
            changes,
            expected,
            action="manual",
            reason=data.reason.strip() or "学生手动调整计划",
            adjustment_id=None,
            today=None,
            stale_code="TASK_STALE",
        )
        result = _version_read(version)
        remember(session, project_id, "plan.schedule", data, result)
        return result


# --- Adjustment candidates.
def _hash(operation: str, project_id: UUID, payload: object) -> str:
    return sha256(
        json.dumps(
            {"operation": operation, "project_id": str(project_id), "input": payload},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()
    ).hexdigest()


def _job_digest(adjustment: PlanAdjustment) -> str:
    return sha256(
        json.dumps(
            {
                "kind": "plan_adjustment",
                "project_id": str(adjustment.project_id),
                "adjustment_id": str(adjustment.id),
                "input_snapshot": adjustment.input_snapshot,
                "configuration_snapshot": adjustment.configuration_snapshot,
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode()
    ).hexdigest()


def _check_agent(configuration: dict[str, object]) -> None:
    agent, model = configuration.get("agent"), configuration.get("model")
    if (
        configuration.get("config_kind") != "agent"
        or not isinstance(agent, dict)
        or agent.get("role") != "progress"
        or not isinstance(model, dict)
        or "plan" not in cast(list[str], model.get("capabilities") or [])
    ):
        raise error("AGENT_INVALID", "请选择已启用、角色为进度且模型具备计划能力的智能体。", 422)


def _stage(session: Session, owner: Project) -> dict[str, object] | None:
    if owner.flow_version_id is None or owner.stage_id is None:
        return None
    version = session.get(ProjectFlowVersion, owner.flow_version_id)
    stages = cast(list[dict[str, object]], version.stages if version else [])
    name = next((item.get("name") for item in stages if item.get("id") == owner.stage_id), None)
    return {"stage_id": owner.stage_id, "name": name}


def _freeze(
    session: Session, owner: Project, today: date, agent: dict[str, object]
) -> dict[str, object]:
    states = [_state(row) for row in _rows(session, owner.id)]
    open_tasks = [item for item in states if not item.archived and item.status != "confirmed"]
    if not open_tasks:
        raise error("NO_OPEN_TASKS", "没有可调整的未完成任务，原计划保持不变。", 422)
    if len([item for item in states if not item.archived]) > MAX_OPEN_TASKS:
        raise error("SCOPE_TOO_LARGE", "未归档任务超过 100 项，请先归档不再需要的任务。", 413)
    return {
        "schema_version": 1,
        "today": today.isoformat(),
        "deadline": owner.deadline.isoformat() if owner.deadline else None,
        "plan_version": _plan_version(session, owner.id),
        "stage": _stage(session, owner),
        "planning": {
            "mode": owner.planning_mode,
            "note": owner.plan_note if owner.planning_mode == "personal" else "",
        },
        "agent": agent,
        "tasks": [
            {"key": f"T{index}", **item.model_dump(mode="json")}
            for index, item in enumerate(states, start=1)
        ],
    }


def _fingerprint(tasks: list[dict[str, object]], deadline: object) -> str:
    pairs = sorted((str(item["task_id"]), cast(int, item["version"])) for item in tasks)
    return json.dumps({"tasks": pairs, "deadline": deadline}, separators=(",", ":"))


def _current_fingerprint(session: Session, project_id: UUID) -> str:
    owner = session.get(Project, project_id)
    rows = session.execute(
        select(ProjectTask.id, ProjectTask.version).where(ProjectTask.project_id == project_id)
    ).all()
    tasks: list[dict[str, object]] = [{"task_id": str(i), "version": v} for i, v in rows]
    deadline = owner.deadline.isoformat() if owner and owner.deadline else None
    return _fingerprint(tasks, deadline)


def _stale(adjustment: PlanAdjustment, current: str) -> bool:
    snapshot = adjustment.input_snapshot
    tasks = cast(list[dict[str, object]], snapshot["tasks"])
    return _fingerprint(tasks, snapshot["deadline"]) != current


def _job(session: Session, adjustment: PlanAdjustment) -> Job:
    job = session.get(Job, adjustment.job_id) if adjustment.job_id else None
    if job is None or job.project_id != adjustment.project_id or job.kind != "plan_adjustment":
        raise error("RUN_INVALID", "计划调整记录与执行任务不一致。")
    return job


def _adjustment(session: Session, project_id: UUID, adjustment_id: UUID) -> PlanAdjustment:
    found = session.scalar(
        select(PlanAdjustment).where(
            PlanAdjustment.id == adjustment_id, PlanAdjustment.project_id == project_id
        )
    )
    if found is None:
        raise error("ADJUSTMENT_NOT_FOUND", "项目中没有该计划调整。", 404)
    return found


def _decisions(session: Session, adjustment_id: UUID) -> dict[str, PlanDecision]:
    rows = session.scalars(
        select(PlanDecision).where(PlanDecision.adjustment_id == adjustment_id)
    ).all()
    return {row.action: row for row in rows}


def _decision_read(row: PlanDecision | None) -> PlanDecisionRead | None:
    if row is None:
        return None
    return PlanDecisionRead(
        action=row.action,  # type: ignore[arg-type]
        accepted_item_ids=row.accepted_item_ids,
        rejected_item_ids=row.rejected_item_ids,
        plan_version=row.plan_version,
        created_at=row.created_at,
    )


def _read(
    session: Session, adjustment: PlanAdjustment, current: str | None = None
) -> PlanAdjustmentRead:
    job = _job(session, adjustment)
    proposal = session.scalar(
        select(PlanProposal).where(PlanProposal.adjustment_id == adjustment.id)
    )
    decisions = _decisions(session, adjustment.id)
    state: AdjustmentState
    if job.status in ("queued", "running", "failed", "cancelled"):
        state = cast(AdjustmentState, job.status)
    elif proposal is None:
        state = "failed"
    elif "revert" in decisions:
        state = "reverted"
    elif "adopt" in decisions:
        state = "adopted"
    elif "keep" in decisions:
        state = "kept"
    else:
        fingerprint = current or _current_fingerprint(session, adjustment.project_id)
        state = "expired" if _stale(adjustment, fingerprint) else "pending"
    snapshot = adjustment.input_snapshot
    agent = cast(dict[str, object], snapshot["agent"])
    planning = cast(dict[str, object], snapshot["planning"])
    tasks = cast(list[dict[str, object]], snapshot["tasks"])
    version_ids = cast(dict[str, str], adjustment.configuration_snapshot["version_ids"])
    deadline = snapshot["deadline"]
    return PlanAdjustmentRead(
        id=adjustment.id,
        project_id=adjustment.project_id,
        job_id=job.id,
        status=cast(JobStatus, job.status),
        state=state,
        error_code=job.error_code,
        attempt=job.attempt,
        base_plan_version=adjustment.base_plan_version,
        agent_config_version_id=adjustment.agent_config_version_id,
        agent_name=f"{agent['name']} · v{agent['version']}",
        config_version_ids={key: UUID(value) for key, value in version_ids.items()},
        deadline=date.fromisoformat(cast(str, deadline)) if deadline else None,
        planning_mode=planning["mode"],  # type: ignore[arg-type]
        task_count=sum(1 for item in tasks if not item["archived"]),
        requested_model=proposal.requested_model if proposal else None,
        response_model=proposal.response_model if proposal else None,
        proposal=(
            PlanProposalContent.model_validate(proposal.content)
            if proposal and job.status == "succeeded"
            else None
        ),
        decision=_decision_read(decisions.get("adopt") or decisions.get("keep")),
        revert=_decision_read(decisions.get("revert")),
        created_at=adjustment.created_at,
        updated_at=job.updated_at,
    )


def _receipt(session: Session, adjustment: PlanAdjustment) -> PlanAdjustmentReceipt:
    return PlanAdjustmentReceipt(
        adjustment=_read(session, adjustment),
        job=JobRead.model_validate(_job(session, adjustment)),
    )


def _previous(
    session: Session, project_id: UUID, command_id: UUID, digest: str
) -> PlanAdjustment | None:
    found = session.scalar(select(PlanAdjustment).where(PlanAdjustment.command_id == command_id))
    if found is None:
        return None
    if found.project_id != project_id or found.request_hash != digest:
        raise error("COMMAND_CONFLICT", "命令编号已用于不同的计划调整请求。")
    return found


def _assert_idle(session: Session, project_id: UUID) -> None:
    active = session.scalar(
        select(PlanAdjustment.id)
        .join(Job, Job.id == PlanAdjustment.job_id)
        .where(PlanAdjustment.project_id == project_id, Job.status.in_(["queued", "running"]))
        .limit(1)
    )
    if active is not None:
        raise error("ADJUSTMENT_BUSY", "已有计划调整在生成，请等待完成或取消后再发起。")


def create_adjustment(
    session: Session, project_id: UUID, data: PlanAdjustmentCreate, *, now: datetime | None = None
) -> PlanAdjustmentReceipt:
    request = data.model_dump(mode="json", exclude={"command_id"})
    digest = _hash("create", project_id, request)
    try:
        with session.begin():
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
            owner = _project(session, project_id, lock=True)
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
            _assert_idle(session, project_id)
            configuration = freeze_config_version_chain(session, data.agent_config_version_id)
            _check_agent(configuration)
            agent_node = cast(dict[str, object], configuration["agent"])
            from thesis_pilot.modules.ai_configs.models import AIConfigVersion

            agent_version = session.get(AIConfigVersion, data.agent_config_version_id)
            agent = {
                "name": agent_version.name if agent_version else str(agent_node.get("role")),
                "version": agent_version.version if agent_version else 0,
            }
            snapshot = _freeze(session, owner, local_today(now or utcnow()), agent)
            adjustment = PlanAdjustment(
                project_id=project_id,
                command_id=data.command_id,
                request_hash=digest,
                agent_config_version_id=data.agent_config_version_id,
                base_plan_version=cast(int, snapshot["plan_version"]),
                input_snapshot=snapshot,
                configuration_snapshot=configuration,
            )
            session.add(adjustment)
            session.flush()
            source = PlanAdjustmentInput(adjustment_id=adjustment.id).model_dump(mode="json")
            job = Job(
                project_id=project_id,
                kind="plan_adjustment",
                idempotency_key="plan_adjustment:" + str(data.command_id),
                request_hash=_job_digest(adjustment),
                input_snapshot=source,
                resource_scope=source.copy(),
                configuration=None,
                source_job_id=None,
            )
            session.add(job)
            session.flush()
            session.add(OutboxEvent(job_id=job.id))
            adjustment.job_id = job.id
            session.flush()
            return _receipt(session, adjustment)
    except IntegrityError:
        with session.begin():
            previous = _previous(session, project_id, data.command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
        raise


def list_adjustments(
    session: Session, project_id: UUID, *, limit: int, offset: int
) -> PlanAdjustmentPage:
    with session.begin():
        _project(session, project_id)
        query = select(PlanAdjustment).where(PlanAdjustment.project_id == project_id)
        rows = session.scalars(
            query.order_by(PlanAdjustment.created_at.desc(), PlanAdjustment.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        current = _current_fingerprint(session, project_id)
        return PlanAdjustmentPage(
            items=[_read(session, row, current) for row in rows],
            total=session.scalar(select(func.count()).select_from(query.subquery())) or 0,
            limit=limit,
            offset=offset,
        )


def get_adjustment(session: Session, project_id: UUID, adjustment_id: UUID) -> PlanAdjustmentRead:
    with session.begin():
        return _read(session, _adjustment(session, project_id, adjustment_id))


def cancel_adjustment(
    session: Session, project_id: UUID, adjustment_id: UUID
) -> PlanAdjustmentRead:
    from thesis_pilot.modules.plans.jobs import cancel_plan_in_transaction

    with session.begin():
        adjustment = _adjustment(session, project_id, adjustment_id)
        cancel_plan_in_transaction(session, project_id, _job(session, adjustment).id)
        return _read(session, adjustment)


def _items(proposal: PlanProposal) -> dict[str, PlanAdjustmentItem]:
    content = PlanProposalContent.model_validate(proposal.content)
    return {item.id: item for item in content.items}


def _decidable(
    session: Session, adjustment: PlanAdjustment
) -> tuple[PlanProposal, dict[str, PlanDecision]]:
    job = _job(session, adjustment)
    proposal = session.scalar(
        select(PlanProposal).where(PlanProposal.adjustment_id == adjustment.id)
    )
    if job.status != "succeeded" or proposal is None:
        raise error("CANDIDATE_UNAVAILABLE", "该计划调整尚未生成可审阅的候选。")
    return proposal, _decisions(session, adjustment.id)


def decide(
    session: Session, project_id: UUID, adjustment_id: UUID, data: PlanAdjustmentDecide
) -> PlanAdjustmentRead:
    operation = f"plan.decide:{adjustment_id}"
    with session.begin():
        owner = _project(session, project_id, lock=True)
        old = replay(session, project_id, operation, data, PlanAdjustmentRead)
        if old:
            return old
        adjustment = _adjustment(session, project_id, adjustment_id)
        proposal, decisions = _decidable(session, adjustment)
        if decisions:
            raise error("ALREADY_DECIDED", "该计划调整已有决定，请查看计划历史。")
        items = _items(proposal)
        selectable = [item.id for item in items.values() if not item.blocked]
        plan_version: int | None = None
        if data.action == "adopt":
            if _stale(adjustment, _current_fingerprint(session, project_id)):
                raise error("CANDIDATE_STALE", "计划已变化，当前候选已过期，请重新生成后再审阅。")
            changes: dict[UUID, Proposed] = {}
            expected: dict[UUID, int] = {}
            for item_id in data.accepted_item_ids:
                item = items.get(item_id)
                if item is None or item.task_id is None or item.base_version is None:
                    raise error("ITEM_INVALID", "所选条目不属于该候选。", 422)
                if item.blocked:
                    raise error("ITEM_BLOCKED", "所选条目未通过程序检查，不能采纳。", 422)
                changes[item.task_id] = Proposed(item.after.start_date, item.after.due_date)
                expected[item.task_id] = item.base_version
            version = _apply(
                session,
                owner,
                changes,
                expected,
                action="adopt",
                reason=f"采纳计划调整候选（基于计划 v{adjustment.base_plan_version}）",
                adjustment_id=adjustment.id,
                today=local_today(utcnow()),
                stale_code="CANDIDATE_STALE",
            )
            plan_version = version.version
        session.add(
            PlanDecision(
                adjustment_id=adjustment.id,
                project_id=project_id,
                action=data.action,
                accepted_item_ids=list(data.accepted_item_ids),
                rejected_item_ids=[i for i in selectable if i not in data.accepted_item_ids],
                plan_version=plan_version,
                created_at=utcnow(),
            )
        )
        session.flush()
        result = _read(session, adjustment)
        remember(session, project_id, operation, data, result)
        return result


def revert(
    session: Session, project_id: UUID, adjustment_id: UUID, data: PlanAdjustmentRevert
) -> PlanAdjustmentRead:
    operation = f"plan.revert:{adjustment_id}"
    with session.begin():
        owner = _project(session, project_id, lock=True)
        old = replay(session, project_id, operation, data, PlanAdjustmentRead)
        if old:
            return old
        adjustment = _adjustment(session, project_id, adjustment_id)
        _, decisions = _decidable(session, adjustment)
        adopted = decisions.get("adopt")
        if adopted is None or "revert" in decisions or adopted.plan_version is None:
            raise error("REVERT_UNAVAILABLE", "只能撤销已采纳且尚未撤销的计划调整。")
        version = session.scalar(
            select(PlanVersion).where(
                PlanVersion.project_id == project_id,
                PlanVersion.version == adopted.plan_version,
            )
        )
        if version is None or version.adjustment_id != adjustment.id:
            raise error("RUN_INVALID", "采纳记录与计划版本不一致。")
        recorded = [PlanChange.model_validate(item) for item in version.changes]
        restored = _apply(
            session,
            owner,
            {
                item.task_id: Proposed(item.before.start_date, item.before.due_date)
                for item in recorded
            },
            {item.task_id: item.after_version for item in recorded},
            action="revert",
            reason=f"撤销计划 v{version.version} 的采纳",
            adjustment_id=adjustment.id,
            today=None,
            stale_code="REVERT_STALE",
        )
        session.add(
            PlanDecision(
                adjustment_id=adjustment.id,
                project_id=project_id,
                action="revert",
                accepted_item_ids=[],
                rejected_item_ids=[],
                plan_version=restored.version,
                created_at=utcnow(),
            )
        )
        session.flush()
        result = _read(session, adjustment)
        remember(session, project_id, operation, data, result)
        return result


# --- Execution boundary used by plans.jobs inside the job's own transactions.
def adjustment_for_job(session: Session, job: Job) -> PlanAdjustment:
    try:
        source = PlanAdjustmentInput.model_validate(job.input_snapshot)
    except ValidationError:
        raise AppError("JOB_INPUT_INVALID", "计划调整任务固定输入无效。", 422) from None
    adjustment = session.get(PlanAdjustment, source.adjustment_id)
    if (
        job.kind != "plan_adjustment"
        or adjustment is None
        or adjustment.project_id != job.project_id
        or adjustment.job_id != job.id
        or job.configuration is not None
        or job.resource_scope != source.model_dump(mode="json")
        or job.request_hash != _job_digest(adjustment)
    ):
        raise AppError("JOB_INPUT_INVALID", "计划调整任务与固定记录不一致。", 422)
    return adjustment


def load_plan_snapshot_in_transaction(
    session: Session, job: Job, adjustment_id: UUID
) -> dict[str, object]:
    adjustment = adjustment_for_job(session, job)
    if adjustment.id != adjustment_id:
        raise AppError("JOB_INPUT_INVALID", "计划调整执行标识与固定记录不一致。", 422)
    return {
        "adjustment_id": str(adjustment.id),
        "input_snapshot": adjustment.input_snapshot,
        "configuration_snapshot": adjustment.configuration_snapshot,
    }


def _parse_day(value: str | None, fallback: date | None) -> tuple[date | None, bool]:
    if value is None:
        return fallback, True
    try:
        if len(value) != 10:
            raise ValueError
        return date.fromisoformat(value), True
    except ValueError:
        return fallback, False


TASK_KEY = re.compile(r"(?<![A-Za-z0-9])T([1-9][0-9]{0,2})(?![0-9])")


def _named(text: str, keys: dict[str, PlanTaskState]) -> str:
    """Show the student task titles instead of the internal keys the model was given."""

    def title(match: re.Match[str]) -> str:
        state = keys.get(match.group(0))
        return f"「{state.title}」" if state else match.group(0)

    return TASK_KEY.sub(title, text)


def build_proposal(snapshot: dict[str, object], completion: PlanCompletion) -> PlanProposalContent:
    """Verify every suggestion against the frozen facts; non-compliant items stay blocked."""
    raw_tasks = cast(list[dict[str, object]], snapshot["tasks"])
    tasks = [
        PlanTaskState.model_validate({k: v for k, v in item.items() if k != "key"})
        for item in raw_tasks
    ]
    keys = {cast(str, raw["key"]): state for raw, state in zip(raw_tasks, tasks, strict=True)}
    facts = _facts(tasks)
    deadline_raw = snapshot["deadline"]
    deadline = date.fromisoformat(cast(str, deadline_raw)) if deadline_raw else None
    today = date.fromisoformat(cast(str, snapshot["today"]))
    drafts: list[dict[str, object]] = []
    proposed: dict[UUID, Proposed] = {}
    seen: set[UUID] = set()
    for index, change in enumerate(completion.reply.changes, start=1):
        state = keys.get(change.task)
        violations: list[tuple[str, str]] = []
        before = DateRange(
            start_date=state.start_date if state else None,
            due_date=state.due_date if state else None,
        )
        start, start_ok = _parse_day(change.start_date, before.start_date)
        due, due_ok = _parse_day(change.due_date, before.due_date)
        if state is None:
            violations.append(("UNKNOWN_TASK", "建议引用了不存在的任务，无法定位。"))
        else:
            if not start_ok or not due_ok:
                violations.append(("INVALID_DATE", "日期格式无效，未作修正。"))
            if state.task_id in seen:
                violations.append(("DUPLICATE", "同一任务已有一条建议。"))
            elif start == before.start_date and due == before.due_date and start_ok and due_ok:
                violations.append(("NO_CHANGE", "建议与当前安排相同。"))
            seen.add(state.task_id)
        if not violations and state is not None:
            proposed[state.task_id] = Proposed(start, due)
        drafts.append(
            {
                "id": f"A{index}",
                "task_key": change.task,
                "task_id": state.task_id if state else None,
                "title": state.title if state else "未知任务",
                "base_version": state.version if state else None,
                "before": before,
                "after": DateRange(start_date=start, due_date=due),
                "reason": _named(change.reason, keys),
                "violations": violations,
            }
        )
    blocked = consistent_subset(facts, proposed, deadline, today)
    items: list[PlanAdjustmentItem] = []
    for draft in drafts:
        violations = cast(list[tuple[str, str]], draft.pop("violations"))
        task_id = cast(UUID | None, draft["task_id"])
        if task_id is not None and task_id in proposed:
            violations.extend(blocked.get(task_id, []))
        items.append(
            PlanAdjustmentItem.model_validate(
                {
                    **draft,
                    "blocked": bool(violations),
                    "violations": [{"code": c, "message": m} for c, m in violations],
                }
            )
        )
    notes: list[str] = []
    planning = cast(dict[str, object], snapshot["planning"])
    if planning["mode"] == "none":
        notes.append(NOTE_NO_PLANNING)
    stopped = sum(1 for item in items if item.blocked)
    if stopped:
        notes.append(f"{stopped} 项建议未通过程序检查，已标记为不可采纳，没有被自动修正。")
    if not items:
        notes.append("模型认为当前计划无需调整，可以保留原计划。")
    return PlanProposalContent(
        schema_version=1, summary=_named(completion.reply.summary, keys), items=items, notes=notes
    )


def commit_plan_proposal_in_transaction(
    session: Session, job: Job, adjustment_id: UUID, completion: PlanCompletion
) -> dict[str, object]:
    adjustment = adjustment_for_job(session, job)
    if adjustment.id != adjustment_id:
        raise AppError("JOB_INPUT_INVALID", "计划调整执行标识与固定记录不一致。", 422)
    configuration = ConfigurationProbeConfiguration.model_validate(
        adjustment.configuration_snapshot
    )
    if configuration.model is None or completion.requested_model != configuration.model.model_code:
        raise AppError("JOB_RESULT_INVALID", "计划调整结果的模型与固定配置不一致。", 422)
    existing = session.scalar(
        select(PlanProposal).where(PlanProposal.adjustment_id == adjustment.id)
    )
    if existing is None:
        try:
            content = build_proposal(adjustment.input_snapshot, completion)
        except ValidationError:
            raise AppError("MODEL_INVALID_RESPONSE", "模型计划建议不满足固定结构。", 422) from None
        existing = PlanProposal(
            adjustment_id=adjustment.id,
            project_id=adjustment.project_id,
            job_id=job.id,
            requested_model=completion.requested_model,
            response_model=completion.response_model,
            content=content.model_dump(mode="json"),
            created_at=utcnow(),
        )
        session.add(existing)
        session.flush()
    content = PlanProposalContent.model_validate(existing.content)
    return {
        "proposal_id": existing.id,
        "item_count": len(content.items),
        "blocked_count": sum(1 for item in content.items if item.blocked),
    }
