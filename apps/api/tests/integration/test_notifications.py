"""SG-10 notification dedupe and CAS races on real PostgreSQL (migrated with Alembic)."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.notifications import service as notices
from thesis_pilot.modules.notifications.models import Notification, NotificationEvent
from thesis_pilot.modules.notifications.schemas import NotificationTransition
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.tasks import service as tasks
from thesis_pilot.modules.tasks.schemas import TaskContent, TaskCreate

from .conftest import PostgreSQLSandbox

pytestmark = pytest.mark.integration
NOW = datetime(2030, 6, 10, 4, 0, tzinfo=UTC)


def seed(postgres: PostgreSQLSandbox, tasks_count: int = 3) -> UUID:
    with postgres.sessions() as session:
        pid = create_project(
            session, ProjectCreate(name="合成提醒PG项目", deadline=date(2030, 12, 31))
        ).id
    for index in range(tasks_count):
        with postgres.sessions() as session:
            tasks.create_task(
                session,
                pid,
                TaskCreate(
                    command_id=uuid4(),
                    expected_board_version=index,
                    content=TaskContent.model_validate(
                        {
                            "title": f"合成任务{index}",
                            "acceptance": "可复核",
                            "due_date": "2030-06-01",
                        }
                    ),
                ),
            )
    return pid


def test_concurrent_refreshes_store_each_fact_once(postgres: PostgreSQLSandbox) -> None:
    pid = seed(postgres)
    barrier = Barrier(4)

    def run() -> int:
        barrier.wait()
        with postgres.sessions() as session:
            return notices.refresh(session, pid, now=NOW).created

    with ThreadPoolExecutor(4) as pool:
        created = list(pool.map(lambda _: run(), range(4)))
    assert sum(created) == 3
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Notification)) == 3
        assert session.scalar(select(func.count()).select_from(NotificationEvent)) == 3
    # A later process (restart) reads the same persisted facts and adds nothing.
    with postgres.sessions() as session:
        assert notices.refresh(session, pid, now=NOW + timedelta(hours=2)).created == 0


def test_racing_transitions_have_one_winner(postgres: PostgreSQLSandbox) -> None:
    pid = seed(postgres, 1)
    with postgres.sessions() as session:
        notices.refresh(session, pid, now=NOW)
    with postgres.sessions() as session:
        nid = session.scalars(select(Notification.id)).one()
    barrier = Barrier(2)

    def act(action: str) -> str:
        barrier.wait()
        try:
            with postgres.sessions() as session:
                notices.transition(
                    session,
                    pid,
                    nid,
                    NotificationTransition(command_id=uuid4(), expected_version=1, action=action),
                    now=NOW,
                )
            return "ok"
        except AppError as error:
            return error.code

    with ThreadPoolExecutor(2) as pool:
        outcomes = sorted(pool.map(act, ["read", "dismiss"]))
    assert outcomes == ["NOTICE_VERSION_CONFLICT", "ok"]
    with postgres.sessions() as session:
        row = session.get(Notification, nid)
        assert row is not None and row.version == 2
        assert session.scalar(select(func.count()).select_from(NotificationEvent)) == 2


def test_same_command_replays_under_concurrency(postgres: PostgreSQLSandbox) -> None:
    pid = seed(postgres, 1)
    with postgres.sessions() as session:
        notices.refresh(session, pid, now=NOW)
    with postgres.sessions() as session:
        nid = session.scalars(select(Notification.id)).one()
    command = NotificationTransition(command_id=uuid4(), expected_version=1, action="dismiss")
    barrier = Barrier(3)

    def act() -> int:
        barrier.wait()
        with postgres.sessions() as session:
            return notices.transition(session, pid, nid, command, now=NOW).version

    with ThreadPoolExecutor(3) as pool:
        assert set(pool.map(lambda _: act(), range(3))) == {2}
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(NotificationEvent)) == 2
