"""DynamoDB read/write helpers for the fleet-analytics rollup table.

Table schema:
  PK clientName (S)   "nd-labs" | "_FLEET" | "_CLIENTS" | ...
  SK sk         (S)   "SNAPSHOT#latest" | "SNAPSHOT#YYYY-MM-DD"
  ttl           (N)   epoch seconds (set on dated snapshots; latest has no TTL)

Both `SNAPSHOT#latest` and a dated `SNAPSHOT#YYYY-MM-DD` row are written on
every refresh. The dated row carries a TTL so DynamoDB sweeps old history.

Snapshot bodies are stored as JSON-serialised maps under `body`. DynamoDB
items have a 400KB hard cap; if a snapshot exceeds it we strip the heaviest
per-conversation rows and fall back to aggregates only.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
import structlog

logger = structlog.get_logger()

# Stay well clear of the 400KB DDB hard cap.
SNAPSHOT_SOFT_LIMIT_BYTES = 380_000


def _to_decimal(obj):
    """Recursively convert floats to Decimal for DDB compatibility."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_decimal(v) for v in obj]
    return obj


def _from_decimal(obj):
    if isinstance(obj, Decimal):
        # DDB returns whole numbers as Decimal — float for JSON serialisation
        f = float(obj)
        return int(f) if f.is_integer() else f
    if isinstance(obj, dict):
        return {k: _from_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_from_decimal(v) for v in obj]
    return obj


def _trim_oversized(snapshot: dict) -> dict:
    """If a snapshot is over the DDB soft limit, drop the heaviest per-row
    arrays so it still fits.

    Order of cuts (least disruptive first):
      1. conversations[].tool_use_counts  — keep top-level totals only
      2. scheduled_runs[] heaviest rows
      3. conversations[] entirely (KPIs + tool_totals + model_totals still fit)
    """
    encoded = json.dumps(snapshot, default=str).encode("utf-8")
    if len(encoded) <= SNAPSHOT_SOFT_LIMIT_BYTES:
        return snapshot

    # Step 1: drop per-conversation tool_use_counts (these double-count against
    # the per-tool aggregate which is already at the top level).
    convs = (snapshot.get("chat") or {}).get("conversations") or []
    for c in convs:
        c.pop("tool_use_counts", None)
    encoded = json.dumps(snapshot, default=str).encode("utf-8")
    snapshot["_trim_step"] = 1
    if len(encoded) <= SNAPSHOT_SOFT_LIMIT_BYTES:
        return snapshot

    # Step 2: keep only the top 200 conversations by cost
    convs.sort(key=lambda c: -float(c.get("cost") or 0))
    if len(convs) > 200:
        snapshot["chat"]["conversations"] = convs[:200]
        snapshot["chat"]["_conversations_trimmed_from"] = len(convs)
    encoded = json.dumps(snapshot, default=str).encode("utf-8")
    snapshot["_trim_step"] = 2
    if len(encoded) <= SNAPSHOT_SOFT_LIMIT_BYTES:
        return snapshot

    # Step 3: nuke conversations[] entirely
    snapshot["chat"]["conversations"] = []
    snapshot["chat"]["_conversations_trimmed_from"] = len(convs)
    snapshot["_trim_step"] = 3
    return snapshot


def write_snapshot(
    fleet_table: str,
    client_name: str,
    snapshot: dict,
    snapshot_ttl_days: int,
) -> None:
    """Write `SNAPSHOT#latest` AND the dated `SNAPSHOT#YYYY-MM-DD` row."""
    ddb = boto3.resource("dynamodb")
    table = ddb.Table(fleet_table)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    snapshot = dict(snapshot)
    snapshot["generated_at"] = datetime.now(timezone.utc).isoformat()
    snapshot["client"] = client_name

    snapshot = _trim_oversized(snapshot)
    body = _to_decimal(snapshot)

    # Latest pointer (no TTL — always current)
    table.put_item(
        Item={
            "clientName": client_name,
            "sk": "SNAPSHOT#latest",
            "generated_at": snapshot["generated_at"],
            "body": body,
        }
    )

    # Dated snapshot with TTL
    ttl_epoch = int(time.time()) + snapshot_ttl_days * 86400
    table.put_item(
        Item={
            "clientName": client_name,
            "sk": f"SNAPSHOT#{today}",
            "generated_at": snapshot["generated_at"],
            "body": body,
            "ttl": ttl_epoch,
        }
    )

    logger.info(
        "snapshot written",
        _name="ROLLUP_SNAPSHOT_WRITTEN",
        client=client_name,
        bytes=len(json.dumps(body, default=str)),
    )


def _load_account_orgs(client_metadata_table: str | None) -> dict[str, str]:
    """Scan numa-client-metadata once and return {clientName: accountOrg}.

    Used by the rollup to attach `account_org` (nextgen | arcanum | standalone)
    to every snapshot so the dashboard can apply Numa-attributable cost
    filtering to standalone customer accounts. Returns {} if the table isn't
    configured or the scan fails — the rollup falls back to None accountOrg
    and the frontend treats unknown as "no filter".
    """
    if not client_metadata_table:
        return {}
    try:
        ddb = boto3.resource("dynamodb")
        table = ddb.Table(client_metadata_table)
        out: dict[str, str] = {}
        last = None
        while True:
            kw: dict[str, Any] = {}
            if last:
                kw["ExclusiveStartKey"] = last
            resp = table.scan(
                ProjectionExpression="clientName, accountOrg",
            )
            for it in resp.get("Items", []) or []:
                name = it.get("clientName")
                org = it.get("accountOrg")
                if name and org:
                    out[str(name)] = str(org)
            last = resp.get("LastEvaluatedKey")
            if not last:
                break
        return out
    except Exception as e:
        logger.warning(
            "client-metadata scan failed; accountOrg will be None for all clients",
            _name="ROLLUP_METADATA_SCAN_FAILED",
            error=str(e),
        )
        return {}


def list_client_names(
    client_config_table: str,
    only_name: str | None = None,
    client_metadata_table: str | None = None,
) -> list[dict]:
    """Scan numa-client-config and return [{clientName, client_account_id, region, account_org, ...}].

    If `client_metadata_table` is provided, joins each row with its accountOrg
    from numa-client-metadata.
    """
    ddb = boto3.resource("dynamodb")
    table = ddb.Table(client_config_table)
    org_map = _load_account_orgs(client_metadata_table)

    def _augment(summary: dict) -> dict:
        summary["account_org"] = org_map.get(summary.get("clientName") or "")
        return summary

    if only_name:
        resp = table.get_item(Key={"clientName": only_name})
        item = resp.get("Item")
        return [_augment(_extract_client_summary(item))] if item else []

    items: list[dict] = []
    last = None
    while True:
        kw: dict[str, Any] = {}
        if last:
            kw["ExclusiveStartKey"] = last
        resp = table.scan(**kw)
        for it in resp.get("Items", []):
            items.append(_augment(_extract_client_summary(it)))
        last = resp.get("LastEvaluatedKey")
        if not last:
            break
    return [c for c in items if c.get("clientName") and c.get("client_account_id")]


def _extract_client_summary(item: dict) -> dict:
    """Flatten the two coexisting client-config schemas (top-level vs nested
    `config` map) into a uniform summary dict."""
    cfg = item.get("config") if isinstance(item.get("config"), dict) else {}
    cn = item.get("clientName")
    return {
        "clientName": cn,
        "client_account_id": item.get("clientAccountId") or cfg.get("clientAccountId"),
        "region": item.get("region") or cfg.get("region") or "us-east-1",
        "dev_instance": bool(
            item.get("developerMode")
            or item.get("devInstance")
            or cfg.get("developerMode")
            or cfg.get("devInstance")
            or False
        ),
        "bedrock_account": item.get("bedrockAccount") or cfg.get("bedrockAccount"),
        "allow_bedrock_quota_sharing": bool(
            cfg.get("allowBedrockQuotaSharing") or False
        ),
        "preferred_kb": item.get("preferredKnowledgeBase")
        or cfg.get("preferredKnowledgeBase"),
    }
