"""Transaction boundaries and optimistic concurrency for project metadata."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.project_flows.service import validate_project_binding
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.projects.schemas import (
    ProjectCreate,
    ProjectPage,
    ProjectRead,
    ProjectUpdate,
)


def create_project(session: Session, data: ProjectCreate) -> ProjectRead:
    with session.begin():
        validate_project_binding(session, data.flow_version_id, data.stage_id)
        project = Project(**data.model_dump())
        session.add(project)
        session.flush()
        result = ProjectRead.model_validate(project)
    return result


def list_projects(session: Session, *, limit: int, offset: int) -> ProjectPage:
    with session.begin():
        total = session.scalar(select(func.count()).select_from(Project)) or 0
        projects = session.scalars(
            select(Project)
            .order_by(Project.created_at.desc(), Project.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return ProjectPage(
            items=[ProjectRead.model_validate(project) for project in projects],
            total=total,
            limit=limit,
            offset=offset,
        )


def get_project(session: Session, project_id: UUID) -> ProjectRead:
    with session.begin():
        project = session.get(Project, project_id)
        if project is None:
            raise AppError("PROJECT_NOT_FOUND", "项目不存在。", status_code=404)
        return ProjectRead.model_validate(project)


def update_project(session: Session, project_id: UUID, data: ProjectUpdate) -> ProjectRead:
    with session.begin():
        current = session.get(Project, project_id)
        if current is None:
            raise AppError("PROJECT_NOT_FOUND", "项目不存在。", status_code=404)
        if current.version != data.expected_version:
            raise AppError(
                "PROJECT_VERSION_CONFLICT", "项目已被修改，请重新读取后再保存。", status_code=409
            )
        values = data.model_dump(exclude_unset=True, exclude={"expected_version"})
        version_id = (
            data.flow_version_id if "flow_version_id" in values else current.flow_version_id
        )
        stage_id = data.stage_id if "stage_id" in values else current.stage_id
        if (version_id, stage_id) != (current.flow_version_id, current.stage_id):
            validate_project_binding(session, version_id, stage_id)
        # The version predicate and write execute in one statement. A separate
        # read/check/write would permit two requests to overwrite one another.
        project = session.scalars(
            update(Project)
            .where(Project.id == project_id, Project.version == data.expected_version)
            .values(
                **values,
                version=Project.version + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(Project)
            .execution_options(synchronize_session=False, populate_existing=True)
        ).one_or_none()
        if project is None:
            if session.scalar(select(Project.id).where(Project.id == project_id)) is None:
                raise AppError("PROJECT_NOT_FOUND", "项目不存在。", status_code=404)
            raise AppError(
                "PROJECT_VERSION_CONFLICT",
                "项目已被修改，请重新读取后再保存。",
                status_code=409,
            )
        return ProjectRead.model_validate(project)
