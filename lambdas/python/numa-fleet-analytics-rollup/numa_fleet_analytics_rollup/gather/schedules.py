"""Schedules gather. Classifies cron expressions + projects runs/month."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any, Optional


def _count_fires(spec: str, max_n: int) -> int:
    if spec in ("*", "?"):
        return max_n
    if "/" in spec:
        try:
            base, step = spec.split("/", 1)
            step = int(step)
            if step <= 0:
                return 1
            if base in ("*", "0"):
                return max(1, max_n // step)
            try:
                start = int(base)
                return max(1, (max_n - start + step - 1) // step)
            except ValueError:
                return max(1, max_n // step)
        except Exception:
            return 1
    if "," in spec:
        return len([p for p in spec.split(",") if p.strip()])
    if "-" in spec:
        try:
            lo, hi = spec.split("-", 1)
            return max(1, int(hi) - int(lo) + 1)
        except Exception:
            return 1
    return 1


def classify_cron(expr: Optional[str]) -> dict[str, Any]:
    """Classify an AWS EventBridge cron(...) expression.

    Returns {kind, state, projected_runs_per_month, raw_year}.
    """
    if not expr:
        return {
            "kind": "unknown",
            "state": "unknown",
            "projected_runs_per_month": 0,
            "raw_year": "",
        }
    s = expr.strip()
    if s.startswith("cron(") and s.endswith(")"):
        s = s[5:-1]
    parts = s.split()
    if len(parts) != 6:
        return {
            "kind": "unknown",
            "state": "unknown",
            "projected_runs_per_month": 0,
            "raw_year": "",
        }
    minute, hour, dom, month, dow, year = parts

    if year != "*":
        try:
            y = int(year)
            now = datetime.now(timezone.utc)
            if y < now.year:
                state = "expired"
            elif y > now.year:
                state = "scheduled"
            else:
                state = "scheduled"
                try:
                    if month != "*" and dom != "*":
                        m, d = int(month), int(dom)
                        if (m, d) < (now.month, now.day):
                            state = "expired"
                except Exception:
                    pass
        except ValueError:
            state = "unknown"
        return {
            "kind": "one-off",
            "state": state,
            "projected_runs_per_month": 0,
            "raw_year": year,
        }

    minute_fires = _count_fires(minute, 60)
    hour_fires = _count_fires(hour, 24)
    runs_per_day_factor = minute_fires * hour_fires

    if dow != "?" and dow != "*":
        dow_count = _count_fires(dow, 7)
        days_per_month = dow_count * (30.0 / 7.0)
    elif dom != "?" and dom != "*":
        dom_count = _count_fires(dom, 31)
        days_per_month = dom_count
    else:
        days_per_month = 30.0

    month_count = _count_fires(month, 12) if month != "?" else 12
    month_factor = month_count / 12.0

    projected = int(round(runs_per_day_factor * days_per_month * month_factor))
    return {
        "kind": "recurring",
        "state": "recurring",
        "projected_runs_per_month": projected,
        "raw_year": "*",
    }


def _scan_all(table):
    items, last = [], None
    while True:
        kw: dict[str, Any] = {}
        if last:
            kw["ExclusiveStartKey"] = last
        resp = table.scan(**kw)
        items.extend(resp.get("Items", []))
        last = resp.get("LastEvaluatedKey")
        if not last:
            return items


def gather_schedules(session, client_name: str, region: str) -> dict[str, Any]:
    ddb = session.resource("dynamodb", region_name=region)
    try:
        items = _scan_all(ddb.Table(f"numa-{client_name}-agent-schedules"))
    except Exception as e:
        return {"error": repr(e), "schedule_to_agent": {}}

    rows: list[dict] = []
    by_status: Counter = Counter()
    by_derived_status: Counter = Counter()
    by_event_type: Counter = Counter()
    total_runs = 0
    last_errors = 0
    projected_runs_per_month_total = 0
    schedule_to_agent: dict[str, str] = {}

    for it in items:
        raw_status = it.get("status") or "unknown"
        event_type = it.get("event_type") or it.get("trigger_type") or "cron"
        runs = int(it.get("total_runs") or 0)
        last_status = it.get("last_status") or ""
        last_error_raw = it.get("last_error")
        has_last_error = last_error_raw not in (None, "", False)
        cron_expr = it.get("cron_expression")
        info = classify_cron(cron_expr)

        if raw_status == "active":
            if info["kind"] == "recurring":
                derived = "active"
            elif info["state"] == "expired":
                derived = "completed"
            elif info["state"] == "scheduled":
                derived = "scheduled"
            else:
                derived = "active"
        else:
            derived = raw_status

        by_status[raw_status] += 1
        by_derived_status[derived] += 1
        by_event_type[event_type] += 1
        total_runs += runs
        if has_last_error:
            last_errors += 1
        if derived == "active":
            projected_runs_per_month_total += info["projected_runs_per_month"]

        sched_id = it.get("schedule_id")
        agent_id = it.get("agent_id")
        if sched_id and agent_id:
            schedule_to_agent[sched_id] = agent_id

        rows.append(
            {
                "schedule_id": sched_id,
                "user_id": it.get("user_id"),
                "agent_id": agent_id,
                "agent_title": it.get("agent_title"),
                "label": it.get("label"),
                "status": raw_status,
                "derived_status": derived,
                "trigger_type": event_type,
                "cron_expression": cron_expr,
                "cron_kind": info["kind"],
                "cron_state": info["state"],
                "projected_runs_per_month": info["projected_runs_per_month"],
                "is_one_off": info["kind"] == "one-off",
                "total_runs": runs,
                "max_runs": int(it.get("max_runs") or 0),
                "last_run_epoch": int(it.get("last_run_epoch") or 0),
                "last_status": last_status,
                "last_error_present": has_last_error,
            }
        )

    return {
        "count": len(rows),
        "rows": rows,
        "by_status": dict(by_status),
        "by_derived_status": dict(by_derived_status),
        "by_event_type": dict(by_event_type),
        "by_trigger": dict(by_event_type),
        "total_runs": total_runs,
        "schedules_with_errors": last_errors,
        "projected_runs_per_month_total": projected_runs_per_month_total,
        "schedule_to_agent": schedule_to_agent,
    }
