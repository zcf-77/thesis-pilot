"""Atomic append-only manuscript commands and project-scoped reads."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from hashlib import sha256
from sqlite3 import IntegrityError as SQLiteIntegrityError
from typing import TYPE_CHECKING, cast
from uuid import UUID, uuid4

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.docs_model import (
    JsonDict,
    model_of,
    protection_rule_check,
    resource_hashes,
)
from thesis_pilot.modules.documents.legacy_v1 import Conversion, check_invariants, convert_v1
from thesis_pilot.modules.documents.models import (
    Document,
    DocumentSchemaUpgrade,
    DocumentVersion,
)
from thesis_pilot.modules.documents.schemas import (
    DocumentContent,
    DocumentContentV2,
    DocumentImport,
    DocumentRead,
    DocumentSave,
    DocumentSchemaUpgradeCreate,
    DocumentSchemaUpgradeRead,
    DocumentSchemaUpgradeRecord,
    DocumentSource,
    DocumentVersionPage,
    DocumentVersionRead,
    DocumentVersionSummary,
)
from thesis_pilot.modules.documents.structure import MAX_SAFE_INTEGER
from thesis_pilot.modules.projects.models import Project

if TYPE_CHECKING:
    from thesis_pilot.modules.document_sources.guards import GuardTransition

type AnyContent = DocumentContent | DocumentContentV2
# Sources whose content is newly authored against the base and must keep its protections.
AUTHORED_SOURCES = frozenset({"manual_edit", "ai_adoption", "local_import"})


def require_project(session: Session, project_id: UUID) -> None:
    if session.scalar(select(Project.id).where(Project.id == project_id)) is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)


def document_missing() -> AppError:
    return AppError("DOCUMENT_NOT_FOUND", "当前项目中没有该正文。", 404)


def version_conflict() -> AppError:
    return AppError("DOCUMENT_VERSION_CONFLICT", "正文版本已变化，请保留草稿并重新读取。", 409)


def needs_upgrade() -> AppError:
    return AppError(
        "DOCMODEL_SCHEMA_MISMATCH", "正文仍是旧版结构，请先升级正文结构再按新版保存。", 409
    )


def already_upgraded() -> AppError:
    return AppError(
        "DOCMODEL_SCHEMA_MISMATCH", "正文已升级为新版结构，请保留草稿并重新读取后再保存。", 409
    )


def resource_missing() -> AppError:
    return AppError("DOCMODEL_RESOURCE_MISSING", "正文引用的图片资源不存在，请重新上传。", 422)


def content_of(version: DocumentVersion) -> AnyContent:
    if version.schema_version == 2:
        return DocumentContentV2.model_validate({"schema_version": 2, "json": version.content_json})
    return DocumentContent.model_validate(
        {"schema_version": version.schema_version, "json": version.content_json}
    )


def document_read(document: Document, version: DocumentVersion) -> DocumentRead:
    return DocumentRead(
        id=document.id,
        project_id=document.project_id,
        version=version.version,
        content=content_of(version),
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


def version_summary(document: Document, version: DocumentVersion) -> DocumentVersionSummary:
    return DocumentVersionSummary.model_validate(
        {
            "document_id": document.id,
            "project_id": document.project_id,
            "version": version.version,
            "source": version.source,
            "created_at": version.created_at,
        }
    )


def checked_content(content: AnyContent) -> AnyContent:
    # Revalidate at the command boundary, including mutated or constructed model instances.
    return type(content).model_validate(content.model_dump(by_alias=True))


def require_resources(session: Session, project_id: UUID, content: AnyContent) -> None:
    if not isinstance(content, DocumentContentV2):
        return
    from thesis_pilot.modules.documents.models import DocumentResource

    wanted = resource_hashes(model_of(content.json_content))
    if not wanted:
        return
    found = set(
        session.scalars(
            select(DocumentResource.sha256).where(
                DocumentResource.project_id == project_id, DocumentResource.sha256.in_(wanted)
            )
        )
    )
    if found != wanted:
        raise resource_missing()


def import_document(session: Session, project_id: UUID, data: DocumentImport) -> DocumentRead:
    return create_document(session, project_id, checked_content(data.content), "local_import")


def create_blank_document(session: Session, project_id: UUID) -> DocumentRead:
    content = DocumentContent.model_validate(
        {"schema_version": 1, "json": {"type": "doc", "content": [{"type": "paragraph"}]}}
    )
    return create_document(session, project_id, content, "blank")


def create_document(
    session: Session, project_id: UUID, content: AnyContent, source: DocumentSource
) -> DocumentRead:
    try:
        with session.begin():
            result = create_document_in_transaction(session, project_id, content, source)
        return result
    except IntegrityError as error:
        diagnostic = getattr(error.orig, "diag", None)
        duplicate = getattr(diagnostic, "constraint_name", None) == "uq_documents_project_id"
        sqlite_duplicate = isinstance(error.orig, SQLiteIntegrityError) and str(error.orig) == (
            "UNIQUE constraint failed: documents.project_id"
        )
        if duplicate or sqlite_duplicate:
            raise AppError(
                "DOCUMENT_ALREADY_EXISTS", "项目已有正式正文，请读取后继续。", 409
            ) from None
        raise


def create_document_in_transaction(
    session: Session, project_id: UUID, content: AnyContent, source: DocumentSource
) -> DocumentRead:
    """Caller atomically owns initial content and any accompanying source mappings."""
    if not session.in_transaction():
        raise RuntimeError("Document creation requires an explicit outer transaction")
    require_project(session, project_id)
    content = checked_content(content)
    if isinstance(content, DocumentContentV2):
        # A new manuscript has no base: only user-owned protections may be supplied.
        protection_rule_check(None, content.json_content, user_edit=True)
        require_resources(session, project_id, content)
    now = datetime.now(UTC)
    document = Document(
        id=uuid4(), project_id=project_id, current_version=1, created_at=now, updated_at=now
    )
    session.add(document)
    session.flush()
    version = DocumentVersion(
        document_id=document.id,
        version=1,
        schema_version=content.schema_version,
        content_json=content.json_content,
        source=source,
        created_at=now,
    )
    session.add(version)
    session.flush()
    return document_read(document, version)


def get_current_document(session: Session, project_id: UUID) -> DocumentRead:
    with session.begin():
        require_project(session, project_id)
        pair = session.execute(
            select(Document, DocumentVersion)
            .join(
                DocumentVersion,
                (DocumentVersion.document_id == Document.id)
                & (DocumentVersion.version == Document.current_version),
            )
            .where(Document.project_id == project_id)
        ).one_or_none()
        if pair is None:
            raise document_missing()
        document, version = pair
        return document_read(document, version)


def save_document(
    session: Session, project_id: UUID, document_id: UUID, data: DocumentSave
) -> DocumentRead:
    content = checked_content(data.content)
    with session.begin():
        require_project(session, project_id)
        return append_document_version(
            session, project_id, document_id, data.expected_version, content, "manual_edit"
        )


def append_document_version(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    expected_version: int,
    content: AnyContent,
    source: DocumentSource,
) -> DocumentRead:
    return _append_document_version(
        session, project_id, document_id, expected_version, content, source
    )


def append_guarded_document_version(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    expected_version: int,
    content: AnyContent,
    source: DocumentSource,
    transition: GuardTransition | None,
) -> DocumentRead:
    """Internal command boundary; never exposed by ordinary save requests."""
    return _append_document_version(
        session, project_id, document_id, expected_version, content, source, transition
    )


def append_managed_document_version(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    expected_version: int,
    content: DocumentContentV2,
    managed: Callable[[JsonDict], bool],
) -> DocumentRead:
    """Server-built adoption whose ``managed`` protections the caller already verified.

    Every other protection keeps the ordinary ``ai_adoption`` rule (survive unchanged,
    none forged). Never reachable from ordinary save requests.
    """
    return _append_document_version(
        session,
        project_id,
        document_id,
        expected_version,
        content,
        "ai_adoption",
        managed=managed,
    )


def _reconcile_schema(
    session: Session,
    document_id: UUID,
    base: DocumentVersion,
    content: AnyContent,
    source: DocumentSource,
    new_version: int,
    managed: Callable[[JsonDict], bool] | None = None,
) -> AnyContent:
    """Schema rules between the base version and the appended content (row lock held)."""
    if base.schema_version == 1 and isinstance(content, DocumentContentV2):
        if source != "schema_upgrade":
            raise needs_upgrade()
        return content
    if base.schema_version == 2 and isinstance(content, DocumentContent):
        if source != "version_revert":
            raise already_upgraded()
        from thesis_pilot.modules.document_sources.guards import cross_schema_revert
        from thesis_pilot.modules.document_sources.models import DocumentSource as SourceRow

        if session.scalar(select(SourceRow.id).where(SourceRow.document_id == document_id)):
            raise cross_schema_revert()
        # Reverting a v2 manuscript to a v1 target appends the converted target as v2.
        conversion = convert_v1(content.json_content, document_id=document_id, version=new_version)
        return DocumentContentV2.model_validate({"schema_version": 2, "json": conversion.snapshot})
    if (
        isinstance(content, DocumentContentV2)
        and base.schema_version == 2
        and source in AUTHORED_SOURCES
    ):
        protection_rule_check(
            base.content_json,
            content.json_content,
            user_edit=source == "manual_edit",
            managed=managed,
        )
    return content


def _append_document_version(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    expected_version: int,
    content: AnyContent,
    source: DocumentSource,
    transition: GuardTransition | None = None,
    *,
    managed: Callable[[JsonDict], bool] | None = None,
) -> DocumentRead:
    """CAS + immutable version, owned by the caller's existing command transaction."""
    if not session.in_transaction():
        raise RuntimeError("Document append requires an explicit outer transaction")
    content = checked_content(content)
    document = session.scalars(
        update(Document)
        .where(
            Document.id == document_id,
            Document.project_id == project_id,
            Document.current_version == expected_version,
            Document.current_version < MAX_SAFE_INTEGER,
        )
        .values(current_version=Document.current_version + 1, updated_at=datetime.now(UTC))
        .returning(Document)
        .execution_options(synchronize_session=False, populate_existing=True)
    ).one_or_none()
    if document is None:
        existing = session.scalar(
            select(Document.id).where(Document.id == document_id, Document.project_id == project_id)
        )
        if existing is None:
            raise document_missing()
        raise version_conflict()
    base = session.get(DocumentVersion, (document_id, expected_version))
    if base is None:
        raise version_conflict()
    content = _reconcile_schema(
        session, document_id, base, content, source, document.current_version, managed
    )
    require_resources(session, project_id, content)
    # The successful CAS holds the Document row lock. Source checks and their
    # next-version mapping share this command's transaction with every write path.
    from thesis_pilot.modules.document_sources.guards import (
        record_source_version,
        validate_append,
    )

    source_context = validate_append(session, document_id, expected_version, content, transition)
    version = DocumentVersion(
        document_id=document.id,
        version=document.current_version,
        schema_version=content.schema_version,
        content_json=content.json_content,
        source=source,
        created_at=document.updated_at,
    )
    session.add(version)
    session.flush()
    record_source_version(session, source_context, version.version)
    return document_read(document, version)


def require_document(session: Session, project_id: UUID, document_id: UUID) -> Document:
    require_project(session, project_id)
    document = session.scalar(
        select(Document).where(Document.id == document_id, Document.project_id == project_id)
    )
    if document is None:
        raise document_missing()
    return document


def list_versions(
    session: Session, project_id: UUID, document_id: UUID, *, limit: int, offset: int
) -> DocumentVersionPage:
    with session.begin():
        document = require_document(session, project_id, document_id)
        total = (
            session.scalar(
                select(func.count())
                .select_from(DocumentVersion)
                .where(DocumentVersion.document_id == document_id)
            )
            or 0
        )
        # Avoid reading all manuscript blobs for a metadata-only history page.
        rows = session.execute(
            select(
                DocumentVersion.version,
                DocumentVersion.source,
                DocumentVersion.created_at,
            )
            .where(DocumentVersion.document_id == document_id)
            .order_by(DocumentVersion.version.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        items = [
            DocumentVersionSummary.model_validate(
                {
                    "document_id": document.id,
                    "project_id": document.project_id,
                    "version": row.version,
                    "source": row.source,
                    "created_at": row.created_at,
                }
            )
            for row in rows
        ]
        return DocumentVersionPage(items=items, total=total, limit=limit, offset=offset)


def get_version(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    version_number: int,
    *,
    as_v2: bool = False,
) -> DocumentVersionRead:
    with session.begin():
        document = require_document(session, project_id, document_id)
        version = session.get(DocumentVersion, (document_id, version_number))
        if version is None:
            raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正文版本不存在。", 404)
        content = content_of(version)
        converted = False
        if as_v2 and isinstance(content, DocumentContent):
            # Read-only, in memory: nothing is stored and the stored version is unchanged.
            conversion = convert_v1(
                content.json_content, document_id=document_id, version=version_number
            )
            content = DocumentContentV2.model_validate(
                {"schema_version": 2, "json": conversion.snapshot}
            )
            converted = True
        return DocumentVersionRead.model_validate(
            {
                **version_summary(document, version).model_dump(),
                "content": content,
                "converted": converted,
            }
        )


# ---------- explicit v1 → v2 upgrade ----------


def upgrade_failed() -> AppError:
    return AppError("DOCUPGRADE_INVARIANT_FAILED", "结构转换自检未通过，正文保持不变。", 422)


def upgrade_request_hash(document_id: UUID, expected_version: int) -> str:
    return sha256(f"{document_id}:{expected_version}".encode()).hexdigest()


def upgrade_record(row: DocumentSchemaUpgrade) -> DocumentSchemaUpgradeRecord:
    return DocumentSchemaUpgradeRecord.model_validate(
        {
            "id": row.id,
            "document_id": row.document_id,
            "command_id": row.command_id,
            "from_version": row.from_version,
            "to_version": row.to_version,
            "from_schema_version": row.from_schema_version,
            "to_schema_version": row.to_schema_version,
            "converter_version": row.converter_version,
            "converter_sha256": row.converter_sha256,
            "loss_report": row.loss_report,
            "created_at": row.created_at,
        }
    )


def _replay(
    session: Session, project_id: UUID, document_id: UUID, data: DocumentSchemaUpgradeCreate
) -> DocumentSchemaUpgradeRead | None:
    row = session.scalar(
        select(DocumentSchemaUpgrade).where(DocumentSchemaUpgrade.command_id == data.command_id)
    )
    if row is None:
        return None
    if row.document_id != document_id or row.request_hash != upgrade_request_hash(
        document_id, data.expected_version
    ):
        raise AppError(
            "DOCUPGRADE_COMMAND_REUSED", "该升级命令标识已用于其他请求，正文保持不变。", 409
        )
    document = require_document(session, project_id, document_id)
    version = session.get(DocumentVersion, (document_id, row.to_version))
    if version is None:
        raise upgrade_failed()
    return DocumentSchemaUpgradeRead(
        document=document_read(document, version), upgrade=upgrade_record(row), replayed=True
    )


def upgrade_schema(
    session: Session, project_id: UUID, document_id: UUID, data: DocumentSchemaUpgradeCreate
) -> DocumentSchemaUpgradeRead:
    """Append version N+1 as the deterministic v2 conversion of v1 version N (CAS)."""
    try:
        with session.begin():
            require_project(session, project_id)
            replayed = _replay(session, project_id, document_id, data)
            if replayed is not None:
                return replayed
            return _upgrade_in_transaction(session, project_id, document_id, data)
    except (IntegrityError, AppError) as error:
        retryable = isinstance(error, IntegrityError) or error.code == "DOCUMENT_VERSION_CONFLICT"
        if not retryable:
            raise
        # A concurrent request may have committed the same command meanwhile.
        with session.begin():
            replayed = _replay(session, project_id, document_id, data)
        if replayed is not None:
            return replayed
        if isinstance(error, IntegrityError):
            raise AppError(
                "DOCUPGRADE_ALREADY_UPGRADED", "正文已升级为新版结构，请重新读取。", 409
            ) from None
        raise


def _upgrade_in_transaction(
    session: Session, project_id: UUID, document_id: UUID, data: DocumentSchemaUpgradeCreate
) -> DocumentSchemaUpgradeRead:
    document = require_document(session, project_id, document_id)
    if session.scalar(
        select(DocumentSchemaUpgrade.id).where(DocumentSchemaUpgrade.document_id == document_id)
    ):
        raise AppError("DOCUPGRADE_ALREADY_UPGRADED", "正文已升级为新版结构，请重新读取。", 409)
    if document.current_version != data.expected_version:
        raise version_conflict()
    current = session.get(DocumentVersion, (document_id, data.expected_version))
    if current is None:
        raise version_conflict()
    if current.schema_version != 1:
        raise AppError("DOCUPGRADE_ALREADY_UPGRADED", "正文已升级为新版结构，请重新读取。", 409)
    target = data.expected_version + 1
    conversion = convert_v1(current.content_json, document_id=document_id, version=target)
    try:
        check_invariants(current.content_json, conversion)
    except ValueError as error:
        raise upgrade_failed() from error
    transition = _source_upgrade_transition(session, document_id, data.expected_version, conversion)
    content = DocumentContentV2.model_validate({"schema_version": 2, "json": conversion.snapshot})
    read = _append_document_version(
        session,
        project_id,
        document_id,
        data.expected_version,
        content,
        "schema_upgrade",
        transition,
    )
    row = DocumentSchemaUpgrade(
        id=uuid4(),
        document_id=document_id,
        command_id=data.command_id,
        request_hash=upgrade_request_hash(document_id, data.expected_version),
        from_version=data.expected_version,
        to_version=read.version,
        from_schema_version=1,
        to_schema_version=2,
        converter_version=conversion.converter_version,
        converter_sha256=conversion.converter_sha256,
        loss_report=conversion.loss,
        created_at=datetime.now(UTC),
    )
    session.add(row)
    session.flush()
    return DocumentSchemaUpgradeRead(document=read, upgrade=upgrade_record(row), replayed=False)


def _source_upgrade_transition(
    session: Session, document_id: UUID, expected_version: int, conversion: Conversion
) -> GuardTransition | None:
    """For imported originals: map v1 editable paths to converted node ids (guard v2)."""
    from thesis_pilot.modules.document_sources.guards import transition_for_upgrade
    from thesis_pilot.modules.document_sources.model_guard import build_upgrade_contract
    from thesis_pilot.modules.document_sources.models import DocumentSourceVersion

    context = session.get(DocumentSourceVersion, (document_id, expected_version))
    initial = session.get(DocumentSourceVersion, (document_id, 1))
    if context is None:
        return None
    if initial is None:
        from thesis_pilot.modules.document_sources.model_guard import guard_invalid

        raise guard_invalid()
    paths = cast(list[list[int]], context.guard_contract.get("editable_paths"))
    contract = build_upgrade_contract(
        initial_contract=initial.guard_contract,
        editable_paths=paths,
        node_map=conversion.node_map,
        snapshot=conversion.snapshot,
        upgraded_from_version=expected_version,
    )
    return transition_for_upgrade(session, document_id, expected_version, contract)
