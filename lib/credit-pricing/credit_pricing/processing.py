"""Pure orchestration: trace events -> per-turn costs -> credit-ledger rows.

Shared by the backfill tool (`tools/credits-backfill.py`) and the live debit Lambda
(`lambdas/python/credit-debit`) so the per-conversation processing has ONE home — no billing-logic
drift between the historical and the live paths.

No S3, Nova, or boto3 here: callers fetch the trace events and decide the title / value tier (which
may call Nova). This module does only the deterministic cost → floor → row assembly, using the rest
of the lib (`pricing`, `credits`, `tiers`, `ledger`).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Optional

from credit_pricing.credits import (
    AGENTCORE_MULT,
    MODEL_VALUE_MULTIPLIER,
    TRIVIAL_CONSUMPTION_USD,
    floor_credits,
)
from credit_pricing.ledger import meta_item, msg_item
from credit_pricing.pricing import _strip_prefix, recalculate_anthropic_cost
from credit_pricing.tiers import tier_to_credits


@dataclass
class TurnCost:
    turn_idx: int
    msg_id: str
    model: Optional[str]
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int
    recomputed_usd: Optional[float]
    # The `result` event's `total_cost_usd` — the cost basis the runner wrote for this turn. Used
    # ONLY as a fallback when `recomputed_usd` is None (non-Anthropic / unpriced model, e.g.
    # `numa-standard-model`, where the relay supplies the true USD cost rather than the pricing
    # table). Defaulted (trailing) so existing positional `TurnCost(...)` callers keep working.
    result_cost_usd: Optional[float] = None


def process_trace_events(
    events: Iterable[dict], *, cache_ttl: str = "1h"
) -> tuple[list[TurnCost], list[str], Optional[str], Optional[str]]:
    """Walk trace events once -> (per-result-turn costs, user texts, first_ts, last_ts).

    Model id is recovered from the preceding `assistant` event (it isn't on the `result` event).
    Turns whose model isn't in the pricing table get ``recomputed_usd=None``; the runner's
    ``total_cost_usd`` from the same `result` event is captured as ``result_cost_usd`` so
    ``build_conversation_rows`` can fall back to it (the true cost basis for non-Anthropic models
    like ``numa-standard-model``) instead of treating the turn as $0.
    first_ts/last_ts are the earliest/latest event ``timestamp`` (ISO-8601, lexically comparable)
    — the conversation's real wall-clock span, including gaps where the user came back later.
    """
    turns: list[TurnCost] = []
    user_texts: list[str] = []
    last_model: Optional[str] = None
    last_msg_id: Optional[str] = None
    first_ts: Optional[str] = None
    last_ts: Optional[str] = None
    turn_idx = 0
    for ev in events:
        ts = ev.get("timestamp")
        if isinstance(ts, str) and ts:
            if first_ts is None or ts < first_ts:
                first_ts = ts
            if last_ts is None or ts > last_ts:
                last_ts = ts
        etype = ev.get("type")
        if etype == "assistant":
            msg = ev.get("message") or {}
            if msg.get("model"):
                last_model = msg["model"]
            if msg.get("id"):
                last_msg_id = msg["id"]
        elif etype == "user":
            msg = ev.get("message") or {}
            for c in msg.get("content") or []:
                if (
                    isinstance(c, dict)
                    and c.get("type") == "text"
                    and c.get("text", "").strip()
                ):
                    user_texts.append(c["text"].strip())
                elif isinstance(c, str) and c.strip():
                    user_texts.append(c.strip())
        elif etype == "result":
            usage = ev.get("usage") or {}
            # The runner-written cost basis for this turn (top-level on the result event). For
            # Anthropic models this is the recomputed figure and we don't use it (we recompute from
            # tokens below); for unpriced models (numa-standard-model) the relay's true USD cost
            # lands here and becomes the fallback basis in build_conversation_rows. May be None/null.
            tcu_raw = ev.get("total_cost_usd")
            result_cost_usd = (
                float(tcu_raw) if isinstance(tcu_raw, (int, float)) else None
            )
            it = int(usage.get("input_tokens") or 0)
            ot = int(usage.get("output_tokens") or 0)
            cr = int(usage.get("cache_read_input_tokens") or 0)
            cw = int(usage.get("cache_creation_input_tokens") or 0)
            # Per-tier cache-creation split (preferred over the global cache_ttl): recent traces
            # carry usage.cache_creation.ephemeral_{1h,5m}_input_tokens, billed at different rates.
            cc = usage.get("cache_creation")
            cw_1h = (
                int(cc.get("ephemeral_1h_input_tokens") or 0)
                if isinstance(cc, dict)
                else None
            )
            cw_5m = (
                int(cc.get("ephemeral_5m_input_tokens") or 0)
                if isinstance(cc, dict)
                else None
            )
            turns.append(
                TurnCost(
                    turn_idx=turn_idx,
                    msg_id=last_msg_id or f"turn{turn_idx}",
                    model=last_model,
                    input_tokens=it,
                    output_tokens=ot,
                    cache_read_tokens=cr,
                    cache_creation_tokens=cw,
                    recomputed_usd=recalculate_anthropic_cost(
                        last_model,
                        input_tokens=it,
                        output_tokens=ot,
                        cache_read_tokens=cr,
                        cache_creation_tokens=cw,
                        cache_ttl=cache_ttl,
                        cache_creation_5m_tokens=cw_5m,
                        cache_creation_1h_tokens=cw_1h,
                    ),
                    result_cost_usd=result_cost_usd,
                )
            )
            turn_idx += 1
    return turns, user_texts, first_ts, last_ts


def extract_tools(events: Iterable[dict]) -> list[str]:
    """Distinct tool / integration names invoked across the trace (assistant ``tool_use`` blocks),
    first-seen order. The cross-system breadth signal the classifier needs to value terse-but-broad
    work correctly — touching many integrations is a VALUE signal, not just effort. (Mirrors the
    backfill's ``extract_tools`` so live and historical classification see the same input.)
    """
    seen: list[str] = []
    for ev in events:
        if ev.get("type") != "assistant":
            continue
        for c in (ev.get("message") or {}).get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use":
                name = c.get("name")
                if name and name not in seen:
                    seen.append(name)
    return seen


def tools_value_signal(tools: list[str]) -> str:
    """Human-readable VALUE signal for the classifier from the tools/integrations touched. Empty
    string when no tools were used (so the classifier prompt omits the block entirely).
    """
    if not tools:
        return ""
    return f"tools / data-sources used ({len(tools)}): " + ", ".join(tools[:25])


def conversation_value_multiplier(turns: list[TurnCost]) -> float:
    """Per-model VALUE multiplier for a whole conversation (1.0 = full Premium-baseline price).

    The conversation's PRIMARY model — the one that did the most work — sets the multiplier (Standard
    0.25, Opus/Expert 3.0, everything else 1.0; see ``MODEL_VALUE_MULTIPLIER``). Work is measured by
    cost first, tokens as a fallback. This is deliberately robust to the noise turns real traces
    carry: a failed/blank turn (the SDK injects an assistant message with model ``<synthetic>``)
    carries $0 cost and 0 tokens, so it can't cancel a Standard discount or fake a markup; and the
    CLI's internal Haiku side-calls are too cheap to outweigh the model the user actually chose.

    A flat max/min over the model SET is NOT robust — a single $0 ``<synthetic>`` turn (seen in real
    nd-labs Standard traces whenever a turn errored) flips max() from 0.25 to 1.0 and silently
    cancels the discount. Weighting by work ignores those turns. Regional inference-profile prefixes
    (us./global./…) are stripped so the canonical bare id matches the table.
    """
    cost_by_model: dict[str, float] = {}
    tok_by_model: dict[str, int] = {}
    for t in turns:
        if not t.model:
            continue
        model = _strip_prefix(t.model)
        cost = (
            t.recomputed_usd
            if t.recomputed_usd is not None
            else (t.result_cost_usd or 0.0)
        )
        toks = (
            t.input_tokens
            + t.output_tokens
            + t.cache_read_tokens
            + t.cache_creation_tokens
        )
        cost_by_model[model] = cost_by_model.get(model, 0.0) + max(cost, 0.0)
        tok_by_model[model] = tok_by_model.get(model, 0) + toks
    if not cost_by_model:
        return 1.0
    # Primary = the model that did the most work. Cost first (failed/synthetic turns are $0, so they
    # never win); fall back to tokens when the whole conversation somehow metered $0.
    if any(c > 0 for c in cost_by_model.values()):
        primary = max(cost_by_model, key=lambda m: cost_by_model[m])
    else:
        primary = max(tok_by_model, key=lambda m: tok_by_model[m])
    return MODEL_VALUE_MULTIPLIER.get(primary, 1.0)


def build_conversation_rows(
    *,
    conversation_id: str,
    user_sub: str,
    month: str,
    last_ts: Optional[str],
    turns: list[TurnCost],
    title: str,
    margin: float,
    credit_usd: float,
    first_ts: Optional[str] = None,
    value_tier: Optional[str] = None,
    context: str = "chat",
    source: str = "chat",
    agent_id: Optional[str] = None,
    bedrock_region: Optional[str] = None,
    value_tier_credits: Optional[dict[str, dict[str, float]]] = None,
    trivial_consumption_usd: float = TRIVIAL_CONSUMPTION_USD,
    margins: Optional[dict[str, float]] = None,
    agentcore_mult: float = AGENTCORE_MULT,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Assemble the ledger META row + per-message rows for one conversation.

    Floor is a single ceil() on the conversation's total USD consumption (per-message floors are
    kept on the MSG rows for detail only); value tier is a single per-task number; the charge is
    ``max(value, floor)``. Pre-classification (no value_tier) -> value 0, charged = floor. All USD.
    """
    msg_rows: list[dict[str, Any]] = []
    total_consumption_usd = 0.0
    unknown = 0
    for tn in turns:
        # Cost basis: the recomputed Anthropic figure when we have it (known model — unchanged,
        # byte-identical path); otherwise fall back to the runner-written total_cost_usd from the
        # result event (the relay's true USD cost for unpriced models like numa-standard-model)
        # rather than charging $0. A turn is cost-incomplete only when NEITHER yields a real (> 0)
        # basis — a present, positive fallback rescues the turn and clears the incomplete flag.
        if tn.recomputed_usd is not None:
            cons_usd = tn.recomputed_usd
            incomplete = False
        else:
            cons_usd = tn.result_cost_usd or 0.0
            incomplete = cons_usd <= 0.0
        unknown += 1 if incomplete else 0
        fl = floor_credits(
            cons_usd, margin=margin, credit_usd=credit_usd
        )  # per-message detail only
        total_consumption_usd += cons_usd
        msg_rows.append(
            msg_item(
                conversation_id=conversation_id,
                ts=f"{tn.turn_idx:05d}",
                msg_id=tn.msg_id,
                tier=(value_tier or "unclassified"),
                value_credits=0.0,
                charged_credits=fl,
                floor_credits=fl,
                consumption_cost_usd=round(cons_usd, 6),
                model_id=tn.model,
                input_tokens=tn.input_tokens,
                output_tokens=tn.output_tokens,
                cache_read_tokens=tn.cache_read_tokens,
                cache_creation_tokens=tn.cache_creation_tokens,
                cost_incomplete=incomplete,
            )
        )
    # Anti-inflation backstop FIRST (so the floor uses the final tier): a near-zero-cost conversation
    # is trivial, so cap the value tier at 'low' even if the classifier returned higher
    # (hallucination / prompt-injection). Caps the value tier only; genuine work consumes more.
    if (
        value_tier
        and value_tier != "low"
        and total_consumption_usd < trivial_consumption_usd
    ):
        value_tier = "low"
    # Cost-recovery floor on the CONVERSATION TOTAL (single ceil), at the value tier's margin. A
    # per-tier `margins` map lets premium tiers recover at a higher multiple, so token-heavy work
    # doesn't collapse to a flat 2x; unclassified / missing -> the scalar `margin` default.
    eff_margin = (margins or {}).get(value_tier or "", margin)
    # Floor basis = tokens + AgentCore (token cost x agentcore_mult), so the margin is enforced over
    # real consumption, not tokens alone. agentcore_cost is the recorded uplift (estimate today).
    floor_basis_usd = total_consumption_usd * agentcore_mult
    agentcore_cost_usd = round(total_consumption_usd * (agentcore_mult - 1.0), 6)
    total_floor = floor_credits(
        floor_basis_usd, margin=eff_margin, credit_usd=credit_usd
    )
    if value_tier:
        # Value-tier credits, scaled down for cheap-model conversations (Standard = 1/4). The floor
        # above is left untouched — it already reflects the model's real (low) cost.
        credits_value = tier_to_credits(
            value_tier, context, overrides=value_tier_credits
        ) * conversation_value_multiplier(turns)
        tier_hist = {value_tier: 1}
        dominant = value_tier
    else:
        credits_value = 0
        tier_hist = {"unclassified": len(turns)}
        dominant = "unclassified"
    credits_charged = max(credits_value, total_floor)
    meta = meta_item(
        conversation_id=conversation_id,
        user_sub=user_sub,
        month=month,
        title=title,
        msg_count=len(turns),
        tiers=tier_hist,
        dominant_tier=dominant,
        credits_charged=credits_charged,
        credits_value=credits_value,
        credits_floor=total_floor,
        consumption_cost_usd=round(total_consumption_usd, 6),
        token_cost_usd=round(total_consumption_usd, 6),
        agentcore_cost_usd=agentcore_cost_usd,
        credit_usd=credit_usd,
        total_tokens=sum(
            tn.input_tokens
            + tn.output_tokens
            + tn.cache_read_tokens
            + tn.cache_creation_tokens
            for tn in turns
        ),
        bedrock_region=bedrock_region,
        first_ts=first_ts,
        last_ts=last_ts,
        cost_incomplete=(unknown > 0),
        source=source,
        agent_id=agent_id,
    )
    return meta, msg_rows
