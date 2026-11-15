"""Every protected manuscript write shares source validation and version mapping."""

import base64
import io
from copy import deepcopy
from uuid import UUID, uuid4
from zipfile import ZipFile

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources.models import DocumentSourceVersion
from thesis_pilot.modules.document_sources.schemas import DocumentSourceImport
from thesis_pilot.modules.document_sources.service import import_source
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentContent, DocumentSave
from thesis_pilot.modules.jobs.service import get_job_detail
from thesis_pilot.modules.materials.schemas import MaterialUpload
from thesis_pilot.modules.materials.service import upload_material
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.revisions import service as revisions
from thesis_pilot.modules.revisions.models import RevisionCommand
from thesis_pilot.modules.revisions.schemas import (
    RevisionApply,
    RevisionCreate,
    RevisionDecide,
    RevisionRevert,
    RevisionUndo,
)
from thesis_pilot.modules.revisions.schemas import RevisionProposal as ProposalInput
from thesis_pilot.parsers import docx_core as core
from thesis_pilot.workers.execution import execute_job

ORIGINAL_TEXT = "采用方法甲。能够验证。"


def synthetic_docx() -> bytes:
    body = (
        f"<w:p><w:r><w:t>{ORIGINAL_TEXT}</w:t></w:r></w:p>"
        "<w:p><m:oMath><m:r><m:t>x²</m:t></m:r></m:oMath></w:p>"
    )
    parts = {
        "[Content_Types].xml": (
            f'<Types xmlns="{core.CT}"><Override PartName="/{core.MAIN}" '
            f'ContentType="{core.MAIN_TYPE}"/></Types>'
        ),
        "_rels/.rels": (
            f'<Relationships xmlns="{core.REL}"><Relationship Id="rId1" '
            f'Type="{core.OFFICE_DOCUMENT}" Target="{core.MAIN}"/></Relationships>'
        ),
        core.MAIN: (
            f'<w:document xmlns:w="{core.W}" xmlns:m="{core.M}">'
            f"<w:body>{body}</w:body></w:document>"
        ),
    }
    output = io.BytesIO()
    with ZipFile(output, "w") as archive:
        for name, content in parts.items():
            archive.writestr(name, content.encode())
    return output.getvalue()


def imported(factory: sessionmaker[Session]) -> tuple[UUID, UUID]:
    with factory() as session:
        project = create_project(session, ProjectCreate(name="来源写入保护自制项目"))
        receipt = upload_material(
            session,
            project.id,
            MaterialUpload(
                name="自制原件",
                filename="synthetic.docx",
                file_type="docx",
                kind="other",
                content_base64=base64.b64encode(synthetic_docx()).decode(),
            ),
            str(uuid4()),
        )
    assert execute_job(factory, receipt.job.id, 60)
    with factory() as session:
        job = get_job_detail(session, receipt.job.id)
        assert job.result is not None
        parse_id = UUID(str(job.result["parse_version_id"]))
    with factory() as session:
        result = import_source(
            session,
            project.id,
            DocumentSourceImport.model_validate(
                {
                    "command_id": str(uuid4()),
                    "material_id": str(receipt.material.id),
                    "original_version_id": str(receipt.original.id),
                    "parse_version_id": str(parse_id),
                    "chapter_corrections": [],
                }
            ),
        )
    return project.id, result.document_id


def state(
    factory: sessionmaker[Session], project_id: UUID, document_id: UUID
) -> tuple[int, int, int]:
    with factory() as session:
        current = documents.get_current_document(session, project_id)
        return (
            current.version,
            session.scalar(
                select(func.count())
                .select_from(DocumentVersion)
                .where(DocumentVersion.document_id == document_id)
            )
            or 0,
            session.scalar(
                select(func.count())
                .select_from(DocumentSourceVersion)
                .where(DocumentSourceVersion.document_id == document_id)
            )
            or 0,
        )


def ready_candidate(factory: sessionmaker[Session], project_id: UUID, document_id: UUID) -> UUID:
    with factory() as session:
        created = revisions.create_revision(
            session,
            project_id,
            document_id,
            RevisionCreate.model_validate(
                {
                    "command_id": str(uuid4()),
                    "base_version": 1,
                    "goal": "精简合成文字",
                    "selection": {
                        "textblock_path": [0],
                        "from": 1,
                        "to": len(ORIGINAL_TEXT) + 1,
                        "text": ORIGINAL_TEXT,
                    },
                }
            ),
        )
        assert created.candidate_id is not None
        item = revisions.get_revision(session, project_id, document_id, created.candidate_id)
        revisions.submit_proposal(
            session,
            project_id,
            document_id,
            item.id,
            ProposalInput.model_validate(
                {
                    "command_id": str(uuid4()),
                    "generation_token": str(item.generation_token),
                    "patches": [
                        {
                            "id": "p1",
                            "from": 1,
                            "to": len(ORIGINAL_TEXT) + 1,
                            "before": ORIGINAL_TEXT,
                            "after": "使用方法甲。可以验证。",
                        }
                    ],
                }
            ),
        )
        revisions.decide_revision(
            session,
            project_id,
            document_id,
            item.id,
            RevisionDecide.model_validate(
                {
                    "command_id": str(uuid4()),
                    "expected_revision": 2,
                    "decisions": [{"patch_id": "p1", "decision": "accepted"}],
                }
            ),
        )
        return item.id


def test_creation_helper_requires_caller_transaction_and_rolls_back_together(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        project = create_project(session, ProjectCreate(name="事务内创建"))
        content = DocumentContent.model_validate(
            {"schema_version": 1, "json": {"type": "doc", "content": [{"type": "paragraph"}]}}
        )
        with pytest.raises(RuntimeError, match="outer transaction"):
            documents.create_document_in_transaction(session, project.id, content, "local_import")
        with pytest.raises(RuntimeError, match="synthetic source failure"), session.begin():
            documents.create_document_in_transaction(session, project.id, content, "local_import")
            raise RuntimeError("synthetic source failure")
    with session_factory() as session:
        with pytest.raises(AppError) as missing:
            documents.get_current_document(session, project.id)
        assert missing.value.code == "DOCUMENT_NOT_FOUND"


def test_plain_manuscript_keeps_free_structure_and_creates_no_source_mapping(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        project = create_project(session, ProjectCreate(name="普通无来源项目"))
        original = documents.create_blank_document(session, project.id)
        changed = documents.save_document(
            session,
            project.id,
            original.id,
            DocumentSave.model_validate(
                {
                    "expected_version": 1,
                    "content": {
                        "schema_version": 1,
                        "json": {
                            "type": "doc",
                            "content": [
                                {
                                    "type": "heading",
                                    "attrs": {"level": 2, "chapterId": "synthetic-free-chapter"},
                                    "content": [{"type": "text", "text": "自制章节"}],
                                },
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "自由追加"}],
                                },
                            ],
                        },
                    },
                }
            ),
        )
        assert changed.version == 2
        assert session.scalar(select(func.count()).select_from(DocumentSourceVersion)) == 0


def test_source_manual_save_preserves_first_mapping_and_adds_exactly_one_new_mapping(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = imported(session_factory)
    with session_factory() as session:
        original = documents.get_current_document(session, project_id)
        before = [
            deepcopy(row.guard_contract)
            for row in session.scalars(
                select(DocumentSourceVersion)
                .where(DocumentSourceVersion.document_id == document_id)
                .order_by(DocumentSourceVersion.document_version)
            )
        ]
    changed = deepcopy(original.content.json_content)
    changed["content"][0]["content"][0]["text"] = "手动修改的自制文本。"
    with session_factory() as session:
        saved = documents.save_document(
            session,
            project_id,
            document_id,
            DocumentSave(
                expected_version=1, content=DocumentContent(schema_version=1, json=changed)
            ),
        )
        assert saved.version == 2
    assert state(session_factory, project_id, document_id) == (2, 2, 2)
    with session_factory() as session:
        rows = list(
            session.scalars(
                select(DocumentSourceVersion)
                .where(DocumentSourceVersion.document_id == document_id)
                .order_by(DocumentSourceVersion.document_version)
            )
        )
        assert rows[0].guard_contract == before[0]


def test_source_structure_rejection_rolls_back_the_cas_and_document_version(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = imported(session_factory)
    with session_factory() as session:
        original = documents.get_current_document(session, project_id)
        changed = deepcopy(original.content.json_content)
        changed["content"].append(
            {"type": "paragraph", "content": [{"type": "text", "text": "不允许新增结构"}]}
        )
        with pytest.raises(AppError) as rejected:
            documents.save_document(
                session,
                project_id,
                document_id,
                DocumentSave(
                    expected_version=1, content=DocumentContent(schema_version=1, json=changed)
                ),
            )
        assert rejected.value.code == "DOCUMENT_SOURCE_PROTECTED"
    assert state(session_factory, project_id, document_id) == (1, 1, 1)


def test_mapping_failure_rolls_back_manual_content_and_pointer(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = imported(session_factory)
    with session_factory() as session:
        original = documents.get_current_document(session, project_id)
    changed = deepcopy(original.content.json_content)
    changed["content"][0]["content"][0]["text"] = "可编辑但映射插入失败。"

    def reject_mapping(*args: object) -> None:
        raise RuntimeError("synthetic mapping failure")

    event.listen(DocumentSourceVersion, "before_insert", reject_mapping)
    try:
        with session_factory() as session, pytest.raises(RuntimeError, match="mapping failure"):
            documents.save_document(
                session,
                project_id,
                document_id,
                DocumentSave(
                    expected_version=1, content=DocumentContent(schema_version=1, json=changed)
                ),
            )
    finally:
        event.remove(DocumentSourceVersion, "before_insert", reject_mapping)
    assert state(session_factory, project_id, document_id) == (1, 1, 1)


def test_apply_undo_and_revert_each_append_a_source_mapping(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = imported(session_factory)
    candidate_id = ready_candidate(session_factory, project_id, document_id)
    with session_factory() as session:
        adopted = revisions.apply_revision(
            session,
            project_id,
            document_id,
            candidate_id,
            RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=1),
        )
        assert adopted.result_version == 2
        revisions.undo_revision(
            session,
            project_id,
            document_id,
            adopted.command_id,
            RevisionUndo(command_id=uuid4(), expected_document_version=2),
        )
        restored = revisions.revert_document(
            session,
            project_id,
            document_id,
            RevisionRevert(command_id=uuid4(), expected_document_version=3, target_version=2),
        )
        assert restored.result_version == 4
    assert state(session_factory, project_id, document_id) == (4, 4, 4)


def test_mapping_failure_rolls_back_ai_command_candidate_and_content(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = imported(session_factory)
    candidate_id = ready_candidate(session_factory, project_id, document_id)
    command_id = uuid4()

    def reject_mapping(*args: object) -> None:
        raise RuntimeError("synthetic AI mapping failure")

    event.listen(DocumentSourceVersion, "before_insert", reject_mapping)
    try:
        with session_factory() as session, pytest.raises(RuntimeError, match="mapping failure"):
            revisions.apply_revision(
                session,
                project_id,
                document_id,
                candidate_id,
                RevisionApply(
                    command_id=command_id, expected_revision=3, expected_document_version=1
                ),
            )
    finally:
        event.remove(DocumentSourceVersion, "before_insert", reject_mapping)
    assert state(session_factory, project_id, document_id) == (1, 1, 1)
    with session_factory() as session:
        item = revisions.get_revision(session, project_id, document_id, candidate_id)
        assert item.status == "ready" and item.revision == 3
        assert session.get(RevisionCommand, (document_id, command_id)) is None
