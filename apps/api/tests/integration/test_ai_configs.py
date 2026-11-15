"""Real PostgreSQL configuration snapshots and deterministic Redis/prefork probes.

All data is synthetic. Provider transport and real model quality are outside this suite.
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs.models import AIConfigVersion
from thesis_pilot.modules.ai_configs.schemas import (
    AgentConfigContent,
    AIConfigCreate,
    AIConfigRead,
    AIConfigUpdate,
    APIConfigContent,
    ConfigContent,
    ModelConfigContent,
    PromptConfigContent,
)
from thesis_pilot.modules.ai_configs.service import (
    create_config,
    freeze_config_version_chain,
    get_config,
    get_references,
    get_version,
    update_config,
)
from thesis_pilot.modules.documents.models import Document
from thesis_pilot.modules.jobs.models import Job, JobArtifact, JobAttempt, OutboxEvent
from thesis_pilot.modules.jobs.probe import run_configuration_probe
from thesis_pilot.modules.jobs.schemas import ConfigurationProbeInput, JobCreate
from thesis_pilot.modules.jobs.service import (
    cancel_job,
    claim_job,
    create_job,
    finish_job,
    retry_job,
)

from .conftest import PostgreSQLSandbox
from .test_long_jobs import isolated_worker, read_job
from .test_services import make_project

pytestmark = pytest.mark.integration
GOAL = "只检查合成论文目标，不写入任何正式内容。"
TEMPLATE = "为这个合成目标提供候选：{{goal}}"


@dataclass(frozen=True)
class ConfigChain:
    api: AIConfigRead
    model: AIConfigRead
    prompt: AIConfigRead
    agent: AIConfigRead

    @property
    def version_ids(self) -> dict[str, str]:
        return {
            kind: str(getattr(self, kind).current_version_id)
            for kind in ("api", "model", "prompt", "agent")
        }


def config(postgres: PostgreSQLSandbox, content: ConfigContent) -> AIConfigRead:
    with postgres.sessions() as session:
        return create_config(
            session, AIConfigCreate(name=f"合成{content.kind}-{uuid4().hex}", content=content)
        )


def chain(postgres: PostgreSQLSandbox, *, max_retries: int = 1) -> ConfigChain:
    api = config(postgres, APIConfigContent(kind="api", max_retries=max_retries))
    model = config(
        postgres,
        ModelConfigContent(
            kind="model",
            api_version_id=api.current_version_id,
            model_code="deepseek-flash",
            capabilities=["text"],
        ),
    )
    prompt = config(
        postgres,
        PromptConfigContent(
            kind="prompt", template=TEMPLATE, variables=["goal"], input_schema={"goal": "string"}
        ),
    )
    agent = config(
        postgres,
        AgentConfigContent(
            kind="agent",
            role="content",
            instructions="只返回候选，不修改正文。",
            model_version_id=model.current_version_id,
            prompt_version_id=prompt.current_version_id,
        ),
    )
    return ConfigChain(api, model, prompt, agent)


def prompt_config(postgres: PostgreSQLSandbox) -> AIConfigRead:
    return config(
        postgres, PromptConfigContent(kind="prompt", template=TEMPLATE, variables=["goal"])
    )


def request(project_id: UUID, version_id: UUID) -> JobCreate:
    return JobCreate(
        project_id=project_id,
        kind="configuration_probe",
        input_snapshot=ConfigurationProbeInput(
            config_version_id=version_id, variables={"goal": GOAL}
        ),
    )


def submit(postgres: PostgreSQLSandbox, version_id: UUID) -> Job:
    project_id = make_project(postgres)
    with postgres.sessions() as session:
        return create_job(session, request(project_id, version_id), str(uuid4()))


def test_four_libraries_keep_exact_historical_links_when_updated_and_disabled(
    postgres: PostgreSQLSandbox,
) -> None:
    entries = chain(postgres)
    with postgres.sessions() as session, session.begin():
        frozen = freeze_config_version_chain(session, entries.agent.current_version_id)
    assert frozen["version_ids"] == entries.version_ids

    with postgres.sessions() as session:
        changed_api = update_config(
            session,
            entries.api.id,
            AIConfigUpdate(
                expected_version=1, content=APIConfigContent(kind="api", timeout_seconds=7)
            ),
        )
    with postgres.sessions() as session:
        changed_prompt = update_config(
            session,
            entries.prompt.id,
            AIConfigUpdate(
                expected_version=1,
                content=PromptConfigContent(
                    kind="prompt", template="新版合成目标：{{goal}}", variables=["goal"]
                ),
            ),
        )
    assert changed_api.current_version_id != entries.api.current_version_id
    assert changed_prompt.current_version_id != entries.prompt.current_version_id
    with postgres.sessions() as session, session.begin():
        assert freeze_config_version_chain(session, entries.agent.current_version_id) == frozen
    with postgres.sessions() as session:
        references = get_references(session, entries.prompt.id)
    assert any(
        item.version_id == entries.agent.current_version_id
        and item.referenced_version_id == entries.prompt.current_version_id
        for item in references.configs
    )

    with postgres.sessions() as session:
        update_config(session, entries.api.id, AIConfigUpdate(expected_version=2, enabled=False))
    with postgres.sessions() as session:
        old_api = get_version(session, entries.api.id, 1)
    with postgres.sessions() as session:
        old_model = get_version(session, entries.model.id, 1)
    with postgres.sessions() as session:
        old_agent = get_version(session, entries.agent.id, 1)
    assert old_api.content == entries.api.content
    assert old_model.content == entries.model.content
    assert old_agent.content == entries.agent.content
    with postgres.sessions() as session, session.begin(), pytest.raises(AppError) as caught:
        freeze_config_version_chain(session, entries.agent.current_version_id)
    assert caught.value.code == "AI_CONFIG_DISABLED"


def test_concurrent_config_cas_creates_one_new_snapshot(postgres: PostgreSQLSandbox) -> None:
    original = prompt_config(postgres)
    barrier = Barrier(2, timeout=10)

    def change(name: str) -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                result = update_config(
                    session, original.id, AIConfigUpdate(expected_version=1, name=name)
                )
                assert result.version == 2
                return "accepted"
            except AppError as error:
                assert error.code == "AI_CONFIG_VERSION_CONFLICT"
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(change, ["合成竞争甲", "合成竞争乙"]))
    assert sorted(outcomes) == ["accepted", "conflict"]
    with postgres.sessions() as session:
        versions = session.scalars(
            select(AIConfigVersion)
            .where(AIConfigVersion.config_id == original.id)
            .order_by(AIConfigVersion.version)
        ).all()
    assert [version.version for version in versions] == [1, 2]
    assert versions[0].name == original.name
    assert versions[0].content == original.content.model_dump(mode="json")


def test_unavailable_config_chain_rolls_back_job_and_outbox(postgres: PostgreSQLSandbox) -> None:
    entries = chain(postgres)
    project_id = make_project(postgres)
    with postgres.sessions() as session:
        update_config(session, entries.api.id, AIConfigUpdate(expected_version=1, enabled=False))
    for version_id, expected in [
        (entries.agent.current_version_id, "AI_CONFIG_DISABLED"),
        (uuid4(), "AI_CONFIG_VERSION_NOT_FOUND"),
    ]:
        with postgres.sessions() as session, pytest.raises(AppError) as caught:
            create_job(session, request(project_id, version_id), str(uuid4()))
        assert caught.value.code == expected
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 0
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 0


def test_concurrent_probe_idempotency_freezes_chain_and_one_outbox(
    postgres: PostgreSQLSandbox,
) -> None:
    entries = chain(postgres)
    project_id = make_project(postgres)
    payload = request(project_id, entries.agent.current_version_id)
    key = str(uuid4())
    barrier = Barrier(2, timeout=10)

    def create(_: int) -> UUID:
        barrier.wait()
        with postgres.sessions() as session:
            return create_job(session, payload, key).id

    with ThreadPoolExecutor(max_workers=2) as executor:
        job_ids = list(executor.map(create, [1, 2]))
    assert job_ids[0] == job_ids[1]
    original = read_job(postgres, job_ids[0])
    assert original.configuration is not None
    assert original.configuration["version_ids"] == entries.version_ids
    assert original.resource_scope == {
        "schema_version": 1,
        "config_version_id": str(entries.agent.current_version_id),
        "version_ids": entries.version_ids,
    }
    with postgres.sessions() as session:
        update_config(session, entries.prompt.id, AIConfigUpdate(expected_version=1, enabled=False))
    # A lost response can be replayed even after the original chain becomes unavailable.
    with postgres.sessions() as session:
        assert create_job(session, payload, key).id == original.id
    with postgres.sessions() as session:
        changed = request(project_id, entries.agent.current_version_id)
        changed.input_snapshot = ConfigurationProbeInput(
            config_version_id=entries.agent.current_version_id, variables={"goal": "其他合成目标"}
        )
        with pytest.raises(AppError) as caught:
            create_job(session, changed, key)
    assert caught.value.code == "JOB_IDEMPOTENCY_CONFLICT"
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 1
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 1
    persisted = read_job(postgres, original.id)
    assert persisted.configuration == original.configuration
    with postgres.sessions() as session:
        references = get_references(session, entries.prompt.id)
    assert any(item.job_id == original.id for item in references.jobs)


def test_cancelled_probe_rejects_late_result_without_artifact(postgres: PostgreSQLSandbox) -> None:
    job = submit(postgres, prompt_config(postgres).current_version_id)
    claim = claim_job(postgres.sessions, job.id, 60)
    assert claim is not None
    result = run_configuration_probe(claim)
    with postgres.sessions() as session:
        cancel_job(session, job.id, project_id=job.project_id)
    assert not finish_job(postgres.sessions, claim, result=result)
    assert not finish_job(postgres.sessions, claim, result=result)
    persisted = read_job(postgres, job.id)
    assert persisted.status == "cancelled" and persisted.result is None
    with postgres.sessions() as session:
        attempt = session.scalars(select(JobAttempt).where(JobAttempt.job_id == job.id)).one()
        assert attempt.status == "cancelled" and attempt.finished_at is not None
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 0


def test_probe_completion_is_once_only_and_rejects_wrong_version(
    postgres: PostgreSQLSandbox,
) -> None:
    prompt = prompt_config(postgres)
    job = submit(postgres, prompt.current_version_id)
    claim = claim_job(postgres.sessions, job.id, 60)
    assert claim is not None
    result = run_configuration_probe(claim)
    assert finish_job(postgres.sessions, claim, result=result)
    assert not finish_job(postgres.sessions, claim, result=result)
    with postgres.sessions() as session:
        artifact = session.scalars(select(JobArtifact).where(JobArtifact.job_id == job.id)).one()
        attempt = session.scalars(select(JobAttempt).where(JobAttempt.job_id == job.id)).one()
        assert artifact.attempt_id == attempt.id
        assert artifact.result == result and attempt.status == "succeeded"
    other = submit(postgres, prompt.current_version_id)
    bad_claim = claim_job(postgres.sessions, other.id, 60)
    assert bad_claim is not None
    bad_result = run_configuration_probe(bad_claim)
    bad_result["config_version_id"] = str(uuid4())
    assert finish_job(postgres.sessions, bad_claim, result=bad_result)
    rejected = read_job(postgres, other.id)
    assert rejected.status == "failed" and rejected.error_code == "JOB_RESULT_INVALID"
    assert rejected.result is None
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 1


def test_probe_retry_retains_frozen_history_and_enforces_api_budget(
    postgres: PostgreSQLSandbox,
) -> None:
    entries = chain(postgres, max_retries=1)
    original = submit(postgres, entries.agent.current_version_id)
    with postgres.sessions() as session:
        cancel_job(session, original.id, project_id=original.project_id)
    with postgres.sessions() as session:
        update_config(session, entries.api.id, AIConfigUpdate(expected_version=1, enabled=False))
    barrier = Barrier(2, timeout=10)

    def retry(key: str) -> tuple[str, UUID | None, str]:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                accepted = retry_job(session, original.id, key, project_id=original.project_id)
                return "accepted", accepted.id, key
            except AppError as error:
                assert error.code == "MODEL_RETRY_LIMIT_REACHED"
                return "budget", None, key

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(retry, [str(uuid4()), str(uuid4())]))
    assert sorted(outcome[0] for outcome in outcomes) == ["accepted", "budget"]
    _, accepted_id, key = next(outcome for outcome in outcomes if outcome[0] == "accepted")
    assert accepted_id is not None
    retried = read_job(postgres, accepted_id)
    assert retried.id != original.id and retried.source_job_id == original.id
    assert retried.configuration == original.configuration
    assert retried.input_snapshot == original.input_snapshot
    assert retried.resource_scope == original.resource_scope
    with postgres.sessions() as session:
        assert retry_job(session, original.id, key, project_id=original.project_id).id == retried.id
    with postgres.sessions() as session, pytest.raises(AppError) as sibling_error:
        retry_job(session, original.id, str(uuid4()), project_id=original.project_id)
    assert sibling_error.value.code == "MODEL_RETRY_LIMIT_REACHED"
    with postgres.sessions() as session:
        cancel_job(session, retried.id, project_id=original.project_id)
    with postgres.sessions() as session, pytest.raises(AppError) as caught:
        retry_job(session, retried.id, str(uuid4()), project_id=original.project_id)
    assert caught.value.code == "MODEL_RETRY_LIMIT_REACHED"
    assert read_job(postgres, original.id).status == "cancelled"
    assert read_job(postgres, retried.id).status == "cancelled"
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 2
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 2
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 0


def test_prompt_probe_runs_real_prefork_worker_without_model_or_document_writes(
    postgres: PostgreSQLSandbox, redis_test_url: str, tmp_path: Path
) -> None:
    prompt = prompt_config(postgres)
    job = submit(postgres, prompt.current_version_id)
    with postgres.sessions() as session:
        update_config(
            session,
            prompt.id,
            AIConfigUpdate(
                expected_version=1,
                content=PromptConfigContent(
                    kind="prompt", template="后来修改的目标：{{goal}}", variables=["goal"]
                ),
            ),
        )
    with isolated_worker(postgres, redis_test_url, tmp_path) as worker:
        assert worker.dispatch().published == 1
        worker.publish(job.id)
        completed = worker.wait_for_status(job.id, "succeeded")
        worker.wait_until_consumed()
    assert completed.result is not None
    assert completed.result["content"] == TEMPLATE.replace("{{goal}}", GOAL)
    assert completed.result["config_version_id"] == str(prompt.current_version_id)
    assert completed.result["model_used"] is False
    assert completed.result["writes_performed"] is False
    assert completed.result["requested_model"] is None
    assert completed.result["response_model"] is None
    with postgres.sessions() as session:
        artifacts = session.scalars(select(JobArtifact).where(JobArtifact.job_id == job.id)).all()
        attempts = session.scalars(select(JobAttempt).where(JobAttempt.job_id == job.id)).all()
        assert len(artifacts) == len(attempts) == 1
        assert artifacts[0].result == completed.result
        assert session.scalar(select(func.count()).select_from(Document)) == 0
    with postgres.sessions() as session:
        current = get_config(session, prompt.id)
    assert current.version == 2
