"""Tests for the pure ledger row builders (schema single-source for backfill + debit).

Runnable standalone (python3 tests/test_ledger.py) or via pytest.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from credit_pricing import ledger  # noqa: E402


def test_meta_item_keys_and_margin() -> None:
    it = ledger.meta_item(
        conversation_id="abc",
        user_sub="u1",
        month="2026-05",
        title="Rydges April revenue validation + misc",
        msg_count=3,
        tiers={"low": 2, "high": 1},
        dominant_tier="low",
        credits_charged=10,
        credits_value=6,
        credits_floor=10,
        floored_msgs=1,
        consumption_cost_usd=2.5,
        last_ts="2026-05-31T00:00:00Z",
        bedrock_region="us-east-1",
    )
    assert it["PK"] == "CONV#abc" and it["SK"] == "META"
    assert it["GSI1PK"] == "USER#u1"
    assert it["GSI1SK"] == "TS#2026-05-31T00:00:00Z"
    assert it["GSI2PK"] == "MONTH#2026-05" and it["GSI2SK"] == "CONV#abc"
    assert it["creditsCharged"] == 10
    # marginVsConsumption = (10 credits x US$0.50) / US$2.50 = 2.0
    assert abs(it["marginVsConsumption"] - 2.0) < 1e-9


def test_msg_item_carries_no_content() -> None:
    it = ledger.msg_item(
        conversation_id="abc",
        ts="2026-05-31T00:00:00Z",
        msg_id="m1",
        tier="high",
        value_credits=3.5,
        charged_credits=4,
        floor_credits=4,
        consumption_cost_usd=1.0,
        model_id="anthropic.claude-sonnet-4-6",
    )
    assert it["PK"] == "CONV#abc"
    assert it["SK"] == "MSG#2026-05-31T00:00:00Z#m1"
    # privacy: per-message rows must never carry chat text
    assert "content" not in it and "text" not in it and "prompt" not in it


def test_month_aggregate_margins() -> None:
    it = ledger.month_aggregate_item(
        client="hq",
        month="2026-05",
        credit_revenue_usd=75.0,
        consumption_cost_usd=36.0,
        actual_aws_bill_usd=50.0,
        platform_fee_usd=10.0,
    )
    assert it["PK"] == "CLIENT#hq" and it["SK"] == "MONTH#2026-05"
    assert abs(it["marginVsConsumption"] - 75.0 / 36.0) < 1e-9
    # honest all-in margin = (credits + platform fee) / real AWS bill
    assert abs(it["marginVsRealBill"] - (75.0 + 10.0) / 50.0) < 1e-9


if __name__ == "__main__":
    test_meta_item_keys_and_margin()
    test_msg_item_carries_no_content()
    test_month_aggregate_margins()
    print("ledger builder tests OK")
