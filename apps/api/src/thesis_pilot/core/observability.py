import logging
import re
import time
from uuid import uuid4

from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from thesis_pilot.core.errors import error_response

logger = logging.getLogger("thesis_pilot")
REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp, *, private_api: bool = False) -> None:
        self.app = app
        self.private_api = private_api

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = dict(scope.get("headers", [])).get(b"x-request-id", b"").decode("latin1")
        request_id = incoming if REQUEST_ID.fullmatch(incoming) else uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        started = time.monotonic()
        status = 500
        response_started = False

        async def send_with_context(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status = message["status"]
                headers = [(k, v) for k, v in message.get("headers", []) if k != b"x-request-id"]
                headers.append((b"x-request-id", request_id.encode("ascii")))
                if self.private_api and scope["path"].startswith("/api/"):
                    headers = [(key, value) for key, value in headers if key != b"cache-control"]
                    headers.append((b"cache-control", b"no-store"))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_context)
        except Exception as exc:
            # Starlette's outer ServerErrorMiddleware re-raises handled exceptions;
            # intercept here so the ASGI server cannot log private exception values.
            logger.error("request_failed id=%s type=%s", request_id, type(exc).__name__)
            if response_started:
                raise RuntimeError("Response stream failed; private details suppressed") from None
            response = error_response(Request(scope), 500, "INTERNAL_ERROR", "服务暂时无法完成请求")
            await response(scope, receive, send_with_context)
        finally:
            # No URL/query/header/body/exception payload: all may contain private data.
            route = scope.get("route")
            logger.info(
                "request id=%s method=%s route=%s status=%s duration_ms=%.1f",
                request_id,
                scope["method"],
                getattr(route, "path", "unmatched"),
                status,
                (time.monotonic() - started) * 1000,
            )
