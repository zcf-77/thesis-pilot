"""Versioned configuration facts, validated references and deterministic snapshots."""

import json
import math
from datetime import UTC, datetime
from typing import NoReturn, cast
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import String, func, or_, select, update
from sqlalchemy import cast as sql_cast
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs.models import AIConfig, AIConfigVersion
from thesis_pilot.modules.ai_configs.schemas import (
    TEMPLATE_VARIABLE,
    AgentConfigContent,
    AIConfigCopy,
    AIConfigCreate,
    AIConfigJobReference,
    AIConfigPage,
    AIConfigRead,
    AIConfigReference,
    AIConfigReferences,
    AIConfigUpdate,
    AIConfigVersionPage,
    AIConfigVersionRead,
    ConfigContent,
    ConfigKind,
    ModelConfigContent,
    PromptConfigContent,
)

CONTENT: TypeAdapter[ConfigContent] = TypeAdapter(ConfigContent)
ROLE_CAPABILITY = {
    "general": "text",
    "literature": "search",
    "content": "text",
    "format": "format",
    "progress": "plan",
    "review": "review",
}
ALLOWED_VARIABLES = {"context", "goal", "requirements", "materials"}


def _error(code: str, message: str, status: int = 422) -> AppError:
    return AppError("AI_CONFIG_" + code, message, status)


def _snapshot(session: Session, config: AIConfig, version: int | None = None) -> AIConfigVersion:
    result = session.scalar(
        select(AIConfigVersion).where(
            AIConfigVersion.config_id == config.id,
            AIConfigVersion.version == (version if version is not None else config.version),
        )
    )
    if result is None:
        raise _error("VERSION_NOT_FOUND", "配置版本不存在。", 404)
    return result


def _read(session: Session, config: AIConfig) -> AIConfigRead:
    version = _snapshot(session, config)
    content = CONTENT.validate_python(version.content)
    return AIConfigRead(
        id=config.id,
        kind=content.kind,
        name=config.name,
        enabled=config.enabled,
        version=config.version,
        current_version_id=version.id,
        content=content,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


def _enabled_version(
    session: Session, version_id: UUID, kind: ConfigKind | None = None
) -> tuple[AIConfigVersion, ConfigContent]:
    snapshot = session.get(AIConfigVersion, version_id)
    if snapshot is None:
        raise _error("VERSION_NOT_FOUND", "关联的配置版本不存在。", 404)
    config = session.scalar(
        select(AIConfig).where(AIConfig.id == snapshot.config_id).with_for_update()
    )
    if config is None:
        raise _error("NOT_FOUND", "配置不存在。", 404)
    if not config.enabled:
        raise _error("DISABLED", "配置或关联配置已停用。", 409)
    content = CONTENT.validate_python(snapshot.content)
    if content.kind != config.kind or (kind is not None and content.kind != kind):
        raise _error("REFERENCE_INVALID", "关联配置的类型不符合要求。")
    return snapshot, content


def _dependencies(session: Session, content: ConfigContent) -> dict[str, AIConfigVersion]:
    nodes: dict[str, AIConfigVersion] = {}
    if isinstance(content, ModelConfigContent):
        api, _ = _enabled_version(session, content.api_version_id, "api")
        nodes["api"] = api
    elif isinstance(content, AgentConfigContent):
        model, model_content = _enabled_version(session, content.model_version_id, "model")
        prompt, prompt_content = _enabled_version(session, content.prompt_version_id, "prompt")
        if not isinstance(model_content, ModelConfigContent) or not isinstance(
            prompt_content, PromptConfigContent
        ):
            raise _error("REFERENCE_INVALID", "智能体的模型或提示词引用无效。")
        if ROLE_CAPABILITY[content.role] not in model_content.capabilities:
            raise _error("REFERENCE_INVALID", "模型能力与智能体职责不兼容。")
        if not set(content.input_schema).issubset(prompt_content.variables):
            raise _error("SCHEMA_INVALID", "智能体输入结构包含提示词未声明的变量。")
        for field, field_type in content.output_schema.items():
            if (
                field in prompt_content.output_schema
                and prompt_content.output_schema[field] != field_type
            ):
                raise _error("SCHEMA_INVALID", "智能体与提示词的输出结构冲突。")
        nodes.update(_dependencies(session, model_content))
        nodes.update(model=model, prompt=prompt)
    return nodes


def _name_conflict(error: IntegrityError) -> bool:
    diagnostic = getattr(error.orig, "diag", None)
    return (
        getattr(diagnostic, "constraint_name", None) == "uq_ai_configs_kind_name"
        or str(error.orig) == "UNIQUE constraint failed: ai_configs.kind, ai_configs.name"
    )


def _insert(session: Session, data: AIConfigCreate) -> AIConfigRead:
    _dependencies(session, data.content)
    config = AIConfig(name=data.name, kind=data.content.kind, enabled=data.enabled)
    session.add(config)
    session.flush()
    session.add(
        AIConfigVersion(
            config_id=config.id,
            version=1,
            name=data.name,
            content=data.content.model_dump(mode="json"),
        )
    )
    session.flush()
    return _read(session, config)


def create_config(session: Session, data: AIConfigCreate) -> AIConfigRead:
    try:
        with session.begin():
            return _insert(session, data)
    except IntegrityError as error:
        if _name_conflict(error):
            raise _error("NAME_CONFLICT", "同一配置库已存在该名称。", 409) from None
        raise


def list_configs(
    session: Session, *, limit: int, offset: int, kind: ConfigKind | None = None
) -> AIConfigPage:
    with session.begin():
        query = select(AIConfig)
        count = select(func.count()).select_from(AIConfig)
        if kind is not None:
            query = query.where(AIConfig.kind == kind)
            count = count.where(AIConfig.kind == kind)
        configs = session.scalars(
            query.order_by(AIConfig.created_at.desc(), AIConfig.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return AIConfigPage(
            items=[_read(session, config) for config in configs],
            total=session.scalar(count) or 0,
            limit=limit,
            offset=offset,
        )


def get_config(session: Session, config_id: UUID) -> AIConfigRead:
    with session.begin():
        config = session.get(AIConfig, config_id)
        if config is None:
            raise _error("NOT_FOUND", "配置不存在。", 404)
        return _read(session, config)


def update_config(session: Session, config_id: UUID, data: AIConfigUpdate) -> AIConfigRead:
    try:
        with session.begin():
            # Match the entry-to-dependency lock order used by chain freezing;
            # otherwise editing a model could hold its API while waiting for a
            # model row already locked by a simultaneous agent trial.
            current = session.scalar(
                select(AIConfig).where(AIConfig.id == config_id).with_for_update()
            )
            if current is None:
                raise _error("NOT_FOUND", "配置不存在。", 404)
            if current.version != data.expected_version:
                raise _error("VERSION_CONFLICT", "配置已修改，请重新读取后保存。", 409)
            snapshot = _snapshot(session, current)
            content = data.content or CONTENT.validate_python(snapshot.content)
            if content.kind != current.kind:
                raise _error("KIND_MISMATCH", "不能改变已有配置所属的库。")
            if data.content is not None or data.enabled is True:
                _dependencies(session, content)
            values: dict[str, object] = {
                "name": data.name if data.name is not None else current.name,
                "enabled": data.enabled if data.enabled is not None else current.enabled,
                "version": AIConfig.version + 1,
                "updated_at": datetime.now(UTC),
            }
            config = session.scalars(
                update(AIConfig)
                .where(AIConfig.id == config_id, AIConfig.version == data.expected_version)
                .values(**values)
                .returning(AIConfig)
                .execution_options(synchronize_session=False, populate_existing=True)
            ).one_or_none()
            if config is None:
                raise _error("VERSION_CONFLICT", "配置已修改，请重新读取后保存。", 409)
            session.add(
                AIConfigVersion(
                    config_id=config.id,
                    version=config.version,
                    name=config.name,
                    content=content.model_dump(mode="json"),
                )
            )
            session.flush()
            return _read(session, config)
    except IntegrityError as error:
        if _name_conflict(error):
            raise _error("NAME_CONFLICT", "同一配置库已存在该名称。", 409) from None
        raise


def copy_config(session: Session, config_id: UUID, data: AIConfigCopy) -> AIConfigRead:
    try:
        with session.begin():
            config = session.get(AIConfig, config_id)
            if config is None:
                raise _error("NOT_FOUND", "配置不存在。", 404)
            version = _snapshot(session, config, data.source_version)
            return _insert(
                session,
                AIConfigCreate(name=data.name, content=CONTENT.validate_python(version.content)),
            )
    except IntegrityError as error:
        if _name_conflict(error):
            raise _error("NAME_CONFLICT", "同一配置库已存在该名称。", 409) from None
        raise


def list_versions(
    session: Session, config_id: UUID, *, limit: int, offset: int
) -> AIConfigVersionPage:
    with session.begin():
        if session.get(AIConfig, config_id) is None:
            raise _error("NOT_FOUND", "配置不存在。", 404)
        query = select(AIConfigVersion).where(AIConfigVersion.config_id == config_id)
        versions = session.scalars(
            query.order_by(AIConfigVersion.version.desc()).limit(limit).offset(offset)
        ).all()
        total = (
            session.scalar(
                select(func.count())
                .select_from(AIConfigVersion)
                .where(AIConfigVersion.config_id == config_id)
            )
            or 0
        )
        return AIConfigVersionPage(
            items=[AIConfigVersionRead.model_validate(version) for version in versions],
            total=total,
            limit=limit,
            offset=offset,
        )


def get_version(session: Session, config_id: UUID, version: int) -> AIConfigVersionRead:
    with session.begin():
        config = session.get(AIConfig, config_id)
        if config is None:
            raise _error("NOT_FOUND", "配置不存在。", 404)
        return AIConfigVersionRead.model_validate(_snapshot(session, config, version))


def freeze_config_version_chain(session: Session, version_id: UUID) -> dict[str, object]:
    """Caller owns transaction; lock availability and freeze exact immutable versions."""
    version, content = _enabled_version(session, version_id)
    nodes = _dependencies(session, content)
    nodes[content.kind] = version
    result: dict[str, object] = {
        "schema_version": 1,
        "config_kind": content.kind,
        "config_version_id": str(version.id),
        "version_ids": {kind: str(node.id) for kind, node in sorted(nodes.items())},
    }
    for kind, node in sorted(nodes.items()):
        result[kind] = CONTENT.validate_python(node.content).model_dump(mode="json")
    return result


get_config_version_chain = freeze_config_version_chain


def get_references(session: Session, config_id: UUID) -> AIConfigReferences:
    # Jobs owns the query over its persisted snapshots; no task writes occur here.
    from thesis_pilot.modules.jobs.service import get_config_job_references

    with session.begin():
        if session.get(AIConfig, config_id) is None:
            raise _error("NOT_FOUND", "配置不存在。", 404)
        target = aliased(AIConfigVersion)
        # UUID normalization also supports SQLite's hexadecimal test storage;
        # filtering and bounding remain in SQL before any rows are materialized.
        target_versions = (
            select(
                target.id.label("version_id"),
                func.replace(sql_cast(target.id, String), "-", "").label("normalized_id"),
            )
            .where(target.config_id == config_id)
            .subquery()
        )
        references: list[AIConfigReference] = []
        for version, root, referenced_id in session.execute(
            select(AIConfigVersion, AIConfig, target_versions.c.version_id)
            .join(AIConfig, AIConfig.id == AIConfigVersion.config_id)
            .join(
                target_versions,
                or_(
                    *(
                        func.replace(AIConfigVersion.content[key].as_string(), "-", "")
                        == target_versions.c.normalized_id
                        for key in ("api_version_id", "model_version_id", "prompt_version_id")
                    )
                ),
            )
            .order_by(AIConfig.id, AIConfigVersion.version.desc(), AIConfigVersion.id)
            .limit(101)
        ):
            references.append(
                AIConfigReference(
                    config_id=root.id,
                    version_id=version.id,
                    kind=cast(ConfigKind, root.kind),
                    name=version.name,
                    version=version.version,
                    enabled=root.enabled,
                    current=root.version == version.version,
                    referenced_version_id=referenced_id,
                )
            )
        jobs = get_config_job_references(session, config_id, limit=101)
        return AIConfigReferences(
            configs=references[:100],
            jobs=[AIConfigJobReference.model_validate(value) for value in jobs[:100]],
            configs_truncated=len(references) > 100,
            jobs_truncated=len(jobs) > 100,
        )


def _value_matches(value: object, expected: str) -> bool:
    return {
        "string": isinstance(value, str),
        "number": isinstance(value, (int, float))
        and not isinstance(value, bool)
        and (not isinstance(value, float) or math.isfinite(value)),
        "boolean": isinstance(value, bool),
        "array": isinstance(value, list),
        "object": isinstance(value, dict),
    }.get(expected, False)


def _reject_json_constant(value: str) -> NoReturn:
    raise ValueError("非标准 JSON 数值。")


def render_prompt(snapshot: dict[str, object], variables: dict[str, str]) -> str:
    if not set(variables).issubset(ALLOWED_VARIABLES) or any(
        not isinstance(value, str) or not value.strip() for value in variables.values()
    ):
        raise _error("VARIABLE_INVALID", "试跑变量包含未知字段、空值或非文字内容。")
    raw_prompt = snapshot.get("prompt")
    prompt = (
        PromptConfigContent.model_validate(raw_prompt) if isinstance(raw_prompt, dict) else None
    )
    if prompt is not None and set(prompt.variables) != set(variables):
        raise _error("VARIABLE_INVALID", "试跑输入必须与提示词声明变量完全对应。")
    for key in ("prompt", "agent"):
        node = snapshot.get(key)
        if not isinstance(node, dict):
            continue
        for field, field_type in cast(dict[str, str], node.get("input_schema", {})).items():
            if field not in variables:
                raise _error("SCHEMA_INVALID", "试跑输入缺少结构要求的字段。")
            value: object = variables[field]
            if field_type != "string":
                try:
                    value = json.loads(variables[field], parse_constant=_reject_json_constant)
                except (ValueError, TypeError):
                    raise _error("SCHEMA_INVALID", "试跑输入不符合声明的数据类型。") from None
            if not _value_matches(value, field_type):
                raise _error("SCHEMA_INVALID", "试跑输入不符合声明的数据类型。")
    if prompt is not None:
        return TEMPLATE_VARIABLE.sub(lambda match: variables[match.group(1)], prompt.template)
    result = "\n".join(
        variables[key]
        for key in ("goal", "context", "requirements", "materials")
        if key in variables
    )
    if not result:
        raise _error("VARIABLE_INVALID", "请提供自制试跑输入。")
    return result


def validate_trial_output(snapshot: dict[str, object], result: object) -> None:
    try:
        json.dumps(result, allow_nan=False)
    except (ValueError, TypeError):
        raise _error("SCHEMA_INVALID", "模型输出包含非标准 JSON 数据。") from None
    for kind in ("prompt", "agent"):
        node = snapshot.get(kind)
        if not isinstance(node, dict) or not node.get("output_schema"):
            continue
        schema = cast(dict[str, str], node["output_schema"])
        if not isinstance(result, dict) or any(
            field not in result or not _value_matches(result[field], field_type)
            for field, field_type in schema.items()
        ):
            raise _error("SCHEMA_INVALID", "模型输出不满足固定配置的字段与类型约束。")
