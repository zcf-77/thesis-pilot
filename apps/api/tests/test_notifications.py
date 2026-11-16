"""SG-10 notification derivation, CAS state changes and append-only history (SQLite)."""

from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.feedback import service as feedback
from thesis_pilot.modules.feedback.models import FeedbackItem
from thesis_pilot.modules.feedback.schemas import (
    FeedbackContent,
    FeedbackCreate,
    FeedbackItemCreate,
)
from thesis_pilot.modules.jobs.models import Job
from thesis_pilot.modules.notifications import service as notices
from thesis_pilot.modules.notifications.derivation import COOLDOWN_HOURS, is_quiet
from thesis_pilot.modules.notifications.models import Notification, NotificationEvent
from thesis_pilot.modules.notifications.schemas import (
    NotificationTransition,
    ProgressNoteCreate,
)
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.tasks import service as tasks
from thesis_pilot.modules.tasks.models import ProjectTask
from thesis_pilot.modules.tasks.schemas import TaskContent, TaskCreate, TaskUpdate
from thesis_pilot.modules.workspace.models import WorkspaceProfile

# 12:00 in Asia/Shanghai, outside the default 22:00-08:00 quiet window.
NOW = datetime(2030, 6, 10, 4, 0, tzinfo=UTC)
Sessions = sessionmaker[Session]


def project(sessions: Sessions, deadline: date | None = date(2030, 12, 31)) -> UUID:
    with sessions() as session:
        return create_project(session, ProjectCreate(name="合成提醒项目", deadline=deadline)).id


def add_task(sessions: Sessions, pid: UUID, **values: object) -> UUID:
    with sessions() as session:
        board = tasks.list_tasks(session, pid, limit=1, offset=0).board_version
    content = TaskContent.model_validate({"title": "合成任务", "acceptance": "可复核", **values})
    with sessions() as session:
        return tasks.create_task(
            session,
            pid,
            TaskCreate(command_id=uuid4(), expected_board_version=board, content=content),
        ).id


def refresh(sessions: Sessions, pid: UUID, now: datetime = NOW):
    with sessions() as session:
        return notices.refresh(session, pid, now=now)


def rows(sessions: Sessions, pid: UUID) -> list[Notification]:
    with sessions() as session:
        return list(
            session.scalars(
                select(Notification)
                .where(Notification.project_id == pid)
                .order_by(Notification.created_at)
            )
        )


def move(sessions: Sessions, pid: UUID, nid: UUID, version: int, action: str, **extra: object):
    with sessions() as session:
        return notices.transition(
            session,
            pid,
            nid,
            NotificationTransition.model_validate(
                {"command_id": uuid4(), "expected_version": version, "action": action, **extra}
            ),
            now=NOW,
        )


def events(sessions: Sessions, pid: UUID) -> list[NotificationEvent]:
    with sessions() as session:
        return list(
            session.scalars(
                select(NotificationEvent)
                .where(NotificationEvent.project_id == pid)
                .order_by(NotificationEvent.created_at, NotificationEvent.version)
            )
        )


def profile(sessions: Sessions, **values: object) -> None:
    with sessions() as session, session.begin():
        session.add(WorkspaceProfile(singleton=1, **values))


def test_quiet_window_handles_midnight_and_equal_bounds() -> None:
    shanghai_23 = datetime(2030, 6, 10, 15, 0, tzinfo=UTC)
    assert is_quiet("22:00", "08:00", shanghai_23)
    assert not is_quiet("22:00", "08:00", NOW)
    assert is_quiet("09:00", "18:00", NOW)
    assert not is_quiet("12:00", "12:00", NOW)


def test_overdue_and_due_soon_tasks_are_derived_once(session_factory: Sessions) -> None:
    pid = project(session_factory)
    late = add_task(session_factory, pid, title="实验记录", due_date="2030-06-05")
    soon = add_task(session_factory, pid, title="章节草稿", hard_deadline="2030-06-11")
    add_task(session_factory, pid, title="远期任务", due_date="2030-09-01")
    first = refresh(session_factory, pid)
    assert (first.created, first.unread_count) == (2, 2)
    assert refresh(session_factory, pid).created == 0
    assert refresh(session_factory, pid, NOW + timedelta(hours=6)).created == 0
    stored = {row.object_id: row for row in rows(session_factory, pid)}
    assert stored[late].kind == "task_overdue" and stored[late].status == "unread"
    assert "已过 5 天" in stored[late].basis[0] and stored[late].uncertainty
    assert stored[soon].kind == "task_due_soon" and "还有 1 天" in stored[soon].trigger
    assert stored[late].dedupe_key == f"task_overdue:{late}:1"
    # Passing the deadline is a different fact: the due-soon task now becomes overdue.
    assert refresh(session_factory, pid, NOW + timedelta(days=3)).created == 1
    assert rows(session_factory, pid)[-1].dedupe_key == f"task_overdue:{soon}:1"


def test_confirmed_or_archived_tasks_do_not_notify(session_factory: Sessions) -> None:
    pid = project(session_factory)
    done = add_task(session_factory, pid, due_date="2030-06-01")
    add_task(session_factory, pid, due_date="2030-06-01", archived=True)
    with session_factory() as session, session.begin():
        session.execute(
            update(ProjectTask).where(ProjectTask.id == done).values(status="confirmed")
        )
    assert refresh(session_factory, pid).created == 0


def test_dismissed_returns_only_after_source_change_and_cooldown(
    session_factory: Sessions,
) -> None:
    pid = project(session_factory)
    task_id = add_task(session_factory, pid, due_date="2030-06-01")
    refresh(session_factory, pid)
    [row] = rows(session_factory, pid)
    move(session_factory, pid, row.id, 1, "dismiss")
    assert refresh(session_factory, pid, NOW + timedelta(days=2)).created == 0
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
    early = NOW + timedelta(hours=COOLDOWN_HOURS - 1)
    assert refresh(session_factory, pid, early).created == 0
    later = refresh(session_factory, pid, NOW + timedelta(hours=COOLDOWN_HOURS + 1))
    assert later.created == 1
    assert [r.source_version for r in rows(session_factory, pid)] == [1, 2]


def test_open_notification_covers_new_source_versions(session_factory: Sessions) -> None:
    pid = project(session_factory)
    task_id = add_task(session_factory, pid, due_date="2030-06-01")
    refresh(session_factory, pid)
    with session_factory() as session, session.begin():
        session.execute(update(ProjectTask).where(ProjectTask.id == task_id).values(version=7))
    assert refresh(session_factory, pid, NOW + timedelta(days=5)).created == 0


def test_quiet_hours_and_disabled_record_without_unread(session_factory: Sessions) -> None:
    profile(session_factory, quiet_start="09:00", quiet_end="18:00")
    pid = project(session_factory)
    add_task(session_factory, pid, due_date="2030-06-01")
    result = refresh(session_factory, pid)
    assert (result.created, result.unread_count) == (1, 0)
    [row] = rows(session_factory, pid)
    assert (row.status, row.delivery) == ("read", "quiet")
    with session_factory() as session, session.begin():
        session.execute(
            update(WorkspaceProfile).values(
                notifications_enabled=False, quiet_start="22:00", quiet_end="08:00"
            )
        )
    add_task(session_factory, pid, due_date="2030-06-02")
    refresh(session_factory, pid)
    assert [(r.status, r.delivery) for r in rows(session_factory, pid)][-1] == ("read", "muted")


def test_feedback_project_deadline_and_failed_jobs(session_factory: Sessions) -> None:
    pid = project(session_factory, deadline=date(2030, 6, 20))
    with session_factory() as session:
        batch = feedback.create_feedback(
            session, pid, FeedbackCreate(command_id=uuid4(), original_text="合成反馈：补充方法。")
        )
    with session_factory() as session:
        item = feedback.create_item(
            session,
            pid,
            batch.id,
            FeedbackItemCreate(
                command_id=uuid4(),
                content=FeedbackContent.model_validate(
                    {
                        "source_range": {"from": 0, "to": 4, "text": "合成反馈"},
                        "interpretation": "补充方法",
                        "certainty": "certain",
                        "source_checked": True,
                    }
                ),
            ),
        )
    failed, retried, retry = uuid4(), uuid4(), uuid4()
    with session_factory() as session, session.begin():
        session.execute(
            update(FeedbackItem)
            .where(FeedbackItem.id == item.id)
            .values(updated_at=NOW - timedelta(days=9))
        )
        for job_id, source in ((failed, None), (retried, None)):
            session.add(
                Job(
                    id=job_id,
                    project_id=pid,
                    kind="material_parse",
                    status="failed",
                    idempotency_key=str(job_id),
                    request_hash="0" * 64,
                    attempt=2,
                    error_code="MATERIAL_PARSE_FAILED",
                    source_job_id=source,
                    created_at=NOW - timedelta(days=1),
                    updated_at=NOW - timedelta(days=1),
                )
            )
        session.flush()
        session.add(
            Job(
                id=retry,
                project_id=pid,
                kind="material_parse",
                status="queued",
                idempotency_key=str(retry),
                request_hash="0" * 64,
                source_job_id=retried,
            )
        )
    assert refresh(session_factory, pid).created == 3
    by_kind = {row.kind: row for row in rows(session_factory, pid)}
    assert by_kind["feedback_stale"].parent_id == batch.id
    assert "9 天" in by_kind["feedback_stale"].trigger
    assert by_kind["project_deadline"].object_id == pid
    assert "还有 10 天" in by_kind["project_deadline"].trigger
    assert by_kind["job_failed"].object_id == failed
    assert by_kind["job_failed"].source_version == 2


def test_transitions_cas_idempotency_and_append_only_history(session_factory: Sessions) -> None:
    pid = project(session_factory)
    add_task(session_factory, pid, due_date="2030-06-01")
    refresh(session_factory, pid)
    [row] = rows(session_factory, pid)
    command = NotificationTransition(command_id=uuid4(), expected_version=1, action="read")
    with session_factory() as session:
        read = notices.transition(session, pid, row.id, command, now=NOW)
    with session_factory() as session:
        assert notices.transition(session, pid, row.id, command, now=NOW) == read
    assert (read.status, read.version) == ("read", 2)
    with session_factory() as session, pytest.raises(AppError) as reused:
        notices.transition(
            session,
            pid,
            row.id,
            command.model_copy(update={"action": "dismiss"}),
            now=NOW,
        )
    assert reused.value.code == "NOTICE_COMMAND_CONFLICT"
    for version, action, code in (
        (1, "dismiss", "NOTICE_VERSION_CONFLICT"),
        (2, "restore", "NOTICE_TRANSITION_INVALID"),
    ):
        with pytest.raises(AppError) as caught:
            move(session_factory, pid, row.id, version, action)
        assert caught.value.code == code
    for until in (NOW - timedelta(minutes=1), NOW + timedelta(days=400)):
        with pytest.raises(AppError) as caught:
            move(session_factory, pid, row.id, 2, "snooze", snooze_until=until)
        assert caught.value.code == "NOTICE_SNOOZE_INVALID"
    snapshot = [(e.id, e.action, e.to_status, e.version) for e in events(session_factory, pid)]
    snoozed = move(session_factory, pid, row.id, 2, "snooze", snooze_until=NOW + timedelta(days=1))
    assert snoozed.status == "snoozed" and snoozed.snooze_until == NOW + timedelta(days=1)
    restored = move(session_factory, pid, row.id, 3, "restore")
    assert restored.status == "unread" and restored.snooze_until is None
    history = [(e.id, e.action, e.to_status, e.version) for e in events(session_factory, pid)]
    assert history[: len(snapshot)] == snapshot
    assert [h[1] for h in history] == ["created", "read", "snooze", "restore"]


def test_expired_snooze_wakes_on_refresh_outside_quiet_hours(session_factory: Sessions) -> None:
    pid = project(session_factory)
    add_task(session_factory, pid, due_date="2030-06-01")
    refresh(session_factory, pid)
    [row] = rows(session_factory, pid)
    move(session_factory, pid, row.id, 1, "snooze", snooze_until=NOW + timedelta(hours=1))
    assert refresh(session_factory, pid, NOW + timedelta(minutes=30)).woken == 0
    # 23:30 local time is quiet: the snooze is kept until an alerting refresh.
    assert refresh(session_factory, pid, NOW + timedelta(hours=11, minutes=30)).woken == 0
    woke = refresh(session_factory, pid, NOW + timedelta(days=1))
    assert (woke.woken, woke.unread_count) == (1, 1)
    last = events(session_factory, pid)[-1]
    assert (last.action, last.actor, last.from_status) == ("snooze_expired", "system", "snoozed")


def test_progress_note_keeps_words_and_never_confirms_task(session_factory: Sessions) -> None:
    pid = project(session_factory)
    task_id = add_task(session_factory, pid, due_date="2030-06-01")
    refresh(session_factory, pid)
    [row] = rows(session_factory, pid)
    words = "  已在实验室完成两组对照实验\n数据待整理"
    with session_factory() as session:
        noted = notices.add_progress_note(
            session,
            pid,
            row.id,
            ProgressNoteCreate(command_id=uuid4(), expected_version=1, text=words),
            now=NOW,
        )
    assert noted.status == "read" and noted.progress_notes[0].text == words
    with session_factory() as session:
        assert tasks.get_task(session, pid, task_id).status == "todo"
    with pytest.raises(ValueError):
        ProgressNoteCreate(command_id=uuid4(), expected_version=2, text="   ")
    move(session_factory, pid, row.id, 2, "dismiss")
    with session_factory() as session, pytest.raises(AppError) as caught:
        notices.add_progress_note(
            session,
            pid,
            row.id,
            ProgressNoteCreate(command_id=uuid4(), expected_version=3, text="再补充"),
            now=NOW,
        )
    assert caught.value.code == "NOTICE_TRANSITION_INVALID"


def test_projects_are_isolated(session_factory: Sessions) -> None:
    first, second = project(session_factory), project(session_factory)
    add_task(session_factory, first, due_date="2030-06-01")
    refresh(session_factory, first)
    [row] = rows(session_factory, first)
    assert refresh(session_factory, second).created == 0
    with session_factory() as session, pytest.raises(AppError) as caught:
        notices.get_notification(session, second, row.id)
    assert caught.value.code == "NOTICE_NOT_FOUND"
    with pytest.raises(AppError) as moved:
        move(session_factory, second, row.id, 1, "dismiss")
    assert moved.value.code == "NOTICE_NOT_FOUND"
    with session_factory() as session:
        assert notices.unread_count(session, second).unread_count == 0
        assert (
            notices.list_events(session, second, notification_id=None, limit=20, offset=0).total
            == 0
        )


def test_http_contract_tabs_counts_and_history(client: TestClient) -> None:
    created = client.post("/api/v1/projects", json={"name": "合成HTTP提醒"})
    pid = created.json()["id"]
    board = client.get(f"/api/v1/projects/{pid}/tasks").json()["board_version"]
    yesterday = (datetime.now(UTC) - timedelta(days=3)).date().isoformat()
    client.post(
        f"/api/v1/projects/{pid}/tasks",
        json={
            "command_id": str(uuid4()),
            "expected_board_version": board,
            "content": {"title": "HTTP任务", "acceptance": "可复核", "due_date": yesterday},
        },
    ).raise_for_status()
    base = f"/api/v1/projects/{pid}/notifications"
    assert client.get(f"{base}/unread-count").json()["unread_count"] == 0
    refreshed = client.post(f"{base}/refresh")
    assert refreshed.status_code == 200 and refreshed.json()["created"] == 1
    page = client.get(base, params={"tab": "active"}).json()
    [item] = page["items"]
    assert item["object"]["type"] == "task" and item["basis"] and item["trigger"]
    missing = client.post(
        f"{base}/{item['id']}/transitions",
        json={"command_id": str(uuid4()), "expected_version": 1, "action": "snooze"},
    )
    assert missing.status_code == 422
    dismissed = client.post(
        f"{base}/{item['id']}/transitions",
        json={"command_id": str(uuid4()), "expected_version": 1, "action": "dismiss"},
    )
    assert dismissed.status_code == 200 and dismissed.json()["status"] == "dismissed"
    assert client.get(base).json()["total"] == 0
    assert client.get(base, params={"tab": "dismissed"}).json()["total"] == 1
    assert client.get(base, params={"tab": "nope"}).status_code == 422
    history = client.get(f"{base}/events").json()
    assert [e["action"] for e in history["items"]] == ["dismiss", "created"]
    assert history["items"][0]["notification_title"] == item["title"]
    conflict = client.post(
        f"{base}/{item['id']}/transitions",
        json={"command_id": str(uuid4()), "expected_version": 1, "action": "restore"},
    )
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == (
        "NOTICE_VERSION_CONFLICT"
    )
    assert client.get(f"{base}/{uuid4()}").json()["error"]["code"] == "NOTICE_NOT_FOUND"


def test_no_test_trigger_route_is_exposed(client: TestClient) -> None:
    paths = [p for p in client.get("/openapi.json").json()["paths"] if "/notifications" in p]
    assert sorted(paths) == sorted(
        [
            "/api/v1/projects/{project_id}/notifications",
            "/api/v1/projects/{project_id}/notifications/unread-count",
            "/api/v1/projects/{project_id}/notifications/refresh",
            "/api/v1/projects/{project_id}/notifications/events",
            "/api/v1/projects/{project_id}/notifications/{notification_id}",
            "/api/v1/projects/{project_id}/notifications/{notification_id}/transitions",
            "/api/v1/projects/{project_id}/notifications/{notification_id}/progress-notes",
        ]
    )


def test_event_rows_have_no_update_path(session_factory: Sessions) -> None:
    pid = project(session_factory)
    add_task(session_factory, pid, due_date="2030-06-01")
    refresh(session_factory, pid)
    with session_factory() as session:
        count = session.scalar(select(func.count()).select_from(NotificationEvent))
    assert count == 1
    assert not [name for name in dir(notices) if name.startswith(("update_event", "delete"))]
