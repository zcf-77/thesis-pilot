"""Real PostgreSQL assistant boundaries; completions are explicit TEST STUBS.

No test in this file calls a provider or proves a real model invocation. Stub
results exercise atomic persistence, protection and the closed adoption gate only.
"""

import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, func, select, update
from sqlalchemy.exc import DBAPIError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs.schemas import AIConfigUpdate, PromptConfigContent
from thesis_pilot.modules.ai_configs.service import update_config
from thesis_pilot.modules.assistant_sessions import service as assistants
from thesis_pilot.modules.assistant_sessions.models import (
    AssistantCommand,
    AssistantMessage,
    AssistantRun,
)
from thesis_pilot.modules.assistant_sessions.schemas import (
    AssistantMaterialRef,
    AssistantRunCommand,
    AssistantRunCreate,
    AssistantRunReceipt,
    AssistantSessionCreate,
    AssistantSessionRead,
)
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.schemas import DocumentImport, DocumentRead, DocumentSave
from thesis_pilot.modules.jobs.models import Job, JobArtifact, OutboxEvent
from thesis_pilot.modules.jobs.service import (
    claim_job,
    finish_content_revision_job,
    load_content_revision_snapshot,
    retry_job,
)
from thesis_pilot.modules.materials import service as materials
from thesis_pilot.modules.materials.schemas import ProjectSourceBindingUpdate
from thesis_pilot.modules.revisions import service as revisions
from thesis_pilot.modules.revisions.models import RevisionCandidate, RevisionProposal
from thesis_pilot.modules.revisions.schemas import RevisionApply, RevisionDecide
from thesis_pilot.workflows.content_revision import ContentRevisionCompletion

from .conftest import PostgreSQLSandbox
from .test_ai_configs import ConfigChain, chain
from .test_long_jobs import read_job
from .test_materials import finish_parse, payload, upload
from .test_services import make_project

pytestmark = pytest.mark.integration
BEFORE = "采用方法甲 42"
AFTER = "使用方法甲 42"
STUB_MODEL = "teststub-no-provider-call"


@dataclass(frozen=True)
class Setup:
    project_id: UUID
    document: DocumentRead
    session: AssistantSessionRead
    configs: ConfigChain

    def request(self, **changes: object) -> AssistantRunCreate:
        return AssistantRunCreate.model_validate(
            {
                "command_id": uuid4(),
                "expected_session_version": self.session.version,
                "input": {
                    "document_id": self.document.id,
                    "document_version": self.document.version,
                    "selection": {
                        "textblock_path": [0],
                        "from": 1,
                        "to": len(BEFORE) + 1,
                        "text": BEFORE,
                    },
                    "goal": "仅调整合成句的措辞，保留数字。",
                    "material_sources": [],
                    "agent_config_version_id": self.configs.agent.current_version_id,
                    "source_binding_version_id": None,
                },
                **changes,
            }
        )


def setup(postgres: PostgreSQLSandbox) -> Setup:
    project_id = make_project(postgres)
    with postgres.sessions() as session:
        document = documents.import_document(
            session,
            project_id,
            DocumentImport.model_validate(
                {
                    "content": {
                        "schema_version": 1,
                        "json": {
                            "type": "doc",
                            "content": [
                                {"type": "paragraph", "content": [{"type": "text", "text": BEFORE}]}
                            ],
                        },
                    }
                }
            ),
        )
    with postgres.sessions() as session:
        conversation = assistants.create_session(
            session, project_id, AssistantSessionCreate(title="TEST STUB 合成内容会话")
        )
    return Setup(project_id, document, conversation, chain(postgres, max_retries=2))


def send(postgres: PostgreSQLSandbox, fixture: Setup, request: AssistantRunCreate | None = None):
    with postgres.sessions() as session:
        return assistants.create_run(
            session, fixture.project_id, fixture.session.id, request or fixture.request()
        )


def stub_completion(after: str = AFTER) -> ContentRevisionCompletion:
    """Typed test transport result, never a claim that an external model ran."""
    return ContentRevisionCompletion.model_validate(
        {
            "replacement": after,
            "reply": "TEST STUB：仅验证事务与保护，不是模型输出。",
            "requested_model": "deepseek-flash",
            "response_model": STUB_MODEL,
        }
    )


def stored_run(postgres: PostgreSQLSandbox, run_id: UUID) -> AssistantRun:
    with postgres.sessions() as session:
        value = session.get(AssistantRun, run_id)
        assert value is not None
        # Explicitly load snapshots before detaching, including deferred columns.
        assert value.input_snapshot and value.context_snapshot and value.configuration_snapshot
        return value


def assert_document_unchanged(postgres: PostgreSQLSandbox, fixture: Setup) -> None:
    with postgres.sessions() as session:
        assert documents.get_current_document(session, fixture.project_id) == fixture.document


def test_create_run_atomically_freezes_user_message_candidate_job_and_outbox(
    postgres: PostgreSQLSandbox,
) -> None:
    fixture = setup(postgres)
    request = fixture.request()
    receipt = send(postgres, fixture, request)
    assert receipt.message.role == "user" and receipt.run.trigger_message_id == receipt.message.id
    assert receipt.run.job_id == receipt.job.id and receipt.job.kind == "content_revision"
    # A queued run must not expose an unfinished candidate as a usable suggestion.
    assert receipt.run.candidate_id is None
    assert receipt.session.version > fixture.session.version
    run = stored_run(postgres, receipt.run.id)
    assert run.candidate_id is not None
    assert run.input_snapshot == request.input.model_dump(mode="json")
    assert run.document_id == fixture.document.id and run.document_version == 1
    with postgres.sessions() as session:
        candidate = session.get(RevisionCandidate, run.candidate_id)
        assert candidate is not None and candidate.status == "generating"
        assert candidate.run_id == run.id
        for model in (
            AssistantMessage,
            AssistantRun,
            AssistantCommand,
            RevisionCandidate,
            Job,
            OutboxEvent,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 1
        assert session.scalar(select(func.count()).select_from(RevisionProposal)) == 0
    assert_document_unchanged(postgres, fixture)


def test_enqueue_failure_does_not_leave_message_run_candidate_or_command(
    postgres: PostgreSQLSandbox,
) -> None:
    fixture = setup(postgres)
    request = fixture.request()

    def fail(_mapper: object, _connection: object, _target: OutboxEvent) -> None:
        raise RuntimeError("TEST STUB enqueue failure")

    event.listen(OutboxEvent, "before_insert", fail)
    try:
        with pytest.raises(RuntimeError, match="enqueue failure"):
            send(postgres, fixture, request)
    finally:
        event.remove(OutboxEvent, "before_insert", fail)
    with postgres.sessions() as session:
        for model in (
            AssistantMessage,
            AssistantRun,
            AssistantCommand,
            RevisionCandidate,
            Job,
            OutboxEvent,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0
    assert send(postgres, fixture, request).message.seq == 1
    assert_document_unchanged(postgres, fixture)


def test_same_command_concurrently_replays_one_receipt(postgres: PostgreSQLSandbox) -> None:
    fixture = setup(postgres)
    request = fixture.request()
    barrier = Barrier(2, timeout=10)

    def execute(_: int) -> AssistantRunReceipt:
        barrier.wait()
        return send(postgres, fixture, request)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first, replay = list(executor.map(execute, [0, 1]))
    assert first == replay
    with postgres.sessions() as session:
        for model in (AssistantMessage, AssistantRun, RevisionCandidate, Job, OutboxEvent):
            assert session.scalar(select(func.count()).select_from(model)) == 1


def test_competing_commands_in_one_session_do_not_create_overlapping_runs(
    postgres: PostgreSQLSandbox,
) -> None:
    fixture = setup(postgres)
    barrier = Barrier(2, timeout=10)

    def execute(_: int) -> str:
        request = fixture.request()
        barrier.wait()
        try:
            send(postgres, fixture, request)
            return "accepted"
        except AppError as error:
            assert error.code in {"ASSISTANT_SESSION_BUSY", "ASSISTANT_SESSION_VERSION_CONFLICT"}
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(execute, [0, 1])) == ["accepted", "conflict"]
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(AssistantRun)) == 1
        assert session.scalar(select(func.count()).select_from(AssistantMessage)) == 1
        active = session.scalars(select(AssistantRun)).one()
    with postgres.sessions() as session:
        latest = assistants.get_session(session, fixture.project_id, fixture.session.id)
    with pytest.raises(AppError) as busy:
        send(postgres, fixture, fixture.request(expected_session_version=latest.version))
    assert busy.value.code == "ASSISTANT_SESSION_BUSY"
    with postgres.sessions() as session:
        assistants.cancel_run(
            session, fixture.project_id, active.id, AssistantRunCommand(command_id=uuid4())
        )
    with pytest.raises(AppError) as stale:
        send(postgres, fixture)
    assert stale.value.code == "ASSISTANT_SESSION_VERSION_CONFLICT"


def test_command_reuse_with_a_changed_goal_is_conflict_not_a_second_message(
    postgres: PostgreSQLSandbox,
) -> None:
    fixture = setup(postgres)
    request = fixture.request()
    first = send(postgres, fixture, request)
    changed = request.model_copy(deep=True)
    changed.input.goal = "另一个合成目标"
    with pytest.raises(AppError) as caught:
        send(postgres, fixture, changed)
    assert caught.value.code == "ASSISTANT_COMMAND_CONFLICT"
    assert send(postgres, fixture, request) == first
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(AssistantMessage)) == 1


def test_explicit_material_binding_selection_and_config_snapshots_stay_fixed(
    postgres: PostgreSQLSandbox,
) -> None:
    fixture = setup(postgres)
    source = upload(postgres, fixture.project_id, payload(kind="template"))
    parsed = finish_parse(postgres, source.job.id)
    anchors = parsed.content["anchors"]
    selected_anchor = next(item["id"] for item in anchors if item["original_text"].strip())
    with postgres.sessions() as session:
        binding = materials.update_binding(
            session,
            fixture.project_id,
            ProjectSourceBindingUpdate(
                expected_version=0,
                template_parse_version_id=parsed.id,
                requirement_parse_version_ids=[],
            ),
        )
    content_input = fixture.request().input.model_copy(
        update={
            "material_sources": [
                AssistantMaterialRef(
                    material_id=source.material.id,
                    original_version_id=source.original.id,
                    parse_version_id=parsed.id,
                    anchor_ids=[selected_anchor],
                )
            ],
            "source_binding_version_id": binding.current_version_id,
        }
    )
    receipt = send(postgres, fixture, fixture.request(input=content_input))
    frozen = stored_run(postgres, receipt.run.id)
    before = (frozen.input_snapshot, frozen.context_snapshot, frozen.configuration_snapshot)
    with postgres.sessions() as session:
        update_config(
            session,
            fixture.configs.prompt.id,
            AIConfigUpdate(
                expected_version=1,
                content=PromptConfigContent(
                    kind="prompt", template="新版：{{goal}}", variables=["goal"]
                ),
            ),
        )
    with postgres.sessions() as session:
        materials.update_binding(
            session,
            fixture.project_id,
            ProjectSourceBindingUpdate(
                expected_version=1, template_parse_version_id=None, requirement_parse_version_ids=[]
            ),
        )
    frozen = stored_run(postgres, receipt.run.id)
    assert (frozen.input_snapshot, frozen.context_snapshot, frozen.configuration_snapshot) == before
    assert frozen.input_snapshot["selection"] == content_input.selection.model_dump(mode="json")
    assert frozen.input_snapshot["material_sources"] == [
        item.model_dump(mode="json") for item in content_input.material_sources
    ]
    assert frozen.input_snapshot["source_binding_version_id"] == str(binding.current_version_id)
    assert str(fixture.configs.prompt.current_version_id) in json.dumps(
        frozen.configuration_snapshot
    )
    for statement in [
        update(AssistantRun)
        .where(AssistantRun.id == receipt.run.id)
        .values(input_snapshot={"goal": "tampered"}),
        update(AssistantMessage)
        .where(AssistantMessage.id == receipt.message.id)
        .values(content="tampered original user message"),
        update(AssistantCommand)
        .where(AssistantCommand.command_id == frozen.command_id)
        .values(request_hash="0" * 64),
    ]:
        with postgres.sessions() as session, pytest.raises(DBAPIError), session.begin():
            session.execute(statement)
    assert stored_run(postgres, receipt.run.id).input_snapshot == before[0]
    assert_document_unchanged(postgres, fixture)


def test_cross_project_session_document_and_material_refs_are_rejected(
    postgres: PostgreSQLSandbox,
) -> None:
    fixture = setup(postgres)
    other = setup(postgres)
    source = upload(postgres, other.project_id, payload(kind="template"))
    parsed = finish_parse(postgres, source.job.id)
    anchor = parsed.content["anchors"][0]["id"]
    with postgres.sessions() as session:
        other_binding = materials.update_binding(
            session,
            other.project_id,
            ProjectSourceBindingUpdate(
                expected_version=0,
                template_parse_version_id=parsed.id,
                requirement_parse_version_ids=[],
            ),
        )
    invalid_inputs = [
        fixture.request().input.model_copy(update={"document_id": other.document.id}),
        fixture.request().input.model_copy(
            update={
                "source_binding_version_id": other_binding.current_version_id,
            }
        ),
        fixture.request().input.model_copy(
            update={
                "material_sources": [
                    AssistantMaterialRef(
                        material_id=source.material.id,
                        original_version_id=source.original.id,
                        parse_version_id=parsed.id,
                        anchor_ids=[anchor],
                    )
                ]
            }
        ),
    ]
    for content_input in invalid_inputs:
        with pytest.raises(AppError) as caught:
            send(postgres, fixture, fixture.request(input=content_input))
        assert caught.value.status_code in {404, 409, 422}
    with postgres.sessions() as session, pytest.raises(AppError) as session_error:
        assistants.create_run(session, other.project_id, fixture.session.id, fixture.request())
    assert session_error.value.status_code == 404
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(AssistantRun)) == 0
        assert session.scalar(select(func.count()).select_from(RevisionCandidate)) == 0


def test_cancelled_run_discards_late_stub_reply_and_proposal(postgres: PostgreSQLSandbox) -> None:
    fixture = setup(postgres)
    receipt = send(postgres, fixture)
    claim = claim_job(postgres.sessions, receipt.job.id, 60)
    assert claim is not None
    assert load_content_revision_snapshot(postgres.sessions, claim) is not None
    with postgres.sessions() as session:
        assistants.cancel_run(
            session,
            fixture.project_id,
            receipt.run.id,
            AssistantRunCommand(command_id=uuid4()),
        )
    assert not finish_content_revision_job(postgres.sessions, claim, stub_completion())
    assert not finish_content_revision_job(postgres.sessions, claim, stub_completion())
    assert load_content_revision_snapshot(postgres.sessions, claim) is None
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(AssistantMessage)) == 1
        assert session.scalar(select(func.count()).select_from(RevisionProposal)) == 0
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 0
    assert stored_run(postgres, receipt.run.id).result_message_id is None
    assert read_job(postgres, receipt.job.id).status == "cancelled"
    assert_document_unchanged(postgres, fixture)


def test_retry_creates_new_run_with_fixed_input_and_rejects_document_drift(
    postgres: PostgreSQLSandbox,
) -> None:
    fixture = setup(postgres)
    first = send(postgres, fixture)
    with postgres.sessions() as session:
        assistants.cancel_run(
            session,
            fixture.project_id,
            first.run.id,
            AssistantRunCommand(command_id=uuid4()),
        )
    with postgres.sessions() as session, pytest.raises(AppError) as direct_error:
        retry_job(session, first.job.id, str(uuid4()), project_id=fixture.project_id)
    assert direct_error.value.code == "ASSISTANT_RUN_RETRY_REQUIRED"
    retry_command = AssistantRunCommand(command_id=uuid4())
    with postgres.sessions() as session:
        retried = assistants.retry_run(session, fixture.project_id, first.run.id, retry_command)
    with postgres.sessions() as session:
        replay = assistants.retry_run(session, fixture.project_id, first.run.id, retry_command)
    assert replay == retried
    assert retried.run.id != first.run.id and retried.job.id != first.job.id
    assert retried.run.source_run_id == first.run.id
    old, new = stored_run(postgres, first.run.id), stored_run(postgres, retried.run.id)
    assert new.input_snapshot == old.input_snapshot
    assert new.context_snapshot == old.context_snapshot
    assert new.configuration_snapshot == old.configuration_snapshot
    with postgres.sessions() as session:
        assistants.cancel_run(
            session,
            fixture.project_id,
            retried.run.id,
            AssistantRunCommand(command_id=uuid4()),
        )
    edited = fixture.document.content.model_dump(mode="json", by_alias=True)
    edited["json"]["content"][0]["content"][0]["text"] = "学生更新后的合成正文 42"
    with postgres.sessions() as session:
        documents.save_document(
            session,
            fixture.project_id,
            fixture.document.id,
            DocumentSave(expected_version=1, content=edited),
        )
    with postgres.sessions() as session, pytest.raises(AppError) as stale:
        assistants.retry_run(
            session,
            fixture.project_id,
            retried.run.id,
            AssistantRunCommand(command_id=uuid4()),
        )
    assert stale.value.status_code == 409
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(AssistantRun)) == 2


def test_stub_completion_keeps_protection_and_adopts_one_version_on_request(
    postgres: PostgreSQLSandbox,
) -> None:
    fixture = setup(postgres)
    receipt = send(postgres, fixture)
    claim = claim_job(postgres.sessions, receipt.job.id, 60)
    assert claim is not None
    assert finish_content_revision_job(postgres.sessions, claim, stub_completion())
    run = stored_run(postgres, receipt.run.id)
    assert run.result_message_id is not None and run.candidate_id is not None
    with postgres.sessions() as session:
        candidate = revisions.get_revision(
            session, fixture.project_id, fixture.document.id, run.candidate_id
        )
    assert candidate.producer == "model_run" and candidate.run_id == run.id
    assert candidate.status == "ready" and candidate.applicable
    assert all(check.result == "pass" for check in candidate.checks)
    with postgres.sessions() as session:
        revisions.decide_revision(
            session,
            fixture.project_id,
            fixture.document.id,
            candidate.id,
            RevisionDecide.model_validate(
                {
                    "command_id": uuid4(),
                    "expected_revision": candidate.revision,
                    "decisions": [{"patch_id": candidate.patches[0].id, "decision": "accepted"}],
                }
            ),
        )
    with postgres.sessions() as session:
        reviewed = revisions.get_revision(
            session, fixture.project_id, fixture.document.id, candidate.id
        )
    # Deciding alone never writes the manuscript; only an explicit adoption does.
    assert_document_unchanged(postgres, fixture)
    with postgres.sessions() as session:
        reply = session.get(AssistantMessage, run.result_message_id)
        assert reply is not None and reply.content.startswith("TEST STUB")
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 1
    with postgres.sessions() as session:
        receipt = revisions.apply_revision(
            session,
            fixture.project_id,
            fixture.document.id,
            candidate.id,
            RevisionApply(
                command_id=uuid4(), expected_revision=reviewed.revision, expected_document_version=1
            ),
        )
    assert receipt.result_version == 2
    with postgres.sessions() as session:
        assert documents.get_current_document(session, fixture.project_id).version == 2
        applied = revisions.get_revision(
            session, fixture.project_id, fixture.document.id, candidate.id
        )
    assert applied.status == "applied" and applied.result_version == 2


def test_invalid_numeric_stub_output_is_never_an_applicable_candidate(
    postgres: PostgreSQLSandbox,
) -> None:
    fixture = setup(postgres)
    receipt = send(postgres, fixture)
    claim = claim_job(postgres.sessions, receipt.job.id, 60)
    assert claim is not None
    assert finish_content_revision_job(postgres.sessions, claim, stub_completion("使用方法甲 43"))
    run = stored_run(postgres, receipt.run.id)
    with postgres.sessions() as session:
        candidate = revisions.get_revision(
            session, fixture.project_id, fixture.document.id, run.candidate_id
        )
    assert candidate.status == "invalid" and not candidate.applicable
    assert any(check.rule == "number" and check.result == "fail" for check in candidate.checks)
    assert_document_unchanged(postgres, fixture)


def test_finish_failure_rolls_back_reply_proposal_and_job_artifact_together(
    postgres: PostgreSQLSandbox,
) -> None:
    fixture = setup(postgres)
    receipt = send(postgres, fixture)
    claim = claim_job(postgres.sessions, receipt.job.id, 60)
    assert claim is not None

    def fail(_mapper: object, _connection: object, _target: JobArtifact) -> None:
        raise RuntimeError("TEST STUB artifact persistence failure")

    event.listen(JobArtifact, "before_insert", fail)
    try:
        with pytest.raises(RuntimeError, match="artifact persistence failure"):
            finish_content_revision_job(postgres.sessions, claim, stub_completion())
    finally:
        event.remove(JobArtifact, "before_insert", fail)
    run = stored_run(postgres, receipt.run.id)
    assert run.result_message_id is None
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(AssistantMessage)) == 1
        assert session.scalar(select(func.count()).select_from(RevisionProposal)) == 0
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 0
        candidate = session.get(RevisionCandidate, run.candidate_id)
        assert candidate is not None and candidate.status == "generating"
    assert read_job(postgres, receipt.job.id).status == "running"
    assert finish_content_revision_job(postgres.sessions, claim, stub_completion())
    assert_document_unchanged(postgres, fixture)
