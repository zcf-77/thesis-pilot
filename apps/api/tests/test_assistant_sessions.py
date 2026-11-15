"""Session/run facts, exact context and safe failure/retry without external calls."""

from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs import service as configs
from thesis_pilot.modules.ai_configs.schemas import AIConfigCreate
from thesis_pilot.modules.assistant_sessions import service
from thesis_pilot.modules.assistant_sessions.models import (
    AssistantCommand,
    AssistantMessage,
    AssistantRun,
)
from thesis_pilot.modules.assistant_sessions.schemas import (
    AssistantContentInput,
    AssistantRunCommand,
    AssistantRunCreate,
    AssistantSessionCreate,
    AssistantSessionUpdate,
)
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.schemas import DocumentSave
from thesis_pilot.modules.jobs import service as jobs
from thesis_pilot.modules.jobs.models import Job, OutboxEvent
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.revisions.models import RevisionCandidate


def prepared(factory: sessionmaker[Session]):
    with factory() as session:
        project = create_project(session, ProjectCreate(name="合成内容助手项目"))
        document = documents.create_blank_document(session, project.id)
        document = documents.save_document(
            session,
            project.id,
            document.id,
            DocumentSave.model_validate(
                {
                    "expected_version": 1,
                    "content": {
                        "schema_version": 1,
                        "json": {
                            "type": "doc",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "原始内容用于合成测试。"}],
                                }
                            ],
                        },
                    },
                }
            ),
        )
        api = configs.create_config(
            session,
            AIConfigCreate.model_validate({"name": "测试官方API", "content": {"kind": "api"}}),
        )
        model = configs.create_config(
            session,
            AIConfigCreate.model_validate(
                {
                    "name": "测试模型",
                    "content": {
                        "kind": "model",
                        "api_version_id": str(api.current_version_id),
                        "model_code": "deepseek-flash",
                        "capabilities": ["text"],
                    },
                }
            ),
        )
        prompt = configs.create_config(
            session,
            AIConfigCreate.model_validate(
                {
                    "name": "测试内容模板",
                    "content": {
                        "kind": "prompt",
                        "template": "{{context}}\n{{goal}}\n{{requirements}}\n{{materials}}",
                        "variables": ["context", "goal", "requirements", "materials"],
                    },
                }
            ),
        )
        agent = configs.create_config(
            session,
            AIConfigCreate.model_validate(
                {
                    "name": "测试内容助手",
                    "content": {
                        "kind": "agent",
                        "role": "content",
                        "instructions": "只提出局部候选。",
                        "model_version_id": str(model.current_version_id),
                        "prompt_version_id": str(prompt.current_version_id),
                    },
                }
            ),
        )
        conversation = service.create_session(
            session, project.id, AssistantSessionCreate(title="合成会话")
        )
    request = AssistantRunCreate(
        command_id=uuid4(),
        expected_session_version=conversation.version,
        input=AssistantContentInput.model_validate(
            {
                "document_id": str(document.id),
                "document_version": document.version,
                "selection": {"textblock_path": [0], "from": 1, "to": 5, "text": "原始内容"},
                "goal": "精简表达",
                "material_sources": [],
                "agent_config_version_id": str(agent.current_version_id),
                "source_binding_version_id": None,
            }
        ),
    )
    return project, document, conversation, request


def test_session_cas_archive_and_project_scope(session_factory: sessionmaker[Session]) -> None:
    project, _, conversation, _ = prepared(session_factory)
    with session_factory() as session:
        changed = service.update_session(
            session,
            project.id,
            conversation.id,
            AssistantSessionUpdate(expected_version=1, title="新标题", archived=True),
        )
        assert changed.version == 2 and changed.archived
        assert service.list_sessions(session, project.id, limit=20, offset=0).total == 0
        assert (
            service.list_sessions(
                session, project.id, limit=20, offset=0, include_archived=True
            ).total
            == 1
        )
        with pytest.raises(AppError) as stale:
            service.update_session(
                session,
                project.id,
                conversation.id,
                AssistantSessionUpdate(expected_version=1, title="过期"),
            )
        assert stale.value.code == "ASSISTANT_SESSION_VERSION_CONFLICT"
        other = create_project(session, ProjectCreate(name="另一个合成项目"))
        with pytest.raises(AppError) as foreign:
            service.get_session(session, other.id, conversation.id)
        assert foreign.value.code == "ASSISTANT_SESSION_NOT_FOUND"


def test_create_run_atomically_records_message_candidate_job_and_exact_context(
    session_factory: sessionmaker[Session],
) -> None:
    project, document, conversation, request = prepared(session_factory)
    with session_factory() as session:
        receipt = service.create_run(session, project.id, conversation.id, request)
        replay = service.create_run(session, project.id, conversation.id, request)
        assert replay.run.id == receipt.run.id and replay.job.id == receipt.job.id
        assert receipt.run.status == "queued" and receipt.run.candidate_id is None
        assert receipt.message.content == request.input.goal and receipt.message.seq == 1
        context = service.get_context(session, project.id, receipt.run.id)
        assert context.input.document_version == document.version
        assert context.context_snapshot["selection_text"] == "原始内容"
        assert context.configuration_snapshot["config_kind"] == "agent"
        assert "api_key" not in str(context.configuration_snapshot)
        assert documents.get_current_document(session, project.id) == document
        with session.begin():
            assert session.scalar(select(func.count()).select_from(AssistantRun)) == 1
            assert session.scalar(select(func.count()).select_from(AssistantMessage)) == 1
            assert session.scalar(select(func.count()).select_from(RevisionCandidate)) == 1
            assert session.scalar(select(func.count()).select_from(Job)) == 1
            assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_busy_and_changed_command_preserve_existing_message(
    session_factory: sessionmaker[Session],
) -> None:
    project, _, conversation, request = prepared(session_factory)
    with session_factory() as session:
        first = service.create_run(session, project.id, conversation.id, request)
        next_request = request.model_copy(
            update={"command_id": uuid4(), "expected_session_version": first.session.version}
        )
        with pytest.raises(AppError) as busy:
            service.create_run(session, project.id, conversation.id, next_request)
        assert busy.value.code == "ASSISTANT_SESSION_BUSY"
        changed = request.model_copy(deep=True)
        changed.input.goal = "不同目标"
        with pytest.raises(AppError) as conflict:
            service.create_run(session, project.id, conversation.id, changed)
        assert conflict.value.code == "ASSISTANT_COMMAND_CONFLICT"
        assert (
            service.list_messages(session, project.id, conversation.id, limit=20, offset=0).total
            == 1
        )


def test_failed_job_retains_context_and_retry_uses_new_run_with_same_message(
    session_factory: sessionmaker[Session],
) -> None:
    project, _, conversation, request = prepared(session_factory)
    with session_factory() as session:
        first = service.create_run(session, project.id, conversation.id, request)
        frozen = service.get_context(session, project.id, first.run.id)
    claim = jobs.claim_job(session_factory, first.job.id, 30)
    assert claim is not None
    # Controlled failure exercises the real transaction hook; no model/network call.
    assert jobs.finish_job(session_factory, claim, failed=True, error_code="MODEL_NOT_CONFIGURED")
    with session_factory() as session:
        failed = service.get_run(session, project.id, first.run.id)
        assert failed.status == "failed" and failed.error_code == "MODEL_NOT_CONFIGURED"
        retry_command = AssistantRunCommand(command_id=uuid4())
        retry = service.retry_run(session, project.id, first.run.id, retry_command)
        replay = service.retry_run(session, project.id, first.run.id, retry_command)
        assert retry.run.id != first.run.id and retry.run.id == replay.run.id
        assert retry.run.source_run_id == first.run.id
        assert retry.run.trigger_message_id == first.message.id
        assert (
            service.get_context(session, project.id, retry.run.id).context_snapshot
            == frozen.context_snapshot
        )
        assert (
            service.list_messages(session, project.id, conversation.id, limit=20, offset=0).total
            == 1
        )
        with session.begin():
            initial = session.scalar(select(AssistantRun).where(AssistantRun.id == first.run.id))
            assert session.get(RevisionCandidate, initial.candidate_id).status == "failed"


def test_cancel_is_idempotent_and_retry_budget_cannot_be_bypassed_by_siblings(
    session_factory: sessionmaker[Session],
) -> None:
    project, _, conversation, request = prepared(session_factory)
    with session_factory() as session:
        original = service.create_run(session, project.id, conversation.id, request)
        cancel = AssistantRunCommand(command_id=uuid4())
        assert (
            service.cancel_run(session, project.id, original.run.id, cancel).status == "cancelled"
        )
        assert (
            service.cancel_run(session, project.id, original.run.id, cancel).status == "cancelled"
        )
        for _ in range(2):
            retry = service.retry_run(
                session, project.id, original.run.id, AssistantRunCommand(command_id=uuid4())
            )
            service.cancel_run(
                session, project.id, retry.run.id, AssistantRunCommand(command_id=uuid4())
            )
        with pytest.raises(AppError) as budget:
            service.retry_run(
                session, project.id, original.run.id, AssistantRunCommand(command_id=uuid4())
            )
        assert budget.value.code == "MODEL_RETRY_LIMIT_REACHED"


def test_stale_body_or_fabricated_binding_is_rejected_before_messages(
    session_factory: sessionmaker[Session],
) -> None:
    project, document, conversation, request = prepared(session_factory)
    with session_factory() as session:
        altered = request.model_copy(deep=True)
        altered.input.source_binding_version_id = uuid4()
        with pytest.raises(AppError) as binding:
            service.create_run(session, project.id, conversation.id, altered)
        assert binding.value.code == "ASSISTANT_CONTEXT_STALE"
        latest = deepcopy(document.content.json_content)
        latest["content"][0]["content"][0]["text"] = "新的正式内容"
        documents.save_document(
            session,
            project.id,
            document.id,
            DocumentSave.model_validate(
                {
                    "expected_version": document.version,
                    "content": {"schema_version": 1, "json": latest},
                }
            ),
        )
        with pytest.raises(AppError) as stale:
            service.create_run(session, project.id, conversation.id, request)
        assert stale.value.code == "ASSISTANT_CONTEXT_STALE"
        assert (
            service.list_messages(session, project.id, conversation.id, limit=20, offset=0).total
            == 0
        )


def test_create_run_final_commit_failure_rolls_back_all_linked_facts(
    session_factory: sessionmaker[Session],
) -> None:
    project, _, conversation, request = prepared(session_factory)

    def reject_commit(session: Session) -> None:
        raise RuntimeError("synthetic assistant commit failure")

    with session_factory() as session:
        event.listen(session, "before_commit", reject_commit)
        with pytest.raises(RuntimeError, match="synthetic assistant"):
            service.create_run(session, project.id, conversation.id, request)
    with session_factory() as session:
        assert service.get_session(session, project.id, conversation.id).version == 1
        with session.begin():
            for model in (
                AssistantMessage,
                AssistantRun,
                AssistantCommand,
                RevisionCandidate,
                Job,
                OutboxEvent,
            ):
                assert session.scalar(select(func.count()).select_from(model)) == 0
