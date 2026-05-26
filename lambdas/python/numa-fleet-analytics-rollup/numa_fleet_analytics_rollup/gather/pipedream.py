"""Pipedream live integration status — per-user, via the per-client relay lambda."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any


def gather_pipedream_connections(
    session, client_name: str, region: str, user_subs: list[str]
) -> dict[str, Any]:
    """Invoke `{client}_pipedream-relay` once per user; aggregate connected_apps.

    Returns an empty result (not an error) when the relay function doesn't
    exist for this client — Pipedream integrations are an opt-in feature
    flag and we shouldn't break the whole snapshot for that.
    """
    lam = session.client("lambda", region_name=region)
    fn = f"{client_name}_pipedream-relay"

    # Probe once before fanning out
    try:
        lam.get_function(FunctionName=fn)
    except lam.exceptions.ResourceNotFoundException:
        return {
            "fn_name": fn,
            "skipped": "no_relay_function",
            "users_queried": 0,
            "users_with_data": 0,
            "users_with_errors": 0,
            "active_connections": 0,
            "distinct_active_apps": 0,
            "by_app_active": [],
            "per_user_active": {},
        }
    except Exception as e:
        return {
            "fn_name": fn,
            "error": repr(e),
            "users_queried": 0,
            "users_with_data": 0,
            "users_with_errors": 0,
            "active_connections": 0,
            "distinct_active_apps": 0,
            "by_app_active": [],
            "per_user_active": {},
        }

    def fetch(sub: str) -> dict:
        try:
            payload = json.dumps(
                {
                    "operation": "get_integration_status",
                    "external_user_id": f"{client_name}_{sub}",
                }
            ).encode("utf-8")
            resp = lam.invoke(FunctionName=fn, Payload=payload)
            data = json.loads(resp["Payload"].read().decode("utf-8"))
            body = data.get("body")
            if isinstance(body, str):
                body = json.loads(body)
            if not body or not body.get("success"):
                return {"user_sub": sub, "error": (body or {}).get("error")}
            return {"user_sub": sub, "data": body.get("data") or {}}
        except Exception as e:
            return {"user_sub": sub, "error": repr(e)}

    results = []
    if user_subs:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for fut in as_completed([pool.submit(fetch, s) for s in user_subs]):
                results.append(fut.result())

    by_app_active: dict[str, dict] = {}
    per_user_active: dict[str, list[str]] = {}
    total_active_connections = 0
    errors = 0
    for r in results:
        if r.get("error"):
            errors += 1
            continue
        d = r["data"]
        sub = r["user_sub"]
        connected_apps = d.get("connected_apps") or []
        per_user_active[sub] = connected_apps
        for app in connected_apps:
            if app not in by_app_active:
                by_app_active[app] = {
                    "app_name": app,
                    "user_count": set(),
                    "user_subs": [],
                }
            e = by_app_active[app]
            e["user_count"].add(sub)
            if sub not in e["user_subs"]:
                e["user_subs"].append(sub)
            total_active_connections += 1

    by_app_serialized = []
    for app, e in by_app_active.items():
        e2 = dict(e)
        e2["user_count"] = len(e["user_count"])
        by_app_serialized.append(e2)
    by_app_serialized.sort(key=lambda e: (-e["user_count"], e["app_name"]))

    return {
        "fn_name": fn,
        "users_queried": len(user_subs),
        "users_with_data": len(per_user_active),
        "users_with_errors": errors,
        "active_connections": total_active_connections,
        "distinct_active_apps": len(by_app_serialized),
        "by_app_active": by_app_serialized,
        "per_user_active": per_user_active,
    }
