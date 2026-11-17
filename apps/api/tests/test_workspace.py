import logging
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from thesis_pilot.core.config import Settings
from thesis_pilot.core.errors import AppError
from thesis_pilot.db.base import Base
from thesis_pilot.db.session import create_session_factory
from thesis_pilot.main import create_app
from thesis_pilot.modules.workspace import service
from thesis_pilot.modules.workspace.dependencies import COOKIE_NAME
from thesis_pilot.modules.workspace.models import WorkspaceProfile, WorkspaceSession

KEY = "synthetic-workspace-key-at-least-32-characters"
ORIGIN = "http://127.0.0.1:18746"


@pytest.fixture
def workspace_app(tmp_path: Path) -> Iterator[FastAPI]:
    settings = Settings(
        _env_file=None,
        environment="test",
        auth_mode="workspace",
        workspace_origin=ORIGIN,
        workspace_access_key=KEY,
        workspace_session_seconds=3600,
        database_url=f"sqlite:///{(tmp_path / 'workspace.db').as_posix()}",
    )
    app = create_app(settings)
    engine = app.state.session_factory.kw["bind"]
    Base.metadata.create_all(engine)
    yield app
    engine.dispose()


@pytest.fixture
def workspace_client(workspace_app: FastAPI) -> Iterator[TestClient]:
    with TestClient(workspace_app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as client:
        yield client


def enter(client: TestClient) -> dict:
    response = client.post("/api/v1/workspace/session", json={"access_key": KEY})
    assert response.status_code == 200, response.text
    return response.json()


def profile_update(version: int = 1) -> dict:
    return {
        "expected_version": version,
        "display_name": "自制用户",
        "notifications_enabled": False,
        "quiet_start": "23:15",
        "quiet_end": "07:45",
        "show_deferred": True,
    }


def test_enter_profile_cas_and_business_transaction(workspace_client: TestClient) -> None:
    first = enter(workspace_client)
    assert first["workspace_id"] == first["profile"]["id"]
    assert first["profile"]["version"] == 1
    assert first["expires_at"].endswith("Z")
    assert workspace_client.get("/api/v1/projects").json()["items"] == []
    created = workspace_client.post("/api/v1/projects", json={"name": "会话内真实写入"})
    assert created.status_code == 201
    saved = workspace_client.patch("/api/v1/workspace/profile", json=profile_update())
    assert saved.status_code == 200
    assert saved.json()["version"] == 2
    conflict = workspace_client.patch("/api/v1/workspace/profile", json=profile_update())
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "WORKSPACE_PROFILE_CONFLICT"
    assert workspace_client.get("/api/v1/workspace/session").json()["profile"] == saved.json()


def test_cookie_digest_rotation_revocation_and_idempotent_logout(
    workspace_client: TestClient, workspace_app: FastAPI
) -> None:
    response = workspace_client.post("/api/v1/workspace/session", json={"access_key": KEY})
    cookie_header = response.headers["set-cookie"]
    assert "HttpOnly" in cookie_header and "SameSite=strict" in cookie_header
    assert "Path=/api/v1" in cookie_header
    original_token = workspace_client.cookies.get(COOKIE_NAME)
    with workspace_app.state.session_factory() as session:
        stored = session.scalars(select(WorkspaceSession)).one()
        assert stored.token_hash == service.token_digest(original_token)
        assert original_token not in response.text and KEY not in response.text
    enter(workspace_client)
    assert workspace_client.cookies.get(COOKIE_NAME) != original_token
    assert (
        workspace_client.get(
            "/api/v1/projects", headers={"Cookie": f"{COOKIE_NAME}={original_token}"}
        ).status_code
        == 401
    )
    current_token = workspace_client.cookies.get(COOKIE_NAME)
    logout = workspace_client.delete("/api/v1/workspace/session")
    assert logout.status_code == 204 and logout.content == b""
    assert "Max-Age=0" in logout.headers["set-cookie"]
    assert workspace_client.delete("/api/v1/workspace/session").status_code == 204
    for path in ("/api/v1/projects", "/api/v1/workspace/session"):
        assert (
            workspace_client.get(
                path, headers={"Cookie": f"{COOKIE_NAME}={current_token}"}
            ).status_code
            == 401
        )


@pytest.mark.parametrize("token", [None, "forged", "x" * 257])
def test_missing_or_forged_cookie_and_bearer_never_authorize(
    workspace_client: TestClient, token: str | None
) -> None:
    headers = {"Authorization": f"Bearer {KEY}"}
    if token:
        headers["Cookie"] = f"{COOKIE_NAME}={token}"
    response = workspace_client.get("/api/v1/projects", headers=headers)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "WORKSPACE_SESSION_REQUIRED"


@pytest.mark.parametrize(
    "path",
    [
        "/projects",
        "/projects/00000000-0000-0000-0000-000000000001",
        "/projects/00000000-0000-0000-0000-000000000001/documents/current",
        "/projects/00000000-0000-0000-0000-000000000001/documents/"
        "00000000-0000-0000-0000-000000000002/versions",
        "/projects/00000000-0000-0000-0000-000000000001/documents/"
        "00000000-0000-0000-0000-000000000002/versions/1",
        "/projects/00000000-0000-0000-0000-000000000001/documents/"
        "00000000-0000-0000-0000-000000000002/revisions",
        "/projects/00000000-0000-0000-0000-000000000001/documents/"
        "00000000-0000-0000-0000-000000000002/revision-commands/"
        "00000000-0000-0000-0000-000000000003",
        "/jobs?project_id=00000000-0000-0000-0000-000000000001",
        "/jobs/00000000-0000-0000-0000-000000000001",
    ],
)
def test_all_business_reads_reject_replayed_logout_cookie(
    workspace_client: TestClient, path: str
) -> None:
    enter(workspace_client)
    token = workspace_client.cookies.get(COOKIE_NAME)
    assert workspace_client.delete("/api/v1/workspace/session").status_code == 204
    response = workspace_client.get("/api/v1" + path, headers={"Cookie": f"{COOKIE_NAME}={token}"})
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


def test_session_scheme_is_cookie_in_openapi(workspace_client: TestClient) -> None:
    schema = workspace_client.get("/openapi.json").json()
    assert schema["paths"]["/api/v1/projects"]["get"]["security"] == [{"APIKeyCookie": []}]
    assert schema["components"]["securitySchemes"]["APIKeyCookie"]["name"] == COOKIE_NAME


def test_expired_sessions_are_rejected_and_reclaimed(
    workspace_client: TestClient, workspace_app: FastAPI
) -> None:
    initial = enter(workspace_client)
    expired = workspace_client.cookies.get(COOKIE_NAME)
    with workspace_app.state.session_factory() as session, session.begin():
        session.execute(
            update(WorkspaceSession).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
    assert workspace_client.get("/api/v1/projects").status_code == 401
    assert (
        workspace_client.patch("/api/v1/workspace/profile", json=profile_update()).status_code
        == 401
    )
    assert enter(workspace_client)["workspace_id"] == initial["workspace_id"]
    with workspace_app.state.session_factory() as session:
        assert session.get(WorkspaceSession, service.token_digest(expired)) is None
        assert session.scalar(select(func.count()).select_from(WorkspaceSession)) == 1


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "http://other.test"},
        {"Origin": "null"},
        {"Origin": "http://testserver.evil"},
        {"Origin": "https://testserver"},
        {"Origin": "http://testserver:80"},
        {"Host": "evil.test", "Origin": ORIGIN},
    ],
)
def test_write_origin_and_host_cannot_create_or_mutate(
    workspace_client: TestClient, headers: dict[str, str]
) -> None:
    assert (
        workspace_client.post(
            "/api/v1/workspace/session", json={"access_key": KEY}, headers=headers
        ).status_code
        == 403
    )
    enter(workspace_client)
    assert (
        workspace_client.post(
            "/api/v1/projects", json={"name": "拒绝写入"}, headers=headers
        ).status_code
        == 403
    )
    assert workspace_client.delete("/api/v1/workspace/session", headers=headers).status_code == 403
    assert workspace_client.get("/api/v1/projects").json()["items"] == []


def test_missing_origin_rejected_for_writes_but_reads_work(workspace_client: TestClient) -> None:
    enter(workspace_client)
    del workspace_client.headers["Origin"]
    assert workspace_client.get("/api/v1/projects").status_code == 200
    assert workspace_client.post("/api/v1/projects", json={"name": "拒绝写入"}).status_code == 403
    assert workspace_client.delete("/api/v1/workspace/session").status_code == 403


def test_invalid_key_and_input_never_leak(
    workspace_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    secret = "synthetic-private-access-key-do-not-return"
    response = workspace_client.post("/api/v1/workspace/session", json={"access_key": secret})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "WORKSPACE_ACCESS_DENIED"
    assert secret not in response.text + caplog.text
    enter(workspace_client)
    data = profile_update()
    data["quiet_start"] = "24:00"
    assert workspace_client.patch("/api/v1/workspace/profile", json=data).status_code == 422
    data = profile_update()
    data["expected_version"] = 2_147_483_647
    assert workspace_client.patch("/api/v1/workspace/profile", json=data).status_code == 422
    data = profile_update()
    data["notifications_enabled"] = "false"
    assert workspace_client.patch("/api/v1/workspace/profile", json=data).status_code == 422


def test_failed_create_rolls_back_profile_and_session(workspace_app: FastAPI) -> None:
    from sqlalchemy import event

    def fail_commit(session: object) -> None:
        raise RuntimeError("synthetic failure")

    with workspace_app.state.session_factory() as session:
        event.listen(session, "before_commit", fail_commit)
        with pytest.raises(RuntimeError, match="synthetic"):
            service.create_session(session, seconds=3600)
        assert not session.in_transaction()
    with workspace_app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(WorkspaceProfile)) == 0
        assert session.scalar(select(func.count()).select_from(WorkspaceSession)) == 0


def test_service_restart_preserves_profile_and_revocation(workspace_app: FastAPI) -> None:
    factory = workspace_app.state.session_factory
    with factory() as session:
        token, first = service.create_session(session, seconds=3600)
    with factory() as session:
        second, _ = service.create_session(session, seconds=3600)
    with factory() as session:
        service.revoke_session(session, token)
    replacement = create_session_factory(workspace_app.state.settings)
    try:
        with replacement() as session:
            assert service.read_session(session, second).workspace_id == first.workspace_id
        with replacement() as session, pytest.raises(AppError) as error:
            service.read_session(session, token)
        assert error.value.code == "WORKSPACE_SESSION_REQUIRED"
    finally:
        replacement.kw["bind"].dispose()


def workspace_settings(origin: str, tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        auth_mode="workspace",
        workspace_origin=origin,
        workspace_access_key=KEY,
        database_url=f"sqlite:///{(tmp_path / 'origin.db').as_posix()}",
    )


@pytest.mark.parametrize(
    "origin",
    [
        "http://127.0.0.1:8017",
        "https://localhost:8443",
        "http://[::1]:8017",
        "https://thesis.example.edu.cn",
        "https://thesis.example.cn:8443",
        "https://xn--fiqs8s.example.org",
    ],
)
def test_local_and_canonical_public_https_origins_are_accepted(origin: str, tmp_path: Path) -> None:
    assert workspace_settings(origin, tmp_path).workspace_origin == origin


@pytest.mark.parametrize(
    "origin",
    [
        "http://thesis.example.cn",
        "http://thesis.example.cn:8080",
        "https://thesis.example.cn/",
        "https://thesis.example.cn/app",
        "https://thesis.example.cn?x=1",
        "https://thesis.example.cn#top",
        "https://user@thesis.example.cn",
        "https://*.example.cn",
        "https://Thesis.Example.cn",
        "https://thesis.example.cn.",
        "https://thesis.example.cn:443",
        "https://thesis",
        "https://203.0.113.7",
        "https://thesis_example.cn",
        "ftp://thesis.example.cn",
        "http://127.0.0.1:80",
    ],
)
def test_other_workspace_origins_are_rejected(origin: str, tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="正式工作区地址"):
        workspace_settings(origin, tmp_path)


def test_public_https_origin_keeps_exact_host_and_secure_strict_cookie(tmp_path: Path) -> None:
    origin = "https://thesis.example.edu.cn"
    app = create_app(workspace_settings(origin, tmp_path))
    engine = app.state.session_factory.kw["bind"]
    Base.metadata.create_all(engine)
    try:
        with TestClient(app, base_url=origin, headers={"Origin": origin}) as client:
            response = client.post("/api/v1/workspace/session", json={"access_key": KEY})
            assert response.status_code == 200, response.text
            cookie = response.headers["set-cookie"].lower()
            assert all(flag in cookie for flag in ("secure", "httponly", "samesite=strict"))
            for headers in (
                {"Origin": "http://thesis.example.edu.cn"},
                {"Origin": "https://evil.example.cn"},
                {"Host": "evil.example.cn", "Origin": origin},
            ):
                rejected = client.post(
                    "/api/v1/workspace/session", json={"access_key": KEY}, headers=headers
                )
                assert rejected.status_code == 403, rejected.text
    finally:
        engine.dispose()
