"""
Policy helpers for Pipedream MCP integrations.
"""

import os
from typing import Any, Dict, Optional, Set

import structlog

from ....config import GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME, get_dynamodb_resource

logger = structlog.get_logger(__name__)


def _as_str_set(value: Any) -> Set[str]:
    """Normalize unknown value into a set of strings. Non-strings are dropped."""
    if not value:
        return set()
    if isinstance(value, (list, tuple, set)):
        return {v for v in value if isinstance(v, str)}
    if isinstance(value, str):
        return {value}
    return set()


def get_mcp_policy_from_dynamo(external_user_id: str, app_name: str) -> Dict:
    """
    Fetch effective MCP policy for a user/app, merged with global denies.

    Behaviour:
    - Start with default policy {mode: 'deny', denyTools: []}
    - If a user policy exists, overlay it
    - Always merge in global denyTools (if configured), even if user policy is missing
    """
    user_table = os.environ.get(
        "USER_INTEGRATION_SETTINGS_TABLE_NAME"
    ) or os.environ.get("MCP_POLICY_TABLE_NAME")
    default_policy = {"mode": "deny", "denyTools": []}

    if "_" not in (external_user_id or ""):
        try:
            if GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME:
                ddb = get_dynamodb_resource()
                gtable = ddb.Table(GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME)
                gres = gtable.get_item(Key={"integration": app_name})
                gitem = gres.get("Item") or {}
                gdeny = _as_str_set(gitem.get("denyTools"))
                if gdeny:
                    return {"mode": "deny", "denyTools": list(gdeny)}
        except Exception:  # pragma: no cover - best effort logging only
            pass
        return default_policy

    client_name, cognito_sub = external_user_id.split("_", 1)
    pk = f"CLIENT#{client_name}#USER#{cognito_sub}"
    sk = f"INTEGRATION#{app_name}"

    policy = dict(default_policy)

    try:
        ddb = get_dynamodb_resource()

        if user_table:
            try:
                utbl = ddb.Table(user_table)
                resp = utbl.get_item(Key={"pk": pk, "sk": sk}, ConsistentRead=True)
                item = resp.get("Item")
                if item:
                    policy["mode"] = item.get("mode", "deny")
                    policy["denyTools"] = list(_as_str_set(item.get("denyTools", [])))
            except Exception as exc:  # pragma: no cover
                logger.warning("User policy read failed", error=str(exc))

        try:
            if GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME:
                gtable = ddb.Table(GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME)
                gres = gtable.get_item(Key={"integration": app_name})
                gitem = gres.get("Item") or {}
                gdeny = _as_str_set(gitem.get("denyTools"))
                if gdeny:
                    current_deny = _as_str_set(policy.get("denyTools"))
                    merged = list(current_deny.union(gdeny))
                    policy["denyTools"] = merged
                    logger.info(
                        "Merged global deny tools into MCP policy",
                        app_name=app_name,
                        user_deny_count=len(current_deny),
                        global_deny_count=len(gdeny),
                        merged_count=len(merged),
                    )
        except Exception as exc:  # pragma: no cover
            logger.warning("Global deny merge failed", error=str(exc))

        return policy
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to build effective MCP policy", error=str(exc))
        return policy


def is_integration_globally_disabled(app_name: str) -> bool:
    """
    Check whether an integration is globally disabled for the tenant.
    """
    table_name: Optional[str] = os.environ.get("GLOBAL_INTEGRATION_STATUS_TABLE_NAME")
    if not table_name:
        return False

    try:
        ddb = get_dynamodb_resource()
        table = ddb.Table(table_name)
        res = table.get_item(Key={"integration": app_name})
        item = res.get("Item") or {}
        return (item.get("status") or "enabled") == "disabled"
    except Exception:
        return False
