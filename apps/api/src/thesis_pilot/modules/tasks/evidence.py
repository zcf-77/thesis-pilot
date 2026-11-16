"""Resolve evidence from trusted server records, never client labels or hashes."""

import hashlib
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.structure import JsonObject
from thesis_pilot.modules.materials.models import Material, MaterialOriginal, MaterialParseVersion
from thesis_pilot.modules.revisions.anchors import resolve_selection
from thesis_pilot.modules.tasks.schemas import (
    ChapterRef,
    DocumentEvidence,
    EvidenceRef,
    EvidenceSnapshot,
)
from thesis_pilot.parsers.schemas import ParsedMaterial


def evidence_error() -> AppError:
    return AppError("TASK_EVIDENCE_INVALID", "证据不存在、不属当前项目或无法精确定位。", 422)


def fingerprint(value: object) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def resolve_evidence(
    session: Session, project_id: UUID, refs: list[EvidenceRef], *, lock: bool = False
) -> list[EvidenceSnapshot]:
    if len({fingerprint(ref.model_dump(mode="json")) for ref in refs}) != len(refs):
        raise evidence_error()
    result: list[EvidenceSnapshot] = []
    for ref in refs:
        if isinstance(ref, DocumentEvidence):
            query = select(Document).where(
                Document.id == ref.document_id, Document.project_id == project_id
            )
            document = session.scalar(query.with_for_update() if lock else query)
            version = session.get(DocumentVersion, (ref.document_id, ref.version))
            if document is None or version is None:
                raise evidence_error()
            try:
                resolve_selection(version.content_json, ref.selection)
            except AppError:
                raise evidence_error() from None
            result.append(
                EvidenceSnapshot(
                    reference=ref,
                    label=f"正式稿 v{ref.version} · {ref.selection.text[:100]}",
                    fingerprint=fingerprint(version.content_json),
                    stale=document.current_version != ref.version,
                )
            )
        else:
            material_query = select(Material).where(
                Material.id == ref.material_id, Material.project_id == project_id
            )
            material = session.scalar(material_query.with_for_update() if lock else material_query)
            original_query = select(MaterialOriginal).where(
                MaterialOriginal.id == ref.original_id,
                MaterialOriginal.material_id == ref.material_id,
            )
            original = session.scalar(original_query.with_for_update() if lock else original_query)
            parsed = session.get(MaterialParseVersion, ref.parse_version_id)
            if (
                material is None
                or original is None
                or parsed is None
                or parsed.original_id != original.id
            ):
                raise evidence_error()
            content = ParsedMaterial.model_validate(parsed.content)
            anchors = {anchor.id: anchor for anchor in content.anchors}
            if any(
                aid not in anchors or anchors[aid].original_version_id != original.id
                for aid in ref.anchor_ids
            ):
                raise evidence_error()
            result.append(
                EvidenceSnapshot(
                    reference=ref,
                    label=f"{material.name} · 原件 v{original.version} / 解析 v{parsed.version}",
                    fingerprint=fingerprint(
                        [original.sha256, [anchors[aid].sha256 for aid in ref.anchor_ids]]
                    ),
                    stale=(
                        material.removed
                        or not material.linked
                        or material.current_original_id != original.id
                        or original.latest_parse_id != parsed.id
                    ),
                )
            )
    return result


def has_chapter(node: JsonObject, chapter_id: str) -> bool:
    attrs = node.get("attrs")
    if (
        node.get("type") == "heading"
        and isinstance(attrs, dict)
        and attrs.get("chapterId") == chapter_id
    ):
        return True
    children = node.get("content")
    return isinstance(children, list) and any(
        has_chapter(child, chapter_id) for child in children if isinstance(child, dict)
    )


def chapter_is_stale(
    session: Session, project_id: UUID, chapter: ChapterRef | None, *, lock: bool = False
) -> bool:
    if chapter is None:
        return False
    query = select(Document).where(
        Document.id == chapter.document_id, Document.project_id == project_id
    )
    document = session.scalar(query.with_for_update() if lock else query)
    version = session.get(DocumentVersion, (chapter.document_id, chapter.version))
    if (
        document is None
        or version is None
        or not has_chapter(version.content_json, chapter.chapter_id)
    ):
        raise AppError("TASK_CHAPTER_INVALID", "章节不属于指定项目与正式稿版本。", 422)
    return document.current_version != chapter.version
