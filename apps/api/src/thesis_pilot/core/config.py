from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

DEFAULT_WORKER_EXECUTION_TIMEOUT_SECONDS = 900


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="TP_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    environment: Literal["development", "test", "production"] = "development"
    database_url: SecretStr = SecretStr(
        "postgresql+psycopg://thesis_pilot@127.0.0.1:5432/thesis_pilot"
    )
    redis_url: SecretStr = SecretStr("redis://127.0.0.1:6379/0")
    api_token: SecretStr = SecretStr("")
    deepseek_api_key: SecretStr = SecretStr("")
    # SG-22 office-server sidecar (DOCX import, original-preserving export, PDF). Empty URL
    # or token means the feature is unavailable and fails explicitly; it never degrades.
    office_url: str = ""
    office_token: SecretStr = SecretStr("")
    office_timeout_seconds: int = Field(default=90, ge=1, le=600)
    # Node.js for the vendored office-wasm runner (DocsModel → DOCX).
    office_node_binary: str = "node"
    auth_mode: Literal["bearer", "workspace"] = "bearer"
    workspace_origin: str = "http://127.0.0.1:8017"
    workspace_access_key: SecretStr = SecretStr("")
    workspace_session_seconds: int = Field(default=43200, ge=1, le=86400)
    workspace_web_root: Path | None = None
    cors_origins: list[str] = Field(default_factory=lambda: ["http://127.0.0.1:18744"])
    worker_lease_seconds: int = Field(default=60, ge=10, le=3600)
    worker_execution_timeout_seconds: int = Field(
        default=DEFAULT_WORKER_EXECUTION_TIMEOUT_SECONDS, ge=1, le=3600
    )

    @model_validator(mode="after")
    def validate_boundaries(self) -> "Settings":
        try:
            driver = make_url(self.database_url.get_secret_value()).drivername
        except Exception:
            raise ValueError("数据库连接格式无效") from None
        if driver != "postgresql+psycopg" and not (
            self.environment == "test" and driver == "sqlite"
        ):
            raise ValueError("运行环境必须使用 PostgreSQL/psycopg；SQLite 仅供隔离测试")
        if not self.redis_url.get_secret_value().startswith(("redis://", "rediss://")):
            raise ValueError("Redis 连接格式无效")
        token = self.api_token.get_secret_value()
        if token and len(token) < 32:
            raise ValueError("API 令牌至少需要 32 个字符")
        if self.auth_mode == "workspace":
            self.validate_workspace(token)
        elif self.environment == "production" and not token:
            raise ValueError("Bearer 模式必须提供 API 令牌")
        if "*" in self.cors_origins:
            raise ValueError("CORS 必须显式列出允许的来源")
        return self

    def validate_workspace(self, token: str) -> None:
        key = self.workspace_access_key.get_secret_value()
        if not 32 <= len(key) <= 256 or not key.isascii() or not key.isprintable() or key == token:
            raise ValueError("正式工作区需要独立的本机访问密钥（32—256 个可打印 ASCII 字符）")
        try:
            origin = urlsplit(self.workspace_origin)
            port = origin.port
        except ValueError:
            raise ValueError("正式工作区地址无效") from None
        if (
            origin.scheme not in {"http", "https"}
            or origin.hostname not in {"127.0.0.1", "::1", "localhost"}
            or origin.username is not None
            or origin.password is not None
            or origin.path
            or self.workspace_origin != f"{origin.scheme}://{origin.netloc.lower()}"
            or port in {0, 80 if origin.scheme == "http" else 443}
            or origin.netloc.endswith(":")
        ):
            raise ValueError("正式工作区地址必须是规范的本机 HTTP(S) 来源")


@lru_cache
def get_settings() -> Settings:
    return Settings()
