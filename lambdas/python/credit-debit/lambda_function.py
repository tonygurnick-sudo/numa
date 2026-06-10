"""
credit-debit — live credit metering for the Numa Credit System (SPK-015).

Invoked ASYNCHRONOUSLY (fire-and-forget) by the workspace agent after each chat turn with
``{conversation_id, user_sub}``. It reads that conversation's trace from S3, recomputes cost,
classifies the tier + titles it (once — reused on later turns to bound Nova calls), and writes the
conversation's ledger rows. The admin panel's "remaining" derives from these rows, so the balance
ticks down as work is metered live (the real-time counterpart to the backfill).

Idempotent: re-processing a conversation overwrites its rows (PUT by key) — never double-counts.
All billing logic is shared with the backfill via lib/credit-pricing (processing/pricing/credits/
tiers/ledger), so live and historical metering agree by construction.

All monetary values are USD (no FX conversion).
Env: CREDITS_TABLE_NAME, OUTPUTS_BUCKET_NAME, AWS_REGION; optional tuning CREDIT_MARGIN,
CREDIT_UNIT_USD, CREDIT_CACHE_TTL.
"""

from __future__ import annotations

import json
import os
from decimal import Decimal
from typing import Any, Iterator

import structlog
from boto3.dynamodb.conditions import Key

from credit_pricing import processing
from credit_pricing.credits import (
    AGENTCORE_MULT,
    CREDIT_USD,
    DEFAULT_MONTHLY_ALLOCATION,
    MARGIN_TARGET,
    TRIVIAL_CONSUMPTION_USD,
)
from credit_pricing.ledger import month_aggregate_item
from credit_pricing.tiers import VALID_TIERS, classify, max_tier
from credit_pricing.timeutil import billing_month_of
from prm import client as prm_client
from prm import resource as prm_resource

# Bind domain="credits" on every line so all credit logs (debit + nightly + the workspace-agent
# meter emit) share one exact-match filter key, on top of the per-event `_name` (CREDIT_DEBIT_*).
# CloudWatch: `filter domain = "credits"`.
logger = structlog.get_logger().bind(domain="credits")

REGION = os.environ.get("AWS_REGION", "us-east-1")
TABLE_NAME = os.environ.get("CREDITS_TABLE_NAME", "")
OUTPUTS_BUCKET = os.environ.get("OUTPUTS_BUCKET_NAME", "")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "")
CHAT_HISTORY_TABLE = os.environ.get("CHAT_HISTORY_TABLE_NAME", "")
MARGIN = float(os.environ.get("CREDIT_MARGIN", str(MARGIN_TARGET)))
CREDIT_UNIT = float(os.environ.get("CREDIT_UNIT_USD", str(CREDIT_USD)))
AGENTCORE_MULT_ENV = float(os.environ.get("CREDIT_AGENTCORE_MULT", str(AGENTCORE_MULT)))
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


def _classify_window(user_texts: list[str]) -> list[str]:
    """Bounded window for ratcheting classification: opening intent + most-recent turns.

    Keeps Nova's input small regardless of conversation length — a 1M-token conversation still
    classifies on a handful of messages. Earlier hard segments are already captured in the stored
    tier via the ratchet, so dropping mid-history here is safe.
    """
    if len(user_texts) <= 8:
        return list(user_texts)
    return user_texts[:1] + user_texts[-7:]  # original intent + recent activity


def _actions_summary(turns: list) -> str:
    """Trusted telemetry of work done so far (turn count, token volume, models) — gives the
    classifier an effort signal the user's words alone miss (a one-line ask that did heavy work).
    """
    if not turns:
        return ""
    total = sum(
        t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_creation_tokens
        for t in turns
    )
    generated = sum(t.output_tokens for t in turns)
    models = sorted({t.model.split(".")[-1] for t in turns if t.model})
    return (
        f"{len(turns)} model turns; ~{total:,} tokens total ({generated:,} generated); "
        f"models: {', '.join(models) or 'unknown'}"
    )


def _scheduled_agent_id(user_sub: str, conversation_id: str) -> str:
    """Recover the agentId for a scheduled run from its chat-history rows.

    Scheduled runs are detected by the ``schedule-`` conversation-id prefix, but the metering event
    can arrive without an ``agent_id`` (the schedule runner's emit may omit it). The conversation's
    chat-history messages carry ``agentId``, so we grab it here — otherwise the run shows in the
    dashboard's 'scheduled' consumption slice but can't be attributed to its agent in Top-5-agents.
    Best-effort: any failure returns "" and metering proceeds (the run just stays unattributed).
    """
    if not CHAT_HISTORY_TABLE:
        return ""
    try:
        resp = (
            prm_resource("dynamodb", region=REGION)
            .Table(CHAT_HISTORY_TABLE)
            .query(
                KeyConditionExpression=Key("user_id").eq(user_sub)
                & Key("sk").begins_with(conversation_id),
                ProjectionExpression="agentId",
                Limit=5,
            )
        )
        for item in resp.get("Items", []):
            aid = item.get("agentId")
            if aid:
                return str(aid)
    except (
        Exception
    ) as exc:  # noqa: BLE001 — attribution is best-effort, never break metering
        logger.warning(
            "scheduled agentId lookup failed",
            _name="CREDIT_DEBIT_AGENT_LOOKUP",
            phase="classify",
            conversation_id=conversation_id,
            error=str(exc),
        )
    return ""


def handler(event: dict, context: Any) -> dict:
    conversation_id = str((event or {}).get("conversation_id") or "")
    user_sub = str((event or {}).get("user_sub") or "")
    if not conversation_id or not user_sub:
        logger.warning(
            "missing ids",
            _name="CREDIT_DEBIT_SKIP",
            phase="request",
            conversation_id=conversation_id,
            user_sub=user_sub,
        )
        return {"status": "skipped", "reason": "missing conversation_id/user_sub"}
    if not TABLE_NAME or not OUTPUTS_BUCKET:
        logger.error("not configured", _name="CREDIT_DEBIT_CONFIG", phase="init")
        return {"status": "error", "reason": "not configured"}

    # 1. Read the conversation trace from S3 (synced by the agent after the turn).
    s3 = prm_client("s3", region=REGION)
    key = f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/_system/trace.jsonl"
    try:
        obj = s3.get_object(Bucket=OUTPUTS_BUCKET, Key=key)
        body = obj["Body"].read().decode("utf-8", "replace")
        s3_last_ts = obj["LastModified"].isoformat()
    except Exception as exc:  # noqa: BLE001 — missing/late trace is benign, just skip
        logger.warning(
            "trace not found",
            _name="CREDIT_DEBIT_NO_TRACE",
            phase="request",
            conversation_id=conversation_id,
            error=str(exc),
        )
        return {"status": "skipped", "reason": "trace not found"}

    events = list(_iter_trace(body))
    turns, user_texts, trace_first_ts, trace_last_ts = processing.process_trace_events(
        events, cache_ttl=CACHE_TTL
    )
    if not turns:
        return {"status": "skipped", "reason": "no billable turns"}
    # Prefer the trace's own event timestamps (real first->last span) over the S3 sync time.
    first_ts = trace_first_ts
    last_ts = trace_last_ts or s3_last_ts

    table = prm_resource("dynamodb", region=REGION).Table(TABLE_NAME)

    # Runtime pricing config (Credit Admin panel; PK=CLIENT#/SK=CONFIG). Missing keys -> env/lib
    # defaults. Forward-only: knob changes affect conversations metered AFTER the change; the rows
    # already written keep their snapshotted values (history is never repriced).
    cfg = (
        table.get_item(Key={"PK": f"CLIENT#{CLIENT_NAME}", "SK": "CONFIG"}).get("Item")
        or {}
    )
    eff_credit = (
        float(cfg["creditUsd"]) if cfg.get("creditUsd") is not None else CREDIT_UNIT
    )
    eff_margin = float(cfg["margin"]) if cfg.get("margin") is not None else MARGIN
    eff_trivial = (
        float(cfg["trivialConsumptionUsd"])
        if cfg.get("trivialConsumptionUsd") is not None
        else TRIVIAL_CONSUMPTION_USD
    )
    eff_tiers = None
    if isinstance(cfg.get("valueTiers"), dict):
        # float, NOT int — tiers are priced in half-credit steps (e.g. agent low = 0.5);
        # int() would silently truncate a configured 0.5 to 0.
        eff_tiers = {
            ctx: {k: float(v) for k, v in d.items()}
            for ctx, d in cfg["valueTiers"].items()
            if isinstance(d, dict)
        }
    # Per-tier cost-recovery margin: base every tier at the scalar margin, then apply overrides.
    eff_margins = {tier: eff_margin for tier in ("low", "medium", "high", "very_high")}
    if isinstance(cfg.get("marginsByTier"), dict):
        eff_margins.update({k: float(v) for k, v in cfg["marginsByTier"].items()})
    eff_agentcore = (
        float(cfg["agentcoreMult"])
        if cfg.get("agentcoreMult") is not None
        else AGENTCORE_MULT_ENV
    )
    # Monthly allocation (12 calendar months). Snapshotted onto the MONTH row each turn so a closed
    # month's overflow is settled against the allocation that actually applied (immune to later edits).
    # No explicit config -> the new-client default plan (DEFAULT_MONTHLY_ALLOCATION/mo), so a fresh
    # client meters against a real allowance rather than 0. Portal-set allocations override this.
    raw_alloc = cfg.get("monthlyAllocations")
    eff_allocations = (
        [float(x) for x in raw_alloc]
        if isinstance(raw_alloc, list) and len(raw_alloc) == 12
        else [float(DEFAULT_MONTHLY_ALLOCATION)] * 12
    )

    # 2. Reuse an already-set title/tier (bounds Nova to ~once per conversation).
    existing = (
        table.get_item(Key={"PK": f"CONV#{conversation_id}", "SK": "META"}).get("Item")
        or {}
    )
    # Pricing context: ANY agent conversation prices on the agent value tier — both ad-hoc agent
    # chats (agent_id passed by the workspace agent) and scheduled runs (conversation_id "schedule-").
    # Plain chat -> chat tier. source is the 3-way split for the admin dashboard.
    agent_id = str((event or {}).get("agent_id") or "")
    is_scheduled = conversation_id.startswith("schedule-")
    is_agent_conv = is_scheduled or bool(agent_id)
    context_kind = "agent" if is_agent_conv else "chat"
    source = "scheduled" if is_scheduled else ("agent" if agent_id else "chat")
    # A scheduled run is detected by its id prefix, but the emit may not carry the agent_id. Recover
    # it from chat-history so the run attributes to its agent (Top-5-agents groups by agentId).
    # source/context above are already correct for scheduled runs; this only fills the agentId.
    if is_scheduled and not agent_id:
        agent_id = _scheduled_agent_id(user_sub, conversation_id)

    # Title + deliverables are produced by the nightly summariser (anonymised, admin-safe), NOT live
    # — so the admin view never shows non-anonymised content, and live metering does one fewer Nova
    # call. Preserve any title the nightly already wrote; otherwise leave it empty (UI shows a
    # "anonymised summary coming overnight" placeholder).
    title = existing.get("title") or ""
    prior_tier = existing.get("dominantTier")
    prior_tier = prior_tier if prior_tier in VALID_TIERS else None  # ratchet floor

    bedrock = prm_client("bedrock-runtime", region=REGION)

    # Ratcheting substantive-window complexity (replaces the old lock-on-first-turn). Each metering
    # pass re-classifies a BOUNDED window — opening intent + recent turns + an actions/volume
    # summary — and keeps the MAX tier ever seen: complexity rises as the conversation does real
    # work but never falls when it later drifts to chit-chat. Nova is skipped once the ceiling
    # (very_high) is reached. The trivial-cost cap in build_conversation_rows still pins near-zero
    # conversations to 'low', so word volume alone can't inflate the tier.
    value_tier = prior_tier
    nova_tier = None
    window = _classify_window(user_texts)
    actions_summary = _actions_summary(turns)
    # VALUE signal: the distinct tools/integrations touched so far. A terse ask that pulled from many
    # integrations (e.g. "generate this week's sales report" hitting 5 sources) is high-VALUE even
    # though the words are thin — surface that so the classifier tiers it correctly (the proven
    # backfill signal, now live). Effort still rides in actions_summary; this is value, not volume.
    value_signal = processing.tools_value_signal(processing.extract_tools(events))
    if prior_tier != "very_high":
        cls = classify(
            window,
            context=context_kind,
            actions=actions_summary,
            value_signal=value_signal,
            bedrock=bedrock,
            region=REGION,
        )
        nova_tier = cls["tier"]
        value_tier = max_tier(prior_tier, nova_tier)

    # Observability for the (ratcheted) classification. Only the running MAX survives on the META row
    # as dominantTier, so each turn's individual Nova verdict is otherwise lost — making it impossible
    # to see WHY a conversation landed on a tier (e.g. a terse ask that did heavy multi-integration
    # work still scoring 'low'; see the B1 value-signal item). Logs what Nova was shown (window size +
    # the trusted actions/volume summary — never raw user text, for privacy) and what it returned, vs
    # the prior ratchet floor and the final tier. Pure visibility — no effect on pricing. nova_tier is
    # None when the ratchet was already at the ceiling and Nova was skipped.
    logger.info(
        "classified conversation",
        _name="CREDIT_DEBIT_CLASSIFY",
        phase="classify",
        conversation_id=conversation_id,
        context=context_kind,
        window_msgs=len(window),
        actions=actions_summary,
        value_signal=value_signal,
        nova_tier=nova_tier,
        prior_tier=prior_tier,
        final_tier=value_tier,
    )

    # 3. Assemble the ledger rows (shared engine; deterministic SKs -> idempotent overwrite).
    # Bucket on the NZ billing calendar (Pacific/Auckland) — one calendar for all clients, so a
    # conversation just after NZ-midnight on the 1st counts in the new month (not the prior UTC one).
    month = billing_month_of(last_ts)
    meta, msg_rows = processing.build_conversation_rows(
        conversation_id=conversation_id,
        user_sub=user_sub,
        month=month,
        first_ts=first_ts,
        last_ts=last_ts,
        turns=turns,
        title=title,
        margin=eff_margin,
        credit_usd=eff_credit,
        value_tier=value_tier,
        context=context_kind,
        source=source,
        agent_id=agent_id or None,
        bedrock_region=REGION,
        value_tier_credits=eff_tiers,
        trivial_consumption_usd=eff_trivial,
        margins=eff_margins,
        agentcore_mult=eff_agentcore,
    )
    conv_key = f"CONV#{conversation_id}"

    # Delete MSG rows no longer present in this trace (a shortened/edited conversation re-metered:
    # batch PUT alone would leave orphaned higher-index MSG rows so #MSG != msgCount). Idempotent —
    # an unchanged trace produces a keep-set covering all existing rows, so nothing is deleted.
    keep_sks = {"META"} | {row["SK"] for row in msg_rows}
    existing_rows = table.query(
        KeyConditionExpression=Key("PK").eq(conv_key), ProjectionExpression="SK"
    )
    stale_sks = [
        r["SK"] for r in existing_rows.get("Items", []) if r["SK"] not in keep_sks
    ]

    with table.batch_writer() as bw:
        for sk in stale_sks:
            bw.delete_item(Key={"PK": conv_key, "SK": sk})
        bw.put_item(Item=_to_dynamo(meta))
        for row in msg_rows:
            bw.put_item(Item=_to_dynamo(row))

    # 4. Maintain the per-client monthly reconciliation row (CLIENT#/MONTH#). Recompute from this
    #    month's META rows via GSI2 and overwrite — idempotent + concurrency-tolerant. The current
    #    conversation is overridden with in-hand values (GSI2 is eventually consistent, so the
    #    just-written META may not be visible yet). Best-effort: never break metering. Cost is
    #    O(convs this month) per turn — fine at current volume; move to a scheduled month-close job
    #    if a tenant's monthly conversation count grows large.
    if CLIENT_NAME:
        try:
            contrib: dict[str, tuple[float, float]] = {}
            resp = table.query(
                IndexName="GSI2",
                KeyConditionExpression=Key("GSI2PK").eq(f"MONTH#{month}"),
            )
            page = resp.get("Items", [])
            while resp.get("LastEvaluatedKey"):
                resp = table.query(
                    IndexName="GSI2",
                    KeyConditionExpression=Key("GSI2PK").eq(f"MONTH#{month}"),
                    ExclusiveStartKey=resp["LastEvaluatedKey"],
                )
                page += resp.get("Items", [])
            for it in page:
                contrib[str(it["PK"])] = (
                    float(it.get("creditsCharged") or 0),
                    float(it.get("consumptionCostUsd") or 0),
                )
            contrib[conv_key] = (
                float(meta["creditsCharged"]),
                float(meta.get("consumptionCostUsd") or 0),
            )
            total_credits = sum(c for c, _ in contrib.values())
            total_cons = sum(k for _, k in contrib.values())
            month_idx = int(month[5:7]) - 1  # 0=Jan
            alloc_snapshot = (
                eff_allocations[month_idx]
                if eff_allocations is not None and 0 <= month_idx < 12
                else None
            )
            agg = month_aggregate_item(
                client=CLIENT_NAME,
                month=month,
                credit_revenue_usd=round(total_credits * eff_credit, 6),
                consumption_cost_usd=round(total_cons, 6),
                credits_charged=round(total_credits, 4),
                allocation_snapshot=alloc_snapshot,
            )
            table.put_item(Item=_to_dynamo(agg))
        except (
            Exception
        ) as exc:  # noqa: BLE001 — reconciliation must never break metering
            logger.warning(
                "month aggregate update failed",
                _name="CREDIT_DEBIT_MONTHAGG",
                phase="cleanup",
                month=month,
                error=str(exc),
            )

    logger.info(
        "metered conversation",
        _name="CREDIT_DEBIT_OK",
        phase="cleanup",
        conversation_id=conversation_id,
        user_sub=user_sub,
        credits_charged=meta["creditsCharged"],
        msg_count=meta["msgCount"],
        tier=value_tier,
    )
    return {
        "status": "ok",
        "creditsCharged": meta["creditsCharged"],
        "msgCount": meta["msgCount"],
    }
