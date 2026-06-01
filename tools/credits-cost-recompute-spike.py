#!/usr/bin/env python3
"""
credits-cost-recompute-spike.py — read-only validation of the Numa credit cost engine.

WHAT THIS IS
  Step 2 of the Numa Credit System build (see
  ai-workspace/numa-credits-consumption-floor-spec.md). The keystone correctness
  check that BOTH live metering and history backfill depend on: given a real
  conversation trace, recompute the true Bedrock token cost per turn, convert to
  NZD, and show the cost-recovery FLOOR — the credits we must charge so credits
  always exceed our cost.

  READ-ONLY. Reads trace.jsonl from S3 (or a local file). Writes nothing, deploys
  nothing. Safe against hq / a dev stack. Do NOT point it at a customer account
  (e.g. av-media) — use dev/hq data.

WHY RECOMPUTE (don't trust the trace's total_cost_usd)
  The Claude Agent SDK under-reports cache_creation on the 1h cache tier
  (interactive workspace chat) by ~2x — it only knows the 5m write rate. We
  recompute from raw token counts with AWS-billed rates. This script prints BOTH
  the SDK figure and the recompute so you can see the gap empirically.

CAVEATS surfaced by the integration map (and handled here)
  - model_id lives on the preceding `assistant` event, NOT the `result` event —
    tracked per turn. Turns whose model isn't in the (Claude-only) pricing table
    can't be cost-recomputed -> flagged "cost-incomplete" (title-only backfill).
  - cache_ttl is NOT stored in the trace — it's app context (1h for interactive
    workspace chat, 5m otherwise). Wrong guess = ~2x cache_creation error.
    --cache-ttl sets the assumption (default 1h).
  - AgentCore MicroVM seconds are NOT in the trace (only duration_ms wall-clock).
    Token cost only by default; pass --agentcore-nzd-per-min for a rough proxy.

VENDORED COST LOGIC
  ANTHROPIC_MODEL_PRICING / _strip_prefix / recalculate_anthropic_cost are copied
  from services/numa-workspace-agent/numa_workspace_agent/sdk_config.py (can't be
  imported — that module pulls in claude_agent_sdk at load). KEEP IN SYNC if the
  rates there change.

USAGE
  AWS_PROFILE=q-demo python tools/credits-cost-recompute-spike.py --client hq --limit 25
  AWS_PROFILE=q-demo python tools/credits-cost-recompute-spike.py --client nd-labs --user-sub <sub>
  python tools/credits-cost-recompute-spike.py --local-trace ./trace.jsonl
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, field
from typing import Iterator, Optional

# ── Vendored from sdk_config.py — KEEP IN SYNC ───────────────────────────────
_KNOWN_PREFIXES = ("us.", "au.", "apac.", "eu.", "global.")

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
    for p in _KNOWN_PREFIXES:
        if model_id.startswith(p):
            return model_id[len(p) :]
    return model_id


def _normalise_bare(bare: str) -> str:
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
    cache_creation_tokens: int,
    cache_ttl: str = "5m",
) -> Optional[float]:
    """Recompute total_cost_usd from raw token counts. None when model unknown."""
    if not model_id:
        return None
    rates = ANTHROPIC_MODEL_PRICING.get(_normalise_bare(_strip_prefix(model_id)))
    if rates is None:
        return None
    write_rate = (
        rates["cache_write_1h"] if cache_ttl == "1h" else rates["cache_write_5m"]
    )
    return (
        input_tokens * rates["input"]
        + output_tokens * rates["output"]
        + cache_read_tokens * rates["cache_read"]
        + cache_creation_tokens * write_rate
    ) / 1_000_000


# ── end vendored ─────────────────────────────────────────────────────────────


@dataclass
class ConvCost:
    conv_id: str
    user_sub: str = ""
    turns: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    duration_ms: int = 0
    recomputed_usd: float = 0.0
    sdk_usd: float = 0.0
    models: set = field(default_factory=set)
    unknown_model_turns: int = 0  # turns we couldn't cost -> title-only

    @property
    def cost_incomplete(self) -> bool:
        return self.unknown_model_turns > 0


def iter_trace(text: str) -> Iterator[dict]:
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def aggregate(
    conv_id: str, user_sub: str, events: Iterator[dict], cache_ttl: str
) -> ConvCost:
    cc = ConvCost(conv_id=conv_id, user_sub=user_sub)
    last_model: Optional[str] = None
    for ev in events:
        etype = ev.get("type")
        if etype == "assistant":
            model = (ev.get("message") or {}).get("model")
            if model:
                last_model = model
        elif etype == "result":
            usage = ev.get("usage") or {}
            it = int(usage.get("input_tokens") or 0)
            ot = int(usage.get("output_tokens") or 0)
            cr = int(usage.get("cache_read_input_tokens") or 0)
            cw = int(usage.get("cache_creation_input_tokens") or 0)
            cc.turns += 1
            cc.input_tokens += it
            cc.output_tokens += ot
            cc.cache_read_tokens += cr
            cc.cache_creation_tokens += cw
            cc.duration_ms += int(ev.get("duration_ms") or 0)
            if last_model:
                cc.models.add(_normalise_bare(_strip_prefix(last_model)))
            sdk = ev.get("total_cost_usd")
            if isinstance(sdk, (int, float)):
                cc.sdk_usd += float(sdk)
            recomputed = recalculate_anthropic_cost(
                last_model,
                input_tokens=it,
                output_tokens=ot,
                cache_read_tokens=cr,
                cache_creation_tokens=cw,
                cache_ttl=cache_ttl,
            )
            if recomputed is None:
                cc.unknown_model_turns += 1
                if isinstance(sdk, (int, float)):
                    cc.recomputed_usd += float(
                        sdk
                    )  # fall back so totals aren't wild; flagged
            else:
                cc.recomputed_usd += recomputed
    return cc


def floor_credits(consumption_usd: float, margin: float, credit_usd: float) -> int:
    return math.ceil(consumption_usd * margin / credit_usd)


def _k(n: int) -> str:
    return f"{n/1000:.0f}k" if n >= 1000 else str(n)


def _get_s3(region: Optional[str]):
    kwargs = {"region_name": region} if region else {}
    try:
        from prm import client as prm_client  # repo convention: PRM-wrapped client

        return prm_client("s3", **kwargs)
    except Exception:
        import boto3

        return boto3.client("s3", **kwargs)


def list_trace_keys(s3, bucket: str, prefix: str, limit: int) -> list[str]:
    keys: list[str] = []
    for page in s3.get_paginator("list_objects_v2").paginate(
        Bucket=bucket, Prefix=prefix
    ):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/_system/trace.jsonl"):
                keys.append(key)
                if limit and len(keys) >= limit:
                    return keys
    return keys


def parse_key(key: str) -> tuple[str, str]:
    # numa-chat/workspace/{user_sub}/conversations/{conv_id}/_system/trace.jsonl
    parts = key.split("/")
    try:
        return parts[2], parts[4]
    except IndexError:
        return "", key


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Read-only Numa credit cost-recompute spike."
    )
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument(
        "--client",
        help="Client slug -> bucket numa-<client>-outputs (dev/hq only, NOT a customer).",
    )
    src.add_argument(
        "--local-trace", help="Path to a local trace.jsonl (no AWS needed)."
    )
    ap.add_argument("--user-sub", help="Restrict S3 scan to one user_sub.")
    ap.add_argument("--bucket", help="Override bucket (default numa-<client>-outputs).")
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument(
        "--limit", type=int, default=25, help="Max conversations to scan (0 = all)."
    )
    ap.add_argument(
        "--cache-ttl",
        choices=["1h", "5m"],
        default="1h",
        help="Assumed cache tier (1h = interactive workspace; 5m = scheduled/sync).",
    )
    ap.add_argument(
        "--margin",
        type=float,
        default=2.0,
        help="Floor margin multiple over consumption cost.",
    )
    ap.add_argument(
        "--credit-usd", type=float, default=0.50, help="USD value of 1 credit."
    )
    ap.add_argument(
        "--agentcore-usd-per-min",
        type=float,
        default=0.0,
        help="Rough AgentCore proxy added to consumption (uses duration_ms). 0 = tokens only.",
    )
    args = ap.parse_args()

    convs: list[ConvCost] = []
    if args.local_trace:
        with open(args.local_trace, "r", encoding="utf-8") as f:
            text = f.read()
        convs.append(aggregate("local-trace", "", iter_trace(text), args.cache_ttl))
    else:
        bucket = args.bucket or f"numa-{args.client}-outputs"
        prefix = (
            f"numa-chat/workspace/{args.user_sub}/conversations/"
            if args.user_sub
            else "numa-chat/workspace/"
        )
        s3 = _get_s3(args.region)
        keys = list_trace_keys(s3, bucket, prefix, args.limit)
        print(f"# bucket={bucket} prefix={prefix} -> {len(keys)} trace file(s)\n")
        for key in keys:
            user_sub, conv_id = parse_key(key)
            body = (
                s3.get_object(Bucket=bucket, Key=key)["Body"]
                .read()
                .decode("utf-8", "replace")
            )
            convs.append(aggregate(conv_id, user_sub, iter_trace(body), args.cache_ttl))

    # ── Report ───────────────────────────────────────────────────────────────
    print(
        f"# cache_ttl={args.cache_ttl}  margin={args.margin}x  "
        f"credit=US${args.credit_usd:.2f}  agentcore=US${args.agentcore_usd_per_min:.3f}/min"
    )
    print(
        f"# {'conv':<24} {'turns':>5} {'in':>7} {'cacheR':>7} {'cacheW':>7} {'out':>6} "
        f"{'recompUSD':>10} {'sdkUSD':>9} {'consUSD':>8} {'floorCr':>8} flag"
    )
    tot = ConvCost(conv_id="TOTAL")
    tot_floor_cr = 0
    incomplete = 0
    for cc in sorted(convs, key=lambda c: c.recomputed_usd, reverse=True):
        ac_usd = (cc.duration_ms / 60000.0) * args.agentcore_usd_per_min
        consumption_usd = cc.recomputed_usd + ac_usd
        cr = floor_credits(consumption_usd, args.margin, args.credit_usd)
        tot_floor_cr += cr
        flag = "COST-INCOMPLETE" if cc.cost_incomplete else ""
        if cc.cost_incomplete:
            incomplete += 1
        print(
            f"  {cc.conv_id[:24]:<24} {cc.turns:>5} {_k(cc.input_tokens):>7} "
            f"{_k(cc.cache_read_tokens):>7} {_k(cc.cache_creation_tokens):>7} {_k(cc.output_tokens):>6} "
            f"{cc.recomputed_usd:>10.4f} {cc.sdk_usd:>9.4f} {consumption_usd:>8.4f} {cr:>8} {flag}"
        )
        tot.turns += cc.turns
        tot.input_tokens += cc.input_tokens
        tot.output_tokens += cc.output_tokens
        tot.cache_read_tokens += cc.cache_read_tokens
        tot.cache_creation_tokens += cc.cache_creation_tokens
        tot.recomputed_usd += cc.recomputed_usd
        tot.sdk_usd += cc.sdk_usd

    under = tot.recomputed_usd - tot.sdk_usd
    under_pct = (under / tot.sdk_usd * 100.0) if tot.sdk_usd else 0.0
    print("\n# ── summary ──")
    print(
        f"#  conversations:        {len(convs)}  (cost-incomplete / title-only: {incomplete})"
    )
    print(f"#  turns:                {tot.turns}")
    print(f"#  recomputed cost:      US${tot.recomputed_usd:.4f}")
    print(
        f"#  SDK-reported cost:    US${tot.sdk_usd:.4f}   (recompute is +US${under:.4f}, {under_pct:+.1f}% — the 1h cache_creation under-report)"
    )
    print(
        f"#  TOTAL floor credits:  {tot_floor_cr}  (= US${tot_floor_cr*args.credit_usd:.2f} of credits, guaranteeing >= {args.margin}x over consumption)"
    )
    print(
        "#  NOTE: token cost only unless --agentcore-usd-per-min set. Transcribe/heavy-Lambda and"
    )
    print(
        "#        true AgentCore seconds are recovered at the client/month reconciliation, not here."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
