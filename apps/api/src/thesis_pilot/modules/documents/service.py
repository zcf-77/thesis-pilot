"""Atomic append-only manuscript commands and project-scoped reads."""

from datetime import UTC, datetime
from sqlite3 import IntegrityError as SQLiteIntegrityError
from uuid import UUID, uuid4

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import (
    DocumentContent,
    DocumentImport,
    DocumentRead,
    DocumentSave,
    DocumentSource,
    DocumentVersionPage,
    DocumentVersionRead,
    DocumentVersionSummary,
)
from thesis_pilot.modules.documents.structure import MAX_SAFE_INTEGER
from thesis_pilot.modules.projects.models import Project


def require_project(session: Session, project_id: UUID) -> None:
    if session.scalar(select(Project.id).where(Project.id == project_id)) is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)


def document_missing() -> AppError:
    return AppError("DOCUMENT_NOT_FOUND", "当前项目中没有该正文。", 404)


def version_conflict() -> AppError:
    return AppError("DOCUMENT_VERSION_CONFLICT", "正文版本已变化，请保留草稿并重新读取。", 409)


def content_of(version: DocumentVersion) -> DocumentContent:
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


def checked_content(content: DocumentContent) -> DocumentContent:
    # Revalidate at the command boundary, including mutated or constructed model instances.
    return DocumentContent.model_validate(content.model_dump(by_alias=True))


def import_document(session: Session, project_id: UUID, data: DocumentImport) -> DocumentRead:
    return create_document(session, project_id, checked_content(data.content), "local_import")


def create_blank_document(session: Session, project_id: UUID) -> DocumentRead:
    content = DocumentContent.model_validate(
        {"schema_version": 1, "json": {"type": "doc", "content": [{"type": "paragraph"}]}}
    )
    return create_document(session, project_id, content, "blank")


def create_document(
    session: Session, project_id: UUID, content: DocumentContent, source: DocumentSource
) -> DocumentRead:
    try:
        with session.begin():
            require_project(session, project_id)
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
            result = document_read(document, version)
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
    content: DocumentContent,
    source: DocumentSource,
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
    session: Session, project_id: UUID, document_id: UUID, version_number: int
) -> DocumentVersionRead:
    with session.begin():
        document = require_document(session, project_id, document_id)
        version = session.get(DocumentVersion, (document_id, version_number))
        if version is None:
            raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正文版本不存在。", 404)
        return DocumentVersionRead.model_validate(
            {**version_summary(document, version).model_dump(), "content": content_of(version)}
        )
