"""A configuration trial consumes only its fixed, synthetic input and version chain."""

import json

from thesis_pilot.core.config import get_settings
from thesis_pilot.modules.ai_configs.service import render_prompt, validate_trial_output
from thesis_pilot.modules.jobs.service import JobClaim
from thesis_pilot.providers.deepseek import DeepSeekClient, DeepSeekError, reject_json_constant


def checked_output(snapshot: dict[str, object], content: str) -> None:
    structured = False
    for kind in ("prompt", "agent"):
        node = snapshot.get(kind)
        if isinstance(node, dict) and node.get("output_schema"):
            structured = True
    result: object = content
    if structured:
        try:
            result = json.loads(content, parse_constant=reject_json_constant)
        except (ValueError, RecursionError):
            raise DeepSeekError("MODEL_INVALID_RESPONSE") from None
    try:
        validate_trial_output(snapshot, result)
    except Exception:
        raise DeepSeekError("MODEL_INVALID_RESPONSE") from None


def run_configuration_probe(claim: JobClaim) -> dict[str, object]:
    source, config, scope = claim.probe_input, claim.probe_configuration, claim.probe_scope
    if source is None or config is None or scope is None:
        raise DeepSeekError("MODEL_NOT_CONFIGURED")
    snapshot = config.model_dump(mode="json", exclude_none=True)
    requested_model = response_model = None
    if config.config_kind == "prompt":
        content = render_prompt(snapshot, source.variables)
    else:
        api = config.api
        if api is None:
            raise DeepSeekError("MODEL_NOT_CONFIGURED")
        client = DeepSeekClient(
            get_settings().deepseek_api_key.get_secret_value(),
            timeout_seconds=api.timeout_seconds,
        )
        if config.config_kind == "api":
            content = "\n".join(client.models())
        else:
            model = config.model
            if model is None:
                raise DeepSeekError("MODEL_NOT_CONFIGURED")
            prompt = render_prompt(snapshot, source.variables)
            instructions = config.agent.instructions if config.agent is not None else ""
            # UTF-8 bytes conservatively upper-bound ordinary text token consumption.
            # Reserve message framing as well as the actual configured output budget.
            budget = (
                len(prompt.encode()) + len(instructions.encode()) + model.max_output_tokens + 128
            )
            if budget > model.context_limit:
                raise DeepSeekError("MODEL_CONTEXT_LIMIT_EXCEEDED")
            completion = client.complete(
                model.model_code,
                prompt,
                instructions=instructions,
                temperature=model.temperature,
                max_output_tokens=model.max_output_tokens,
            )
            content, response_model = completion.content, completion.response_model
            requested_model = model.model_code
            checked_output(snapshot, content)
    if not content.strip() or len(content) > 50000:
        raise DeepSeekError("MODEL_OUTPUT_TOO_LARGE")
    return {
        "kind": "configuration_probe",
        "schema_version": 1,
        "job_id": str(claim.job_id),
        "project_id": str(claim.project_id),
        "config_version_id": str(config.config_version_id),
        "config_kind": config.config_kind,
        "version_ids": {kind: str(value) for kind, value in config.version_ids.items()},
        "model_used": config.config_kind in {"model", "agent"},
        "requested_model": requested_model,
        "response_model": response_model,
        "content": content,
        "writes_performed": False,
    }
