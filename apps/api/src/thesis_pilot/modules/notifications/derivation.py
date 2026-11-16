"""Deterministic notification candidates read from persisted business facts.

Derivation is pull-based (explicit refresh), so a notification problem can never roll back a
task, feedback, project or job transaction. The rule switch, cooldown and overdue threshold come
from the workspace reminder settings (configuration console); the rest are module constants.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from thesis_pilot.modules.feedback.models import FeedbackItem
from thesis_pilot.modules.jobs.models import Job
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.tasks.models import ProjectTask
from thesis_pilot.modules.tasks.schemas import TaskContent

# Calendar dates and quiet hours follow the product's single local calendar (same as preview).
LOCAL_ZONE = ZoneInfo("Asia/Shanghai")
# A task date within this many calendar days (today included) counts as "due soon".
DUE_SOON_DAYS = 2
# An open feedback item untouched for this many days counts as "long unprocessed".
FEEDBACK_STALE_DAYS = 7
# The project submission deadline is surfaced once it is within this many days.
PROJECT_DEADLINE_DAYS = 14
# Failed jobs older than this are history, not something to bring up again.
JOB_FAILED_LOOKBACK_DAYS = 14
# Defaults for the workspace reminder settings until the student saves their own.
# The same kind of reminder for the same object is not repeated within this window.
COOLDOWN_HOURS = 24
# A task date must be at least this many days past before it counts as overdue.
OVERDUE_DAYS = 1
# Bounded scans keep a refresh predictable for large projects.
SCAN_LIMIT = 500

STATUS_LABELS = {"todo": "待开始", "doing": "进行中", "verify": "待核验", "rework": "返工"}
JOB_LABELS = {
    "diagnostic": "诊断",
    "document_inspection": "文档检查",
    "configuration_probe": "配置检测",
    "material_parse": "资料解析",
    "content_revision": "内容修订",
}


@dataclass(frozen=True)
class Candidate:
    kind: str
    object_type: str
    object_id: UUID
    parent_id: UUID | None
    source_version: int
    title: str
    trigger: str
    basis: list[str]
    uncertainty: str

    @property
    def dedupe_key(self) -> str:
        return f"{self.kind}:{self.object_id}:{self.source_version}"


def aware(value: datetime) -> datetime:
    """SQLite returns naive UTC values; PostgreSQL returns aware ones."""
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def local_today(now: datetime) -> date:
    return aware(now).astimezone(LOCAL_ZONE).date()


def is_quiet(start: str, end: str, now: datetime) -> bool:
    clock = aware(now).astimezone(LOCAL_ZONE).strftime("%H:%M")
    if start == end:
        return False
    return start <= clock < end if start < end else clock >= start or clock < end


def clip(text: str, size: int) -> str:
    return text if len(text) <= size else text[: size - 1] + "…"


def remaining(days: int) -> str:
    return "今天到期" if days == 0 else f"还有 {days} 天"


def task_candidates(
    rows: list[ProjectTask], today: date, overdue_days: int = OVERDUE_DAYS
) -> list[Candidate]:
    result: list[Candidate] = []
    for row in rows:
        try:
            content = TaskContent.model_validate(row.content)
        except ValidationError:
            continue
        if row.status == "confirmed" or content.archived:
            continue
        name = clip(content.title, 80)
        dates = [
            (label, day)
            for label, day in (("预计完成", content.due_date), ("硬截止", content.hard_deadline))
            if day is not None
        ]
        status = f"任务状态：{STATUS_LABELS.get(row.status, row.status)} · 任务 v{row.version}"
        passed = [(label, day) for label, day in dates if day < today]
        overdue = [(label, day) for label, day in passed if (today - day).days >= overdue_days]
        if overdue:
            label, day = overdue[-1]
            result.append(
                Candidate(
                    kind="task_overdue",
                    object_type="task",
                    object_id=row.id,
                    parent_id=None,
                    source_version=row.version,
                    title=f"留意「{name}」的期限",
                    trigger=f"已过{label}日期 {day.isoformat()}，任务尚未确认完成",
                    basis=[
                        *(
                            f"{lb} {d.isoformat()} · 已过 {(today - d).days} 天"
                            for lb, d in overdue
                        ),
                        status,
                    ],
                    uncertainty="期限来自任务记录；尚未确认不等于没有工作，也不代表质量不达标。",
                )
            )
            continue
        # A date passed but still under the configured overdue threshold is not reminded yet.
        upcoming = [
            (label, day) for label, day in dates if 0 <= (day - today).days <= DUE_SOON_DAYS
        ]
        if upcoming:
            label, day = min(upcoming, key=lambda item: item[1])
            result.append(
                Candidate(
                    kind="task_due_soon",
                    object_type="task",
                    object_id=row.id,
                    parent_id=None,
                    source_version=row.version,
                    title=f"「{name}」即将到期",
                    trigger=f"{label} {day.isoformat()}，{remaining((day - today).days)}",
                    basis=[f"{label} {day.isoformat()}", status],
                    uncertainty="只根据任务日期和确认状态判断；线下完成的部分可能尚未登记。",
                )
            )
    return result


def feedback_candidates(rows: list[FeedbackItem], now: datetime) -> list[Candidate]:
    result: list[Candidate] = []
    for row in rows:
        updated = aware(row.updated_at)
        days = (now - updated).days
        if days < FEEDBACK_STALE_DAYS:
            continue
        source = row.content.get("source_range")
        excerpt = source.get("text") if isinstance(source, dict) else None
        result.append(
            Candidate(
                kind="feedback_stale",
                object_type="feedback_item",
                object_id=row.id,
                parent_id=row.batch_id,
                source_version=row.version,
                title="导师反馈条目仍待处理",
                trigger=f"反馈条目已 {days} 天没有更新，仍未标记处理",
                basis=[
                    *([f"原文摘录：{clip(excerpt, 60)}"] if isinstance(excerpt, str) else []),
                    f"条目 v{row.version} · 最近更新 {local_today(updated).isoformat()}",
                ],
                uncertainty="只根据条目处理状态判断；线下沟通或已完成的修改可能尚未登记。",
            )
        )
    return result


def project_candidates(owner: Project, open_tasks: int, today: date) -> list[Candidate]:
    if owner.deadline is None:
        return []
    days = (owner.deadline - today).days
    if days < 0 or days > PROJECT_DEADLINE_DAYS:
        return []
    return [
        Candidate(
            kind="project_deadline",
            object_type="project",
            object_id=owner.id,
            parent_id=None,
            source_version=owner.version,
            title="论文提交截止临近",
            trigger=f"项目截止 {owner.deadline.isoformat()}，{remaining(days)}",
            basis=[f"项目截止 {owner.deadline.isoformat()}", f"尚未确认完成的任务 {open_tasks} 项"],
            uncertainty="截止日期来自项目设置；学校安排有变化时请在项目设置中更新。",
        )
    ]


def job_candidates(rows: list[Job]) -> list[Candidate]:
    return [
        Candidate(
            kind="job_failed",
            object_type="job",
            object_id=row.id,
            parent_id=None,
            source_version=row.attempt,
            title=f"{JOB_LABELS.get(row.kind, '后台')}任务失败",
            trigger="后台任务执行失败，没有产生结果",
            basis=[
                f"错误码 {row.error_code or '未知'}",
                f"第 {row.attempt} 次执行 · {local_today(row.updated_at).isoformat()}",
            ],
            uncertainty="失败的任务不会写入正文或计划；原因可能来自服务或配置，可在任务详情查看后重试。",
        )
        for row in rows
    ]


def derive(
    session: Session, owner: Project, now: datetime, *, overdue_days: int = OVERDUE_DAYS
) -> list[Candidate]:
    today = local_today(now)
    tasks = list(
        session.scalars(
            select(ProjectTask)
            .where(ProjectTask.project_id == owner.id, ProjectTask.status != "confirmed")
            .order_by(ProjectTask.position, ProjectTask.id)
            .limit(SCAN_LIMIT)
        )
    )
    open_tasks = sum(1 for row in tasks if not row.content.get("archived"))
    feedback = list(
        session.scalars(
            select(FeedbackItem)
            .where(
                FeedbackItem.project_id == owner.id,
                FeedbackItem.status == "open",
                FeedbackItem.updated_at <= now - timedelta(days=FEEDBACK_STALE_DAYS),
            )
            .order_by(FeedbackItem.updated_at, FeedbackItem.id)
            .limit(SCAN_LIMIT)
        )
    )
    retry = aliased(Job)
    jobs = list(
        session.scalars(
            select(Job)
            .where(
                Job.project_id == owner.id,
                Job.status == "failed",
                Job.updated_at >= now - timedelta(days=JOB_FAILED_LOOKBACK_DAYS),
                ~select(retry.id).where(retry.source_job_id == Job.id).exists(),
            )
            .order_by(Job.updated_at, Job.id)
            .limit(SCAN_LIMIT)
        )
    )
    return [
        *task_candidates(tasks, today, overdue_days),
        *feedback_candidates(feedback, now),
        *project_candidates(owner, open_tasks, today),
        *job_candidates(jobs),
    ]
