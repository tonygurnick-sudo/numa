"""Credit math for the Numa Credit System — USD↔credit conversion and the cost-recovery floor.

Everything is denominated in USD (the currency AWS/Anthropic bill in) — there is deliberately NO
FX conversion, so an exchange-rate move can never retroactively reprice usage.

The cost-recovery floor is the load-bearing rule: a task's charged credits, valued at ``CREDIT_USD``
each, must always be >= its measured consumption cost (USD) x ``MARGIN_TARGET``. This guarantees
credits never fall below cost on any conversation.
"""

from __future__ import annotations

import math
from typing import Optional

# Working anchors — confirm with Asa/sales before they harden into customer-facing pricing.
CREDIT_USD: float = 0.50  # 1 credit = US$0.50
MARGIN_TARGET: float = 2.0  # default floor margin over (measured) consumption cost

# Per-tier cost-recovery margin. The floor binds on token-heavy conversations; a higher multiple
# for premium tiers stops their margin collapsing to a flat 2x when cost catches up to the value
# price. Defaults to MARGIN_TARGET for every tier (no change until tuned). Confirm with Asa.
MARGINS_BY_TIER: dict[str, float] = {
    "low": 2.0,
    "medium": 2.0,
    "high": 2.0,
    "very_high": 2.0,
}

# Anti-inflation backstop: below this measured consumption (USD) a conversation is treated as
# trivial and its VALUE tier is capped at 'low', regardless of what the classifier returned. Guards
# against classifier hallucination / prompt-injection billing near-zero work as a premium tier.
# Tunable — confirm with Asa. (Does NOT touch the cost floor, which already self-limits at low cost.)
TRIVIAL_CONSUMPTION_USD: float = 0.01


def floor_credits(
    consumption_usd: float,
    *,
    margin: float = MARGIN_TARGET,
    credit_usd: float = CREDIT_USD,
) -> int:
    """Cost-recovery floor: the fewest whole credits whose value >= consumption x margin.

    Rounds UP so the floored charge never dips below the target margin.
    """
    if consumption_usd <= 0:
        return 0
    return math.ceil(consumption_usd * margin / credit_usd)


def credits_to_usd(credits: float, *, credit_usd: float = CREDIT_USD) -> float:
    """Customer-facing USD value of a credit count."""
    return credits * credit_usd


def margin_actual(
    credits_charged: float,
    consumption_usd: float,
    *,
    credit_usd: float = CREDIT_USD,
) -> Optional[float]:
    """Realised margin = (credits charged, in USD) / consumption cost. None if no cost.

    Monitor this per row: with the floor applied it can never fall below MARGIN_TARGET, so a
    value < 1.0 means a wiring bug, not a cheap customer.
    """
    if consumption_usd <= 0:
        return None
    return (credits_charged * credit_usd) / consumption_usd
