from datetime import timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.projects import service
from thesis_pilot.modules.projects.schemas import ProjectCreate, ProjectUpdate


def test_project_service_persists_and_rejects_stale_update(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        original = service.create_project(session, ProjectCreate(name="  自制项目  "))
    assert original.name == "自制项目"
    assert original.created_at.utcoffset() == timedelta(0)
    with session_factory() as session:
        restored = service.get_project(session, original.id)
        assert restored == original
        current = service.update_project(
            session, original.id, ProjectUpdate(name="人工修改", expected_version=1)
        )
    assert current.version == 2
    with session_factory() as session:
        with pytest.raises(AppError) as captured:
            service.update_project(
                session, original.id, ProjectUpdate(name="陈旧修改", expected_version=1)
            )
        assert captured.value.code == "PROJECT_VERSION_CONFLICT"
        assert captured.value.status_code == 409
        assert service.get_project(session, original.id) == current


def test_project_service_pagination_has_stable_nonoverlapping_pages(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        ids = {
            service.create_project(session, ProjectCreate(name=name)).id
            for name in ("甲", "乙", "丙")
        }
        first = service.list_projects(session, limit=2, offset=0)
        second = service.list_projects(session, limit=2, offset=2)
    assert first.total == second.total == 3
    assert len(first.items) == 2 and len(second.items) == 1
    assert {item.id for item in first.items + second.items} == ids
