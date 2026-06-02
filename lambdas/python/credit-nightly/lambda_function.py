"""
credit-nightly — anonymised receipt summariser for the Numa Credit System (SPK-015).

Runs once a day (EventBridge cron, midnight UTC). For conversations whose ledger META row was updated
in the recent window and not yet summarised (or summarised before their latest activity), it reads the
trace from S3 and runs Amazon Nova 2 Lite to produce an ADMIN-SAFE anonymised title + deliverables,
then writes them onto the META row. The admin view shows these once filled; until then it shows live
time / credits / tier with a "summary coming overnight" placeholder.

No raw chat content is ever stored — only the anonymised title + deliverables list (privacy decision).
Idempotent: re-running skips rows already summarised after their lastTs. Best-effort per conversation.

All billing/summary logic is shared via lib/credit-pricing (processing + tiers.generate_receipt), so
the nightly summariser, live debit, and backfill never drift.

Env: CREDITS_TABLE_NAME, OUTPUTS_BUCKET_NAME, CLIENT_NAME, AWS_REGION;
optional CREDIT_NIGHTLY_LOOKBACK_HOURS (default 36), CREDIT_NIGHTLY_MAX (0 = no cap), CREDIT_CACHE_TTL.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

import structlog
from boto3.dynamodb.conditions import Key

from credit_pricing import processing
from credit_pricing.tiers import generate_receipt
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
    candidates: list[dict] = []
    for month in _months_to_scan(now):
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

    logger.info(
        "nightly summarise complete",
        _name="CREDIT_NIGHTLY_OK",
        phase="cleanup",
        client=CLIENT_NAME,
        candidates=len(candidates),
        summarised=summarised,
        errors=errors,
    )
    return {
        "status": "ok",
        "summarised": summarised,
        "errors": errors,
        "candidates": len(candidates),
    }
