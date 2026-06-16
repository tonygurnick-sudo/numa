"""Chat analytics — in-memory compute from S3 traces + DDB meta scan."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

from botocore.config import Config

# ─── pricing ────────────────────────────────────────────────────────────────
#
# Why we re-price from token counts rather than trust the SDK's
# `total_cost_usd`:
#   The Claude Agent SDK prices ALL cache writes at the 5-minute tier
#   ($3.75/MTok for Sonnet) — but the workspace agent enables 1-hour caching
#   for interactive chats (sdk_config.py:ENABLE_PROMPT_CACHING_1H_BEDROCK),
#   which Bedrock bills at the 1-hour tier ($6/MTok). The SDK undercharges
#   1h-cache writes by ~$2.25/MTok.
#
#   Validated against av-media CE: 13 settled days, our model
#   (1h-priced tokens × 1.10 cross-region) matches actual Bedrock CE within
#   1.2%. See dev-notes/tasks/av-media-cost-investigation/. The 1.10
#   cross-region markup only applies before GLOBAL_INFERENCE_CUTOVER —
#   after the cutover the workspace agents use the `global.` inference
#   profile which is priced at base.
#
# Each entry is $/MTok: input / output / cache_write_5m / cache_write_1h /
# cache_read. Multipliers vs input: 5m write = 1.25x, 1h write = 2x, read =
# 0.1x — these are the Anthropic-published Bedrock Edition rates.
MODEL_PRICING: dict[str, dict[str, float]] = {
    "claude-sonnet-4-6": {"in": 3.0, "out": 15.0, "c5": 3.75, "c1h": 6.0, "cr": 0.30},
    "claude-sonnet-4-5": {"in": 3.0, "out": 15.0, "c5": 3.75, "c1h": 6.0, "cr": 0.30},
    "claude-sonnet-4": {"in": 3.0, "out": 15.0, "c5": 3.75, "c1h": 6.0, "cr": 0.30},
    "claude-opus-4-1": {"in": 15.0, "out": 75.0, "c5": 18.75, "c1h": 30.0, "cr": 1.50},
    "claude-opus-4": {"in": 15.0, "out": 75.0, "c5": 18.75, "c1h": 30.0, "cr": 1.50},
    "claude-haiku-4-5": {"in": 1.0, "out": 5.0, "c5": 1.25, "c1h": 2.0, "cr": 0.10},
    "claude-3-5-haiku": {"in": 0.80, "out": 4.0, "c5": 1.0, "c1h": 1.6, "cr": 0.08},
    "claude-3-haiku": {"in": 0.25, "out": 1.25, "c5": 0.30, "c1h": 0.50, "cr": 0.03},
}
DEFAULT_PRICING_KEY = "claude-sonnet-4-6"

# Bedrock cross-region inference profiles (`us.`, `apac.`, `eu.`) add a
# flat 10% markup over base in-region pricing. Numa's workspace agents
# invoked through these regional profiles up until 2026-05-22, when we
# cut over to the `global.` inference profile (no markup). Events with a
# result-event timestamp strictly before the cutover get the 10% markup;
# events on/after get the base Bedrock price.
#
# If the deploy actually lands at a different moment, just bump
# GLOBAL_INFERENCE_CUTOVER — historical traces are re-priced on every
# fleet rollup, so the change applies retroactively.
CROSS_REGION_MULTIPLIER = 1.10
GLOBAL_INFERENCE_CUTOVER = datetime(2026, 5, 22, tzinfo=timezone.utc)


def _cross_region_multiplier(ts: Optional[str]) -> float:
    """Return 1.10 for events strictly before the global-inference cutover, else 1.0.

    Unknown / unparseable timestamps default to 1.0 (assume current pricing).
    """
    if not ts:
        return 1.0
    try:
        event_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return 1.0
    return CROSS_REGION_MULTIPLIER if event_dt < GLOBAL_INFERENCE_CUTOVER else 1.0


def _price_key(model: Optional[str]) -> str:
    """Map a SDK model id to our pricing table key. Falls back to Sonnet 4.6."""
    if not model:
        return DEFAULT_PRICING_KEY
    m = model.lower()
    # Match longest prefixes first so e.g. 'claude-sonnet-4-6' wins over
    # 'claude-sonnet-4'. dict insertion order preserves this.
    for key in MODEL_PRICING:
        if key in m:
            return key
    return DEFAULT_PRICING_KEY


def _price_event(usage: dict, model: Optional[str], ts: Optional[str] = None) -> float:
    """Recompute one Bedrock call's USD cost from its token breakdown.

    Uses the per-event `cache_creation.ephemeral_1h_input_tokens` vs
    `ephemeral_5m_input_tokens` split (which the SDK records but doesn't
    price correctly). Falls back to assuming 5m tier if the breakdown is
    missing (older traces). `ts` (the result event's ISO timestamp) selects
    the right cross-region markup — see GLOBAL_INFERENCE_CUTOVER.
    """
    p = MODEL_PRICING[_price_key(model)]
    cc = usage.get("cache_creation") or {}
    in_t = int(usage.get("input_tokens") or 0)
    out_t = int(usage.get("output_tokens") or 0)
    c5 = int(cc.get("ephemeral_5m_input_tokens") or 0)
    c1h = int(cc.get("ephemeral_1h_input_tokens") or 0)
    if c5 == 0 and c1h == 0:
        # Older traces only carry the rolled-up cache_creation_input_tokens.
        # Treat as 5m to match what the SDK assumed — no double-correction.
        c5 = int(usage.get("cache_creation_input_tokens") or 0)
    cr = int(usage.get("cache_read_input_tokens") or 0)
    base = (
        in_t * p["in"] + out_t * p["out"] + c5 * p["c5"] + c1h * p["c1h"] + cr * p["cr"]
    ) / 1_000_000
    return base * _cross_region_multiplier(ts)


# Models billed by the relay/provider, NOT by the Bedrock MODEL_PRICING table above. Their reported
# usage.cost (the trace's `result.total_cost_usd`) IS the real charge — and captures what a token
# recompute would miss (e.g. DeepSeek's reasoning tokens, which aren't fully in output_tokens). We
# trust total_cost_usd for these: a token recompute would price DeepSeek's shape at the Sonnet
# fallback rate (~19x the real cost). The opaque `numa-standard-model` id is stamped on every
# Standard turn (system-init + assistant events), so current_model carries it here.
RELAY_PRICED_MODELS = ("numa-standard-model",)


def _is_relay_priced(model: Optional[str]) -> bool:
    """True if the model is billed by the relay (use trace total_cost_usd), not the Bedrock table."""
    return bool(model) and any(m in model.lower() for m in RELAY_PRICED_MODELS)


# ─── trace -> analytics (pure compute, no side effects) ──────────────────────


def compute_trace_analytics(text: str) -> dict[str, Any]:
    """Walk one trace.jsonl body and compute the canonical analytics dict.

    Sums `result` events for cost/turns/tokens, counts assistant tool_use
    blocks, and counts user-typed text messages.

    Also emits per-day buckets keyed by the originating event's day
    (`daily_*` fields). The fleet rollup uses these to build accurate daily
    spend; without them, a multi-day conversation dumps its whole cost into
    one bucket and the dashboard's window slicing breaks for long-running
    chats and scheduled agents.
    """
    totals = {
        "total_cost_usd": 0.0,  # Recomputed from tokens (the canonical one)
        "sdk_cost_usd": 0.0,  # Sidecar: SDK's own number, for cross-check
        "total_turns": 0,
        "request_count": 0,
        "user_messages": 0,
        "error_count": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_creation_tokens": 0,
        "cache_creation_5m_tokens": 0,
        "cache_creation_1h_tokens": 0,
        "duration_ms_total": 0,
        "tool_call_count": 0,
    }
    tool_use_counts: dict[str, int] = {}
    first_request_at: Optional[str] = None
    last_request_at: Optional[str] = None
    model: Optional[str] = None
    # Tracks the most-recent model seen on system.init / assistant.message —
    # used to price each result event with the right rate table. Result
    # events themselves don't carry a model field.
    current_model: Optional[str] = None

    # Per-day buckets — each event contributes to the day it actually happened.
    daily_cost: dict[str, float] = defaultdict(float)
    daily_turns: dict[str, int] = defaultdict(int)
    daily_messages: dict[str, int] = defaultdict(int)
    daily_tool_calls: dict[str, int] = defaultdict(int)
    daily_request_count: dict[str, int] = defaultdict(int)
    # Set of days where ANY result/user/assistant event landed — caller turns
    # this into per-day distinct-conv and distinct-user counts.
    active_days: set[str] = set()

    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue

        etype = ev.get("type")
        ts = ev.get("timestamp")
        day = ts[:10] if isinstance(ts, str) and len(ts) >= 10 else None

        if etype == "system" and ev.get("subtype") == "init":
            init_model = (ev.get("data") or {}).get("model")
            if init_model:
                model = init_model
                current_model = init_model
        elif etype == "result":
            usage = ev.get("usage") or {}
            sdk_cost = float(ev.get("total_cost_usd") or 0)
            # Relay-priced models (Numa Standard Model / DeepSeek): the relay's reported cost is the
            # real charge, so trust total_cost_usd. Anthropic models keep the token recompute (the
            # SDK's own cost number had bugs the Bedrock table corrects). See _is_relay_priced.
            if _is_relay_priced(current_model):
                event_cost = sdk_cost
            else:
                event_cost = _price_event(usage, current_model, ts)
            turns = int(ev.get("num_turns") or 0)

            totals["request_count"] += 1
            totals["total_cost_usd"] += event_cost
            totals["sdk_cost_usd"] += sdk_cost
            totals["total_turns"] += turns
            totals["duration_ms_total"] += int(ev.get("duration_ms") or 0)
            if ev.get("is_error"):
                totals["error_count"] += 1

            totals["input_tokens"] += int(usage.get("input_tokens") or 0)
            totals["output_tokens"] += int(usage.get("output_tokens") or 0)
            totals["cache_read_tokens"] += int(
                usage.get("cache_read_input_tokens") or 0
            )
            cc = usage.get("cache_creation") or {}
            c5 = int(cc.get("ephemeral_5m_input_tokens") or 0)
            c1h = int(cc.get("ephemeral_1h_input_tokens") or 0)
            cc_total = int(usage.get("cache_creation_input_tokens") or 0)
            # If the breakdown is missing on older traces, assume the SDK
            # default (5m). Never zero out the rolled-up cache_creation_tokens
            # because the dashboard surfaces that field.
            if c5 == 0 and c1h == 0 and cc_total:
                c5 = cc_total
            totals["cache_creation_tokens"] += cc_total or (c5 + c1h)
            totals["cache_creation_5m_tokens"] += c5
            totals["cache_creation_1h_tokens"] += c1h

            if ts:
                if first_request_at is None or ts < first_request_at:
                    first_request_at = ts
                if last_request_at is None or ts > last_request_at:
                    last_request_at = ts
            if day:
                daily_cost[day] += event_cost
                daily_turns[day] += turns
                daily_request_count[day] += 1
                active_days.add(day)
        elif etype == "assistant":
            msg = ev.get("message") or {}
            asst_model = msg.get("model")
            if asst_model and asst_model != "<synthetic>":
                current_model = asst_model
                if not model:
                    model = asst_model
            content = msg.get("content") or []
            tool_uses_in_event = 0
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "tool_use":
                        totals["tool_call_count"] += 1
                        tool_uses_in_event += 1
                        name = part.get("name") or "unknown"
                        tool_use_counts[name] = tool_use_counts.get(name, 0) + 1
            if day:
                if tool_uses_in_event:
                    daily_tool_calls[day] += tool_uses_in_event
                active_days.add(day)
        elif etype == "user":
            content = (ev.get("message") or {}).get("content") or []
            if isinstance(content, list):
                has_text = any(
                    isinstance(p, dict) and p.get("type") == "text" for p in content
                )
                has_tool_result = any(
                    isinstance(p, dict) and p.get("type") == "tool_result"
                    for p in content
                )
                if has_text and not has_tool_result:
                    # The Claude Agent SDK injects skill content as user-role
                    # text messages (no tool_result wrapper). Without this
                    # filter every Skill tool_use adds +1 to user_messages,
                    # which roughly DOUBLED the count for scheduled runs that
                    # load any skill. Filter them out so user_messages reflects
                    # actual user prompts.
                    is_auto = False
                    for p in content:
                        if isinstance(p, dict) and p.get("type") == "text":
                            txt = p.get("text") or ""
                            if txt.startswith("Base directory for this skill:"):
                                is_auto = True
                                break
                    if not is_auto:
                        totals["user_messages"] += 1
                        if day:
                            daily_messages[day] += 1
                            active_days.add(day)

    return {
        **totals,
        "tool_use_counts": tool_use_counts,
        "first_request_at": first_request_at,
        "last_request_at": last_request_at,
        "model": model,
        "daily_cost": dict(daily_cost),
        "daily_turns": dict(daily_turns),
        "daily_messages": dict(daily_messages),
        "daily_tool_calls": dict(daily_tool_calls),
        "daily_request_count": dict(daily_request_count),
        "active_days": sorted(active_days),
    }


# ─── S3 trace walk (in-memory) ──────────────────────────────────────────────


def _list_traces(s3, bucket: str):
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix="numa-chat/workspace/"):
        for obj in page.get("Contents", []) or []:
            k = obj["Key"]
            if k.endswith("/_system/trace.jsonl"):
                parts = k.split("/")
                yield {
                    "key": k,
                    "user_sub": parts[2],
                    "conversation_id": parts[4],
                }


def compute_analytics_from_s3(
    session,
    client_name: str,
    region: str,
    workers: int = 16,
) -> dict[tuple[str, str], dict]:
    """Walk every trace.jsonl in S3 for a client and return
    {(user_sub, conv_id): analytics}.

    Pure compute. No DynamoDB reads or writes.
    """
    bucket = f"numa-{client_name}-outputs"
    s3 = session.client(
        "s3",
        region_name=region,
        config=Config(max_pool_connections=64, retries={"max_attempts": 5}),
    )

    keys = list(_list_traces(s3, bucket))
    out: dict[tuple[str, str], dict] = {}

    def _fetch(rec):
        try:
            body = s3.get_object(Bucket=bucket, Key=rec["key"])["Body"].read()
            text = body.decode("utf-8", "replace")
            return (
                (rec["user_sub"], rec["conversation_id"]),
                compute_trace_analytics(text),
            )
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for fut in as_completed([pool.submit(_fetch, r) for r in keys]):
            res = fut.result()
            if res:
                out[res[0]] = res[1]
    return out


# ─── DDB meta scan + merge ───────────────────────────────────────────────────


def _scan_all(table, **kw):
    items = []
    last = None
    while True:
        if last:
            kw["ExclusiveStartKey"] = last
        resp = table.scan(**kw)
        items.extend(resp.get("Items", []))
        last = resp.get("LastEvaluatedKey")
        if not last:
            return items


def _iso_to_ms(iso: Optional[str]) -> int:
    """Parse an ISO-8601 timestamp to epoch-ms. Returns 0 on failure."""
    if not iso:
        return 0
    try:
        return int(
            datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000
        )
    except (ValueError, TypeError):
        return 0


def gather_chat_analytics(
    session,
    client_name: str,
    region: str,
    days: int,
    schedule_lookup: Optional[dict[str, str]] = None,
    s3_analytics: Optional[dict[tuple[str, str], dict]] = None,
) -> dict[str, Any]:
    """Merge S3 trace analytics with DDB meta items.

    Iterates the UNION of (a) every conversation found in S3 traces and
    (b) every meta item in numa-<client>-chat-history. DDB meta supplies
    nice-to-have fields (agentTitle, isAgentConversation, the canonical
    latestTimestamp). S3 supplies cost/tokens/per-day buckets.

    Why the union (not just DDB meta): scheduled-run conversations
    frequently end up in S3 without a meta item ever being written —
    iterating meta items only would silently drop ~20-30% of scheduled
    cost. See dev-notes/tasks/av-media-cost-investigation/ for the
    investigation that surfaced this.
    """
    ddb = session.resource("dynamodb", region_name=region)
    table = ddb.Table(f"numa-{client_name}-chat-history")
    cutoff_ms = int(
        (datetime.now(timezone.utc) - timedelta(days=days)).timestamp() * 1000
    )
    schedule_lookup = schedule_lookup or {}
    s3_analytics = s3_analytics or {}

    # ── 1. Index DDB meta by (user_sub, conv_id) for join ────────────────
    items = _scan_all(
        table,
        FilterExpression="message_type = :m",
        ExpressionAttributeValues={":m": "meta"},
    )
    meta_by_key: dict[tuple[str, str], dict] = {}
    for it in items:
        conv_id = it.get("conversation_id") or it.get("sk", "").split("#")[0]
        user_sub = it.get("user_id")
        if conv_id and user_sub:
            meta_by_key[(user_sub, conv_id)] = it

    # ── 2. Build the conv list from the union of both sources ───────────
    all_keys = set(s3_analytics.keys()) | set(meta_by_key.keys())
    convs: list[dict] = []
    for key in all_keys:
        user_sub, conv_id = key
        a = s3_analytics.get(key, {})
        it = meta_by_key.get(key, {})
        has_s3 = key in s3_analytics
        has_ddb = it.get("analytics_total_cost_usd") is not None

        # No usable data anywhere — skip. (Defensive: shouldn't happen
        # since we built the key set from these two sources.)
        if not has_s3 and not has_ddb:
            continue

        def _pick(field, default=None, _a=a, _it=it):
            if field in _a and _a[field] is not None:
                return _a[field]
            return _it.get(f"analytics_{field}", default)

        # last_activity_ms: prefer DDB.latestTimestamp (the workspace agent
        # writes it on every turn); fall back to parsing s3.last_request_at.
        last_ts = it.get("latestTimestamp")
        if isinstance(last_ts, (int, Decimal)):
            last_activity_ms = int(last_ts)
        elif last_ts:
            last_activity_ms = int(last_ts)
        else:
            last_activity_ms = _iso_to_ms(a.get("last_request_at"))

        # agent_id: prefer DDB; for schedule-* convs without DDB metadata,
        # derive from the schedule lookup we built upstream.
        agent_id = it.get("agentId")
        if not agent_id and conv_id and conv_id.startswith("schedule-"):
            for sched_id, agent in schedule_lookup.items():
                if conv_id.startswith(f"schedule-{sched_id}"):
                    agent_id = agent
                    break
        is_agent_conv = bool(it.get("isAgentConversation", False)) or bool(agent_id)

        tool_counts_src = (
            a.get("tool_use_counts")
            if has_s3
            else (it.get("analytics_tool_use_counts") or {})
        )
        # NOTE: conversation title (it["conversationName"]) is intentionally
        # NOT included — it can contain sensitive client content and is never
        # rendered in the dashboard now (rows are identified by started_at).
        convs.append(
            {
                "user_id": user_sub,
                "conversation_id": conv_id,
                "model": _pick("model"),
                "is_scheduled": bool(conv_id.startswith("schedule-")),
                "agent_id": agent_id,
                "agent_title": it.get("agentTitle"),
                "is_agent_conversation": is_agent_conv,
                # total_cost_usd is the RECOMPUTED cost (1h-cache-priced +
                # cross-region markup). sdk_cost_usd is what the SDK itself
                # reported — sidecar for cross-check / regression detection.
                # DDB-only convs (no S3 trace) carry SDK cost in both slots
                # because we have no token breakdown to reprice from.
                "total_cost_usd": float(_pick("total_cost_usd", default=0) or 0),
                "sdk_cost_usd": float(
                    a.get("sdk_cost_usd", _pick("total_cost_usd", default=0)) or 0
                ),
                "total_turns": int(_pick("total_turns", default=0) or 0),
                "request_count": int(_pick("request_count", default=0) or 0),
                "user_messages": int(_pick("user_messages", default=0) or 0),
                "error_count": int(_pick("error_count", default=0) or 0),
                "input_tokens": int(_pick("input_tokens", default=0) or 0),
                "output_tokens": int(_pick("output_tokens", default=0) or 0),
                "cache_read_tokens": int(_pick("cache_read_tokens", default=0) or 0),
                "cache_creation_tokens": int(
                    _pick("cache_creation_tokens", default=0) or 0
                ),
                "duration_ms_total": int(_pick("duration_ms_total", default=0) or 0),
                "tool_call_count": int(_pick("tool_call_count", default=0) or 0),
                "tool_use_counts": {
                    k: int(v) for k, v in (tool_counts_src or {}).items()
                },
                "first_request_at": _pick("first_request_at"),
                "last_request_at": _pick("last_request_at"),
                "last_activity_ms": last_activity_ms,
                # Per-day buckets from the trace walk (empty when S3 didn't
                # have a trace — fine, _summarise just merges what's there).
                "daily_cost": a.get("daily_cost") or {},
                "daily_turns": a.get("daily_turns") or {},
                "daily_messages": a.get("daily_messages") or {},
                "daily_tool_calls": a.get("daily_tool_calls") or {},
                "daily_request_count": a.get("daily_request_count") or {},
                "active_days": a.get("active_days") or [],
            }
        )

    in_window = [c for c in convs if c["last_activity_ms"] >= cutoff_ms]
    return _summarise(in_window, days, len(convs))


def _conv_span_seconds(c: dict) -> Optional[float]:
    """Duration of one conversation in seconds from first→last request_at, or None."""
    f, last = c.get("first_request_at"), c.get("last_request_at")
    if not f or not last:
        return None
    try:
        fd = datetime.fromisoformat(f.replace("Z", "+00:00"))
        ld = datetime.fromisoformat(last.replace("Z", "+00:00"))
        return max(0.0, (ld - fd).total_seconds())
    except (ValueError, TypeError):
        return None


# Cap on the number of conversations we keep individually. Everything else is
# rolled up into daily buckets. 50 covers every realistic "Top conversations"
# table view without ballooning the snapshot for big stacks.
TOP_CONVERSATIONS_KEEP = 50


def _summarise(in_window: list[dict], days: int, all_time_count: int) -> dict:
    """Roll the per-conversation list into the chat block.

    Emits daily buckets + per-user + per-agent + top-N detail. Drops the full
    conversation array (huge for active stacks, and conversation titles can
    contain sensitive client content). The frontend filters daily buckets by
    time window to produce window-scoped KPIs.
    """
    by_user: dict[str, dict] = defaultdict(
        lambda: {
            "cost": 0.0,
            "convs": 0,
            "requests": 0,
            "turns": 0,
            "user_messages": 0,
            "tool_calls": 0,
            "_span_sum_sec": 0.0,
            "_span_count": 0,
            "first_at": None,
            "last_at": None,
        }
    )
    by_agent: dict[str, dict] = defaultdict(
        lambda: {
            "agent_title": None,
            "scheduled_count": 0,
            "adhoc_count": 0,
            "cost": 0.0,
            "scheduled_cost": 0.0,
            "adhoc_cost": 0.0,
            "turns": 0,
            "user_messages": 0,
            "tool_calls": 0,
            "first_at": None,
            "last_at": None,
        }
    )

    # ── 3-way conversation categories ───────────────────────────────────
    # agent_run  = scheduled or event-triggered agent invocation
    #              (conversation_id starts with 'schedule-')
    # agent_chat = user chatting with an agent (has agent_id, not a run)
    # plain_chat = user chatting without an agent
    #
    # Both cron-scheduled and event-triggered runs share the 'schedule-'
    # prefix (see agent-schedule-runner buildRunConversationId). Splitting
    # those two further would require joining against the schedule table
    # for each conv's trigger_type — punted for now.
    by_category: dict[str, dict] = defaultdict(
        lambda: {
            "convs": 0,
            "cost": 0.0,
            "user_messages": 0,
            "turns": 0,
            "tool_calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
        }
    )

    # ── Per-day per-user / per-agent cost (window-aware drill-downs) ────
    # Enables "All users" and "Per-agent contribution" tables to respect
    # the dashboard's window picker. Storage growth: ~44 users × 90 days ×
    # ~30 bytes = ~120 KB for an active stack. Bounded by N_users × days.
    daily_cost_by_user: dict[str, dict[str, float]] = defaultdict(
        lambda: defaultdict(float)
    )
    daily_messages_by_user: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    daily_cost_by_agent: dict[str, dict[str, float]] = defaultdict(
        lambda: defaultdict(float)
    )
    # Scheduled vs ad-hoc cost per agent per day — lets the Cost &
    # Efficiency tab's per-agent table window-filter both columns.
    daily_scheduled_cost_by_agent: dict[str, dict[str, float]] = defaultdict(
        lambda: defaultdict(float)
    )
    daily_adhoc_cost_by_agent: dict[str, dict[str, float]] = defaultdict(
        lambda: defaultdict(float)
    )

    # ── Per-day per-category buckets ────────────────────────────────────
    # Powers the window-aware "Cost by category" table. Keyed by
    # category name (agent_run / agent_chat / plain_chat).
    daily_cost_by_category: dict[str, dict[str, float]] = defaultdict(
        lambda: defaultdict(float)
    )
    daily_messages_by_category: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    daily_convs_by_category: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    daily_turns_by_category: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    daily_tool_calls_by_category: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )

    # Per-day buckets are MERGED from each conv's per-event daily dicts
    # (built in compute_trace_analytics). A multi-day chat contributes to
    # every day it had activity, not just its last_request_at day — so the
    # dashboard's window slicing actually reflects when spend happened.
    daily_cost: dict[str, float] = defaultdict(float)
    daily_messages: dict[str, int] = defaultdict(int)
    daily_convs: dict[str, int] = defaultdict(int)
    daily_turns: dict[str, int] = defaultdict(int)
    daily_tool_calls: dict[str, int] = defaultdict(int)
    daily_users: dict[str, set] = defaultdict(set)
    daily_scheduled_count: dict[str, int] = defaultdict(int)
    daily_adhoc_count: dict[str, int] = defaultdict(int)

    tool_totals: Counter = Counter()
    model_totals: dict[str, dict] = defaultdict(lambda: {"cost": 0.0, "convs": 0})

    for c in in_window:
        u = c["user_id"] or "unknown"
        bu = by_user[u]
        bu["cost"] += c["total_cost_usd"]
        bu["convs"] += 1
        bu["turns"] += c["total_turns"]
        bu["requests"] += c["request_count"]
        bu["user_messages"] += c["user_messages"]
        bu["tool_calls"] += c["tool_call_count"]
        span = _conv_span_seconds(c)
        if span is not None:
            bu["_span_sum_sec"] += span
            bu["_span_count"] += 1
        fr, lr = c.get("first_request_at"), c.get("last_request_at")
        if fr and (bu["first_at"] is None or fr < bu["first_at"]):
            bu["first_at"] = fr
        if lr and (bu["last_at"] is None or lr > bu["last_at"]):
            bu["last_at"] = lr

        aid = c.get("agent_id")
        if aid:
            ba = by_agent[aid]
            if not ba["agent_title"]:
                ba["agent_title"] = c.get("agent_title")
            if c["is_scheduled"]:
                ba["scheduled_count"] += 1
                ba["scheduled_cost"] += c["total_cost_usd"]
            else:
                ba["adhoc_count"] += 1
                ba["adhoc_cost"] += c["total_cost_usd"]
            ba["cost"] += c["total_cost_usd"]
            ba["turns"] += c["total_turns"]
            ba["user_messages"] += c["user_messages"]
            ba["tool_calls"] += c["tool_call_count"]
            if fr and (ba["first_at"] is None or fr < ba["first_at"]):
                ba["first_at"] = fr
            if lr and (ba["last_at"] is None or lr > ba["last_at"]):
                ba["last_at"] = lr

        # 3-way category classification
        if c["is_scheduled"]:
            category = "agent_run"
        elif aid:
            category = "agent_chat"
        else:
            category = "plain_chat"
        bc = by_category[category]
        bc["convs"] += 1
        bc["cost"] += c["total_cost_usd"]
        bc["user_messages"] += c["user_messages"]
        bc["turns"] += c["total_turns"]
        bc["tool_calls"] += c["tool_call_count"]
        bc["input_tokens"] += c["input_tokens"]
        bc["output_tokens"] += c["output_tokens"]

        for name, n in (c.get("tool_use_counts") or {}).items():
            tool_totals[name] += n
        if c.get("model"):
            model_totals[c["model"]]["cost"] += c["total_cost_usd"]
            model_totals[c["model"]]["convs"] += 1

        # ── Per-day buckets ─────────────────────────────────────────────
        # Use the trace's per-event dicts. Fall back to last_request_at
        # only if no daily data is available (DDB-only conv, no S3 trace).
        per_day_cost = c.get("daily_cost") or {}
        per_day_msgs = c.get("daily_messages") or {}
        per_day_turns = c.get("daily_turns") or {}
        per_day_tools = c.get("daily_tool_calls") or {}
        active_days = c.get("active_days") or []

        if per_day_cost or per_day_msgs or active_days:
            for d, v in per_day_cost.items():
                daily_cost[d] += v
                daily_cost_by_user[u][d] += v
                daily_cost_by_category[category][d] += v
                if aid:
                    daily_cost_by_agent[aid][d] += v
                    if c["is_scheduled"]:
                        daily_scheduled_cost_by_agent[aid][d] += v
                    else:
                        daily_adhoc_cost_by_agent[aid][d] += v
            for d, v in per_day_msgs.items():
                daily_messages[d] += v
                daily_messages_by_user[u][d] += v
                daily_messages_by_category[category][d] += v
            for d, v in per_day_turns.items():
                daily_turns[d] += v
                daily_turns_by_category[category][d] += v
            for d, v in per_day_tools.items():
                daily_tool_calls[d] += v
                daily_tool_calls_by_category[category][d] += v
            for d in active_days:
                daily_convs[d] += 1
                daily_convs_by_category[category][d] += 1
                daily_users[d].add(u)
                if c["is_scheduled"]:
                    daily_scheduled_count[d] += 1
                else:
                    daily_adhoc_count[d] += 1
        else:
            # Fallback for DDB-only convs (no S3 trace was parsed). Dump
            # the conv's totals into its last_request_at day.
            day = (c.get("last_request_at") or "")[:10]
            if day:
                daily_cost[day] += c["total_cost_usd"]
                daily_cost_by_user[u][day] += c["total_cost_usd"]
                daily_cost_by_category[category][day] += c["total_cost_usd"]
                if aid:
                    daily_cost_by_agent[aid][day] += c["total_cost_usd"]
                    if c["is_scheduled"]:
                        daily_scheduled_cost_by_agent[aid][day] += c["total_cost_usd"]
                    else:
                        daily_adhoc_cost_by_agent[aid][day] += c["total_cost_usd"]
                daily_messages[day] += c["user_messages"]
                daily_messages_by_user[u][day] += c["user_messages"]
                daily_messages_by_category[category][day] += c["user_messages"]
                daily_convs[day] += 1
                daily_convs_by_category[category][day] += 1
                daily_turns[day] += c["total_turns"]
                daily_turns_by_category[category][day] += c["total_turns"]
                daily_tool_calls[day] += c["tool_call_count"]
                daily_tool_calls_by_category[category][day] += c["tool_call_count"]
                daily_users[day].add(u)
                if c["is_scheduled"]:
                    daily_scheduled_count[day] += 1
                else:
                    daily_adhoc_count[day] += 1

    # Finalize by_user: collapse running span sum into avg
    by_user_out: dict[str, dict] = {}
    for u, m in by_user.items():
        span_count = m.pop("_span_count")
        span_sum = m.pop("_span_sum_sec")
        m["avg_span_seconds"] = (span_sum / span_count) if span_count else None
        by_user_out[u] = m

    by_agent_out = sorted(
        [{"agent_id": aid, **m} for aid, m in by_agent.items()],
        key=lambda r: -r["cost"],
    )

    # Top-N conversations by cost. Privacy-stripped: no `title` — the row is
    # identified by `started_at` + `agent_title` + IDs only.
    top = sorted(in_window, key=lambda c: -c["total_cost_usd"])[:TOP_CONVERSATIONS_KEEP]
    top_conversations = [
        {
            "conversation_id": c["conversation_id"],
            "user_id": c["user_id"],
            "agent_id": c.get("agent_id"),
            "agent_title": c.get("agent_title"),
            "model": c.get("model"),
            "is_scheduled": c["is_scheduled"],
            "is_agent_conversation": c.get("is_agent_conversation", False),
            "started_at": c.get("first_request_at"),
            "last_request_at": c.get("last_request_at"),
            "span_seconds": _conv_span_seconds(c),
            "total_cost_usd": c["total_cost_usd"],
            "total_turns": c["total_turns"],
            "user_messages": c["user_messages"],
            "tool_call_count": c["tool_call_count"],
            "request_count": c["request_count"],
            "input_tokens": c["input_tokens"],
            "output_tokens": c["output_tokens"],
        }
        for c in top
    ]

    scheduled = [c for c in in_window if c["is_scheduled"]]
    adhoc = [c for c in in_window if not c["is_scheduled"]]

    def agg(rows):
        return {
            "count": len(rows),
            "cost": sum(r["total_cost_usd"] for r in rows),
            "turns": sum(r["total_turns"] for r in rows),
            "requests": sum(r["request_count"] for r in rows),
            "user_messages": sum(r["user_messages"] for r in rows),
        }

    return {
        "window_days": days,
        "all_time_count": all_time_count,
        "top_conversations": top_conversations,
        "top_conversations_kept": len(top_conversations),
        "top_conversations_dropped": max(0, len(in_window) - len(top_conversations)),
        "totals": {
            # cost = the canonical figure (recomputed from token counts with
            # cross-region markup). sdk_cost = what the SDK itself reported,
            # kept for cross-check and regression detection. Expect
            # cost / sdk_cost ≈ 1.2x for Sonnet-heavy stacks with 1h caching.
            "cost": sum(c["total_cost_usd"] for c in in_window),
            "sdk_cost": sum(c.get("sdk_cost_usd", 0) for c in in_window),
            "convs": len(in_window),
            "turns": sum(c["total_turns"] for c in in_window),
            "requests": sum(c["request_count"] for c in in_window),
            "user_messages": sum(c["user_messages"] for c in in_window),
            "errors": sum(c["error_count"] for c in in_window),
            "users": len(by_user_out),
            "tool_calls": sum(tool_totals.values()),
            "input_tokens": sum(c["input_tokens"] for c in in_window),
            "output_tokens": sum(c["output_tokens"] for c in in_window),
            "cache_read_tokens": sum(c["cache_read_tokens"] for c in in_window),
            "cache_creation_tokens": sum(c["cache_creation_tokens"] for c in in_window),
        },
        "by_user": by_user_out,
        "by_agent": by_agent_out,
        "daily_cost": dict(daily_cost),
        "daily_messages": dict(daily_messages),
        "daily_convs": dict(daily_convs),
        "daily_turns": dict(daily_turns),
        "daily_tool_calls": dict(daily_tool_calls),
        "daily_active_users": {d: len(u) for d, u in daily_users.items()},
        "daily_scheduled_count": dict(daily_scheduled_count),
        "daily_adhoc_count": dict(daily_adhoc_count),
        "tool_totals": dict(tool_totals.most_common()),
        "model_totals": {m: dict(v) for m, v in model_totals.items()},
        "scheduled_vs_adhoc": {"scheduled": agg(scheduled), "adhoc": agg(adhoc)},
        # 3-way category breakdown — drives the Cost & Efficiency tab's
        # cost-per-message split. Always emits all three keys even if empty.
        "by_category": {
            k: dict(
                by_category.get(
                    k,
                    {
                        "convs": 0,
                        "cost": 0.0,
                        "user_messages": 0,
                        "turns": 0,
                        "tool_calls": 0,
                        "input_tokens": 0,
                        "output_tokens": 0,
                    },
                )
            )
            for k in ("agent_run", "agent_chat", "plain_chat")
        },
        # Per-day per-user / per-agent buckets — enables window-aware
        # drill-down tables (Chat>All Users, Impact>Per-agent contribution).
        "daily_cost_by_user": {u: dict(d) for u, d in daily_cost_by_user.items()},
        "daily_messages_by_user": {
            u: dict(d) for u, d in daily_messages_by_user.items()
        },
        "daily_cost_by_agent": {a: dict(d) for a, d in daily_cost_by_agent.items()},
        "daily_scheduled_cost_by_agent": {
            a: dict(d) for a, d in daily_scheduled_cost_by_agent.items()
        },
        "daily_adhoc_cost_by_agent": {
            a: dict(d) for a, d in daily_adhoc_cost_by_agent.items()
        },
        # Per-day per-category buckets — Cost & Efficiency tab's "Cost by
        # category" table window-filters from these. Same key set as
        # by_category (agent_run / agent_chat / plain_chat).
        "daily_cost_by_category": {
            k: dict(d) for k, d in daily_cost_by_category.items()
        },
        "daily_messages_by_category": {
            k: dict(d) for k, d in daily_messages_by_category.items()
        },
        "daily_convs_by_category": {
            k: dict(d) for k, d in daily_convs_by_category.items()
        },
        "daily_turns_by_category": {
            k: dict(d) for k, d in daily_turns_by_category.items()
        },
        "daily_tool_calls_by_category": {
            k: dict(d) for k, d in daily_tool_calls_by_category.items()
        },
    }
