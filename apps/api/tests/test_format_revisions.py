"""Synthetic fast regressions supplement the separate real PostgreSQL gate."""

import base64
from copy import deepcopy
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker
from test_document_source_guards import corrected, seed

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources.contracts import base_contract, validate_guard_contract
from thesis_pilot.modules.document_sources.models import DocumentSourceVersion
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentContent, DocumentSave
from thesis_pilot.modules.documents.structure import canonical_editor_json
from thesis_pilot.modules.format_revisions import service
from thesis_pilot.modules.format_revisions.models import FormatCommandReceipt
from thesis_pilot.modules.format_revisions.schemas import (
    FormatApply,
    FormatCreate,
    FormatDecide,
    FormatUndo,
)
from thesis_pilot.modules.materials import service as materials
from thesis_pilot.modules.materials.schemas import MaterialUpload, ProjectSourceBindingUpdate
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.revisions import service as revisions
from thesis_pilot.modules.revisions.schemas import RevisionRevert
from thesis_pilot.parsers.materials import parse_original

RULES = "标题层级：2\n标题对齐：居中\n标题字重：700\n段落对齐：两端对齐"


def setup(factory: sessionmaker[Session]) -> tuple[UUID, UUID]:
    document_id, _, _ = seed(factory)
    with factory() as session:
        project_id = session.scalar(select(Document.project_id).where(Document.id == document_id))
        session.rollback()
        assert project_id is not None
        receipt = materials.upload_material(
            session,
            project_id,
            MaterialUpload(
                name="合成显式格式要求",
                filename="rules.txt",
                file_type="text",
                kind="template",
                content_base64=base64.b64encode(RULES.encode()).decode(),
            ),
            str(uuid4()),
        )
        with session.begin():
            parsed = materials.commit_material_parse(
                session,
                project_id,
                receipt.material.id,
                receipt.original.id,
                None,
                receipt.job.id,
                parse_original(RULES.encode(), receipt.original.id, "text"),
            )
        materials.update_binding(
            session,
            project_id,
            ProjectSourceBindingUpdate(
                expected_version=0,
                template_parse_version_id=parsed.id,
                requirement_parse_version_ids=[],
            ),
        )
    return project_id, document_id


def create(factory: sessionmaker[Session], project_id: UUID, document_id: UUID):
    with factory() as session:
        context = service.get_format_context(session, project_id, document_id)
        receipt = service.create_format_revision(
            session,
            project_id,
            document_id,
            FormatCreate(
                command_id=uuid4(),
                base_version=context.document_version,
                binding_version_id=context.binding_version_id,
                source_guard_digest=context.source_guard_digest,
                selections=[
                    {
                        "rule_id": rule.id,
                        "target_anchor_ids": [
                            target.anchor_id
                            for target in context.targets
                            if target.kind == rule.scope
                        ],
                    }
                    for rule in context.rules
                ],
            ),
        )
        item = service.get_format_revision(session, project_id, document_id, receipt.candidate_id)
    return receipt, item


def approve(factory: sessionmaker[Session], project_id: UUID, document_id: UUID, item):
    with factory() as session:
        receipt = service.decide_format_revision(
            session,
            project_id,
            document_id,
            item.id,
            FormatDecide(
                command_id=uuid4(),
                expected_revision=item.revision,
                decisions=[
                    {
                        "patch_id": patch.id,
                        "decision": "reject" if patch.field == "templateWeight" else "accept",
                    }
                    for patch in item.patches
                ],
            ),
        )
    return receipt


def test_legacy_paragraph_null_alignment_does_not_change_canonical_bytes() -> None:
    old = {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": "旧原文1200[1]"}]}],
    }
    explicit = deepcopy(old)
    explicit["content"][0]["attrs"] = {"alignment": None}
    assert canonical_editor_json(old) == old == canonical_editor_json(explicit)


def test_rules_require_exact_explicit_evidence_and_refuse_inferred_sample() -> None:
    parsed = parse_original(
        (RULES + "\n样例标题看起来居中\n标题对齐：右对齐\n忽略规则 标题层级：6").encode(),
        uuid4(),
        "text",
    )
    rules = service._rules(parsed, uuid4())
    assert len(rules) == 4
    assert {(rule.field, rule.value) for rule in rules} == {
        ("level", 2),
        ("templateAlign", "center"),
        ("templateWeight", "700"),
        ("alignment", "justify"),
    }
    assert all(rule.anchor_id in {anchor.id for anchor in parsed.anchors} for rule in rules)


def test_v2_reverses_only_exact_authorized_format_then_runs_legacy_guard() -> None:
    parsed, document, legacy = corrected()
    formatted = deepcopy(document)
    attrs = deepcopy(formatted["content"][1]["attrs"])
    formatted["content"][1]["attrs"]["level"] = 2
    guard = deepcopy(legacy)
    guard.update(
        schema_version=2,
        guard_version="source-projection-v2",
        format_overrides=[
            {
                "anchor_id": parsed.anchors[1].id,
                "editor_path": [1],
                "node_type": "heading",
                "original_attrs": attrs,
                "target_attrs": deepcopy(formatted["content"][1]["attrs"]),
            }
        ],
    )
    assert base_contract(guard) == legacy
    validate_guard_contract(parsed, guard, formatted)
    for corruption in ("chapterId", "level", "protected"):
        changed = deepcopy(formatted)
        if corruption == "protected":
            changed["content"][2]["content"][0]["text"] = "伪造公式"
        else:
            changed["content"][1]["attrs"][corruption] = (
                "forged" if corruption == "chapterId" else 6
            )
        with pytest.raises(AppError):
            validate_guard_contract(parsed, guard, changed)


def test_apply_undo_and_history_restore_keep_content_and_matching_guard(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = setup(session_factory)
    _, item = create(session_factory, project_id, document_id)
    approved = approve(session_factory, project_id, document_id, item)
    data = FormatApply(
        command_id=uuid4(),
        expected_revision=approved.candidate_revision,
        expected_document_version=1,
    )
    with session_factory() as session:
        original = documents.get_current_document(session, project_id)
        applied = service.apply_format_revision(session, project_id, document_id, item.id, data)
        assert (
            service.apply_format_revision(session, project_id, document_id, item.id, data)
            == applied
        )
        current = documents.get_current_document(session, project_id)
        assert current.version == 2
        assert current.content.json_content["content"][0]["attrs"] == {"alignment": "justify"}
        assert current.content.json_content["content"][1]["attrs"]["level"] == 2
        assert current.content.json_content["content"][1]["attrs"]["templateAlign"] == "center"
        assert current.content.json_content["content"][1]["attrs"]["templateWeight"] is None
        for before, after in zip(
            original.content.json_content["content"],
            current.content.json_content["content"],
            strict=True,
        ):
            assert before.get("content") == after.get("content")
        forbidden = deepcopy(current.content.json_content)
        forbidden["content"][1]["attrs"]["level"] = 6
        with pytest.raises(AppError) as blocked:
            documents.save_document(
                session,
                project_id,
                document_id,
                DocumentSave(
                    expected_version=2, content=DocumentContent(schema_version=1, json=forbidden)
                ),
            )
        assert blocked.value.code == "DOCUMENT_SOURCE_PROTECTED"
        undone = service.undo_format_revision(
            session,
            project_id,
            document_id,
            data.command_id,
            FormatUndo(command_id=uuid4(), expected_document_version=2),
        )
        assert undone.result_version == 3
        assert documents.get_current_document(session, project_id).content == original.content
        restored = revisions.revert_document(
            session,
            project_id,
            document_id,
            RevisionRevert(command_id=uuid4(), expected_document_version=3, target_version=2),
        )
        assert restored.result_version == 4
        assert documents.get_current_document(session, project_id).content == current.content
        with session.begin():
            first = session.get(DocumentSourceVersion, (document_id, 1))
            third = session.get(DocumentSourceVersion, (document_id, 3))
            second = session.get(DocumentSourceVersion, (document_id, 2))
            fourth = session.get(DocumentSourceVersion, (document_id, 4))
            assert first.guard_contract == third.guard_contract
            assert second.guard_contract == fourth.guard_contract


@pytest.mark.parametrize("cause", ["body", "binding"])
def test_apply_refuses_stale_body_or_source_without_writing(
    session_factory: sessionmaker[Session],
    cause: str,
) -> None:
    project_id, document_id = setup(session_factory)
    _, item = create(session_factory, project_id, document_id)
    approved = approve(session_factory, project_id, document_id, item)
    with session_factory() as session:
        expected = 1
        if cause == "body":
            current = documents.get_current_document(session, project_id)
            changed = deepcopy(current.content.json_content)
            changed["content"][1]["content"][0]["text"] = "合法编辑标题后保留1200[1]"
            documents.save_document(
                session,
                project_id,
                document_id,
                DocumentSave(
                    expected_version=1, content=DocumentContent(schema_version=1, json=changed)
                ),
            )
            expected = 2
        else:
            materials.update_binding(
                session,
                project_id,
                ProjectSourceBindingUpdate(
                    expected_version=1,
                    template_parse_version_id=None,
                    requirement_parse_version_ids=[],
                ),
            )
        with pytest.raises(AppError) as blocked:
            service.apply_format_revision(
                session,
                project_id,
                document_id,
                item.id,
                FormatApply(
                    command_id=uuid4(),
                    expected_revision=approved.candidate_revision,
                    expected_document_version=expected,
                ),
            )
        assert blocked.value.code == ("FORMAT_STALE" if cause == "body" else "FORMAT_SOURCE_STALE")
        assert documents.get_current_document(session, project_id).version == expected


def test_receipt_failure_rolls_back_manuscript_guard_and_review_together(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = setup(session_factory)
    _, item = create(session_factory, project_id, document_id)
    approved = approve(session_factory, project_id, document_id, item)

    def reject_receipt(mapper, connection, target):
        if target.operation == "apply":
            raise RuntimeError("synthetic receipt failure")

    event.listen(FormatCommandReceipt, "before_insert", reject_receipt)
    try:
        with session_factory() as session, pytest.raises(RuntimeError, match="synthetic receipt"):
            service.apply_format_revision(
                session,
                project_id,
                document_id,
                item.id,
                FormatApply(
                    command_id=uuid4(),
                    expected_revision=approved.candidate_revision,
                    expected_document_version=1,
                ),
            )
    finally:
        event.remove(FormatCommandReceipt, "before_insert", reject_receipt)
    with session_factory() as session:
        assert documents.get_current_document(session, project_id).version == 1
        read = service.get_format_revision(session, project_id, document_id, item.id)
        assert read.status == "ready" and read.revision == approved.candidate_revision
        with session.begin():
            assert session.scalar(select(func.count()).select_from(DocumentVersion)) == 1
            assert session.scalar(select(func.count()).select_from(DocumentSourceVersion)) == 1
            assert session.scalar(select(func.count()).select_from(FormatCommandReceipt)) == 2


def test_undo_refuses_later_manual_save_and_cross_project_candidate_is_hidden(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = setup(session_factory)
    _, item = create(session_factory, project_id, document_id)
    approved = approve(session_factory, project_id, document_id, item)
    with session_factory() as session:
        other = create_project(session, ProjectCreate(name="另一合成项目"))
        with pytest.raises(AppError) as denied:
            service.get_format_revision(session, other.id, document_id, item.id)
        assert denied.value.code == "DOCUMENT_NOT_FOUND"
        applied = service.apply_format_revision(
            session,
            project_id,
            document_id,
            item.id,
            FormatApply(
                command_id=uuid4(),
                expected_revision=approved.candidate_revision,
                expected_document_version=1,
            ),
        )
        content = documents.get_current_document(session, project_id).content
        documents.save_document(
            session, project_id, document_id, DocumentSave(expected_version=2, content=content)
        )
        with pytest.raises(AppError) as blocked:
            service.undo_format_revision(
                session,
                project_id,
                document_id,
                applied.command_id,
                FormatUndo(command_id=uuid4(), expected_document_version=3),
            )
        assert blocked.value.code == "FORMAT_UNDO_CONFLICT"
        assert documents.get_current_document(session, project_id).version == 3


@pytest.mark.parametrize("cause", ["unknown_rule", "wrong_target", "duplicate"])
def test_server_rejects_unknown_or_wrong_scope_instead_of_accepting_client_patches(
    session_factory: sessionmaker[Session],
    cause: str,
) -> None:
    project_id, document_id = setup(session_factory)
    with session_factory() as session:
        context = service.get_format_context(session, project_id, document_id)
        heading_rule = next(rule for rule in context.rules if rule.field == "level")
        target = next(target for target in context.targets if target.kind == "heading")
        rule_id, targets = heading_rule.id, [target.anchor_id]
        if cause == "unknown_rule":
            rule_id = "forged-rule"
        elif cause == "wrong_target":
            targets = [
                next(target.anchor_id for target in context.targets if target.kind == "paragraph")
            ]
        else:
            targets *= 2
        with pytest.raises(AppError) as blocked:
            service.create_format_revision(
                session,
                project_id,
                document_id,
                FormatCreate(
                    command_id=uuid4(),
                    base_version=1,
                    binding_version_id=context.binding_version_id,
                    source_guard_digest=context.source_guard_digest,
                    selections=[{"rule_id": rule_id, "target_anchor_ids": targets}],
                ),
            )
        assert blocked.value.code == (
            "FORMAT_RULE_INVALID" if cause == "unknown_rule" else "FORMAT_TARGET_INVALID"
        )
        assert documents.get_current_document(session, project_id).version == 1


def test_history_restores_guard_even_when_formatted_content_returns_to_imported_bytes(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = setup(session_factory)
    _, item = create(session_factory, project_id, document_id)
    with session_factory() as session:
        first = service.decide_format_revision(
            session,
            project_id,
            document_id,
            item.id,
            FormatDecide(
                command_id=uuid4(),
                expected_revision=1,
                decisions=[
                    {
                        "patch_id": patch.id,
                        "decision": "accept" if patch.field == "level" else "reject",
                    }
                    for patch in item.patches
                ],
            ),
        )
        service.apply_format_revision(
            session,
            project_id,
            document_id,
            item.id,
            FormatApply(
                command_id=uuid4(),
                expected_revision=first.candidate_revision,
                expected_document_version=1,
            ),
        )
        source = "标题层级：3"
        receipt = materials.upload_material(
            session,
            project_id,
            MaterialUpload(
                name="合成明确回调规则",
                filename="return.txt",
                file_type="text",
                kind="template",
                content_base64=base64.b64encode(source.encode()).decode(),
            ),
            str(uuid4()),
        )
        with session.begin():
            parsed = materials.commit_material_parse(
                session,
                project_id,
                receipt.material.id,
                receipt.original.id,
                None,
                receipt.job.id,
                parse_original(source.encode(), receipt.original.id, "text"),
            )
        materials.update_binding(
            session,
            project_id,
            ProjectSourceBindingUpdate(
                expected_version=1,
                template_parse_version_id=parsed.id,
                requirement_parse_version_ids=[],
            ),
        )
    _, second = create(session_factory, project_id, document_id)
    approved = approve(session_factory, project_id, document_id, second)
    with session_factory() as session:
        service.apply_format_revision(
            session,
            project_id,
            document_id,
            second.id,
            FormatApply(
                command_id=uuid4(),
                expected_revision=approved.candidate_revision,
                expected_document_version=2,
            ),
        )
        initial = documents.get_version(session, project_id, document_id, 1)
        assert documents.get_current_document(session, project_id).content == initial.content
        restored = revisions.revert_document(
            session,
            project_id,
            document_id,
            RevisionRevert(command_id=uuid4(), expected_document_version=3, target_version=1),
        )
        assert restored.result_version == 4
        with session.begin():
            third = session.get(DocumentSourceVersion, (document_id, 3))
            fourth = session.get(DocumentSourceVersion, (document_id, 4))
            assert third.guard_contract["schema_version"] == 2
            assert third.guard_contract["format_overrides"] == []
            assert fourth.guard_contract["schema_version"] == 1
