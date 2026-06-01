#!/usr/bin/env python3
"""
credits-backfill.py — populate the Numa credit ledger from historical S3 conversation traces.

Composition of the already-validated pieces:
  - trace walk (recover the model per turn from the preceding `assistant` event)
  - lib/credit-pricing: recalculate_anthropic_cost -> floor_credits -> ledger.meta_item/msg_item
  - Nova 2 Lite for the aggregate conversation title

SAFE BY DEFAULT — dry-run unless --write. Dry-run prints the exact rows it WOULD put, needs no
deployed table, and is read-only, so it runs before the ledger table is deployed. Point it at a
dev/hq client, NEVER a customer account (e.g. av-media).

v1 scope: produces COST-RECOVERY credits (the floor) + titles. Value-tier credits are 0 until the
Nova 2 Lite complexity classifier (#7) lands, so charged = max(value, floor) = floor for now.
Claude-priced turns get full cost; unknown-model turns (e.g. the Opus-4.5 bench) are title-only and
flagged COST-INCOMPLETE.

USAGE
  # dry-run (read-only, no table needed):
  AWS_PROFILE=q-demo python tools/credits-backfill.py --client nd-labs --limit 10 --no-titles
  AWS_PROFILE=q-demo python tools/credits-backfill.py --client nd-labs --limit 5            # + Nova titles
  AWS_PROFILE=q-demo python tools/credits-backfill.py --client nd-labs --limit 3 --verbose  # full row JSON
  # write (requires the deployed numa-<client>-credit-ledger table):
  AWS_PROFILE=q-demo python tools/credits-backfill.py --client nd-labs --write
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterator, Optional

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "lib" / "credit-pricing"))

from credit_pricing import (  # noqa: E402  (shared trace->rows engine; no drift vs the live Lambda)
    processing,
)
from credit_pricing.credits import CREDIT_USD, MARGIN_TARGET  # noqa: E402
from credit_pricing.tiers import classify  # noqa: E402

NOVA_MODEL = "global.amazon.nova-2-lite-v1:0"


def _client(service: str, region: Optional[str] = None):
    kwargs = {"region_name": region} if region else {}
    try:
        from prm import client as prm_client  # repo convention: PRM-wrapped client

        return prm_client(service, **kwargs)
    except Exception:
        import boto3

        return boto3.client(service, **kwargs)


def _resource(service: str, region: Optional[str] = None):
    kwargs = {"region_name": region} if region else {}
    try:
        from prm import resource as prm_resource

        return prm_resource(service, **kwargs)
    except Exception:
        import boto3

        return boto3.resource(service, **kwargs)


def iter_trace(text: str) -> Iterator[dict]:
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def fallback_title(user_texts: list[str]) -> str:
    words = (user_texts[0] if user_texts else "").split()
    return " ".join(words[:8]) or "(untitled conversation)"


def nova_title(bedrock, user_texts: list[str]) -> str:
    convo = "\n".join(user_texts[:3])[:4000] or "(no user text)"
    prompt = (
        "Give a short, specific title (max 8 words, no quotes, no trailing period) for a work "
        "conversation that begins with these user messages:\n\n" + convo
    )
    resp = bedrock.converse(
        modelId=NOVA_MODEL,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": 32, "temperature": 0.2},
    )
    # strip leading markdown heading marks (Nova sometimes returns "### Title") + surrounding quotes
    return (
        resp["output"]["message"]["content"][0]["text"]
        .strip()
        .lstrip("#")
        .strip()
        .strip('"')
        .strip()
    )


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


def parse_key(key: str) -> tuple[str, str]:
    # numa-chat/workspace/{user_sub}/conversations/{conv_id}/_system/trace.jsonl
    parts = key.split("/")
    try:
        return parts[2], parts[4]
    except IndexError:
        return "", key


def list_traces(s3, bucket: str, prefix: str, limit: int) -> list[tuple[str, str]]:
    """Return [(key, last_modified_iso)] for trace.jsonl objects under prefix."""
    out: list[tuple[str, str]] = []
    for page in s3.get_paginator("list_objects_v2").paginate(
        Bucket=bucket, Prefix=prefix
    ):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith("/_system/trace.jsonl"):
                out.append((obj["Key"], obj["LastModified"].isoformat()))
                if limit and len(out) >= limit:
                    return out
    return out


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Backfill the Numa credit ledger from S3 traces (dry-run by default)."
    )
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument(
        "--client",
        help="Client slug -> bucket numa-<client>-outputs + table numa-<client>-credit-ledger (dev/hq only).",
    )
    src.add_argument(
        "--local-trace", help="Path to a local trace.jsonl (offline; no AWS)."
    )
    ap.add_argument("--user-sub", help="Restrict S3 scan to one user_sub.")
    ap.add_argument(
        "--bucket", help="Override source bucket (default numa-<client>-outputs)."
    )
    ap.add_argument(
        "--table", help="Override ledger table (default numa-<client>-credit-ledger)."
    )
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument(
        "--limit", type=int, default=25, help="Max conversations (0 = all)."
    )
    ap.add_argument(
        "--cache-ttl",
        choices=["1h", "5m"],
        default="1h",
        help="Fallback cache tier for traces lacking the per-turn 1h/5m split.",
    )
    ap.add_argument("--margin", type=float, default=MARGIN_TARGET)
    ap.add_argument("--credit-usd", type=float, default=CREDIT_USD)
    ap.add_argument(
        "--write",
        action="store_true",
        help="Actually write to DynamoDB (default: dry-run).",
    )
    ap.add_argument(
        "--no-titles",
        action="store_true",
        help="Skip Nova 2 Lite titles (use a fallback from the first user message).",
    )
    ap.add_argument(
        "--classify",
        action="store_true",
        help="Classify each conversation's complexity tier via Nova 2 Lite (sets value-tier credits; charged = max(value, floor)).",
    )
    ap.add_argument(
        "--verbose", action="store_true", help="Print full row JSON in dry-run."
    )
    args = ap.parse_args()

    mode = "WRITE" if args.write else "DRY-RUN"
    need_bedrock = (not args.no_titles) or args.classify
    bedrock = _client("bedrock-runtime", args.region) if need_bedrock else None
    title_failures = 0

    # Collect (conv_id, user_sub, last_ts, events) sources.
    sources: list[tuple[str, str, Optional[str], Iterator[dict]]] = []
    if args.local_trace:
        text = Path(args.local_trace).read_text(encoding="utf-8")
        sources.append(("local-trace", "", None, iter_trace(text)))
    else:
        bucket = args.bucket or f"numa-{args.client}-outputs"
        prefix = (
            f"numa-chat/workspace/{args.user_sub}/conversations/"
            if args.user_sub
            else "numa-chat/workspace/"
        )
        s3 = _client("s3", args.region)
        keys = list_traces(s3, bucket, prefix, args.limit)
        print(f"# [{mode}] bucket={bucket} prefix={prefix} -> {len(keys)} trace(s)\n")
        for key, last_mod in keys:
            user_sub, conv_id = parse_key(key)
            body = (
                s3.get_object(Bucket=bucket, Key=key)["Body"]
                .read()
                .decode("utf-8", "replace")
            )
            sources.append((conv_id, user_sub, last_mod, iter_trace(body)))

    table = None
    if args.write:
        table_name = args.table or f"numa-{args.client}-credit-ledger"
        table = _resource("dynamodb", args.region).Table(table_name)
        print(f"# WRITING to {table_name}\n")

    print(
        f"# {'conv':<24} {'turns':>5} {'consumpUSD':>10} {'tier':>10} {'val':>4} {'flr':>4} {'chg':>4}  title"
    )
    tot_convs = tot_msgs = tot_floor = incomplete_convs = 0
    tot_cons = 0.0
    for conv_id, user_sub, last_ts, events in sources:
        turns, user_texts, trace_first_ts, trace_last_ts = (
            processing.process_trace_events(events, cache_ttl=args.cache_ttl)
        )
        if not turns:
            continue
        first_ts = trace_first_ts
        eff_last_ts = (
            trace_last_ts or last_ts
        )  # trace's own span preferred over S3 sync time
        if args.no_titles or bedrock is None:
            title = fallback_title(user_texts)
        else:
            try:
                title = nova_title(bedrock, user_texts)
            except (
                Exception
            ) as e:  # noqa: BLE001 — title is best-effort; never block backfill
                title_failures += 1
                title = fallback_title(user_texts)
                if title_failures <= 3:
                    print(
                        f"  ! Nova title failed for {conv_id[:18]} ({type(e).__name__}); using fallback"
                    )
        # Scheduled agent runs (conv id "schedule-*") are one fire, not an iterative chat task,
        # so they price at the cheaper AGENT tier (rubric's "agent / 2" rule), not chat.
        is_scheduled = str(conv_id).startswith("schedule-")
        context = "agent" if is_scheduled else "chat"
        source = "scheduled" if is_scheduled else "chat"
        value_tier = category = None
        if args.classify:
            cls = classify(
                user_texts, context=context, bedrock=bedrock, region=args.region
            )
            value_tier, category = cls["tier"], cls["category"]
        meta, msg_rows = processing.build_conversation_rows(
            conversation_id=conv_id,
            user_sub=user_sub,
            month=(eff_last_ts[:7] if eff_last_ts else "unknown"),
            first_ts=first_ts,
            last_ts=eff_last_ts,
            turns=turns,
            title=title,
            margin=args.margin,
            credit_usd=args.credit_usd,
            bedrock_region=(None if args.local_trace else args.region),
            value_tier=value_tier,
            category=category,
            context=context,
            source=source,
        )
        flag = " [COST-INCOMPLETE]" if meta["costIncomplete"] else ""
        print(
            f"  {conv_id[:24]:<24} {meta['msgCount']:>5} {meta['consumptionCostUsd']:>10.4f} "
            f"{meta['dominantTier']:>10} {int(meta['creditsValue']):>4} {meta['creditsFloor']:>4} "
            f"{meta['creditsCharged']:>4}  {title}{flag}"
        )
        if args.verbose:
            print(
                json.dumps({"meta": meta, "messages": msg_rows}, indent=2, default=str)
            )
        if args.write and table is not None:
            with table.batch_writer() as bw:
                bw.put_item(Item=_to_dynamo(meta))
                for row in msg_rows:
                    bw.put_item(Item=_to_dynamo(row))
        tot_convs += 1
        tot_msgs += len(msg_rows)
        tot_floor += meta["creditsCharged"]
        tot_cons += meta["consumptionCostUsd"]
        incomplete_convs += 1 if meta["costIncomplete"] else 0

    print("\n# ── summary ──")
    print(f"#  mode:                 {mode}")
    print(
        f"#  conversations:        {tot_convs}  (cost-incomplete / title-only: {incomplete_convs})"
    )
    print(f"#  message rows:         {tot_msgs}")
    print(f"#  consumption (USD):    {tot_cons:.4f}")
    print(
        f"#  credits (charged):    {tot_floor}  (= US${tot_floor * args.credit_usd:.2f})"
    )
    if title_failures:
        print(f"#  title fallbacks:      {title_failures}")
    if not args.classify:
        print(
            "#  NOTE: --classify off -> value-tier=0, charged=floor (cost-recovery only)."
        )
    if not args.write:
        print(
            "#  DRY-RUN — nothing written. Re-run with --write once the ledger table is deployed."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
