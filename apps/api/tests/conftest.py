from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.config import Settings
from thesis_pilot.db.base import Base
from thesis_pilot.db.models import register_models
from thesis_pilot.main import create_app

TEST_TOKEN = "test-only-token-with-at-least-32-characters"


@pytest.fixture(autouse=True)
def isolate_runtime_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    # Keep explicit TP_TEST_* service URLs; ordinary developer settings must not
    # make tests depend on a developer's private .env or inherited token.
    for name in (
        "TP_ENVIRONMENT",
        "TP_DATABASE_URL",
        "TP_REDIS_URL",
        "TP_API_TOKEN",
        "TP_CORS_ORIGINS",
        "TP_WORKER_LEASE_SECONDS",
        "TP_WORKER_EXECUTION_TIMEOUT_SECONDS",
        "TP_OPENALEX_API_KEY",
        "TP_OFFICE_URL",
        "TP_OFFICE_TOKEN",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def app(tmp_path: Path) -> Iterator[FastAPI]:
    settings = Settings(
        _env_file=None,
        environment="test",
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        api_token=TEST_TOKEN,
    )
    application = create_app(settings)
    engine = application.state.session_factory.kw["bind"]
    assert isinstance(engine, Engine)

    @event.listens_for(engine, "connect")
    def enforce_foreign_keys(connection: object, record: object) -> None:
        connection.execute("PRAGMA foreign_keys=ON")  # type: ignore[attr-defined]

    register_models()
    # create_all is only allowed in isolated SQLite tests. Runtime uses Alembic.
    Base.metadata.create_all(engine)
    yield application
    engine.dispose()


@pytest.fixture
def session_factory(app: FastAPI) -> sessionmaker[Session]:
    return app.state.session_factory  # type: ignore[no-any-return]


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app, headers={"Authorization": f"Bearer {TEST_TOKEN}"}) as test_client:
        yield test_client
