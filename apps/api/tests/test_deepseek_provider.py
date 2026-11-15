import json

import httpx
import pytest

from thesis_pilot.providers.deepseek import MAX_RESPONSE_BYTES, DeepSeekClient, DeepSeekError

TEST_KEY = "synthetic-provider-key-only"


def completion(content: str = "自制试跑建议", **changes: object) -> dict[str, object]:
    return {
        "model": "deepseek-flash",
        "choices": [
            {"finish_reason": "stop", "message": {"role": "assistant", "content": content}}
        ],
        **changes,
    }


def test_fixed_official_origin_and_exact_model_parameters() -> None:
    requests: list[httpx.Request] = []

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == f"Bearer {TEST_KEY}"
        if request.url.path == "/models":
            return httpx.Response(200, json={"object": "list", "data": [{"id": "deepseek-flash"}]})
        return httpx.Response(200, json=completion())

    provider = DeepSeekClient(TEST_KEY, transport=httpx.MockTransport(transport))
    assert provider.models() == ["deepseek-flash"]
    result = provider.complete(
        "deepseek-flash",
        "合成问题",
        instructions="仅给建议",
        temperature=0.4,
        max_output_tokens=512,
    )
    assert result.content == "自制试跑建议" and result.response_model == "deepseek-flash"
    assert all(str(request.url).startswith("https://api.deepseek.com/") for request in requests)
    assert json.loads(requests[-1].content) == {
        "model": "deepseek-flash",
        "messages": [
            {"role": "system", "content": "仅给建议"},
            {"role": "user", "content": "合成问题"},
        ],
        "temperature": 0.4,
        "max_tokens": 512,
        "stream": False,
        "thinking": {"type": "disabled"},
    }


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "MODEL_AUTH_FAILED"),
        (403, "MODEL_AUTH_FAILED"),
        (429, "MODEL_RATE_LIMITED"),
        (500, "MODEL_UNAVAILABLE"),
        (402, "MODEL_UNAVAILABLE"),
        (302, "MODEL_UNAVAILABLE"),
    ],
)
def test_stable_errors_never_copy_private_response_and_redirect_is_not_followed(
    status: int, code: str
) -> None:
    requests: list[httpx.Request] = []

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            status,
            text="PRIVATE-PAPER-AND-CREDENTIAL",
            headers={"Location": "https://example.invalid/"},
        )

    with pytest.raises(DeepSeekError) as caught:
        DeepSeekClient(TEST_KEY, transport=httpx.MockTransport(transport)).models()
    assert caught.value.code == code
    assert "PRIVATE" not in str(caught.value) and TEST_KEY not in str(caught.value)
    assert len(requests) == 1


def test_transport_timeout_and_network_errors_are_safe() -> None:
    for exception, code in [
        (httpx.ReadTimeout("PRIVATE-KEY"), "MODEL_TIMEOUT"),
        (httpx.ConnectError("PRIVATE-KEY"), "MODEL_UNAVAILABLE"),
    ]:

        def transport(request: httpx.Request, failure: Exception = exception) -> httpx.Response:
            raise failure

        with pytest.raises(DeepSeekError) as caught:
            DeepSeekClient(TEST_KEY, transport=httpx.MockTransport(transport)).models()
        assert caught.value.code == code and "PRIVATE" not in str(caught.value)


class OversizedBody(httpx.SyncByteStream):
    def __iter__(self):
        yield b"x" * (MAX_RESPONSE_BYTES // 2)
        yield b"x" * (MAX_RESPONSE_BYTES // 2 + 1)


def test_streamed_and_declared_responses_are_bounded() -> None:
    for response in [
        httpx.Response(200, headers={"content-length": str(MAX_RESPONSE_BYTES + 1)}),
        httpx.Response(200, stream=OversizedBody()),
    ]:
        with pytest.raises(DeepSeekError) as caught:
            DeepSeekClient(
                TEST_KEY, transport=httpx.MockTransport(lambda request, value=response: value)
            ).models()
        assert caught.value.code == "MODEL_OUTPUT_TOO_LARGE"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"model": "deepseek-flash", "choices": []},
        completion(
            changes="unexpected",
            choices=[
                {"finish_reason": "tool_calls", "message": {"role": "assistant", "content": "工具"}}
            ],
        ),
        completion(
            choices=[{"finish_reason": "stop", "message": {"role": "assistant", "content": None}}]
        ),
        completion(
            choices=[{"finish_reason": "stop", "message": {"role": "user", "content": "伪造"}}]
        ),
    ],
)
def test_malformed_completion_has_no_usable_result(payload: dict[str, object]) -> None:
    provider = DeepSeekClient(
        TEST_KEY, transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
    )
    with pytest.raises(DeepSeekError) as caught:
        provider.complete("deepseek-flash", "合成输入")
    assert caught.value.code == "MODEL_INVALID_RESPONSE"


def test_truncated_output_and_unknown_requested_model_do_not_fall_back() -> None:
    calls: list[httpx.Request] = []

    def transport(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=completion(choices=[{"finish_reason": "length"}]))

    provider = DeepSeekClient(TEST_KEY, transport=httpx.MockTransport(transport))
    with pytest.raises(DeepSeekError) as caught:
        provider.complete("unknown-model", "合成输入")
    assert caught.value.code == "MODEL_NOT_CONFIGURED" and not calls
    with pytest.raises(DeepSeekError) as caught:
        provider.complete("deepseek-v4-pro", "合成输入")
    assert caught.value.code == "MODEL_OUTPUT_TOO_LARGE" and len(calls) == 1


def test_missing_credential_cannot_make_a_request() -> None:
    with pytest.raises(DeepSeekError) as caught:
        DeepSeekClient("")
    assert caught.value.code == "MODEL_NOT_CONFIGURED"


def test_nonfinite_json_and_elapsed_stream_deadline_are_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = DeepSeekClient(
        TEST_KEY,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, content=b'{"object":"list","data":NaN}')
        ),
    )
    with pytest.raises(DeepSeekError) as caught:
        provider.models()
    assert caught.value.code == "MODEL_INVALID_RESPONSE"
    times = iter([0.0, 2.0])
    monkeypatch.setattr("thesis_pilot.providers.deepseek.monotonic", lambda: next(times))
    provider = DeepSeekClient(
        TEST_KEY,
        timeout_seconds=1,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200, json={"object": "list", "data": [{"id": "deepseek-flash"}]}
            )
        ),
    )
    with pytest.raises(DeepSeekError) as caught:
        provider.models()
    assert caught.value.code == "MODEL_TIMEOUT"
