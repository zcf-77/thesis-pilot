from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import service
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentImport, DocumentSave
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project


def content(text: str = "自制正文🙂\u0000") -> dict:
    return {
        "schema_version": 1,
        "json": {
            "type": "doc",
            "content": [
                {"type": "heading", "attrs": {"chapterId": "chapter-original"}},
                {"type": "paragraph", "content": [{"type": "text", "text": text}]},
            ],
        },
    }


def create_document(sessions: sessionmaker[Session]) -> tuple[UUID, UUID]:
    with sessions() as session:
        project = create_project(session, ProjectCreate(name="正文自制项目"))
        document = service.import_document(session, project.id, DocumentImport(content=content()))
    return project.id, document.id


def test_save_restore_history_and_project_version_are_independent(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = create_document(session_factory)
    with session_factory() as session:
        original = service.get_current_document(session, project_id)
        saved = service.save_document(
            session,
            project_id,
            document_id,
            DocumentSave(expected_version=1, content=content("手动编辑🙂")),
        )
    assert original.version == 1 and saved.version == 2 and saved.id == original.id
    assert original.created_at.utcoffset() == timedelta(0)
    with session_factory() as session:
        assert service.get_current_document(session, project_id) == saved
        history = service.get_version(session, project_id, document_id, 1)
        assert history.content == original.content and history.source == "local_import"
        assert service.get_version(session, project_id, document_id, 2).source == "manual_edit"
        first = service.list_versions(session, project_id, document_id, limit=1, offset=0)
        second = service.list_versions(session, project_id, document_id, limit=1, offset=1)
        assert first.total == second.total == 2
        assert [item.version for item in first.items + second.items] == [2, 1]
        assert "content" not in first.items[0].model_dump()
        assert session.get(Project, project_id).version == 1


def test_duplicate_import_and_repeated_cas_never_overwrite(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = create_document(session_factory)
    with session_factory() as session:
        with pytest.raises(AppError) as duplicate:
            service.import_document(
                session, project_id, DocumentImport(content=content("不能覆盖"))
            )
        assert duplicate.value.code == "DOCUMENT_ALREADY_EXISTS"
        saved = service.save_document(
            session,
            project_id,
            document_id,
            DocumentSave(expected_version=1, content=content("胜方")),
        )
        for _ in range(2):
            with pytest.raises(AppError) as stale:
                service.save_document(
                    session,
                    project_id,
                    document_id,
                    DocumentSave(expected_version=1, content=content("旧草稿")),
                )
            assert stale.value.code == "DOCUMENT_VERSION_CONFLICT"
        assert service.get_current_document(session, project_id) == saved
        assert (
            service.list_versions(session, project_id, document_id, limit=100, offset=0).total == 2
        )


def test_missing_resources_and_cross_project_ids_are_explicit(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = create_document(session_factory)
    with session_factory() as session:
        other = create_project(session, ProjectCreate(name="另一个项目"))
        calls = [
            (lambda: service.get_current_document(session, uuid4()), "PROJECT_NOT_FOUND"),
            (lambda: service.get_current_document(session, other.id), "DOCUMENT_NOT_FOUND"),
            (lambda: service.get_version(session, other.id, document_id, 1), "DOCUMENT_NOT_FOUND"),
            (
                lambda: service.get_version(session, project_id, document_id, 99),
                "DOCUMENT_VERSION_NOT_FOUND",
            ),
            (
                lambda: service.save_document(
                    session,
                    other.id,
                    document_id,
                    DocumentSave(expected_version=1, content=content("不属于此项目")),
                ),
                "DOCUMENT_NOT_FOUND",
            ),
        ]
        for call, code in calls:
            with pytest.raises(AppError) as captured:
                call()
            assert captured.value.code == code
        assert service.get_current_document(session, project_id).version == 1


def test_version_insert_failure_rolls_back_pointer_and_timestamp(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = create_document(session_factory)
    with session_factory() as session:
        before = service.get_current_document(session, project_id)

    def fail(mapper: object, connection: object, target: DocumentVersion) -> None:
        if target.version == 2:
            raise RuntimeError("synthetic insertion failure")

    event.listen(DocumentVersion, "before_insert", fail)
    try:
        with session_factory() as session, pytest.raises(RuntimeError, match="synthetic"):
            service.save_document(
                session,
                project_id,
                document_id,
                DocumentSave(expected_version=1, content=content("不能留下半次保存")),
            )
    finally:
        event.remove(DocumentVersion, "before_insert", fail)
    with session_factory() as session:
        assert service.get_current_document(session, project_id) == before
        assert session.scalar(select(func.count()).select_from(DocumentVersion)) == 1


def test_invalid_mutated_dto_is_revalidated_before_transaction(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = create_document(session_factory)
    data = DocumentSave(expected_version=1, content=content("合法"))
    data.content.json_content["marks"] = [{"type": "bold"}]
    with session_factory() as session:
        with pytest.raises(AppError) as captured:
            service.save_document(session, project_id, document_id, data)
        assert captured.value.code == "DOCUMENT_STRUCTURE_INVALID"
        assert service.get_current_document(session, project_id).version == 1
        assert session.scalar(select(func.count()).select_from(Document)) == 1
