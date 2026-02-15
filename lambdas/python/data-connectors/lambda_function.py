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
from storage import (
    create_sync_config,
    delete_sync_config,
    get_connector_record,
    get_secret_payload,
    list_connectors_for_user,
    list_sync_configs,
    update_sync_config,
    upsert_connector_record,
    upsert_secret,
)
from synergy_api import get_folder_items, list_job_folders, search_jobs

logger = structlog.get_logger()

TABLE_NAME = os.environ.get("DATA_CONNECTORS_TABLE_NAME")
CLIENT_NAME = os.environ.get("CLIENT_NAME")
SECRETS_PREFIX = os.environ.get("DATA_CONNECTORS_SECRETS_PREFIX")
SETTINGS_TABLE_NAME = os.environ.get("DATA_CONNECTORS_SETTINGS_TABLE_NAME")
SYNC_CONFIGS_TABLE_NAME = os.environ.get("DATA_CONNECTORS_SYNC_CONFIGS_TABLE_NAME")
SYSTEM_KB_IDS = {"company", "numa-support"}


def _response(status: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """Return a JSON API response with CORS headers."""
    return {
        "statusCode": status,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
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


def _validate_target_kb_id(target_kb_id: Any) -> Optional[str]:
    """Reject system-managed KB IDs as connector targets."""
    normalized = str(target_kb_id).strip() if target_kb_id is not None else ""
    if not normalized:
        return "target_kb_id is required"
    if normalized in SYSTEM_KB_IDS:
        return f"target_kb_id '{normalized}' is read-only and cannot be used for data connectors"
    return None


def _handle_status(user_id: str, table_name: str) -> Dict[str, Any]:
    """Return connector status records for the user."""
    items = list_connectors_for_user(table_name, user_id)
    return _response(200, {"items": items})


def _get_synergy_credentials(table_name: str, user_id: str) -> tuple[str, str] | None:
    """Return Synergy server and access token for the user."""
    record = get_connector_record(table_name, user_id, "synergy")
    if not record or record.get("status") != "connected":
        return None
    secret_arn = record.get("secret_arn")
    if not secret_arn:
        return None
    secret = get_secret_payload(secret_arn)
    server = secret.get("server") or (record.get("config") or {}).get("server")
    token = secret.get("access_token")
    if not server or not token:
        return None
    return server, token


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


def _handle_synergy_jobs(
    event: Dict[str, Any], user_id: str, table_name: str
) -> Dict[str, Any]:
    """Return top-level Synergy jobs for the user."""
    creds = _get_synergy_credentials(table_name, user_id)
    if not creds:
        return _response(400, {"error": "Synergy connector not configured."})
    server, token = creds
    params = event.get("queryStringParameters") or {}
    name = params.get("name") or params.get("q") or ""
    page = int(params.get("page") or 1)
    page_size = int(params.get("page_size") or 50)
    try:
        payload = search_jobs(server, token, name, page, page_size)
    except (ValueError, httpx.HTTPError) as exc:
        logger.warning("Synergy job search failed", error=str(exc))
        return _response(400, {"error": str(exc)})
    return _response(200, payload)


def _handle_synergy_job_folders(
    job_id: str, user_id: str, table_name: str
) -> Dict[str, Any]:
    """Return top-level folders for a Synergy job."""
    creds = _get_synergy_credentials(table_name, user_id)
    if not creds:
        return _response(400, {"error": "Synergy connector not configured."})
    server, token = creds
    try:
        items = list_job_folders(server, token, job_id)
    except (ValueError, httpx.HTTPError) as exc:
        logger.warning("Synergy job folders failed", error=str(exc))
        return _response(400, {"error": str(exc)})
    return _response(200, {"items": items})


def _handle_synergy_folder_items(
    folder_id: str, user_id: str, table_name: str
) -> Dict[str, Any]:
    """Return subfolders for a Synergy folder."""
    creds = _get_synergy_credentials(table_name, user_id)
    if not creds:
        return _response(400, {"error": "Synergy connector not configured."})
    server, token = creds
    try:
        payload = get_folder_items(server, token, folder_id)
    except (ValueError, httpx.HTTPError) as exc:
        logger.warning("Synergy folder items failed", error=str(exc))
        return _response(400, {"error": str(exc)})
    return _response(200, payload)


def _handle_sync_configs_list(user_id: str, table_name: str) -> Dict[str, Any]:
    """Return sync selection configs for the user."""
    items = list_sync_configs(table_name, user_id)
    return _response(200, {"items": items})


def _handle_sync_configs_create(
    event: Dict[str, Any], user_id: str, table_name: str
) -> Dict[str, Any]:
    """Create a sync selection config."""
    body = _parse_body(event)
    job_id = body.get("synergy_job_id")
    job_name = body.get("synergy_job_name")
    target_kb_id = body.get("target_kb_id")
    if not job_id or not job_name or not target_kb_id:
        return _response(
            400,
            {"error": "synergy_job_id, synergy_job_name, target_kb_id are required"},
        )
    kb_validation_error = _validate_target_kb_id(target_kb_id)
    if kb_validation_error:
        return _response(403, {"error": kb_validation_error})
    selected_folders = body.get("selected_folders") or []
    skip_unsupported_files = bool(body.get("skip_unsupported_files"))
    include_all_folders = bool(body.get("include_all_folders"))
    item = create_sync_config(
        table_name,
        user_id,
        job_id,
        job_name,
        target_kb_id,
        selected_folders,
        skip_unsupported_files,
        include_all_folders,
    )
    return _response(200, {"item": item})


def _handle_sync_configs_update(
    event: Dict[str, Any], user_id: str, table_name: str, sync_config_id: str
) -> Dict[str, Any]:
    """Update a sync selection config."""
    body = _parse_body(event)
    job_id = body.get("synergy_job_id")
    job_name = body.get("synergy_job_name")
    target_kb_id = body.get("target_kb_id")
    if not job_id or not job_name or not target_kb_id:
        return _response(
            400,
            {"error": "synergy_job_id, synergy_job_name, target_kb_id are required"},
        )
    kb_validation_error = _validate_target_kb_id(target_kb_id)
    if kb_validation_error:
        return _response(403, {"error": kb_validation_error})
    selected_folders = body.get("selected_folders") or []
    skip_unsupported_files = bool(body.get("skip_unsupported_files"))
    include_all_folders = bool(body.get("include_all_folders"))
    item = update_sync_config(
        table_name,
        user_id,
        sync_config_id,
        job_id,
        job_name,
        target_kb_id,
        selected_folders,
        skip_unsupported_files,
        include_all_folders,
    )
    return _response(200, {"item": item})


def _handle_sync_configs_delete(
    user_id: str, table_name: str, sync_config_id: str
) -> Dict[str, Any]:
    """Delete a sync selection config."""
    delete_sync_config(table_name, user_id, sync_config_id)
    return _response(200, {"success": True})


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

    if method == "GET" and path.endswith("/data-connectors/synergy/jobs"):
        return _handle_synergy_jobs(event, user_id, table_name)

    if (
        method == "GET"
        and "/data-connectors/synergy/jobs/" in path
        and path.endswith("/folders")
    ):
        job_id = path.strip("/").split("/")[-2]
        return _handle_synergy_job_folders(job_id, user_id, table_name)

    if (
        method == "GET"
        and "/data-connectors/synergy/folders/" in path
        and path.endswith("/items")
    ):
        folder_id = path.strip("/").split("/")[-2]
        return _handle_synergy_folder_items(folder_id, user_id, table_name)

    if not SYNC_CONFIGS_TABLE_NAME:
        return _response(500, {"error": "Server configuration error"})

    sync_table = SYNC_CONFIGS_TABLE_NAME

    if method == "GET" and path.endswith("/data-connectors/sync-configs"):
        return _handle_sync_configs_list(user_id, sync_table)

    if method == "POST" and path.endswith("/data-connectors/sync-configs"):
        return _handle_sync_configs_create(event, user_id, sync_table)

    if method == "PUT" and "/data-connectors/sync-configs/" in path:
        sync_config_id = path.strip("/").split("/")[-1]
        return _handle_sync_configs_update(event, user_id, sync_table, sync_config_id)

    if method == "DELETE" and "/data-connectors/sync-configs/" in path:
        sync_config_id = path.strip("/").split("/")[-1]
        return _handle_sync_configs_delete(user_id, sync_table, sync_config_id)

    return _response(404, {"error": "Not found"})
