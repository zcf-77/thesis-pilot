"""Synthetic replacements test server boundaries; these are not live model calls."""

from dataclasses import dataclass
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.assistant_sessions.models import (
    AssistantMessage,
    AssistantRun,
    AssistantSession,
)
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentImport
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.revisions import service
from thesis_pilot.modules.revisions.models import (
    RevisionCandidate,
    RevisionCommand,
    RevisionProposal,
)
from thesis_pilot.modules.revisions.schemas import (
    RevisionApply,
    RevisionCreate,
    RevisionDecide,
    RevisionSelection,
)
from thesis_pilot.modules.revisions.schemas import RevisionProposal as ProposalInput

TEXT = "采用方法甲。能够验证。"
GOAL = "精简自制文字"


@dataclass(frozen=True)
class Seed:
    project_id: UUID
    document_id: UUID
    run_id: UUID
    candidate_id: UUID
    text: str


def selection(text: str) -> RevisionSelection:
    return RevisionSelection.model_validate(
        {
            "textblock_path": [0],
            "from": 1,
            "to": len(text.encode("utf-16-le")) // 2 + 1,
            "text": text,
        }
    )


def reserve(session: Session, project_id: UUID, document_id: UUID, text: str) -> tuple[UUID, UUID]:
    conversation = AssistantSession(project_id=project_id, title="自制内容会话", role="content")
    session.add(conversation)
    session.flush()
    message = AssistantMessage(session_id=conversation.id, seq=1, role="user", content=GOAL)
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
        request_hash="a" * 64,
        input_snapshot={
            "document_id": str(document_id),
            "document_version": 1,
            "selection": selection(text).model_dump(mode="json", by_alias=True),
            "goal": GOAL,
            "material_sources": [],
            "agent_config_version_id": str(uuid4()),
            "source_binding_version_id": None,
        },
        context_snapshot={},
        configuration_snapshot={},
    )
    session.add(run)
    session.flush()
    candidate = service.create_model_revision_in_transaction(
        session,
        project_id,
        document_id,
        1,
        selection(text),
        GOAL,
        run.id,
    )
    run.candidate_id = candidate.id
    session.flush()
    return run.id, candidate.id


def seeded(factory: sessionmaker[Session], text: str = TEXT) -> Seed:
    with factory() as session:
        owner = create_project(session, ProjectCreate(name="模型修订边界自制项目"))
        document = documents.import_document(
            session,
            owner.id,
            DocumentImport.model_validate(
                {
                    "content": {
                        "schema_version": 1,
                        "json": {
                            "type": "doc",
                            "content": [
                                {"type": "paragraph", "content": [{"type": "text", "text": text}]},
                            ],
                        },
                    },
                }
            ),
        )
        with session.begin():
            run_id, candidate_id = reserve(session, owner.id, document.id, text)
    return Seed(owner.id, document.id, run_id, candidate_id, text)


def propose(factory: sessionmaker[Session], item: Seed, after: str):
    with factory() as session, session.begin():
        return service.submit_model_proposal_in_transaction(
            session,
            item.project_id,
            item.document_id,
            item.candidate_id,
            item.run_id,
            after,
        )


def read(factory: sessionmaker[Session], item: Seed):
    with factory() as session:
        return service.get_revision(session, item.project_id, item.document_id, item.candidate_id)


def test_model_proposal_has_fixed_offsets_before_and_is_applicable_after_checks(
    session_factory: sessionmaker[Session],
) -> None:
    item = seeded(session_factory)
    reserved = read(session_factory, item)
    assert reserved.producer == "model_run" and reserved.run_id == item.run_id
    assert reserved.generation_token is None
    result = propose(session_factory, item, "使用方法甲。可以验证。")
    patch = result.patches[0]
    assert (patch.id, patch.from_position, patch.to, patch.before) == (
        "model-replacement",
        1,
        selection(item.text).to,
        item.text,
    )
    assert result.status == "ready" and all(check.result == "pass" for check in result.checks)
    assert result.applicable and result.generation_token is None
    with session_factory() as session:
        assert documents.get_current_document(session, item.project_id).version == 1


def test_model_adoption_keeps_version_cas_and_writes_exactly_one_version(
    session_factory: sessionmaker[Session],
) -> None:
    item = seeded(session_factory)
    result = propose(session_factory, item, "使用方法甲。可以验证。")
    with session_factory() as session:
        service.decide_revision(
            session,
            item.project_id,
            item.document_id,
            item.candidate_id,
            RevisionDecide.model_validate(
                {
                    "command_id": str(uuid4()),
                    "expected_revision": 2,
                    "decisions": [{"patch_id": result.patches[0].id, "decision": "accepted"}],
                }
            ),
        )
    stale_command = uuid4()
    with session_factory() as session, pytest.raises(AppError) as conflict:
        service.apply_revision(
            session,
            item.project_id,
            item.document_id,
            item.candidate_id,
            RevisionApply(
                command_id=stale_command, expected_revision=3, expected_document_version=2
            ),
        )
    assert conflict.value.status_code == 409
    with session_factory() as session:
        assert session.get(RevisionCommand, (item.document_id, stale_command)) is None
        assert session.scalar(select(func.count()).select_from(DocumentVersion)) == 1
    with session_factory() as session:
        receipt = service.apply_revision(
            session,
            item.project_id,
            item.document_id,
            item.candidate_id,
            RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=1),
        )
    assert receipt.result_version == 2
    with session_factory() as session:
        current = documents.get_current_document(session, item.project_id)
        assert current.version == 2
        paragraph = current.content.json_content["content"][0]["content"]
        assert "".join(node["text"] for node in paragraph) == "使用方法甲。可以验证。"
        assert session.scalar(select(func.count()).select_from(DocumentVersion)) == 2
    assert read(session_factory, item).status == "applied"


def test_public_create_and_proposal_cannot_forge_model_run_output(
    session_factory: sessionmaker[Session],
) -> None:
    item = seeded(session_factory)
    for extra in ({"producer": "model_run"}, {"run_id": str(item.run_id)}):
        with pytest.raises(ValidationError):
            RevisionCreate.model_validate(
                {
                    "command_id": str(uuid4()),
                    "base_version": 1,
                    "selection": selection(item.text).model_dump(by_alias=True),
                    "goal": GOAL,
                    **extra,
                }
            )
    with session_factory() as session:
        candidate = session.get(RevisionCandidate, item.candidate_id)
        assert candidate is not None
        token = candidate.generation_token
    with session_factory() as session:
        with pytest.raises(AppError) as rejected:
            service.submit_proposal(
                session,
                item.project_id,
                item.document_id,
                item.candidate_id,
                ProposalInput.model_validate(
                    {
                        "command_id": str(uuid4()),
                        "generation_token": str(token),
                        "patches": [
                            {
                                "id": "forged",
                                "from": 1,
                                "to": selection(item.text).to,
                                "before": item.text,
                                "after": "客户端伪造模型文本",
                            }
                        ],
                    }
                ),
            )
        assert rejected.value.code == "REVISION_PRODUCER_CONFLICT"
        assert session.scalar(select(func.count()).select_from(RevisionProposal)) == 0
    assert read(session_factory, item).status == "generating"


@pytest.mark.parametrize(
    ("before", "after", "rule"),
    [
        ("合成样本42个。", "合成样本43个。", "number"),
        ("合成引用[1]保持。", "合成引用[2]保持。", "citation"),
    ],
)
def test_real_model_candidate_uses_existing_numeric_and_citation_guards(
    session_factory: sessionmaker[Session],
    before: str,
    after: str,
    rule: str,
) -> None:
    item = seeded(session_factory, before)
    result = propose(session_factory, item, after)
    assert result.status == "invalid" and not result.applicable
    assert any(check.rule == rule and check.result != "pass" for check in result.checks)
    with session_factory() as session:
        assert (
            documents.get_current_document(session, item.project_id).content.json_content[
                "content"
            ][0]["content"][0]["text"]
            == before
        )


def test_run_scope_and_fixed_selection_cannot_be_rebound(
    session_factory: sessionmaker[Session],
) -> None:
    item, other = seeded(session_factory), seeded(session_factory)
    with session_factory() as session:
        with pytest.raises(AppError) as wrong_run, session.begin():
            service.submit_model_proposal_in_transaction(
                session,
                item.project_id,
                item.document_id,
                item.candidate_id,
                other.run_id,
                "错误运行的输出",
            )
        assert wrong_run.value.code == "REVISION_RUN_INVALID"
        with pytest.raises(AppError) as wrong_selection, session.begin():
            service.create_model_revision_in_transaction(
                session,
                item.project_id,
                item.document_id,
                1,
                selection("不同原文"),
                GOAL,
                item.run_id,
            )
        assert wrong_selection.value.code == "REVISION_RUN_INVALID"
    assert read(session_factory, item).status == "generating"


def test_run_with_existing_other_candidate_cannot_reserve_an_extra_candidate(
    session_factory: sessionmaker[Session],
) -> None:
    item, other = seeded(session_factory), seeded(session_factory)
    with session_factory() as session, session.begin():
        other_run = session.get(AssistantRun, other.run_id)
        assert other_run is not None
        other_run.candidate_id = None
        session.flush()
        run = session.get(AssistantRun, item.run_id)
        assert run is not None
        run.candidate_id = other.candidate_id
    with session_factory() as session:
        with pytest.raises(AppError) as rejected, session.begin():
            service.create_model_revision_in_transaction(
                session,
                item.project_id,
                item.document_id,
                1,
                selection(item.text),
                GOAL,
                item.run_id,
            )
        assert rejected.value.code == "REVISION_RUN_INVALID"
        assert session.scalar(select(func.count()).select_from(RevisionCandidate)) == 2


def test_user_cancellation_and_generation_failure_remain_distinct_and_late_output_is_rejected(
    session_factory: sessionmaker[Session],
) -> None:
    cancelled, failed = seeded(session_factory), seeded(session_factory)
    with session_factory() as session, session.begin():
        result = service.end_model_revision_in_transaction(
            session,
            cancelled.project_id,
            cancelled.document_id,
            cancelled.candidate_id,
            cancelled.run_id,
        )
        assert result.status == "cancelled" and result.generation_error_code is None
    with session_factory() as session, session.begin():
        result = service.end_model_revision_in_transaction(
            session,
            failed.project_id,
            failed.document_id,
            failed.candidate_id,
            failed.run_id,
            "MODEL_TIMEOUT",
        )
        assert result.status == "failed" and result.generation_error_code == "MODEL_TIMEOUT"
    for item in (cancelled, failed):
        with pytest.raises(AppError) as late:
            propose(session_factory, item, "迟到模型输出")
        assert late.value.code == "REVISION_STATE_CONFLICT"
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(RevisionProposal)) == 0


def test_failure_code_does_not_persist_private_transport_exception(
    session_factory: sessionmaker[Session],
) -> None:
    item = seeded(session_factory)
    with session_factory() as session, session.begin():
        result = service.end_model_revision_in_transaction(
            session,
            item.project_id,
            item.document_id,
            item.candidate_id,
            item.run_id,
            "PRIVATE-HTTP-KEY-AND-PAPER",
        )
        assert result.generation_error_code == "JOB_EXECUTION_FAILED"
        assert "PRIVATE" not in result.model_dump_json()


def test_candidate_reservation_rolls_back_with_run_and_message(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        project = create_project(session, ProjectCreate(name="候选事务回滚"))
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
                                {"type": "paragraph", "content": [{"type": "text", "text": TEXT}]},
                            ],
                        },
                    },
                }
            ),
        )
        with pytest.raises(RuntimeError, match="synthetic reservation failure"), session.begin():
            reserve(session, project.id, document.id, TEXT)
            raise RuntimeError("synthetic reservation failure")
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(AssistantRun)) == 0
        assert session.scalar(select(func.count()).select_from(AssistantMessage)) == 0
        assert session.scalar(select(func.count()).select_from(RevisionCandidate)) == 0


def test_proposal_failure_rolls_back_candidate_transition_and_allows_reexecution(
    session_factory: sessionmaker[Session],
) -> None:
    item = seeded(session_factory)

    def reject_proposal(*args: object) -> None:
        raise RuntimeError("synthetic model proposal failure")

    event.listen(RevisionProposal, "before_insert", reject_proposal)
    try:
        with pytest.raises(RuntimeError, match="proposal failure"):
            propose(session_factory, item, "使用方法甲。可以验证。")
    finally:
        event.remove(RevisionProposal, "before_insert", reject_proposal)
    reserved = read(session_factory, item)
    assert reserved.status == "generating" and reserved.revision == 1 and reserved.patches == []
    assert propose(session_factory, item, "使用方法甲。可以验证。").status == "ready"
