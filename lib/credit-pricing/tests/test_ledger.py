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
    # marginVsConsumption = (10 credits x US$0.40 default) / US$2.50 = 1.6
    assert abs(it["marginVsConsumption"] - 1.6) < 1e-9


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
        credits_charged=150,
        allocation_snapshot=1000,
        actual_aws_bill_usd=50.0,
        platform_fee_usd=10.0,
    )
    assert it["PK"] == "CLIENT#hq" and it["SK"] == "MONTH#2026-05"
    assert abs(it["marginVsConsumption"] - 75.0 / 36.0) < 1e-9
    # honest all-in margin = (credits + platform fee) / real AWS bill
    assert abs(it["marginVsRealBill"] - (75.0 + 10.0) / 50.0) < 1e-9
    # exact credit count + the allocation snapshot the settlement will compute overflow against
    assert it["creditsCharged"] == 150 and it["allocationSnapshot"] == 1000


def test_overflow_and_available_balance() -> None:
    # consumed 1500, allocation 1000 -> 500 spilled past the month into the top-up balance
    assert ledger.overflow_credits(1500, 1000) == 500
    assert ledger.overflow_credits(800, 1000) == 0  # under allocation -> no spill
    assert ledger.overflow_credits(300, 0) == 300  # no allocation -> all of it spills
    # balance = settled TXN sum (e.g. +500 topup) minus the still-open month's 500 overflow -> 0
    assert ledger.available_balance(500, 500) == 0
    # open month overflows past an empty balance -> negative (the invoice signal)
    assert ledger.available_balance(0, 500) == -500


def test_txn_item_topup_and_settlement() -> None:
    topup = ledger.txn_item(
        client="hq",
        kind="topup",
        credits=1000,
        created_at="2026-06-03T00:00:00Z",
        txn_id="t1",
    )
    assert topup["PK"] == "CLIENT#hq"
    assert topup["SK"] == "TXN#2026-06-03T00:00:00Z#t1"
    assert topup["txnKind"] == "topup" and topup["credits"] == 1000

    # settlement uses a deterministic per-month SK -> re-running a month close is idempotent
    settle = ledger.txn_item(
        client="hq",
        kind="settlement",
        credits=-500,
        created_at="2026-07-01T00:30:00+12:00",
        month="2026-06",
    )
    assert settle["SK"] == "TXN#SETTLEMENT#2026-06"
    assert settle["credits"] == -500 and settle["month"] == "2026-06"

    # guards
    for bad in (
        lambda: ledger.txn_item(client="hq", kind="bogus", credits=1, created_at="x"),
        lambda: ledger.txn_item(
            client="hq", kind="settlement", credits=-1, created_at="x"
        ),
    ):
        try:
            bad()
            raise AssertionError("expected ValueError")
        except ValueError:
            pass


if __name__ == "__main__":
    test_meta_item_keys_and_margin()
    test_msg_item_carries_no_content()
    test_month_aggregate_margins()
    test_overflow_and_available_balance()
    test_txn_item_topup_and_settlement()
    print("ledger builder tests OK")
