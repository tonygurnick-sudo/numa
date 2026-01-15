"""Lambda handlers for data connector endpoints."""

from __future__ import annotations

import base64
import binascii
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import BotoCoreError, ClientError

from connectors import get_connector
from prm import resource as prm_resource
from storage import list_connectors_for_user, upsert_connector_record, upsert_secret

logger = structlog.get_logger()

TABLE_NAME = os.environ.get("DATA_CONNECTORS_TABLE_NAME")
CLIENT_NAME = os.environ.get("CLIENT_NAME")
SECRETS_PREFIX = os.environ.get("DATA_CONNECTORS_SECRETS_PREFIX")
SETTINGS_TABLE_NAME = os.environ.get("DATA_CONNECTORS_SETTINGS_TABLE_NAME")


def _response(status: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """Return a JSON API response with CORS headers."""
    return {
        "statusCode": status,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Content-Type": "application/json",
        },
        "body": json.dumps(body),
    }


def _now_iso() -> str:
    """Return current UTC time as an ISO string."""
    return datetime.now(timezone.utc).isoformat()


def _get_user_id(event: Dict[str, Any]) -> Optional[str]:
    """Extract a user id from the request context or JWT token."""
    auth = event.get("requestContext", {}).get("authorizer", {})
    jwt = auth.get("jwt", {})
    claims = jwt.get("claims", {}) or {}
    if isinstance(claims, dict) and claims.get("sub"):
        return claims.get("sub")

    headers = event.get("headers") or {}
    token = headers.get("authorization") or headers.get("Authorization")
    if not token:
        return None
    try:
        payload = token.split(".")[1]
        decoded = json.loads(base64.b64decode(payload + "===").decode("utf-8"))
        return decoded.get("sub")
    except (
        IndexError,
        ValueError,
        json.JSONDecodeError,
        UnicodeDecodeError,
        binascii.Error,
    ):
        return None


def _get_path(event: Dict[str, Any]) -> str:
    """Return the request path from the event."""
    return event.get("requestContext", {}).get("http", {}).get("path", "")


def _parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    """Parse JSON request body, handling optional base64 encoding."""
    body = event.get("body") or ""
    if not body:
        return {}
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {}


def _handle_status(user_id: str, table_name: str) -> Dict[str, Any]:
    """Return connector status records for the user."""
    items = list_connectors_for_user(table_name, user_id)
    return _response(200, {"items": items})


def _read_connector_settings(connector_id: str) -> Optional[Dict[str, Any]]:
    """Fetch connector settings record when available."""
    if not SETTINGS_TABLE_NAME:
        return None
    try:
        table = prm_resource("dynamodb").Table(SETTINGS_TABLE_NAME)
        return table.get_item(Key={"connector": connector_id}).get("Item") or {}
    except (BotoCoreError, ClientError) as exc:
        logger.warning("Failed to read data connector settings", error=str(exc))
        return None


def _persist_connector(
    connector: Any,
    connector_id: str,
    user_id: str,
    config: Dict[str, Any],
    test_result: Dict[str, Any],
    table_name: str,
    client_name: str,
) -> Dict[str, Any]:
    """Store connector secrets/config and return status payload."""
    tested_at = _now_iso()
    test_result_payload = {
        "success": True,
        "tested_at": tested_at,
        **test_result,
    }
    secret_payload = {
        "connector_id": connector_id,
        "server": config.get("server"),
        "access_token": config.get("access_token"),
    }
    prefix = SECRETS_PREFIX or f"{client_name}/data-connectors"
    secret_name = f"{prefix}/{connector_id}/{user_id}"
    secret_arn = upsert_secret(secret_name, secret_payload)

    sanitized = connector.sanitize_config(config)
    item = upsert_connector_record(
        table_name,
        user_id,
        connector_id,
        sanitized,
        secret_arn,
        test_result_payload,
    )
    return {
        "status": item.get("status"),
        "test_result": test_result_payload,
    }


def _handle_connect(
    event: Dict[str, Any], user_id: str, table_name: str, client_name: str
) -> Dict[str, Any]:
    """Handle a connector test + persist request."""
    body = _parse_body(event)
    connector_id = body.get("connector_id")
    if not connector_id:
        return _response(400, {"error": "connector_id is required"})

    config = body.get("config") or {}
    settings = _read_connector_settings(connector_id)
    if settings and settings.get("status") == "disabled":
        return _response(403, {"error": "Connector disabled by administrator"})

    connector = get_connector(connector_id)
    if not connector:
        return _response(404, {"error": f"Unknown connector: {connector_id}"})

    try:
        test_result = connector.test_connection(config)
    except (ValueError, httpx.HTTPError) as exc:
        logger.warning("Data connector test failed", error=str(exc))
        return _response(400, {"error": str(exc)})

    payload = _persist_connector(
        connector,
        connector_id,
        user_id,
        config,
        test_result,
        table_name,
        client_name,
    )

    return _response(
        200,
        {
            "success": True,
            "connector_id": connector_id,
            **payload,
        },
    )


def handler(event: Dict[str, Any], _: LambdaContext) -> Dict[str, Any]:
    """Handle data connector status and connection requests."""
    method = event.get("requestContext", {}).get("http", {}).get("method")
    path = _get_path(event)

    if method == "OPTIONS":
        return _response(200, {})

    if not TABLE_NAME or not CLIENT_NAME:
        return _response(500, {"error": "Server configuration error"})

    table_name = TABLE_NAME
    client_name = CLIENT_NAME

    user_id = _get_user_id(event)
    if not user_id:
        return _response(401, {"error": "Unauthorized"})

    if method == "GET" and path.endswith("/data-connectors/status"):
        return _handle_status(user_id, table_name)

    if method == "POST" and path.endswith("/data-connectors/connect"):
        return _handle_connect(event, user_id, table_name, client_name)

    return _response(404, {"error": "Not found"})
