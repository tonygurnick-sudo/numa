"""numa synergy-credit-debit — meter Synergy consumption into the Numa Credit System.

Meters TWO Synergy consumption shapes onto the SAME credit ledger as token usage,
each priced at the cost-recovery FLOOR (``credits.floor_credits``) over an
estimated USD cost, ``source="synergy"``:

1. ``kind="ingest"`` (default/absent) — a completed crawl RUN's ingestion
   (Bedrock embedding of the crawled documents, plus a small overhead uplift for
   the negligible S3/SQS/Lambda costs). The estimate is derived from the run's
   extracted text size (the real embedding bill is invisible to us — Bedrock
   ingests asynchronously after we drop files in S3). Invoked fire-and-forget by
   the synergy-text-crawler worker when a crawl run is fully drained, with
   ``{kind?, run_id, user_sub?, doc_count, chars_extracted?, est_tokens?, title?}``.
   Writes ``PK=CONV#synergy-<run_id>``. This is a background, TENANT-attributed
   cost (scheduled runs often have no real user), so with no event ``user_sub``
   it books under the ``system-synergy-crawl`` sentinel sub.

2. ``kind="query"`` — one structured/exact-term portfolio query's read-capacity
   (a bounded DynamoDB scan / GSI read). Invoked fire-and-forget by the
   oauth-workspace-tools query handlers, with
   ``{kind="query", run_id, user_sub, scanned_count, mode?, title?}``. Priced via
   ``portfolio_scan_cost_usd``. A query IS a real user's consumption, so it books
   under the REAL caller ``user_sub`` (NO sentinel fallback) and writes
   ``PK=CONV#synergy-q-<run_id>``.

Gated by ``CREDIT_METERING_ENABLED``. Both shapes recompute the ``MONTH``
aggregate after writing — so the nightly month-close settlement works unchanged.
Idempotent (deterministic CONV id: a re-run / queue re-drive of the same run_id
overwrites rather than double-charges). Best-effort.

NOTE: the admin ledger does not yet special-case the crawl's sentinel-sub row, so
until a consumer filters on ``source="synergy"`` the sentinel sub surfaces as an
unresolvable user in per-user views (tracked in synergy-metering-and-scale-plan.md).
Per-query rows DO carry a real user_sub and resolve normally.
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
from credit_pricing.synergy_pricing import (
    portfolio_scan_cost_usd,
    query_rates_from_config,
    rates_from_config,
    synergy_ingest_cost_usd,
)
from credit_pricing.timeutil import billing_month_now
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
# Background crawl, tenant-attributed: no real user. The sentinel sub + the
# source="synergy" discriminator mark this row as non-personal; a consumer that
# wants to hide background spend from per-user views should filter on source
# (the admin ledger does not do so yet). Still rolls into the MONTH aggregate.
SENTINEL_USER_SUB = "system-synergy-crawl"
# A crawl has no value tier — charge the cost-recovery floor at the 'low' margin
# (same posture as voice). source="synergy" is the discriminator.
SYNERGY_DOMINANT_TIER = "low"


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
            "config read failed", _name="SYNERGY_CREDIT_CONFIG", error=str(exc)
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
    Mirrors credit-debit/voice so chat + agent + voice + synergy reconcile in one row.
    """
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
            _name="SYNERGY_CREDIT_MONTHAGG",
            error=str(exc),
        )


def handler(event: dict, _context: Any) -> dict:
    if not METERING_ENABLED:
        return {"skipped": "metering_disabled"}
    if not (TABLE_NAME and CLIENT_NAME):
        logger.error("not configured", _name="SYNERGY_CREDIT_CONFIG")
        return {"skipped": "not_configured"}

    run_id = str(event.get("run_id") or "").strip()
    if not run_id:
        logger.warning("missing run_id", _name="SYNERGY_CREDIT_SKIP")
        return {"skipped": "missing_run_id"}

    # ``kind`` discriminates the two metered shapes; absent/blank == "ingest" so
    # the crawler's existing payload (no kind) behaves EXACTLY as before.
    kind = str(event.get("kind") or "ingest").strip().lower()
    is_query = kind == "query"

    doc_count = int(event.get("doc_count") or 0)
    chars_extracted = event.get("chars_extracted")
    est_tokens = event.get("est_tokens")

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
    margin = margins.get(SYNERGY_DOMINANT_TIER, MARGINS_BY_TIER[SYNERGY_DOMINANT_TIER])

    if is_query:
        # A query IS a real user's consumption — book it under the REAL caller
        # sub, NEVER the tenant crawl sentinel. Price the read-capacity of the
        # scan (``scanned_count``) at the same cost-recovery floor.
        user_sub = str(event.get("user_sub") or "").strip()
        if not user_sub:
            logger.warning(
                "query debit missing user_sub",
                _name="SYNERGY_CREDIT_SKIP",
                run_id=run_id,
            )
            return {"skipped": "missing_user_sub"}
        mode = str(event.get("mode") or "portfolio").strip() or "portfolio"
        usd = portfolio_scan_cost_usd(
            scanned_count=int(event.get("scanned_count") or 0),
            rates=query_rates_from_config(cfg),
        )
        conv_id = f"synergy-q-{run_id}"
        title = str(event.get("title") or f"Synergy {mode} query")
    else:
        # Background crawl, tenant-attributed: no real user → sentinel fallback.
        user_sub = str(event.get("user_sub") or "").strip() or SENTINEL_USER_SUB
        usd = synergy_ingest_cost_usd(
            doc_count=doc_count,
            chars_extracted=(
                int(chars_extracted) if chars_extracted is not None else None
            ),
            est_tokens=float(est_tokens) if est_tokens is not None else None,
            rates=rates_from_config(cfg),
        )
        conv_id = f"synergy-{run_id}"
        title = str(event.get("title") or f"Synergy crawl {run_id}")

    # floor_credits rounds UP to at least recover usd * margin at the configured
    # price-per-credit — guarantees the charge covers the (ingestion / query) cost.
    credits_charged = floor_credits(usd, margin=margin, credit_usd=credit_usd)

    if credits_charged <= 0:
        logger.info(
            "nothing to meter (empty/skipped run)",
            _name="SYNERGY_CREDIT_NOOP",
            run_id=run_id,
            kind=kind,
            doc_count=doc_count,
        )
        return {"run_id": run_id, "credits": 0, "consumption_usd": usd}

    now_iso = datetime.now(timezone.utc).isoformat()
    month = billing_month_now()

    meta = meta_item(
        conversation_id=conv_id,
        user_sub=user_sub,
        month=month,
        title=title,
        msg_count=1,
        tiers={SYNERGY_DOMINANT_TIER: 1},
        dominant_tier=SYNERGY_DOMINANT_TIER,
        credits_charged=credits_charged,
        credits_value=credits_charged,
        credits_floor=credits_charged,
        consumption_cost_usd=usd,
        source="synergy",
        first_ts=now_iso,
        last_ts=now_iso,
        credit_usd=credit_usd,
    )
    try:
        table.put_item(Item=_to_dynamo(meta))
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "ledger write failed",
            _name="SYNERGY_CREDIT_WRITE_FAIL",
            run_id=run_id,
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
        "synergy consumption metered",
        _name="SYNERGY_CREDIT_OK",
        run_id=run_id,
        kind=kind,
        user_sub=user_sub,
        doc_count=doc_count,
        credits=credits_charged,
        consumption_usd=usd,
        month=month,
    )
    return {"run_id": run_id, "credits": credits_charged, "consumption_usd": usd}
