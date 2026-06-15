"""numa-voice-credit-debit — meter a Numa Voice call into the Numa Credit System.

A completed call's NON-LLM consumption (Connect telephony + Amazon Transcribe
[+ Contact Lens]) draws down the SAME credit ledger as token usage. The LLM
post-call analysis is metered separately via the normal agent path, so it is NOT
charged here (that would double-count).

Invoked fire-and-forget by numa-voice-processor after the vCon is written, with
``{contact_id, user_sub, duration_seconds, transcribed, contact_lens?, title?}``.
Gated by ``CREDIT_METERING_ENABLED``. Writes a ``source="voice"`` META row
(``PK=CONV#voice-<contactId>``) priced at the cost-recovery FLOOR, then recomputes
the ``MONTH`` aggregate — so the nightly month-close settlement (overage) works
unchanged. Idempotent (deterministic CONV id). Best-effort.
"""

import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import structlog
from boto3.dynamodb.conditions import Key

from credit_pricing.credits import (
    CREDIT_USD,
    DEFAULT_MONTHLY_ALLOCATION,
    MARGINS_BY_TIER,
    credits_to_usd,
    floor_credits,
)
from credit_pricing.ledger import meta_item, month_aggregate_item
from credit_pricing.timeutil import billing_month_now
from credit_pricing.voice_pricing import rates_from_config, voice_call_cost_usd
from prm import resource as prm_resource

logger = structlog.get_logger().bind(domain="credits")

TABLE_NAME = os.environ.get("CREDITS_TABLE_NAME", "")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "")
REGION = os.environ.get("AWS_REGION", "")
METERING_ENABLED = os.environ.get("CREDIT_METERING_ENABLED", "").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
# Voice charges the cost-recovery floor at the 'low'-tier margin (a call has no value
# tier). source="voice" is the discriminator; dominantTier stays a real tier so the
# existing tier-distribution UI doesn't choke (the in-client view filters on source).
VOICE_DOMINANT_TIER = "low"


def _to_dynamo(obj: Any) -> Any:
    """Recursively coerce floats -> Decimal for the DynamoDB resource client."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_dynamo(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_dynamo(v) for v in obj]
    return obj


def _read_config(table: Any) -> dict:
    try:
        return (
            table.get_item(Key={"PK": f"CLIENT#{CLIENT_NAME}", "SK": "CONFIG"}).get(
                "Item"
            )
            or {}
        )
    except (
        Exception
    ) as exc:  # noqa: BLE001 — config is best-effort; fall back to lib defaults
        logger.warning(
            "config read failed", _name="VOICE_CREDIT_CONFIG", error=str(exc)
        )
        return {}


def _allocation_snapshot(cfg: dict, month: str) -> float:
    raw = cfg.get("monthlyAllocations")
    if isinstance(raw, list) and len(raw) == 12:
        try:
            alloc = [float(x) for x in raw]
        except (TypeError, ValueError):
            alloc = [float(DEFAULT_MONTHLY_ALLOCATION)] * 12
    else:
        alloc = [float(DEFAULT_MONTHLY_ALLOCATION)] * 12
    idx = int(month.split("-")[1]) - 1
    return alloc[idx] if 0 <= idx < 12 else float(DEFAULT_MONTHLY_ALLOCATION)


def _recompute_month(
    table: Any,
    month: str,
    conv_id: str,
    this_credits: float,
    this_cost: float,
    alloc_snapshot: float,
) -> None:
    """Recompute the MONTH aggregate from GSI2 (sum all META rows), overriding the
    just-written conversation with in-hand values (GSI2 is eventually consistent).
    Mirrors credit-debit so chat + agent + voice usage all reconcile in one row."""
    try:
        credits_sum = 0.0
        cost_sum = 0.0
        last_key = None
        while True:
            kwargs: dict[str, Any] = {
                "IndexName": "GSI2",
                "KeyConditionExpression": Key("GSI2PK").eq(f"MONTH#{month}"),
            }
            if last_key:
                kwargs["ExclusiveStartKey"] = last_key
            res = table.query(**kwargs)
            for item in res.get("Items", []):
                if item.get("GSI2SK") == f"CONV#{conv_id}":
                    continue  # overridden with in-hand values below
                credits_sum += float(item.get("creditsCharged") or 0)
                cost_sum += float(item.get("consumptionCostUsd") or 0)
            last_key = res.get("LastEvaluatedKey")
            if not last_key:
                break
        credits_sum += this_credits
        cost_sum += this_cost
        agg = month_aggregate_item(
            client=CLIENT_NAME,
            month=month,
            credit_revenue_usd=credits_to_usd(credits_sum),
            consumption_cost_usd=cost_sum,
            credits_charged=credits_sum,
            allocation_snapshot=alloc_snapshot,
        )
        table.put_item(Item=_to_dynamo(agg))
    except Exception as exc:  # noqa: BLE001 — never break metering on the aggregate
        logger.warning(
            "month aggregate update failed",
            _name="VOICE_CREDIT_MONTHAGG",
            error=str(exc),
        )


def handler(event: dict, _context: Any) -> dict:
    if not METERING_ENABLED:
        return {"skipped": "metering_disabled"}
    if not (TABLE_NAME and CLIENT_NAME):
        logger.error("not configured", _name="VOICE_CREDIT_CONFIG")
        return {"skipped": "not_configured"}

    contact_id = str(event.get("contact_id") or "").strip()
    user_sub = str(event.get("user_sub") or "").strip()
    if not contact_id or not user_sub:
        logger.warning(
            "missing ids",
            _name="VOICE_CREDIT_SKIP",
            contact_id=contact_id,
            user_sub=bool(user_sub),
        )
        return {"skipped": "missing_ids"}

    table = (
        prm_resource("dynamodb", region=REGION).Table(TABLE_NAME)
        if REGION
        else prm_resource("dynamodb").Table(TABLE_NAME)
    )
    cfg = _read_config(table)

    credit_usd = (
        float(cfg["creditUsd"]) if cfg.get("creditUsd") is not None else CREDIT_USD
    )
    margins = dict(MARGINS_BY_TIER)
    if isinstance(cfg.get("marginsByTier"), dict):
        margins.update({k: float(v) for k, v in cfg["marginsByTier"].items()})
    margin = margins.get(VOICE_DOMINANT_TIER, MARGINS_BY_TIER[VOICE_DOMINANT_TIER])

    usd = voice_call_cost_usd(
        event.get("duration_seconds"),
        transcribed=bool(event.get("transcribed", True)),
        contact_lens=bool(event.get("contact_lens", False)),
        rates=rates_from_config(cfg),
    )
    credits_charged = floor_credits(usd, margin=margin, credit_usd=credit_usd)

    now_iso = datetime.now(timezone.utc).isoformat()
    month = billing_month_now()
    conv_id = f"voice-{contact_id}"

    meta = meta_item(
        conversation_id=conv_id,
        user_sub=user_sub,
        month=month,
        title=str(event.get("title") or f"Voice call {contact_id}"),
        msg_count=1,
        tiers={VOICE_DOMINANT_TIER: 1},
        dominant_tier=VOICE_DOMINANT_TIER,
        credits_charged=credits_charged,
        credits_value=credits_charged,
        credits_floor=credits_charged,
        consumption_cost_usd=usd,
        source="voice",
        first_ts=now_iso,
        last_ts=now_iso,
        credit_usd=credit_usd,
    )
    try:
        table.put_item(Item=_to_dynamo(meta))
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "ledger write failed",
            _name="VOICE_CREDIT_WRITE_FAIL",
            contact_id=contact_id,
            error=str(exc),
        )
        raise

    _recompute_month(
        table,
        month,
        conv_id,
        float(credits_charged),
        usd,
        _allocation_snapshot(cfg, month),
    )

    logger.info(
        "voice call metered",
        _name="VOICE_CREDIT_OK",
        contact_id=contact_id,
        credits=credits_charged,
        consumption_usd=usd,
        month=month,
    )
    return {
        "contact_id": contact_id,
        "credits": credits_charged,
        "consumption_usd": usd,
    }
