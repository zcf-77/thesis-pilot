"""Source overlay/append guards; synthetic data and isolated SQLite fast tests."""

import io
from copy import deepcopy
from hashlib import sha256
from uuid import UUID, uuid4
from zipfile import ZipFile

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources.contracts import (
    GUARD_VERSION,
    build_import_projection,
    manifest_sha256,
    validate_guard_contract,
)
from thesis_pilot.modules.document_sources.guards import record_source_version, validate_append
from thesis_pilot.modules.document_sources.models import DocumentSource, DocumentSourceVersion
from thesis_pilot.modules.document_sources.schemas import ChapterCorrection
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentContent
from thesis_pilot.modules.documents.structure import JsonObject
from thesis_pilot.modules.jobs.models import Job
from thesis_pilot.modules.materials.models import Material, MaterialOriginal, MaterialParseVersion
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.parsers import docx_core as core
from thesis_pilot.parsers.materials import parse_original
from thesis_pilot.parsers.schemas import ParsedMaterial


def original() -> bytes:
    output = io.BytesIO()
    parts = {
        "[Content_Types].xml": (
            f'<Types xmlns="{core.CT}"><Override PartName="/{core.MAIN}" '
            f'ContentType="{core.MAIN_TYPE}"/></Types>'
        ),
        "_rels/.rels": (
            f'<Relationships xmlns="{core.REL}"><Relationship Id="r1" '
            f'Type="{core.OFFICE_DOCUMENT}" Target="{core.MAIN}"/></Relationships>'
        ),
        core.MAIN: (
            f'<w:document xmlns:w="{core.W}" xmlns:m="{core.M}"><w:body>'
            '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>合成原章节</w:t></w:r></w:p>'
            "<w:p><w:r><w:t>只允许修改的合成文字 1200。</w:t></w:r></w:p>"
            "<w:p><m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath></w:p>"
            "<w:p><w:r><w:t>锁定引用 [1]。</w:t></w:r></w:p>"
            "</w:body></w:document>"
        ),
    }
    with ZipFile(output, "w") as archive:
        for part, value in parts.items():
            archive.writestr(part, value.encode())
    return output.getvalue()


def corrected(
    data: bytes | None = None, original_id: UUID | None = None
) -> tuple[ParsedMaterial, JsonObject, JsonObject]:
    parsed = parse_original(
        data if data is not None else original(), original_id or uuid4(), "docx"
    )
    heading, paragraph = parsed.anchors[:2]
    document, contract = build_import_projection(
        parsed,
        [
            ChapterCorrection(anchor_id=heading.id, kind="paragraph"),
            ChapterCorrection(anchor_id=paragraph.id, kind="heading", level=3),
        ],
    )
    return parsed, document, contract


def test_initial_overlay_changes_only_explicit_chapter_fields_and_keeps_original_manifest() -> None:
    parsed = parse_original(original(), uuid4(), "docx")
    before = parsed.model_dump(mode="json")
    heading, paragraph = parsed.anchors[:2]
    edits = [
        ChapterCorrection(anchor_id=heading.id, kind="paragraph"),
        ChapterCorrection(anchor_id=paragraph.id, kind="heading", level=3),
    ]
    document, contract = build_import_projection(parsed, edits)
    assert document["content"][0]["type"] == "paragraph"
    assert document["content"][1]["type"] == "heading"
    assert document["content"][1]["attrs"]["level"] == 3
    assert document["content"][1]["attrs"]["chapterId"].startswith("chapter-")
    assert document["content"][1]["content"] == parsed.editor_json["content"][1]["content"]
    assert build_import_projection(parsed, edits) == (document, contract)
    assert parsed.model_dump(mode="json") == before
    assert contract["manifest_sha256"] == manifest_sha256(parsed.roundtrip_manifest)
    assert contract["skeleton_sha256"] == parsed.roundtrip_manifest["skeleton_sha256"]
    assert contract["editable_paths"] == parsed.roundtrip_manifest["editable_paths"]


@pytest.mark.parametrize("case", ["locked", "missing", "duplicate", "mutated_level"])
def test_initial_chapter_correction_rejects_unsupported_or_ambiguous_targets(case: str) -> None:
    parsed = parse_original(original(), uuid4(), "docx")
    valid = ChapterCorrection(anchor_id=parsed.anchors[1].id, kind="heading", level=2)
    corrections = [valid]
    if case == "locked":
        corrections = [ChapterCorrection(anchor_id=parsed.anchors[2].id, kind="heading", level=2)]
    elif case == "missing":
        corrections = [ChapterCorrection(anchor_id="no-such-anchor", kind="heading", level=2)]
    elif case == "duplicate":
        corrections = [valid, valid]
    else:
        valid.level = True
    with pytest.raises(AppError) as caught:
        build_import_projection(parsed, corrections)
    assert caught.value.code == "DOCUMENT_SOURCE_CHAPTER_INVALID"


@pytest.mark.parametrize(
    "field,value",
    [
        ("level", 4),
        ("chapterId", "forged-id"),
        ("templateWeight", "700"),
    ],
)
def test_append_rejects_changed_target_heading_fields_before_reverse_overlay(
    field: str,
    value: object,
) -> None:
    parsed, document, contract = corrected()
    changed = deepcopy(document)
    changed["content"][1]["attrs"][field] = value
    with pytest.raises(AppError) as caught:
        validate_guard_contract(parsed, contract, changed)
    assert caught.value.code == "DOCUMENT_SOURCE_PROTECTED"
    assert document["content"][1]["attrs"]["level"] == 3


def test_legal_text_append_and_restoring_imported_history_keep_frozen_chapters() -> None:
    parsed, document, contract = corrected()
    changed = deepcopy(document)
    changed["content"][1]["content"][0]["text"] = "合法的映射文字修订 1200。"
    validate_guard_contract(parsed, contract, changed)
    validate_guard_contract(parsed, contract, document)
    assert parsed.editor_json is not None
    with pytest.raises(AppError):
        # Reverting to the parser projection must not silently undo accepted import corrections.
        validate_guard_contract(parsed, contract, parsed.editor_json)


@pytest.mark.parametrize("case", ["formula", "citation", "type", "reorder", "extra", "marks"])
def test_locked_source_and_structure_cannot_be_changed(case: str) -> None:
    parsed, document, contract = corrected()
    changed = deepcopy(document)
    if case in {"formula", "citation"}:
        index = 2 if case == "formula" else 3
        changed["content"][index]["content"][0]["text"] = "试图替换受保护对象"
    elif case == "type":
        changed["content"][1]["type"] = "paragraph"
        changed["content"][1].pop("attrs")
    elif case == "reorder":
        changed["content"].reverse()
    elif case == "extra":
        changed["content"].append({"type": "paragraph"})
    else:
        changed["content"][1]["content"][0]["marks"] = [{"type": "bold"}]
    with pytest.raises(AppError):
        validate_guard_contract(parsed, contract, changed)


@pytest.mark.parametrize("case", ["manifest", "paths", "original_fields", "duplicate_overlay"])
def test_corrupt_guard_contract_fails_closed(case: str) -> None:
    parsed, document, contract = corrected()
    broken = deepcopy(contract)
    if case == "manifest":
        broken["manifest_sha256"] = "0" * 64
    elif case == "paths":
        broken["editable_paths"].append([2])
    elif case == "original_fields":
        broken["chapter_overrides"][0]["original_attrs"]["level"] = 6
    else:
        broken["chapter_overrides"].append(broken["chapter_overrides"][0])
    with pytest.raises(AppError) as caught:
        validate_guard_contract(parsed, broken, document)
    assert caught.value.code == "DOCUMENT_SOURCE_GUARD_INVALID"


def seed(
    session_factory: sessionmaker[Session], *, mapping: bool = True
) -> tuple[UUID, JsonObject, JsonObject]:
    project_id, document_id, material_id, original_id, parse_id, job_id, source_id = [
        uuid4() for _ in range(7)
    ]
    data = original()
    parsed, document, contract = corrected(data, original_id)
    manifest = parsed.roundtrip_manifest
    assert manifest is not None
    # SQLite fast fixture only; PostgreSQL atomic paths have separate integration tests.
    with session_factory() as session, session.begin():
        session.add(Project(id=project_id, name="合成来源保护项目"))
        session.flush()
        session.add(Document(id=document_id, project_id=project_id, current_version=1))
        session.flush()
        session.add(
            DocumentVersion(
                document_id=document_id,
                version=1,
                schema_version=1,
                content_json=document,
                source="local_import",
            )
        )
        session.add(Material(id=material_id, project_id=project_id, name="合成原件", kind="other"))
        session.add(
            Job(
                id=job_id,
                project_id=project_id,
                kind="material_parse",
                idempotency_key=str(uuid4()),
                request_hash="0" * 64,
            )
        )
        session.flush()
        session.add(
            MaterialOriginal(
                id=original_id,
                material_id=material_id,
                version=1,
                filename="合成.docx",
                file_type="docx",
                sha256=sha256(data).hexdigest(),
                byte_size=len(data),
                data=data,
                upload_key=str(uuid4()),
                request_hash="0" * 64,
            )
        )
        session.flush()
        session.add(
            MaterialParseVersion(
                id=parse_id,
                original_id=original_id,
                version=1,
                source_job_id=job_id,
                status=parsed.status,
                content=parsed.model_dump(mode="json"),
            )
        )
        session.flush()
        session.add(
            DocumentSource(
                id=source_id,
                document_id=document_id,
                material_id=material_id,
                original_version_id=original_id,
                parse_version_id=parse_id,
                original_sha256=manifest["source_sha256"],
                manifest_sha256=manifest_sha256(manifest),
                import_command_id=uuid4(),
                request_hash="0" * 64,
            )
        )
        session.flush()
        if mapping:
            session.add(
                DocumentSourceVersion(
                    document_id=document_id,
                    document_version=1,
                    source_id=source_id,
                    guard_version=GUARD_VERSION,
                    guard_contract=contract,
                )
            )
    return document_id, document, contract


def test_append_mapping_uses_explicit_base_after_cas_and_copies_contract(
    session_factory: sessionmaker[Session],
) -> None:
    document_id, document, contract = seed(session_factory)
    candidate = deepcopy(document)
    candidate["content"][1]["content"][0]["text"] = "下一版合法文字 1200。"
    with session_factory() as session, session.begin():
        session.execute(
            update(Document).where(Document.id == document_id).values(current_version=2)
        )
        context = validate_append(
            session, document_id, 1, DocumentContent(schema_version=1, json=candidate)
        )
        assert context is not None
        session.add(
            DocumentVersion(
                document_id=document_id,
                version=2,
                schema_version=1,
                content_json=candidate,
                source="manual_edit",
            )
        )
        session.flush()
        record_source_version(session, context, 2)
        second = session.get(DocumentSourceVersion, (document_id, 2))
        assert second is not None and second.guard_contract == contract
        assert second.guard_contract is not context.guard_contract
        second.guard_contract["editable_paths"].append([999])
        assert context.guard_contract == contract
    with session_factory() as session:
        versions = session.scalars(
            select(DocumentSourceVersion).where(DocumentSourceVersion.document_id == document_id)
        ).all()
        assert len(versions) == 2


def test_existing_source_without_base_mapping_never_becomes_free_editable(
    session_factory: sessionmaker[Session],
) -> None:
    document_id, document, _ = seed(session_factory, mapping=False)
    with session_factory() as session, session.begin(), pytest.raises(AppError) as caught:
        validate_append(session, document_id, 1, DocumentContent(schema_version=1, json=document))
    assert caught.value.code == "DOCUMENT_SOURCE_GUARD_INVALID"


def test_no_source_does_not_add_a_source_mapping(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as session, session.begin():
        content = DocumentContent(
            schema_version=1, json={"type": "doc", "content": [{"type": "paragraph"}]}
        )
        assert validate_append(session, uuid4(), 1, content) is None
        record_source_version(session, None, 2)
        assert session.scalars(select(DocumentSourceVersion)).all() == []
