"""Transaction-local source validation; no source/document service imports."""

from copy import deepcopy
from dataclasses import dataclass
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources.contracts import (
    GUARD_VERSION,
    base_contract,
    guard_invalid,
    manifest_sha256,
    validate_guard_contract,
)
from thesis_pilot.modules.document_sources.model_guard import (
    MODEL_GUARD_VERSION,
    is_model_guard,
    validate_model_guard,
)
from thesis_pilot.modules.document_sources.models import DocumentSource, DocumentSourceVersion
from thesis_pilot.modules.documents.schemas import DocumentContent, DocumentContentV2
from thesis_pilot.modules.documents.structure import JsonObject
from thesis_pilot.modules.materials.models import MaterialParseVersion
from thesis_pilot.parsers.schemas import ParsedMaterial

_AUTHORIZATION = object()


@dataclass(frozen=True)
class GuardTransition:
    document_id: UUID
    expected_version: int
    contract: JsonObject
    authorization: object


def transition_for_contract(
    session: Session, document_id: UUID, expected_version: int, contract: JsonObject
) -> GuardTransition:
    """Internal only: callers supply a locked, server-built candidate/history fact."""
    current = session.get(DocumentSourceVersion, (document_id, expected_version))
    if current is None:
        raise guard_invalid()
    if is_model_guard(current.guard_contract) or is_model_guard(contract):
        if is_model_guard(current.guard_contract) != is_model_guard(contract):
            # A v2 manuscript cannot take a pre-upgrade (v1) source guard, or vice versa.
            raise cross_schema_revert()
        if current.guard_contract.get("initial_contract_sha256") != contract.get(
            "initial_contract_sha256"
        ):
            raise guard_invalid()
    elif base_contract(current.guard_contract) != base_contract(contract):
        raise guard_invalid()
    return GuardTransition(document_id, expected_version, deepcopy(contract), _AUTHORIZATION)


def cross_schema_revert() -> AppError:
    return AppError(
        "DOCUPGRADE_REVERT_UNSUPPORTED",
        "原件导入的正文已升级为新版结构，不能回退到升级前的版本；请从当前版本继续编辑。",
        409,
    )


def transition_for_upgrade(
    session: Session, document_id: UUID, expected_version: int, contract: JsonObject
) -> GuardTransition:
    """Internal only: the schema upgrade command's server-built v2 guard."""
    if not is_model_guard(contract):
        raise guard_invalid()
    current = session.get(DocumentSourceVersion, (document_id, expected_version))
    if current is None or is_model_guard(current.guard_contract):
        raise guard_invalid()
    return GuardTransition(document_id, expected_version, deepcopy(contract), _AUTHORIZATION)


def transition_for_history(
    session: Session, document_id: UUID, expected_version: int, target_version: int
) -> GuardTransition | None:
    source = session.scalar(select(DocumentSource).where(DocumentSource.document_id == document_id))
    if source is None:
        return None
    target = session.get(DocumentSourceVersion, (document_id, target_version))
    if target is None or target.source_id != source.id:
        raise guard_invalid()
    return transition_for_contract(session, document_id, expected_version, target.guard_contract)


def guards_equal(session: Session, document_id: UUID, left: int, right: int) -> bool:
    a = session.get(DocumentSourceVersion, (document_id, left))
    b = session.get(DocumentSourceVersion, (document_id, right))
    return (a is None and b is None) or (
        a is not None and b is not None and a.guard_contract == b.guard_contract
    )


def validate_append(
    session: Session,
    document_id: UUID,
    expected_version: int,
    content: DocumentContent | DocumentContentV2,
    transition: GuardTransition | None = None,
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
        or context.guard_version != context.guard_contract.get("guard_version")
        or initial.guard_version != GUARD_VERSION
    ):
        raise guard_invalid()
    model_lineage = context.guard_version == MODEL_GUARD_VERSION
    if not model_lineage and base_contract(context.guard_contract) != initial.guard_contract:
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
    if model_lineage:
        return _validate_model_append(
            context, initial, document_id, expected_version, content, transition
        )
    contract = context.guard_contract
    if transition is not None and is_model_guard(transition.contract):
        # The schema upgrade: provenance checked above, the v2 guard binds the result.
        _authorized(transition, document_id, expected_version)
        if not isinstance(content, DocumentContentV2):
            raise guard_invalid()
        validate_model_guard(transition.contract, content.json_content, initial.guard_contract)
        return _next_mapping(context, transition.contract)
    if transition is not None:
        _authorized(transition, document_id, expected_version)
        if base_contract(transition.contract) != initial.guard_contract:
            raise guard_invalid()
        contract = transition.contract
    if not isinstance(content, DocumentContent):
        raise guard_invalid()
    validate_guard_contract(parsed, contract, content.json_content)
    if transition is not None:
        return DocumentSourceVersion(
            document_id=context.document_id,
            document_version=context.document_version,
            source_id=context.source_id,
            guard_version=contract["guard_version"],
            guard_contract=deepcopy(contract),
        )
    return context


def _authorized(transition: GuardTransition, document_id: UUID, expected_version: int) -> None:
    if (
        transition.authorization is not _AUTHORIZATION
        or transition.document_id != document_id
        or transition.expected_version != expected_version
    ):
        raise guard_invalid()


def _next_mapping(context: DocumentSourceVersion, contract: JsonObject) -> DocumentSourceVersion:
    return DocumentSourceVersion(
        document_id=context.document_id,
        document_version=context.document_version,
        source_id=context.source_id,
        guard_version=contract["guard_version"],
        guard_contract=deepcopy(contract),
    )


def _validate_model_append(
    context: DocumentSourceVersion,
    initial: DocumentSourceVersion,
    document_id: UUID,
    expected_version: int,
    content: DocumentContent | DocumentContentV2,
    transition: GuardTransition | None,
) -> DocumentSourceVersion:
    """v2 manuscript of an imported original: only mapped run text may change."""
    if not isinstance(content, DocumentContentV2):
        raise guard_invalid()
    contract = context.guard_contract
    if transition is not None:
        _authorized(transition, document_id, expected_version)
        if not is_model_guard(transition.contract) or transition.contract.get(
            "initial_contract_sha256"
        ) != contract.get("initial_contract_sha256"):
            raise guard_invalid()
        contract = transition.contract
    validate_model_guard(contract, content.json_content, initial.guard_contract)
    return context if transition is None else _next_mapping(context, contract)


def record_source_version(
    session: Session, context: DocumentSourceVersion | None, new_version: int
) -> None:
    """Append the same immutable contract with the manuscript in one transaction."""
    if not session.in_transaction():
        raise RuntimeError("Source mapping requires the caller's transaction")
    if context is None:
        return
    if (
        new_version != context.document_version + 1
        or context.guard_version != context.guard_contract.get("guard_version")
    ):
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
