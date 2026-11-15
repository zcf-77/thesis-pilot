"""Transaction-local source validation; no source/document service imports."""

from copy import deepcopy
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from thesis_pilot.modules.document_sources.contracts import (
    GUARD_VERSION,
    guard_invalid,
    manifest_sha256,
    validate_guard_contract,
)
from thesis_pilot.modules.document_sources.models import DocumentSource, DocumentSourceVersion
from thesis_pilot.modules.documents.schemas import DocumentContent
from thesis_pilot.modules.materials.models import MaterialParseVersion
from thesis_pilot.parsers.schemas import ParsedMaterial


def validate_append(
    session: Session, document_id: UUID, expected_version: int, content: DocumentContent
) -> DocumentSourceVersion | None:
    """The document CAS already holds the row; read its explicit base mapping."""
    if not session.in_transaction():
        raise RuntimeError("Source validation requires the caller's transaction")
    source = session.scalar(select(DocumentSource).where(DocumentSource.document_id == document_id))
    if source is None:
        return None
    context = session.get(DocumentSourceVersion, (document_id, expected_version))
    initial = session.get(DocumentSourceVersion, (document_id, 1))
    if (
        context is None
        or initial is None
        or context.source_id != source.id
        or initial.source_id != source.id
        or context.guard_version != GUARD_VERSION
        or initial.guard_version != GUARD_VERSION
        or context.guard_contract != initial.guard_contract
    ):
        raise guard_invalid()
    parse = session.get(MaterialParseVersion, source.parse_version_id)
    if parse is None or parse.original_id != source.original_version_id:
        raise guard_invalid()
    try:
        parsed = ParsedMaterial.model_validate(parse.content)
    except ValidationError as error:
        raise guard_invalid() from error
    manifest = parsed.roundtrip_manifest
    if (
        manifest is None
        or manifest_sha256(manifest) != source.manifest_sha256
        or manifest.get("source_sha256") != source.original_sha256
        or manifest.get("original_version_id") != str(source.original_version_id)
    ):
        raise guard_invalid()
    validate_guard_contract(parsed, context.guard_contract, content.json_content)
    return context


def record_source_version(
    session: Session, context: DocumentSourceVersion | None, new_version: int
) -> None:
    """Append the same immutable contract with the manuscript in one transaction."""
    if not session.in_transaction():
        raise RuntimeError("Source mapping requires the caller's transaction")
    if context is None:
        return
    if new_version != context.document_version + 1 or context.guard_version != GUARD_VERSION:
        raise guard_invalid()
    session.add(
        DocumentSourceVersion(
            document_id=context.document_id,
            document_version=new_version,
            source_id=context.source_id,
            guard_version=context.guard_version,
            guard_contract=deepcopy(context.guard_contract),
        )
    )
    session.flush()
