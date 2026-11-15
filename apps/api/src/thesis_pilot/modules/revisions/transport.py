"""Small bounded revision DTOs; large manuscript transport stays in documents."""

import json

from pydantic import BaseModel
from starlette.responses import Response

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.revisions.schemas import MAX_REVISION_BYTES


def too_large() -> AppError:
    return AppError("REVISION_TOO_LARGE", "选区或候选超过大小限制，请缩小范围后重试。", 413)


def encoded_resource(resource: BaseModel) -> bytes:
    checked = type(resource).model_validate(resource.model_dump(by_alias=True))
    body = json.dumps(
        checked.model_dump(mode="json", by_alias=True),
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    if len(body) > MAX_REVISION_BYTES:
        raise too_large()
    return body


def revision_response(resource: BaseModel, *, status_code: int = 200) -> Response:
    return Response(
        encoded_resource(resource), status_code=status_code, media_type="application/json"
    )
