"""Manual task commands serialized on the project row and protected by CAS."""

from datetime import date
from typing import cast
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.tasks.evidence import chapter_is_stale, fingerprint, resolve_evidence
from thesis_pilot.modules.tasks.models import (
    ProjectTask,
    TaskBoard,
    TaskFeedbackCommand,
    TaskVersion,
    utcnow,
)
from thesis_pilot.modules.tasks.schemas import (
    BoardRead,
    Command,
    TaskContent,
    TaskCreate,
    TaskDecision,
    TaskPage,
    TaskRead,
    TaskReorder,
    TaskStatus,
    TaskSummary,
    TaskUpdate,
    TaskVersionPage,
    TaskVersionRead,
)


def project(session: Session, project_id: UUID, *, lock: bool = False) -> Project:
    query = select(Project).where(Project.id == project_id)
    value = session.scalar(query.with_for_update() if lock else query)
    if value is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
    if lock and value.archived:
        raise AppError("TASK_PROJECT_ARCHIVED", "归档项目不能修改任务或反馈。", 409)
    return value


def replay[Response: BaseModel](
    session: Session,
    project_id: UUID,
    operation: str,
    data: Command,
    response: type[Response],
) -> Response | None:
    command_id = data.command_id
    command = session.get(TaskFeedbackCommand, command_id)
    if command is None:
        return None
    if (
        command.project_id != project_id
        or command.operation != operation
        or command.request_hash != fingerprint(data.model_dump(mode="json"))
    ):
        raise AppError("TASK_COMMAND_CONFLICT", "命令编号已用于不同操作。", 409)
    return response.model_validate(command.result)


def remember(
    session: Session, project_id: UUID, operation: str, data: Command, result: BaseModel
) -> None:
    session.add(
        TaskFeedbackCommand(
            id=data.command_id,
            project_id=project_id,
            operation=operation,
            request_hash=fingerprint(data.model_dump(mode="json")),
            result=result.model_dump(mode="json"),
        )
    )


def task(session: Session, project_id: UUID, task_id: UUID) -> ProjectTask:
    value = session.scalar(
        select(ProjectTask).where(ProjectTask.id == task_id, ProjectTask.project_id == project_id)
    )
    if value is None:
        raise AppError("TASK_NOT_FOUND", "任务不存在。", 404)
    return value


def board(session: Session, project_id: UUID) -> TaskBoard:
    value = session.get(TaskBoard, project_id)
    if value is None:
        value = TaskBoard(project_id=project_id, version=0)
        session.add(value)
        session.flush()
    return value


def cas(current: int, expected: int, *, board_version: bool = False) -> None:
    if current != expected:
        code = "TASK_BOARD_CONFLICT" if board_version else "TASK_VERSION_CONFLICT"
        raise AppError(code, "任务已变化，请重新读取后重试。", 409)


def validate_graph(graph: dict[UUID, list[UUID]]) -> None:
    active: set[UUID] = set()
    done: set[UUID] = set()

    def visit(node: UUID) -> None:
        if node in active:
            raise AppError("TASK_DEPENDENCY_CYCLE", "任务依赖形成循环。", 422)
        if node in done:
            return
        active.add(node)
        for dependency in graph[node]:
            if dependency not in graph:
                raise AppError("TASK_DEPENDENCY_INVALID", "依赖必须是本项目已有任务。", 422)
            visit(dependency)
        active.remove(node)
        done.add(node)

    for node in graph:
        visit(node)


def validate_dates(content: TaskContent, deadline: date | None) -> None:
    if deadline and any(
        day is not None and day > deadline
        for day in (content.start_date, content.due_date, content.hard_deadline)
    ):
        raise AppError("TASK_DEADLINE_CONFLICT", "任务日期不得晚于项目硬截止。", 422)


def validate_content(session: Session, owner: Project, task_id: UUID, content: TaskContent) -> None:
    validate_dates(content, owner.deadline)
    rows = session.scalars(select(ProjectTask).where(ProjectTask.project_id == owner.id)).all()
    graph = {row.id: TaskContent.model_validate(row.content).depends_on for row in rows}
    graph[task_id] = content.depends_on
    validate_graph(graph)
    for row in rows:
        if row.id in content.depends_on and TaskContent.model_validate(row.content).archived:
            raise AppError("TASK_DEPENDENCY_INVALID", "不能关联已归档的依赖任务。", 422)
    chapter_is_stale(session, owner.id, content.chapter)


def read_task(
    session: Session, row: ProjectTask, cache: dict[UUID, TaskRead] | None = None
) -> TaskRead:
    if cache is None:
        cache = {}
    if row.id in cache:
        return cache[row.id]
    content = TaskContent.model_validate(row.content)
    snapshots = resolve_evidence(session, row.project_id, content.evidence)
    reasons: list[str] = []
    if not snapshots:
        reasons.append("缺少产物证据")
    elif any(item.stale for item in snapshots):
        reasons.append("产物证据版本已变化")
    if chapter_is_stale(session, row.project_id, content.chapter):
        reasons.append("关联章节版本已变化")
    owner = session.get(Project, row.project_id)
    try:
        validate_dates(content, owner.deadline if owner else None)
    except AppError:
        reasons.append("任务日期超过当前项目截止")
    for dependency_id in content.depends_on:
        dependency = task(session, row.project_id, dependency_id)
        dependency_content = TaskContent.model_validate(dependency.content)
        if (
            dependency.status != "confirmed"
            or dependency_content.archived
            or (
                row.status == "confirmed"
                and row.confirmed_dependency_versions.get(str(dependency_id)) != dependency.version
            )
            or read_task(session, dependency, cache).needs_review
        ):
            reasons.append("依赖任务待确认或已变化")
            break
    result = TaskRead(
        id=row.id,
        project_id=row.project_id,
        version=row.version,
        position=row.position,
        status=cast(TaskStatus, row.status),
        content=content,
        evidence_snapshots=snapshots,
        needs_review=bool(reasons),
        review_reasons=reasons,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
    cache[row.id] = result
    return result


def lock_confirmation_sources(session: Session, row: ProjectTask, seen: set[UUID]) -> None:
    if row.id in seen:
        return
    seen.add(row.id)
    content = TaskContent.model_validate(row.content)
    resolve_evidence(session, row.project_id, content.evidence, lock=True)
    chapter_is_stale(session, row.project_id, content.chapter, lock=True)
    for dependency_id in content.depends_on:
        lock_confirmation_sources(session, task(session, row.project_id, dependency_id), seen)


def append_version(session: Session, row: ProjectTask, action: str, reason: str = "") -> TaskRead:
    session.flush()
    result = read_task(session, row)
    session.add(
        TaskVersion(
            task_id=row.id,
            version=row.version,
            action=action,
            reason=reason,
            snapshot=result.model_dump(mode="json"),
        )
    )
    return result


def create_in_transaction(session: Session, owner: Project, content: TaskContent) -> TaskRead:
    from uuid import uuid4

    task_id = uuid4()
    current_board = board(session, owner.id)
    count = (
        session.scalar(
            select(func.count()).select_from(ProjectTask).where(ProjectTask.project_id == owner.id)
        )
        or 0
    )
    if count >= 500:
        raise AppError("TASK_LIMIT_REACHED", "单项目最多保存500项任务。", 422)
    validate_content(session, owner, task_id, content)
    snapshots = resolve_evidence(session, owner.id, content.evidence)
    row = ProjectTask(
        id=task_id,
        project_id=owner.id,
        version=1,
        position=count,
        status=content.status,
        content=content.model_dump(mode="json"),
        evidence_snapshots=[item.model_dump(mode="json") for item in snapshots],
        confirmed_dependency_versions={},
    )
    session.add(row)
    current_board.version += 1
    return append_version(session, row, "create")


def create_task(session: Session, project_id: UUID, data: TaskCreate) -> TaskRead:
    with session.begin():
        owner = project(session, project_id, lock=True)
        old = replay(session, project_id, "task.create", data, TaskRead)
        if old:
            return old
        cas(board(session, project_id).version, data.expected_board_version, board_version=True)
        result = create_in_transaction(session, owner, data.content)
        remember(session, project_id, "task.create", data, result)
        return result


def get_task(session: Session, project_id: UUID, task_id: UUID) -> TaskRead:
    with session.begin():
        project(session, project_id)
        return read_task(session, task(session, project_id, task_id))


def list_tasks(session: Session, project_id: UUID, *, limit: int, offset: int) -> TaskPage:
    with session.begin():
        project(session, project_id)
        current_board = session.get(TaskBoard, project_id)
        query = select(ProjectTask).where(ProjectTask.project_id == project_id)
        total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = session.scalars(
            query.order_by(ProjectTask.position, ProjectTask.id).limit(limit).offset(offset)
        ).all()
        values = [read_task(session, row) for row in rows]
        return TaskPage(
            items=[
                TaskSummary(
                    id=value.id,
                    project_id=project_id,
                    version=value.version,
                    position=value.position,
                    title=value.content.title,
                    status=value.status,
                    archived=value.content.archived,
                    due_date=value.content.due_date,
                    needs_review=value.needs_review,
                    review_reasons=value.review_reasons,
                    updated_at=value.updated_at,
                )
                for value in values
            ],
            total=total,
            limit=limit,
            offset=offset,
            board_version=current_board.version if current_board else 0,
        )


def update_task(session: Session, project_id: UUID, task_id: UUID, data: TaskUpdate) -> TaskRead:
    with session.begin():
        owner = project(session, project_id, lock=True)
        operation = f"task.update:{task_id}"
        old = replay(session, project_id, operation, data, TaskRead)
        if old:
            return old
        row = task(session, project_id, task_id)
        cas(row.version, data.expected_version)
        validate_content(session, owner, task_id, data.content)
        snapshots = resolve_evidence(session, project_id, data.content.evidence)
        row.content = data.content.model_dump(mode="json")
        row.evidence_snapshots = [item.model_dump(mode="json") for item in snapshots]
        row.status = data.content.status
        row.confirmed_dependency_versions = {}
        row.version += 1
        row.updated_at = utcnow()
        result = append_version(session, row, "edit")
        remember(session, project_id, operation, data, result)
        return result


def decide_task(session: Session, project_id: UUID, task_id: UUID, data: TaskDecision) -> TaskRead:
    with session.begin():
        project(session, project_id, lock=True)
        operation = f"task.decide:{task_id}"
        old = replay(session, project_id, operation, data, TaskRead)
        if old:
            return old
        row = task(session, project_id, task_id)
        cas(row.version, data.expected_version)
        content = TaskContent.model_validate(row.content)
        if content.archived:
            raise AppError("TASK_ARCHIVED", "归档任务须先恢复。", 409)
        if data.action == "confirm":
            lock_confirmation_sources(session, row, set())
            snapshots = resolve_evidence(session, project_id, content.evidence)
            current = read_task(session, row)
            if current.needs_review:
                raise AppError("TASK_EVIDENCE_STALE", "证据或依赖待复核，不能确认完成。", 409)
            row.status = "confirmed"
            row.evidence_snapshots = [item.model_dump(mode="json") for item in snapshots]
            row.confirmed_dependency_versions = {
                str(did): task(session, project_id, did).version for did in content.depends_on
            }
        else:
            row.status = "rework" if data.action == "rework" else "todo"
            row.confirmed_dependency_versions = {}
        row.version += 1
        row.updated_at = utcnow()
        result = append_version(session, row, data.action, data.reason)
        remember(session, project_id, operation, data, result)
        return result


def reorder_tasks(session: Session, project_id: UUID, data: TaskReorder) -> BoardRead:
    with session.begin():
        project(session, project_id, lock=True)
        old = replay(session, project_id, "task.reorder", data, BoardRead)
        if old:
            return old
        current_board = board(session, project_id)
        cas(current_board.version, data.expected_board_version, board_version=True)
        rows = session.scalars(
            select(ProjectTask).where(ProjectTask.project_id == project_id)
        ).all()
        if len(set(data.task_ids)) != len(data.task_ids) or set(data.task_ids) != {
            r.id for r in rows
        }:
            raise AppError("TASK_ORDER_INVALID", "排序必须完整且恰好包含本项目全部任务。", 422)
        positions = {tid: i for i, tid in enumerate(data.task_ids)}
        for row in rows:
            if row.position != positions[row.id]:
                row.position = positions[row.id]
                row.version += 1
                row.updated_at = utcnow()
                append_version(session, row, "reorder")
        current_board.version += 1
        result = BoardRead(board_version=current_board.version, task_ids=data.task_ids)
        remember(session, project_id, "task.reorder", data, result)
        return result


def list_versions(
    session: Session, project_id: UUID, task_id: UUID, *, limit: int, offset: int
) -> TaskVersionPage:
    with session.begin():
        task(session, project_id, task_id)
        query = select(TaskVersion).where(TaskVersion.task_id == task_id)
        total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = session.scalars(
            query.order_by(TaskVersion.version.desc()).limit(limit).offset(offset)
        ).all()
        return TaskVersionPage(
            items=[
                TaskVersionRead(
                    version=row.version,
                    action=row.action,
                    reason=row.reason,
                    snapshot=TaskRead.model_validate(row.snapshot),
                    created_at=row.created_at,
                )
                for row in rows
            ],
            total=total,
            limit=limit,
            offset=offset,
        )
