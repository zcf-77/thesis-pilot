from functools import lru_cache
from typing import Literal

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
        if self.environment == "production" and not token:
            raise ValueError("生产配置必须提供 API 令牌；账户授权仍需另行实现")
        if "*" in self.cors_origins:
            raise ValueError("CORS 必须显式列出允许的来源")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
