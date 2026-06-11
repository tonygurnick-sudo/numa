"""Anthropic-on-Bedrock token cost recompute — CANONICAL pricing for the Numa Credit System.

This table MUST stay identical to the workspace agent's copy in
``services/numa-workspace-agent/numa_workspace_agent/sdk_config.py:ANTHROPIC_MODEL_PRICING``.
Parity is enforced by ``tests/test_pricing_drift.py`` — change or add a model rate in one place
and the test fails until you mirror it here (and vice-versa). The agent can't import this lib
(its Docker build context is the service dir, so it can't ``COPY lib/``), so the table is
duplicated and drift-guarded by test rather than shared by import.

Why recompute at all: the Claude Agent SDK's ``total_cost_usd`` under-reports ``cache_creation``
on the 1h cache tier (Numa interactive chat) by ~2x — it only knows the 5m write rate. AWS bills
correctly; only the SDK telemetry is wrong. Recompute from raw token counts using the rates below.

``lib/bedrock`` has a SEPARATE, non-cache-aware pricing table for the ``BedrockClaude3Model``
wrapper — that is NOT authoritative for credits.

Rates are USD per million tokens. ``cache_ttl`` is "5m" (default Bedrock) or "1h"
(Numa interactive chat, ``ENABLE_PROMPT_CACHING_1H_BEDROCK=1``).
"""

from __future__ import annotations

from typing import Optional

_KNOWN_PREFIXES = ("us.", "au.", "apac.", "eu.", "global.")

# NO 1M-long-context premium tier — deliberately. The premium (_200k rates) applies per API CALL
# when a single prompt exceeds 200K tokens on the 1M-context model variant. Numa doesn't route any
# traffic to that variant, and — critically — every caller of this function feeds usage SUMMED
# ACROSS a whole agentic request (the SDK ResultMessage aggregates all inner API calls), so a
# threshold check here fires on cumulative cache reads that AWS bills at standard rates. That bug
# inflated agentic-conversation costs ~1.6-1.8x (June 2026). If 1M context is ever enabled, the
# premium must be priced per individual API call, never from aggregated result usage.

# Keep IDENTICAL to the agent's table (drift-guarded). Bare canonical Bedrock ids (no regional
# prefix). Only verified, production-routed models belong here — adding an unverified rate would
# defeat the purpose of a billing source of truth.
ANTHROPIC_MODEL_PRICING: dict[str, dict[str, float]] = {
    "anthropic.claude-sonnet-4-6": {
        "input": 3.00,
        "output": 15.00,
        "cache_write_5m": 3.75,
        "cache_write_1h": 6.00,
        "cache_read": 0.30,
    },
    "anthropic.claude-opus-4-6-v1": {
        "input": 15.00,
        "output": 75.00,
        "cache_write_5m": 18.75,
        "cache_write_1h": 30.00,
        "cache_read": 1.50,
    },
    "anthropic.claude-haiku-4-5-20251001-v1:0": {
        "input": 1.00,
        "output": 5.00,
        "cache_write_5m": 1.25,
        "cache_write_1h": 2.00,
        "cache_read": 0.10,
    },
    "anthropic.claude-sonnet-4-5-20250929-v1:0": {
        "input": 3.00,
        "output": 15.00,
        "cache_write_5m": 3.75,
        "cache_write_1h": 6.00,
        "cache_read": 0.30,
    },
    "anthropic.claude-sonnet-4-20250514-v1:0": {
        "input": 3.00,
        "output": 15.00,
        "cache_write_5m": 3.75,
        "cache_write_1h": 6.00,
        "cache_read": 0.30,
    },
}


def _strip_prefix(model_id: str) -> str:
    """Strip a regional inference-profile prefix (us./au./apac./eu./global.)."""
    for p in _KNOWN_PREFIXES:
        if model_id.startswith(p):
            return model_id[len(p) :]
    return model_id


def _normalise_bare(bare: str) -> str:
    """Best-effort map a bare model id to a pricing-table key.

    Tries the canonical ``anthropic.<name>[-v1:0]`` forms. Normalises against the PRICING TABLE
    keys (not a region map), so this stays pure and portable. Returns the input unchanged when no
    match — callers treat an unmapped id as 'unpriceable' (recompute returns None).
    """
    if bare in ANTHROPIC_MODEL_PRICING:
        return bare
    candidates = [bare]
    if not bare.startswith("anthropic."):
        candidates.append(f"anthropic.{bare}")
        if not bare.endswith("-v1:0"):
            candidates.append(f"anthropic.{bare}-v1:0")
    elif not bare.endswith("-v1:0"):
        candidates.append(f"{bare}-v1:0")
    for c in candidates:
        if c in ANTHROPIC_MODEL_PRICING:
            return c
    return bare


def recalculate_anthropic_cost(
    model_id: Optional[str],
    *,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_creation_tokens: int = 0,
    cache_ttl: str = "5m",
    cache_creation_5m_tokens: Optional[int] = None,
    cache_creation_1h_tokens: Optional[int] = None,
) -> Optional[float]:
    """Recompute total cost (USD) from raw token counts using AWS-billed rates.

    Returns None when the model id can't be mapped to a known rate entry — callers should treat
    that turn as cost-incomplete (e.g. fall back to the SDK figure, or mark title-only).

    Cache-creation pricing is PER TIER. A single turn can mix 1h and 5m cache writes, billed at
    different rates. Pass ``cache_creation_5m_tokens`` / ``cache_creation_1h_tokens`` (from
    ``usage.cache_creation.ephemeral_{5m,1h}_input_tokens``, present on every recent trace) and
    each bucket is priced at its own rate. Only when neither split arg is given does it fall back
    to the legacy single ``cache_creation_tokens`` bucket priced at ``cache_ttl`` ("5m"/"1h") —
    used for older traces lacking the breakdown. Forcing a global ``cache_ttl`` over-prices 5m
    turns at the 1h rate (and under-prices the reverse); always prefer the split.
    """
    if not model_id:
        return None
    rates = ANTHROPIC_MODEL_PRICING.get(_normalise_bare(_strip_prefix(model_id)))
    if rates is None:
        return None
    if cache_creation_5m_tokens is not None or cache_creation_1h_tokens is not None:
        cache_write_cost = (cache_creation_5m_tokens or 0) * rates["cache_write_5m"] + (
            cache_creation_1h_tokens or 0
        ) * rates["cache_write_1h"]
    else:
        write_rate = (
            rates["cache_write_1h"] if cache_ttl == "1h" else rates["cache_write_5m"]
        )
        cache_write_cost = cache_creation_tokens * write_rate
    return (
        input_tokens * rates["input"]
        + output_tokens * rates["output"]
        + cache_read_tokens * rates["cache_read"]
        + cache_write_cost
    ) / 1_000_000
