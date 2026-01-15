"""Persistence helpers for data connector configuration."""

from __future__ import annotations

import json
from typing import Any, Dict

import structlog
from boto3.dynamodb.conditions import Key

from prm import client as prm_client
from prm import resource as prm_resource

logger = structlog.get_logger()


def upsert_secret(secret_name: str, secret_payload: Dict[str, Any]) -> str:
    """Create or update a Secrets Manager entry and return its ARN."""
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


def upsert_connector_record(  # pylint: disable=too-many-arguments,too-many-positional-arguments
    table_name: str,
    user_id: str,
    connector_id: str,
    config: Dict[str, Any],
    secret_arn: str,
    test_result: Dict[str, Any],
) -> Dict[str, Any]:
    """Persist the connector record for a user in DynamoDB."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)

    existing = table.get_item(
        Key={"user_id": user_id, "connector_id": connector_id}
    ).get("Item")
    created_at = existing.get("created_at") if isinstance(existing, dict) else None

    now = test_result.get("tested_at")
    item = {
        "user_id": user_id,
        "connector_id": connector_id,
        "status": "connected",
        "config": config,
        "secret_arn": secret_arn,
        "test_result": test_result,
        "last_tested": now,
        "updated_at": now,
        "created_at": created_at or now,
    }
    table.put_item(Item=item)
    return item


def list_connectors_for_user(table_name: str, user_id: str) -> list[Dict[str, Any]]:
    """Return all connector records associated with the user."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    response = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    return response.get("Items", [])
