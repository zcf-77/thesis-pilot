"""Explicit flow transactions, immutable definitions and atomic CAS updates."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.project_flows.models import ProjectFlow, ProjectFlowVersion
from thesis_pilot.modules.project_flows.schemas import (
    FlowCreate,
    FlowPage,
    FlowRead,
    FlowStage,
    FlowUpdate,
    FlowVersionPage,
    FlowVersionRead,
)


def _missing() -> AppError:
    return AppError("PROJECT_FLOW_NOT_FOUND", "流程不存在。", 404)


def _snapshot(session: Session, flow: ProjectFlow) -> ProjectFlowVersion:
    result = session.scalar(
        select(ProjectFlowVersion).where(
            ProjectFlowVersion.flow_id == flow.id,
            ProjectFlowVersion.version == flow.version,
        )
    )
    if result is None:
        raise AppError("PROJECT_FLOW_VERSION_NOT_FOUND", "流程版本不存在。", 404)
    return result


def _read(session: Session, flow: ProjectFlow) -> FlowRead:
    snapshot = _snapshot(session, flow)
    return FlowRead(
        id=flow.id,
        name=flow.name,
        version=flow.version,
        enabled=flow.enabled,
        current_version_id=snapshot.id,
        stages=[FlowStage.model_validate(stage) for stage in snapshot.stages],
        created_at=flow.created_at,
        updated_at=flow.updated_at,
    )


def create_flow(session: Session, data: FlowCreate) -> FlowRead:
    with session.begin():
        flow = ProjectFlow(name=data.name)
        session.add(flow)
        session.flush()
        session.add(
            ProjectFlowVersion(
                flow_id=flow.id,
                version=1,
                name=data.name,
                stages=[stage.model_dump(mode="json") for stage in data.stages],
            )
        )
        session.flush()
        return _read(session, flow)


def list_flows(session: Session, *, limit: int, offset: int) -> FlowPage:
    with session.begin():
        total = session.scalar(select(func.count()).select_from(ProjectFlow)) or 0
        flows = session.scalars(
            select(ProjectFlow)
            .order_by(ProjectFlow.created_at.desc(), ProjectFlow.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return FlowPage(
            items=[_read(session, flow) for flow in flows], total=total, limit=limit, offset=offset
        )


def get_flow(session: Session, flow_id: UUID) -> FlowRead:
    with session.begin():
        flow = session.get(ProjectFlow, flow_id)
        if flow is None:
            raise _missing()
        return _read(session, flow)


def update_flow(session: Session, flow_id: UUID, data: FlowUpdate) -> FlowRead:
    with session.begin():
        current = session.get(ProjectFlow, flow_id)
        if current is None:
            raise _missing()
        if current.version != data.expected_version:
            raise AppError("PROJECT_FLOW_VERSION_CONFLICT", "流程已修改，请重新读取后保存。", 409)
        previous = _snapshot(session, current)
        name = data.name if data.name is not None else current.name
        stages = (
            [stage.model_dump(mode="json") for stage in data.stages]
            if data.stages is not None
            else previous.stages
        )
        flow = session.scalars(
            update(ProjectFlow)
            .where(ProjectFlow.id == flow_id, ProjectFlow.version == data.expected_version)
            .values(
                name=name,
                enabled=data.enabled if data.enabled is not None else current.enabled,
                version=ProjectFlow.version + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(ProjectFlow)
            .execution_options(synchronize_session=False, populate_existing=True)
        ).one_or_none()
        if flow is None:
            raise AppError("PROJECT_FLOW_VERSION_CONFLICT", "流程已修改，请重新读取后保存。", 409)
        session.add(
            ProjectFlowVersion(flow_id=flow.id, version=flow.version, name=name, stages=stages)
        )
        session.flush()
        return _read(session, flow)


def list_versions(session: Session, flow_id: UUID, *, limit: int, offset: int) -> FlowVersionPage:
    with session.begin():
        if session.get(ProjectFlow, flow_id) is None:
            raise _missing()
        versions = session.scalars(
            select(ProjectFlowVersion)
            .where(ProjectFlowVersion.flow_id == flow_id)
            .order_by(ProjectFlowVersion.version.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        total = (
            session.scalar(
                select(func.count())
                .select_from(ProjectFlowVersion)
                .where(ProjectFlowVersion.flow_id == flow_id)
            )
            or 0
        )
        return FlowVersionPage(
            items=[FlowVersionRead.model_validate(version) for version in versions],
            total=total,
            limit=limit,
            offset=offset,
        )


def get_version(session: Session, flow_id: UUID, version: int) -> FlowVersionRead:
    with session.begin():
        snapshot = session.scalar(
            select(ProjectFlowVersion).where(
                ProjectFlowVersion.flow_id == flow_id, ProjectFlowVersion.version == version
            )
        )
        if snapshot is None:
            raise AppError("PROJECT_FLOW_VERSION_NOT_FOUND", "流程版本不存在。", 404)
        return FlowVersionRead.model_validate(snapshot)


def validate_project_binding(
    session: Session, version_id: UUID | None, stage_id: str | None
) -> None:
    """Called inside the project transaction; root lock serializes disable/binding."""
    if version_id is None and stage_id is None:
        return
    if version_id is None or stage_id is None:
        raise AppError("PROJECT_FLOW_BINDING_INVALID", "请选择完整的流程版本与当前阶段。", 422)
    snapshot = session.get(ProjectFlowVersion, version_id)
    if snapshot is None:
        raise AppError("PROJECT_FLOW_VERSION_NOT_FOUND", "流程版本不存在。", 404)
    flow = session.scalar(
        select(ProjectFlow).where(ProjectFlow.id == snapshot.flow_id).with_for_update()
    )
    if flow is None or not flow.enabled:
        raise AppError("PROJECT_FLOW_DISABLED", "流程已停用，不能用于新的项目绑定。", 409)
    if not any(stage["id"] == stage_id and stage["enabled"] for stage in snapshot.stages):
        raise AppError("PROJECT_FLOW_STAGE_INVALID", "当前阶段不属于所选版本或已停用。", 422)
