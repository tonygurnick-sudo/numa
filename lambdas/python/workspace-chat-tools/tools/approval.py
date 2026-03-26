"""
Shared approval module for human-in-the-loop (HITL) approval flows.

Provides create/poll functions for DynamoDB-backed approval requests.
Used by both integration tools (Pipedream) and numa_tool write operations.
"""

import json
import os
import time
import uuid
from typing import Any, Dict, Optional, Tuple

import structlog

from prm import client as prm_client

logger = structlog.get_logger()

# Approval polling configuration
APPROVAL_POLL_INTERVAL_SECONDS = 5
APPROVAL_TIMEOUT_SECONDS = 90

# DynamoDB table name from environment
INTEGRATIONS_APPROVAL_TABLE = os.environ.get("INTEGRATIONS_APPROVAL_TABLE_NAME", "")


def create_approval_request(
    user_sub: str,
    action_key: str,
    description: str,
    props_preview: Dict[str, Any],
    annotations: Optional[Dict[str, Any]] = None,
    approval_id: Optional[str] = None,
) -> str:
    """Create an approval request in DynamoDB and return the approval ID.

    Args:
        user_sub: The user's Cognito sub
        action_key: The action being executed
        description: Human-readable description of what the action does
        props_preview: Preview of the configured props
        annotations: Action annotations (readOnlyHint, destructiveHint, etc.)
        approval_id: Deterministic approval ID (typically request_id).
                     Falls back to UUID if not provided.

    Returns:
        The approval_id string
    """
    table_name = INTEGRATIONS_APPROVAL_TABLE or os.environ.get(
        "INTEGRATIONS_APPROVAL_TABLE_NAME", ""
    )
    if not table_name:
        raise ValueError("INTEGRATIONS_APPROVAL_TABLE_NAME is not configured")

    approval_id = approval_id or str(uuid.uuid4())
    now = int(time.time())
    ttl = now + 86400  # 24 hours

    dynamodb = prm_client("dynamodb")
    try:
        dynamodb.put_item(
            TableName=table_name,
            Item={
                "approval_id": {"S": approval_id},
                "user_sub": {"S": user_sub},
                "action_key": {"S": action_key},
                "description": {"S": description},
                "props_preview": {"S": json.dumps(props_preview)},
                "annotations": {"S": json.dumps(annotations or {})},
                "status": {"S": "pending"},
                "created_at": {"N": str(now)},
                "ttl": {"N": str(ttl)},
            },
            ConditionExpression="attribute_not_exists(approval_id)",
        )
    except dynamodb.exceptions.ConditionalCheckFailedException:
        logger.info(
            "Approval record already exists (likely pre-approved)",
            approval_id=approval_id,
            action_key=action_key,
        )

    logger.info(
        "Created approval request",
        approval_id=approval_id,
        action_key=action_key,
        user_sub=user_sub[:8] + "...",
    )

    return approval_id


def poll_approval(approval_id: str) -> Tuple[str, str]:
    """Poll DynamoDB for approval decision.

    Blocks until approved, denied, or timeout.

    Args:
        approval_id: The approval request ID

    Returns:
        Tuple of (decision, deny_reason) where decision is
        "approved", "denied", or "timeout", and deny_reason
        is the optional user-provided reason (empty string if none).
    """
    table_name = INTEGRATIONS_APPROVAL_TABLE or os.environ.get(
        "INTEGRATIONS_APPROVAL_TABLE_NAME", ""
    )
    if not table_name:
        raise ValueError("INTEGRATIONS_APPROVAL_TABLE_NAME is not configured")

    dynamodb = prm_client("dynamodb")
    deadline = time.time() + APPROVAL_TIMEOUT_SECONDS

    while time.time() < deadline:
        response = dynamodb.get_item(
            TableName=table_name,
            Key={"approval_id": {"S": approval_id}},
        )

        item = response.get("Item", {})
        status = item.get("status", {}).get("S", "pending")

        if status in ("approved", "denied"):
            deny_reason = item.get("deny_reason", {}).get("S", "")
            logger.info(
                "Approval decision received",
                approval_id=approval_id,
                status=status,
                has_deny_reason=bool(deny_reason),
            )
            return status, deny_reason

        time.sleep(APPROVAL_POLL_INTERVAL_SECONDS)

    logger.warning(
        "Approval timed out",
        approval_id=approval_id,
        timeout_seconds=APPROVAL_TIMEOUT_SECONDS,
    )
    return "timeout", ""
