"""Atomic fixed-source imports and version-specific source inspection."""

import json
from hashlib import sha256
from typing import Literal, cast
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources.contracts import (
    GUARD_VERSION,
    SourceGuardContract,
    base_contract,
    build_import_projection,
    manifest_sha256,
    node_at,
    validate_guard_contract,
)
from thesis_pilot.modules.document_sources.model_guard import (
    is_model_guard,
    validate_model_guard,
)
from thesis_pilot.modules.document_sources.models import DocumentSource, DocumentSourceVersion
from thesis_pilot.modules.document_sources.schemas import (
    ChapterKind,
    DocumentSourceChapter,
    DocumentSourceImport,
    DocumentSourceImportReceipt,
    DocumentSourcePreview,
    DocumentSourcePreviewRequest,
    DocumentSourceRead,
)
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentContent
from thesis_pilot.modules.documents.service import create_document_in_transaction
from thesis_pilot.modules.documents.structure import JsonObject
from thesis_pilot.modules.materials.service import MaterialImportSource, load_import_source
from thesis_pilot.modules.projects.models import Project


def error(code: str, message: str, status: int = 409) -> AppError:
    return AppError("DOCUMENT_SOURCE_" + code, message, status)


def _load(
    session: Session,
    project_id: UUID,
    data: DocumentSourcePreviewRequest,
    *,
    require_available: bool = True,
) -> MaterialImportSource:
    source = load_import_source(
        session,
        project_id,
        data.material_id,
        data.original_version_id,
        data.parse_version_id,
        require_available=require_available,
    )
    parsed = source.parsed.result
    manifest = parsed.roundtrip_manifest
    if (
        source.original.file_type not in {"docx", "text"}
        or parsed.editor_json is None
        or manifest is None
        or manifest.get("original_version_id") != str(data.original_version_id)
        or manifest.get("source_sha256") != source.original.sha256
        or manifest.get("file_type") != source.original.file_type
    ):
        raise error("INVALID", "该解析版本没有可安全导入的原件映射。", 422)
    return source


def _chapters(
    source: MaterialImportSource, contract: JsonObject
) -> tuple[list[DocumentSourceChapter], bool]:
    parsed = source.parsed.result
    assert parsed.editor_json is not None and parsed.roundtrip_manifest is not None
    paths = {tuple(path) for path in SourceGuardContract.model_validate(contract).editable_paths}
    candidates: list[DocumentSourceChapter] = []
    budget = 0
    counts: dict[tuple[int, ...], int] = {}
    for anchor in parsed.anchors:
        if anchor.editor_path is not None:
            path = tuple(anchor.editor_path)
            counts[path] = counts.get(path, 0) + 1
    for anchor in parsed.anchors:
        if anchor.editor_path is None or anchor.kind not in {"text", "paragraph", "heading"}:
            continue
        node = node_at(parsed.editor_json, anchor.editor_path)
        if node.get("type") not in {"paragraph", "heading"}:
            continue
        attrs = node.get("attrs")
        level = attrs.get("level") if isinstance(attrs, dict) else None
        allowed: list[ChapterKind] = []
        if (
            anchor.editable
            and tuple(anchor.editor_path) in paths
            and counts[tuple(anchor.editor_path)] == 1
        ):
            allowed = ["heading", "paragraph"]
        candidate = DocumentSourceChapter(
            anchor_id=anchor.id,
            editor_path=anchor.editor_path,
            title=anchor.original_text[:120],
            kind=cast(ChapterKind, node["type"]),
            level=level if type(level) is int else None,
            editable=anchor.editable,
            allowed_kinds=allowed,
        )
        size = len(candidate.model_dump_json().encode())
        if len(candidates) >= 1000 or budget + size > 768 * 1024:
            return candidates, True
        candidates.append(candidate)
        budget += size
    return candidates, False


def preview_import(
    session: Session, project_id: UUID, data: DocumentSourcePreviewRequest
) -> DocumentSourcePreview:
    with session.begin():
        source = _load(session, project_id, data)
        # Preview applies the same complete source guard validation as import.
        _, contract = build_import_projection(source.parsed.result, [])
        existing = session.scalar(select(Document.id).where(Document.project_id == project_id))
        chapters, truncated = _chapters(source, contract)
        diagnostics = [note[:800] for note in source.parsed.result.diagnostics[:20]]
        if existing is not None:
            diagnostics = [
                "项目已有正式稿；不能覆盖，包括已创建的空白正式稿。",
                *diagnostics[:19],
            ]
        return DocumentSourcePreview(
            project_id=project_id,
            material_id=data.material_id,
            original_version_id=data.original_version_id,
            parse_version_id=data.parse_version_id,
            filename=source.original.filename,
            file_type=cast(Literal["docx", "text"], source.original.file_type),
            original_sha256=source.original.sha256,
            manifest_sha256=manifest_sha256(source.parsed.result.roundtrip_manifest),
            parser_version=source.parsed.result.parser_version,
            status=source.parsed.result.status,
            can_import=existing is None,
            existing_document_id=existing,
            chapters=chapters,
            chapters_truncated=truncated,
            diagnostics=diagnostics,
        )


def _request_digest(project_id: UUID, data: DocumentSourceImport) -> str:
    payload = data.model_dump(mode="json", exclude={"command_id"})
    payload["project_id"] = str(project_id)
    payload["chapter_corrections"] = [
        correction.model_dump(mode="json")
        for correction in sorted(data.chapter_corrections, key=lambda item: item.anchor_id)
    ]
    return sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _receipt(source: DocumentSource) -> DocumentSourceImportReceipt:
    return DocumentSourceImportReceipt(
        command_id=source.import_command_id,
        document_id=source.document_id,
        source_id=source.id,
        material_id=source.material_id,
        original_version_id=source.original_version_id,
        parse_version_id=source.parse_version_id,
    )


def _replay(
    session: Session, project_id: UUID, command_id: UUID, digest: str
) -> DocumentSourceImportReceipt | None:
    source = session.scalar(
        select(DocumentSource).where(DocumentSource.import_command_id == command_id)
    )
    if source is None:
        return None
    document = session.get(Document, source.document_id)
    if document is None or document.project_id != project_id or source.request_hash != digest:
        raise error("COMMAND_CONFLICT", "导入命令已用于不同请求。")
    return _receipt(source)


def import_source(
    session: Session, project_id: UUID, data: DocumentSourceImport
) -> DocumentSourceImportReceipt:
    # Models can be constructed or mutated by internal callers; revalidate before
    # deciding the command hash or the source/chapter permissions.
    data = DocumentSourceImport.model_validate(data.model_dump(mode="json"))
    digest = _request_digest(project_id, data)
    try:
        with session.begin():
            replay = _replay(session, project_id, data.command_id, digest)
            if replay is not None:
                return replay
            project = session.scalar(
                select(Project).where(Project.id == project_id).with_for_update()
            )
            if project is None:
                raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
            # A concurrent identical command may have committed while this
            # request waited for the project lock.
            replay = _replay(session, project_id, data.command_id, digest)
            if replay is not None:
                return replay
            if (
                session.scalar(select(Document.id).where(Document.project_id == project_id))
                is not None
            ):
                raise AppError("DOCUMENT_ALREADY_EXISTS", "项目已有正式稿，不能覆盖导入。", 409)
            source = _load(session, project_id, data)
            corrections = sorted(data.chapter_corrections, key=lambda item: item.anchor_id)
            projection, contract = build_import_projection(source.parsed.result, corrections)
            document = create_document_in_transaction(
                session,
                project_id,
                DocumentContent(schema_version=1, json=projection),
                "local_import",
            )
            identity = DocumentSource(
                document_id=document.id,
                material_id=data.material_id,
                original_version_id=data.original_version_id,
                parse_version_id=data.parse_version_id,
                original_sha256=source.original.sha256,
                manifest_sha256=manifest_sha256(source.parsed.result.roundtrip_manifest),
                import_command_id=data.command_id,
                request_hash=digest,
            )
            session.add(identity)
            session.flush()
            session.add(
                DocumentSourceVersion(
                    document_id=document.id,
                    document_version=1,
                    source_id=identity.id,
                    guard_version=GUARD_VERSION,
                    guard_contract=contract,
                )
            )
            session.flush()
            return _receipt(identity)
    except IntegrityError as failure:
        with session.begin():
            replay = _replay(session, project_id, data.command_id, digest)
            if replay is not None:
                return replay
        diagnostic = getattr(failure.orig, "diag", None)
        constraint = getattr(diagnostic, "constraint_name", None)
        if (
            constraint == "uq_documents_project_id"
            or str(failure.orig) == "UNIQUE constraint failed: documents.project_id"
        ):
            raise AppError(
                "DOCUMENT_ALREADY_EXISTS", "项目已有正式稿，不能覆盖导入。", 409
            ) from None
        if (
            constraint == "uq_document_sources_import_command_id"
            or str(failure.orig) == "UNIQUE constraint failed: document_sources.import_command_id"
        ):
            raise error("COMMAND_CONFLICT", "导入命令已用于不同请求。") from None
        raise


def _source_read(
    session: Session, project_id: UUID, document_id: UUID, version: int
) -> DocumentSourceRead:
    source = session.scalar(select(DocumentSource).where(DocumentSource.document_id == document_id))
    document_version = session.get(DocumentVersion, (document_id, version))
    if document_version is None:
        if source is not None:
            raise error("MAPPING_MISSING", "指定正文版本的来源保护映射不可用。")
        raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正文版本不存在。", 404)
    if source is None:
        raise error("NOT_FOUND", "该正文没有原件导入来源。", 404)
    mapping = session.get(DocumentSourceVersion, (document_id, version))
    initial = session.get(DocumentSourceVersion, (document_id, 1))
    model_guard = mapping is not None and is_model_guard(mapping.guard_contract)
    if (
        mapping is None
        or initial is None
        or mapping.source_id != source.id
        or initial.source_id != source.id
        or mapping.guard_version != mapping.guard_contract.get("guard_version")
        or initial.guard_version != GUARD_VERSION
        or (not model_guard and base_contract(mapping.guard_contract) != initial.guard_contract)
    ):
        raise error("MAPPING_MISSING", "指定正文版本的来源保护映射缺失或不一致。")
    fixed = _load(
        session,
        project_id,
        DocumentSourcePreviewRequest(
            material_id=source.material_id,
            original_version_id=source.original_version_id,
            parse_version_id=source.parse_version_id,
        ),
        require_available=False,
    )
    if (
        fixed.original.sha256 != source.original_sha256
        or manifest_sha256(fixed.parsed.result.roundtrip_manifest) != source.manifest_sha256
    ):
        raise error("GUARD_INVALID", "保存的原件身份或映射摘要不一致。")
    try:
        if model_guard:
            # v2 manuscript (after the explicit schema upgrade): frozen model skeleton.
            validate_model_guard(
                mapping.guard_contract, document_version.content_json, initial.guard_contract
            )
        else:
            SourceGuardContract.model_validate(mapping.guard_contract)
            validate_guard_contract(
                fixed.parsed.result, mapping.guard_contract, document_version.content_json
            )
    except ValidationError:
        raise error("GUARD_INVALID", "来源保护映射不符合已验证结构。") from None
    return DocumentSourceRead(
        document_id=document_id,
        document_version=version,
        source_id=source.id,
        material_id=source.material_id,
        original_version_id=source.original_version_id,
        parse_version_id=source.parse_version_id,
        original_sha256=source.original_sha256,
        manifest_sha256=source.manifest_sha256,
        filename=fixed.original.filename,
        file_type=cast(Literal["docx", "text"], fixed.original.file_type),
        guard_version=mapping.guard_version,
        guard_contract=mapping.guard_contract,
        imported_at=source.created_at,
    )


def _document(session: Session, project_id: UUID, document_id: UUID) -> Document:
    document = session.scalar(
        select(Document)
        .where(
            Document.id == document_id,
            Document.project_id == project_id,
        )
        .with_for_update(read=True)
    )
    if document is None:
        raise AppError("DOCUMENT_NOT_FOUND", "项目中没有该正文。", 404)
    return document


def current_source(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    expected_document_version: int | None = None,
) -> DocumentSourceRead:
    with session.begin():
        document = _document(session, project_id, document_id)
        if (
            expected_document_version is not None
            and document.current_version != expected_document_version
        ):
            raise AppError("DOCUMENT_VERSION_CONFLICT", "正文版本已变化，请重新读取。", 409)
        return _source_read(session, project_id, document_id, document.current_version)


def get_source(
    session: Session, project_id: UUID, document_id: UUID, version: int
) -> DocumentSourceRead:
    with session.begin():
        _document(session, project_id, document_id)
        return _source_read(session, project_id, document_id, version)
