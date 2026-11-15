"""SG-07 deterministic configuration, version, reference and rendering contracts."""

from copy import deepcopy
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs import service
from thesis_pilot.modules.ai_configs.models import AIConfig, AIConfigVersion
from thesis_pilot.modules.ai_configs.schemas import (
    AgentConfigContent,
    AIConfigCopy,
    AIConfigCreate,
    AIConfigUpdate,
    APIConfigContent,
    ModelConfigContent,
    PromptConfigContent,
)


def chain(session: Session):
    api = service.create_config(
        session, AIConfigCreate(name="自制官方接口", content=APIConfigContent(kind="api"))
    )
    model = service.create_config(
        session,
        AIConfigCreate(
            name="自制模型配置",
            content=ModelConfigContent(
                kind="model",
                api_version_id=api.current_version_id,
                model_code="deepseek-flash",
                capabilities=["text"],
            ),
        ),
    )
    prompt = service.create_config(
        session,
        AIConfigCreate(
            name="自制建议模板",
            content=PromptConfigContent(
                kind="prompt",
                template="请给建议：{{ goal }}；自制材料：{{context}}",
                variables=["goal", "context"],
                input_schema={"goal": "string", "context": "string"},
                output_schema={"suggestions": "array"},
            ),
        ),
    )
    agent = service.create_config(
        session,
        AIConfigCreate(
            name="自制内容助手",
            content=AgentConfigContent(
                kind="agent",
                role="content",
                instructions="只给建议，由本人决定。",
                model_version_id=model.current_version_id,
                prompt_version_id=prompt.current_version_id,
                output_schema={"suggestions": "array"},
            ),
        ),
    )
    return api, model, prompt, agent


def test_version_chain_and_copy_preserve_exact_historical_prompt(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        api, model, prompt, agent = chain(session)
        with session.begin():
            frozen = service.freeze_config_version_chain(session, agent.current_version_id)
        original = deepcopy(frozen)
        changed = prompt.content.model_dump(mode="json")
        changed["template"] = "新版：{{goal}} {{context}}"
        service.update_config(
            session,
            prompt.id,
            AIConfigUpdate.model_validate({"expected_version": 1, "content": changed}),
        )
        with session.begin():
            assert (
                service.freeze_config_version_chain(session, agent.current_version_id) == original
            )
        assert frozen["version_ids"] == {
            "api": str(api.current_version_id),
            "model": str(model.current_version_id),
            "prompt": str(prompt.current_version_id),
            "agent": str(agent.current_version_id),
        }
        assert frozen == original
        copy = service.copy_config(
            session, prompt.id, AIConfigCopy(name="旧版模板副本", source_version=1)
        )
        assert copy.id != prompt.id and copy.version == 1
        assert copy.content == prompt.content
        history = service.list_versions(session, prompt.id, limit=1, offset=1)
        assert history.total == 2 and history.items[0].id == prompt.current_version_id


def test_disable_blocks_new_chain_but_history_and_management_remain_readable(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        api, _, _, agent = chain(session)
        service.update_config(session, api.id, AIConfigUpdate(expected_version=1, enabled=False))
        assert service.get_version(session, api.id, 1).id == api.current_version_id
        with pytest.raises(AppError) as captured, session.begin():
            service.freeze_config_version_chain(session, agent.current_version_id)
        assert captured.value.code == "AI_CONFIG_DISABLED"
        renamed = service.update_config(
            session, agent.id, AIConfigUpdate(expected_version=1, name="无效依赖仍可整理")
        )
        assert renamed.version == 2
        assert not service.update_config(
            session, agent.id, AIConfigUpdate(expected_version=2, enabled=False)
        ).enabled
        with pytest.raises(AppError) as captured:
            service.copy_config(session, agent.id, AIConfigCopy(name="不可创建的副本"))
        assert captured.value.code == "AI_CONFIG_DISABLED"


def test_cas_name_conflict_and_kind_change_never_overwrite_current(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        first = service.create_config(
            session, AIConfigCreate(name="原配置", content=APIConfigContent(kind="api"))
        )
        changed = service.update_config(
            session, first.id, AIConfigUpdate(expected_version=1, name="新配置")
        )
        with pytest.raises(AppError) as stale:
            service.update_config(
                session, first.id, AIConfigUpdate(expected_version=1, name="过期")
            )
        assert stale.value.code == "AI_CONFIG_VERSION_CONFLICT"
        with pytest.raises(AppError) as conflict:
            service.create_config(
                session, AIConfigCreate(name="新配置", content=APIConfigContent(kind="api"))
            )
        assert conflict.value.code == "AI_CONFIG_NAME_CONFLICT"
        with pytest.raises(AppError) as different:
            service.update_config(
                session,
                first.id,
                AIConfigUpdate(
                    expected_version=2,
                    content=PromptConfigContent(kind="prompt", template="自制静态模板"),
                ),
            )
        assert different.value.code == "AI_CONFIG_KIND_MISMATCH"
        assert service.get_config(session, first.id) == changed
        assert service.list_versions(session, first.id, limit=20, offset=0).total == 2


def test_references_record_exact_current_and_historical_version_ids(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    from thesis_pilot.modules.jobs import service as jobs

    monkeypatch.setattr(jobs, "get_config_job_references", lambda *_, **_kw: [], raising=False)
    with session_factory() as session:
        _, _, prompt, agent = chain(session)
        service.update_config(
            session, agent.id, AIConfigUpdate(expected_version=1, name="新版助手")
        )
        refs = service.get_references(session, prompt.id)
    assert len(refs.configs) == 2 and refs.jobs == []
    assert {reference.current for reference in refs.configs} == {True, False}
    assert {reference.referenced_version_id for reference in refs.configs} == {
        prompt.current_version_id
    }
    assert {reference.config_id for reference in refs.configs} == {agent.id}


def test_config_commit_failure_leaves_root_and_versions_unchanged(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        config = service.create_config(
            session, AIConfigCreate(name="事务原配置", content=APIConfigContent(kind="api"))
        )

    def fail_commit(session: Session) -> None:
        raise RuntimeError("synthetic config commit failure")

    with session_factory() as session:
        event.listen(session, "before_commit", fail_commit)
        with pytest.raises(RuntimeError, match="synthetic"):
            service.update_config(
                session, config.id, AIConfigUpdate(expected_version=1, name="失败")
            )
        assert not session.in_transaction()
    with session_factory() as session:
        assert service.get_config(session, config.id) == config
        assert session.scalar(select(func.count()).select_from(AIConfigVersion)) == 1


def test_invalid_references_and_role_capability_do_not_create_config(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        api, model, prompt, _ = chain(session)
        for reference, code in (
            (uuid4(), "AI_CONFIG_VERSION_NOT_FOUND"),
            (api.current_version_id, "AI_CONFIG_REFERENCE_INVALID"),
        ):
            with pytest.raises(AppError) as captured:
                service.create_config(
                    session,
                    AIConfigCreate(
                        name="不可用助手",
                        content=AgentConfigContent(
                            kind="agent",
                            role="content",
                            instructions="自制职责",
                            model_version_id=reference,
                            prompt_version_id=prompt.current_version_id,
                        ),
                    ),
                )
            assert captured.value.code == code
        with pytest.raises(AppError) as incompatible:
            service.create_config(
                session,
                AIConfigCreate(
                    name="能力不兼容",
                    content=AgentConfigContent(
                        kind="agent",
                        role="review",
                        instructions="仅评审",
                        model_version_id=model.current_version_id,
                        prompt_version_id=prompt.current_version_id,
                    ),
                ),
            )
        assert incompatible.value.code == "AI_CONFIG_REFERENCE_INVALID"
        assert session.scalar(select(func.count()).select_from(AIConfig)) == 4


@pytest.mark.parametrize(
    "content",
    [
        {"kind": "api", "api_key": "synthetic-not-a-secret"},
        {"kind": "api", "base_url": "http://127.0.0.1/private"},
        {"kind": "api", "credential_ref": "env:ARBITRARY_ENV"},
        {"kind": "prompt", "template": "{{unknown}}", "variables": []},
        {"kind": "prompt", "template": "{{goal}}", "variables": []},
        {"kind": "prompt", "template": "{{goal", "variables": []},
        {"kind": "prompt", "template": "static", "variables": ["goal"]},
    ],
)
def test_content_rejects_secrets_urls_and_invalid_template_variables(content: dict) -> None:
    with pytest.raises(ValidationError):
        AIConfigCreate.model_validate({"name": "无效自制配置", "content": content})


def test_rendering_is_single_pass_and_enforces_inputs_and_structured_output(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        _, _, _, agent = chain(session)
        with session.begin():
            frozen = service.freeze_config_version_chain(session, agent.current_version_id)
    rendered = service.render_prompt(
        frozen, {"goal": "精简", "context": "数据里的 {{goal}} 不是工具"}
    )
    assert "数据里的 {{goal}} 不是工具" in rendered
    assert "请给建议：精简" in rendered
    with pytest.raises(AppError) as missing:
        service.render_prompt(frozen, {"goal": "精简"})
    assert missing.value.code == "AI_CONFIG_VARIABLE_INVALID"
    service.validate_trial_output(frozen, {"suggestions": []})
    for invalid in ("invalid-json", {"suggestions": "wrong-type"}, {}):
        with pytest.raises(AppError) as output:
            service.validate_trial_output(frozen, invalid)
        assert output.value.code == "AI_CONFIG_SCHEMA_INVALID"


def test_input_schema_types_and_plain_text_output_have_explicit_boundaries() -> None:
    prompt = PromptConfigContent(
        kind="prompt",
        template="自制样本 {{context}}",
        variables=["context"],
        input_schema={"context": "array"},
    )
    snapshot = {"prompt": prompt.model_dump(mode="json")}
    assert service.render_prompt(snapshot, {"context": '["合成"]'}) == '自制样本 ["合成"]'
    with pytest.raises(AppError) as wrong_type:
        service.render_prompt(snapshot, {"context": "合成文字"})
    assert wrong_type.value.code == "AI_CONFIG_SCHEMA_INVALID"
    service.validate_trial_output(snapshot, "明确不要求JSON的纯文字结果")
    assert service.render_prompt({}, {"goal": "自制检查"}) == "自制检查"
    with pytest.raises(AppError):
        service.render_prompt(snapshot, {"context": "[NaN]"})
    with pytest.raises(AppError):
        service.validate_trial_output(snapshot, {"nested": [float("inf")]})


def test_references_are_bounded_and_explicitly_report_incomplete_results(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    from thesis_pilot.modules.jobs import service as jobs

    job_references = [
        {
            "job_id": str(uuid4()),
            "project_id": str(uuid4()),
            "kind": "configuration_probe",
            "status": "succeeded",
            "matched_version_ids": [str(uuid4())],
        }
        for _ in range(101)
    ]
    monkeypatch.setattr(
        jobs, "get_config_job_references", lambda *_, **_kw: job_references, raising=False
    )
    with session_factory() as session:
        api, model, _, _ = chain(session)
        for version in range(1, 102):
            service.update_config(
                session,
                model.id,
                AIConfigUpdate(expected_version=version, name=f"合成模型{version}"),
            )
        references = service.get_references(session, api.id)
    assert len(references.configs) == len(references.jobs) == 100
    assert references.configs_truncated and references.jobs_truncated
    assert {reference.referenced_version_id for reference in references.configs} == {
        api.current_version_id
    }
