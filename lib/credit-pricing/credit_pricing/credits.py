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
CREDIT_USD: float = 0.40  # 1 credit = US$0.40 (Scheme A default)
MARGIN_TARGET: float = 2.0  # scalar fallback (unclassified); see MARGINS_BY_TIER

# AgentCore uplift: the cost-recovery floor is enforced over tokens + AgentCore, NOT tokens alone.
# floor basis = token_cost x AGENTCORE_MULT. 1.234 = the Step-01 fleet average (tokens -> tokens +
# AgentCore). The default base cost; configurable per client. Replace later with measured per-conv
# AgentCore-seconds (and add Transcribe / heavy-Lambda lines). Confirm with Asa.
AGENTCORE_MULT: float = 1.234

# Per-tier cost-recovery margin. The floor binds on token-heavy conversations; a higher multiple
# for premium tiers stops their margin collapsing to a flat 2x when cost catches up to the value
# price. Defaults to MARGIN_TARGET for every tier (no change until tuned). Confirm with Asa.
# Per-tier cost-recovery (defence) margins — scale UP with complexity (Scheme A). Cheap/low-tier work
# isn't punished; premium work keeps a fuller margin. Confirm with Asa; tunable per client in the portal.
MARGINS_BY_TIER: dict[str, float] = {
    "low": 1.05,
    "medium": 1.25,
    "high": 1.5,
    "very_high": 1.9,
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
