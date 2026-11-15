"""Source-linked manuscript import and append invariants on real PostgreSQL.

Every original is generated in memory; no user documents or shared service database
are read. Run with the repository's explicit integration environment.
"""

import base64
import hashlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, event, func, select, update
from sqlalchemy.exc import DBAPIError

from scripts.create_material_demo import synthetic_docx
from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources import service as sources
from thesis_pilot.modules.document_sources.models import DocumentSource, DocumentSourceVersion
from thesis_pilot.modules.document_sources.schemas import (
    ChapterCorrection,
    DocumentSourceImport,
    DocumentSourceImportReceipt,
    DocumentSourcePreviewRequest,
)
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentImport, DocumentRead, DocumentSave
from thesis_pilot.modules.materials import service as materials
from thesis_pilot.modules.materials.schemas import MaterialUpload, MaterialUploadReceipt
from thesis_pilot.modules.revisions import service as revisions
from thesis_pilot.modules.revisions.schemas import (
    RevisionApply,
    RevisionCreate,
    RevisionDecide,
    RevisionRevert,
    RevisionUndo,
)
from thesis_pilot.modules.revisions.schemas import RevisionProposal as ProposalInput

from .conftest import PostgreSQLSandbox
from .test_materials import finish_parse
from .test_services import make_project

pytestmark = pytest.mark.integration


@dataclass(frozen=True)
class SourceInput:
    project_id: UUID
    receipt: MaterialUploadReceipt
    parse_id: UUID
    original: bytes

    def request(self, command_id: UUID | None = None, **changes: object) -> DocumentSourceImport:
        return DocumentSourceImport.model_validate(
            {
                "command_id": command_id or uuid4(),
                "material_id": self.receipt.material.id,
                "original_version_id": self.receipt.original.id,
                "parse_version_id": self.parse_id,
                **changes,
            }
        )


def seed(postgres: PostgreSQLSandbox) -> SourceInput:
    project_id = make_project(postgres)
    original = synthetic_docx()
    with postgres.sessions() as session:
        receipt = materials.upload_material(
            session,
            project_id,
            MaterialUpload(
                name="完全合成DOCX导入样例",
                filename="synthetic-manuscript.docx",
                file_type="docx",
                kind="other",
                source_note="工程合成数据，无真实论文。",
                content_base64=base64.b64encode(original).decode("ascii"),
            ),
            str(uuid4()),
        )
    parsed = finish_parse(postgres, receipt.job.id)
    return SourceInput(project_id, receipt, parsed.id, original)


def imported(postgres: PostgreSQLSandbox, source: SourceInput) -> DocumentSourceImportReceipt:
    with postgres.sessions() as session:
        return sources.import_source(session, source.project_id, source.request())


def current(postgres: PostgreSQLSandbox, project_id: UUID) -> DocumentRead:
    with postgres.sessions() as session:
        return documents.get_current_document(session, project_id)


def editable_change(document: DocumentRead) -> dict:
    content = document.content.model_dump(mode="json", by_alias=True)
    paragraph = content["json"]["content"][1]
    assert paragraph["type"] == "paragraph"
    paragraph["content"][0]["text"] = paragraph["content"][0]["text"].replace("自制", "合成")
    return content


def assert_original(postgres: PostgreSQLSandbox, source: SourceInput) -> None:
    with postgres.sessions() as session:
        metadata, body = materials.get_original_bytes(
            session, source.project_id, source.receipt.material.id, source.receipt.original.id
        )
    assert body == source.original
    assert hashlib.sha256(body).hexdigest() == metadata.sha256 == source.receipt.original.sha256


def test_import_pins_server_source_sha_and_applies_only_explicit_chapter_correction(
    postgres: PostgreSQLSandbox,
) -> None:
    source = seed(postgres)
    with postgres.sessions() as session:
        preview = sources.preview_import(
            session,
            source.project_id,
            DocumentSourcePreviewRequest(
                material_id=source.receipt.material.id,
                original_version_id=source.receipt.original.id,
                parse_version_id=source.parse_id,
            ),
        )
    target = next(item for item in preview.chapters if item.editor_path == [1])
    assert target.editable and "heading" in target.allowed_kinds
    correction = ChapterCorrection(anchor_id=target.anchor_id, kind="heading", level=2)
    with postgres.sessions() as session:
        receipt = sources.import_source(
            session, source.project_id, source.request(chapter_corrections=[correction])
        )
    document = current(postgres, source.project_id)
    heading = document.content.json_content["content"][1]
    assert heading["type"] == "heading" and heading["attrs"]["level"] == 2
    assert heading["attrs"]["chapterId"]
    assert heading["content"][0]["text"] == target.title
    with postgres.sessions() as session:
        stored = sources.get_source(session, source.project_id, receipt.document_id, 1)
    assert stored.source_id == receipt.source_id
    assert stored.original_version_id == source.receipt.original.id
    assert stored.parse_version_id == source.parse_id
    assert stored.original_sha256 == preview.original_sha256 == source.receipt.original.sha256
    assert stored.manifest_sha256 == preview.manifest_sha256
    assert_original(postgres, source)


def test_same_import_command_concurrently_replays_one_document_and_source(
    postgres: PostgreSQLSandbox,
) -> None:
    source = seed(postgres)
    request = source.request()
    barrier = Barrier(2, timeout=10)

    def execute(_: int) -> DocumentSourceImportReceipt:
        barrier.wait()
        with postgres.sessions() as session:
            return sources.import_source(session, source.project_id, request)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, replay = list(pool.map(execute, [0, 1]))
    assert first == replay
    with postgres.sessions() as session:
        for model in (Document, DocumentVersion, DocumentSource, DocumentSourceVersion):
            assert session.scalar(select(func.count()).select_from(model)) == 1


def test_competing_import_commands_create_exactly_one_formal_document(
    postgres: PostgreSQLSandbox,
) -> None:
    source = seed(postgres)
    barrier = Barrier(2, timeout=10)

    def execute(_: int) -> str:
        request = source.request()
        barrier.wait()
        with postgres.sessions() as session:
            try:
                sources.import_source(session, source.project_id, request)
                return "accepted"
            except AppError as error:
                assert error.code == "DOCUMENT_ALREADY_EXISTS"
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(execute, [0, 1])) == ["accepted", "conflict"]
    with postgres.sessions() as session:
        for model in (Document, DocumentVersion, DocumentSource, DocumentSourceVersion):
            assert session.scalar(select(func.count()).select_from(model)) == 1


def test_reusing_import_command_with_changed_parameters_is_rejected(
    postgres: PostgreSQLSandbox,
) -> None:
    source = seed(postgres)
    request = source.request()
    with postgres.sessions() as session:
        first = sources.import_source(session, source.project_id, request)
    before = current(postgres, source.project_id)
    changed = request.model_copy(update={"parse_version_id": uuid4()})
    with postgres.sessions() as session, pytest.raises(AppError) as caught:
        sources.import_source(session, source.project_id, changed)
    assert caught.value.code == "DOCUMENT_SOURCE_COMMAND_CONFLICT"
    with postgres.sessions() as session:
        assert sources.import_source(session, source.project_id, request) == first
    assert current(postgres, source.project_id) == before


def test_source_mapping_failure_rolls_back_the_entire_initial_import(
    postgres: PostgreSQLSandbox,
) -> None:
    source = seed(postgres)
    request = source.request()

    def fail(_mapper: object, _connection: object, _target: DocumentSourceVersion) -> None:
        raise RuntimeError("synthetic source mapping failure")

    event.listen(DocumentSourceVersion, "before_insert", fail)
    try:
        with postgres.sessions() as session, pytest.raises(RuntimeError, match="synthetic source"):
            sources.import_source(session, source.project_id, request)
    finally:
        event.remove(DocumentSourceVersion, "before_insert", fail)
    with postgres.sessions() as session:
        for model in (Document, DocumentVersion, DocumentSource, DocumentSourceVersion):
            assert session.scalar(select(func.count()).select_from(model)) == 0
    assert_original(postgres, source)
    with postgres.sessions() as session:
        assert sources.import_source(session, source.project_id, request).document_version == 1


def test_import_never_overwrites_an_existing_blank_or_manuscript(
    postgres: PostgreSQLSandbox,
) -> None:
    for blank in (True, False):
        source = seed(postgres)
        with postgres.sessions() as session:
            if blank:
                before = documents.create_blank_document(session, source.project_id)
            else:
                before = documents.import_document(
                    session,
                    source.project_id,
                    DocumentImport.model_validate(
                        {
                            "content": {
                                "schema_version": 1,
                                "json": {
                                    "type": "doc",
                                    "content": [
                                        {
                                            "type": "paragraph",
                                            "content": [{"type": "text", "text": "原有合成正文"}],
                                        }
                                    ],
                                },
                            }
                        }
                    ),
                )
        with postgres.sessions() as session, pytest.raises(AppError) as caught:
            sources.import_source(session, source.project_id, source.request())
        assert caught.value.code == "DOCUMENT_ALREADY_EXISTS"
        assert current(postgres, source.project_id) == before
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(DocumentSource)) == 0


def test_manual_save_adoption_undo_and_revert_each_keep_exact_source_mapping(
    postgres: PostgreSQLSandbox,
) -> None:
    source = seed(postgres)
    receipt = imported(postgres, source)
    first = current(postgres, source.project_id)
    ids = (source.project_id, receipt.document_id)
    with postgres.sessions() as session:
        saved = documents.save_document(
            session, *ids, DocumentSave(expected_version=1, content=editable_change(first))
        )
    root_nodes = saved.content.json_content["content"]
    # Synthetic fixture uses BMP text: preceding heading contributes text + two tokens.
    start = len(root_nodes[0]["content"][0]["text"]) + 3
    assert root_nodes[1]["content"][0]["text"].startswith("本文件")
    with postgres.sessions() as session:
        created = revisions.create_revision(
            session,
            *ids,
            RevisionCreate.model_validate(
                {
                    "command_id": uuid4(),
                    "base_version": 2,
                    "selection": {
                        "textblock_path": [1],
                        "from": start,
                        "to": start + 3,
                        "text": "本文件",
                    },
                    "goal": "仅调整合成句开头措辞",
                }
            ),
        )
    with postgres.sessions() as session:
        candidate = revisions.get_revision(session, *ids, created.candidate_id)
    with postgres.sessions() as session:
        revisions.submit_proposal(
            session,
            *ids,
            candidate.id,
            ProposalInput.model_validate(
                {
                    "command_id": uuid4(),
                    "generation_token": candidate.generation_token,
                    "patches": [
                        {
                            "id": "wording",
                            "from": start,
                            "to": start + 3,
                            "before": "本文件",
                            "after": "该文件",
                        }
                    ],
                }
            ),
        )
    with postgres.sessions() as session:
        revisions.decide_revision(
            session,
            *ids,
            candidate.id,
            RevisionDecide.model_validate(
                {
                    "command_id": uuid4(),
                    "expected_revision": 2,
                    "decisions": [{"patch_id": "wording", "decision": "accepted"}],
                }
            ),
        )
    with postgres.sessions() as session:
        applied = revisions.apply_revision(
            session,
            *ids,
            candidate.id,
            RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=2),
        )
    assert applied.result_version == 3
    with postgres.sessions() as session:
        undone = revisions.undo_revision(
            session,
            *ids,
            applied.command_id,
            RevisionUndo(command_id=uuid4(), expected_document_version=3),
        )
    assert undone.result_version == 4
    with postgres.sessions() as session:
        reverted = revisions.revert_document(
            session,
            *ids,
            RevisionRevert(command_id=uuid4(), expected_document_version=4, target_version=1),
        )
    assert reverted.result_version == 5
    assert current(postgres, source.project_id).content == first.content
    previous_guard = None
    for version in range(1, 6):
        with postgres.sessions() as session:
            stored = sources.get_source(session, *ids, version)
        assert stored.source_id == receipt.source_id
        assert stored.document_version == version
        assert stored.original_version_id == source.receipt.original.id
        assert stored.parse_version_id == source.parse_id
        if previous_guard is not None:
            assert stored.guard_contract == previous_guard
        previous_guard = stored.guard_contract
    assert_original(postgres, source)


def test_locked_objects_and_structure_mutations_do_not_change_the_formal_version(
    postgres: PostgreSQLSandbox,
) -> None:
    source = seed(postgres)
    receipt = imported(postgres, source)
    before = current(postgres, source.project_id)
    mutations = []
    locked = before.content.model_dump(mode="json", by_alias=True)
    locked["json"]["content"][4]["content"][0]["text"] += "不得修改"
    mutations.append(locked)
    removed = before.content.model_dump(mode="json", by_alias=True)
    removed["json"]["content"].pop()
    mutations.append(removed)
    for content in mutations:
        with postgres.sessions() as session, pytest.raises(AppError) as caught:
            documents.save_document(
                session,
                source.project_id,
                receipt.document_id,
                DocumentSave(expected_version=1, content=content),
            )
        assert caught.value.code == "DOCUMENT_SOURCE_PROTECTED"
        assert current(postgres, source.project_id) == before
    assert_original(postgres, source)


def test_chapter_level_and_identity_cannot_be_changed_after_import(
    postgres: PostgreSQLSandbox,
) -> None:
    source = seed(postgres)
    receipt = imported(postgres, source)
    before = current(postgres, source.project_id)
    for key, value in [("level", 6), ("chapterId", "forged-chapter-id")]:
        content = before.content.model_dump(mode="json", by_alias=True)
        content["json"]["content"][0]["attrs"][key] = value
        with postgres.sessions() as session, pytest.raises(AppError) as caught:
            documents.save_document(
                session,
                source.project_id,
                receipt.document_id,
                DocumentSave(expected_version=1, content=content),
            )
        assert caught.value.code == "DOCUMENT_SOURCE_PROTECTED"
        assert current(postgres, source.project_id) == before


def test_cross_project_source_import_and_mapping_reads_are_rejected(
    postgres: PostgreSQLSandbox,
) -> None:
    source = seed(postgres)
    other_project = make_project(postgres)
    with postgres.sessions() as session, pytest.raises(AppError) as caught:
        sources.import_source(session, other_project, source.request())
    assert caught.value.status_code in {404, 422}
    receipt = imported(postgres, source)
    with postgres.sessions() as session, pytest.raises(AppError) as read_error:
        sources.get_source(session, other_project, receipt.document_id, 1)
    assert read_error.value.status_code == 404
    assert current(postgres, source.project_id).version == 1
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Document)) == 1
    assert_original(postgres, source)


def test_source_identity_and_per_version_contracts_are_database_immutable(
    postgres: PostgreSQLSandbox,
) -> None:
    source = seed(postgres)
    receipt = imported(postgres, source)
    with postgres.sessions() as session:
        before = sources.get_source(session, source.project_id, receipt.document_id, 1)
    for statement in [
        update(DocumentSource)
        .where(DocumentSource.id == receipt.source_id)
        .values(original_sha256="0" * 64),
        delete(DocumentSource).where(DocumentSource.id == receipt.source_id),
        update(DocumentSourceVersion)
        .where(DocumentSourceVersion.document_id == receipt.document_id)
        .values(guard_contract={}),
        delete(DocumentSourceVersion).where(
            DocumentSourceVersion.document_id == receipt.document_id
        ),
    ]:
        with postgres.sessions() as session, pytest.raises(DBAPIError), session.begin():
            session.execute(statement)
    with postgres.sessions() as session:
        assert sources.get_source(session, source.project_id, receipt.document_id, 1) == before


def test_append_mapping_failure_rolls_back_document_cas_and_content_together(
    postgres: PostgreSQLSandbox,
) -> None:
    source = seed(postgres)
    receipt = imported(postgres, source)
    before = current(postgres, source.project_id)

    def fail(_mapper: object, _connection: object, target: DocumentSourceVersion) -> None:
        if target.document_version == 2:
            raise RuntimeError("synthetic append mapping failure")

    event.listen(DocumentSourceVersion, "before_insert", fail)
    try:
        with postgres.sessions() as session, pytest.raises(RuntimeError, match="synthetic append"):
            documents.save_document(
                session,
                source.project_id,
                receipt.document_id,
                DocumentSave(expected_version=1, content=editable_change(before)),
            )
    finally:
        event.remove(DocumentSourceVersion, "before_insert", fail)
    assert current(postgres, source.project_id) == before
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(DocumentVersion)) == 1
        assert session.scalar(select(func.count()).select_from(DocumentSourceVersion)) == 1
    assert_original(postgres, source)
