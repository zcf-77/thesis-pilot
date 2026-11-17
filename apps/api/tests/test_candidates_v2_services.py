"""v2 content and format candidates through the real command services (SQLite fast gate).

Covers adoption into a new v2 version, undo, idempotent replays, staleness after a
manual save or a schema upgrade, refused patch shapes, overlap and protection failures
that never write, and source-guarded format adoption on an upgraded original.
"""

from copy import deepcopy
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker
from test_format_revisions import RULES, setup

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources.models import DocumentSourceVersion
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.docs_model import JsonDict, atom_text, find_block
from thesis_pilot.modules.documents.models import DocumentVersion
from thesis_pilot.modules.documents.schemas import (
    DocumentImport,
    DocumentSave,
    DocumentSchemaUpgradeCreate,
)
from thesis_pilot.modules.format_revisions import service as formats
from thesis_pilot.modules.format_revisions.schemas import (
    FormatApply,
    FormatCreate,
    FormatDecide,
    FormatUndo,
)
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.revisions import service
from thesis_pilot.modules.revisions.schemas import (
    POLICY_VERSION_V2,
    RevisionApply,
    RevisionCreate,
    RevisionDecide,
    RevisionNodePatch,
    RevisionNodeSelection,
    RevisionUndo,
)
from thesis_pilot.modules.revisions.schemas import RevisionProposal as ProposalInput

TEXT = "本研究采用方法甲完成实验，锁定结论不变。"
LOCKED = "锁定结论不变"


def snapshot(text: str = TEXT) -> dict[str, Any]:
    start = text.index(LOCKED) if LOCKED in text else None
    protections = (
        [{"id": "lk", "kind": "lock", "anchor": {"node": "p1", "start": start, "end": start + 6}}]
        if start is not None
        else []
    )
    return {
        "schemaVersion": 2,
        "model": {
            "kind": "docs",
            "schemaVersion": 1,
            "id": "doc",
            "theme": {"name": "minimal"},
            "sections": [
                {
                    "id": "s1",
                    "blocks": [
                        {
                            "type": "heading",
                            "id": "h1",
                            "level": 1,
                            "inlines": [{"type": "run", "text": "绪论"}],
                        },
                        {
                            "type": "paragraph",
                            "id": "p1",
                            "inlines": [{"type": "run", "text": text}],
                        },
                    ],
                }
            ],
        },
        "protections": protections,
    }


def seeded(factory: sessionmaker[Session]) -> tuple[UUID, UUID]:
    with factory() as session:
        project = create_project(session, ProjectCreate(name="v2 候选自制项目"))
        document = documents.import_document(
            session,
            project.id,
            DocumentImport.model_validate({"content": {"schema_version": 2, "json": snapshot()}}),
        )
    return project.id, document.id


def selection(part: str, node: str = "p1", text: str = TEXT) -> dict[str, Any]:
    start = text.index(part)
    return {"node_id": node, "start": start, "end": start + len(part), "expected_text": part}


def candidate(
    factory: sessionmaker[Session],
    ids: tuple[UUID, UUID],
    patches: list[dict[str, Any]],
    *,
    part: str = "采用方法甲",
    base_version: int = 1,
    accept: bool = True,
) -> UUID:
    project_id, document_id = ids
    with factory() as session:
        created = service.create_revision(
            session,
            project_id,
            document_id,
            RevisionCreate.model_validate(
                {
                    "command_id": str(uuid4()),
                    "base_version": base_version,
                    "selection": selection(part),
                    "goal": "改写更准确",
                }
            ),
        )
        assert created.candidate_id is not None
        item = service.get_revision(session, project_id, document_id, created.candidate_id)
        assert item.content_schema_version == 2
        service.submit_proposal(
            session,
            project_id,
            document_id,
            item.id,
            ProposalInput.model_validate(
                {
                    "command_id": str(uuid4()),
                    "generation_token": str(item.generation_token),
                    "patches": patches,
                }
            ),
        )
        if accept:
            service.decide_revision(
                session,
                project_id,
                document_id,
                item.id,
                RevisionDecide.model_validate(
                    {
                        "command_id": str(uuid4()),
                        "expected_revision": 2,
                        "decisions": [
                            {"patch_id": patch["id"], "decision": "accepted"} for patch in patches
                        ],
                    }
                ),
            )
        return item.id


def node_patch(pid: str, part: str, after: str, text: str = TEXT) -> dict[str, Any]:
    start = text.index(part)
    return {"id": pid, "start": start, "end": start + len(part), "before": part, "after": after}


def versions(factory: sessionmaker[Session], document_id: UUID) -> int:
    with factory() as session:
        return (
            session.scalar(
                select(func.count())
                .select_from(DocumentVersion)
                .where(DocumentVersion.document_id == document_id)
            )
            or 0
        )


def paragraph_text(factory: sessionmaker[Session], document_id: UUID, number: int) -> str:
    with factory() as session:
        row = session.get(DocumentVersion, (document_id, number))
        assert row is not None and row.schema_version == 2
        block = find_block(cast(JsonDict, row.content_json["model"]), "p1")
        assert block is not None
        return atom_text(cast(list[JsonDict], block["inlines"]))


def apply(
    factory: sessionmaker[Session],
    ids: tuple[UUID, UUID],
    item_id: UUID,
    *,
    revision: int = 3,
    document_version: int = 1,
    command_id: UUID | None = None,
):
    project_id, document_id = ids
    with factory() as session:
        return service.apply_revision(
            session,
            project_id,
            document_id,
            item_id,
            RevisionApply(
                command_id=command_id or uuid4(),
                expected_revision=revision,
                expected_document_version=document_version,
            ),
        )


def test_v2_candidate_adopts_into_new_version_and_undoes(
    session_factory: sessionmaker[Session],
) -> None:
    ids = seeded(session_factory)
    project_id, document_id = ids
    item_id = candidate(session_factory, ids, [node_patch("p1", "采用方法甲", "使用方法乙")])
    with session_factory() as session:
        read = service.get_revision(session, project_id, document_id, item_id)
    assert read.applicable and read.policy_version == POLICY_VERSION_V2
    assert all(check.result == "pass" for check in read.checks)
    command_id = uuid4()
    receipt = apply(session_factory, ids, item_id, command_id=command_id)
    assert receipt.result_version == 2
    replay = apply(session_factory, ids, item_id, command_id=command_id)
    assert replay == receipt and versions(session_factory, document_id) == 2
    assert paragraph_text(session_factory, document_id, 2) == TEXT.replace(
        "采用方法甲", "使用方法乙"
    )
    with session_factory() as session:
        row = session.get(DocumentVersion, (document_id, 2))
        assert row is not None and row.source == "ai_adoption"
        lock = row.content_json["protections"][0]["anchor"]
        assert paragraph_text(session_factory, document_id, 2)[lock["start"] : lock["end"]] == (
            LOCKED
        )
        session.rollback()
        undone = service.undo_revision(
            session,
            project_id,
            document_id,
            receipt.command_id,
            RevisionUndo(command_id=uuid4(), expected_document_version=2),
        )
    assert undone.result_version == 3
    assert paragraph_text(session_factory, document_id, 3) == TEXT


def test_stale_and_concurrent_candidates_never_write(
    session_factory: sessionmaker[Session],
) -> None:
    ids = seeded(session_factory)
    project_id, document_id = ids
    first = candidate(session_factory, ids, [node_patch("p1", "采用", "使用")])
    second = candidate(session_factory, ids, [node_patch("p1", "方法甲", "方法乙")])
    apply(session_factory, ids, first)
    with pytest.raises(AppError) as captured:
        apply(session_factory, ids, second, document_version=2)
    assert captured.value.code == "REVISION_STALE"
    with session_factory() as session:
        documents.save_document(
            session,
            project_id,
            document_id,
            DocumentSave.model_validate(
                {
                    "expected_version": 2,
                    "content": {"schema_version": 2, "json": snapshot("新的手动正文。")},
                }
            ),
        )
    assert versions(session_factory, document_id) == 3
    with pytest.raises(AppError) as captured:
        candidate(session_factory, ids, [node_patch("p1", "采用", "使用")], base_version=3)
    assert captured.value.code == "REVISION_ANCHOR_INVALID"
    assert versions(session_factory, document_id) == 3


@pytest.mark.parametrize(
    ("patches", "code"),
    [
        (
            [node_patch("a", "采用方法", "使用方法"), node_patch("b", "方法甲", "方法乙")],
            "REVISION_PATCH_INVALID",
        ),
        ([node_patch("a", "采用方法甲完成实验，锁定", "使用方法甲完成实验，改定")], None),
        ([node_patch("a", "采用", "使\n用")], "REVISION_PROTECTION_FAILED"),
    ],
    ids=["overlap", "lock-outside-selection", "line-break"],
)
def test_invalid_candidates_refuse_acceptance(
    session_factory: sessionmaker[Session], patches: list[dict[str, Any]], code: str | None
) -> None:
    ids = seeded(session_factory)
    project_id, document_id = ids
    part = "采用方法甲完成实验，锁定" if code is None else "采用方法甲"
    if code is None:
        # The selection itself covers the locked span: lock fails, range passes.
        code = "REVISION_PROTECTION_FAILED"
    item_id = candidate(session_factory, ids, patches, part=part, accept=False)
    with session_factory() as session:
        read = service.get_revision(session, project_id, document_id, item_id)
        assert read.status == "invalid" and not read.applicable
        with pytest.raises(AppError) as captured:
            service.decide_revision(
                session,
                project_id,
                document_id,
                item_id,
                RevisionDecide.model_validate(
                    {
                        "command_id": str(uuid4()),
                        "expected_revision": 2,
                        "decisions": [
                            {"patch_id": patch["id"], "decision": "accepted"} for patch in patches
                        ],
                    }
                ),
            )
    assert captured.value.code == code
    assert versions(session_factory, document_id) == 1


def test_patch_shape_must_match_selection_schema(session_factory: sessionmaker[Session]) -> None:
    ids = seeded(session_factory)
    with pytest.raises(AppError) as captured:
        candidate(
            session_factory,
            ids,
            [{"id": "p1", "from": 4, "to": 6, "before": "采用", "after": "使用"}],
            part="采用",
        )
    assert captured.value.code == "REVISION_PATCH_INVALID"


def test_v1_selection_on_v2_version_is_a_schema_mismatch(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = seeded(session_factory)
    with session_factory() as session, pytest.raises(AppError) as captured:
        service.create_revision(
            session,
            project_id,
            document_id,
            RevisionCreate.model_validate(
                {
                    "command_id": str(uuid4()),
                    "base_version": 1,
                    "selection": {"textblock_path": [1], "from": 4, "to": 6, "text": "采用"},
                    "goal": "改写",
                }
            ),
        )
    assert captured.value.code == "DOCMODEL_ANCHOR_SCHEMA_MISMATCH"


def test_v1_candidate_is_stale_after_schema_upgrade(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        project = create_project(session, ProjectCreate(name="升级后过期项目"))
        document = documents.import_document(
            session,
            project.id,
            DocumentImport.model_validate(
                {
                    "content": {
                        "schema_version": 1,
                        "json": {
                            "type": "doc",
                            "content": [
                                {"type": "paragraph", "content": [{"type": "text", "text": TEXT}]}
                            ],
                        },
                    }
                }
            ),
        )
        created = service.create_revision(
            session,
            project.id,
            document.id,
            RevisionCreate.model_validate(
                {
                    "command_id": str(uuid4()),
                    "base_version": 1,
                    "selection": {"textblock_path": [0], "from": 4, "to": 6, "text": "采用"},
                    "goal": "改写",
                }
            ),
        )
        assert created.candidate_id is not None
        item = service.get_revision(session, project.id, document.id, created.candidate_id)
        service.submit_proposal(
            session,
            project.id,
            document.id,
            item.id,
            ProposalInput.model_validate(
                {
                    "command_id": str(uuid4()),
                    "generation_token": str(item.generation_token),
                    "patches": [
                        {"id": "p1", "from": 4, "to": 6, "before": "采用", "after": "使用"}
                    ],
                }
            ),
        )
        documents.upgrade_schema(
            session,
            project.id,
            document.id,
            DocumentSchemaUpgradeCreate(command_id=uuid4(), expected_version=1),
        )
        read = service.get_revision(session, project.id, document.id, item.id)
        assert read.content_schema_version == 1 and not read.applicable
        with pytest.raises(AppError) as captured:
            service.decide_revision(
                session,
                project.id,
                document.id,
                item.id,
                RevisionDecide.model_validate(
                    {
                        "command_id": str(uuid4()),
                        "expected_revision": 2,
                        "decisions": [{"patch_id": "p1", "decision": "accepted"}],
                    }
                ),
            )
    assert captured.value.code == "REVISION_STALE"


# ---------- format candidates on an upgraded imported original ----------


def test_v2_format_candidate_adopts_through_internal_guard_and_undoes(
    session_factory: sessionmaker[Session],
) -> None:
    assert "标题层级" in RULES
    project_id, document_id = setup(session_factory)
    with session_factory() as session:
        documents.upgrade_schema(
            session,
            project_id,
            document_id,
            DocumentSchemaUpgradeCreate(command_id=uuid4(), expected_version=1),
        )
        context = formats.get_format_context(session, project_id, document_id)
    assert context.content_schema_version == 2 and context.document_version == 2
    assert context.targets and all(t.node_id and t.editor_path is None for t in context.targets)
    assert all(rule.field != "templateWeight" for rule in context.rules)
    with session_factory() as session:
        receipt = formats.create_format_revision(
            session,
            project_id,
            document_id,
            FormatCreate(
                command_id=uuid4(),
                base_version=2,
                binding_version_id=context.binding_version_id,
                source_guard_digest=context.source_guard_digest,
                selections=[
                    {
                        "rule_id": rule.id,
                        "target_anchor_ids": [
                            t.anchor_id for t in context.targets if t.kind == rule.scope
                        ],
                    }
                    for rule in context.rules
                ],
            ),
        )
        item = formats.get_format_revision(session, project_id, document_id, receipt.candidate_id)
    assert item.content_schema_version == 2 and item.applicable
    assert all(patch.node_id for patch in item.patches)
    assert {patch.field for patch in item.patches} <= {"level", "templateAlign", "alignment"}
    assert all(
        patch.after in {"start", "center", "end", "justify"}
        for patch in item.patches
        if patch.field != "level"
    )
    with session_factory() as session:
        formats.decide_format_revision(
            session,
            project_id,
            document_id,
            item.id,
            FormatDecide(
                command_id=uuid4(),
                expected_revision=item.revision,
                decisions=[{"patch_id": p.id, "decision": "accept"} for p in item.patches],
            ),
        )
        applied = formats.apply_format_revision(
            session,
            project_id,
            document_id,
            item.id,
            FormatApply(
                command_id=uuid4(), expected_revision=item.revision + 1, expected_document_version=2
            ),
        )
    assert applied.result_version == 3
    with session_factory() as session:
        row = session.get(DocumentVersion, (document_id, 3))
        assert row is not None and row.schema_version == 2
        model = cast(JsonDict, row.content_json["model"])
        for patch in item.patches:
            block = find_block(model, cast(str, patch.node_id))
            assert block is not None
            if patch.field == "level":
                assert block["level"] == patch.after
            else:
                assert cast(JsonDict, block["props"])["align"] == patch.after
        mapping = session.get(DocumentSourceVersion, (document_id, 3))
        previous = session.get(DocumentSourceVersion, (document_id, 2))
        assert mapping is not None and previous is not None
        assert mapping.guard_contract["editable_nodes"] == previous.guard_contract["editable_nodes"]
        assert (
            mapping.guard_contract["skeleton_sha256"] != previous.guard_contract["skeleton_sha256"]
        )
        session.rollback()
        undone = formats.undo_format_revision(
            session,
            project_id,
            document_id,
            applied.command_id,
            FormatUndo(command_id=uuid4(), expected_document_version=3),
        )
        assert undone.result_version == 4
        restored = session.get(DocumentVersion, (document_id, 4))
        original = session.get(DocumentVersion, (document_id, 2))
        assert restored is not None and original is not None
        assert restored.content_json == original.content_json
        # An ordinary save still cannot change formatting of the imported original.
        changed = deepcopy(restored.content_json)
        session.rollback()
        model = cast(JsonDict, changed["model"])
        heading = next(
            block
            for block in cast(list[JsonDict], cast(list[JsonDict], model["sections"])[0]["blocks"])
            if block["type"] == "heading"
        )
        heading["level"] = 6 if heading["level"] != 6 else 5
        with pytest.raises(AppError) as captured:
            documents.save_document(
                session,
                project_id,
                document_id,
                DocumentSave.model_validate(
                    {"expected_version": 4, "content": {"schema_version": 2, "json": changed}}
                ),
            )
    assert captured.value.code == "DOCUMENT_SOURCE_PROTECTED"


# ---------- model-run candidates and task evidence on v2 ----------


def reserve_model_run(
    factory: sessionmaker[Session], ids: tuple[UUID, UUID], part: str
) -> tuple[UUID, UUID]:
    from thesis_pilot.modules.assistant_sessions.models import (
        AssistantMessage,
        AssistantRun,
        AssistantSession,
    )

    project_id, document_id = ids
    chosen = RevisionNodeSelection.model_validate(selection(part))
    with factory() as session, session.begin():
        conversation = AssistantSession(project_id=project_id, title="自制会话", role="content")
        session.add(conversation)
        session.flush()
        message = AssistantMessage(session_id=conversation.id, seq=1, role="user", content="改写")
        session.add(message)
        session.flush()
        run = AssistantRun(
            project_id=project_id,
            session_id=conversation.id,
            purpose="content_revision",
            document_id=document_id,
            document_version=1,
            trigger_message_id=message.id,
            command_id=uuid4(),
            request_hash="b" * 64,
            input_snapshot={
                "document_id": str(document_id),
                "document_version": 1,
                "selection": chosen.model_dump(mode="json"),
                "goal": "改写",
                "material_sources": [],
                "agent_config_version_id": str(uuid4()),
                "source_binding_version_id": None,
            },
            context_snapshot={},
            configuration_snapshot={},
        )
        session.add(run)
        session.flush()
        item = service.create_model_revision_in_transaction(
            session, project_id, document_id, 1, chosen, "改写", run.id
        )
        run.candidate_id = item.id
        session.flush()
        return run.id, item.id


def test_model_run_v2_patch_is_built_by_server_and_adoption_stays_gated(
    session_factory: sessionmaker[Session],
) -> None:
    ids = seeded(session_factory)
    project_id, document_id = ids
    run_id, candidate_id = reserve_model_run(session_factory, ids, "采用方法甲")
    with session_factory() as session, session.begin():
        result = service.submit_model_proposal_in_transaction(
            session, project_id, document_id, candidate_id, run_id, "使用方法乙"
        )
    patch = result.patches[0]
    assert result.content_schema_version == 2
    assert isinstance(patch, RevisionNodePatch)
    assert (patch.start, patch.end, patch.before) == (3, 8, "采用方法甲")
    assert result.status == "ready" and not result.applicable
    assert result.adoption_blocked_reason == "REVISION_ADOPTION_NOT_APPROVED"
    run_id, candidate_id = reserve_model_run(session_factory, ids, "完成实验，锁定")
    with session_factory() as session, session.begin():
        locked = service.submit_model_proposal_in_transaction(
            session, project_id, document_id, candidate_id, run_id, "完成实验，改定"
        )
    assert locked.status == "invalid"
    assert {check.rule: check.result for check in locked.checks}["lock"] == "fail"
    assert versions(session_factory, document_id) == 1


def test_task_evidence_quotes_v2_text_across_runs(session_factory: sessionmaker[Session]) -> None:
    from thesis_pilot.modules.tasks.evidence import resolve_evidence
    from thesis_pilot.modules.tasks.schemas import DocumentEvidence

    project_id, document_id = seeded(session_factory)

    def evidence(raw: dict[str, Any]) -> DocumentEvidence:
        return DocumentEvidence.model_validate(
            {"kind": "document", "document_id": str(document_id), "version": 1, "selection": raw}
        )

    with session_factory() as session:
        resolved = resolve_evidence(session, project_id, [evidence(selection("方法甲完成实验"))])
        assert resolved[0].label.endswith("方法甲完成实验") and not resolved[0].stale
        for bad in (
            {**selection("方法甲"), "expected_text": "方法乙"},
            {**selection("方法甲"), "node_id": "missing"},
            {"textblock_path": [1], "from": 1, "to": 3, "text": "本研"},
        ):
            with pytest.raises(AppError) as captured:
                resolve_evidence(session, project_id, [evidence(bad)])
            assert captured.value.code == "TASK_EVIDENCE_INVALID"
