"""Tests for cost reconciliation on the result event + stream log (F-B).

The Standard model's real cost comes from the relay (accumulated in the
in-container proxy). The SDK's own ``total_cost_usd`` is an Anthropic-rate
estimate that's wildly too high for the opaque model. ``override_result_cost``
must put the real cost on BOTH the serialized result event AND back onto the
``stream_log`` — otherwise the later COST / STREAM_COMPLETE log lines emit the
wrong (Anthropic-rate) figure even though the credits/fleet path is correct
(F-B).
"""

from types import SimpleNamespace

from numa_workspace_agent import bedrock_mantle_proxy as proxy
from numa_workspace_agent.sdk_runner import override_result_cost


def test_standard_cost_overrides_result_and_stream_log(monkeypatch):
    # Relay says the turn really cost $0.012; the SDK guessed $0.42.
    monkeypatch.setattr(proxy, "get_accumulated_cost", lambda: 0.012)
    stream_log = SimpleNamespace(total_cost_usd=0.42)
    serialized = {"type": "result", "total_cost_usd": 0.42}

    out = override_result_cost(serialized, stream_log)

    assert out["total_cost_usd"] == 0.012  # result event corrected
    assert out["sdk_reported_cost_usd"] == 0.42  # SDK estimate preserved
    assert stream_log.total_cost_usd == 0.012  # F-B: COST log now reads the real cost


def test_anthropic_path_not_affected_by_standard_override(monkeypatch):
    # No relay accumulator (Anthropic turn) -> get_accumulated_cost returns None,
    # so the stream_log's already-recomputed Anthropic cost is used as-is.
    monkeypatch.setattr(proxy, "get_accumulated_cost", lambda: None)
    stream_log = SimpleNamespace(total_cost_usd=0.031)
    serialized = {"type": "result", "total_cost_usd": 0.040}

    out = override_result_cost(serialized, stream_log)

    assert out["total_cost_usd"] == 0.031
    assert out["sdk_reported_cost_usd"] == 0.040
    assert stream_log.total_cost_usd == 0.031  # untouched


def test_non_result_event_passes_through_untouched(monkeypatch):
    monkeypatch.setattr(proxy, "get_accumulated_cost", lambda: 0.012)
    stream_log = SimpleNamespace(total_cost_usd=0.42)
    serialized = {"type": "assistant", "total_cost_usd": None}

    out = override_result_cost(serialized, stream_log)

    assert out is serialized
    assert stream_log.total_cost_usd == 0.42  # never mutated for non-result events
