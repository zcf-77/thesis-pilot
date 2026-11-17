"""Citation candidates: deterministic build, review, atomic adoption and undo.

One document row lock and one transaction own every command. A candidate is frozen
against its base version: adoption recomputes it from that immutable base and the
immutable entry records, compares the digest the student reviewed, checks the managed
citation invariants plus the ordinary protection rules, then appends a version (CAS).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.citations import engine
from thesis_pilot.modules.citations.models import CitationCandidate, CitationCommand
from thesis_pilot.modules.citations.schemas import (
    CitationApply,
    CitationCandidatePage,
    CitationCandidateRead,
    CitationCreate,
    CitationListRead,
    CitationReject,
    CitationUndo,
    CitedEntryRead,
)
from thesis_pilot.modules.document_sources.guards import transition_for_history
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.docs_model import JsonDict, atom_text, find_block
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentContentV2
from thesis_pilot.modules.documents.structure import MAX_SAFE_INTEGER
from thesis_pilot.modules.literature.models import LiteratureEntry
from thesis_pilot.modules.literature.sources import LiteratureRecord

fail = engine.fail


def _hash(operation: str, target: UUID | None, body: object) -> str:
    raw = json.dumps(
        {"operation": operation, "target": str(target) if target else None, "body": body},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _locked_document(session: Session, project_id: UUID, document_id: UUID) -> Document:
    documents.require_project(session, project_id)
    document = session.scalar(
        select(Document)
        .where(Document.id == document_id, Document.project_id == project_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if document is None:
        raise documents.document_missing()
    return document


def _version(session: Session, document_id: UUID, number: int) -> DocumentVersion:
    found = session.get(DocumentVersion, (document_id, number))
    if found is None:
        raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正文版本不存在。", 404)
    return found


def _v2(version: DocumentVersion) -> JsonDict:
    if version.schema_version != 2:
        raise fail("SCHEMA_UNSUPPORTED", "正文仍是旧版结构，请先在写作页升级正文结构再插入引用。")
    return version.content_json


def _entries(session: Session, project_id: UUID, ids: set[str]) -> dict[str, LiteratureEntry]:
    wanted: list[UUID] = []
    for value in ids:
        try:
            wanted.append(UUID(value))
        except ValueError:
            raise engine.state_invalid() from None
    rows = session.scalars(
        select(LiteratureEntry).where(
            LiteratureEntry.project_id == project_id, LiteratureEntry.id.in_(wanted)
        )
    )
    return {str(row.id): row for row in rows}


def _records(entries: dict[str, LiteratureEntry]) -> dict[str, LiteratureRecord]:
    return {key: LiteratureRecord.model_validate(row.record) for key, row in entries.items()}


def _bindings(snapshot: JsonDict) -> set[str]:
    return {
        cast(str, item["binding"])
        for item in cast(list[JsonDict], snapshot.get("protections", []))
        if engine.is_managed(item) and isinstance(item.get("binding"), str)
    }


def _candidate(
    session: Session, document_id: UUID, candidate_id: UUID, *, lock: bool = False
) -> CitationCandidate:
    query = select(CitationCandidate).where(
        CitationCandidate.id == candidate_id, CitationCandidate.document_id == document_id
    )
    if lock:
        query = query.with_for_update()
    found = session.scalar(query.execution_options(populate_existing=True))
    if found is None:
        raise fail("NOT_FOUND", "当前正文中没有该引用候选。", 404)
    return found


def _advance(session: Session, item: CitationCandidate, **changes: object) -> None:
    changed = session.scalar(
        update(CitationCandidate)
        .where(
            CitationCandidate.id == item.id,
            CitationCandidate.revision == item.revision,
            CitationCandidate.revision < MAX_SAFE_INTEGER,
        )
        .values(**changes, revision=CitationCandidate.revision + 1, updated_at=datetime.now(UTC))
        .returning(CitationCandidate)
        .execution_options(synchronize_session=False, populate_existing=True)
    )
    if changed is None:
        raise fail("REVIEW_CONFLICT", "引用候选已变化，请重新读取后审阅。")


def _read(session: Session, document: Document, item: CitationCandidate) -> CitationCandidateRead:
    entry = session.get(LiteratureEntry, item.entry_id)
    assert entry is not None
    application = session.scalar(
        select(CitationCommand.command_id).where(
            CitationCommand.candidate_id == item.id, CitationCommand.operation == "apply"
        )
    )
    stale = item.status == "ready" and (
        item.base_version != document.current_version
        or item.policy_version != engine.POLICY_VERSION
    )
    return CitationCandidateRead.model_validate(
        {
            "id": item.id,
            "project_id": item.project_id,
            "document_id": item.document_id,
            "base_version": item.base_version,
            "document_version": document.current_version,
            "entry": {"id": entry.id, "title": entry.title, "removed": entry.removed},
            "entry_version": item.entry_version,
            "placement": {"node_id": item.node_id, "offset": item.offset},
            "number": item.number,
            "status": item.status,
            "revision": item.revision,
            "policy_version": item.policy_version,
            "preview": item.preview_json,
            "result_version": item.result_version,
            "applicable": item.status == "ready" and not stale and not entry.removed,
            "stale": stale,
            "application_command_id": application,
            "undoable": item.status == "applied"
            and item.result_version == document.current_version,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
    )


def _execute(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    operation: str,
    target: UUID | None,
    command_id: UUID,
    body: object,
    action: Callable[[Document], tuple[CitationCandidate, int | None, int | None]],
) -> CitationCandidateRead:
    fingerprint = _hash(operation, target, body)
    with session.begin():
        document = _locked_document(session, project_id, document_id)
        previous = session.get(CitationCommand, (document_id, command_id))
        if previous is not None:
            if previous.request_hash != fingerprint or previous.operation != operation:
                raise fail("COMMAND_CONFLICT", "同一命令标识不能用于不同请求。")
            item = _candidate(session, document_id, previous.candidate_id)
            return _read(session, document, item)
        item, base_version, result_version = action(document)
        session.add(
            CitationCommand(
                document_id=document_id,
                command_id=command_id,
                operation=operation,
                request_hash=fingerprint,
                candidate_id=item.id,
                base_version=base_version,
                result_version=result_version,
                created_at=datetime.now(UTC),
            )
        )
        session.flush()
        refreshed = session.get(Document, document_id, populate_existing=True)
        assert refreshed is not None
        return _read(session, refreshed, item)


def create_candidate(
    session: Session, project_id: UUID, document_id: UUID, data: CitationCreate
) -> CitationCandidateRead:
    def action(document: Document) -> tuple[CitationCandidate, int | None, int | None]:
        if data.base_version != document.current_version:
            raise fail("STALE", "正文已变化，请保存或重新读取后再插入引用。")
        snapshot = _v2(_version(session, document_id, data.base_version))
        entry = session.scalar(
            select(LiteratureEntry)
            .where(LiteratureEntry.id == data.entry_id, LiteratureEntry.project_id == project_id)
            .with_for_update(read=True)
        )
        if entry is None:
            raise fail("ENTRY_NOT_FOUND", "项目文献中没有该条目。", 404)
        if entry.removed:
            raise fail("ENTRY_REMOVED", "该文献已移出项目文献，请先恢复再引用。")
        entries = _entries(session, project_id, _bindings(snapshot) | {str(entry.id)})
        candidate_id = uuid4()
        built = engine.build(
            snapshot,
            candidate_id=candidate_id,
            entry_id=str(entry.id),
            placement=engine.Placement(data.placement.node_id, data.placement.offset),
            records=_records(entries),
        )
        now = datetime.now(UTC)
        item = CitationCandidate(
            id=candidate_id,
            project_id=project_id,
            document_id=document_id,
            base_version=data.base_version,
            entry_id=entry.id,
            entry_version=entry.version,
            node_id=data.placement.node_id,
            offset=data.placement.offset,
            number=cast(int, built.preview["number"]),
            policy_version=engine.POLICY_VERSION,
            ops_json=cast(list[dict[str, object]], built.ops),
            preview_json=cast(dict[str, object], built.preview),
            result_sha256=built.result_sha256,
            status="ready",
            revision=1,
            result_version=None,
            created_at=now,
            updated_at=now,
        )
        session.add(item)
        session.flush()
        return item, data.base_version, None

    return _execute(
        session,
        project_id,
        document_id,
        "create",
        None,
        data.command_id,
        data.model_dump(mode="json"),
        action,
    )


def apply_candidate(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    data: CitationApply,
) -> CitationCandidateRead:
    def action(document: Document) -> tuple[CitationCandidate, int | None, int | None]:
        item = _candidate(session, document_id, candidate_id, lock=True)
        if item.revision != data.expected_revision:
            raise fail("REVIEW_CONFLICT", "引用候选已变化，请重新读取后审阅。")
        if item.status != "ready":
            raise fail("STATE_CONFLICT", "该引用候选已结束，不能再采纳。")
        if item.policy_version != engine.POLICY_VERSION:
            raise fail("STALE", "引用格式规则已更新，请重新生成引用候选。")
        if (
            item.base_version != document.current_version
            or data.expected_document_version != document.current_version
        ):
            raise fail("STALE", "正文已变化，候选已过期；请在当前正文重新插入引用。")
        entry = session.get(LiteratureEntry, item.entry_id)
        if entry is None or entry.removed:
            raise fail("ENTRY_REMOVED", "该文献已移出项目文献，请先恢复再采纳。")
        base = _v2(_version(session, document_id, item.base_version))
        entries = _entries(session, project_id, _bindings(base) | {str(item.entry_id)})
        rebuilt = engine.build(
            base,
            candidate_id=item.id,
            entry_id=str(item.entry_id),
            placement=engine.Placement(item.node_id, item.offset),
            records=_records(entries),
        )
        if rebuilt.result_sha256 != item.result_sha256 or rebuilt.ops != item.ops_json:
            raise fail("RESULT_MISMATCH", "引用候选与审阅时的内容不一致，正文保持不变。")
        saved = documents.append_managed_document_version(
            session,
            project_id,
            document_id,
            data.expected_document_version,
            DocumentContentV2.model_validate({"schema_version": 2, "json": rebuilt.snapshot}),
            engine.is_managed,
        )
        _advance(session, item, status="applied", result_version=saved.version)
        return item, data.expected_document_version, saved.version

    return _execute(
        session,
        project_id,
        document_id,
        "apply",
        candidate_id,
        data.command_id,
        data.model_dump(mode="json"),
        action,
    )


def reject_candidate(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    data: CitationReject,
) -> CitationCandidateRead:
    def action(document: Document) -> tuple[CitationCandidate, int | None, int | None]:
        item = _candidate(session, document_id, candidate_id, lock=True)
        if item.revision != data.expected_revision:
            raise fail("REVIEW_CONFLICT", "引用候选已变化，请重新读取后审阅。")
        if item.status != "ready":
            raise fail("STATE_CONFLICT", "该引用候选已结束；已采纳的引用请用撤销处理。")
        _advance(session, item, status="rejected")
        return item, None, None

    return _execute(
        session,
        project_id,
        document_id,
        "reject",
        candidate_id,
        data.command_id,
        data.model_dump(mode="json"),
        action,
    )


def undo_candidate(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    data: CitationUndo,
) -> CitationCandidateRead:
    def action(document: Document) -> tuple[CitationCandidate, int | None, int | None]:
        item = _candidate(session, document_id, candidate_id, lock=True)
        if (
            item.status != "applied"
            or item.result_version != document.current_version
            or data.expected_document_version != document.current_version
        ):
            raise fail("UNDO_CONFLICT", "采纳后正文已有其他变更或已撤销，请在历史中比较后决定。")
        original = _version(session, document_id, item.base_version)
        saved = documents.append_guarded_document_version(
            session,
            project_id,
            document_id,
            data.expected_document_version,
            documents.content_of(original),
            "adoption_undo",
            transition_for_history(
                session, document_id, document.current_version, item.base_version
            ),
        )
        _advance(session, item, status="undone")
        return item, data.expected_document_version, saved.version

    return _execute(
        session,
        project_id,
        document_id,
        "undo",
        candidate_id,
        data.command_id,
        data.model_dump(mode="json"),
        action,
    )


def get_candidate(
    session: Session, project_id: UUID, document_id: UUID, candidate_id: UUID
) -> CitationCandidateRead:
    with session.begin():
        document = documents.require_document(session, project_id, document_id)
        return _read(session, document, _candidate(session, document_id, candidate_id))


def list_candidates(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    *,
    status: str | None,
    limit: int,
    offset: int,
) -> CitationCandidatePage:
    with session.begin():
        document = documents.require_document(session, project_id, document_id)
        conditions = [CitationCandidate.document_id == document_id]
        if status is not None:
            conditions.append(CitationCandidate.status == status)
        total = (
            session.scalar(select(func.count()).select_from(CitationCandidate).where(*conditions))
            or 0
        )
        rows = session.scalars(
            select(CitationCandidate)
            .where(*conditions)
            .order_by(CitationCandidate.created_at.desc(), CitationCandidate.id.desc())
            .limit(limit)
            .offset(offset)
        )
        return CitationCandidatePage(
            items=[_read(session, document, row) for row in rows],
            total=total,
            limit=limit,
            offset=offset,
        )


def list_citations(
    session: Session, project_id: UUID, document_id: UUID, version_number: int | None
) -> CitationListRead:
    with session.begin():
        document = documents.require_document(session, project_id, document_id)
        number = version_number or document.current_version
        version = _version(session, document_id, number)
        base: dict[str, object] = {
            "document_id": document_id,
            "document_version": number,
            "schema_version": version.schema_version,
        }
        if version.schema_version != 2:
            return CitationListRead.model_validate(
                {**base, "references_heading": None, "consistent": True, "items": []}
            )
        snapshot = version.content_json
        entries = _entries(session, project_id, _bindings(snapshot))
        consistent = True
        try:
            state = engine.verify(snapshot, _records(entries))
        except AppError:
            consistent = False
            state = engine.read_state(snapshot)
        numbering = state.numbering()
        references = {item.binding: item.node for item in state.references}
        items: list[CitedEntryRead] = []
        for index, binding in enumerate(numbering):
            entry = entries.get(binding)
            node = references.get(binding)
            block = find_block(state.model, node) if node else None
            items.append(
                CitedEntryRead.model_validate(
                    {
                        "entry_id": binding,
                        "number": index + 1,
                        "title": entry.title if entry else "",
                        "removed": entry.removed if entry else True,
                        "reference_node": node,
                        "reference_text": atom_text(cast(list[JsonDict], block["inlines"]))
                        if block is not None and "inlines" in block
                        else None,
                        "markers": [
                            {
                                "protection_id": marker.protection_id,
                                "node": marker.node,
                                "start": marker.start,
                                "end": marker.end,
                            }
                            for marker in sorted(state.markers, key=lambda item: item.order)
                            if marker.binding == binding
                        ],
                    }
                )
            )
        return CitationListRead.model_validate(
            {
                **base,
                "references_heading": state.heading["id"] if state.heading else None,
                "consistent": consistent,
                "items": items,
            }
        )
