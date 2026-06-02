"""Pure builders for credit-ledger DynamoDB rows — the schema single-source.

Both the backfill tool and the live debit Lambda build the same rows; these keep the PK/SK/GSI
layout and field names in one place so the two writers can't drift on the schema. No boto3 here —
callers write the returned plain dict (DynamoDBDocumentClient / boto3 resource accept plain dicts;
any Decimal coercion for numeric attributes is the caller's job at write time).

All monetary fields are USD — no FX conversion anywhere in the credit system.

Table ``numa-<client>-credit-ledger``:
  PK=CONV#<id>      SK=META               conversation aggregate (the dashboard row)
  PK=CONV#<id>      SK=MSG#<ts>#<msg_id>  per-message cost/credit detail (NO chat content)
  PK=CLIENT#<name>  SK=MONTH#<YYYY-MM>    monthly reconciliation aggregate
  GSI1 GSI1PK=USER#<sub>      GSI1SK=TS#<last_ts>  (META rows only — user's convs, newest first)
  GSI2 GSI2PK=MONTH#<YYYY-MM> GSI2SK=CONV#<id>     (META rows only — per-client monthly rollup)
"""

from __future__ import annotations

from typing import Any, Optional

from credit_pricing.credits import margin_actual


def conv_pk(conversation_id: str) -> str:
    return f"CONV#{conversation_id}"


def msg_sk(ts: str, msg_id: str) -> str:
    return f"MSG#{ts}#{msg_id}"


def client_pk(client: str) -> str:
    return f"CLIENT#{client}"


def month_sk(month: str) -> str:
    return f"MONTH#{month}"


def meta_item(
    *,
    conversation_id: str,
    user_sub: str,
    month: str,
    title: str,
    msg_count: int,
    tiers: dict[str, int],
    dominant_tier: str,
    credits_charged: float,
    credits_value: float,
    credits_floor: float,
    floored_msgs: int,
    consumption_cost_usd: float,
    total_tokens: int = 0,
    source: str = "chat",
    agent_id: Optional[str] = None,
    agent_name: Optional[str] = None,
    bedrock_region: Optional[str] = None,
    first_ts: Optional[str] = None,
    last_ts: Optional[str] = None,
    token_cost_usd: Optional[float] = None,
    agentcore_cost_usd: float = 0.0,
    rate_card_version: Optional[str] = None,
    cost_incomplete: bool = False,
) -> dict[str, Any]:
    """The conversation aggregate row the admin dashboard lists.

    Only the display fields (title/msgCount/tiers/dominantTier/creditsCharged) are ever shown to
    an admin; everything else is internal cost telemetry. All monetary fields are USD.
    """
    item: dict[str, Any] = {
        "PK": conv_pk(conversation_id),
        "SK": "META",
        # GSI keys (sparse: only META rows carry them, so the GSIs index conversations only)
        "GSI1PK": f"USER#{user_sub}",
        "GSI1SK": f"TS#{last_ts or first_ts or ''}",
        "GSI2PK": f"MONTH#{month}",
        "GSI2SK": conv_pk(conversation_id),
        # ── display (admin-safe) ──
        "title": title,
        "msgCount": msg_count,
        "tiers": tiers,
        "dominantTier": dominant_tier,
        "creditsCharged": credits_charged,
        # ── internal: cost + credit breakdown (USD) ──
        "consumptionCostUsd": consumption_cost_usd,
        "creditsValue": credits_value,
        "creditsFloor": credits_floor,
        "flooredMsgs": floored_msgs,
        "marginVsConsumption": margin_actual(
            credits_charged, consumption_cost_usd + agentcore_cost_usd
        ),
        "agentCoreCostUsd": agentcore_cost_usd,
        "totalTokens": total_tokens,
        "costIncomplete": cost_incomplete,
        # ── identity ──
        "userSub": user_sub,
        "month": month,
        "source": source,
    }
    if token_cost_usd is not None:
        item["tokenCostUsd"] = token_cost_usd
    if agent_id:
        item["agentId"] = agent_id
    if agent_name:
        item["agentName"] = agent_name
    if bedrock_region:
        item["bedrockRegion"] = bedrock_region
    if first_ts:
        item["firstTs"] = first_ts
    if last_ts:
        item["lastTs"] = last_ts
    if rate_card_version:
        item["rateCardVersion"] = rate_card_version
    return item


def msg_item(
    *,
    conversation_id: str,
    ts: str,
    msg_id: str,
    tier: str,
    value_credits: float,
    charged_credits: float,
    floor_credits: float,
    consumption_cost_usd: float,
    model_id: Optional[str] = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
    cost_incomplete: bool = False,
) -> dict[str, Any]:
    """Per-message cost/credit detail. Deliberately carries NO chat content (privacy decision)."""
    item: dict[str, Any] = {
        "PK": conv_pk(conversation_id),
        "SK": msg_sk(ts, msg_id),
        "tier": tier,
        "valueCredits": value_credits,
        "floorCredits": floor_credits,
        "charged": charged_credits,
        "consumptionCostUsd": consumption_cost_usd,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "cacheReadTokens": cache_read_tokens,
        "cacheCreationTokens": cache_creation_tokens,
        "costIncomplete": cost_incomplete,
    }
    if model_id:
        item["modelId"] = model_id
    return item


def month_aggregate_item(
    *,
    client: str,
    month: str,
    credit_revenue_usd: float,
    consumption_cost_usd: float,
    actual_aws_bill_usd: Optional[float] = None,
    platform_fee_usd: Optional[float] = None,
) -> dict[str, Any]:
    """Per-client monthly reconciliation row.

    ``marginVsRealBill`` (vs the actual AWS bill) is the honest all-in margin — the only check
    that can catch infra drift, since it doesn't depend on any internal multiplier. All USD.
    """
    item: dict[str, Any] = {
        "PK": client_pk(client),
        "SK": month_sk(month),
        "creditRevenueUsd": credit_revenue_usd,
        "consumptionCostUsd": consumption_cost_usd,
        "marginVsConsumption": (
            credit_revenue_usd / consumption_cost_usd
            if consumption_cost_usd > 0
            else None
        ),
    }
    if platform_fee_usd is not None:
        item["platformFeeUsd"] = platform_fee_usd
    if actual_aws_bill_usd is not None:
        item["actualAwsBillUsd"] = actual_aws_bill_usd
        base = credit_revenue_usd + (platform_fee_usd or 0.0)
        item["marginVsRealBill"] = (
            base / actual_aws_bill_usd if actual_aws_bill_usd > 0 else None
        )
    return item
