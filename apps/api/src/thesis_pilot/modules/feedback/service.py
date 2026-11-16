"""Manual feedback transactions preserve original text and every correction/decision."""

from typing import cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.feedback.models import FeedbackBatch, FeedbackItem, FeedbackItemVersion
from thesis_pilot.modules.feedback.schemas import (
    FeedbackContent,
    FeedbackCreate,
    FeedbackDecision,
    FeedbackItemCreate,
    FeedbackItemPage,
    FeedbackItemRead,
    FeedbackItemSummary,
    FeedbackItemUpdate,
    FeedbackPage,
    FeedbackRead,
    FeedbackSummary,
    FeedbackVersionPage,
    FeedbackVersionRead,
    ItemOrigin,
    ItemStatus,
    SourceRange,
)
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.revisions.anchors import utf16_bytes, utf16_slice
from thesis_pilot.modules.tasks.evidence import resolve_evidence
from thesis_pilot.modules.tasks.models import utcnow
from thesis_pilot.modules.tasks.service import (
    create_in_transaction,
    project,
    remember,
    replay,
    task,
)


def validate_source_range(original: str, source: SourceRange) -> None:
    try:
        text = utf16_slice(utf16_bytes(original), source.from_position, source.to)
    except AppError:
        raise AppError("FEEDBACK_RANGE_INVALID", "反馈原文范围无效或截断字符。", 422) from None
    if source.from_position >= source.to or text != source.text:
        raise AppError("FEEDBACK_RANGE_INVALID", "人工定位必须逐字对应反馈原文。", 422)


def batch(session: Session, project_id: UUID, batch_id: UUID) -> FeedbackBatch:
    value = session.scalar(
        select(FeedbackBatch).where(
            FeedbackBatch.id == batch_id, FeedbackBatch.project_id == project_id
        )
    )
    if value is None:
        raise AppError("FEEDBACK_NOT_FOUND", "反馈原文不存在。", 404)
    return value


def item(session: Session, project_id: UUID, item_id: UUID) -> FeedbackItem:
    value = session.scalar(
        select(FeedbackItem).where(
            FeedbackItem.id == item_id, FeedbackItem.project_id == project_id
        )
    )
    if value is None:
        raise AppError("FEEDBACK_NOT_FOUND", "反馈解释项不存在。", 404)
    return value


def cas(current: int, expected: int) -> None:
    if current != expected:
        raise AppError("FEEDBACK_VERSION_CONFLICT", "反馈项已变化，请重新读取。", 409)


def active(row: FeedbackItem) -> None:
    if row.status == "withdrawn":
        raise AppError(
            "FEEDBACK_ITEM_WITHDRAWN", "该解释项的采纳已撤销，历史保留但不能再修改。", 409
        )


def read_batch(session: Session, row: FeedbackBatch) -> FeedbackRead:
    count = (
        session.scalar(
            select(func.count()).select_from(FeedbackItem).where(FeedbackItem.batch_id == row.id)
        )
        or 0
    )
    return FeedbackRead(
        id=row.id,
        project_id=row.project_id,
        preview=row.original_text[:120],
        item_count=count,
        original_text=row.original_text,
        created_at=row.created_at,
    )


def read_item(session: Session, row: FeedbackItem) -> FeedbackItemRead:
    content = FeedbackContent.model_validate(row.content)
    snapshots = resolve_evidence(session, row.project_id, content.evidence)
    reasons: list[str] = []
    if not content.source_checked:
        reasons.append("反馈原文尚未人工核对")
    if content.certainty == "uncertain" and not content.correction.strip():
        reasons.append("不确定解释尚未纠正")
    if not snapshots:
        reasons.append("缺少处理证据")
    elif any(value.stale for value in snapshots):
        reasons.append("处理证据版本已变化")
    if content.task_id is not None:
        linked_task = task(session, row.project_id, content.task_id)
        if bool(linked_task.content.get("archived")):
            reasons.append("关联任务已归档")
    return FeedbackItemRead(
        id=row.id,
        batch_id=row.batch_id,
        project_id=row.project_id,
        version=row.version,
        origin=cast(ItemOrigin, row.origin),
        status=cast(ItemStatus, row.status),
        content=content,
        evidence_snapshots=snapshots,
        needs_review=bool(reasons),
        review_reasons=reasons,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def append_version(
    session: Session, row: FeedbackItem, action: str, reason: str = ""
) -> FeedbackItemRead:
    session.flush()
    result = read_item(session, row)
    session.add(
        FeedbackItemVersion(
            item_id=row.id,
            version=row.version,
            action=action,
            reason=reason,
            snapshot=result.model_dump(mode="json"),
        )
    )
    return result


def resolve_content(
    session: Session, owner: Project, original: FeedbackBatch, content: FeedbackContent
) -> FeedbackContent:
    validate_source_range(original.original_text, content.source_range)
    if not content.interpretation.strip():
        raise AppError("FEEDBACK_INTERPRETATION_INVALID", "请填写人工解释。", 422)
    if content.task_id is not None and content.new_task is not None:
        raise AppError("FEEDBACK_TASK_INVALID", "关联已有任务与新建任务不能同时提交。", 422)
    if content.task_id is not None:
        task(session, owner.id, content.task_id)
    if content.new_task is not None:
        created = create_in_transaction(session, owner, content.new_task)
        content = content.model_copy(update={"task_id": created.id, "new_task": None})
    return content


def create_feedback(session: Session, project_id: UUID, data: FeedbackCreate) -> FeedbackRead:
    with session.begin():
        project(session, project_id, lock=True)
        old = replay(session, project_id, "feedback.create", data, FeedbackRead)
        if old:
            return old
        if not data.original_text.strip():
            raise AppError("FEEDBACK_ORIGINAL_INVALID", "反馈原文不能为空白。", 422)
        row = FeedbackBatch(project_id=project_id, original_text=data.original_text)
        session.add(row)
        session.flush()
        result = read_batch(session, row)
        remember(session, project_id, "feedback.create", data, result)
        return result


def get_feedback(session: Session, project_id: UUID, batch_id: UUID) -> FeedbackRead:
    with session.begin():
        project(session, project_id)
        return read_batch(session, batch(session, project_id, batch_id))


def list_feedback(session: Session, project_id: UUID, *, limit: int, offset: int) -> FeedbackPage:
    with session.begin():
        project(session, project_id)
        query = select(FeedbackBatch).where(FeedbackBatch.project_id == project_id)
        total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = session.scalars(
            query.order_by(FeedbackBatch.created_at.desc(), FeedbackBatch.id)
            .limit(limit)
            .offset(offset)
        ).all()
        return FeedbackPage(
            items=[
                FeedbackSummary.model_validate(
                    read_batch(session, row).model_dump(exclude={"original_text"})
                )
                for row in rows
            ],
            total=total,
            limit=limit,
            offset=offset,
        )


def create_item(
    session: Session, project_id: UUID, batch_id: UUID, data: FeedbackItemCreate
) -> FeedbackItemRead:
    with session.begin():
        owner = project(session, project_id, lock=True)
        operation = f"feedback.item.create:{batch_id}"
        old = replay(session, project_id, operation, data, FeedbackItemRead)
        if old:
            return old
        original = batch(session, project_id, batch_id)
        count = (
            session.scalar(
                select(func.count())
                .select_from(FeedbackItem)
                .where(FeedbackItem.batch_id == batch_id)
            )
            or 0
        )
        if count >= 200:
            raise AppError("FEEDBACK_LIMIT_REACHED", "每批原文最多200个人工解释项。", 422)
        content = resolve_content(session, owner, original, data.content)
        snapshots = resolve_evidence(session, project_id, content.evidence)
        row = FeedbackItem(
            batch_id=batch_id,
            project_id=project_id,
            version=1,
            status="open",
            content=content.model_dump(mode="json"),
            evidence_snapshots=[value.model_dump(mode="json") for value in snapshots],
        )
        session.add(row)
        result = append_version(session, row, "create")
        remember(session, project_id, operation, data, result)
        return result


def get_item(session: Session, project_id: UUID, item_id: UUID) -> FeedbackItemRead:
    with session.begin():
        project(session, project_id)
        return read_item(session, item(session, project_id, item_id))


def list_items(
    session: Session, project_id: UUID, batch_id: UUID, *, limit: int, offset: int
) -> FeedbackItemPage:
    with session.begin():
        batch(session, project_id, batch_id)
        query = select(FeedbackItem).where(FeedbackItem.batch_id == batch_id)
        total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = session.scalars(
            query.order_by(FeedbackItem.created_at, FeedbackItem.id).limit(limit).offset(offset)
        ).all()
        values = [read_item(session, row) for row in rows]
        return FeedbackItemPage(
            items=[
                FeedbackItemSummary(
                    id=value.id,
                    batch_id=batch_id,
                    version=value.version,
                    origin=value.origin,
                    status=value.status,
                    preview=value.content.interpretation[:120],
                    certainty=value.content.certainty,
                    task_id=value.content.task_id,
                    needs_review=value.needs_review,
                    review_reasons=value.review_reasons,
                    updated_at=value.updated_at,
                )
                for value in values
            ],
            total=total,
            limit=limit,
            offset=offset,
        )


def update_item(
    session: Session, project_id: UUID, item_id: UUID, data: FeedbackItemUpdate
) -> FeedbackItemRead:
    with session.begin():
        owner = project(session, project_id, lock=True)
        operation = f"feedback.item.update:{item_id}"
        old = replay(session, project_id, operation, data, FeedbackItemRead)
        if old:
            return old
        row = item(session, project_id, item_id)
        cas(row.version, data.expected_version)
        active(row)
        original = batch(session, project_id, row.batch_id)
        content = resolve_content(session, owner, original, data.content)
        snapshots = resolve_evidence(session, project_id, content.evidence)
        row.content = content.model_dump(mode="json")
        row.evidence_snapshots = [value.model_dump(mode="json") for value in snapshots]
        row.status = "open"
        row.version += 1
        row.updated_at = utcnow()
        result = append_version(session, row, "edit")
        remember(session, project_id, operation, data, result)
        return result


def decide_item(
    session: Session, project_id: UUID, item_id: UUID, data: FeedbackDecision
) -> FeedbackItemRead:
    with session.begin():
        project(session, project_id, lock=True)
        operation = f"feedback.item.decide:{item_id}"
        old = replay(session, project_id, operation, data, FeedbackItemRead)
        if old:
            return old
        row = item(session, project_id, item_id)
        cas(row.version, data.expected_version)
        active(row)
        content = FeedbackContent.model_validate(row.content)
        if data.action == "processed":
            snapshots = resolve_evidence(session, project_id, content.evidence, lock=True)
            current = read_item(session, row)
            if current.needs_review:
                raise AppError(
                    "FEEDBACK_REVIEW_REQUIRED",
                    "原文、解释或处理证据待复核，不能标记学生已处理。",
                    409,
                )
            row.status = "processed"
            row.evidence_snapshots = [value.model_dump(mode="json") for value in snapshots]
        else:
            row.status = "open"
        row.version += 1
        row.updated_at = utcnow()
        result = append_version(session, row, data.action, data.reason)
        remember(session, project_id, operation, data, result)
        return result


def list_versions(
    session: Session, project_id: UUID, item_id: UUID, *, limit: int, offset: int
) -> FeedbackVersionPage:
    with session.begin():
        item(session, project_id, item_id)
        query = select(FeedbackItemVersion).where(FeedbackItemVersion.item_id == item_id)
        total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = session.scalars(
            query.order_by(FeedbackItemVersion.version.desc()).limit(limit).offset(offset)
        ).all()
        return FeedbackVersionPage(
            items=[
                FeedbackVersionRead(
                    version=row.version,
                    action=row.action,
                    reason=row.reason,
                    snapshot=FeedbackItemRead.model_validate(row.snapshot),
                    created_at=row.created_at,
                )
                for row in rows
            ],
            total=total,
            limit=limit,
            offset=offset,
        )
