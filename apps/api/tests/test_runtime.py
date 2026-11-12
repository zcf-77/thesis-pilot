import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from thesis_pilot.core.config import Settings
from thesis_pilot.main import create_app


def test_live_requires_no_database_or_queue() -> None:
    app = create_app(Settings(_env_file=None, environment="test", database_url="sqlite://"))
    with TestClient(app) as client:
        response = client.get("/health/live")
        assert response.status_code == 200
        assert response.json() == {"status": "alive"}


def test_unmigrated_database_is_not_ready(client: TestClient) -> None:
    response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "NOT_READY"
    assert "sqlite" not in response.text


def test_no_token_configuration_fails_closed() -> None:
    settings = Settings(_env_file=None, environment="test", database_url="sqlite://")
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/projects")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "AUTH_NOT_CONFIGURED"


def test_wrong_token_rejected_before_database(client: TestClient) -> None:
    response = client.get("/api/v1/projects", headers={"Authorization": "Bearer wrong"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_non_ascii_token_is_rejected_as_authentication_failure(client: TestClient) -> None:
    response = client.get("/api/v1/projects", headers={"Authorization": b"Bearer \xc3\xa9"})
    assert response.status_code == 401


def test_validation_does_not_echo_private_input(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="thesis_pilot")
    response = client.post("/api/v1/projects", json={"private": "PRIVATE-PAPER-SECRET"})
    assert response.status_code == 422
    assert "PRIVATE-PAPER-SECRET" not in response.text + caplog.text
    assert response.json()["error"]["request_id"] == response.headers["x-request-id"]


def test_safe_request_id_and_unmatched_path_logging(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="thesis_pilot")
    response = client.get("/PRIVATE-PAPER-SECRET?token=SECRET", headers={"X-Request-ID": "../bad"})
    assert response.status_code == 404
    assert response.headers["x-request-id"] != "../bad"
    assert "PRIVATE-PAPER-SECRET" not in caplog.text
    assert "token=SECRET" not in caplog.text
    assert (
        client.get("/health/live", headers={"X-Request-ID": "trace_123"}).headers["x-request-id"]
        == "trace_123"
    )


def test_unexpected_error_is_sanitized(app: FastAPI, caplog: pytest.LogCaptureFixture) -> None:
    @app.get("/test-failure", include_in_schema=False)
    def fail() -> None:
        raise RuntimeError("PASSWORD-PRIVATE-DOCUMENT")

    # Default raise_server_exceptions=True also proves private exceptions do not
    # escape to Uvicorn after a sanitized response has been produced.
    with TestClient(app) as client:
        response = client.get("/test-failure")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "PASSWORD-PRIVATE-DOCUMENT" not in response.text + caplog.text
    assert response.headers["x-request-id"] == response.json()["error"]["request_id"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"database_url": "sqlite:///runtime.db"},
        {"api_token": "short"},
        {"cors_origins": ["*"]},
        {"environment": "production", "api_token": ""},
        {"worker_lease_seconds": 0},
    ],
)
def test_invalid_configuration_is_rejected(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **overrides)


def test_configuration_failure_does_not_print_secrets() -> None:
    with pytest.raises(ValidationError) as captured:
        Settings(
            _env_file=None,
            database_url="postgresql+psycopg://name:PRIVATE-PASSWORD@localhost/test",
            api_token="PRIVATE-TOKEN",
        )
    assert "PRIVATE-PASSWORD" not in str(captured.value)
    assert "PRIVATE-TOKEN" not in str(captured.value)


def test_openapi_has_authenticated_business_routes(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    assert schema["paths"]["/api/v1/projects"]["post"]["security"] == [{"HTTPBearer": []}]
    error = schema["paths"]["/api/v1/projects"]["post"]["responses"]["422"]
    assert error["content"]["application/json"]["schema"]["$ref"].endswith("ErrorResponse")
