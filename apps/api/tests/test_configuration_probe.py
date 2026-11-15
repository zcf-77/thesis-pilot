from dataclasses import dataclass
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs.schemas import (
    AgentConfigContent,
    AIConfigCreate,
    AIConfigUpdate,
    APIConfigContent,
    ModelConfigContent,
    PromptConfigContent,
)
from thesis_pilot.modules.ai_configs.service import create_config, get_references, update_config
from thesis_pilot.modules.documents.models import Document
from thesis_pilot.modules.jobs import probe
from thesis_pilot.modules.jobs.models import Job, JobArtifact, JobAttempt, OutboxEvent, utcnow
from thesis_pilot.modules.jobs.schemas import ConfigurationProbeInput, JobCreate, JobDetail
from thesis_pilot.modules.jobs.service import (
    cancel_job,
    claim_job,
    create_job,
    finish_job,
    get_job_detail,
    retry_job,
)
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.providers.deepseek import Completion, DeepSeekError
from thesis_pilot.workers.execution import execute_job


@dataclass
class Chain:
    project_id: UUID
    api_id: UUID
    api_version: UUID
    model_id: UUID
    model_version: UUID
    prompt_id: UUID
    prompt_version: UUID
    agent_id: UUID
    agent_version: UUID


def chain(
    factory: sessionmaker[Session],
    *,
    retries: int = 2,
    rate: int = 20,
    output_schema: dict[str, str] | None = None,
    context_limit: int = 64000,
) -> Chain:
    with factory() as session:
        project = create_project(session, ProjectCreate(name="配置试跑自制项目"))
        api = create_config(
            session,
            AIConfigCreate(
                name="官方API",
                content=APIConfigContent(
                    kind="api",
                    max_retries=retries,
                    rate_limit_per_minute=rate,
                ),
            ),
        )
        model = create_config(
            session,
            AIConfigCreate(
                name="普通模型",
                content=ModelConfigContent(
                    kind="model",
                    api_version_id=api.current_version_id,
                    model_code="deepseek-flash",
                    capabilities=["text"],
                    temperature=0.4,
                    max_output_tokens=256,
                    context_limit=context_limit,
                ),
            ),
        )
        prompt = create_config(
            session,
            AIConfigCreate(
                name="自制提示词",
                content=PromptConfigContent(
                    kind="prompt",
                    template="请给自制目标建议：{{goal}}",
                    variables=["goal"],
                    output_schema=output_schema or {},
                ),
            ),
        )
        agent = create_config(
            session,
            AIConfigCreate(
                name="自制智能体",
                content=AgentConfigContent(
                    kind="agent",
                    role="general",
                    instructions="只给建议，不修改正式稿。",
                    model_version_id=model.current_version_id,
                    prompt_version_id=prompt.current_version_id,
                ),
            ),
        )
    return Chain(
        project.id,
        api.id,
        api.current_version_id,
        model.id,
        model.current_version_id,
        prompt.id,
        prompt.current_version_id,
        agent.id,
        agent.current_version_id,
    )


def enqueue(
    factory: sessionmaker[Session],
    source: Chain,
    version: UUID,
    *,
    key: str | None = None,
    variables: dict[str, str] | None = None,
) -> UUID:
    with factory() as session:
        return create_job(
            session,
            JobCreate(
                project_id=source.project_id,
                kind="configuration_probe",
                input_snapshot=ConfigurationProbeInput(
                    config_version_id=version, variables=variables or {}
                ),
            ),
            key or str(uuid4()),
        ).id


def detail(factory: sessionmaker[Session], job_id: UUID) -> JobDetail:
    with factory() as session:
        return JobDetail.model_validate(get_job_detail(session, job_id))


def install_provider(
    monkeypatch: pytest.MonkeyPatch,
    *,
    response: str = "自制模型返回建议",
    failure: str | None = None,
) -> list[dict[str, object]]:
    calls: list[dict[str, object]] = []

    class Provider:
        def __init__(self, api_key: str, *, timeout_seconds: int) -> None:
            assert api_key == "synthetic-key"
            assert timeout_seconds == 30

        def models(self) -> list[str]:
            calls.append({"operation": "models"})
            if failure:
                raise DeepSeekError(failure)
            return ["deepseek-flash", "deepseek-v4-pro"]

        def complete(self, model: str, prompt: str, **options: object) -> Completion:
            calls.append({"operation": "complete", "model": model, "prompt": prompt, **options})
            if failure:
                raise DeepSeekError(failure)
            return Completion(content=response, response_model="deepseek-flash")

    monkeypatch.setattr(probe, "DeepSeekClient", Provider)
    monkeypatch.setattr(
        probe, "get_settings", lambda: SimpleNamespace(deepseek_api_key=SecretStr("synthetic-key"))
    )
    return calls


def test_prompt_preview_is_deterministic_fixed_and_never_reads_manuscript_or_key(
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = chain(session_factory)
    job_id = enqueue(session_factory, source, source.prompt_version, variables={"goal": "合成目标"})
    with session_factory() as session:
        update_config(session, source.prompt_id, AIConfigUpdate(expected_version=1, enabled=False))
    monkeypatch.setattr(probe, "get_settings", lambda: pytest.fail("提示词预览不能读取凭据"))
    assert execute_job(session_factory, job_id, 60)
    completed = detail(session_factory, job_id)
    assert completed.result is not None and completed.result.kind == "configuration_probe"
    assert completed.result.content == "请给自制目标建议：合成目标"
    assert not completed.result.model_used and completed.result.response_model is None
    assert completed.result.version_ids == {"prompt": source.prompt_version}
    assert len(completed.artifacts) == 1 and completed.artifacts[0].result == completed.result
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Document)) == 0


def test_api_probe_and_agent_generation_record_exact_modes_parameters_and_references(
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = chain(session_factory)
    calls = install_provider(monkeypatch)
    api_job = enqueue(session_factory, source, source.api_version)
    agent_job = enqueue(
        session_factory, source, source.agent_version, variables={"goal": "合成输入"}
    )
    assert execute_job(session_factory, api_job, 60)
    assert execute_job(session_factory, agent_job, 60)
    api_result, result = (
        detail(session_factory, api_job).result,
        detail(session_factory, agent_job).result,
    )
    assert api_result is not None and not api_result.model_used
    assert result is not None and result.kind == "configuration_probe" and result.model_used
    assert result.requested_model == result.response_model == "deepseek-flash"
    assert result.version_ids == {
        "api": source.api_version,
        "model": source.model_version,
        "prompt": source.prompt_version,
        "agent": source.agent_version,
    }
    assert calls == [
        {"operation": "models"},
        {
            "operation": "complete",
            "model": "deepseek-flash",
            "prompt": "请给自制目标建议：合成输入",
            "instructions": "只给建议，不修改正式稿。",
            "temperature": 0.4,
            "max_output_tokens": 256,
        },
    ]
    with session_factory() as session:
        refs = get_references(session, source.api_id)
        assert {ref.job_id for ref in refs.jobs} == {api_job, agent_job}


def test_server_freezes_configuration_and_idempotency_rejects_forged_snapshot(
    session_factory: sessionmaker[Session],
) -> None:
    source = chain(session_factory)
    request = JobCreate(
        project_id=source.project_id,
        kind="configuration_probe",
        input_snapshot=ConfigurationProbeInput(
            config_version_id=source.prompt_version, variables={"goal": "自制"}
        ),
    )
    with pytest.raises(ValidationError):
        JobCreate.model_validate(
            {**request.model_dump(mode="json"), "configuration": {"schema_version": 1}}
        )
    with session_factory() as session:
        created = create_job(session, request, "probe-idempotency")
        assert create_job(session, request, "probe-idempotency").id == created.id
        different = request.model_copy(
            update={
                "input_snapshot": ConfigurationProbeInput(
                    config_version_id=source.prompt_version, variables={"goal": "另一个输入"}
                )
            }
        )
        with pytest.raises(AppError) as caught:
            create_job(session, different, "probe-idempotency")
        assert caught.value.code == "JOB_IDEMPOTENCY_CONFLICT"
        assert session.scalar(select(func.count()).select_from(Job)) == 1
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_cancelled_late_result_and_duplicate_finish_cannot_create_extra_artifacts(
    session_factory: sessionmaker[Session],
) -> None:
    source = chain(session_factory)
    job_id = enqueue(session_factory, source, source.prompt_version, variables={"goal": "自制"})
    claim = claim_job(session_factory, job_id, 60)
    assert claim is not None
    result = probe.run_configuration_probe(claim)
    with session_factory() as session:
        cancel_job(session, job_id)
    assert not finish_job(session_factory, claim, result=result)
    assert detail(session_factory, job_id).artifacts == []
    next_id = enqueue(session_factory, source, source.prompt_version, variables={"goal": "新试跑"})
    next_claim = claim_job(session_factory, next_id, 60)
    assert next_claim is not None
    result = probe.run_configuration_probe(next_claim)
    assert finish_job(session_factory, next_claim, result=result)
    assert not finish_job(session_factory, next_claim, result=result)
    assert len(detail(session_factory, next_id).artifacts) == 1


def test_fixed_retry_budget_covers_sibling_retries_and_preserves_disabled_config_snapshot(
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = chain(session_factory, retries=1)
    install_provider(monkeypatch, failure="MODEL_TIMEOUT")
    job_id = enqueue(session_factory, source, source.model_version, variables={"goal": "合成输入"})
    assert execute_job(session_factory, job_id, 60)
    assert detail(session_factory, job_id).error_code == "MODEL_TIMEOUT"
    with session_factory() as session:
        update_config(session, source.api_id, AIConfigUpdate(expected_version=1, enabled=False))
        retry = retry_job(session, job_id, "one-explicit-retry")
        retry_id = retry.id
        assert retry.configuration == detail(session_factory, job_id).configuration.model_dump(
            mode="json", exclude_none=True
        )
        assert retry_job(session, job_id, "one-explicit-retry").id == retry_id
        for parent in (job_id, retry_id):
            if parent == retry_id:
                cancel_job(session, parent)
            with pytest.raises(AppError) as caught:
                retry_job(session, parent, str(uuid4()))
            assert caught.value.code == "MODEL_RETRY_LIMIT_REACHED"


def test_credential_rate_limit_spans_api_config_roots_and_versions(
    session_factory: sessionmaker[Session],
) -> None:
    source = chain(session_factory, rate=1)
    first = enqueue(session_factory, source, source.api_version)
    with session_factory() as session:
        other_api = create_config(
            session,
            AIConfigCreate(
                name="另一个API入口",
                content=APIConfigContent(kind="api", rate_limit_per_minute=100),
            ),
        )
    second = enqueue(session_factory, source, other_api.current_version_id)
    assert claim_job(session_factory, first, 60) is not None
    assert claim_job(session_factory, second, 60) is None
    assert detail(session_factory, second).error_code == "MODEL_RATE_LIMITED"


def test_many_deterministic_prompt_attempts_cannot_hide_provider_rate_usage(
    session_factory: sessionmaker[Session],
) -> None:
    source = chain(session_factory, rate=1)
    instant = utcnow()
    # Simulate a busy window without performing a thousand renders or network calls.
    # Prompt-only attempts have no credential and must be excluded before SQL LIMIT.
    job_ids = [uuid4() for _ in range(1002)]
    with session_factory() as session, session.begin():
        session.execute(
            insert(Job),
            [
                {
                    "id": job_id,
                    "project_id": source.project_id,
                    "kind": "configuration_probe",
                    "status": "succeeded",
                    "attempt": 1,
                    "idempotency_key": str(job_id),
                    "request_hash": "a" * 64,
                    "configuration": {"config_kind": "prompt"},
                }
                for job_id in job_ids
            ],
        )
        session.execute(
            insert(JobAttempt),
            [
                {
                    "id": uuid4(),
                    "job_id": job_id,
                    "attempt": 1,
                    "run_token": uuid4(),
                    "status": "succeeded",
                    "started_at": instant,
                    "finished_at": instant,
                }
                for job_id in job_ids
            ],
        )
    first = enqueue(session_factory, source, source.api_version)
    second = enqueue(session_factory, source, source.api_version)
    assert claim_job(session_factory, first, 60) is not None
    assert claim_job(session_factory, second, 60) is None
    assert detail(session_factory, second).error_code == "MODEL_RATE_LIMITED"


def test_schema_invalid_and_context_budget_fail_without_usable_artifact(
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = chain(session_factory, output_schema={"suggestion": "string"})
    install_provider(monkeypatch, response='{"suggestion": 42}')
    job_id = enqueue(session_factory, source, source.agent_version, variables={"goal": "自制"})
    assert execute_job(session_factory, job_id, 60)
    assert detail(session_factory, job_id).error_code == "MODEL_INVALID_RESPONSE"
    assert detail(session_factory, job_id).artifacts == []
    with session_factory() as session:
        changed = update_config(
            session,
            source.model_id,
            AIConfigUpdate(
                expected_version=1,
                content=ModelConfigContent(
                    kind="model",
                    api_version_id=source.api_version,
                    model_code="deepseek-flash",
                    capabilities=["text"],
                    context_limit=256,
                    max_output_tokens=256,
                ),
            ),
        )
    calls = install_provider(monkeypatch)
    over = enqueue(
        session_factory, source, changed.current_version_id, variables={"goal": "保守预算"}
    )
    assert execute_job(session_factory, over, 60)
    assert detail(session_factory, over).error_code == "MODEL_CONTEXT_LIMIT_EXCEEDED"
    assert not calls


def test_tampered_scope_or_result_cannot_succeed(session_factory: sessionmaker[Session]) -> None:
    source = chain(session_factory)
    job_id = enqueue(session_factory, source, source.prompt_version, variables={"goal": "自制"})
    with session_factory() as session, session.begin():
        job = session.get(Job, job_id)
        assert job is not None
        job.resource_scope = {
            "schema_version": 1,
            "config_version_id": str(uuid4()),
            "version_ids": {"prompt": str(source.prompt_version)},
        }
    assert claim_job(session_factory, job_id, 60) is None
    assert detail(session_factory, job_id).error_code == "JOB_INPUT_INVALID"
    fresh = enqueue(session_factory, source, source.prompt_version, variables={"goal": "合法输入"})
    claim = claim_job(session_factory, fresh, 60)
    assert claim is not None
    result = probe.run_configuration_probe(claim)
    result["config_version_id"] = str(uuid4())
    assert finish_job(session_factory, claim, result=result)
    assert detail(session_factory, fresh).error_code == "JOB_RESULT_INVALID"
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 0
