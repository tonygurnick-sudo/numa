"""Tests for the shared trace→rows orchestration (used by backfill + the live debit Lambda)."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from credit_pricing import processing  # noqa: E402

EVENTS = [
    {
        "type": "assistant",
        "message": {"id": "m1", "model": "global.anthropic.claude-sonnet-4-6"},
    },
    {
        "type": "user",
        "message": {
            "content": [{"type": "text", "text": "Build me a budget spreadsheet"}]
        },
    },
    {
        "type": "result",
        "usage": {
            "input_tokens": 100,
            "output_tokens": 50,
            "cache_read_input_tokens": 1_000_000,
            "cache_creation_input_tokens": 0,
        },
    },
]


def test_process_trace_events() -> None:
    turns, texts, first_ts, last_ts = processing.process_trace_events(
        iter(EVENTS), cache_ttl="1h"
    )
    assert len(turns) == 1
    t = turns[0]
    assert t.model == "global.anthropic.claude-sonnet-4-6"
    assert t.cache_read_tokens == 1_000_000
    # 1M cache-read @ $0.30/MTok = $0.30, plus a little input/output
    assert t.recomputed_usd is not None and t.recomputed_usd > 0.30
    assert any("budget" in x.lower() for x in texts)


def test_build_rows_charge_is_max_of_value_and_floor() -> None:
    turns, _, _, _ = processing.process_trace_events(iter(EVENTS), cache_ttl="1h")
    meta, msgs = processing.build_conversation_rows(
        conversation_id="c1",
        user_sub="u1",
        month="2026-06",
        last_ts="2026-06-01T00:00:00Z",
        turns=turns,
        title="Budget build",
        margin=2.0,
        credit_usd=0.5,
        value_tier="high",
        context="chat",
        source="chat",
    )
    assert meta["PK"] == "CONV#c1" and meta["SK"] == "META"
    assert meta["GSI2PK"] == "MONTH#2026-06"
    assert meta["creditsValue"] == 5  # high, chat context (Scheme A)
    assert meta["creditsCharged"] == max(5, meta["creditsFloor"])
    assert "category" not in meta  # category removed from the live ledger row
    assert len(msgs) == 1 and msgs[0]["SK"].startswith("MSG#")
    assert "content" not in msgs[0] and "text" not in msgs[0]  # privacy


def test_unclassified_charges_floor() -> None:
    turns, _, _, _ = processing.process_trace_events(iter(EVENTS), cache_ttl="1h")
    meta, _ = processing.build_conversation_rows(
        conversation_id="c2",
        user_sub="u1",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
    )
    assert meta["dominantTier"] == "unclassified"
    assert meta["creditsValue"] == 0
    assert meta["creditsCharged"] == meta["creditsFloor"]


def _cheap_turns(n: int):
    evs = []
    for i in range(n):
        evs += [
            {
                "type": "assistant",
                "message": {"id": f"m{i}", "model": "anthropic.claude-sonnet-4-6"},
            },
            {"type": "user", "message": {"content": [{"type": "text", "text": "hi"}]}},
            {
                "type": "result",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 30,
                    "cache_read_input_tokens": 5000,
                    "cache_creation_input_tokens": 0,
                },
            },
        ]
    turns, _, _, _ = processing.process_trace_events(iter(evs), cache_ttl="1h")
    return turns


def test_floor_is_single_ceil_on_total_not_per_message_sum() -> None:
    """Floor = ceil(total*margin/credit), NOT a sum of per-message ceils (which over-charges)."""
    from credit_pricing.credits import floor_credits

    turns = _cheap_turns(10)
    meta, _ = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
        value_tier="low",
        context="chat",
        agentcore_mult=1.0,  # isolate the single-ceil property from the AgentCore uplift
    )
    # built with credit_usd=0.5 + agentcore_mult=1.0, so compare against the same (not the new default)
    assert meta["creditsFloor"] == floor_credits(
        meta["consumptionCostUsd"], credit_usd=0.5
    )
    assert meta["creditsFloor"] < 10  # not the per-message sum of 10 ceils


def test_trivial_cost_caps_value_tier_to_low() -> None:
    """Near-zero consumption caps the value tier at 'low' (anti prompt-injection backstop)."""
    turns, _, _, _ = processing.process_trace_events(
        iter(
            [
                {
                    "type": "assistant",
                    "message": {"id": "m", "model": "anthropic.claude-sonnet-4-6"},
                },
                {
                    "type": "user",
                    "message": {"content": [{"type": "text", "text": "x"}]},
                },
                {
                    "type": "result",
                    "usage": {
                        "input_tokens": 5,
                        "output_tokens": 2,
                        "cache_read_input_tokens": 0,
                        "cache_creation_input_tokens": 0,
                    },
                },
            ]
        ),
        cache_ttl="1h",
    )
    meta, _ = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
        value_tier="very_high",
        context="chat",
    )
    assert meta["dominantTier"] == "low" and meta["creditsValue"] == 1  # low chat = 1


def test_cache_creation_split_priced_per_tier() -> None:
    """5m and 1h cache-creation buckets are billed at their own rates (no global TTL)."""
    from credit_pricing.pricing import recalculate_anthropic_cost

    m = "anthropic.claude-sonnet-4-6"
    c5 = recalculate_anthropic_cost(
        m,
        input_tokens=0,
        output_tokens=0,
        cache_read_tokens=0,
        cache_creation_5m_tokens=100_000,
        cache_creation_1h_tokens=0,
    )
    c1 = recalculate_anthropic_cost(
        m,
        input_tokens=0,
        output_tokens=0,
        cache_read_tokens=0,
        cache_creation_5m_tokens=0,
        cache_creation_1h_tokens=100_000,
    )
    assert c5 is not None and c1 is not None
    assert abs(c5 - 0.375) < 1e-9 and abs(c1 - 0.60) < 1e-9


def test_no_long_context_premium_on_cumulative_usage() -> None:
    """Usage summed across an agentic loop bills at STANDARD rates, however large.

    Regression guard (June 2026): callers feed ResultMessage usage, which aggregates every API
    call in the agentic loop — cumulative cache reads routinely exceed 200K tokens even though no
    single prompt does. A 1M-long-context threshold check on that total falsely billed _200k
    premium rates (~1.6-1.8x inflation on agentic conversations). AWS bills standard rates; so
    must we.
    """
    from credit_pricing.pricing import recalculate_anthropic_cost as rc

    m = "anthropic.claude-sonnet-4-6"
    # A realistic big agentic turn: cumulative prompt side >1.1M tokens across many inner calls.
    big = rc(
        m,
        input_tokens=150_000,
        output_tokens=70_000,
        cache_read_tokens=977_000,
        cache_creation_5m_tokens=0,
        cache_creation_1h_tokens=140_000,
    )
    expected = (150_000 * 3.0 + 70_000 * 15.0 + 977_000 * 0.30 + 140_000 * 6.0) / 1e6
    assert big is not None and abs(big - expected) < 1e-9, big
    # Per-token pricing must be scale-invariant: 10x the tokens = exactly 10x the cost.
    small = rc(
        m,
        input_tokens=15_000,
        output_tokens=7_000,
        cache_read_tokens=97_700,
        cache_creation_5m_tokens=0,
        cache_creation_1h_tokens=14_000,
    )
    assert small is not None and abs(big - small * 10) < 1e-9


def test_per_tier_margin_lifts_floor() -> None:
    """A higher per-tier margin raises the cost-recovery floor for that tier."""
    from credit_pricing.processing import TurnCost

    turns = [
        TurnCost(0, "m0", "anthropic.claude-sonnet-4-6", 0, 0, 0, 0, 1.0)
    ]  # $1.00 cost
    base, _ = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
        value_tier="very_high",
        context="chat",
        agentcore_mult=1.0,
    )
    hi, _ = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
        value_tier="very_high",
        context="chat",
        margins={"very_high": 4.0},
        agentcore_mult=1.0,
    )
    assert base["creditsFloor"] == 4  # ceil($1.00 * 2 / $0.50)
    assert hi["creditsFloor"] == 8  # ceil($1.00 * 4 / $0.50) — per-tier 4x


def test_agentcore_uplift_in_floor_is_default() -> None:
    """The floor is enforced over tokens + AgentCore (default 1.234x), and the recorded margin
    reflects tokens + AgentCore — not tokens alone."""
    from credit_pricing.credits import AGENTCORE_MULT, floor_credits
    from credit_pricing.processing import TurnCost

    turns = [
        TurnCost(0, "m0", "anthropic.claude-sonnet-4-6", 0, 0, 0, 0, 1.0)
    ]  # $1.00 token cost
    meta, _ = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
        value_tier="low",
        context="chat",
    )
    # floor basis = $1.00 x 1.234; floor = ceil(1.234 * 2 / 0.5) = ceil(4.936) = 5
    assert (
        meta["creditsFloor"]
        == floor_credits(1.0 * AGENTCORE_MULT, margin=2.0, credit_usd=0.5)
        == 5
    )
    assert abs(meta["agentCoreCostUsd"] - 0.234) < 1e-6  # recorded uplift
    charged = meta["creditsCharged"]  # max(value low=1, floor 5) = 5
    assert charged == 5
    # margin measured against tokens + AgentCore, and >= the 2x target (ceil rounds it slightly up)
    assert (
        abs(meta["marginVsConsumption"] - (charged * 0.5) / (1.0 * AGENTCORE_MULT))
        < 1e-6
    )
    assert meta["marginVsConsumption"] >= 2.0


def test_extract_tools_and_value_signal() -> None:
    events = [
        {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "tool_use", "name": "gmail_send"},
                    {"type": "text", "text": "ok"},
                ]
            },
        },
        {"type": "user", "message": {"content": [{"type": "text", "text": "hi"}]}},
        {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "tool_use", "name": "slack_post"},
                    {"type": "tool_use", "name": "gmail_send"},  # dup -> deduped
                ]
            },
        },
    ]
    tools = processing.extract_tools(events)
    assert tools == ["gmail_send", "slack_post"]  # first-seen order, deduped
    sig = processing.tools_value_signal(tools)
    assert "gmail_send" in sig and "slack_post" in sig and "(2)" in sig
    assert processing.tools_value_signal([]) == ""  # no tools -> no signal block


def _standard_model_events(total_cost_usd):
    """One turn on the unpriced `numa-standard-model`, with `total_cost_usd` set on the result
    event (the relay's true USD cost) — or omitted entirely when ``total_cost_usd`` is None.
    """
    result_ev = {
        "type": "result",
        "usage": {
            "input_tokens": 1000,
            "output_tokens": 500,
            "cache_read_input_tokens": 0,
            "cache_creation_input_tokens": 0,
        },
    }
    if total_cost_usd is not None:
        result_ev["total_cost_usd"] = total_cost_usd
    return [
        {"type": "assistant", "message": {"id": "m1", "model": "numa-standard-model"}},
        {"type": "user", "message": {"content": [{"type": "text", "text": "hi"}]}},
        result_ev,
    ]


def test_unpriced_model_falls_back_to_result_total_cost_usd() -> None:
    """numa-standard-model: recalculate_anthropic_cost returns None, so the result event's
    total_cost_usd (the relay's true cost) is the cost basis — NOT $0 — and the turn is no longer
    flagged cost_incomplete."""
    turns, _, _, _ = processing.process_trace_events(
        iter(_standard_model_events(0.012)), cache_ttl="1h"
    )
    assert len(turns) == 1
    assert turns[0].recomputed_usd is None  # unknown model -> unpriceable
    assert turns[0].result_cost_usd == 0.012  # captured off the result event

    meta, msgs = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
        agentcore_mult=1.0,  # isolate the fallback cost from the AgentCore uplift
    )
    assert meta["consumptionCostUsd"] == 0.012  # fallback cost, not 0.0
    assert meta["costIncomplete"] is False  # present > 0 fallback rescues the turn
    assert msgs[0]["costIncomplete"] is False
    assert msgs[0]["consumptionCostUsd"] == 0.012


def test_unpriced_model_no_total_cost_usd_stays_incomplete() -> None:
    """No total_cost_usd on the result event -> the turn still meters at $0 and stays
    cost_incomplete (unchanged from before the fallback existed)."""
    turns, _, _, _ = processing.process_trace_events(
        iter(_standard_model_events(None)), cache_ttl="1h"
    )
    assert turns[0].recomputed_usd is None and turns[0].result_cost_usd is None
    meta, msgs = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
    )
    assert meta["consumptionCostUsd"] == 0.0
    assert meta["costIncomplete"] is True
    assert msgs[0]["costIncomplete"] is True


def test_standard_model_value_is_quartered() -> None:
    """The Numa Standard Model bills the VALUE tier at 1/4 (MODEL_VALUE_MULTIPLIER). The
    cost-recovery floor is left untouched (it already reflects the cheap real cost), so the charge
    is max(value/4, floor) — here value/4 (1.25) binds over the cheap-model floor.
    """
    from credit_pricing.credits import floor_credits

    turns, _, _, _ = processing.process_trace_events(
        iter(_standard_model_events(0.012)), cache_ttl="1h"
    )
    assert processing.conversation_value_multiplier(turns) == 0.25
    meta, _ = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
        value_tier="high",
        context="chat",
        agentcore_mult=1.0,  # isolate the value math from the AgentCore uplift
    )
    assert meta["creditsValue"] == 1.25  # high chat = 5, x0.25
    # Floor reflects the cheap real cost (NOT discounted), at tenth-credit granularity — and sits
    # well below the quartered value, so the value binds. Parametric so a granularity change is safe.
    assert meta["creditsFloor"] == floor_credits(0.012, margin=2.0, credit_usd=0.5)
    assert meta["creditsFloor"] < meta["creditsValue"]
    assert (
        meta["creditsCharged"] == 1.25
    )  # max(1.25, floor) -> the discounted value binds


def test_premium_model_value_not_discounted() -> None:
    """Control: an Anthropic (Premium) conversation at the same tier keeps the FULL value price —
    the multiplier only applies when every turn ran on a discounted model."""
    turns, _, _, _ = processing.process_trace_events(iter(EVENTS), cache_ttl="1h")
    assert processing.conversation_value_multiplier(turns) == 1.0
    meta, _ = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
        value_tier="high",
        context="chat",
    )
    assert meta["creditsValue"] == 5  # full value, no discount


def test_standard_with_synthetic_turn_still_quartered() -> None:
    """A Standard conversation with a failed/blank turn — the SDK injects an assistant message with
    model='<synthetic>', $0 cost, 0 tokens — must STILL bill at 1/4. The synthetic turn must not
    cancel the discount. Real-trace regression: a flat max() over the model set returned 1.0 here
    (seen on nd-labs whenever a Standard turn errored, e.g. an upstream failure)."""
    evs = _standard_model_events(0.012) + [
        {"type": "assistant", "message": {"id": "m2", "model": "<synthetic>"}},
        {"type": "user", "message": {"content": [{"type": "text", "text": "retry"}]}},
        {
            "type": "result",
            "usage": {
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            },
            "total_cost_usd": 0.0,
            "is_error": True,
        },
    ]
    turns, _, _, _ = processing.process_trace_events(iter(evs), cache_ttl="1h")
    assert processing.conversation_value_multiplier(turns) == 0.25
    meta, _ = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
        value_tier="high",
        context="chat",
    )
    assert (
        meta["creditsValue"] == 1.25
    )  # 5 x 0.25 — discount survives the synthetic turn


def _opus_events(model: str = "us.anthropic.claude-opus-4-6-v1"):
    """One turn on Opus (Expert tier), regional-prefixed id to exercise prefix stripping."""
    return [
        {"type": "assistant", "message": {"id": "m1", "model": model}},
        {"type": "user", "message": {"content": [{"type": "text", "text": "hi"}]}},
        {
            "type": "result",
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 500,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            },
        },
    ]


def test_opus_model_value_is_tripled() -> None:
    """The Expert model (Opus) bills the VALUE tier at 3x (MODEL_VALUE_MULTIPLIER), regional
    prefix stripped to match the canonical bare id."""
    turns, _, _, _ = processing.process_trace_events(
        iter(_opus_events()), cache_ttl="1h"
    )
    assert processing.conversation_value_multiplier(turns) == 3.0
    meta, _ = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
        value_tier="high",
        context="chat",
    )
    assert meta["creditsValue"] == 15  # high chat = 5, x3.0


def test_opus_with_haiku_sidecalls_still_tripled() -> None:
    """An Opus conversation also contains the CLI's internal Haiku helper turns — they must NOT
    dilute the 3x Expert multiplier (max across models, not all-must-match)."""
    evs = _opus_events() + [
        {
            "type": "assistant",
            "message": {
                "id": "m2",
                "model": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            },
        },
        {"type": "user", "message": {"content": [{"type": "text", "text": "tool"}]}},
        {
            "type": "result",
            "usage": {
                "input_tokens": 100,
                "output_tokens": 30,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            },
        },
    ]
    turns, _, _, _ = processing.process_trace_events(iter(evs), cache_ttl="1h")
    assert processing.conversation_value_multiplier(turns) == 3.0
    meta, _ = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
        value_tier="high",
        context="chat",
    )
    assert meta["creditsValue"] == 15


def test_known_anthropic_ignores_total_cost_usd_fallback() -> None:
    """For a priced model the recompute wins and a stray result-event total_cost_usd is ignored —
    the fallback path is strictly None-only, so known-model behaviour is byte-identical.
    """
    events = [
        {
            "type": "assistant",
            "message": {"id": "m1", "model": "anthropic.claude-sonnet-4-6"},
        },
        {"type": "user", "message": {"content": [{"type": "text", "text": "hi"}]}},
        {
            "type": "result",
            "total_cost_usd": 999.0,  # absurd value that must NOT be used
            "usage": {
                "input_tokens": 1_000_000,
                "output_tokens": 0,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            },
        },
    ]
    turns, _, _, _ = processing.process_trace_events(iter(events), cache_ttl="1h")
    assert turns[0].recomputed_usd == 3.0  # 1M input @ $3.00/MTok
    meta, _ = processing.build_conversation_rows(
        conversation_id="c",
        user_sub="u",
        month="2026-06",
        last_ts=None,
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.5,
        agentcore_mult=1.0,
    )
    assert meta["consumptionCostUsd"] == 3.0  # recompute, not the 999.0 trace value
    assert meta["costIncomplete"] is False


def test_agent_id_flows_to_meta() -> None:
    turns, _, _, _ = processing.process_trace_events(iter(EVENTS), cache_ttl="1h")
    common: dict[str, Any] = dict(
        conversation_id="c1",
        user_sub="u1",
        month="2026-06",
        last_ts="2026-06-01T00:00:00Z",
        turns=turns,
        title="x",
        margin=2.0,
        credit_usd=0.3,
        value_tier="medium",
    )
    meta, _ = processing.build_conversation_rows(
        **common, context="agent", source="agent", agent_id="agt-123"
    )
    assert meta["agentId"] == "agt-123"  # stored on agent runs for the name join
    meta2, _ = processing.build_conversation_rows(
        **common, context="chat", source="chat"
    )
    assert "agentId" not in meta2  # omitted for plain chat


if __name__ == "__main__":
    test_process_trace_events()
    test_build_rows_charge_is_max_of_value_and_floor()
    test_unclassified_charges_floor()
    test_floor_is_single_ceil_on_total_not_per_message_sum()
    test_trivial_cost_caps_value_tier_to_low()
    test_cache_creation_split_priced_per_tier()
    test_no_long_context_premium_on_cumulative_usage()
    test_per_tier_margin_lifts_floor()
    test_agentcore_uplift_in_floor_is_default()
    test_extract_tools_and_value_signal()
    test_unpriced_model_falls_back_to_result_total_cost_usd()
    test_unpriced_model_no_total_cost_usd_stays_incomplete()
    test_known_anthropic_ignores_total_cost_usd_fallback()
    test_agent_id_flows_to_meta()
    print("processing tests OK")
