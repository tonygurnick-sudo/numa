"""
Vault secrets tool handlers for workspace-chat-tools.

Handles vault secret operations for the workspace agent:
- vault_list_secrets: List secret metadata (no values)
- vault_request_secret: Request a secret with approval flow (or danger_mode auto-access)

Secrets are stored in AWS Secrets Manager with metadata in DynamoDB.
User isolation is enforced via user_sub from JWT.
"""

import json
import os
import time
import uuid
from typing import Any, Dict

import structlog

from prm import client as prm_client

from .approval import APPROVAL_POLL_INTERVAL_SECONDS, APPROVAL_TIMEOUT_SECONDS

logger = structlog.get_logger()

# Table names from environment
VAULT_SECRETS_TABLE = os.environ.get("VAULT_SECRETS_TABLE_NAME", "")
VAULT_AUDIT_LOG_TABLE = os.environ.get("VAULT_AUDIT_LOG_TABLE_NAME", "")
INTEGRATIONS_APPROVAL_TABLE = os.environ.get("INTEGRATIONS_APPROVAL_TABLE_NAME", "")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "")


def _write_audit_log(
    user_id: str,
    secret_id: str,
    secret_name: str,
    action: str,
    accessor: str,
    purpose: str = "",
    conversation_id: str = "",
    approved_by: str = "",
) -> None:
    """Write an entry to the vault audit log table."""
    if not VAULT_AUDIT_LOG_TABLE:
        logger.warning("VAULT_AUDIT_LOG_TABLE_NAME not configured, skipping audit log")
        return

    dynamodb = prm_client("dynamodb")
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    audit_id = str(uuid.uuid4())
    ttl = int(time.time()) + (90 * 86400)  # 90 days

    dynamodb.put_item(
        TableName=VAULT_AUDIT_LOG_TABLE,
        Item={
            "user_id": {"S": user_id},
            "timestamp_audit_id": {"S": f"{now_iso}#{audit_id}"},
            "secret_id": {"S": secret_id},
            "secret_name": {"S": secret_name},
            "action": {"S": action},
            "accessor": {"S": accessor},
            "purpose": {"S": purpose},
            "conversation_id": {"S": conversation_id},
            "approved_by": {"S": approved_by},
            "created_at": {"S": now_iso},
            "ttl": {"N": str(ttl)},
        },
    )


def _create_approval_request(
    user_sub: str,
    action_key: str,
    description: str,
    props_preview: Dict[str, Any],
    approval_id: str | None = None,
) -> str:
    """Create an approval request in the integrations approval table.

    Reuses the same DynamoDB table and pattern as pipedream_integration.py
    so the frontend approval flow works identically.
    """
    if not INTEGRATIONS_APPROVAL_TABLE:
        raise ValueError("INTEGRATIONS_APPROVAL_TABLE_NAME is not configured")

    approval_id = approval_id or str(uuid.uuid4())
    now = int(time.time())
    ttl = now + 86400  # 24 hours

    dynamodb = prm_client("dynamodb")
    try:
        dynamodb.put_item(
            TableName=INTEGRATIONS_APPROVAL_TABLE,
            Item={
                "approval_id": {"S": approval_id},
                "user_sub": {"S": user_sub},
                "action_key": {"S": action_key},
                "description": {"S": description},
                "props_preview": {"S": json.dumps(props_preview)},
                "annotations": {"S": json.dumps({})},
                "status": {"S": "pending"},
                "created_at": {"N": str(now)},
                "ttl": {"N": str(ttl)},
            },
            ConditionExpression="attribute_not_exists(approval_id)",
        )
    except dynamodb.exceptions.ConditionalCheckFailedException:
        logger.info(
            "Vault approval record already exists (likely pre-approved)",
            approval_id=approval_id,
            action_key=action_key,
        )

    logger.info(
        "Created vault approval request",
        approval_id=approval_id,
        action_key=action_key,
        user_sub=user_sub[:8] + "...",
    )
    return approval_id


def _poll_approval(approval_id: str) -> str:
    """Poll DynamoDB for approval decision. Blocks until decided or timeout."""
    if not INTEGRATIONS_APPROVAL_TABLE:
        raise ValueError("INTEGRATIONS_APPROVAL_TABLE_NAME is not configured")

    dynamodb = prm_client("dynamodb")

    # Anchor the deadline to the DDB record's created_at (matches
    # tools.approval.poll_approval; see comment there for the rationale).
    initial = dynamodb.get_item(
        TableName=INTEGRATIONS_APPROVAL_TABLE,
        Key={"approval_id": {"S": approval_id}},
    )
    initial_item = initial.get("Item", {})
    created_at_str = initial_item.get("created_at", {}).get("N")

    if created_at_str:
        deadline = max(int(created_at_str) + APPROVAL_TIMEOUT_SECONDS, time.time() + 30)
    else:
        deadline = time.time() + APPROVAL_TIMEOUT_SECONDS

    initial_status = initial_item.get("status", {}).get("S", "pending")
    if initial_status in ("approved", "denied"):
        logger.info(
            "Vault approval decision received",
            approval_id=approval_id,
            status=initial_status,
        )
        return initial_status

    while time.time() < deadline:
        time.sleep(APPROVAL_POLL_INTERVAL_SECONDS)

        response = dynamodb.get_item(
            TableName=INTEGRATIONS_APPROVAL_TABLE,
            Key={"approval_id": {"S": approval_id}},
        )
        item = response.get("Item", {})
        status = item.get("status", {}).get("S", "pending")

        if status in ("approved", "denied"):
            logger.info(
                "Vault approval decision received",
                approval_id=approval_id,
                status=status,
            )
            return status

    logger.warning(
        "Vault approval timed out",
        approval_id=approval_id,
        timeout_seconds=APPROVAL_TIMEOUT_SECONDS,
    )
    return "timeout"


def handle_vault_list_secrets(params: Dict[str, Any]) -> Dict[str, Any]:
    """List vault secret metadata (no values) for the user.

    Args:
        params: Must contain '__user_sub'

    Returns:
        Dict with 'items' list of secret metadata
    """
    user_sub = params.get("__user_sub", "")
    if not user_sub:
        raise ValueError("User authentication required for vault operations")

    if not VAULT_SECRETS_TABLE:
        raise ValueError("VAULT_SECRETS_TABLE_NAME is not configured")

    dynamodb = prm_client("dynamodb")
    response = dynamodb.query(
        TableName=VAULT_SECRETS_TABLE,
        KeyConditionExpression="user_id = :uid",
        ExpressionAttributeValues={":uid": {"S": user_sub}},
    )

    items = []
    for item in response.get("Items", []):
        items.append(
            {
                "name": item.get("name", {}).get("S", ""),
                "type": item.get("type", {}).get("S", "custom"),
                "category": item.get("category", {}).get("S", "General"),
                "danger_mode": item.get("danger_mode", {}).get("BOOL", False),
            }
        )

    logger.info(
        "Listed vault secrets",
        user_sub=user_sub[:8] + "...",
        count=len(items),
    )

    return {"items": items}


def handle_vault_request_secret(params: Dict[str, Any]) -> Dict[str, Any]:
    """Request a vault secret with approval flow.

    If the secret has danger_mode enabled, auto-approve and return immediately.
    Otherwise, create an approval request and poll for user decision.

    Args:
        params: Must contain 'secret_name', 'purpose', '__user_sub',
                '__conversation_id', 'request_id', 'auto_approved'

    Returns:
        Dict with status and optional fields
    """
    secret_name = params.get("secret_name", "")
    purpose = params.get("purpose", "")
    user_sub = params.get("__user_sub", "")
    conversation_id = params.get("__conversation_id", "")
    request_id = params.get("request_id", "")
    is_auto_approved = params.get("auto_approved", False)

    if not secret_name:
        raise ValueError("secret_name is required")
    if not purpose:
        raise ValueError("purpose is required")
    if not user_sub:
        raise ValueError("User authentication required for vault operations")

    if not VAULT_SECRETS_TABLE:
        raise ValueError("VAULT_SECRETS_TABLE_NAME is not configured")

    # Look up the secret by name
    dynamodb = prm_client("dynamodb")
    response = dynamodb.query(
        TableName=VAULT_SECRETS_TABLE,
        KeyConditionExpression="user_id = :uid",
        FilterExpression="#n = :name",
        ExpressionAttributeNames={"#n": "name"},
        ExpressionAttributeValues={
            ":uid": {"S": user_sub},
            ":name": {"S": secret_name},
        },
    )

    items = response.get("Items", [])
    if not items:
        logger.warning(
            "Vault secret not found",
            secret_name=secret_name,
            user_sub=user_sub[:8] + "...",
        )
        return {"status": "not_found"}

    secret_item = items[0]
    secret_id = secret_item.get("secret_id", {}).get("S", "")
    secret_arn = secret_item.get("secret_arn", {}).get("S", "")
    secret_type = secret_item.get("type", {}).get("S", "custom")
    danger_mode = secret_item.get("danger_mode", {}).get("BOOL", False)

    # Determine approval path
    approved_by = ""
    if danger_mode or is_auto_approved:
        # Auto-approve: danger_mode or global auto-approval
        approved_by = "danger_mode" if danger_mode else "auto"
        logger.info(
            "Vault secret auto-approved",
            secret_name=secret_name,
            approved_by=approved_by,
            user_sub=user_sub[:8] + "...",
        )
    else:
        # Human approval required
        approval_id = _create_approval_request(
            user_sub=user_sub,
            action_key=f"vault:{secret_name}",
            description=f"AI agent requests access to vault secret '{secret_name}'. Purpose: {purpose}",
            props_preview={"secret_name": secret_name, "purpose": purpose},
            approval_id=request_id,
        )

        decision = _poll_approval(approval_id)

        if decision == "denied":
            _write_audit_log(
                user_id=user_sub,
                secret_id=secret_id,
                secret_name=secret_name,
                action="ai_access",
                accessor="workspace-chat",
                purpose=purpose,
                conversation_id=conversation_id,
                approved_by="denied",
            )
            return {"status": "denied"}

        if decision == "timeout":
            return {"status": "timeout"}

        approved_by = "user"

    # Retrieve the secret value from Secrets Manager
    if not secret_arn:
        raise ValueError(f"Secret '{secret_name}' has no Secrets Manager ARN")

    secrets_client = prm_client("secretsmanager")
    try:
        sm_response = secrets_client.get_secret_value(SecretId=secret_arn)
        secret_string = sm_response.get("SecretString", "{}")
        secret_data = json.loads(secret_string)
        fields = secret_data.get("fields", {})
    except Exception as e:
        logger.error(
            "Failed to retrieve vault secret from Secrets Manager",
            secret_name=secret_name,
            error=str(e),
        )
        raise RuntimeError(f"Failed to retrieve secret: {e}") from e

    # Write audit log
    _write_audit_log(
        user_id=user_sub,
        secret_id=secret_id,
        secret_name=secret_name,
        action="ai_access",
        accessor="workspace-chat",
        purpose=purpose,
        conversation_id=conversation_id,
        approved_by=approved_by,
    )

    # Update last_accessed_at
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    dynamodb.update_item(
        TableName=VAULT_SECRETS_TABLE,
        Key={
            "user_id": {"S": user_sub},
            "secret_id": {"S": secret_id},
        },
        UpdateExpression="SET last_accessed_at = :ts",
        ExpressionAttributeValues={":ts": {"S": now_iso}},
    )

    logger.info(
        "Vault secret retrieved for AI",
        secret_name=secret_name,
        secret_type=secret_type,
        approved_by=approved_by,
        user_sub=user_sub[:8] + "...",
    )

    return {
        "status": "success",
        "type": secret_type,
        "fields": fields,
    }
