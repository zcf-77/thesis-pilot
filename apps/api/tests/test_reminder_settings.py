"""SG-10 reminder parameters: persisted workspace rules replace the derivation constants."""

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from test_notifications import NOW, add_task, move, project, refresh, rows

from thesis_pilot.modules.notifications.derivation import COOLDOWN_HOURS, OVERDUE_DAYS
from thesis_pilot.modules.tasks import service as tasks
from thesis_pilot.modules.tasks.schemas import TaskUpdate

URL = "/api/v1/reminder-settings"
TODAY = date(2030, 6, 10)


def put(client: TestClient, version: int, **values: object):
    body = {"expected_version": version, "enabled": True, "cooldown_hours": 24, "overdue_days": 1}
    return client.put(URL, json={**body, **values})


def test_defaults_update_cas_and_bounds(client: TestClient) -> None:
    first = client.get(URL)
    assert first.status_code == 200
    assert first.json() == {
        "version": 0,
        "enabled": True,
        "cooldown_hours": COOLDOWN_HOURS,
        "overdue_days": OVERDUE_DAYS,
        "updated_at": None,
    }
    saved = put(client, 0, cooldown_hours=48, overdue_days=3)
    assert saved.status_code == 200 and saved.json()["version"] == 1
    assert client.get(URL).json()["cooldown_hours"] == 48
    stale = put(client, 0)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "PLAN_REMINDER_CONFLICT"
    for invalid in ({"cooldown_hours": 0}, {"cooldown_hours": 169}, {"overdue_days": 31}):
        assert put(client, 1, **invalid).status_code == 422
    assert put(client, 1, enabled="yes").status_code == 422
    assert client.get(URL).json()["version"] == 1


def test_overdue_threshold_and_switch_drive_derivation(
    session_factory: sessionmaker[Session], client: TestClient
) -> None:
    pid = project(session_factory)
    two_days = add_task(session_factory, pid, due_date=(TODAY - timedelta(days=2)).isoformat())
    assert put(client, 0, overdue_days=3).status_code == 200
    assert refresh(session_factory, pid).created == 0
    assert put(client, 1, overdue_days=2, enabled=False).status_code == 200
    assert refresh(session_factory, pid).created == 0
    assert put(client, 2, overdue_days=2).status_code == 200
    assert refresh(session_factory, pid).created == 1
    (row,) = rows(session_factory, pid)
    assert row.kind == "task_overdue" and row.object_id == two_days


def test_cooldown_hours_come_from_settings(
    session_factory: sessionmaker[Session], client: TestClient
) -> None:
    pid = project(session_factory)
    task_id = add_task(session_factory, pid, due_date="2030-06-01")
    refresh(session_factory, pid)
    [row] = rows(session_factory, pid)
    move(session_factory, pid, row.id, 1, "dismiss")
    assert put(client, 0, cooldown_hours=2).status_code == 200
    with session_factory() as session:
        current = tasks.get_task(session, pid, task_id)
    with session_factory() as session:
        tasks.update_task(
            session,
            pid,
            task_id,
            TaskUpdate(
                command_id=uuid4(),
                expected_version=current.version,
                content=current.content.model_copy(update={"description": "补充"}),
            ),
        )
    assert refresh(session_factory, pid, NOW + timedelta(hours=1)).created == 0
    # Shorter than the 24-hour default: the saved setting, not the constant, decides.
    assert refresh(session_factory, pid, NOW + timedelta(hours=3)).created == 1
