"""Scheduled-run history from S3 numa-chat/scheduled-runs/."""

from __future__ import annotations

import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from botocore.config import Config

from .chat import compute_trace_analytics


def gather_scheduled_runs(
    session, client_name: str, region: str, days: int
) -> dict[str, Any]:
    bucket = f"numa-{client_name}-outputs"
    s3 = session.client(
        "s3",
        region_name=region,
        config=Config(max_pool_connections=64, retries={"max_attempts": 5}),
    )
    cutoff_ms = int(
        (datetime.now(timezone.utc) - timedelta(days=days)).timestamp() * 1000
    )

    keys: list[dict[str, Any]] = []
    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(
            Bucket=bucket, Prefix="numa-chat/scheduled-runs/"
        ):
            for obj in page.get("Contents", []) or []:
                k = obj["Key"]
                if not k.endswith(".json"):
                    continue
                parts = k.split("/")
                if len(parts) < 5:
                    continue
                fname = parts[-1].replace(".json", "")
                ts_ms = None
                try:
                    ts_ms = int(fname.split("-", 1)[0])
                except Exception:
                    pass
                if ts_ms is not None and ts_ms < cutoff_ms:
                    continue
                keys.append(
                    {
                        "key": k,
                        "user_id": parts[2],
                        "schedule_id": parts[3],
                        "filename_ts_ms": ts_ms,
                        "last_modified": obj["LastModified"],
                    }
                )
    except Exception as e:
        return {
            "error": repr(e),
            "runs": [],
            "totals": {"count": 0, "cost": 0, "turns": 0},
            "by_status": {},
            "by_agent": {},
            "daily_runs": {},
            "daily_cost": {},
        }

    def _fetch(rec: dict) -> Optional[dict]:
        try:
            body = s3.get_object(Bucket=bucket, Key=rec["key"])["Body"].read()
            run = json.loads(body.decode("utf-8", "replace"))
        except Exception as e:
            return {"_fetch_error": str(e), "key": rec["key"]}
        conv_id = run.get("conversationId")
        trace_text = ""
        if conv_id and rec.get("user_id"):
            trace_key = f"numa-chat/workspace/{rec['user_id']}/conversations/{conv_id}/_system/trace.jsonl"
            try:
                tbody = s3.get_object(Bucket=bucket, Key=trace_key)["Body"].read()
                trace_text = tbody.decode("utf-8", "replace")
            except Exception:
                pass
        analytics = compute_trace_analytics(trace_text) if trace_text else {}
        # NOTE: `prompt`, `scheduleLabel`, and `error` text are intentionally
        # NOT extracted — they contain sensitive client data (the user's
        # schedule template, scheduling label, and error messages can echo
        # input data). Status is kept (categorical) and `errors_in_trace`
        # is a count for failure visibility.
        return {
            "schedule_id": rec["schedule_id"],
            "user_id": rec["user_id"],
            "conversation_id": conv_id,
            "agent_id": (run.get("agent") or {}).get("agentId"),
            "agent_title": (run.get("agent") or {}).get("agentTitle"),
            "agent_version": (run.get("agent") or {}).get("agentVersion"),
            "started_at": run.get("startedAt"),
            "completed_at": run.get("completedAt"),
            "status": (run.get("agentStatus") or {}).get("status")
            or ("failed" if run.get("error") else "unknown"),
            "cost": analytics.get("total_cost_usd", 0),
            "turns": analytics.get("total_turns", 0),
            "requests": analytics.get("request_count", 0),
            "user_messages": analytics.get("user_messages", 0),
            "tool_calls": analytics.get("tool_call_count", 0),
            "input_tokens": analytics.get("input_tokens", 0),
            "output_tokens": analytics.get("output_tokens", 0),
            "cache_read_tokens": analytics.get("cache_read_tokens", 0),
            "cache_creation_tokens": analytics.get("cache_creation_tokens", 0),
            "duration_ms_total": analytics.get("duration_ms_total", 0),
            "model": analytics.get("model"),
            "errors_in_trace": analytics.get("error_count", 0),
            "first_request_at": analytics.get("first_request_at"),
            "last_request_at": analytics.get("last_request_at"),
            "filename_ts_ms": rec.get("filename_ts_ms"),
            "last_modified": (
                rec["last_modified"].isoformat() if rec.get("last_modified") else None
            ),
        }

    runs: list[dict] = []
    fetch_errors = 0
    with ThreadPoolExecutor(max_workers=24) as pool:
        for fut in as_completed([pool.submit(_fetch, k) for k in keys]):
            r = fut.result()
            if not r:
                continue
            if "_fetch_error" in r:
                fetch_errors += 1
                continue
            runs.append(r)

    daily_runs: dict[str, int] = {}
    daily_cost: dict[str, float] = {}
    for r in runs:
        ca = r.get("completed_at") or r.get("started_at") or ""
        day = ca[:10] if isinstance(ca, str) else ""
        if day:
            daily_runs[day] = daily_runs.get(day, 0) + 1
            daily_cost[day] = daily_cost.get(day, 0) + float(r.get("cost") or 0)

    by_agent: dict[str, dict] = {}
    for r in runs:
        aid = r.get("agent_id") or "?"
        if aid not in by_agent:
            by_agent[aid] = {
                "agent_id": aid,
                "agent_title": r.get("agent_title"),
                "runs": 0,
                "cost": 0.0,
                "turns": 0,
                "errors": 0,
            }
        a = by_agent[aid]
        a["runs"] += 1
        a["cost"] += float(r.get("cost") or 0)
        a["turns"] += int(r.get("turns") or 0)
        if r.get("status") == "failed":
            a["errors"] += 1

    # Keep only the top-N runs by cost for the dashboard's drill-down view.
    # The rest are accounted for in daily_runs / daily_cost / by_agent /
    # by_status. Privacy: top_runs already excludes prompt/label/error text.
    TOP_RUNS_KEEP = 50
    top_runs = sorted(runs, key=lambda r: -float(r.get("cost") or 0))[:TOP_RUNS_KEEP]

    return {
        "discovered": len(keys),
        "fetch_errors": fetch_errors,
        "top_runs": top_runs,
        "top_runs_kept": len(top_runs),
        "top_runs_dropped": max(0, len(runs) - len(top_runs)),
        "totals": {
            "count": len(runs),
            "cost": sum(float(r.get("cost") or 0) for r in runs),
            "turns": sum(int(r.get("turns") or 0) for r in runs),
        },
        "by_status": dict(Counter(r.get("status") or "unknown" for r in runs)),
        "by_agent": by_agent,
        "daily_runs": daily_runs,
        "daily_cost": daily_cost,
    }
