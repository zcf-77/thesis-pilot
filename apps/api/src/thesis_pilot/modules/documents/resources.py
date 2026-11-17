"""Content-addressed manuscript images (project-scoped, immutable, deduplicated)."""

from __future__ import annotations

import base64
import binascii
import struct
from datetime import UTC, datetime
from hashlib import sha256
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.docs_model import resource_uri
from thesis_pilot.modules.documents.models import DocumentResource
from thesis_pilot.modules.documents.schemas import DocumentResourceRead, DocumentResourceUpload
from thesis_pilot.modules.documents.service import require_project

MAX_RESOURCE_BYTES = 10 * 1024 * 1024


def resource_invalid() -> AppError:
    return AppError(
        "DOCMODEL_RESOURCE_INVALID", "图片格式与声明不符或已损坏，仅支持 PNG/JPEG/GIF/WebP。", 422
    )


def resource_not_found() -> AppError:
    return AppError("DOCMODEL_RESOURCE_NOT_FOUND", "当前项目中没有该图片资源。", 404)


def _png(data: bytes) -> tuple[int, int] | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR" and len(data) >= 24:
        width, height = struct.unpack(">II", data[16:24])
        return int(width), int(height)
    return None


def _gif(data: bytes) -> tuple[int, int] | None:
    if data[:6] in {b"GIF87a", b"GIF89a"} and len(data) >= 10:
        width, height = struct.unpack("<HH", data[6:10])
        return int(width), int(height)
    return None


def _jpeg(data: bytes) -> tuple[int, int] | None:
    if data[:3] != b"\xff\xd8\xff":
        return None
    index = 2
    while index + 9 < len(data):
        if data[index] != 0xFF:
            return None
        marker = data[index + 1]
        if marker in {0xD8, 0x01} or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        length = struct.unpack(">H", data[index + 2 : index + 4])[0]
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE}:
            height, width = struct.unpack(">HH", data[index + 5 : index + 9])
            return int(width), int(height)
        index += 2 + length
    return None


def _webp(data: bytes) -> tuple[int, int] | None:
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP" or len(data) < 30:
        return None
    chunk = data[12:16]
    if chunk == b"VP8X":
        width = int.from_bytes(data[24:27], "little") + 1
        height = int.from_bytes(data[27:30], "little") + 1
        return width, height
    if chunk == b"VP8 " and data[23:26] == b"\x9d\x01\x2a":
        width, height = struct.unpack("<HH", data[26:30])
        return int(width) & 0x3FFF, int(height) & 0x3FFF
    if chunk == b"VP8L" and data[20] == 0x2F:
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    return None


SNIFFERS = {"image/png": _png, "image/gif": _gif, "image/jpeg": _jpeg, "image/webp": _webp}


def read_of(row: DocumentResource) -> DocumentResourceRead:
    return DocumentResourceRead.model_validate(
        {
            "sha256": row.sha256,
            "uri": resource_uri(row.sha256),
            "mime": row.mime,
            "byte_size": row.byte_size,
            "width_px": row.width_px,
            "height_px": row.height_px,
            "created_at": row.created_at,
        }
    )


def upload_resource(
    session: Session, project_id: UUID, data: DocumentResourceUpload
) -> tuple[DocumentResourceRead, bool]:
    """Returns (resource, created). The same bytes in the same project dedupe."""
    try:
        content = base64.b64decode(data.content_base64, validate=True)
    except (binascii.Error, ValueError):
        raise resource_invalid() from None
    if not content:
        raise resource_invalid()
    if len(content) > MAX_RESOURCE_BYTES:
        raise AppError("DOCMODEL_RESOURCE_TOO_LARGE", "单张图片不能超过 10MiB。", 413)
    size = SNIFFERS[data.mime](content)
    if size is None or not all(0 < value <= 100000 for value in size):
        raise resource_invalid()
    digest = sha256(content).hexdigest()
    try:
        with session.begin():
            require_project(session, project_id)
            existing = session.scalar(
                select(DocumentResource).where(
                    DocumentResource.project_id == project_id, DocumentResource.sha256 == digest
                )
            )
            if existing is not None:
                if existing.mime != data.mime:
                    raise resource_invalid()
                return read_of(existing), False
            row = DocumentResource(
                id=uuid4(),
                project_id=project_id,
                sha256=digest,
                mime=data.mime,
                byte_size=len(content),
                width_px=size[0],
                height_px=size[1],
                content=content,
                created_at=datetime.now(UTC),
            )
            session.add(row)
            session.flush()
            return read_of(row), True
    except IntegrityError:
        # A concurrent identical upload won the unique (project, sha256) race.
        with session.begin():
            existing = session.scalar(
                select(DocumentResource).where(
                    DocumentResource.project_id == project_id, DocumentResource.sha256 == digest
                )
            )
            if existing is None or existing.mime != data.mime:
                raise resource_invalid() from None
            return read_of(existing), False


def get_resource(session: Session, project_id: UUID, digest: str) -> tuple[DocumentResource, bytes]:
    with session.begin():
        require_project(session, project_id)
        row = session.scalar(
            select(DocumentResource).where(
                DocumentResource.project_id == project_id, DocumentResource.sha256 == digest
            )
        )
        if row is None:
            raise resource_not_found()
        return row, bytes(row.content)
