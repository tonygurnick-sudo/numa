"""
credit-nightly — anonymised receipt summariser + month-close settlement for the Numa Credit System.

Runs once a day on the NZ billing calendar (EventBridge Scheduler, ``Pacific/Auckland``). Two jobs:

1. **Receipt summariser.** For conversations whose ledger META row was updated in the recent window
   and not yet summarised, read the trace from S3 and run Amazon Nova 2 Lite to produce an ADMIN-SAFE
   anonymised title + deliverables, then write them onto the META row. No raw chat content is ever
   stored. Idempotent: re-running skips rows already summarised after their lastTs.

2. **Month-close settlement (Option B).** Settle the PREVIOUS NZ billing month: lock its overflow past
   the month's allocation snapshot into the top-up balance as a ``settlement`` TXN event (signed −).
   Deterministic per-month SK → idempotent; re-running within the settling window self-corrects for
   late-arriving traces, and months older than "previous" are never re-touched, so they stay frozen.
   The top-up balance is the sum of TXN events; a negative balance is the invoice signal.

All billing/summary logic is shared via lib/credit-pricing so the nightly job, live debit, and backfill
never drift. All monetary values are USD; the NZ timezone only decides WHEN a month boundary falls.

Env: CREDITS_TABLE_NAME, OUTPUTS_BUCKET_NAME, CLIENT_NAME, AWS_REGION;
optional CREDIT_NIGHTLY_LOOKBACK_HOURS (default 36), CREDIT_NIGHTLY_MAX (0 = no cap), CREDIT_CACHE_TTL.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Iterator

import structlog
from boto3.dynamodb.conditions import Key

from credit_pricing import processing
from credit_pricing.ledger import (
    client_pk,
    month_sk,
    overflow_credits,
    settlement_sk,
    txn_item,
)
from credit_pricing.tiers import generate_receipt
from credit_pricing.timeutil import (
    billing_month_now,
    billing_now,
    previous_billing_month,
)
from prm import client as prm_client
from prm import resource as prm_resource

logger = structlog.get_logger()

REGION = os.environ.get("AWS_REGION", "us-east-1")
TABLE_NAME = os.environ.get("CREDITS_TABLE_NAME", "")
OUTPUTS_BUCKET = os.environ.get("OUTPUTS_BUCKET_NAME", "")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "")
LOOKBACK_HOURS = float(os.environ.get("CREDIT_NIGHTLY_LOOKBACK_HOURS", "36"))
MAX_CONVS = int(os.environ.get("CREDIT_NIGHTLY_MAX", "0"))  # 0 = no cap
CACHE_TTL = os.environ.get("CREDIT_CACHE_TTL", "1h")
S3_PREFIX = "numa-chat/workspace"


def _to_dynamo(obj: Any) -> Any:
    """Coerce for the DynamoDB resource API: floats -> Decimal, drop None values."""
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_dynamo(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_to_dynamo(v) for v in obj]
    return obj


def _iter_trace(text: str) -> Iterator[dict]:
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def _actions_summary(turns: list) -> str:
    """Trusted telemetry of work done (turns/tokens/models) — helps the receipt describe deliverables."""
    if not turns:
        return ""
    total = sum(
        t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_creation_tokens
        for t in turns
    )
    models = sorted({t.model.split(".")[-1] for t in turns if t.model})
    return f"{len(turns)} model turns; ~{total:,} tokens; models: {', '.join(models) or 'unknown'}"


def _months_to_scan(now: datetime) -> list[str]:
    """Current month + previous month (so late-night activity near a boundary isn't missed)."""
    months = [now.strftime("%Y-%m")]
    prev = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) - timedelta(
        days=1
    )
    months.append(prev.strftime("%Y-%m"))
    return list(dict.fromkeys(months))


def _needs_summary(item: dict, cutoff_iso: str) -> bool:
    """Updated within the window AND never summarised (or summarised before the latest activity)."""
    last_ts = str(item.get("lastTs") or "")
    if not last_ts or last_ts < cutoff_iso:
        return False
    summarised = str(item.get("summarisedAt") or "")
    return (not summarised) or (summarised < last_ts)


def _settle_prev_month(table: Any, now_iso: str) -> dict:
    """Month-close settlement for the PREVIOUS NZ billing month (Option B).

    Overflow = max(0, creditsCharged − allocationSnapshot) for that month. A client with no
    allocation configured (snapshot absent) has allocation 0, so all their usage overflows (balance
    goes negative = invoice). If overflow > 0 we write a ``settlement`` TXN (−overflow, deterministic
    SK → idempotent); if it cleared (e.g. allocation raised within the settling window) we remove any
    prior settlement. Returns a small summary for logging.
    """
    month = previous_billing_month(billing_month_now())
    key = {"PK": client_pk(CLIENT_NAME), "SK": month_sk(month)}
    agg = table.get_item(Key=key).get("Item") or {}
    consumed = float(agg.get("creditsCharged") or 0)
    snapshot = agg.get("allocationSnapshot")
    allocation = float(snapshot) if snapshot is not None else 0.0
    overflow = overflow_credits(consumed, allocation)
    if overflow > 0:
        table.put_item(
            Item=_to_dynamo(
                txn_item(
                    client=CLIENT_NAME,
                    kind="settlement",
                    credits=-overflow,
                    created_at=now_iso,
                    created_by="nightly",
                    month=month,
                )
            )
        )
        action = "settled"
    else:
        # No overflow (or it cleared) — ensure no stale settlement lingers for this month.
        table.delete_item(
            Key={"PK": client_pk(CLIENT_NAME), "SK": settlement_sk(month)}
        )
        action = "no-overflow"
    logger.info(
        "month settlement",
        _name="CREDIT_NIGHTLY_SETTLE",
        phase="settle",
        client=CLIENT_NAME,
        month=month,
        consumed=consumed,
        allocation=allocation,
        overflow=overflow,
        action=action,
    )
    return {
        "month": month,
        "consumed": consumed,
        "allocation": allocation,
        "overflow": overflow,
        "action": action,
    }


def handler(event: dict, context: Any) -> dict:
    if not TABLE_NAME or not OUTPUTS_BUCKET:
        logger.error("not configured", _name="CREDIT_NIGHTLY_CONFIG", phase="init")
        return {"status": "error", "reason": "not configured"}

    now = datetime.now(timezone.utc)
    cutoff_iso = (now - timedelta(hours=LOOKBACK_HOURS)).isoformat()
    table = prm_resource("dynamodb", region=REGION).Table(TABLE_NAME)
    s3 = prm_client("s3", region=REGION)
    bedrock = prm_client("bedrock-runtime", region=REGION)

    # 1. Gather candidate META rows (recently updated, not yet summarised) via the GSI2 month rollup.
    #    Scan on the NZ billing calendar so the month partitions match how credit-debit buckets them.
    candidates: list[dict] = []
    for month in _months_to_scan(billing_now()):
        resp = table.query(
            IndexName="GSI2", KeyConditionExpression=Key("GSI2PK").eq(f"MONTH#{month}")
        )
        page = resp.get("Items", [])
        while resp.get("LastEvaluatedKey"):
            resp = table.query(
                IndexName="GSI2",
                KeyConditionExpression=Key("GSI2PK").eq(f"MONTH#{month}"),
                ExclusiveStartKey=resp["LastEvaluatedKey"],
            )
            page += resp.get("Items", [])
        candidates += [it for it in page if _needs_summary(it, cutoff_iso)]

    candidates.sort(key=lambda it: str(it.get("lastTs") or ""), reverse=True)
    if MAX_CONVS > 0:
        candidates = candidates[:MAX_CONVS]

    # 2. Summarise each (read trace -> Nova receipt -> write anonymised title + deliverables).
    summarised = errors = 0
    for it in candidates:
        conv_id = str(it.get("GSI2SK") or "").removeprefix("CONV#") or str(
            it.get("PK") or ""
        ).removeprefix("CONV#")
        user_sub = str(it.get("userSub") or "")
        if not conv_id or not user_sub:
            continue
        try:
            key = f"{S3_PREFIX}/{user_sub}/conversations/{conv_id}/_system/trace.jsonl"
            body = (
                s3.get_object(Bucket=OUTPUTS_BUCKET, Key=key)["Body"]
                .read()
                .decode("utf-8", "replace")
            )
            turns, user_texts, _, _ = processing.process_trace_events(
                _iter_trace(body), cache_ttl=CACHE_TTL
            )
            receipt = generate_receipt(
                user_texts,
                actions=_actions_summary(turns),
                bedrock=bedrock,
                region=REGION,
            )
            table.update_item(
                Key={"PK": f"CONV#{conv_id}", "SK": "META"},
                UpdateExpression="SET #t = :t, #d = :d, #s = :s",
                ExpressionAttributeNames={
                    "#t": "title",
                    "#d": "deliverables",
                    "#s": "summarisedAt",
                },
                ExpressionAttributeValues={
                    ":t": receipt["title"],
                    ":d": receipt["deliverables"],
                    ":s": now.isoformat(),
                },
            )
            summarised += 1
        except (
            Exception
        ) as exc:  # noqa: BLE001 — best-effort; one bad conv must not stop the run
            errors += 1
            logger.warning(
                "summary failed",
                _name="CREDIT_NIGHTLY_FAIL",
                phase="run",
                conversation_id=conv_id,
                error=str(exc),
            )

    # 3. Month-close settlement for the previous NZ billing month (best-effort; never break the run).
    settlement = None
    try:
        settlement = _settle_prev_month(table, now.isoformat())
    except (
        Exception
    ) as exc:  # noqa: BLE001 — settlement must not break the summariser run
        logger.warning(
            "settlement failed",
            _name="CREDIT_NIGHTLY_SETTLE_FAIL",
            phase="settle",
            client=CLIENT_NAME,
            error=str(exc),
        )

    logger.info(
        "nightly run complete",
        _name="CREDIT_NIGHTLY_OK",
        phase="cleanup",
        client=CLIENT_NAME,
        candidates=len(candidates),
        summarised=summarised,
        errors=errors,
        settlement=settlement,
    )
    return {
        "status": "ok",
        "summarised": summarised,
        "errors": errors,
        "candidates": len(candidates),
        "settlement": settlement,
    }
