"""Stage confirmation commands serialized on the project row and protected by CAS.

Stage completion exists only as an explicit student confirmation record. Tasks and
materials are reported as read-only facts and never confirm a stage on their own.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, cast
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.models import Document
from thesis_pilot.modules.materials.models import Material
from thesis_pilot.modules.project_flows.models import ProjectFlowVersion
from thesis_pilot.modules.project_flows.schemas import FlowStage
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.projects.schemas import ProjectRead
from thesis_pilot.modules.stage_confirmations.models import StageConfirmation
from thesis_pilot.modules.stage_confirmations.schemas import (
    CurrentStageRead,
    DeliverableFact,
    DocumentPointer,
    EvidenceCandidate,
    EvidenceTaskSnapshot,
    StageCommandRead,
    StageConfirm,
    StageConfirmationPage,
    StageConfirmationRead,
    StageOption,
    StagePrerequisite,
    StageProgressRead,
    StageRevoke,
    StageRouteItem,
)
from thesis_pilot.modules.tasks import service as tasks
from thesis_pilot.modules.tasks.evidence import fingerprint
from thesis_pilot.modules.tasks.models import ProjectTask
from thesis_pilot.modules.tasks.schemas import TaskRead

MAX_RECORDS = 10000
Kind = Literal["confirm", "revoke"]


def _project(session: Session, project_id: UUID, *, lock: bool = False) -> Project:
    query = select(Project).where(Project.id == project_id)
    value = session.scalar(query.with_for_update() if lock else query)
    if value is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
    return value


def _conflict() -> AppError:
    return AppError("STAGE_VERSION_CONFLICT", "项目阶段已在其他窗口变化，请载入最新后再确认。", 409)


@dataclass
class _Log:
    records: list[StageConfirmation]
    revoked_by: dict[UUID, UUID]

    def active(self, flow_version_id: UUID | None) -> dict[str, StageConfirmation]:
        """Latest unrevoked confirmation per stage for one flow version."""
        result: dict[str, StageConfirmation] = {}
        for row in self.records:
            if (
                row.kind == "confirm"
                and row.flow_version_id == flow_version_id
                and row.id not in self.revoked_by
            ):
                result[row.stage_id] = row
        return result

    def latest_active(self) -> StageConfirmation | None:
        for row in reversed(self.records):
            if row.kind == "confirm" and row.id not in self.revoked_by:
                return row
        return None


def _log(session: Session, project_id: UUID) -> _Log:
    rows = list(
        session.scalars(
            select(StageConfirmation)
            .where(StageConfirmation.project_id == project_id)
            .order_by(StageConfirmation.sequence)
        ).all()
    )
    return _Log(rows, {row.revokes_id: row.id for row in rows if row.revokes_id is not None})


def _stages(session: Session, version_id: UUID) -> list[FlowStage]:
    snapshot = session.get(ProjectFlowVersion, version_id)
    if snapshot is None:
        raise AppError("STAGE_INVALID", "项目绑定的流程版本不可用。", 422)
    return [FlowStage.model_validate(stage) for stage in snapshot.stages]


def _stage_name(stages: list[FlowStage], stage_id: str) -> str:
    return next((stage.name for stage in stages if stage.id == stage_id), stage_id)


def _read(
    row: StageConfirmation, stages: list[FlowStage], revoked_by: UUID | None
) -> StageConfirmationRead:
    return StageConfirmationRead(
        id=row.id,
        project_id=row.project_id,
        sequence=row.sequence,
        kind=cast(Kind, row.kind),
        flow_version_id=row.flow_version_id,
        stage_id=row.stage_id,
        stage_name=_stage_name(stages, row.stage_id),
        next_stage_id=row.next_stage_id,
        resulting_stage_id=row.resulting_stage_id,
        resulting_stage_name=_stage_name(stages, row.resulting_stage_id),
        revokes_id=row.revokes_id,
        revoked_by_id=revoked_by,
        document_id=row.document_id,
        document_version=row.document_version,
        evidence=[EvidenceTaskSnapshot.model_validate(item) for item in row.evidence],
        note=row.note,
        project_version_after=row.project_version_after,
        created_at=row.created_at,
    )


def _project_tasks(session: Session, project_id: UUID) -> list[TaskRead]:
    rows = session.scalars(
        select(ProjectTask)
        .where(ProjectTask.project_id == project_id)
        .order_by(ProjectTask.position, ProjectTask.id)
    ).all()
    cache: dict[UUID, TaskRead] = {}
    return [tasks.read_task(session, row, cache) for row in rows]


def _usable(task: TaskRead) -> bool:
    return task.status == "confirmed" and not task.content.archived and not task.needs_review


def _norm(value: str) -> str:
    return "".join(value.split()).casefold()


def _deliverables(
    session: Session, project_id: UUID, stage: FlowStage, usable: list[TaskRead]
) -> list[DeliverableFact]:
    materials = session.scalars(
        select(Material).where(Material.project_id == project_id, Material.removed.is_(False))
    ).all()
    result: list[DeliverableFact] = []
    for name in stage.deliverables:
        key = _norm(name)
        task_ids = [
            task.id
            for task in usable
            if key
            and any(
                key in _norm(text)
                for text in (
                    task.content.title,
                    task.content.acceptance,
                    *(item.label for item in task.evidence_snapshots),
                )
            )
        ]
        material_ids = [
            material.id
            for material in materials
            if key and (key in _norm(material.name) or key in _norm(material.source_note))
        ]
        result.append(
            DeliverableFact(
                name=name,
                status="confirmed_task" if task_ids else "material" if material_ids else "none",
                task_ids=task_ids,
                material_ids=material_ids,
            )
        )
    return result


def _next_options(stages: list[FlowStage], current: str, confirmed: set[str]) -> list[StageOption]:
    done = confirmed | {current}
    return [
        StageOption(id=stage.id, name=stage.name)
        for stage in stages
        if stage.enabled
        and stage.id not in done
        and all(dependency in done for dependency in stage.dependencies)
    ]


def _document(session: Session, project_id: UUID) -> Document | None:
    return session.scalar(select(Document).where(Document.project_id == project_id))


def _revocable(log: _Log, owner: Project) -> StageConfirmation | None:
    latest = log.latest_active()
    if (
        latest is None
        or latest.flow_version_id != owner.flow_version_id
        or latest.resulting_stage_id != owner.stage_id
    ):
        return None
    return latest


def get_progress(session: Session, project_id: UUID) -> StageProgressRead:
    with session.begin():
        owner = _project(session, project_id)
        document = _document(session, project_id)
        pointer = (
            DocumentPointer(document_id=document.id, version=document.current_version)
            if document
            else None
        )
        usable = [task for task in _project_tasks(session, project_id) if _usable(task)]
        candidates = [
            EvidenceCandidate(task_id=task.id, version=task.version, title=task.content.title)
            for task in usable
        ]
        log = _log(session, project_id)
        revocable = _revocable(log, owner)
        common = {
            "project_id": owner.id,
            "project_version": owner.version,
            "stage_id": owner.stage_id,
            "document": pointer,
            "evidence_candidates": candidates,
            "revocable_id": revocable.id if revocable else None,
        }
        if owner.flow_version_id is None:
            return StageProgressRead.model_validate(
                {
                    **common,
                    "binding": "unbound",
                    "flow_id": None,
                    "flow_version_id": None,
                    "flow_version": None,
                    "flow_name": None,
                    "stages": [],
                    "current": None,
                }
            )
        snapshot = session.get(ProjectFlowVersion, owner.flow_version_id)
        if snapshot is None:
            raise AppError("STAGE_INVALID", "项目绑定的流程版本不可用。", 422)
        stages = [FlowStage.model_validate(stage) for stage in snapshot.stages]
        enabled = [stage for stage in stages if stage.enabled]
        active = log.active(owner.flow_version_id)
        current = next((stage for stage in enabled if stage.id == owner.stage_id), None)
        route = [
            StageRouteItem(
                id=stage.id,
                name=stage.name,
                state="current"
                if current is not None and stage.id == current.id
                else "confirmed"
                if stage.id in active
                else "upcoming",
                start=stage.start.isoformat() if stage.start else None,
                deadline=stage.deadline.isoformat() if stage.deadline else None,
                confirmation_id=active[stage.id].id if stage.id in active else None,
            )
            for stage in enabled
        ]
        current_read = None
        if current is not None:
            entered = next(
                (
                    row
                    for row in reversed(log.records)
                    if row.kind == "confirm"
                    and row.id not in log.revoked_by
                    and row.flow_version_id == owner.flow_version_id
                    and row.next_stage_id == current.id
                ),
                None,
            )
            prerequisites = [
                StagePrerequisite(
                    stage_id=dependency,
                    name=_stage_name(stages, dependency),
                    confirmed=dependency in active,
                )
                for dependency in current.dependencies
            ]
            current_read = CurrentStageRead(
                stage=current,
                confirmed=current.id in active,
                confirmation_id=active[current.id].id if current.id in active else None,
                entered_at=entered.created_at if entered else None,
                prerequisites=prerequisites,
                prerequisites_met=all(item.confirmed for item in prerequisites),
                deliverables=_deliverables(session, project_id, current, usable),
                next_stages=_next_options(enabled, current.id, set(active)),
            )
        return StageProgressRead.model_validate(
            {
                **common,
                "binding": "ready" if current is not None else "invalid",
                "flow_id": snapshot.flow_id,
                "flow_version_id": snapshot.id,
                "flow_version": snapshot.version,
                "flow_name": snapshot.name,
                "stages": route,
                "current": current_read,
            }
        )


def _replay(
    session: Session, project_id: UUID, kind: str, scope: str, data: StageConfirm | StageRevoke
) -> StageCommandRead | None:
    row = session.scalar(
        select(StageConfirmation).where(StageConfirmation.command_id == data.command_id)
    )
    if row is None:
        return None
    if (
        row.project_id != project_id
        or row.kind != kind
        or row.request_hash != fingerprint([scope, data.model_dump(mode="json")])
    ):
        raise AppError(
            "STAGE_COMMAND_CONFLICT", "该操作标识已用于其他阶段操作，请核对原结果。", 409
        )
    return StageCommandRead.model_validate(row.result)


def _advance(session: Session, owner: Project, expected: int, stage_id: str) -> Project:
    # Version predicate and write execute in one statement even though the row is locked.
    project = session.scalars(
        update(Project)
        .where(Project.id == owner.id, Project.version == expected)
        .values(stage_id=stage_id, version=Project.version + 1, updated_at=datetime.now(UTC))
        .returning(Project)
        .execution_options(synchronize_session=False, populate_existing=True)
    ).one_or_none()
    if project is None:
        raise _conflict()
    return project


def _append(
    session: Session,
    owner: Project,
    data: StageConfirm | StageRevoke,
    scope: str,
    log: _Log,
    stages: list[FlowStage],
    row: StageConfirmation,
    project: Project,
) -> StageCommandRead:
    if len(log.records) >= MAX_RECORDS:
        raise AppError("STAGE_LIMIT_REACHED", "阶段确认记录已达上限，原记录保持不变。", 422)
    row.project_id = owner.id
    row.sequence = (log.records[-1].sequence if log.records else 0) + 1
    row.project_version_after = project.version
    row.command_id = data.command_id
    row.request_hash = fingerprint([scope, data.model_dump(mode="json")])
    row.result = {}
    session.add(row)
    session.flush()
    result = StageCommandRead(
        confirmation=_read(row, stages, None), project=ProjectRead.model_validate(project)
    )
    row.result = result.model_dump(mode="json")
    return result


def confirm_stage(session: Session, project_id: UUID, data: StageConfirm) -> StageCommandRead:
    scope = f"stage.confirm:{project_id}"
    with session.begin():
        owner = _project(session, project_id, lock=True)
        old = _replay(session, project_id, "confirm", scope, data)
        if old:
            return old
        if owner.archived:
            raise AppError("STAGE_PROJECT_ARCHIVED", "归档项目不能确认阶段，请先恢复项目。", 409)
        if owner.version != data.expected_project_version:
            raise _conflict()
        if owner.flow_version_id is None or owner.stage_id is None:
            raise AppError("STAGE_FLOW_REQUIRED", "项目尚未绑定流程，请先在项目设置中选择。", 409)
        if owner.flow_version_id != data.flow_version_id or owner.stage_id != data.stage_id:
            raise AppError(
                "STAGE_NOT_CURRENT", "所选阶段不是项目当前阶段，请载入最新后再确认。", 409
            )
        stages = _stages(session, owner.flow_version_id)
        enabled = [stage for stage in stages if stage.enabled]
        stage = next((item for item in enabled if item.id == data.stage_id), None)
        if stage is None:
            raise AppError("STAGE_INVALID", "当前阶段不在绑定流程版本中或已停用。", 422)
        log = _log(session, project_id)
        active = log.active(owner.flow_version_id)
        if stage.id in active:
            raise AppError("STAGE_ALREADY_CONFIRMED", "此阶段已有有效的确认记录。", 409)
        if any(dependency not in active for dependency in stage.dependencies):
            raise AppError(
                "STAGE_PREREQUISITE_UNCONFIRMED", "前置阶段尚未确认，请先核对前置阶段。", 409
            )
        options = _next_options(enabled, stage.id, set(active))
        if data.next_stage_id is None and options:
            raise AppError("STAGE_NEXT_INVALID", "请选择接下来进入的阶段。", 422)
        if data.next_stage_id is not None and all(
            item.id != data.next_stage_id for item in options
        ):
            raise AppError("STAGE_NEXT_INVALID", "所选下一阶段不可进入，请重新选择。", 422)
        document = _document(session, project_id)
        if (document.current_version if document else None) != data.document_version:
            raise AppError("STAGE_DOCUMENT_STALE", "正文已有新版本，请载入最新后重新核对。", 409)
        evidence: list[dict[str, object]] = []
        for ref in data.evidence:
            row = session.scalar(
                select(ProjectTask).where(
                    ProjectTask.id == ref.task_id, ProjectTask.project_id == project_id
                )
            )
            if row is None:
                raise AppError("STAGE_EVIDENCE_INVALID", "依据任务不属于当前项目。", 422)
            task = tasks.read_task(session, row)
            if task.status != "confirmed" or task.content.archived:
                raise AppError(
                    "STAGE_EVIDENCE_INVALID", "依据任务必须是学生已确认完成的任务。", 422
                )
            if task.version != ref.version or task.needs_review:
                raise AppError("STAGE_EVIDENCE_STALE", "依据任务已变化或待复核，请载入最新。", 409)
            evidence.append(
                EvidenceTaskSnapshot(
                    task_id=task.id, version=task.version, title=task.content.title
                ).model_dump(mode="json")
            )
        resulting = data.next_stage_id or stage.id
        project = _advance(session, owner, data.expected_project_version, resulting)
        record = StageConfirmation(
            kind="confirm",
            flow_version_id=data.flow_version_id,
            stage_id=stage.id,
            next_stage_id=data.next_stage_id,
            resulting_stage_id=resulting,
            revokes_id=None,
            document_id=document.id if document else None,
            document_version=document.current_version if document else None,
            evidence=evidence,
            note=data.note,
        )
        return _append(session, owner, data, scope, log, stages, record, project)


def revoke_stage(
    session: Session, project_id: UUID, confirmation_id: UUID, data: StageRevoke
) -> StageCommandRead:
    scope = f"stage.revoke:{project_id}:{confirmation_id}"
    with session.begin():
        owner = _project(session, project_id, lock=True)
        old = _replay(session, project_id, "revoke", scope, data)
        if old:
            return old
        if owner.archived:
            raise AppError(
                "STAGE_PROJECT_ARCHIVED", "归档项目不能撤销阶段确认，请先恢复项目。", 409
            )
        target = session.scalar(
            select(StageConfirmation).where(
                StageConfirmation.id == confirmation_id,
                StageConfirmation.project_id == project_id,
                StageConfirmation.kind == "confirm",
            )
        )
        if target is None:
            raise AppError("STAGE_CONFIRMATION_NOT_FOUND", "阶段确认记录不存在。", 404)
        if owner.version != data.expected_project_version:
            raise _conflict()
        log = _log(session, project_id)
        if _revocable(log, owner) is not target:
            raise AppError(
                "STAGE_REVOKE_CONFLICT",
                "只能撤销最近一次确认，且项目仍停留在该确认后的阶段。",
                409,
            )
        stages = _stages(session, target.flow_version_id)
        project = _advance(session, owner, data.expected_project_version, target.stage_id)
        record = StageConfirmation(
            kind="revoke",
            flow_version_id=target.flow_version_id,
            stage_id=target.stage_id,
            next_stage_id=None,
            resulting_stage_id=target.stage_id,
            revokes_id=target.id,
            document_id=None,
            document_version=None,
            evidence=[],
            note=data.note,
        )
        return _append(session, owner, data, scope, log, stages, record, project)


def list_confirmations(
    session: Session, project_id: UUID, *, limit: int, offset: int
) -> StageConfirmationPage:
    with session.begin():
        _project(session, project_id)
        query = select(StageConfirmation).where(StageConfirmation.project_id == project_id)
        total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = session.scalars(
            query.order_by(StageConfirmation.sequence.desc()).limit(limit).offset(offset)
        ).all()
        revoked = {
            row.revokes_id: row.id
            for row in session.scalars(
                select(StageConfirmation).where(
                    StageConfirmation.project_id == project_id,
                    StageConfirmation.revokes_id.in_([row.id for row in rows]),
                )
            ).all()
        }
        snapshots: dict[UUID, list[FlowStage]] = {}
        items = []
        for row in rows:
            if row.flow_version_id not in snapshots:
                snapshots[row.flow_version_id] = _stages(session, row.flow_version_id)
            items.append(_read(row, snapshots[row.flow_version_id], revoked.get(row.id)))
        return StageConfirmationPage(items=items, total=total, limit=limit, offset=offset)
