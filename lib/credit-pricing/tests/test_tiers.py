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
    # Defaults @ $0.30/credit — 2-credit floor on every interaction (low)
    assert tiers.tier_to_credits("low", "chat") == 2
    assert tiers.tier_to_credits("medium", "chat") == 4
    assert tiers.tier_to_credits("high", "chat") == 8
    assert tiers.tier_to_credits("very_high", "chat") == 18
    # agent runs are cheaper than chat above the shared 2-credit floor
    assert tiers.tier_to_credits("low", "agent") == 2
    assert tiers.tier_to_credits("medium", "agent") == 3
    assert tiers.tier_to_credits("high", "agent") == 5
    assert tiers.tier_to_credits("very_high", "agent") == 12
    # unknown tier -> medium for that context; unknown context -> chat table
    assert (
        tiers.tier_to_credits("bogus", "chat")
        == tiers.VALUE_TIER_CREDITS["chat"]["medium"]
    )
    assert tiers.tier_to_credits("high", "weird-context") == 8


def test_parse_classification() -> None:
    # Tier-only now (category is no longer produced on the live path); any extra keys are ignored.
    assert tiers._parse_classification('{"tier":"high","category":"code_build"}') == {
        "tier": "high",
    }
    # case-insensitive tier, surrounding prose tolerated
    out = tiers._parse_classification('Here: {"tier":"VERY_HIGH"} done')
    assert out == {"tier": "very_high"}
    # garbage / invalid -> safe medium default
    assert tiers._parse_classification("no json here") == {"tier": "medium"}
    assert tiers._parse_classification('{"tier":"enormous"}') == {"tier": "medium"}


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


def test_parse_receipt() -> None:
    out = tiers._parse_receipt(
        '{"title":"Monthly revenue summary","deliverables":["pulled sales data","built summary table"]}',
        "fallback",
    )
    assert out["title"] == "Monthly revenue summary"
    assert out["deliverables"] == ["pulled sales data", "built summary table"]
    # prose tolerated, deliverables capped at 6, whitespace/newlines collapsed
    many = tiers._parse_receipt(
        'noise {"title":"A\\n B","deliverables":["d1","d2","d3","d4","d5","d6","d7"]} tail',
        "fallback",
    )
    assert many["title"] == "A B" and len(many["deliverables"]) == 6
    # garbage / missing -> fallback title, empty deliverables
    assert tiers._parse_receipt("no json", "fallback") == {
        "title": "fallback",
        "deliverables": [],
    }
    bad = tiers._parse_receipt('{"deliverables":"not-a-list"}', "fallback")
    assert bad["title"] == "fallback" and bad["deliverables"] == []


if __name__ == "__main__":
    test_tier_to_credits()
    test_parse_classification()
    test_max_tier_ratchet()
    test_parse_receipt()
    print("tier mapping + parser + ratchet + receipt tests OK")
