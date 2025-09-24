"""
Policy store for per-user, per-integration MCP tool settings in client account.
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, Tuple

import boto3
import structlog

logger = structlog.get_logger()


DEFAULT_POLICY = {
    "mode": "deny",
    "denyTools": [],
}


class PolicyStore:
    def __init__(self) -> None:
        table_name = os.environ.get("MCP_POLICY_TABLE_NAME")
        if not table_name:
            raise ValueError("MCP_POLICY_TABLE_NAME environment variable not set")
        self._table = boto3.resource("dynamodb").Table(table_name)

    @staticmethod
    def _parse_external_user_id(external_user_id: str) -> Tuple[str, str]:
        if "_" not in external_user_id:
            raise ValueError("Invalid external_user_id format")
        client_name, cognito_sub = external_user_id.split("_", 1)
        return client_name, cognito_sub

    def _keys(self, external_user_id: str, app_name: str) -> Dict[str, str]:
        client_name, cognito_sub = self._parse_external_user_id(external_user_id)
        return {
            "pk": f"CLIENT#{client_name}#USER#{cognito_sub}",
            "sk": f"INTEGRATION#{app_name}",
        }

    def get_policy(self, external_user_id: str, app_name: str) -> Dict[str, Any]:
        keys = self._keys(external_user_id, app_name)
        try:
            resp = self._table.get_item(Key=keys)
            item = resp.get("Item")
            if not item:
                return {**DEFAULT_POLICY}
            return {
                "mode": item.get("mode", "deny"),
                "denyTools": item.get("denyTools", []),
            }
        except Exception as e:
            logger.error("DDB get_policy failed", error=str(e), keys=keys)
            return {**DEFAULT_POLICY}

    def set_policy(
        self,
        external_user_id: str,
        app_name: str,
        mode: str,
        deny_tools: list[str],
    ) -> Dict[str, Any]:
        if mode not in ("deny", "allow"):
            raise ValueError("Invalid policy mode")
        keys = self._keys(external_user_id, app_name)

        try:
            # Last-write-wins upsert
            self._table.update_item(
                Key=keys,
                UpdateExpression="SET #m = :mode, denyTools = :deny, updatedAt = :ts",
                ExpressionAttributeNames={"#m": "mode"},
                ExpressionAttributeValues={
                    ":mode": mode,
                    ":deny": deny_tools or [],
                    ":ts": int(time.time()),
                },
            )
            return {"success": True}
        except Exception as e:
            logger.error("DDB set_policy failed", error=str(e), keys=keys, mode=mode)
            raise
