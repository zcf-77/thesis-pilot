import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier

import httpx
import pytest
from sqlalchemy import func, select, update

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.workspace import service
from thesis_pilot.modules.workspace.dependencies import COOKIE_NAME
from thesis_pilot.modules.workspace.models import WorkspaceProfile, WorkspaceSession
from thesis_pilot.modules.workspace.schemas import ProfileUpdate

from .conftest import PostgreSQLSandbox

pytestmark = pytest.mark.integration
KEY = "synthetic-workspace-integration-key-32-characters"


def test_concurrent_initial_sessions_share_one_workspace(postgres: PostgreSQLSandbox) -> None:
    barrier = Barrier(2, timeout=10)

    def create(_: int) -> tuple:
        barrier.wait()
        with postgres.sessions() as session:
            return service.create_session(session, seconds=3600)

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(create, [0, 1]))
    assert outcomes[0][0] != outcomes[1][0]
    assert outcomes[0][1].workspace_id == outcomes[1][1].workspace_id
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(WorkspaceProfile)) == 1
        assert session.scalar(select(func.count()).select_from(WorkspaceSession)) == 2
    for token, info in outcomes:
        with postgres.sessions() as session:
            assert service.read_session(session, token).workspace_id == info.workspace_id


def test_concurrent_profile_updates_do_not_lose_preferences(postgres: PostgreSQLSandbox) -> None:
    with postgres.sessions() as session:
        _, initial = service.create_session(session, seconds=3600)
    barrier = Barrier(2, timeout=10)

    def change(name: str) -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                result = service.update_profile(
                    session,
                    initial.workspace_id,
                    ProfileUpdate(
                        expected_version=1,
                        display_name=name,
                        notifications_enabled=False,
                        quiet_start="21:00",
                        quiet_end="09:00",
                        show_deferred=True,
                    ),
                )
                assert result.version == 2
                return "saved"
            except AppError as error:
                assert error.code == "WORKSPACE_PROFILE_CONFLICT"
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(change, ["自制甲", "自制乙"])) == ["conflict", "saved"]
    with postgres.sessions() as session:
        saved = session.get(WorkspaceProfile, initial.workspace_id)
        assert saved.version == 2
        assert saved.display_name in {"自制甲", "自制乙"}
        assert saved.show_deferred and not saved.notifications_enabled


@contextmanager
def real_workspace_http(
    postgres: PostgreSQLSandbox, log: Path, port: int
) -> Iterator[httpx.Client]:
    origin = f"http://127.0.0.1:{port}"
    environment = {
        **os.environ,
        "TP_ENVIRONMENT": "test",
        "TP_DATABASE_URL": postgres.url,
        "TP_AUTH_MODE": "workspace",
        "TP_WORKSPACE_ORIGIN": origin,
        "TP_WORKSPACE_ACCESS_KEY": KEY,
        "TP_WORKSPACE_SESSION_SECONDS": "3600",
        "TP_API_TOKEN": "",
        "TP_CORS_ORIGINS": "[]",
    }
    environment.pop("TP_WORKSPACE_WEB_ROOT", None)
    with log.open("ab") as output:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "thesis_pilot.main:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--no-access-log",
                "--log-level",
                "warning",
            ],
            env=environment,
            stdout=output,
            stderr=subprocess.STDOUT,
        )
        try:
            with httpx.Client(base_url=origin, headers={"Origin": origin}, timeout=20) as client:
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    assert process.poll() is None, "workspace HTTP server exited during startup"
                    try:
                        if client.get("/health/live").status_code == 200:
                            break
                    except httpx.ConnectError:
                        pass
                    time.sleep(0.05)
                else:
                    pytest.fail("workspace HTTP server did not become live")
                yield client
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def test_real_http_restart_revocation_expiry_and_manuscript_access(
    postgres: PostgreSQLSandbox, tmp_path: Path
) -> None:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    log = tmp_path / "workspace-http.log"
    with real_workspace_http(postgres, log, port) as client:
        assert client.get("/api/v1/projects").status_code == 401
        assert (
            client.get("/api/v1/projects", headers={"Authorization": f"Bearer {KEY}"}).status_code
            == 401
        )
        entered = client.post("/api/v1/workspace/session", json={"access_key": KEY})
        assert entered.status_code == 200
        workspace_id = entered.json()["workspace_id"]
        active_token = client.cookies.get(COOKIE_NAME)
        created = client.post("/api/v1/projects", json={"name": "本机会话HTTP自制项目"})
        assert created.status_code == 201
        project_id = created.json()["id"]
        content = {"schema_version": 1, "json": {"type": "doc", "content": [{"type": "paragraph"}]}}
        imported = client.post(
            f"/api/v1/projects/{project_id}/documents", json={"content": content}
        )
        assert imported.status_code == 201
        document_id = imported.json()["id"]
        history_path = f"/api/v1/projects/{project_id}/documents/{document_id}/versions/1"
        assert client.get(history_path).status_code == 200
        client.cookies.clear()
        assert client.post("/api/v1/workspace/session", json={"access_key": KEY}).status_code == 200
        revoked_token = client.cookies.get(COOKIE_NAME)
        assert client.delete("/api/v1/workspace/session").status_code == 204
    with real_workspace_http(postgres, log, port) as client:
        rejected = client.get(history_path, headers={"Cookie": f"{COOKIE_NAME}={revoked_token}"})
        assert rejected.status_code == 401
        assert rejected.headers["cache-control"] == "no-store"
        client.cookies.set(COOKIE_NAME, active_token, domain="127.0.0.1", path="/api/v1")
        assert client.get("/api/v1/workspace/session").json()["workspace_id"] == workspace_id
        assert client.get(history_path).json()["content"] == content
        wrong_origin = client.patch(
            f"/api/v1/projects/{project_id}",
            headers={"Origin": "http://other.test"},
            json={"name": "不可写入", "expected_version": 1},
        )
        assert wrong_origin.status_code == 403
        with postgres.sessions() as session, session.begin():
            session.execute(
                update(WorkspaceSession)
                .where(WorkspaceSession.token_hash == service.token_digest(active_token))
                .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
        assert client.get(history_path).status_code == 401
        assert client.post("/api/v1/workspace/session", json={"access_key": KEY}).status_code == 200
        project = client.get(f"/api/v1/projects/{project_id}")
        assert project.status_code == 200
        assert project.json()["name"] == "本机会话HTTP自制项目"
    assert KEY not in log.read_text(encoding="utf-8")
    assert active_token not in log.read_text(encoding="utf-8")
