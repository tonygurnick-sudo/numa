"""Per-client gather pipeline.

Composes every data slice the Numa Dashboard needs into one snapshot:
- Cost Explorer (per service, daily)
- Chat conversation analytics (computed in-memory from S3 traces, merged with DDB meta items)
- Schedules (with cron-derived classification)
- Scheduled run history (from S3 numa-chat/scheduled-runs/)
- Agents (workspace + user)
- Knowledge bases / data connectors
- Pipedream live integration status (per user, via the per-client pipedream-relay lambda)
- Cognito user count + sub→email map

Every gather is called with a boto3 session that's already been assumed
into the target client account.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

import structlog

from .chat import (
    compute_analytics_from_s3,
    gather_chat_analytics,
)
from .client_config import attach_dashboard_config
from .cognito import gather_cognito
from .cost_explorer import gather_cost_explorer
from .integrations import gather_integrations
from .pipedream import gather_pipedream_connections
from .scheduled_runs import gather_scheduled_runs
from .schedules import gather_schedules

logger = structlog.get_logger()


def gather_client_snapshot(
    session,
    client_name: str,
    client_config: dict,
    window_days: int,
) -> dict:
    """Run every gather and return a single snapshot dict.

    This is the per-client unit the rollup Lambda writes to DynamoDB.
    """
    # Region comes from client_config (mirrored from numa-client-config) — most
    # clients are us-east-1 but AU/NZ stacks live in ap-southeast-2 and Nolia
    # in ap-southeast-3. All session.client(...)/session.resource(...) calls
    # below MUST pin to this, or DDB scans will hit the wrong region and
    # return ResourceNotFoundException.
    region = client_config.get("region") or "us-east-1"
    log = logger.bind(client_name=client_name, region=region)
    log.info("gather start", _name="GATHER_CLIENT_START")

    snapshot: dict[str, Any] = {
        "client": client_name,
        "window_days": window_days,
        "client_config": attach_dashboard_config(client_config),
    }

    # 1. Cost Explorer is a global service; only has a us-east-1 endpoint
    #    regardless of where the client account lives.
    log.info("gather: cost explorer")
    snapshot["cost_explorer"] = gather_cost_explorer(session, window_days)

    # 2. Schedules first so we have schedule_id -> agent_id mapping for chat
    log.info("gather: schedules")
    snapshot["schedules"] = gather_schedules(session, client_name, region)
    sched_lookup = snapshot["schedules"].get("schedule_to_agent") or {}

    # 3. In-memory analytics from S3 traces (no DDB writes)
    log.info("gather: in-memory chat analytics")
    s3_analytics = compute_analytics_from_s3(session, client_name, region)

    # 4. Merge S3 analytics + DDB meta scan
    log.info("gather: chat analytics merge")
    snapshot["chat"] = gather_chat_analytics(
        session=session,
        client_name=client_name,
        region=region,
        days=window_days,
        schedule_lookup=sched_lookup,
        s3_analytics=s3_analytics,
    )

    # 5. Scheduled runs from S3
    log.info("gather: scheduled runs")
    snapshot["scheduled_runs"] = gather_scheduled_runs(
        session, client_name, region, window_days
    )

    # 6. Agents, KBs, data connectors
    log.info("gather: agents + integrations")
    integrations = gather_integrations(session, client_name, region)
    snapshot["agents"] = integrations["agents"]
    snapshot["integrations"] = integrations["integrations"]

    # 7. Cognito users (provisioned count + sub→email map)
    log.info("gather: cognito users")
    snapshot["users"] = gather_cognito(session, client_name, region)

    # 8. Pipedream connections per user (live).
    #    Prefer Cognito's sub→email map; fall back to whoever appears in
    #    chat.by_user (per-user rollup keyed by user_id). The old shape used
    #    the conversations[] array — that's gone after the lean reshape.
    user_subs: list[str] = []
    cog = snapshot["users"] or {}
    if cog.get("sub_to_email"):
        user_subs = list(cog["sub_to_email"].keys())
    if not user_subs:
        user_subs = list((snapshot["chat"].get("by_user") or {}).keys())
    log.info("gather: pipedream", user_count=len(user_subs))
    snapshot["pipedream"] = gather_pipedream_connections(
        session, client_name, region, user_subs
    )

    # 9. Impact roll-up (time-saved math)
    snapshot["impact"] = _compute_impact(snapshot)

    log.info(
        "gather complete",
        _name="GATHER_CLIENT_DONE",
        chat_convs=snapshot["chat"]["totals"]["convs"],
        chat_cost=snapshot["chat"]["totals"]["cost"],
        scheduled_runs=snapshot["scheduled_runs"]["totals"]["count"],
        pipedream_apps=snapshot["pipedream"].get("distinct_active_apps", 0),
    )
    return snapshot


def _compute_impact(snapshot: dict) -> dict:
    """Derive time-saved totals from agents × schedule run counts."""
    agent_map: dict[str, dict] = {}
    for kind in ["agents", "user_agents"]:
        for a in (snapshot["agents"].get(kind) or {}).get("rows", []) or []:
            if a.get("agent_id"):
                agent_map[a["agent_id"]] = a

    total_time_saved_minutes = 0
    per_agent_runs: dict[str, int] = defaultdict(int)
    for s in snapshot["schedules"].get("rows", []) or []:
        runs = s.get("total_runs", 0)
        aid = s.get("agent_id")
        if aid and aid in agent_map:
            per_agent_runs[aid] += runs
            total_time_saved_minutes += runs * (
                agent_map[aid].get("estimated_time_saved_minutes") or 0
            )

    derived = snapshot["schedules"].get("by_derived_status") or {}
    return {
        "total_time_saved_minutes": total_time_saved_minutes,
        "per_agent_runs": dict(per_agent_runs),
        "total_schedule_runs": snapshot["schedules"].get("total_runs", 0),
        "total_agents": (snapshot["agents"].get("agents", {}).get("count", 0) or 0)
        + (snapshot["agents"].get("user_agents", {}).get("count", 0) or 0),
        "total_schedules": snapshot["schedules"].get("count", 0),
        "active_schedules": derived.get("active", 0),
    }
