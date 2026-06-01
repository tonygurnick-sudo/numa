"""Tests for the pure tier->credit mapping and the classification parser.

classify() itself hits Nova (network) and isn't unit-tested here; the pure pieces are.
Runnable standalone (python3 tests/test_tiers.py) or via pytest.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from credit_pricing import tiers  # noqa: E402


def test_tier_to_credits() -> None:
    assert tiers.tier_to_credits("low", "chat") == 2
    assert tiers.tier_to_credits("high", "chat") == 12
    assert tiers.tier_to_credits("very_high", "chat") == 30
    # agent runs are cheaper (the rubric's ÷2 rule)
    assert tiers.tier_to_credits("high", "agent") == 6
    assert tiers.tier_to_credits("very_high", "agent") == 15
    # unknown tier -> medium for that context; unknown context -> chat table
    assert (
        tiers.tier_to_credits("bogus", "chat")
        == tiers.VALUE_TIER_CREDITS["chat"]["medium"]
    )
    assert tiers.tier_to_credits("high", "weird-context") == 12


def test_parse_classification() -> None:
    assert tiers._parse_classification('{"tier":"high","category":"code_build"}') == {
        "tier": "high",
        "category": "code_build",
    }
    # case-insensitive tier, surrounding prose tolerated
    out = tiers._parse_classification(
        'Here: {"tier":"VERY_HIGH","category":"analysis"} done'
    )
    assert out["tier"] == "very_high" and out["category"] == "analysis"
    # garbage / invalid -> safe medium default
    assert tiers._parse_classification("no json here") == {
        "tier": "medium",
        "category": "analysis",
    }
    assert tiers._parse_classification('{"tier":"enormous"}') == {
        "tier": "medium",
        "category": "analysis",
    }


def test_max_tier_ratchet() -> None:
    # The ratchet only ever moves UP, never down.
    assert tiers.max_tier("low", "high") == "high"
    assert (
        tiers.max_tier("high", "low") == "high"
    )  # a later trivial turn can't downgrade
    assert tiers.max_tier("very_high", "medium") == "very_high"
    # None / unknown rank lowest; result is always a valid tier.
    assert tiers.max_tier(None, "medium") == "medium"
    assert tiers.max_tier("medium", None) == "medium"
    assert tiers.max_tier(None, None) == "low"
    assert tiers.max_tier("unclassified", "high") == "high"
    assert tiers.max_tier("bogus", "bogus") == "low"


if __name__ == "__main__":
    test_tier_to_credits()
    test_parse_classification()
    test_max_tier_ratchet()
    print("tier mapping + parser + ratchet tests OK")
