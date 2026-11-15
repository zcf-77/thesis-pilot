import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

logger = logging.getLogger("thesis_pilot")


class AppError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class ErrorDetail(BaseModel):
    code: str
    message: str
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


def error_response(request: Request, status: int, code: str, message: str) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "unavailable")
    headers = {"X-Request-ID": request_id}
    if status == 401:
        headers["WWW-Authenticate"] = "Bearer"
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "request_id": request_id}},
        headers=headers,
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_application(request: Request, exc: AppError) -> JSONResponse:
        return error_response(request, exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def handle_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Pydantic errors include the original input. Never return or log them verbatim.
        return error_response(request, 422, "VALIDATION_ERROR", "请求参数不符合接口约定")

    @app.exception_handler(HTTPException)
    async def handle_http(request: Request, exc: HTTPException) -> JSONResponse:
        return error_response(request, exc.status_code, "HTTP_ERROR", "请求资源或方法不可用")

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.error("unexpected_error type=%s", type(exc).__name__)
        return error_response(request, 500, "INTERNAL_ERROR", "服务暂时无法完成请求")


ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    code: {"model": ErrorResponse} for code in (400, 401, 404, 409, 413, 422, 500, 503)
}
