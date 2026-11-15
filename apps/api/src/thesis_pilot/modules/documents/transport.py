"""Encode validated document DTOs without Pydantic's generic JSON depth limit."""

import json
from datetime import UTC, datetime
from uuid import UUID

from starlette.responses import Response

from thesis_pilot.modules.documents.schemas import (
    DocumentRead,
    DocumentVersionPage,
    DocumentVersionRead,
)
from thesis_pilot.modules.documents.structure import MAX_TRANSPORT_BYTES, too_large


def scalar_json(value: object) -> str:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    raise TypeError("Unsupported document response value")


def document_response(
    resource: DocumentRead | DocumentVersionRead | DocumentVersionPage, *, status_code: int = 200
) -> Response:
    data = resource.model_dump(mode="python", by_alias=True)
    # Service results are validated DTOs. Revalidate before this custom encoder too,
    # so neither model_construct nor a mutated object can bypass the public contract.
    checked = type(resource).model_validate(data)
    body = json.dumps(
        checked.model_dump(mode="python", by_alias=True),
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
        default=scalar_json,
    ).encode("utf-8")
    if len(body) > MAX_TRANSPORT_BYTES:
        raise too_large()
    return Response(content=body, status_code=status_code, media_type="application/json")
