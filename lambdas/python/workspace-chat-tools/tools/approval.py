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

# Approval polling configuration.
#
# If you change APPROVAL_TIMEOUT_SECONDS, also update the matching constants in
# `services/numa-workspace-agent/numa_workspace_agent/sdk_runner.py` (currently
# imported indirectly via the MCP tool flow) and
# `numa-frontend/src/Components/WorkspaceChat/WorkspaceChatInlineTool.tsx`.
# There is no shared package — three copies, kept in sync manually.
# Tests in `tests/test_approval.py` will fail if the Python copies drift.
APPROVAL_POLL_INTERVAL_SECONDS = 5
APPROVAL_TIMEOUT_SECONDS = 180
# Unattended fast-fail (BUG-140): when the approval card is rendered, the
# frontend writes `seen_at` onto the approval record (proxy `ack` action).
# If no ack lands within this grace window the user isn't viewing the
# conversation — fail fast instead of burning the full 180s per call, which
# is what made away-from-chat runs hang for 10-20 minutes (approval cascade).
# The window must comfortably cover SSE delivery + render + ack round-trip,
# including throttled background tabs.
APPROVAL_UNATTENDED_GRACE_SECONDS = 25

# Model-facing explanation for an unattended approval. Distinct from both
# "denied" (user said no) and "timeout" (user saw the card and didn't act)
# so the model ends the turn gracefully instead of treating it as refusal.
UNATTENDED_MESSAGE = (
    "The user was not viewing the conversation, so the approval prompt was "
    "never shown to them. The action was NOT executed. Do not retry "
    "automatically — summarise what you wanted to do and let the user know "
    "they can ask again when they're back."
)

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


def approval_is_unattended(item: Dict[str, Any], poll_started_at: float) -> bool:
    """True when an approval has sat past the grace window without a seen-ack.

    The frontend acks (writes ``seen_at``) the moment the approval card is
    rendered — including in background tabs — so a missing ack past the grace
    window means nobody is viewing the conversation. Anchored to the record's
    created_at when available (same rationale as the poll deadline), falling
    back to when polling started.
    """
    if item.get("seen_at", {}).get("N"):
        return False
    created_at_str = item.get("created_at", {}).get("N")
    anchor = int(created_at_str) if created_at_str else poll_started_at
    return time.time() >= anchor + APPROVAL_UNATTENDED_GRACE_SECONDS


def poll_approval(approval_id: str) -> Tuple[str, str]:
    """Poll DynamoDB for approval decision.

    Blocks until approved, denied, unattended, or timeout.

    Args:
        approval_id: The approval request ID

    Returns:
        Tuple of (decision, deny_reason) where decision is
        "approved", "denied", "unattended", or "timeout", and deny_reason
        is the optional user-provided reason (empty string if none).
    """
    table_name = INTEGRATIONS_APPROVAL_TABLE or os.environ.get(
        "INTEGRATIONS_APPROVAL_TABLE_NAME", ""
    )
    if not table_name:
        raise ValueError("INTEGRATIONS_APPROVAL_TABLE_NAME is not configured")

    dynamodb = prm_client("dynamodb")

    # Anchor the deadline to the DDB record's created_at, not to wall-clock-now.
    # This way the user's effective approval window is always
    # APPROVAL_TIMEOUT_SECONDS from when the card became visible (the SSE
    # event timestamp ~= DDB created_at), regardless of when polling
    # happens to start. Fixes a race where eager tool dispatch could burn
    # the entire window before the card was even rendered (see incident
    # 2026-05-02 in nd-labs).
    initial = dynamodb.get_item(
        TableName=table_name,
        Key={"approval_id": {"S": approval_id}},
    )
    initial_item = initial.get("Item", {})
    created_at_str = initial_item.get("created_at", {}).get("N")

    if created_at_str:
        deadline = int(created_at_str) + APPROVAL_TIMEOUT_SECONDS
        # Safety floor: never give the user less than 30s of polling even
        # if created_at is unexpectedly stale or clock-skewed.
        deadline = max(deadline, time.time() + 30)
    else:
        # Fallback: DDB record not visible yet (eventual consistency, very
        # rare since create_approval_request is a strongly-consistent put).
        deadline = time.time() + APPROVAL_TIMEOUT_SECONDS

    # Honour the initial read so we don't double-poll on the first iteration.
    initial_status = initial_item.get("status", {}).get("S", "pending")
    if initial_status in ("approved", "denied"):
        deny_reason = initial_item.get("deny_reason", {}).get("S", "")
        logger.info(
            "Approval decision received",
            approval_id=approval_id,
            status=initial_status,
            has_deny_reason=bool(deny_reason),
        )
        return initial_status, deny_reason

    poll_started_at = time.time()

    while time.time() < deadline:
        time.sleep(APPROVAL_POLL_INTERVAL_SECONDS)

        response = dynamodb.get_item(
            TableName=table_name,
            Key={"approval_id": {"S": approval_id}},
        )

        item = response.get("Item", {})
        status = item.get("status", {}).get("S", "pending")

        # A decision always wins over the unattended check, even if it lands
        # right at the grace boundary.
        if status in ("approved", "denied"):
            deny_reason = item.get("deny_reason", {}).get("S", "")
            logger.info(
                "Approval decision received",
                approval_id=approval_id,
                status=status,
                has_deny_reason=bool(deny_reason),
            )
            return status, deny_reason

        if approval_is_unattended(item, poll_started_at):
            logger.warning(
                "Approval unattended — card never acknowledged by a client",
                _name="APPROVAL_UNATTENDED",
                approval_id=approval_id,
                grace_seconds=APPROVAL_UNATTENDED_GRACE_SECONDS,
            )
            return "unattended", ""

    logger.warning(
        "Approval timed out",
        approval_id=approval_id,
        timeout_seconds=APPROVAL_TIMEOUT_SECONDS,
    )
    return "timeout", ""


def check_approval(
    params: Dict[str, Any],
    action_key: str,
    description: str,
    props_preview: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Check approval if request_id is present and not auto-approved.

    This is a shared convenience wrapper around create_approval_request +
    poll_approval. Any tool handler can call this -- if no request_id is
    present in params the function is a no-op.

    Returns a denial/timeout dict if denied/timed out, or None to proceed.
    """
    request_id = params.get("request_id")
    if not request_id:
        return None

    if params.get("auto_approved", False):
        return None

    user_sub = params.get("__user_sub", params.get("user_sub", ""))
    approval_id = create_approval_request(
        user_sub=user_sub,
        action_key=action_key,
        description=description,
        props_preview=props_preview or {},
        approval_id=request_id,
    )

    decision, deny_reason = poll_approval(approval_id)

    if decision == "denied":
        msg = "The user denied this action."
        if deny_reason:
            msg += f' The user said: "{deny_reason}"'
        return {"status": "denied", "message": msg, "deny_reason": deny_reason}

    if decision == "unattended":
        return {"status": "unattended", "message": UNATTENDED_MESSAGE}

    if decision == "timeout":
        return {"status": "timeout", "message": "Approval timed out"}

    return None
