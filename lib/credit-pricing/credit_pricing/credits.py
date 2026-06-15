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
CREDIT_USD: float = (
    0.30  # 1 credit = US$0.30 (~NZD $0.50 @ FX 1.69) — the NZD-anchored default
)
MARGIN_TARGET: float = 2.0  # scalar fallback (unclassified); see MARGINS_BY_TIER

# New-client default monthly allocation (credits/month, all 12 months). Used as the fallback when a
# client has no explicit monthlyAllocations configured — so a fresh client starts on a real plan
# (2000 credits/mo ≈ NZD $1,015) instead of 0. Portal-set allocations override this; no DB seed.
DEFAULT_MONTHLY_ALLOCATION: int = 2000

# AgentCore uplift: the cost-recovery floor is enforced over tokens + AgentCore, NOT tokens alone.
# floor basis = token_cost x AGENTCORE_MULT. 1.234 = the Step-01 fleet average (tokens -> tokens +
# AgentCore). The default base cost; configurable per client. Replace later with measured per-conv
# AgentCore-seconds (and add Transcribe / heavy-Lambda lines). Confirm with Asa.
AGENTCORE_MULT: float = 1.234

# Per-tier cost-recovery (defence) margins — scale UP with complexity (Scheme A). Cheap/low-tier work
# isn't punished; premium work keeps a fuller margin. The floor binds on token-heavy conversations; a
# higher multiple for premium tiers stops their margin collapsing when cost catches up to the value
# price. Lowered (with the value tiers) after early "too expensive" feedback — Asa approved, June 2026.
# Tunable per client in the portal.
MARGINS_BY_TIER: dict[str, float] = {
    "low": 1.1,
    "medium": 1.25,
    "high": 1.4,
    "very_high": 1.6,
}

# Anti-inflation backstop: below this measured consumption (USD) a conversation is treated as
# trivial and its VALUE tier is capped at 'low', regardless of what the classifier returned. Guards
# against classifier hallucination / prompt-injection billing near-zero work as a premium tier.
# Tunable — confirm with Asa. (Does NOT touch the cost floor, which already self-limits at low cost.)
TRIVIAL_CONSUMPTION_USD: float = 0.01

# Per-model VALUE multiplier. The VALUE-tier credits are scaled by a per-model factor so the price
# tracks how expensive the model that delivered the work is, relative to the Premium baseline
# (Sonnet = 1.0, implicit/unlisted). The cheap Numa Standard Model bills 1/4; the premium Expert
# model (Opus) bills 3x. Keyed on the canonical BARE model id — regional inference-profile prefixes
# (us./global./au./…) are stripped before lookup, and the proxy stamps the opaque `numa-standard-model`
# id on every Standard turn. It scales the *value* only; the cost-recovery floor is computed
# separately from the model's real measured cost and is deliberately NOT scaled (the floor already
# self-adjusts to true cost — scaling it too would double-count). Fleet-wide constants for now; could
# become portal-tunable later. Applied per-conversation by `conversation_value_multiplier`.
MODEL_VALUE_MULTIPLIER: dict[str, float] = {
    "numa-standard-model": 0.25,  # Standard — cheap non-Anthropic model
    "anthropic.claude-opus-4-6-v1": 3.0,  # Expert — Opus 4.6 (premium)
}


def floor_credits(
    consumption_usd: float,
    *,
    margin: float = MARGIN_TARGET,
    credit_usd: float = CREDIT_USD,
) -> float:
    """Cost-recovery floor: the fewest half-credits whose value >= consumption x margin.

    Rounds UP (to the nearest 0.5 credit) so the floored charge never dips below the target
    margin. Half-credit granularity lets sub-1-credit value tiers (e.g. agent low = 0.5)
    genuinely bill instead of being absorbed by a whole-credit ceil.
    """
    if consumption_usd <= 0:
        return 0
    return math.ceil(consumption_usd * margin / credit_usd * 2) / 2


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

    Monitor this per row: with the floor applied it can never fall below the tier's enforced
    margin, so a value < 1.0 means a wiring bug, not a cheap customer.
    """
    if consumption_usd <= 0:
        return None
    return (credits_charged * credit_usd) / consumption_usd
