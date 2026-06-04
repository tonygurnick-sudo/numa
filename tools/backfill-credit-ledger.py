#!/usr/bin/env python3
"""
backfill-credit-ledger.py — backfill a client's ACTUAL deployed credit-ledger table.

Given a client and a time range (default last 30 days), this replays the Numa Credit System over the
client's historical conversation traces and writes the resulting ledger rows into the deployed
``numa-<client>-credit-ledger`` table — exactly as the live ``credit-debit`` Lambda + nightly
summariser would have produced them:

  - reads each conversation trace from the client's outputs bucket,
  - recomputes token cost (lib/credit-pricing) and classifies the complexity tier (Nova 2 Lite),
  - applies the client's pricing CONFIG row (credit$, margin, per-tier defence margins, value tiers,
    AgentCore multiplier) — falling back to lib defaults,
  - generates an ADMIN-SAFE anonymised title + deliverables (the nightly summariser's job),
  - writes the META + per-message rows idempotently (deterministic keys; re-runs overwrite, never
    double-count), with the same stale-MSG cleanup as the live debit Lambda.

SAFE BY DEFAULT — dry-run unless ``--write``. Dry-run prints a per-conversation table + summary and
touches nothing. ``--write`` writes to the deployed table (it must already exist — it does on any
client running the credit system).

Nova can be routed to a high-quota account with ``--bedrock-profile`` (e.g. q-demo) so a fleet of
backfills doesn't hit per-client Bedrock limits and the classification cost lands on our bill; the
trace reads and the table writes always use the client account (AWS_PROFILE / --region).

USAGE
  # dev/hq (read-only preview, last 30 days):
  AWS_PROFILE=arcanum-prod-numa-demo python3 tools/backfill-credit-ledger.py --client hq
  # write it (last 14 days), Nova via q-demo:
  AWS_PROFILE=av-media python3 tools/backfill-credit-ledger.py --client av-media --days 14 \
      --bedrock-profile q-demo --write
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterator, Optional

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "lib" / "credit-pricing"))

from credit_pricing import processing  # noqa: E402
from credit_pricing.credits import (  # noqa: E402
    AGENTCORE_MULT,
    CREDIT_USD,
    MARGIN_TARGET,
    TRIVIAL_CONSUMPTION_USD,
)
from credit_pricing.tiers import classify, generate_receipt  # noqa: E402

S3_PREFIX = "numa-chat/workspace"
RETRY_CFG = Config(retries={"max_attempts": 8, "mode": "adaptive"})


def _client(service: str, region: str, profile: Optional[str] = None):
    """A boto3 client. ``profile`` overrides the session (used to route Nova to another account)."""
    session = boto3.Session(profile_name=profile) if profile else boto3.Session()
    try:
        # repo convention: PRM-wrapped clients carry the Marketplace product code
        from prm import client as prm_client  # noqa: PLC0415

        if profile is None:
            return prm_client(service, region=region)
    except Exception:
        pass
    return session.client(service, region_name=region, config=RETRY_CFG)


def _resource(service: str, region: str):
    try:
        from prm import resource as prm_resource  # noqa: PLC0415

        return prm_resource(service, region=region)
    except Exception:
        return boto3.resource(service, region_name=region, config=RETRY_CFG)


def _to_dynamo(obj: Any) -> Any:
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
    if not turns:
        return ""
    total = sum(
        t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_creation_tokens
        for t in turns
    )
    models = sorted({t.model.split(".")[-1] for t in turns if t.model})
    return f"{len(turns)} model turns; ~{total:,} tokens; models: {', '.join(models) or 'unknown'}"


def _load_config(table, client: str) -> dict[str, Any]:
    """The client's pricing CONFIG row (PK=CLIENT#/SK=CONFIG); empty -> lib defaults apply."""
    try:
        return (
            table.get_item(Key={"PK": f"CLIENT#{client}", "SK": "CONFIG"}).get("Item")
            or {}
        )
    except Exception:
        return {}


def _effective_pricing(cfg: dict, args) -> dict[str, Any]:
    """Resolve the pricing dials from CONFIG, then CLI overrides, then lib defaults — matching the
    precedence the live credit-debit Lambda uses."""
    credit = (
        float(cfg["creditUsd"]) if cfg.get("creditUsd") is not None else args.credit_usd
    )
    margin = float(cfg["margin"]) if cfg.get("margin") is not None else args.margin
    trivial = (
        float(cfg["trivialConsumptionUsd"])
        if cfg.get("trivialConsumptionUsd") is not None
        else TRIVIAL_CONSUMPTION_USD
    )
    agentcore = (
        float(cfg["agentcoreMult"])
        if cfg.get("agentcoreMult") is not None
        else args.agentcore_mult
    )
    tiers = None
    if isinstance(cfg.get("valueTiers"), dict):
        tiers = {
            ctx: {k: int(v) for k, v in d.items()}
            for ctx, d in cfg["valueTiers"].items()
            if isinstance(d, dict)
        }
    margins = {t: margin for t in ("low", "medium", "high", "very_high")}
    if isinstance(cfg.get("marginsByTier"), dict):
        margins.update({k: float(v) for k, v in cfg["marginsByTier"].items()})
    return {
        "credit": credit,
        "margin": margin,
        "trivial": trivial,
        "agentcore": agentcore,
        "tiers": tiers,
        "margins": margins,
    }


def _list_traces(s3, bucket: str, since: datetime, limit: int) -> list[dict]:
    out: list[dict] = []
    for page in s3.get_paginator("list_objects_v2").paginate(
        Bucket=bucket, Prefix=f"{S3_PREFIX}/"
    ):
        for obj in page.get("Contents", []) or []:
            k = obj["Key"]
            if not k.endswith("/_system/trace.jsonl") or obj["LastModified"] < since:
                continue
            parts = k.split("/")
            if len(parts) < 7:
                continue
            out.append({"key": k, "user_sub": parts[2], "conv_id": parts[4]})
    out.sort(key=lambda r: r["conv_id"])
    return out[:limit] if limit else out


def _write_conversation(table, conv_id: str, meta: dict, msg_rows: list[dict]) -> None:
    """Idempotent write: delete stale MSG rows then put META + MSG (mirrors the live debit Lambda)."""
    conv_key = f"CONV#{conv_id}"
    keep = {"META"} | {row["SK"] for row in msg_rows}
    existing = table.query(
        KeyConditionExpression=Key("PK").eq(conv_key), ProjectionExpression="SK"
    )
    stale = [r["SK"] for r in existing.get("Items", []) if r["SK"] not in keep]
    with table.batch_writer() as bw:
        for sk in stale:
            bw.delete_item(Key={"PK": conv_key, "SK": sk})
        bw.put_item(Item=_to_dynamo(meta))
        for row in msg_rows:
            bw.put_item(Item=_to_dynamo(row))


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Backfill a client's deployed credit-ledger table (dry-run by default)."
    )
    ap.add_argument(
        "--client",
        required=True,
        help="Client slug -> bucket numa-<client>-outputs + table numa-<client>-credit-ledger.",
    )
    ap.add_argument(
        "--days",
        type=int,
        default=30,
        help="Backfill conversations touched in the last N days (S3 LastModified).",
    )
    ap.add_argument(
        "--region",
        default="us-east-1",
        help="Client/data region (S3 traces + DynamoDB table).",
    )
    ap.add_argument(
        "--bedrock-profile",
        help="Run Nova in THIS profile (e.g. q-demo) instead of the client account.",
    )
    ap.add_argument(
        "--bedrock-region",
        help="Region for Nova (default us-east-1 with --bedrock-profile, else --region).",
    )
    ap.add_argument(
        "--limit", type=int, default=0, help="Cap conversations (0 = all in window)."
    )
    ap.add_argument(
        "--bucket", help="Override source bucket (default numa-<client>-outputs)."
    )
    ap.add_argument(
        "--table", help="Override ledger table (default numa-<client>-credit-ledger)."
    )
    ap.add_argument("--cache-ttl", choices=["1h", "5m"], default="1h")
    ap.add_argument(
        "--no-receipt",
        action="store_true",
        help="Skip the anonymised title + deliverables (the nightly summariser would fill them later).",
    )
    ap.add_argument(
        "--write",
        action="store_true",
        help="Actually write to DynamoDB (default: dry-run).",
    )
    # pricing fallbacks (used only when the client CONFIG row is missing the value)
    ap.add_argument("--credit-usd", type=float, default=CREDIT_USD)
    ap.add_argument("--margin", type=float, default=MARGIN_TARGET)
    ap.add_argument("--agentcore-mult", type=float, default=AGENTCORE_MULT)
    args = ap.parse_args()

    mode = "WRITE" if args.write else "DRY-RUN"
    bucket = args.bucket or f"numa-{args.client}-outputs"
    table_name = args.table or f"numa-{args.client}-credit-ledger"
    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days)
    now_iso = datetime.now(timezone.utc).isoformat()

    s3 = _client("s3", args.region)
    table = _resource("dynamodb", args.region).Table(table_name)
    need_nova = not args.no_receipt or True  # tier classification always needs Nova
    br_region = args.bedrock_region or (
        "us-east-1" if args.bedrock_profile else args.region
    )
    bedrock = (
        _client("bedrock-runtime", br_region, profile=args.bedrock_profile)
        if need_nova
        else None
    )

    cfg = _load_config(table, args.client)
    p = _effective_pricing(cfg, args)
    print(
        f"# [{mode}] client={args.client} table={table_name} window={args.days}d cutoff={cutoff.isoformat()}",
        file=sys.stderr,
    )
    print(
        f"# pricing: credit=${p['credit']} margin={p['margin']}x agentcore={p['agentcore']}x "
        f"{'(from CONFIG row)' if cfg else '(lib defaults — no CONFIG row)'}",
        file=sys.stderr,
    )
    if args.bedrock_profile:
        print(
            f"# Nova via profile={args.bedrock_profile} region={br_region} (data/table via AWS_PROFILE/{args.region})",
            file=sys.stderr,
        )

    traces = _list_traces(s3, bucket, cutoff, args.limit)
    print(f"# {len(traces)} conversation(s) in window\n", file=sys.stderr)
    if not traces:
        return 0

    print(f"# {'conv':<24} {'turns':>5} {'consUSD':>9} {'tier':>10} {'chg':>5}  title")
    tot_convs = tot_msgs = tot_charged = incomplete = 0
    tot_cons = 0.0
    for t in traces:
        conv_id, user_sub = t["conv_id"], t["user_sub"]
        try:
            body = (
                s3.get_object(Bucket=bucket, Key=t["key"])["Body"]
                .read()
                .decode("utf-8", "replace")
            )
        except Exception as e:  # noqa: BLE001
            print(f"  ! {conv_id[:18]} read failed: {e}", file=sys.stderr)
            continue
        turns, user_texts, first_ts, last_ts = processing.process_trace_events(
            _iter_trace(body), cache_ttl=args.cache_ttl
        )
        if not turns:
            continue
        is_scheduled = conv_id.startswith("schedule-")
        context = "agent" if is_scheduled else "chat"  # matches the live debit Lambda
        source = "scheduled" if is_scheduled else "chat"

        cls = classify(
            user_texts,
            context=context,
            actions=_actions_summary(turns),
            bedrock=bedrock,
            region=br_region,
        )
        if args.no_receipt:
            title, deliverables = "", []
        else:
            r = generate_receipt(
                user_texts,
                actions=_actions_summary(turns),
                bedrock=bedrock,
                region=br_region,
            )
            title, deliverables = r["title"], r["deliverables"]

        meta, msg_rows = processing.build_conversation_rows(
            conversation_id=conv_id,
            user_sub=user_sub,
            month=(last_ts or first_ts or now_iso)[:7],
            first_ts=first_ts,
            last_ts=last_ts,
            turns=turns,
            title=title,
            margin=p["margin"],
            credit_usd=p["credit"],
            value_tier=cls["tier"],
            category=cls["category"],
            context=context,
            source=source,
            bedrock_region=args.region,
            value_tier_credits=p["tiers"],
            trivial_consumption_usd=p["trivial"],
            margins=p["margins"],
            agentcore_mult=p["agentcore"],
        )
        if not args.no_receipt:
            meta["deliverables"] = deliverables
            meta["summarisedAt"] = now_iso

        print(
            f"  {conv_id[:24]:<24} {meta['msgCount']:>5} {meta['consumptionCostUsd']:>9.4f} "
            f"{meta['dominantTier']:>10} {meta['creditsCharged']:>5}  {title}"
            f"{' [INC]' if meta['costIncomplete'] else ''}"
        )

        if args.write:
            _write_conversation(table, conv_id, meta, msg_rows)

        tot_convs += 1
        tot_msgs += len(msg_rows)
        tot_charged += meta["creditsCharged"]
        tot_cons += meta["consumptionCostUsd"]
        incomplete += 1 if meta["costIncomplete"] else 0

    basis = tot_cons * p["agentcore"]
    print("\n# ── summary ──")
    print(f"#  mode:                 {mode}")
    print(f"#  conversations:        {tot_convs}  (cost-incomplete: {incomplete})")
    print(f"#  message rows:         {tot_msgs}")
    print(f"#  consumption (tokens): ${tot_cons:.2f}   (+AgentCore ${basis:.2f})")
    print(
        f"#  credits charged:      {tot_charged}  (= ${tot_charged * p['credit']:.2f})"
    )
    if basis:
        print(f"#  margin vs consumption: {(tot_charged * p['credit']) / basis:.2f}x")
    if not args.write:
        print(
            f"#  DRY-RUN — nothing written to {table_name}. Re-run with --write to persist."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
