# pylint: disable=too-many-arguments,too-many-positional-arguments
"""Persistence helpers for vault secrets."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import uuid4

import structlog
from boto3.dynamodb.conditions import Key

from prm import client as prm_client
from prm import resource as prm_resource

logger = structlog.get_logger()


def _convert_decimals(obj: Any) -> Any:
    """Convert DynamoDB Decimal objects to int/float for JSON serialization."""
    if isinstance(obj, Decimal):
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    if isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_decimals(item) for item in obj]
    return obj


# ---------------------------------------------------------------------------
# Secrets Manager helpers
# ---------------------------------------------------------------------------


def create_secret(secret_name: str, secret_payload: Dict[str, Any]) -> str:
    """Create a Secrets Manager entry and return its ARN."""
    secrets = prm_client("secretsmanager")
    secret_string = json.dumps(secret_payload)

    try:
        response = secrets.create_secret(
            Name=secret_name,
            SecretString=secret_string,
        )
        return response["ARN"]
    except secrets.exceptions.ResourceExistsException:
        response = secrets.put_secret_value(
            SecretId=secret_name,
            SecretString=secret_string,
        )
        return response["ARN"]


def update_secret(secret_arn: str, secret_payload: Dict[str, Any]) -> None:
    """Update an existing Secrets Manager entry."""
    secrets = prm_client("secretsmanager")
    secrets.put_secret_value(
        SecretId=secret_arn,
        SecretString=json.dumps(secret_payload),
    )


def get_secret_value(secret_arn: str) -> Dict[str, Any]:
    """Retrieve and parse a secret value from Secrets Manager."""
    secrets = prm_client("secretsmanager")
    response = secrets.get_secret_value(SecretId=secret_arn)
    secret_string = response.get("SecretString") or "{}"
    return json.loads(secret_string)


def delete_secret_value(secret_arn: str) -> None:
    """Delete a secret from Secrets Manager (immediate, no recovery window)."""
    secrets = prm_client("secretsmanager")
    try:
        secrets.delete_secret(SecretId=secret_arn, ForceDeleteWithoutRecovery=True)
    except secrets.exceptions.ResourceNotFoundException:
        logger.warning(
            "Secret already deleted from Secrets Manager", secret_arn=secret_arn
        )


# ---------------------------------------------------------------------------
# DynamoDB vault secrets table helpers
# ---------------------------------------------------------------------------


def create_vault_record(
    table_name: str,
    user_id: str,
    name: str,
    secret_type: str,
    secret_arn: str,
    category: str = "General",
    description: str = "",
    danger_mode: bool = False,
    favorite: bool = False,
    help_url: str = "",
) -> Dict[str, Any]:
    """Create a new vault secret metadata record in DynamoDB."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    now = datetime.now(timezone.utc).isoformat()
    secret_id = str(uuid4())

    item = {
        "user_id": user_id,
        "secret_id": secret_id,
        "name": name,
        "type": secret_type,
        "category": category,
        "description": description,
        "secret_arn": secret_arn,
        "danger_mode": danger_mode,
        "favorite": favorite,
        "help_url": help_url,
        "created_at": now,
        "updated_at": now,
        "last_accessed_at": now,
    }
    table.put_item(Item=item)
    return item


def get_vault_record(
    table_name: str, user_id: str, secret_id: str
) -> Optional[Dict[str, Any]]:
    """Fetch a single vault secret metadata record."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    response = table.get_item(Key={"user_id": user_id, "secret_id": secret_id})
    item = response.get("Item")
    # Convert Decimal objects to int/float for JSON serialization
    return _convert_decimals(item) if item else None


def list_vault_records(table_name: str, user_id: str) -> List[Dict[str, Any]]:
    """Return all vault secret metadata records for a user (no secret values)."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    response = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    items = response.get("Items", [])
    # Convert Decimal objects to int/float for JSON serialization
    return [_convert_decimals(item) for item in items]


def update_vault_record(
    table_name: str,
    user_id: str,
    secret_id: str,
    updates: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Update metadata fields on a vault record. Returns the updated item."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)

    existing = table.get_item(Key={"user_id": user_id, "secret_id": secret_id}).get(
        "Item"
    )
    if not existing:
        return None

    now = datetime.now(timezone.utc).isoformat()
    allowed_fields = {
        "name",
        "category",
        "description",
        "danger_mode",
        "favorite",
        "secret_arn",
        "help_url",
    }
    for key, value in updates.items():
        if key in allowed_fields:
            existing[key] = value
    existing["updated_at"] = now

    table.put_item(Item=existing)
    # Convert Decimal objects to int/float for JSON serialization
    return _convert_decimals(existing)


def delete_vault_record(table_name: str, user_id: str, secret_id: str) -> None:
    """Delete a vault secret metadata record."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    table.delete_item(Key={"user_id": user_id, "secret_id": secret_id})


def touch_last_accessed(table_name: str, user_id: str, secret_id: str) -> None:
    """Update the last_accessed_at timestamp on a vault record."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    now = datetime.now(timezone.utc).isoformat()
    table.update_item(
        Key={"user_id": user_id, "secret_id": secret_id},
        UpdateExpression="SET last_accessed_at = :now",
        ExpressionAttributeValues={":now": now},
    )


# ---------------------------------------------------------------------------
# DynamoDB vault audit log helpers
# ---------------------------------------------------------------------------


def write_audit_log(
    table_name: str,
    user_id: str,
    secret_id: str,
    secret_name: str,
    action: str,
    accessor: str = "user",
    purpose: str = "",
    conversation_id: str = "",
    approved_by: str = "user",
) -> Dict[str, Any]:
    """Write an audit log entry. TTL = 90 days."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    now = datetime.now(timezone.utc).isoformat()
    audit_id = str(uuid4())
    ttl = int(time.time()) + (90 * 86400)  # 90 days

    item = {
        "user_id": user_id,
        "timestamp_audit_id": f"{now}#{audit_id}",
        "secret_id": secret_id,
        "secret_name": secret_name,
        "action": action,
        "accessor": accessor,
        "purpose": purpose,
        "conversation_id": conversation_id,
        "approved_by": approved_by,
        "created_at": now,
        "ttl": ttl,
    }
    table.put_item(Item=item)
    return item


def list_audit_logs(
    table_name: str, user_id: str, limit: int = 100
) -> List[Dict[str, Any]]:
    """Return recent audit log entries for a user, newest first."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    response = table.query(
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    items = response.get("Items", [])
    # Convert Decimal objects to int/float for JSON serialization
    return [_convert_decimals(item) for item in items]
