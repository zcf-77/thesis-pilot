"""Explicit real-service fixtures. Never fall back to SQLite or a default database."""

import os
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema


@dataclass(frozen=True)
class PostgreSQLSandbox:
    url: str = field(repr=False)
    sessions: sessionmaker[Session]
    alembic: Config


@pytest.fixture
def postgres() -> Iterator[PostgreSQLSandbox]:
    raw_url = os.environ.get("TP_TEST_DATABASE_URL")
    if not raw_url:
        pytest.fail("集成测试必须显式提供 TP_TEST_DATABASE_URL；不能跳过或降级。")
    try:
        url = make_url(raw_url)
    except Exception:
        pytest.fail("TP_TEST_DATABASE_URL 格式无效。", pytrace=False)
    if url.drivername != "postgresql+psycopg" or not (url.database or "").endswith("_test"):
        pytest.fail("只允许 postgresql+psycopg 且数据库名以 _test 结尾。")

    schema = f"tp_test_{uuid4().hex}"
    admin = create_engine(url, connect_args={"connect_timeout": 3}, hide_parameters=True)
    isolated_url = url.update_query_dict({"options": f"-csearch_path={schema}"})
    engine = create_engine(isolated_url, connect_args={"connect_timeout": 3}, hide_parameters=True)
    created = False
    try:
        with admin.begin() as connection:
            connection.execute(CreateSchema(schema))
        created = True
        config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            command.check(config)
        config.attributes.pop("connection", None)
        yield PostgreSQLSandbox(
            isolated_url.render_as_string(hide_password=False),
            sessionmaker(bind=engine, expire_on_commit=False, autoflush=False),
            config,
        )
    finally:
        engine.dispose()
        if created:
            # Only the exact random schema created above is ever removed.
            with admin.begin() as connection:
                connection.execute(DropSchema(schema, cascade=True))
        admin.dispose()


@pytest.fixture
def redis_test_url() -> str:
    value = os.environ.get("TP_TEST_REDIS_URL")
    if not value:
        pytest.fail("集成测试必须显式提供 TP_TEST_REDIS_URL，使用独立测试 Redis DB 15。")
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"redis", "rediss"}
        or not parsed.hostname
        or parsed.path != "/15"
        or parsed.query
        or parsed.fragment
    ):
        pytest.fail("Redis 只允许 redis(s)://.../15，禁止 query 覆盖测试数据库编号。")
    return value
