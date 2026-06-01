"""Canonical cost-recompute + credit math for the Numa Credit System.

See README.md. The pricing table here is drift-guarded against the workspace agent's copy by
tests/test_pricing_drift.py.
"""

from credit_pricing.credits import (
    CREDIT_USD,
    MARGIN_TARGET,
    MARGINS_BY_TIER,
    TRIVIAL_CONSUMPTION_USD,
    credits_to_usd,
    floor_credits,
    margin_actual,
)
from credit_pricing.pricing import (
    ANTHROPIC_MODEL_PRICING,
    recalculate_anthropic_cost,
)

__all__ = [
    "ANTHROPIC_MODEL_PRICING",
    "recalculate_anthropic_cost",
    "CREDIT_USD",
    "MARGIN_TARGET",
    "MARGINS_BY_TIER",
    "TRIVIAL_CONSUMPTION_USD",
    "floor_credits",
    "credits_to_usd",
    "margin_actual",
]
