"""SG-19 source-bound formatting, recovery and transaction tests on PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import delete, event, func, select, update
from sqlalchemy.exc import DBAPIError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources import service as sources
from thesis_pilot.modules.document_sources.contracts import base_contract, node_at
from thesis_pilot.modules.document_sources.guards import GuardTransition
from thesis_pilot.modules.document_sources.models import DocumentSourceVersion
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentContent, DocumentSave
from thesis_pilot.modules.format_revisions import service as formatting
from thesis_pilot.modules.format_revisions.models import FormatCandidate, FormatCommandReceipt
from thesis_pilot.modules.format_revisions.schemas import (
    FormatApply,
    FormatCreate,
    FormatDecide,
    FormatUndo,
)
from thesis_pilot.modules.materials import service as materials
from thesis_pilot.modules.materials.schemas import ProjectSourceBindingUpdate
from thesis_pilot.modules.revisions import service as revisions
from thesis_pilot.modules.revisions.schemas import RevisionRevert

from .conftest import PostgreSQLSandbox
from .test_document_sources import current, editable_change, imported, seed
from .test_materials import finish_parse, payload, upload

pytestmark = pytest.mark.integration
RULES = "标题层级：2\n标题对齐：居中\n标题字重：700\n段落对齐：两端对齐\n"


def configured(postgres: PostgreSQLSandbox):
    source = seed(postgres)
    document = imported(postgres, source)
    template = upload(postgres, source.project_id, payload(RULES, kind="template"))
    parsed = finish_parse(postgres, template.job.id)
    with postgres.sessions() as session:
        binding = materials.update_binding(
            session,
            source.project_id,
            ProjectSourceBindingUpdate(
                expected_version=0,
                template_parse_version_id=parsed.id,
                requirement_parse_version_ids=[],
            ),
        )
    return source, document, binding


def request_for(context) -> FormatCreate:
    heading = next(target for target in context.targets if target.kind == "heading")
    return FormatCreate.model_validate(
        {
            "command_id": uuid4(),
            "base_version": context.document_version,
            "binding_version_id": context.binding_version_id,
            "source_guard_digest": context.source_guard_digest,
            "selections": [
                {"rule_id": rule.id, "target_anchor_ids": [heading.anchor_id]}
                for rule in context.rules
                if rule.scope == "heading"
            ],
        }
    )


def candidate(postgres: PostgreSQLSandbox, ids: tuple):
    with postgres.sessions() as session:
        context = formatting.get_format_context(session, *ids)
        receipt = formatting.create_format_revision(session, *ids, request_for(context))
        return formatting.get_format_revision(session, *ids, receipt.candidate_id)


def decided(postgres: PostgreSQLSandbox, ids: tuple):
    item = candidate(postgres, ids)
    with postgres.sessions() as session:
        formatting.decide_format_revision(
            session,
            *ids,
            item.id,
            FormatDecide.model_validate(
                {
                    "command_id": uuid4(),
                    "expected_revision": item.revision,
                    "decisions": [
                        {"patch_id": patch.id, "decision": "accept"} for patch in item.patches
                    ],
                }
            ),
        )
        return formatting.get_format_revision(session, *ids, item.id)


def test_old_source_projection_supports_text_edit_but_rejects_unapproved_format_transition(
    postgres: PostgreSQLSandbox,
) -> None:
    source, receipt, _ = configured(postgres)
    ids = source.project_id, receipt.document_id
    original = current(postgres, source.project_id)
    with postgres.sessions() as session:
        guard = sources.get_source(session, *ids, 1)
    assert guard.guard_version == "source-projection-v1"
    assert guard.guard_contract["schema_version"] == 1
    changed = original.content.model_dump(mode="json", by_alias=True)
    changed["json"]["content"][0]["attrs"]["level"] = 2
    with postgres.sessions() as session, pytest.raises(AppError) as ordinary:
        documents.save_document(session, *ids, DocumentSave(expected_version=1, content=changed))
    assert ordinary.value.code == "DOCUMENT_SOURCE_PROTECTED"
    with postgres.sessions() as session, pytest.raises(AppError) as forged, session.begin():
        documents.append_guarded_document_version(
            session,
            *ids,
            1,
            DocumentContent.model_validate(changed),
            "manual_edit",
            GuardTransition(ids[1], 1, guard.guard_contract, object()),
        )
    assert forged.value.code == "DOCUMENT_SOURCE_GUARD_INVALID"
    assert current(postgres, source.project_id).version == 1
    with postgres.sessions() as session:
        edited = documents.save_document(
            session, *ids, DocumentSave(expected_version=1, content=editable_change(original))
        )
        after = sources.get_source(session, *ids, 2)
    assert edited.version == 2 and after.guard_contract == guard.guard_contract


def test_partial_decisions_apply_once_then_undo_and_restore_across_guard_versions(
    postgres: PostgreSQLSandbox,
) -> None:
    source, receipt, _ = configured(postgres)
    ids = source.project_id, receipt.document_id
    before = current(postgres, source.project_id)
    item = candidate(postgres, ids)
    assert len(item.patches) == 3
    accepted = next(patch for patch in item.patches if patch.field == "level")
    with postgres.sessions() as session:
        formatting.decide_format_revision(
            session,
            *ids,
            item.id,
            FormatDecide.model_validate(
                {
                    "command_id": uuid4(),
                    "expected_revision": 1,
                    "decisions": [{"patch_id": accepted.id, "decision": "accept"}],
                }
            ),
        )
    with postgres.sessions() as session, pytest.raises(AppError) as pending:
        formatting.apply_format_revision(
            session,
            *ids,
            item.id,
            FormatApply(command_id=uuid4(), expected_revision=2, expected_document_version=1),
        )
    assert pending.value.code == "FORMAT_DECISION_REQUIRED"
    with postgres.sessions() as session:
        formatting.decide_format_revision(
            session,
            *ids,
            item.id,
            FormatDecide.model_validate(
                {
                    "command_id": uuid4(),
                    "expected_revision": 2,
                    "decisions": [
                        {"patch_id": patch.id, "decision": "reject"}
                        for patch in item.patches
                        if patch.id != accepted.id
                    ],
                }
            ),
        )
    command = FormatApply(command_id=uuid4(), expected_revision=3, expected_document_version=1)
    barrier = Barrier(2, timeout=10)

    def apply(_: int):
        barrier.wait()
        with postgres.sessions() as session:
            return formatting.apply_format_revision(session, *ids, item.id, command)

    with ThreadPoolExecutor(max_workers=2) as pool:
        applied, replay = pool.map(apply, range(2))
    assert applied == replay and applied.result_version == 2
    with postgres.sessions() as session, pytest.raises(AppError) as reused:
        formatting.apply_format_revision(
            session, *ids, item.id, command.model_copy(update={"expected_revision": 2})
        )
    assert reused.value.code == "FORMAT_COMMAND_CONFLICT"
    expected = deepcopy(before.content.json_content)
    node_at(expected, accepted.editor_path)["attrs"][accepted.field] = accepted.after
    with postgres.sessions() as session:
        actual = documents.get_current_document(session, source.project_id)
        assert actual.content.json_content == expected
        assert (
            actual.content.json_content["content"][4] == before.content.json_content["content"][4]
        )
        first = sources.get_source(session, *ids, 1)
        second = sources.get_source(session, *ids, 2)
        assert second.guard_version == "source-projection-v2"
        assert base_contract(second.guard_contract) == first.guard_contract
        undone = formatting.undo_format_revision(
            session,
            *ids,
            applied.command_id,
            FormatUndo(command_id=uuid4(), expected_document_version=2),
        )
        assert undone.result_version == 3
        assert documents.get_version(session, *ids, 3).content == before.content
        assert sources.get_source(session, *ids, 3).guard_contract == first.guard_contract
        restored = revisions.revert_document(
            session,
            *ids,
            RevisionRevert(command_id=uuid4(), expected_document_version=3, target_version=2),
        )
        assert restored.result_version == 4
        assert documents.get_version(session, *ids, 4).content.json_content == expected
        assert sources.get_source(session, *ids, 4).guard_contract == second.guard_contract
        revisions.revert_document(
            session,
            *ids,
            RevisionRevert(command_id=uuid4(), expected_document_version=4, target_version=1),
        )
        assert documents.get_version(session, *ids, 5).content == before.content
        assert sources.get_source(session, *ids, 5).guard_contract == first.guard_contract
    with postgres.sessions() as session, pytest.raises(AppError) as old_undo:
        formatting.undo_format_revision(
            session,
            *ids,
            applied.command_id,
            FormatUndo(command_id=uuid4(), expected_document_version=5),
        )
    assert old_undo.value.code == "FORMAT_UNDO_CONFLICT"


def test_fixed_binding_document_version_and_project_scope_are_rechecked(
    postgres: PostgreSQLSandbox,
) -> None:
    source, receipt, binding = configured(postgres)
    ids = source.project_id, receipt.document_id
    item = decided(postgres, ids)
    with postgres.sessions() as session:
        context = formatting.get_format_context(session, *ids)
        materials.update_binding(
            session,
            ids[0],
            ProjectSourceBindingUpdate(
                expected_version=binding.version,
                template_parse_version_id=binding.template_parse_version_id,
                requirement_parse_version_ids=[],
            ),
        )
    with postgres.sessions() as session, pytest.raises(AppError) as create_stale:
        formatting.create_format_revision(session, *ids, request_for(context))
    assert create_stale.value.code == "FORMAT_SOURCE_STALE"
    with postgres.sessions() as session, pytest.raises(AppError) as apply_stale:
        formatting.apply_format_revision(
            session,
            *ids,
            item.id,
            FormatApply(command_id=uuid4(), expected_revision=2, expected_document_version=1),
        )
    assert apply_stale.value.code == "FORMAT_SOURCE_STALE"
    fresh = decided(postgres, ids)
    original = current(postgres, ids[0])
    with postgres.sessions() as session:
        documents.save_document(
            session, *ids, DocumentSave(expected_version=1, content=editable_change(original))
        )
    with postgres.sessions() as session, pytest.raises(AppError) as body_stale:
        formatting.apply_format_revision(
            session,
            *ids,
            fresh.id,
            FormatApply(command_id=uuid4(), expected_revision=2, expected_document_version=2),
        )
    assert body_stale.value.code == "FORMAT_STALE"
    other = seed(postgres)
    with postgres.sessions() as session, pytest.raises(AppError) as foreign:
        formatting.get_format_revision(session, other.project_id, ids[1], fresh.id)
    assert foreign.value.code == "DOCUMENT_NOT_FOUND"
    with postgres.sessions() as session:
        assert documents.get_current_document(session, ids[0]).version == 2
        assert formatting.get_format_revision(session, *ids, fresh.id).status == "ready"


def test_command_failure_rolls_back_document_guard_candidate_and_receipt_together(
    postgres: PostgreSQLSandbox,
) -> None:
    source, receipt, _ = configured(postgres)
    ids = source.project_id, receipt.document_id
    item = decided(postgres, ids)
    command = FormatApply(command_id=uuid4(), expected_revision=2, expected_document_version=1)

    def fail(mapper, connection, target):
        if target.operation == "apply":
            raise RuntimeError("synthetic format receipt failure")

    event.listen(FormatCommandReceipt, "before_insert", fail)
    try:
        with postgres.sessions() as session, pytest.raises(RuntimeError, match="synthetic"):
            formatting.apply_format_revision(session, *ids, item.id, command)
    finally:
        event.remove(FormatCommandReceipt, "before_insert", fail)
    with postgres.sessions() as session:
        assert documents.get_current_document(session, ids[0]).version == 1
        assert formatting.get_format_revision(session, *ids, item.id) == item
        for model in (DocumentVersion, DocumentSourceVersion):
            assert session.scalar(select(func.count()).select_from(model)) == 1
        assert session.scalar(select(func.count()).select_from(FormatCommandReceipt)) == 2
    with postgres.sessions() as session:
        assert formatting.apply_format_revision(session, *ids, item.id, command).result_version == 2
    engine = postgres.sessions.kw["bind"]
    for statement in (
        update(FormatCandidate).where(FormatCandidate.id == item.id).values(patches_json=[]),
        update(FormatCandidate).where(FormatCandidate.id == item.id).values(source_snapshot={}),
        delete(FormatCommandReceipt).where(FormatCommandReceipt.document_id == ids[1]),
    ):
        with pytest.raises(DBAPIError), engine.begin() as connection:
            connection.execute(statement)
