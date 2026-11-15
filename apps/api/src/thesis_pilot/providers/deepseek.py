"""Bounded DeepSeek official API transport. No caller-controlled network destinations."""

import json
from dataclasses import dataclass
from time import monotonic

import httpx

OFFICIAL_BASE_URL = "https://api.deepseek.com"
ALLOWED_MODELS = frozenset({"deepseek-flash", "deepseek-v4-pro"})
MAX_RESPONSE_BYTES = 512 * 1024
MAX_CONTENT_CHARACTERS = 50000
MODEL_ERROR_CODES = frozenset(
    {
        "MODEL_NOT_CONFIGURED",
        "MODEL_AUTH_FAILED",
        "MODEL_RATE_LIMITED",
        "MODEL_TIMEOUT",
        "MODEL_UNAVAILABLE",
        "MODEL_INVALID_RESPONSE",
        "MODEL_OUTPUT_TOO_LARGE",
        "MODEL_RETRY_LIMIT_REACHED",
        "MODEL_CONTEXT_LIMIT_EXCEEDED",
    }
)


def reject_json_constant(value: str) -> None:
    raise ValueError("invalid JSON constant")


class DeepSeekError(Exception):
    """Contains a stable code only; raw transport exceptions must never cross this boundary."""

    def __init__(self, code: str) -> None:
        self.code = code if code in MODEL_ERROR_CODES else "MODEL_UNAVAILABLE"
        super().__init__(self.code)


@dataclass(frozen=True)
class Completion:
    content: str
    response_model: str


class DeepSeekClient:
    def __init__(
        self,
        api_key: str,
        *,
        timeout_seconds: int = 30,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not api_key or not api_key.isascii() or any(ord(char) < 33 for char in api_key):
            raise DeepSeekError("MODEL_NOT_CONFIGURED")
        if not 1 <= timeout_seconds <= 300:
            raise DeepSeekError("MODEL_NOT_CONFIGURED")
        self._api_key = api_key
        self._timeout = timeout_seconds
        self._transport = transport

    def _request(self, method: str, path: str, payload: dict[str, object] | None = None) -> object:
        # Client lifetime belongs to one invocation; no shared mutable headers or sessions.
        deadline = monotonic() + self._timeout
        try:
            with (
                httpx.Client(
                    base_url=OFFICIAL_BASE_URL,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Accept": "application/json",
                    },
                    timeout=httpx.Timeout(self._timeout, connect=min(self._timeout, 10)),
                    follow_redirects=False,
                    trust_env=False,
                    transport=self._transport,
                ) as client,
                client.stream(method, path, json=payload) as response,
            ):
                if response.status_code in {401, 403}:
                    raise DeepSeekError("MODEL_AUTH_FAILED")
                if response.status_code == 429:
                    raise DeepSeekError("MODEL_RATE_LIMITED")
                if response.status_code != 200:
                    raise DeepSeekError("MODEL_UNAVAILABLE")
                declared = response.headers.get("content-length")
                if declared and declared.isdecimal() and int(declared) > MAX_RESPONSE_BYTES:
                    raise DeepSeekError("MODEL_OUTPUT_TOO_LARGE")
                body = bytearray()
                for chunk in response.iter_bytes():
                    if monotonic() > deadline:
                        raise DeepSeekError("MODEL_TIMEOUT")
                    if len(body) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise DeepSeekError("MODEL_OUTPUT_TOO_LARGE")
                    body.extend(chunk)
                try:
                    return json.loads(body, parse_constant=reject_json_constant)
                except (ValueError, UnicodeError, RecursionError):
                    raise DeepSeekError("MODEL_INVALID_RESPONSE") from None
        except httpx.TimeoutException:
            raise DeepSeekError("MODEL_TIMEOUT") from None
        except httpx.HTTPError:
            raise DeepSeekError("MODEL_UNAVAILABLE") from None
        except DeepSeekError:
            raise
        except Exception:
            raise DeepSeekError("MODEL_UNAVAILABLE") from None

    def models(self) -> list[str]:
        response = self._request("GET", "/models")
        if not isinstance(response, dict) or response.get("object") != "list":
            raise DeepSeekError("MODEL_INVALID_RESPONSE")
        entries = response.get("data")
        if not isinstance(entries, list) or not 1 <= len(entries) <= 1000:
            raise DeepSeekError("MODEL_INVALID_RESPONSE")
        result: list[str] = []
        for entry in entries:
            if not isinstance(entry, dict):
                raise DeepSeekError("MODEL_INVALID_RESPONSE")
            model_id = entry.get("id")
            if not isinstance(model_id, str) or not 1 <= len(model_id) <= 200:
                raise DeepSeekError("MODEL_INVALID_RESPONSE")
            result.append(model_id)
        return result

    def complete(
        self,
        model: str,
        prompt: str,
        *,
        instructions: str = "",
        temperature: float = 0.3,
        max_output_tokens: int = 1024,
    ) -> Completion:
        if (
            model not in ALLOWED_MODELS
            or not prompt.strip()
            or len(prompt) > MAX_CONTENT_CHARACTERS
            or len(instructions) > 10000
            or not 0 <= temperature <= 2
            or not 1 <= max_output_tokens <= 8192
        ):
            raise DeepSeekError("MODEL_NOT_CONFIGURED")
        messages = []
        if instructions:
            messages.append({"role": "system", "content": instructions})
        messages.append({"role": "user", "content": prompt})
        response = self._request(
            "POST",
            "/chat/completions",
            {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_output_tokens,
                "stream": False,
                "thinking": {"type": "disabled"},
            },
        )
        if not isinstance(response, dict):
            raise DeepSeekError("MODEL_INVALID_RESPONSE")
        response_model, choices = response.get("model"), response.get("choices")
        if (
            not isinstance(response_model, str)
            or not 1 <= len(response_model) <= 200
            or not isinstance(choices, list)
            or len(choices) != 1
            or not isinstance(choices[0], dict)
        ):
            raise DeepSeekError("MODEL_INVALID_RESPONSE")
        choice = choices[0]
        if choice.get("finish_reason") == "length":
            raise DeepSeekError("MODEL_OUTPUT_TOO_LARGE")
        message = choice.get("message")
        if (
            choice.get("finish_reason") != "stop"
            or not isinstance(message, dict)
            or message.get("role") != "assistant"
            or message.get("tool_calls")
        ):
            raise DeepSeekError("MODEL_INVALID_RESPONSE")
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise DeepSeekError("MODEL_INVALID_RESPONSE")
        if len(content) > MAX_CONTENT_CHARACTERS:
            raise DeepSeekError("MODEL_OUTPUT_TOO_LARGE")
        return Completion(content=content, response_model=response_model)
