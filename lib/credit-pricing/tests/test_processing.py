"""Tests for the shared trace→rows orchestration (used by backfill + the live debit Lambda)."""

from __future__ import annotations

import sys
from pathlib import Path

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
        category="code_build",
        context="chat",
        source="chat",
    )
    assert meta["PK"] == "CONV#c1" and meta["SK"] == "META"
    assert meta["GSI2PK"] == "MONTH#2026-06"
    assert meta["creditsValue"] == 8  # high, chat context (Scheme A)
    assert meta["creditsCharged"] == max(8, meta["creditsFloor"])
    assert meta["category"] == "code_build"
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
    assert meta["dominantTier"] == "low" and meta["creditsValue"] == 1


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
    assert abs(c5 - 0.375) < 1e-9 and abs(c1 - 0.60) < 1e-9


def test_long_context_tier_premium() -> None:
    """Prompts over 200K tokens bill at the _200k premium rates (1M-context tier)."""
    from credit_pricing.pricing import recalculate_anthropic_cost as rc

    m = "anthropic.claude-sonnet-4-6"
    std = rc(
        m,
        input_tokens=100_000,
        output_tokens=0,
        cache_read_tokens=0,
        cache_creation_tokens=0,
    )
    lng = rc(
        m,
        input_tokens=250_000,
        output_tokens=0,
        cache_read_tokens=0,
        cache_creation_tokens=0,
    )
    assert abs(std - 100_000 * 3.0 / 1e6) < 1e-9  # standard $3/M
    assert abs(lng - 250_000 * 6.0 / 1e6) < 1e-9  # premium $6/M, not 0.75
    # cached tokens count toward the 200K threshold: 150K input + 100K cache_read -> premium
    mix = rc(
        m,
        input_tokens=150_000,
        output_tokens=0,
        cache_read_tokens=100_000,
        cache_creation_tokens=0,
    )
    assert abs(mix - (150_000 * 6.0 + 100_000 * 0.60) / 1e6) < 1e-9
    # a model with no _200k tier (haiku) stays standard even over 200K
    h = rc(
        "anthropic.claude-haiku-4-5-20251001-v1:0",
        input_tokens=250_000,
        output_tokens=0,
        cache_read_tokens=0,
        cache_creation_tokens=0,
    )
    assert abs(h - 250_000 * 1.0 / 1e6) < 1e-9


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
    charged = meta["creditsCharged"]  # max(value low=2, floor 5) = 5
    assert charged == 5
    # margin measured against tokens + AgentCore, and >= the 2x target (ceil rounds it slightly up)
    assert (
        abs(meta["marginVsConsumption"] - (charged * 0.5) / (1.0 * AGENTCORE_MULT))
        < 1e-6
    )
    assert meta["marginVsConsumption"] >= 2.0


if __name__ == "__main__":
    test_process_trace_events()
    test_build_rows_charge_is_max_of_value_and_floor()
    test_unclassified_charges_floor()
    test_floor_is_single_ceil_on_total_not_per_message_sum()
    test_trivial_cost_caps_value_tier_to_low()
    test_cache_creation_split_priced_per_tier()
    test_long_context_tier_premium()
    test_per_tier_margin_lifts_floor()
    test_agentcore_uplift_in_floor_is_default()
    print("processing tests OK")
