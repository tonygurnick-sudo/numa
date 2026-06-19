"""Lambda handlers for data connector endpoints."""

from __future__ import annotations

import base64
import binascii
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, Optional


def _json_default(value: Any) -> Any:
    """JSON encoder fallback — DynamoDB returns numeric attrs as Decimal."""
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    raise TypeError(
        f"Object of type {value.__class__.__name__} is not JSON serializable"
    )


import httpx
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import BotoCoreError, ClientError

from connectors import get_connector
from prm import client as prm_client
from prm import resource as prm_resource
from storage import (
    create_sync_config,
    delete_connector_record,
    delete_secret,
    delete_sync_config,
    get_connector_record,
    get_secret_payload,
    list_connectors_for_user,
    list_sync_configs,
    update_connector_expiry,
    update_connector_health,
    update_sync_config,
    upsert_connector_record,
    upsert_secret,
)
from synergy_api import (
    SynergyAuthError,
    get_file_details,
    get_file_history,
    get_file_weblink,
    get_folder_items,
    list_job_folders,
    search_files,
    search_jobs,
)

logger = structlog.get_logger()

TABLE_NAME = os.environ.get("DATA_CONNECTORS_TABLE_NAME")
CLIENT_NAME = os.environ.get("CLIENT_NAME")
SECRETS_PREFIX = os.environ.get("DATA_CONNECTORS_SECRETS_PREFIX")
SETTINGS_TABLE_NAME = os.environ.get("DATA_CONNECTORS_SETTINGS_TABLE_NAME")
SYNC_CONFIGS_TABLE_NAME = os.environ.get("DATA_CONNECTORS_SYNC_CONFIGS_TABLE_NAME")
EVENT_CONFIGS_TABLE_NAME = os.environ.get("CONNECTOR_EVENT_CONFIGS_TABLE_NAME")
# Synergy extraction SQS FIFO queue (empty when the crawler is disabled). The
# on-visit hook enqueues a per-job message; "Sync now" invokes the coordinator.
SYNERGY_EXTRACT_QUEUE_URL = os.environ.get("SYNERGY_EXTRACT_QUEUE_URL", "")
SYNERGY_COORDINATOR_FUNCTION_NAME = os.environ.get(
    "SYNERGY_COORDINATOR_FUNCTION_NAME", ""
)
# Crawl-state table for the on-visit grant rows + sync-config/status routes.
SYNERGY_CRAWL_STATE_TABLE_NAME = os.environ.get("SYNERGY_CRAWL_STATE_TABLE_NAME", "")
SYNERGY_ONVISIT_COOLDOWN_HOURS = float(
    os.environ.get("SYNERGY_ONVISIT_COOLDOWN_HOURS", "6")
)
SYSTEM_KB_IDS = {"company", "numa-support"}

# Synergy PAT rotation config
PAT_TTL_DAYS = 90
PAT_ROTATION_THRESHOLD_DAYS = 30  # Rotate when within this many days of expiry


def _response(
    status: int, body: Dict[str, Any], *, cache_control: Optional[str] = None
) -> Dict[str, Any]:
    """Return a JSON API response with CORS headers."""
    headers: Dict[str, str] = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Content-Type": "application/json",
    }
    if cache_control:
        headers["Cache-Control"] = cache_control
    return {
        "statusCode": status,
        "headers": headers,
        "body": json.dumps(body, default=_json_default),
    }


def _now_iso() -> str:
    """Return current UTC time as an ISO string."""
    return datetime.now(timezone.utc).isoformat()


def _update_connector_expiry(
    table_name: str, user_id: str, pat_expires_at: str
) -> None:
    """Update the PAT expiry on the Synergy connector DynamoDB record."""
    try:
        update_connector_expiry(table_name, user_id, "synergy", pat_expires_at)
    except Exception as exc:
        logger.warning(
            "Failed to update connector expiry in DynamoDB",
            error=str(exc),
            user_id=user_id,
        )


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


def _handle_disconnect(
    user_id: str, connector_id: str, table_name: str
) -> Dict[str, Any]:
    """Delete the user's row for this connector and clean up the secret.

    Idempotent — returns 200 even when there was nothing to delete, so callers
    can fire this unconditionally during the unified disconnect flow without
    branching on whether the user actually had a row.
    """
    removed = delete_connector_record(table_name, user_id, connector_id)
    if removed:
        secret_arn = removed.get("secret_arn")
        if isinstance(secret_arn, str):
            delete_secret(secret_arn)
    return _response(
        200,
        {"success": True, "removed": bool(removed), "connector_id": connector_id},
    )


# ---------------------------------------------------------------------------
# Vault-based credential helpers (mirror of the chat path).
#
# Synergy is configured in two places post-FEAT-143:
#   * Company vault `{CLIENT_NAME}/vault/company` — admin-set `instance_url`
#     under `connector-config-synergy.fields`.
#   * User vault   `{CLIENT_NAME}/vault/users/{user_id}` — per-user PAT
#     under `connector-synergy.fields.access_token`.
# The workspace-chat-tools Lambda reads from there first; we mirror that
# here so the Files surface uses the same source of truth, and so users
# connected via the inline chat widget don't have to also write a legacy
# DynamoDB row to make /files work.
# ---------------------------------------------------------------------------


def _read_vault_secret(secret_id: str) -> Optional[Dict[str, Any]]:
    """Read + JSON-decode a Secrets Manager entry. None on miss or parse error."""
    try:
        sm = prm_client("secretsmanager")
        response = sm.get_secret_value(SecretId=secret_id)
        return json.loads(response.get("SecretString", "{}"))
    except Exception as exc:  # noqa: BLE001 — Secrets Manager raises a hierarchy
        if "ResourceNotFoundException" in str(
            type(exc).__name__
        ) or "ResourceNotFoundException" in str(exc):
            return None
        logger.warning(
            "Failed to read vault secret", secret_id=secret_id, error=str(exc)
        )
        return None


def _get_company_vault_secrets() -> Dict[str, Any]:
    """Return the company vault's `secrets` dict (or empty)."""
    if not CLIENT_NAME:
        return {}
    data = _read_vault_secret(f"{CLIENT_NAME}/vault/company")
    if not isinstance(data, dict):
        return {}
    secrets = data.get("secrets")
    return secrets if isinstance(secrets, dict) else {}


def _get_user_vault(user_id: str) -> Dict[str, Any]:
    """Return the user's consolidated vault payload (or empty)."""
    if not CLIENT_NAME:
        return {}
    data = _read_vault_secret(f"{CLIENT_NAME}/vault/users/{user_id}")
    return data if isinstance(data, dict) else {}


def _get_synergy_admin_instance_url() -> Optional[str]:
    """Return the admin-configured Synergy server URL, or None."""
    company = _get_company_vault_secrets()
    for key in ("connector-config-synergy", "connector-synergy"):
        entry = company.get(key)
        if not entry:
            continue
        fields = entry.get("fields") or entry
        if not isinstance(fields, dict):
            continue
        url = fields.get("instance_url") or fields.get("server")
        if url:
            return str(url).strip()
    return None


def _get_synergy_credentials_from_vault(user_id: str) -> Optional[tuple[str, str]]:
    """Return (server, access_token) sourced from the vault, or None.

    Reads the user vault for the PAT and the company vault for the
    admin-configured instance URL. Legacy fallback: if the user vault
    still carries `instance_url` / `server` (pre-split connect), honour
    it so existing users don't break mid-deploy.
    """
    vault = _get_user_vault(user_id)
    if not vault:
        return None

    admin_server = _get_synergy_admin_instance_url()

    secrets = vault.get("secrets", {}) if isinstance(vault, dict) else {}
    if not isinstance(secrets, dict):
        return None
    for secret_key in ("connector-synergy", "oauth-synergy"):
        entry = secrets.get(secret_key)
        if not entry:
            continue
        fields = entry.get("fields") or entry
        if not isinstance(fields, dict):
            continue
        token = (
            fields.get("access_token")
            or fields.get("api_key")
            or fields.get("bearer_token")
            or fields.get("token")
        )
        server = admin_server or fields.get("instance_url") or fields.get("server")
        if token and server:
            return str(server), str(token)
    return None


def _get_synergy_credentials(table_name: str, user_id: str) -> tuple[str, str] | None:
    """Return Synergy server and access token for the user.

    Tries the vault first (chat-path source of truth), then falls back to
    the legacy DynamoDB record. The legacy path performs an inline PAT
    rotation check; the vault path doesn't need to since vault PATs are
    managed by the inline chat widget.
    """
    vault_creds = _get_synergy_credentials_from_vault(user_id)
    if vault_creds:
        return vault_creds

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

    # Check if PAT needs rotation
    pat_expires_at = secret.get("pat_expires_at")
    now = datetime.now(timezone.utc)

    # Backfill: existing connections without expiry tracking — set to now
    # to force immediate rotation attempt on next use
    if not pat_expires_at:
        pat_expires_at = now.isoformat()
        logger.info(
            "Backfilling missing pat_expires_at to force rotation",
            _name="PAT_ROTATION",
            user_id=user_id,
        )

    try:
        expiry = datetime.fromisoformat(pat_expires_at)
        days_remaining = (expiry - now).days
        if days_remaining <= PAT_ROTATION_THRESHOLD_DAYS:
            logger.info(
                "Synergy PAT approaching expiry, attempting rotation",
                _name="PAT_ROTATION",
                days_remaining=days_remaining,
                user_id=user_id,
            )
            result = _rotate_synergy_pat(server, token, secret, table_name, user_id)
            if result:
                token = result[0]
    except (ValueError, TypeError) as exc:
        logger.warning(
            "Failed to parse PAT expiry", _name="PAT_ROTATION", error=str(exc)
        )

    return server, token


def _rotate_synergy_pat(
    server: str,
    current_token: str,
    secret: Dict[str, Any],
    table_name: str,
    user_id: str,
) -> Optional[tuple[str, str]]:
    """Generate a new Synergy PAT and update storage.

    Returns (new_token, new_expires_at_iso) or None on failure.
    """
    from connectors.synergy import _build_base_url, _normalize_token

    try:
        base_url = _build_base_url(server)
        auth_header = _normalize_token(current_token)
        response = httpx.post(
            f"{base_url}/api/v1/auth/generate-pat",
            headers={
                "Authorization": auth_header,
                "Content-Type": "application/json",
            },
            json={
                "ClientId": "numa",
                "Name": "numa-auto-rotation",
                "ExpireInDays": PAT_TTL_DAYS,
            },
            timeout=30,
        )
        if response.status_code >= 400:
            logger.warning(
                "PAT rotation API call failed",
                _name="PAT_ROTATION",
                status=response.status_code,
                body=response.text[:200],
            )
            return None

        data = response.json()
        new_token = data.get("Token") or data.get("token")
        if not new_token:
            logger.warning("PAT rotation response missing token", _name="PAT_ROTATION")
            return None

        # Build history entry for old token
        now = datetime.now(timezone.utc)
        pat_history = secret.get("pat_history") or []
        pat_history.append(
            {
                "token_prefix": current_token[:12] + "...",
                "created_at": secret.get("pat_created_at"),
                "expires_at": secret.get("pat_expires_at"),
                "replaced_at": now.isoformat(),
                "reason": "auto_rotation",
            }
        )
        pat_history = pat_history[-50:]  # Cap to prevent unbounded growth

        # Update secret with new token — use secret name (not ARN) because
        # upsert_secret tries create_secret(Name=...) first, which requires a
        # valid name, not an ARN.
        new_expires_at = now + timedelta(days=PAT_TTL_DAYS)
        expires_at_iso = new_expires_at.isoformat()
        updated_secret = {
            **secret,
            "access_token": new_token,
            "pat_created_at": now.isoformat(),
            "pat_expires_at": expires_at_iso,
            "pat_ttl_days": PAT_TTL_DAYS,
            "pat_history": pat_history,
        }
        prefix = SECRETS_PREFIX or f"{CLIENT_NAME}/data-connectors"
        secret_name = f"{prefix}/synergy/{user_id}"
        upsert_secret(secret_name, updated_secret)

        # Update DynamoDB expiry for quick querying
        _update_connector_expiry(table_name, user_id, expires_at_iso)

        logger.info(
            "Synergy PAT rotated successfully",
            _name="PAT_ROTATION",
            user_id=user_id,
            new_expires_at=expires_at_iso,
            history_count=len(pat_history),
        )
        return new_token, expires_at_iso

    except Exception as exc:
        logger.warning(
            "PAT rotation failed",
            _name="PAT_ROTATION",
            error=str(exc),
            user_id=user_id,
        )
        return None


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

    # For Synergy, track PAT expiry and maintain token history
    if connector_id == "synergy":
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=PAT_TTL_DAYS)
        secret_payload["pat_created_at"] = now.isoformat()
        secret_payload["pat_expires_at"] = expires_at.isoformat()
        secret_payload["pat_ttl_days"] = PAT_TTL_DAYS

        # Preserve history from previous secret if it exists
        try:
            old_secret = get_secret_payload(secret_name)
            pat_history = old_secret.get("pat_history") or []
            old_token = old_secret.get("access_token")
            if old_token and old_token != config.get("access_token"):
                pat_history.append(
                    {
                        "token_prefix": old_token[:12] + "...",
                        "created_at": old_secret.get("pat_created_at"),
                        "expires_at": old_secret.get("pat_expires_at"),
                        "replaced_at": now.isoformat(),
                    }
                )
            secret_payload["pat_history"] = pat_history[-50:]
        except Exception:
            secret_payload["pat_history"] = []

    secret_arn = upsert_secret(secret_name, secret_payload)

    sanitized = connector.sanitize_config(config)

    # Include pat_expires_at in DynamoDB for quick querying
    extra_fields = {}
    if connector_id == "synergy" and secret_payload.get("pat_expires_at"):
        extra_fields["pat_expires_at"] = secret_payload["pat_expires_at"]

    item = upsert_connector_record(
        table_name,
        user_id,
        connector_id,
        sanitized,
        secret_arn,
        test_result_payload,
        extra_fields=extra_fields,
    )
    return {
        "status": item.get("status"),
        "test_result": test_result_payload,
    }


def _handle_connect(
    event: Dict[str, Any], user_id: str, table_name: str, client_name: str
) -> Dict[str, Any]:
    """Handle a connector test + persist request.

    When ``skip_test`` is truthy in the request body the connection test and
    secret storage are skipped — only the connector record is persisted with
    status ``configured``.  This is used by the Synergy wizard which stores
    only a server URL (per-user credentials are set later in Files).
    """
    body = _parse_body(event)
    connector_id = body.get("connector_id")
    if not connector_id:
        return _response(400, {"error": "connector_id is required"})

    config = body.get("config") or {}
    skip_test = body.get("skip_test", False)
    settings = _read_connector_settings(connector_id)
    if settings and settings.get("status") == "disabled":
        return _response(403, {"error": "Connector disabled by administrator"})

    connector = get_connector(connector_id)
    if not connector:
        return _response(404, {"error": f"Unknown connector: {connector_id}"})

    if skip_test:
        # Persist config-only record without testing or storing secrets
        sanitized = connector.sanitize_config(config)
        now = _now_iso()
        item = upsert_connector_record(
            table_name,
            user_id,
            connector_id,
            sanitized,
            "",  # no secret ARN
            {"success": True, "tested_at": now, "skipped": True},
        )
        return _response(
            200,
            {
                "success": True,
                "connector_id": connector_id,
                "status": item.get("status"),
            },
        )

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


def _synergy_auth_error_response(
    table_name: str, user_id: str, exc: SynergyAuthError
) -> Dict[str, Any]:
    """Persist auth_error health and return a structured 401 response."""
    update_connector_health(table_name, user_id, "synergy", "auth_error", str(exc))
    return _response(
        401,
        {
            "error": "Synergy access token expired or invalid. Please reconnect.",
            "error_code": "auth_error",
        },
    )


def _synergy_auth_retry(
    table_name: str, user_id: str, server: str, token: str
) -> Optional[str]:
    """Attempt PAT rotation after an auth error. Returns new token or None."""
    secret_arn = (get_connector_record(table_name, user_id, "synergy") or {}).get(
        "secret_arn"
    )
    if not secret_arn:
        return None
    secret = get_secret_payload(secret_arn)
    result = _rotate_synergy_pat(server, token, secret, table_name, user_id)
    return result[0] if result else None


def _synergy_read(
    table_name: str,
    user_id: str,
    fn: Any,
    *args: Any,
    cache_control: str = "private, max-age=120",
) -> Dict[str, Any]:
    """Run a Synergy read `fn(server, token, *args)` with the standard PAT
    auth-retry wrapper. DRYs the credential + rotate-on-401 + health-update
    boilerplate for the file read-parity routes (search/details/history/weblink).
    """
    creds = _get_synergy_credentials(table_name, user_id)
    if not creds:
        return _response(400, {"error": "Synergy 12d connector not configured."})
    server, token = creds
    try:
        payload = fn(server, token, *args)
    except SynergyAuthError as exc:
        new_token = _synergy_auth_retry(table_name, user_id, server, token)
        if not new_token:
            return _synergy_auth_error_response(table_name, user_id, exc)
        try:
            payload = fn(server, new_token, *args)
        except (ValueError, httpx.HTTPError, SynergyAuthError):
            return _synergy_auth_error_response(table_name, user_id, exc)
    except (ValueError, httpx.HTTPError) as exc:
        logger.warning(
            "Synergy read failed",
            error=str(exc),
            fn=getattr(fn, "__name__", "?"),
        )
        return _response(400, {"error": str(exc)})
    update_connector_health(table_name, user_id, "synergy", "connected")
    return _response(200, payload, cache_control=cache_control)


def _handle_synergy_jobs(
    event: Dict[str, Any], user_id: str, table_name: str
) -> Dict[str, Any]:
    """Return top-level Synergy jobs for the user."""
    creds = _get_synergy_credentials(table_name, user_id)
    if not creds:
        return _response(400, {"error": "Synergy 12d connector not configured."})
    server, token = creds
    params = event.get("queryStringParameters") or {}
    name = params.get("name") or params.get("q") or ""
    page = int(params.get("page") or 1)
    page_size = int(params.get("page_size") or 50)
    try:
        payload = search_jobs(server, token, name, page, page_size)
    except SynergyAuthError as exc:
        new_token = _synergy_auth_retry(table_name, user_id, server, token)
        if new_token:
            try:
                payload = search_jobs(server, new_token, name, page, page_size)
            except (ValueError, httpx.HTTPError, SynergyAuthError):
                return _synergy_auth_error_response(table_name, user_id, exc)
        else:
            return _synergy_auth_error_response(table_name, user_id, exc)
    except (ValueError, httpx.HTTPError) as exc:
        logger.warning("Synergy job search failed", error=str(exc))
        return _response(400, {"error": str(exc)})
    # Clear any stale error state on success
    update_connector_health(table_name, user_id, "synergy", "connected")
    return _response(200, payload, cache_control="private, max-age=300")


def _handle_synergy_job_folders(
    event: Dict[str, Any], job_id: str, user_id: str, table_name: str
) -> Dict[str, Any]:
    """Return top-level folders for a Synergy job, paginated."""
    creds = _get_synergy_credentials(table_name, user_id)
    if not creds:
        return _response(400, {"error": "Synergy 12d connector not configured."})
    server, token = creds
    params = event.get("queryStringParameters") or {}
    page = int(params.get("page") or 1)
    page_size = int(params.get("page_size") or 50)
    try:
        payload = list_job_folders(
            server, token, job_id, page=page, page_size=page_size
        )
    except SynergyAuthError as exc:
        new_token = _synergy_auth_retry(table_name, user_id, server, token)
        if new_token:
            try:
                payload = list_job_folders(
                    server, new_token, job_id, page=page, page_size=page_size
                )
            except (ValueError, httpx.HTTPError, SynergyAuthError):
                return _synergy_auth_error_response(table_name, user_id, exc)
        else:
            return _synergy_auth_error_response(table_name, user_id, exc)
    except (ValueError, httpx.HTTPError) as exc:
        logger.warning("Synergy job folders failed", error=str(exc))
        return _response(400, {"error": str(exc)})
    update_connector_health(table_name, user_id, "synergy", "connected")
    # On-visit incremental KB sync: the user just proved (with their own PAT)
    # they can see this job — grant + opportunistically refresh its index.
    _sneaky_synergy_sync(user_id, job_id, server)
    return _response(200, payload, cache_control="private, max-age=300")


def _handle_synergy_folder_items(
    event: Dict[str, Any], folder_id: str, user_id: str, table_name: str
) -> Dict[str, Any]:
    """Return subfolders and files for a Synergy folder, paginated."""
    creds = _get_synergy_credentials(table_name, user_id)
    if not creds:
        return _response(400, {"error": "Synergy 12d connector not configured."})
    server, token = creds
    params = event.get("queryStringParameters") or {}
    page = int(params.get("page") or 1)
    page_size = int(params.get("page_size") or 50)
    try:
        payload = get_folder_items(
            server, token, folder_id, page=page, page_size=page_size
        )
    except SynergyAuthError as exc:
        new_token = _synergy_auth_retry(table_name, user_id, server, token)
        if new_token:
            try:
                payload = get_folder_items(
                    server, new_token, folder_id, page=page, page_size=page_size
                )
            except (ValueError, httpx.HTTPError, SynergyAuthError):
                return _synergy_auth_error_response(table_name, user_id, exc)
        else:
            return _synergy_auth_error_response(table_name, user_id, exc)
    except (ValueError, httpx.HTTPError) as exc:
        logger.warning("Synergy folder items failed", error=str(exc))
        return _response(400, {"error": str(exc)})
    update_connector_health(table_name, user_id, "synergy", "connected")
    return _response(200, payload, cache_control="private, max-age=300")


def _is_admin(event: Dict[str, Any]) -> bool:
    """Check if the caller belongs to the admin Cognito group.

    Handles both the JWT-authorizer claim shape and the Lambda-authorizer
    serialized-JWT shape (same pattern as vault-secrets).
    """
    auth = event.get("requestContext", {}).get("authorizer", {})

    claims = auth.get("jwt", {}).get("claims", {}) or {}
    groups = claims.get("cognito:groups", "")

    if not groups:
        lambda_ctx = auth.get("lambda", {})
        jwt_str = lambda_ctx.get("jwt", "")
        if jwt_str and isinstance(jwt_str, str):
            try:
                jwt_obj = json.loads(jwt_str)
                groups = jwt_obj.get("claims", {}).get("cognito:groups", "")
            except (json.JSONDecodeError, AttributeError):
                pass

    if isinstance(groups, str):
        groups = [g.strip() for g in groups.split(",") if g.strip()]
    if isinstance(groups, list):
        return "admin" in groups
    return False


def _synergy_crawl_state_table():
    return prm_resource("dynamodb").Table(SYNERGY_CRAWL_STATE_TABLE_NAME)


def _synergy_crawl_enabled() -> bool:
    """The admin opt-in gate (CONFIG#crawl.enabled). Default OFF — NO crawl
    activity of any kind (scheduled, manual, or on-visit) happens until an admin
    ticks the box in the connector settings, because indexing is a billable
    operation. The scheduled coordinator enforces the same flag server-side."""
    if not SYNERGY_CRAWL_STATE_TABLE_NAME:
        return False
    try:
        row = (
            _synergy_crawl_state_table().get_item(
                Key={"pk": "CONFIG#crawl", "sk": "META"}
            )
        ).get("Item") or {}
        return bool(row.get("enabled"))
    except Exception as exc:  # noqa: BLE001 — fail closed
        logger.warning("synergy_crawl_enabled_check_failed", error=str(exc))
        return False


def _sneaky_synergy_sync(user_id: str, job_id: str, server: str) -> None:
    """Opportunistic on-visit sync of the Synergy job a user is browsing.

    Best-effort and additive: (a) grant the visiting user on the job's
    ``allowed_users`` (their own PAT just proved they can see it); (b) async-
    invoke the crawl worker for the job — always when the grant is NEW (so the
    sidecar restamp makes content retrievable immediately), otherwise throttled
    by ``last_enumerated_at`` cooldown. Never raises into the browse path.
    """
    if not (SYNERGY_CRAWL_STATE_TABLE_NAME and SYNERGY_EXTRACT_QUEUE_URL):
        return
    # Admin opt-in gate — no crawl/grant activity until indexing is enabled.
    if not _synergy_crawl_enabled():
        return
    try:
        table = _synergy_crawl_state_table()
        key = {"pk": f"JOB#{job_id}", "sk": "META"}

        granted = False
        try:
            table.update_item(
                Key=key,
                UpdateExpression=(
                    "ADD allowed_users :u "
                    "SET acl_rev = if_not_exists(acl_rev, :z) + :one, job_id = :jid"
                ),
                ConditionExpression=(
                    "attribute_not_exists(allowed_users) OR NOT contains(allowed_users, :uid)"
                ),
                ExpressionAttributeValues={
                    ":u": {user_id},
                    ":uid": user_id,
                    ":z": 0,
                    ":one": 1,
                    ":jid": job_id,
                },
            )
            granted = True
        except table.meta.client.exceptions.ConditionalCheckFailedException:
            pass  # already granted

        if not granted:
            # No ACL change — honour the cooldown before re-crawling.
            row = (table.get_item(Key=key)).get("Item") or {}
            last = str(row.get("last_enumerated_at") or "")
            if last:
                try:
                    elapsed_h = (
                        datetime.now(timezone.utc) - datetime.fromisoformat(last)
                    ).total_seconds() / 3600
                    if elapsed_h < SYNERGY_ONVISIT_COOLDOWN_HOURS:
                        return
                except ValueError:
                    pass

        table.update_item(
            Key=key,
            UpdateExpression="SET last_enumerated_at = :t",
            ExpressionAttributeValues={":t": datetime.now(timezone.utc).isoformat()},
        )
        # Enqueue onto the single extraction queue. run_id="adhoc" → the worker
        # refreshes the job but skips the run-completion counter + credit debit
        # (this is an incremental single-job refresh, not a counted crawl run).
        # Per-job dedup id collapses rapid repeat visits within the FIFO window.
        prm_client("sqs").send_message(
            QueueUrl=SYNERGY_EXTRACT_QUEUE_URL,
            MessageBody=json.dumps(
                {
                    "job_id": job_id,
                    "run_id": "adhoc",
                    "user_sub": user_id,
                    "secret_id": f"{CLIENT_NAME}/vault/users/{user_id}",
                    "instance_url": server,
                    "cursor": None,
                }
            ),
            MessageGroupId=job_id,
            MessageDeduplicationId=f"adhoc:{job_id}",
        )
        logger.info(
            "synergy_onvisit_sync",
            _name="SYNERGY_ONVISIT",
            job_id=job_id,
            new_grant=granted,
        )
    except Exception as exc:  # noqa: BLE001 — never break the browse path
        logger.warning("synergy_onvisit_sync_failed", job_id=job_id, error=str(exc))


def _handle_synergy_sync_config_get(event: Dict[str, Any]) -> Dict[str, Any]:
    """Return the admin crawl config (admin-only)."""
    if not SYNERGY_CRAWL_STATE_TABLE_NAME:
        return _response(400, {"error": "Synergy cross-job search is not enabled."})
    if not _is_admin(event):
        return _response(403, {"error": "Admin access required"})
    row = (
        _synergy_crawl_state_table().get_item(Key={"pk": "CONFIG#crawl", "sk": "META"})
    ).get("Item") or {}
    return _response(
        200,
        {
            "enabled": bool(row.get("enabled")),
            "frequency_hours": int(row.get("frequency_hours") or 24),
            "credential_user_sub": str(row.get("credential_user_sub") or ""),
            "updated_at": str(row.get("updated_at") or ""),
            "updated_by": str(row.get("updated_by") or ""),
        },
    )


def _handle_synergy_sync_config_put(
    event: Dict[str, Any], user_id: str
) -> Dict[str, Any]:
    """Update the admin crawl config (admin-only)."""
    if not SYNERGY_CRAWL_STATE_TABLE_NAME:
        return _response(400, {"error": "Synergy cross-job search is not enabled."})
    if not _is_admin(event):
        return _response(403, {"error": "Admin access required"})

    raw = event.get("body") or "{}"
    try:
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        body = json.loads(raw) or {}
    except (ValueError, binascii.Error):
        return _response(400, {"error": "Invalid JSON body"})

    enabled = bool(body.get("enabled"))
    try:
        frequency_hours = int(body.get("frequency_hours") or 24)
    except (TypeError, ValueError):
        return _response(400, {"error": "frequency_hours must be a number"})
    if not 1 <= frequency_hours <= 168:
        return _response(400, {"error": "frequency_hours must be between 1 and 168"})

    # The scheduled pass runs under this credential where possible (per-job
    # fallbacks cover the rest). "use_my_credential" pins it to the caller.
    item_updates: Dict[str, Any] = {
        ":e": enabled,
        ":f": frequency_hours,
        ":by": user_id,
        ":t": datetime.now(timezone.utc).isoformat(),
    }
    update_expr = (
        "SET enabled = :e, frequency_hours = :f, updated_by = :by, updated_at = :t"
    )
    if body.get("use_my_credential"):
        update_expr += ", credential_user_sub = :cred"
        item_updates[":cred"] = user_id

    _synergy_crawl_state_table().update_item(
        Key={"pk": "CONFIG#crawl", "sk": "META"},
        UpdateExpression=update_expr,
        ExpressionAttributeValues=item_updates,
    )
    logger.info(
        "synergy_sync_config_updated",
        _name="SYNERGY_SYNC_CONFIG",
        enabled=enabled,
        frequency_hours=frequency_hours,
        updated_by=user_id[:8] + "...",
    )
    return _handle_synergy_sync_config_get(event)


def _handle_synergy_sync_status(event: Dict[str, Any]) -> Dict[str, Any]:
    """Return the latest crawl run's status + progress (admin-only)."""
    if not SYNERGY_CRAWL_STATE_TABLE_NAME:
        return _response(400, {"error": "Synergy cross-job search is not enabled."})
    if not _is_admin(event):
        return _response(403, {"error": "Admin access required"})

    table = _synergy_crawl_state_table()
    config = (table.get_item(Key={"pk": "CONFIG#crawl", "sk": "META"})).get(
        "Item"
    ) or {}
    last_run_id = str(config.get("last_run_id") or "")
    if not last_run_id:
        return _response(200, {"last_run": None})

    run = (table.get_item(Key={"pk": f"RUN#{last_run_id}", "sk": "META"})).get(
        "Item"
    ) or {}

    def _count(status: str) -> int:
        total = 0
        kwargs: Dict[str, Any] = {
            "IndexName": "run-status-index",
            "KeyConditionExpression": "run_id = :r AND #s = :st",
            # The RUN# row itself carries run_id + status and lands in this
            # index — exclude it or jobs_done reads "13 of 12" after completion.
            "FilterExpression": "begins_with(pk, :job)",
            "ExpressionAttributeNames": {"#s": "status"},
            "ExpressionAttributeValues": {
                ":r": last_run_id,
                ":st": status,
                ":job": "JOB#",
            },
            "Select": "COUNT",
        }
        while True:
            resp = table.query(**kwargs)
            total += int(resp.get("Count") or 0)
            last_key = resp.get("LastEvaluatedKey")
            if not last_key:
                return total
            kwargs["ExclusiveStartKey"] = last_key

    pending = _count("pending")
    done = _count("done")
    return _response(
        200,
        {
            "last_run": {
                "run_id": last_run_id,
                "status": str(run.get("status") or "unknown"),
                "trigger": str(run.get("trigger") or ""),
                "started_at": str(run.get("started_at") or ""),
                "job_count": int(run.get("job_count") or 0),
                "jobs_pending": pending,
                "jobs_done": done,
            }
        },
    )


def _handle_synergy_sync_now(
    event: Dict[str, Any], user_id: str, table_name: str
) -> Dict[str, Any]:
    """Kick off a Synergy → Bedrock KB crawl for the calling user (manual sync).

    Invokes the coordinator, which enumerates the caller's jobs and enqueues them
    onto the single extraction queue. Runs as the caller's OWN PAT: only the vault
    ``secret_id`` (never the token) is passed, so the coordinator/worker read the
    PAT from Secrets Manager under their own role and it never lands in any event
    payload. Every job this crawl indexes is granted to the user's
    ``allowed_users`` precisely because it was enumerated with the user's
    credential — access mirrors the user's Synergy permissions by construction.
    """
    del table_name  # crawl reads creds from the vault, not the connector table
    if not SYNERGY_COORDINATOR_FUNCTION_NAME:
        return _response(
            400,
            {"error": "Synergy cross-job search is not enabled for this workspace."},
        )
    # Admin opt-in gate — indexing is billable; an admin must enable it first.
    if not _synergy_crawl_enabled():
        return _response(
            400,
            {
                "error": "Synergy indexing is turned off. An admin must enable it in "
                "the connector settings before syncing (it incurs credit usage)."
            },
        )

    # Require a vault-sourced PAT (the worker reads the same vault path) — this
    # also confirms the user has actually connected Synergy.
    creds = _get_synergy_credentials_from_vault(user_id)
    if not creds:
        return _response(
            400,
            {
                "error": "Connect Synergy (add your personal access token) before syncing."
            },
        )
    instance_url, _token = creds

    body: Dict[str, Any] = {}
    raw = event.get("body")
    if raw:
        try:
            if event.get("isBase64Encoded"):
                raw = base64.b64decode(raw).decode("utf-8")
            body = json.loads(raw) or {}
        except (ValueError, binascii.Error):
            body = {}
    scope = body.get("scope") if isinstance(body.get("scope"), dict) else {}

    run_id = f"sync-{uuid.uuid4().hex[:16]}"
    coord_input = {
        "run_id": run_id,
        "user_sub": user_id,
        "secret_id": f"{CLIENT_NAME}/vault/users/{user_id}",
        "instance_url": instance_url,
        "scope": scope,
        "trigger": "manual",
    }
    try:
        # Async — the coordinator enumerates + enqueues (up to 900s); the API
        # returns immediately. The worker drains the queue.
        prm_client("lambda").invoke(
            FunctionName=SYNERGY_COORDINATOR_FUNCTION_NAME,
            InvocationType="Event",
            Payload=json.dumps(coord_input).encode("utf-8"),
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("synergy_sync_now_failed", user_id=user_id, error=str(exc))
        return _response(500, {"error": "Failed to start Synergy sync."})

    logger.info(
        "synergy_sync_now_started",
        _name="SYNERGY_SYNC_NOW",
        run_id=run_id,
        user_id=user_id,
    )
    return _response(202, {"status": "started", "run_id": run_id})


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


# ---------------------------------------------------------------------------
# Gmail routes
# ---------------------------------------------------------------------------


def _get_gmail_credentials(table_name: str, user_id: str) -> tuple[str, str] | None:
    """Return Gmail email and access token for the user."""
    record = get_connector_record(table_name, user_id, "gmail")
    if not record or record.get("status") != "connected":
        return None
    secret_arn = record.get("secret_arn")
    if not secret_arn:
        return None
    secret = get_secret_payload(secret_arn)
    token = secret.get("access_token")
    if not token:
        return None
    email = secret.get("email") or (record.get("config") or {}).get("email", "")
    return email, token


def _handle_gmail_labels(user_id: str, table_name: str) -> Dict[str, Any]:
    """List Gmail labels for the user."""
    creds = _get_gmail_credentials(table_name, user_id)
    if not creds:
        return _response(400, {"error": "Gmail connector not configured."})
    _email, token = creds
    try:
        resp = httpx.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/labels",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        if resp.status_code >= 400:
            return _response(resp.status_code, {"error": resp.text[:300]})
        data = resp.json()
        return _response(200, {"labels": data.get("labels", [])})
    except httpx.HTTPError as exc:
        logger.warning("Gmail labels request failed", error=str(exc))
        return _response(400, {"error": str(exc)})


def _handle_gmail_messages(
    event: Dict[str, Any], user_id: str, table_name: str
) -> Dict[str, Any]:
    """List/search Gmail messages for the user."""
    creds = _get_gmail_credentials(table_name, user_id)
    if not creds:
        return _response(400, {"error": "Gmail connector not configured."})
    _email, token = creds
    params = event.get("queryStringParameters") or {}
    query = params.get("q", "")
    max_results = params.get("maxResults", "20")
    page_token = params.get("pageToken", "")
    try:
        api_params: Dict[str, str] = {"maxResults": max_results}
        if query:
            api_params["q"] = query
        if page_token:
            api_params["pageToken"] = page_token
        resp = httpx.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            headers={"Authorization": f"Bearer {token}"},
            params=api_params,
            timeout=30,
        )
        if resp.status_code >= 400:
            return _response(resp.status_code, {"error": resp.text[:300]})
        data = resp.json()
        return _response(200, data)
    except httpx.HTTPError as exc:
        logger.warning("Gmail messages request failed", error=str(exc))
        return _response(400, {"error": str(exc)})


def _handle_gmail_send(
    event: Dict[str, Any], user_id: str, table_name: str
) -> Dict[str, Any]:
    """Send an email via Gmail."""
    creds = _get_gmail_credentials(table_name, user_id)
    if not creds:
        return _response(400, {"error": "Gmail connector not configured."})
    _email, token = creds
    body = _parse_body(event)
    raw_message = body.get("raw")
    if not raw_message:
        return _response(
            400, {"error": "raw (base64url-encoded RFC 2822 message) is required"}
        )
    try:
        resp = httpx.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={"raw": raw_message},
            timeout=30,
        )
        if resp.status_code >= 400:
            return _response(resp.status_code, {"error": resp.text[:300]})
        return _response(200, resp.json())
    except httpx.HTTPError as exc:
        logger.warning("Gmail send failed", error=str(exc))
        return _response(400, {"error": str(exc)})


# ---------------------------------------------------------------------------
# Synergy PAT management routes
# ---------------------------------------------------------------------------


def _handle_pat_status(user_id: str, table_name: str) -> Dict[str, Any]:
    """Return PAT expiry status for the user's Synergy connector."""
    record = get_connector_record(table_name, user_id, "synergy")
    if not record or record.get("status") not in ("connected", "auth_error"):
        return _response(404, {"error": "Synergy connector not configured."})

    secret_arn = record.get("secret_arn")
    if not secret_arn:
        return _response(404, {"error": "No credentials stored."})

    secret = get_secret_payload(secret_arn)
    now = datetime.now(timezone.utc)

    pat_created_at = secret.get("pat_created_at")
    pat_expires_at = secret.get("pat_expires_at")
    pat_ttl_days = secret.get("pat_ttl_days", PAT_TTL_DAYS)
    pat_history = secret.get("pat_history") or []

    days_remaining = None
    status = "unknown"
    if pat_expires_at:
        try:
            expiry = datetime.fromisoformat(pat_expires_at)
            days_remaining = (expiry - now).days
            if days_remaining <= 0:
                status = "expired"
            elif days_remaining <= 7:
                status = "critical"
            elif days_remaining <= PAT_ROTATION_THRESHOLD_DAYS:
                status = "warning"
            else:
                status = "healthy"
        except (ValueError, TypeError):
            pass

    return _response(
        200,
        {
            "pat_created_at": pat_created_at,
            "pat_expires_at": pat_expires_at,
            "pat_ttl_days": pat_ttl_days,
            "days_remaining": days_remaining,
            "status": status,
            "rotation_threshold_days": PAT_ROTATION_THRESHOLD_DAYS,
            "history_count": len(pat_history),
            "history": [
                {k: v for k, v in entry.items() if k != "token_prefix"}
                for entry in pat_history[
                    -10:
                ]  # Last 10 entries, no token prefixes to frontend
            ],
        },
    )


def _handle_pat_rotate(user_id: str, table_name: str) -> Dict[str, Any]:
    """Manually trigger PAT rotation for the user's Synergy connector."""
    record = get_connector_record(table_name, user_id, "synergy")
    if not record or record.get("status") not in ("connected", "auth_error"):
        return _response(404, {"error": "Synergy connector not configured."})

    secret_arn = record.get("secret_arn")
    if not secret_arn:
        return _response(404, {"error": "No credentials stored."})

    secret = get_secret_payload(secret_arn)
    server = secret.get("server") or (record.get("config") or {}).get("server")
    token = secret.get("access_token")
    if not server or not token:
        return _response(400, {"error": "Missing server or token in credentials."})

    result = _rotate_synergy_pat(server, token, secret, table_name, user_id)
    if not result:
        return _response(500, {"error": "PAT rotation failed. Check logs for details."})

    _, new_expires_at = result
    return _response(
        200,
        {
            "success": True,
            "message": "PAT rotated successfully.",
            "pat_expires_at": new_expires_at,
        },
    )


# ---------------------------------------------------------------------------
# Event config routes
# ---------------------------------------------------------------------------

# Default event types per connector (matches frontend registry)
_DEFAULT_EVENT_TYPES: Dict[str, list[Dict[str, Any]]] = {
    "gmail": [
        {"event_type": "new_email", "enabled": True, "tags": ["email", "incoming"]},
        {"event_type": "email_read", "enabled": False, "tags": ["email", "status"]},
        {
            "event_type": "label_changed",
            "enabled": False,
            "tags": ["email", "organization"],
        },
        {"event_type": "email_sent", "enabled": True, "tags": ["email", "outgoing"]},
    ],
}


def _handle_event_configs_list(
    connector_id: str,
) -> Dict[str, Any]:
    """List event configs for a connector, merging DB overrides with defaults."""
    if not EVENT_CONFIGS_TABLE_NAME:
        defaults = _DEFAULT_EVENT_TYPES.get(connector_id, [])
        return _response(200, {"items": defaults})

    try:
        table = prm_resource("dynamodb").Table(EVENT_CONFIGS_TABLE_NAME)
        result = table.query(
            KeyConditionExpression="connector_id = :cid",
            ExpressionAttributeValues={":cid": connector_id},
        )
        db_items = {item["event_type"]: item for item in (result.get("Items") or [])}
    except (BotoCoreError, ClientError) as exc:
        logger.warning("Failed to read event configs", error=str(exc))
        db_items = {}

    defaults = _DEFAULT_EVENT_TYPES.get(connector_id, [])
    merged = []
    for d in defaults:
        et = d["event_type"]
        if et in db_items:
            merged.append({**d, **db_items[et]})
        else:
            merged.append(d)
    return _response(200, {"items": merged})


def _handle_event_config_update(
    event: Dict[str, Any], connector_id: str, event_type: str
) -> Dict[str, Any]:
    """Update enabled state and tags for a specific event type."""
    if not EVENT_CONFIGS_TABLE_NAME:
        return _response(500, {"error": "Event config table not configured"})

    body = _parse_body(event)
    enabled = body.get("enabled")
    tags = body.get("tags")

    try:
        table = prm_resource("dynamodb").Table(EVENT_CONFIGS_TABLE_NAME)
        item: Dict[str, Any] = {
            "connector_id": connector_id,
            "event_type": event_type,
            "updated_at": _now_iso(),
        }
        if enabled is not None:
            item["enabled"] = bool(enabled)
        if tags is not None:
            item["tags"] = tags
        table.put_item(Item=item)
        return _response(200, {"item": item})
    except (BotoCoreError, ClientError) as exc:
        logger.warning("Failed to update event config", error=str(exc))
        return _response(500, {"error": str(exc)})


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

    # Per-user disconnect: DELETE /api/data-connectors/{connector_id}.
    # The trailing segment is the connector_id (no further subpath). We have
    # to guard against the other /data-connectors/{x}/{y} DELETE paths
    # (sync-configs etc.) by requiring exactly one segment after the prefix.
    if method == "DELETE" and "/data-connectors/" in path:
        parts = [p for p in path.strip("/").split("/") if p]
        try:
            anchor = parts.index("data-connectors")
        except ValueError:
            anchor = -1
        # Exactly one segment after `data-connectors` means
        # /data-connectors/{connector_id}. Two-or-more segments belong to
        # subroutes (sync-configs, event-configs, etc.) handled below.
        if anchor >= 0 and len(parts) == anchor + 2:
            connector_id = parts[-1]
            # Don't shadow reserved keywords like "status" / "connect" — those
            # don't take DELETE here, and a /data-connectors/status DELETE
            # would be a programming error not a real disconnect intent.
            if connector_id in {"status", "connect", "sync-configs"}:
                return _response(405, {"error": "Method not allowed"})
            return _handle_disconnect(user_id, connector_id, table_name)

    if method == "GET" and path.endswith("/data-connectors/synergy/pat-status"):
        return _handle_pat_status(user_id, table_name)

    if method == "POST" and path.endswith("/data-connectors/synergy/rotate-pat"):
        return _handle_pat_rotate(user_id, table_name)

    if method == "POST" and path.endswith("/data-connectors/synergy/sync-now"):
        return _handle_synergy_sync_now(event, user_id, table_name)

    if method == "GET" and path.endswith("/data-connectors/synergy/sync-config"):
        return _handle_synergy_sync_config_get(event)

    if method == "PUT" and path.endswith("/data-connectors/synergy/sync-config"):
        return _handle_synergy_sync_config_put(event, user_id)

    if method == "GET" and path.endswith("/data-connectors/synergy/sync-status"):
        return _handle_synergy_sync_status(event)

    if method == "GET" and path.endswith("/data-connectors/synergy/jobs"):
        return _handle_synergy_jobs(event, user_id, table_name)

    if (
        method == "GET"
        and "/data-connectors/synergy/jobs/" in path
        and path.endswith("/folders")
    ):
        job_id = path.strip("/").split("/")[-2]
        return _handle_synergy_job_folders(event, job_id, user_id, table_name)

    if (
        method == "GET"
        and "/data-connectors/synergy/folders/" in path
        and path.endswith("/items")
    ):
        folder_id = path.strip("/").split("/")[-2]
        return _handle_synergy_folder_items(event, folder_id, user_id, table_name)

    # Synergy file read parity: search / history / weblink / details.
    # Order matters — match the specific suffixes before the bare /files/{id}.
    if method == "GET" and path.endswith("/data-connectors/synergy/files/search"):
        p = event.get("queryStringParameters") or {}
        query = p.get("q") or p.get("file_name") or ""
        # File search is job-scoped (no global search): require a job to search in.
        job_id = p.get("job_id") or p.get("limit_id") or ""
        if not job_id:
            return _response(
                400,
                {
                    "error": "A job scope is required. Synergy has no global file "
                    "search — open a job and search within it.",
                    "error_code": "job_scope_required",
                },
            )
        return _synergy_read(
            table_name,
            user_id,
            search_files,
            query,
            job_id,
            int(p.get("page_size") or 50),
        )

    if (
        method == "GET"
        and "/data-connectors/synergy/files/" in path
        and path.endswith("/history")
    ):
        p = event.get("queryStringParameters") or {}
        file_id = path.strip("/").split("/")[-2]
        return _synergy_read(
            table_name,
            user_id,
            get_file_history,
            file_id,
            int(p.get("page") or 1),
            int(p.get("page_size") or 50),
        )

    if (
        method == "GET"
        and "/data-connectors/synergy/files/" in path
        and path.endswith("/weblink")
    ):
        file_id = path.strip("/").split("/")[-2]
        return _synergy_read(table_name, user_id, get_file_weblink, file_id)

    if method == "GET" and "/data-connectors/synergy/files/" in path:
        # Bare /files/{id} → details. One segment after "files".
        parts = path.strip("/").split("/")
        if parts[-2] == "files":
            return _synergy_read(table_name, user_id, get_file_details, parts[-1])

    # Gmail routes
    if method == "GET" and path.endswith("/data-connectors/gmail/labels"):
        return _handle_gmail_labels(user_id, table_name)

    if method == "GET" and path.endswith("/data-connectors/gmail/messages"):
        return _handle_gmail_messages(event, user_id, table_name)

    if method == "POST" and path.endswith("/data-connectors/gmail/send"):
        return _handle_gmail_send(event, user_id, table_name)

    # Event config routes
    if (
        method == "GET"
        and "/data-connectors/" in path
        and path.endswith("/event-configs")
    ):
        parts = path.strip("/").split("/")
        connector_id_from_path = parts[-2]
        return _handle_event_configs_list(connector_id_from_path)

    if method == "PUT" and "/data-connectors/" in path and "/event-configs/" in path:
        parts = path.strip("/").split("/")
        event_type_from_path = parts[-1]
        connector_id_from_path = parts[-3]
        return _handle_event_config_update(
            event, connector_id_from_path, event_type_from_path
        )

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
