"""Persistence helpers for data connector configuration."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4

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


def get_connector_record(
    table_name: str, user_id: str, connector_id: str
) -> Optional[Dict[str, Any]]:
    """Fetch a connector record for a user."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    response = table.get_item(Key={"user_id": user_id, "connector_id": connector_id})
    return response.get("Item")


def get_secret_payload(secret_arn: str) -> Dict[str, Any]:
    """Return a parsed Secrets Manager payload."""
    secrets = prm_client("secretsmanager")
    response = secrets.get_secret_value(SecretId=secret_arn)
    secret_string = response.get("SecretString") or "{}"
    return json.loads(secret_string)


def list_sync_configs(table_name: str, user_id: str) -> list[Dict[str, Any]]:
    """Return all sync selection configs for the user."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    response = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    return response.get("Items", [])


def create_sync_config(  # pylint: disable=too-many-arguments
    table_name: str,
    user_id: str,
    job_id: str,
    job_name: str,
    target_kb_id: str,
    selected_folders: list[str],
    skip_unsupported_files: bool,
    include_all_folders: bool,
) -> Dict[str, Any]:
    """Create a sync selection config."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    now = datetime.now(timezone.utc).isoformat()
    sync_config_id = str(uuid4())
    item = {
        "user_id": user_id,
        "sync_config_id": sync_config_id,
        "synergy_job_id": job_id,
        "synergy_job_name": job_name,
        "target_kb_id": target_kb_id,
        "selected_folders": selected_folders,
        "skip_unsupported_files": skip_unsupported_files,
        "include_all_folders": include_all_folders,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    table.put_item(Item=item)
    return item


def update_sync_config(  # pylint: disable=too-many-arguments
    table_name: str,
    user_id: str,
    sync_config_id: str,
    job_id: str,
    job_name: str,
    target_kb_id: str,
    selected_folders: list[str],
    skip_unsupported_files: bool,
    include_all_folders: bool,
) -> Dict[str, Any]:
    """Update a sync selection config."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    existing = table.get_item(
        Key={"user_id": user_id, "sync_config_id": sync_config_id}
    ).get("Item")
    created_at = existing.get("created_at") if isinstance(existing, dict) else None
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "user_id": user_id,
        "sync_config_id": sync_config_id,
        "synergy_job_id": job_id,
        "synergy_job_name": job_name,
        "target_kb_id": target_kb_id,
        "selected_folders": selected_folders,
        "skip_unsupported_files": skip_unsupported_files,
        "include_all_folders": include_all_folders,
        "status": "active",
        "created_at": created_at or now,
        "updated_at": now,
    }
    table.put_item(Item=item)
    return item


def delete_sync_config(table_name: str, user_id: str, sync_config_id: str) -> None:
    """Delete a sync selection config."""
    dynamodb = prm_resource("dynamodb")
    table = dynamodb.Table(table_name)
    table.delete_item(Key={"user_id": user_id, "sync_config_id": sync_config_id})
