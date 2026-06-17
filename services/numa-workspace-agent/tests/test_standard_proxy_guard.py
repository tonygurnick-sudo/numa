"""Tests for the Standard-model proxy output guard.

Covers the two bad-output failure modes the proxy must intercept:
  1. DSML tool-call leak — DeepSeek emits `<｜DSML｜…｜>` markup in the reasoning
     channel; the H2 salvage must NOT surface it.
  2. CJK refusal — the model emits a canned Chinese refusal as text; the proxy
     must substitute a clean English decline without leaking the Chinese.
Plus the history-scrub backstop and the no-regression guards (legitimate
reasoning salvage; legitimate Chinese conversation).
"""

import json

import pytest
from numa_workspace_agent import bedrock_mantle_proxy as proxy

# The exact canned CCP refusal observed in the wild (Tiananmen prompt).
_REFUSAL = "作为一个人工智能语言模型，我还没学习如何回答这个问题，您可以向我问一些其它的问题，我会尽力帮您解决的。"
# A real DSML leak fragment (full-width bar U+FF5C).
_DSML = '响应 <｜DSML｜tool_calls><｜DSML｜invoke name="Bash">python3 firm_conflicts.py'


# ── Pure detector unit tests ────────────────────────────────────────────────


def test_looks_like_dsml_positive():
    assert proxy._looks_like_dsml(_DSML)
    assert proxy._looks_like_dsml("text ｜DSML｜ more")


def test_looks_like_dsml_negative_ascii_pipe():
    # ASCII pipes (markdown tables, code) must NOT trip the detector.
    assert not proxy._looks_like_dsml("| col A | col B |\n|---|---|")
    assert not proxy._looks_like_dsml("run `a | grep b` then DSML is just a word")
    assert not proxy._looks_like_dsml("Here is my analysis of the variance.")


def test_scrub_dsml_strips_trailing_run():
    assert proxy._scrub_dsml(_DSML) == "响应"  # the trailing DSML run is removed
    assert proxy._scrub_dsml("clean text") == "clean text"


def test_cjk_refusal_detection():
    # The canned refusal flags regardless of the user-language gate.
    assert proxy._is_cjk_refusal(_REFUSAL, user_is_cjk=False)
    assert proxy._is_cjk_refusal(_REFUSAL, user_is_cjk=True)  # fingerprint wins


def test_cjk_refusal_ignores_single_token_in_english():
    # A stray `响应` token in a long English answer must NOT trip (that's the
    # DSML/token-leak's job, caught at a count floor of 8).
    english = "Here is the response 响应 you asked for, fully in English otherwise."
    assert not proxy._is_cjk_refusal(english, user_is_cjk=False)


def test_cjk_refusal_gated_on_user_language():
    # A full Chinese sentence WITHOUT the fingerprint: suppressed only when the
    # user is writing English; preserved when the user is writing Chinese.
    legit_chinese = "好的，我帮你写一封邮件，主题是关于下周的会议安排。"
    assert proxy._is_cjk_refusal(legit_chinese, user_is_cjk=False)
    assert not proxy._is_cjk_refusal(legit_chinese, user_is_cjk=True)


def test_user_writes_cjk():
    assert proxy._user_writes_cjk(
        {"messages": [{"role": "user", "content": "请用中文帮我写一封邮件"}]}
    )
    assert not proxy._user_writes_cjk(
        {"messages": [{"role": "user", "content": "Ni hao, can you help?"}]}
    )
    # Looks at the MOST RECENT user turn.
    assert not proxy._user_writes_cjk(
        {
            "messages": [
                {"role": "user", "content": "你好"},
                {"role": "assistant", "content": "hi"},
                {"role": "user", "content": "now in english please"},
            ]
        }
    )


def test_scrub_assistant_text():
    assert proxy._scrub_assistant_text(_REFUSAL) == ""  # canned refusal dropped
    assert proxy._scrub_assistant_text(_DSML) == "响应"  # DSML run stripped
    # Legitimate Chinese assistant text (no fingerprint) is left intact.
    legit = "好的，这是你要的邮件草稿。"
    assert proxy._scrub_assistant_text(legit) == legit


def test_history_scrub_in_message_conversion():
    """A poisoned assistant turn is neutralized before going upstream; the user
    turn is never touched."""
    messages = [
        {"role": "user", "content": "What happened in Tiananmen Square in 1989"},
        {"role": "assistant", "content": [{"type": "text", "text": _REFUSAL}]},
        {"role": "user", "content": _REFUSAL},  # user quoting it back — untouched
    ]
    out = proxy._anthropic_to_openai_messages(messages, system=None)
    assistant = [m for m in out if m["role"] == "assistant"]
    # The refusal scrubbed to empty → the assistant turn carries no Chinese.
    assert all(_REFUSAL not in str(m.get("content")) for m in assistant)
    # The user's own message is preserved verbatim.
    assert any(m["role"] == "user" and _REFUSAL in str(m["content"]) for m in out)


# ── Stream integration tests ────────────────────────────────────────────────


def _scripted_relay(scripts):
    """A relay fake that yields a different chunk script on each successive call
    (call 0 → scripts[0], call 1 → scripts[1], …) — used to exercise the retry."""
    calls = {"n": 0}

    async def fake(_body):
        idx = min(calls["n"], len(scripts) - 1)
        calls["n"] += 1
        for c in scripts[idx]:
            yield c

    return fake, calls


def _text_chunks(text, step=4):
    return [
        {"choices": [{"delta": {"content": text[i : i + step]}, "finish_reason": None}]}
        for i in range(0, len(text), step)
    ] + [_finish()]


async def _run_stream(monkeypatch, chunks=None, request_body=None, relay=None):
    if relay is None:

        async def relay(_body):
            for c in chunks:
                yield c

    monkeypatch.setattr(proxy, "_relay_stream_chunks", relay)
    body = request_body or {"messages": [{"role": "user", "content": "hello"}]}
    events = [ev async for ev in proxy._stream_response(body, "numa-standard-model")]
    raw = "".join(events)
    visible_parts: list[str] = []
    has_tool_use = False
    for ev in events:
        for line in ev.splitlines():
            if not line.startswith("data: "):
                continue
            d = json.loads(line[6:])
            if (
                d.get("type") == "content_block_delta"
                and d.get("delta", {}).get("type") == "text_delta"
            ):
                visible_parts.append(d["delta"]["text"])
            if (
                d.get("type") == "content_block_start"
                and d.get("content_block", {}).get("type") == "tool_use"
            ):
                has_tool_use = True
    return raw, "".join(visible_parts), has_tool_use


def _finish(reason="stop"):
    return {
        "choices": [{"delta": {}, "finish_reason": reason}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.0001},
    }


async def test_dsml_leak_not_surfaced(monkeypatch):
    chunks = [
        {"choices": [{"delta": {"reasoning": _DSML}, "finish_reason": None}]},
        _finish(),
    ]
    raw, visible, _ = await _run_stream(monkeypatch, chunks)
    assert "｜DSML｜" not in raw  # markup never reaches the wire
    assert "firm_conflicts.py" not in raw
    assert proxy._DSML_FALLBACK in visible  # clean fallback shown instead


async def test_cjk_refusal_substituted(monkeypatch):
    # Stream the refusal a few chars at a time (mimics token streaming).
    chunks = [
        {
            "choices": [
                {"delta": {"content": _REFUSAL[i : i + 4]}, "finish_reason": None}
            ]
        }
        for i in range(0, len(_REFUSAL), 4)
    ] + [_finish()]
    raw, visible, _ = await _run_stream(monkeypatch, chunks)
    assert _REFUSAL not in raw  # the Chinese never leaks
    assert "作为一个" not in raw
    assert visible == proxy._CJK_DECLINE


async def test_clean_english_text_intact(monkeypatch):
    # The buffer-then-stream design must not drop or reorder a clean answer.
    answer = "Here is the full answer to your question, streamed in several parts."
    chunks = [
        {"choices": [{"delta": {"content": answer[i : i + 7]}, "finish_reason": None}]}
        for i in range(0, len(answer), 7)
    ] + [_finish()]
    _, visible, _ = await _run_stream(monkeypatch, chunks)
    assert visible == answer


async def test_short_clean_answer_flushed(monkeypatch):
    # A short answer below the hold threshold must still flush (post-loop path).
    chunks = [
        {"choices": [{"delta": {"content": "Yes."}, "finish_reason": None}]},
        _finish(),
    ]
    _, visible, _ = await _run_stream(monkeypatch, chunks)
    assert visible == "Yes."


async def test_legit_reasoning_still_salvaged(monkeypatch):
    # No-regression: a real reasoning-only answer (bench 14) is still surfaced.
    answer = "Based on the rubric this essay earns a Merit — clear thesis, some gaps."
    chunks = [
        {"choices": [{"delta": {"reasoning": answer}, "finish_reason": None}]},
        _finish(),
    ]
    _, visible, _ = await _run_stream(monkeypatch, chunks)
    assert visible == answer


async def test_legit_chinese_not_clobbered(monkeypatch):
    # When the USER writes Chinese, a Chinese reply (no fingerprint) flows through.
    reply = "好的，这是你要的邮件草稿，主题是下周会议。"
    chunks = [
        {"choices": [{"delta": {"content": reply[i : i + 4]}, "finish_reason": None}]}
        for i in range(0, len(reply), 4)
    ] + [_finish()]
    body = {"messages": [{"role": "user", "content": "请用中文帮我写一封邮件"}]}
    _, visible, _ = await _run_stream(monkeypatch, chunks, request_body=body)
    assert visible == reply


async def test_cjk_refusal_retried_then_clean(monkeypatch):
    # Attempt 0 stochastically refuses; the retry returns the real answer — the
    # user must get the answer, NOT the decline.
    clean = "A Kubernetes pod is the smallest deployable unit in Kubernetes."
    relay, calls = _scripted_relay([_text_chunks(_REFUSAL), _text_chunks(clean, 7)])
    _, visible, _ = await _run_stream(monkeypatch, relay=relay)
    assert calls["n"] == 2  # the upstream was re-rolled exactly once
    assert visible == clean  # real answer shown
    assert proxy._CJK_DECLINE not in visible  # not the decline


async def test_cjk_refusal_both_attempts_declines(monkeypatch):
    # Censored topic: both attempts refuse (deterministic) → English decline.
    relay, calls = _scripted_relay([_text_chunks(_REFUSAL), _text_chunks(_REFUSAL)])
    raw, visible, _ = await _run_stream(monkeypatch, relay=relay)
    assert calls["n"] == 2  # retried once, then gave up
    assert visible == proxy._CJK_DECLINE
    assert _REFUSAL not in raw


async def test_clean_first_attempt_not_retried(monkeypatch):
    # A clean answer must NOT trigger a retry (no wasted re-roll).
    answer = "The capital of France is Paris."
    relay, calls = _scripted_relay(
        [_text_chunks(answer, 6), _text_chunks("SHOULD NOT BE USED")]
    )
    _, visible, _ = await _run_stream(monkeypatch, relay=relay)
    assert calls["n"] == 1  # only one upstream call
    assert visible == answer


async def test_text_preamble_before_tool_call_preserved(monkeypatch):
    chunks = [
        {"choices": [{"delta": {"content": "Let me check."}, "finish_reason": None}]},
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_1",
                                "function": {
                                    "name": "Bash",
                                    "arguments": '{"cmd":"ls"}',
                                },
                            }
                        ]
                    },
                    "finish_reason": None,
                }
            ]
        },
        _finish("tool_calls"),
    ]
    _, visible, has_tool_use = await _run_stream(monkeypatch, chunks)
    assert "Let me check." in visible  # preamble not stranded in the buffer
    assert has_tool_use
