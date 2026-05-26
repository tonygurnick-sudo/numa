"""Agents + KBs + data connectors + tool-policies + approvals gather."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any


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


def _gather_agents(ddb, client_name: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for table_kind, table_name in [
        ("agents", f"numa-{client_name}-agents"),
        ("user_agents", f"numa-{client_name}-user-agents"),
    ]:
        try:
            items = _scan_all(ddb.Table(table_name))
            rows = []
            for it in items:
                rows.append(
                    {
                        "agent_id": it.get("agent_id"),
                        "title": it.get("title") or it.get("name"),
                        "visibility": it.get("visibility"),
                        "agent_type": it.get("agent_type"),
                        "estimated_time_saved_minutes": int(
                            it.get("estimated_time_saved_minutes") or 0
                        ),
                        "version": int(it.get("version") or 0),
                        "created_by_user_id": it.get("created_by_user_id"),
                        "created_at": it.get("created_at"),
                        "updated_at": it.get("updated_at"),
                    }
                )
            out[table_kind] = {"count": len(rows), "rows": rows}
        except Exception as e:
            out[table_kind] = {"error": repr(e), "count": 0, "rows": []}
    return out


def _gather_connectors_kbs(ddb, client_name: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    try:
        items = _scan_all(ddb.Table(f"numa-{client_name}-data-connectors"))
        per_type: Counter = Counter()
        per_user: defaultdict = defaultdict(int)
        for it in items:
            t = (
                it.get("connector_type")
                or it.get("connectorType")
                or it.get("type")
                or "unknown"
            )
            per_type[t] += 1
            per_user[str(it.get("user_id") or "?")] += 1
        out["data_connectors"] = {
            "count": len(items),
            "by_type": dict(per_type),
            "by_user_count": dict(per_user),
        }
    except Exception as e:
        out["data_connectors"] = {"error": repr(e), "count": 0}

    for tbl in ["mcp-tool-policies", "global-data-connector-settings"]:
        try:
            items = _scan_all(ddb.Table(f"numa-{client_name}-{tbl}"))
            out[tbl] = {"count": len(items)}
        except Exception as e:
            out[tbl] = {"error": repr(e)[:200], "count": 0}

    # integrations-approval lives without the numa- prefix in some clients
    for cand in [
        f"{client_name}-integrations-approval",
        f"numa-{client_name}-integrations-approval",
    ]:
        try:
            items = _scan_all(ddb.Table(cand))
            out["integrations-approval"] = {"count": len(items)}
            break
        except Exception as e:
            out["integrations-approval"] = {"error": repr(e)[:200], "count": 0}

    try:
        kbs = _scan_all(ddb.Table(f"numa-{client_name}-knowledge-bases"))
        out["knowledge_bases"] = {
            "count": len(kbs),
            "rows": [
                {
                    "kb_id": it.get("kb_id") or it.get("knowledge_base_id"),
                    "name": it.get("name") or it.get("kb_name"),
                    "kind": it.get("kb_type") or it.get("type") or "unknown",
                }
                for it in kbs
            ],
        }
    except Exception as e:
        out["knowledge_bases"] = {"error": repr(e), "count": 0, "rows": []}
    return out


def gather_integrations(session, client_name: str, region: str) -> dict[str, Any]:
    """Return { agents: {...}, integrations: {...} } in one resource lookup."""
    ddb = session.resource("dynamodb", region_name=region)
    return {
        "agents": _gather_agents(ddb, client_name),
        "integrations": _gather_connectors_kbs(ddb, client_name),
    }
