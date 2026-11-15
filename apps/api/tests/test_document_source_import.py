"""Atomic source imports and fail-closed current/history source inspection."""

import base64
from copy import deepcopy
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import delete, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources import service
from thesis_pilot.modules.document_sources.models import DocumentSource, DocumentSourceVersion
from thesis_pilot.modules.document_sources.schemas import (
    ChapterCorrection,
    DocumentSourceImport,
    DocumentSourcePreviewRequest,
)
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentSave
from thesis_pilot.modules.materials import service as materials
from thesis_pilot.modules.materials.schemas import MaterialUpdate, MaterialUpload
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.workers.execution import execute_job


def ready_source(factory: sessionmaker[Session]):
    with factory() as session:
        project = create_project(session, ProjectCreate(name="自制来源导入项目"))
        receipt = materials.upload_material(
            session,
            project.id,
            MaterialUpload(
                name="自制论文原件",
                filename="合成论文.txt",
                file_type="text",
                kind="other",
                content_base64=base64.b64encode("方法说明\n仅用于测试的原文。".encode()).decode(),
            ),
            str(uuid4()),
        )
    assert execute_job(factory, receipt.job.id, 30)
    with factory() as session:
        original = materials.get_original(
            session, project.id, receipt.material.id, receipt.original.id
        )
    assert original.latest_parse_id is not None
    command = DocumentSourceImport(
        command_id=uuid4(),
        material_id=receipt.material.id,
        original_version_id=original.id,
        parse_version_id=original.latest_parse_id,
    )
    return project, receipt, command


def test_preview_and_chapter_correction_keep_source_identity_and_original_text(
    session_factory: sessionmaker[Session],
) -> None:
    project, material, command = ready_source(session_factory)
    with session_factory() as session:
        preview = service.preview_import(
            session,
            project.id,
            DocumentSourcePreviewRequest.model_validate(
                command.model_dump(exclude={"command_id", "chapter_corrections"})
            ),
        )
        assert preview.can_import and not preview.chapters_truncated
        assert preview.original_sha256 == material.original.sha256
        assert preview.chapters[0].allowed_kinds == ["heading", "paragraph"]
        corrected = command.model_copy(
            update={
                "chapter_corrections": [
                    ChapterCorrection(
                        anchor_id=preview.chapters[0].anchor_id,
                        kind="heading",
                        level=2,
                    )
                ]
            }
        )
        receipt = service.import_source(session, project.id, corrected)
        document = documents.get_current_document(session, project.id)
        node = document.content.json_content["content"][0]
        assert node["type"] == "heading" and node["attrs"]["level"] == 2
        assert node["content"][0]["text"] == "方法说明"
        source = service.current_source(session, project.id, document.id, 1)
        assert source.source_id == receipt.source_id
        assert source.original_version_id == material.original.id
        assert source.parse_version_id == command.parse_version_id
        assert (
            source.guard_contract["chapter_overrides"][0]["anchor_id"]
            == preview.chapters[0].anchor_id
        )
        assert (
            materials.get_original_bytes(
                session, project.id, material.material.id, material.original.id
            )[1]
            == "方法说明\n仅用于测试的原文。".encode()
        )


def test_import_command_replay_is_stable_after_later_edits_and_conflicts_on_other_input(
    session_factory: sessionmaker[Session],
) -> None:
    project, _, command = ready_source(session_factory)
    with session_factory() as session:
        receipt = service.import_source(session, project.id, command)
        current = documents.get_current_document(session, project.id)
        changed = deepcopy(current.content.json_content)
        changed["content"][1]["content"][0]["text"] = "同一映射内的本人新文字。"
        saved = documents.save_document(
            session,
            project.id,
            current.id,
            DocumentSave(
                expected_version=1,
                content={"schema_version": 1, "json": changed},
            ),
        )
        assert saved.version == 2
        assert service.import_source(session, project.id, command) == receipt
        assert service.current_source(session, project.id, current.id, 2).document_version == 2
        assert service.get_source(session, project.id, current.id, 1).document_version == 1
        with pytest.raises(AppError) as conflict:
            service.import_source(
                session, project.id, command.model_copy(update={"parse_version_id": uuid4()})
            )
        assert conflict.value.code == "DOCUMENT_SOURCE_COMMAND_CONFLICT"
        with session.begin():
            assert session.scalar(select(func.count()).select_from(DocumentSource)) == 1
            assert session.scalar(select(func.count()).select_from(DocumentSourceVersion)) == 2


def test_existing_blank_is_not_replaced_and_preview_discloses_existing_document(
    session_factory: sessionmaker[Session],
) -> None:
    project, _, command = ready_source(session_factory)
    with session_factory() as session:
        blank = documents.create_blank_document(session, project.id)
        preview = service.preview_import(
            session,
            project.id,
            DocumentSourcePreviewRequest.model_validate(
                command.model_dump(exclude={"command_id", "chapter_corrections"})
            ),
        )
        assert not preview.can_import and preview.existing_document_id == blank.id
        with pytest.raises(AppError) as existing:
            service.import_source(session, project.id, command)
        assert existing.value.code == "DOCUMENT_ALREADY_EXISTS"
        assert documents.get_current_document(session, project.id) == blank
        with pytest.raises(AppError) as no_source:
            service.current_source(session, project.id, blank.id, 1)
        assert no_source.value.code == "DOCUMENT_SOURCE_NOT_FOUND"


def test_source_mapping_insert_failure_rolls_back_manuscript_and_identity(
    session_factory: sessionmaker[Session],
) -> None:
    project, original, command = ready_source(session_factory)

    def fail_mapping(*args: object) -> None:
        raise RuntimeError("synthetic source mapping insert failure")

    event.listen(DocumentSourceVersion, "before_insert", fail_mapping)
    try:
        with session_factory() as session, pytest.raises(RuntimeError, match="synthetic source"):
            service.import_source(session, project.id, command)
    finally:
        event.remove(DocumentSourceVersion, "before_insert", fail_mapping)
    with session_factory() as session, session.begin():
        assert session.scalar(select(func.count()).select_from(Document)) == 0
        assert session.scalar(select(func.count()).select_from(DocumentVersion)) == 0
        assert session.scalar(select(func.count()).select_from(DocumentSource)) == 0
        assert session.scalar(select(func.count()).select_from(DocumentSourceVersion)) == 0
    with session_factory() as session:
        assert (
            materials.get_original(
                session, project.id, original.material.id, original.original.id
            ).sha256
            == original.original.sha256
        )


def test_cross_project_source_and_command_reuse_do_not_create_other_manuscript(
    session_factory: sessionmaker[Session],
) -> None:
    project, _, command = ready_source(session_factory)
    with session_factory() as session:
        other = create_project(session, ProjectCreate(name="另一个自制项目"))
        with pytest.raises(AppError) as foreign:
            service.import_source(session, other.id, command)
        assert foreign.value.code == "MATERIAL_NOT_FOUND"
        receipt = service.import_source(session, project.id, command)
        with pytest.raises(AppError) as reused:
            service.import_source(session, other.id, command)
        assert reused.value.code == "DOCUMENT_SOURCE_COMMAND_CONFLICT"
        with pytest.raises(AppError) as read:
            service.current_source(session, other.id, receipt.document_id, 1)
        assert read.value.code == "DOCUMENT_NOT_FOUND"


def test_existing_source_with_missing_mapping_fails_closed_on_read_and_save(
    session_factory: sessionmaker[Session],
) -> None:
    project, _, command = ready_source(session_factory)
    with session_factory() as session:
        imported = service.import_source(session, project.id, command)
        current = documents.get_current_document(session, project.id)
        with session.begin():
            session.execute(
                delete(DocumentSourceVersion).where(
                    DocumentSourceVersion.document_id == imported.document_id
                )
            )
        with pytest.raises(AppError) as missing:
            service.current_source(session, project.id, imported.document_id, 1)
        assert missing.value.code == "DOCUMENT_SOURCE_MAPPING_MISSING"
        with pytest.raises(AppError) as unsafe:
            documents.save_document(
                session,
                project.id,
                imported.document_id,
                DocumentSave(
                    expected_version=1,
                    content=current.content,
                ),
            )
        assert unsafe.value.status_code == 409
        assert documents.get_current_document(session, project.id).version == 1


def test_source_current_version_check_and_unlinked_material_history_are_preserved(
    session_factory: sessionmaker[Session],
) -> None:
    project, material, command = ready_source(session_factory)
    with session_factory() as session:
        imported = service.import_source(session, project.id, command)
        with pytest.raises(AppError) as mismatch:
            service.current_source(session, project.id, imported.document_id, 2)
        assert mismatch.value.code == "DOCUMENT_VERSION_CONFLICT"
        materials.update_material(
            session,
            project.id,
            material.material.id,
            MaterialUpdate(
                expected_version=1,
                linked=False,
                removed=True,
            ),
        )
        source = service.current_source(session, project.id, imported.document_id, 1)
        assert source.original_version_id == material.original.id
        assert service.get_source(session, project.id, imported.document_id, 1) == source


@pytest.mark.parametrize(
    "kind,level", [("heading", None), ("paragraph", 1), ("heading", 0), ("heading", True)]
)
def test_chapter_correction_schema_is_explicit(kind: str, level: object) -> None:
    with pytest.raises(ValidationError):
        ChapterCorrection.model_validate({"anchor_id": "synthetic", "kind": kind, "level": level})
