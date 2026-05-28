"""
Pipedream API operations for the secure proxy.

Contains all the Pipedream-specific logic ported from existing lambdas.
"""

import base64
import io
import json
import os
import re
import time
import uuid
from email.message import EmailMessage
from typing import Any, Dict, List, Optional, Tuple

import requests
import structlog
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

from prm import client as prm_client

logger = structlog.get_logger()

# Simple in-memory TTL cache for tool lists: key = (external_user_id, app_name)
# value = (tools, expires_epoch)
_TOOL_LIST_CACHE: Dict[Tuple[str, str], Tuple[List[Dict[str, Any]], float]] = {}
_TOOL_LIST_TTL_SECONDS = 600.0  # 10 minutes

# Simple in-memory TTL cache for action schemas: key = action_key
# value = (schema_dict, expires_epoch)
_ACTION_SCHEMA_CACHE: Dict[str, Tuple[Dict[str, Any], float]] = {}
_ACTION_SCHEMA_TTL_SECONDS = 600.0  # 10 minutes

# FEAT-019: in-memory TTL cache for the user-connections list returned by
# Pipedream's `/connect/{project}/accounts` API. Before this cache every
# `get_integration_status` call hit Pipedream's API + paginated, adding
# 1-3s per call (and per cold-start, multi-second). The list changes
# rarely from the user's perspective (only on connect/disconnect), so a
# short TTL with explicit invalidation on `disconnect_integration` covers
# nearly all cases. FE passes `force_refresh: true` after OAuth completes
# to bypass the cache for the immediate after-connect status read.
# Key: external_user_id  Value: (connections, expires_epoch)
_USER_CONNECTIONS_CACHE: Dict[str, Tuple[List[Dict[str, Any]], float]] = {}
_USER_CONNECTIONS_TTL_SECONDS = 300.0  # 5 minutes

# AWS Lambda hard limit for synchronous invoke response payloads.
# Source: error logs show "Exceeded maximum allowed payload size (6291556 bytes)".
LAMBDA_RESPONSE_LIMIT_BYTES = 6_291_556

# Headroom kept free in front of the Lambda limit. The actual response
# envelope is ~200 bytes; 16 KB is a deliberately wide safety belt that
# absorbs any future drift in keys, headers, or wrapper shape.
LAMBDA_RESPONSE_SAFETY_MARGIN_BYTES = 16_384

# Lifetime of presigned GET URLs returned for oversize binary responses.
# Long enough for the workspace agent to fetch immediately + retry once;
# short enough that a leaked URL stops working quickly.
PRESIGNED_URL_EXPIRES_IN_SECONDS = 900  # 15 minutes

# Content-Type → file extension mapping used for the S3 key suffix and
# filename_hint fallback. Not exhaustive — anything missing falls to .bin
# and the workspace agent can rename based on Content-Disposition.
_CONTENT_TYPE_EXTENSIONS: Dict[str, str] = {
    "application/pdf": ".pdf",
    "application/json": ".json",
    "application/xml": ".xml",
    "application/zip": ".zip",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/octet-stream": ".bin",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/tiff": ".tiff",
    "text/plain": ".txt",
    "text/html": ".html",
    "text/csv": ".csv",
    "text/markdown": ".md",
}


def _content_type_to_extension(content_type: str) -> str:
    """Best-effort file extension from a Content-Type header."""
    base = (content_type or "").split(";")[0].strip().lower()
    return _CONTENT_TYPE_EXTENSIONS.get(base, ".bin")


def _extract_filename_from_content_disposition(disposition: str) -> Optional[str]:
    """Extract filename from a Content-Disposition header, or None.

    Uses email.message.EmailMessage which handles RFC 2231/5987 encoded
    filenames correctly (filename*=UTF-8''...).
    """
    if not disposition:
        return None
    try:
        msg = EmailMessage()
        msg["Content-Disposition"] = disposition
        filename = msg.get_filename()
        if isinstance(filename, str) and filename.strip():
            return filename.strip()
    except Exception:
        pass
    return None


def _safe_filename(name: str) -> str:
    """Strip path separators and cap length for use as an S3 key suffix or hint."""
    if not name:
        return ""
    cleaned = name.replace("/", "_").replace("\\", "_").lstrip(".")
    return cleaned[:120]


def _extract_tool_info(tool: Any) -> Dict[str, Any]:
    """Best-effort extraction of human-friendly tool name and description.

    Handles Strands MCPAgentTool wrappers and plain MCP definitions.
    """

    def _get_attr(obj: Any, attr: str) -> Optional[str]:
        try:
            val = getattr(obj, attr, None)
            return val if isinstance(val, str) else None
        except Exception:
            return None

    def _get_nested(obj: Any, path: Tuple[str, str]) -> Optional[str]:
        try:
            parent = getattr(obj, path[0], None)
            if parent is None and isinstance(getattr(obj, "__dict__", None), dict):
                parent = obj.__dict__.get(path[0])
            if parent is None:
                return None
            # attribute or dict
            if isinstance(parent, dict):
                val = parent.get(path[1])
                return val if isinstance(val, str) else None
            return _get_attr(parent, path[1])
        except Exception:
            return None

    # Prefer Strands wrapper -> underlying MCP Tool object
    mcp_tool = getattr(tool, "mcp_tool", None)

    # Name extraction (prefer raw MCP tool name)
    if mcp_tool is not None:
        name_candidates: List[Optional[str]] = [_get_attr(mcp_tool, "name")]
    else:
        name_candidates = [
            _get_attr(tool, "name"),
            _get_attr(tool, "display_name"),
            _get_nested(tool, ("tool", "name")),
            _get_nested(tool, ("definition", "name")),
            _get_nested(tool, ("_tool", "name")),
            _get_nested(tool, ("tool_definition", "name")),
        ]
    name = next((n for n in name_candidates if n), None)
    if not name:
        # Last resort: try common dict access on __dict__
        d = getattr(tool, "__dict__", None)
        if isinstance(d, dict):
            name = d.get("name") or d.get("display_name")
            if not isinstance(name, str):
                name = None

    # Description extraction (prefer raw MCP tool description)
    if mcp_tool is not None:
        desc_candidates: List[Optional[str]] = [_get_attr(mcp_tool, "description")]
    else:
        desc_candidates = [
            _get_attr(tool, "description"),
            _get_nested(tool, ("tool", "description")),
            _get_nested(tool, ("definition", "description")),
            _get_nested(tool, ("_tool", "description")),
            _get_nested(tool, ("tool_definition", "description")),
            _get_attr(tool, "summary"),
            _get_attr(tool, "long_description"),
        ]
    description = next((d for d in desc_candidates if d), None)
    return {"name": name or str(tool), "description": description}


class PipedreamOperations:
    """Handles all Pipedream API operations."""

    def __init__(self) -> None:
        self.secret_arn = os.environ.get("PIPEDREAM_SECRET_ARN")
        if not self.secret_arn:
            raise ValueError("PIPEDREAM_SECRET_ARN environment variable not set")

        self.secrets_client = prm_client("secretsmanager")
        self._credentials: Optional[Dict[str, str]] = None
        self._s3_client: Optional[Any] = None

    def _get_s3_client(self) -> Any:
        """Lazy-init S3 client. Used for oversize binary upload + presigned URL."""
        if self._s3_client is None:
            self._s3_client = prm_client("s3")
        return self._s3_client

    def get_credentials(self) -> Dict[str, str]:
        """Get Pipedream credentials from Secrets Manager."""
        if self._credentials:
            return self._credentials

        try:
            logger.info("Retrieving Pipedream credentials from Secrets Manager")
            response = self.secrets_client.get_secret_value(SecretId=self.secret_arn)
            credentials = json.loads(response["SecretString"])

            if not isinstance(credentials, dict):
                raise ValueError("Credentials must be a JSON object")

            self._credentials = credentials
            logger.info("Successfully retrieved Pipedream credentials")
            return self._credentials

        except Exception as e:
            logger.error(
                "Failed to retrieve Pipedream credentials",
                error=str(e),
                secret_arn=self.secret_arn,
                exc_info=True,
            )
            raise ValueError(
                f"Failed to retrieve Pipedream credentials: {str(e)}"
            ) from e

    def get_access_token(self) -> str:
        """Get OAuth access token for Pipedream API."""
        credentials = self.get_credentials()

        try:
            response = requests.post(
                "https://api.pipedream.com/v1/oauth/token",
                headers={
                    "Content-Type": "application/json",
                    "x-pd-environment": credentials["environment"],
                },
                json={
                    "grant_type": "client_credentials",
                    "client_id": credentials["client_id"],
                    "client_secret": credentials["client_secret"],
                },
                timeout=10,
            )
            response.raise_for_status()
            token_data = response.json()

            logger.debug("Successfully generated Pipedream OAuth access token")
            return token_data["access_token"]

        except Exception as e:
            logger.error("Failed to get Pipedream access token", error=str(e))
            raise Exception(f"Pipedream OAuth error: {str(e)}") from e

    def generate_connect_token(self, external_user_id: str) -> Dict[str, Any]:
        """
        Generate Pipedream connect token for OAuth flow.

        Args:
            external_user_id: The external user ID for Pipedream

        Returns:
            Dict containing connect token data
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()

        try:
            logger.info(
                "Generating Pipedream connect token",
                external_user_id=external_user_id,
                project_id=credentials["project_id"],
            )

            response = requests.post(
                f"https://api.pipedream.com/v1/connect/{credentials['project_id']}/tokens",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                    "x-pd-environment": credentials["environment"],
                },
                json={
                    "external_user_id": external_user_id,
                },
                timeout=10,
            )
            response.raise_for_status()

            token_data = response.json()

            logger.info(
                "Successfully generated Pipedream connect token",
                external_user_id=external_user_id,
                token_length=len(token_data.get("token", "")),
                expires_at=token_data.get("expires_at"),
            )

            return {
                "connectToken": token_data["token"],
                "externalUserId": external_user_id,
                "expiresAt": token_data.get("expires_at"),
                "connectLinkUrl": token_data.get("connect_link_url"),
            }

        except Exception as e:
            logger.error(
                "Failed to generate Pipedream connect token",
                error=str(e),
                external_user_id=external_user_id,
                exc_info=True,
            )
            raise Exception(f"Pipedream connect token error: {str(e)}") from e

    def get_integration_status(
        self, external_user_id: str, force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        Get user's connected integrations status.

        Args:
            external_user_id: The external user ID for Pipedream
            force_refresh: FEAT-019 — when true, bypass the
                `_USER_CONNECTIONS_CACHE` and fetch fresh from Pipedream.
                Used by the FE immediately after a connect / disconnect so
                the just-changed state surfaces without waiting for the TTL.

        Returns:
            Dict containing integration status data
        """
        try:
            # Get user's connected accounts from Pipedream
            pipedream_connections = self._get_user_connections(
                external_user_id, force_refresh=force_refresh
            )

            # Transform to frontend format
            connection_status = self._build_connection_status(pipedream_connections)

            logger.info(
                "Retrieved integration status",
                external_user_id=external_user_id,
                connected_count=len(
                    [c for c in connection_status if c["status"] == "connected"]
                ),
                total_available=len(connection_status),
            )

            return {
                "connections": connection_status,
                "external_user_id": external_user_id,
                "connected_apps": [
                    c["app_name"]
                    for c in connection_status
                    if c["status"] == "connected"
                ],
            }

        except Exception as e:
            logger.error(
                "Failed to get integration status",
                error=str(e),
                external_user_id=external_user_id,
                exc_info=True,
            )
            raise Exception(f"Integration status error: {str(e)}") from e

    def create_mcp_client(self, external_user_id: str, app_name: str) -> Dict[str, Any]:
        """
        Create MCP client connection details.

        Args:
            external_user_id: The external user ID for Pipedream
            app_name: The app name for MCP client

        Returns:
            Dict containing MCP client connection details
        """
        try:
            credentials = self.get_credentials()
            access_token = self.get_access_token()

            # Construct MCP server URL
            base_url = f"https://remote.mcp.pipedream.net/{external_user_id}/{app_name}"

            # Create headers required by Pipedream MCP
            headers = {
                "Authorization": f"Bearer {access_token}",
                "x-pd-project-id": credentials["project_id"],
                "x-pd-environment": credentials["environment"],
                "x-pd-external-user-id": external_user_id,
                "x-pd-app-slug": app_name,
            }

            logger.info(
                "Created MCP client connection details",
                external_user_id=external_user_id,
                app_name=app_name,
                base_url=base_url,
            )

            return {
                "base_url": base_url,
                "headers": headers,
                "app_name": app_name,
                "external_user_id": external_user_id,
            }

        except Exception as e:
            logger.error(
                "Failed to create MCP client",
                error=str(e),
                external_user_id=external_user_id,
                app_name=app_name,
                exc_info=True,
            )
            raise Exception(f"MCP client creation error: {str(e)}") from e

    def disconnect_integration(
        self,
        external_user_id: str,
        app_name: Optional[str] = None,
        account_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Disconnect integration accounts.

        Behavior:
        - If account_id is provided: delete that specific account id
        - Else if app_name is provided: delete ALL accounts for that app for the user

        Returns a result describing what was deleted or why nothing changed.
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()

        headers = {
            "Authorization": f"Bearer {access_token}",
            "x-pd-environment": credentials["environment"],
        }

        base_url = f"https://api.pipedream.com/v1/connect/{credentials['project_id']}"

        def _delete_single_account(acc_id: str) -> int:
            """Attempt to delete a single account. Returns HTTP status code."""
            try:
                resp = requests.delete(
                    f"{base_url}/accounts/{acc_id}", headers=headers, timeout=15
                )
                # Do not raise for status - we interpret 204/404 specially
                return resp.status_code
            except Exception as e:  # network or other errors
                logger.error(
                    "Delete account request failed",
                    error=str(e),
                    account_id=acc_id,
                    external_user_id=external_user_id,
                )
                raise Exception(f"Pipedream delete account error: {str(e)}") from e

        # Case 1: Direct by account_id
        if account_id:
            status = _delete_single_account(account_id)
            if status in (204, 404):
                # 204: deleted now; 404: already gone (idempotent)
                logger.info(
                    "Account disconnect completed",
                    external_user_id=external_user_id,
                    account_id=account_id,
                    status=status,
                )
                # FEAT-019: invalidate the per-user connections cache so the
                # next status read returns fresh data.
                _USER_CONNECTIONS_CACHE.pop(external_user_id, None)
                return {
                    "external_user_id": external_user_id,
                    "account_id": account_id,
                    "disconnected": status == 204,
                    "reason": None if status == 204 else "not_connected",
                }
            # Any other status is considered an error
            logger.error(
                "Account disconnect failed",
                external_user_id=external_user_id,
                account_id=account_id,
                status=status,
            )
            raise Exception(f"Failed to delete account: HTTP {status}")

        # Case 2: By app_name (delete all this user's accounts for the app)
        if app_name:
            # List user accounts and filter by app
            user_connections = self._get_user_connections(external_user_id)
            matching: List[str] = []
            for conn in user_connections:
                if self._get_app_name_from_pipedream(conn) == app_name:
                    conn_id = conn.get("id")
                    if conn_id is not None:
                        matching.append(conn_id)

            if not matching:
                logger.info(
                    "No accounts found for app; already disconnected",
                    external_user_id=external_user_id,
                    app_name=app_name,
                )
                return {
                    "external_user_id": external_user_id,
                    "app_name": app_name,
                    "found_accounts": [],
                    "deleted_account_ids": [],
                    "failed_account_ids": [],
                    "disconnected": False,
                    "reason": "not_connected",
                }

            deleted: List[str] = []
            failed: List[str] = []

            for acc_id in matching:
                status = _delete_single_account(acc_id)
                if status in (204, 404):
                    # Treat 404 as idempotent success for the purposes of removal
                    deleted.append(acc_id)
                else:
                    logger.warning(
                        "Failed to delete account for app",
                        external_user_id=external_user_id,
                        app_name=app_name,
                        account_id=acc_id,
                        status=status,
                    )
                    failed.append(acc_id)

            # If any failed (non-204/404), surface an error to caller
            if failed:
                raise Exception(
                    "One or more accounts failed to delete: " + ",".join(failed)
                )

            logger.info(
                "App disconnect completed",
                external_user_id=external_user_id,
                app_name=app_name,
                deleted_count=len(deleted),
            )
            # FEAT-019: invalidate the per-user connections cache.
            _USER_CONNECTIONS_CACHE.pop(external_user_id, None)
            return {
                "external_user_id": external_user_id,
                "app_name": app_name,
                "found_accounts": matching,
                "deleted_account_ids": deleted,
                "failed_account_ids": [],
                "disconnected": True,
            }

        # Neither account_id nor app_name provided
        raise ValueError("disconnect_integration requires account_id or app_name")

    def list_mcp_tools(
        self, external_user_id: str, app_name: str
    ) -> List[Dict[str, Any]]:
        """List tools exposed by the MCP server for this user + integration.

        Uses Streamable HTTP transport with Pipedream auth headers.
        Results cached briefly to reduce API load.
        """
        cache_key = (external_user_id, app_name)

        cached = _TOOL_LIST_CACHE.get(cache_key)
        now = time.time()
        if cached and cached[1] > now:
            logger.debug(
                "Returning cached MCP tool list",
                external_user_id=external_user_id,
                app_name=app_name,
                count=len(cached[0]),
            )
            return cached[0]

        # Build connection details
        conn = self.create_mcp_client(external_user_id, app_name)
        base_url = conn.get("base_url")
        headers = conn.get("headers", {})
        if not base_url:
            raise ValueError("Missing base_url for MCP server")

        # Create MCP client via Strands wrapper
        def create_transport():
            return streamablehttp_client(base_url, headers=headers)

        client = MCPClient(create_transport)
        tools: List[Dict[str, Any]] = []
        try:
            entered = client.__enter__()  # pylint: disable=unnecessary-dunder-call
            for t in entered.list_tools_sync():
                tools.append(_extract_tool_info(t))
        except Exception as e:
            logger.error(
                "Failed to list MCP tools",
                error=str(e),
                external_user_id=external_user_id,
                app_name=app_name,
                base_url=base_url,
                exc_info=True,
            )
            raise
        finally:
            try:
                client.__exit__(None, None, None)  # type: ignore[arg-type]
            except Exception:
                pass

        # Cache
        _TOOL_LIST_CACHE[cache_key] = (tools, now + _TOOL_LIST_TTL_SECONDS)
        logger.info(
            "Listed MCP tools",
            app_name=app_name,
            external_user_id=external_user_id,
            count=len(tools),
        )
        return tools

    def _get_user_connections(
        self, external_user_id: str, force_refresh: bool = False
    ) -> List[Dict[str, Any]]:
        """Get user's connected accounts from Pipedream API.

        Paginates through results since the API defaults to 10 per page.

        FEAT-019: cached for 5 minutes by `external_user_id`. The list changes
        only on connect/disconnect, both of which we observe in this lambda
        (`disconnect_integration` invalidates explicitly; after-connect status
        reads from the FE pass `force_refresh=True`). When `force_refresh` is
        true the cache is bypassed and the fresh result repopulates it.
        """
        now = time.time()
        if not force_refresh:
            cached = _USER_CONNECTIONS_CACHE.get(external_user_id)
            if cached and cached[1] > now:
                logger.debug(
                    "Returning cached user connections",
                    external_user_id=external_user_id,
                    count=len(cached[0]),
                )
                return cached[0]

        credentials = self.get_credentials()
        access_token = self.get_access_token()
        project_id = credentials["project_id"]
        environment = credentials["environment"]

        all_connections: List[Dict[str, Any]] = []
        after_cursor: Optional[str] = None
        limit = 100

        while True:
            params: Dict[str, Any] = {
                "external_user_id": external_user_id,
                "include_credentials": "false",
                "limit": limit,
            }
            if after_cursor:
                params["after"] = after_cursor

            try:
                response = requests.get(
                    f"https://api.pipedream.com/v1/connect/{project_id}/accounts",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "x-pd-environment": environment,
                    },
                    params=params,
                    timeout=15,
                )
                response.raise_for_status()
                accounts_data = response.json()
            except Exception as e:
                logger.error(
                    "Failed to fetch Pipedream connections",
                    error=str(e),
                    external_user_id=external_user_id,
                )
                raise Exception(
                    f"Failed to fetch connections from Pipedream API: {str(e)}"
                ) from e

            connections = accounts_data.get("data", [])
            all_connections.extend(connections)

            page_info = accounts_data.get("page_info", {})
            if page_info.get("count", 0) < limit:
                break
            after_cursor = page_info.get("end_cursor")
            if not after_cursor:
                break

        logger.debug(
            "Successfully fetched Pipedream connections",
            external_user_id=external_user_id,
            connection_count=len(all_connections),
        )

        # FEAT-019: populate the cache so subsequent calls within the TTL
        # window skip the Pipedream round-trip + pagination.
        _USER_CONNECTIONS_CACHE[external_user_id] = (
            all_connections,
            time.time() + _USER_CONNECTIONS_TTL_SECONDS,
        )

        return all_connections

    def _build_connection_status(
        self, pipedream_connections: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Build connection status from Pipedream API data.

        FEAT-019: returns one row per supported app, but each row now carries
        an `accounts` array listing every connected account for that app
        (previously the tail was discarded by `next(...)`). Legacy fields
        (`pipedream_account_id`, `connection_name`, `connected_at`, `healthy`,
        `dead`) still describe the first account so existing single-account
        callers keep working without code changes.
        """
        # Get supported integrations from environment variable (required)
        env_integrations = os.environ.get("SUPPORTED_INTEGRATIONS")
        if not env_integrations:
            raise ValueError(
                "SUPPORTED_INTEGRATIONS environment variable is required but not set"
            )

        try:
            supported_integrations = json.loads(env_integrations)
        except json.JSONDecodeError as e:
            raise ValueError(
                f"Failed to parse SUPPORTED_INTEGRATIONS as JSON: {str(e)}"
            ) from e

        # Index all connections by app for O(N) total work.
        connections_by_app: Dict[str, List[Dict[str, Any]]] = {}
        for conn in pipedream_connections:
            slug = self._get_app_name_from_pipedream(conn)
            if not slug:
                continue
            connections_by_app.setdefault(slug, []).append(conn)

        connection_status: List[Dict[str, Any]] = []

        for app_name in supported_integrations:
            app_connections = connections_by_app.get(app_name, [])

            if app_connections:
                # Order accounts by creation time (oldest first) so the
                # "primary" / first-listed account is stable across refreshes.
                app_connections.sort(key=lambda c: c.get("created_at") or "")
                accounts = [
                    {
                        "account_id": c.get("id"),
                        "name": c.get("name"),
                        "healthy": c.get("healthy"),
                        "dead": c.get("dead"),
                        "connected_at": c.get("created_at"),
                    }
                    for c in app_connections
                ]
                first = app_connections[0]
                connection_status.append(
                    {
                        "app_name": app_name,
                        "status": "connected",
                        # Legacy single-account fields: describe the first
                        # account. Kept so legacy frontend code paths (and the
                        # admin "connected/disconnected" badge) keep working
                        # unchanged while the new accounts[] is rolled out.
                        "pipedream_account_id": first.get("id"),
                        "last_auth_check": first.get("created_at"),
                        "healthy": first.get("healthy"),
                        "dead": first.get("dead"),
                        "connection_name": first.get("name"),
                        "connected_at": first.get("created_at"),
                        # New: full list. Length 1 for single-account apps;
                        # length >1 only when the admin has enabled multi-
                        # account support for the integration.
                        "accounts": accounts,
                    }
                )
            else:
                connection_status.append(
                    {
                        "app_name": app_name,
                        "status": "not_connected",
                        "pipedream_account_id": None,
                        "last_auth_check": None,
                        "healthy": None,
                        "dead": None,
                        "connection_name": None,
                        "connected_at": None,
                        "accounts": [],
                    }
                )

        return connection_status

    def list_actions(self, app_slug: str) -> List[Dict[str, Any]]:
        """List all available actions for an app from the Pipedream Connect API.

        Paginates through results to get all actions with their configurable_props.

        Args:
            app_slug: The app slug (e.g., "google_drive")

        Returns:
            List of action objects with key, name, description, annotations, and configurable_props
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()
        project_id = credentials["project_id"]
        environment = credentials["environment"]

        all_actions: List[Dict[str, Any]] = []
        after_cursor: Optional[str] = None
        limit = 100

        while True:
            params: Dict[str, Any] = {
                "app": app_slug,
                "component_type": "action",
                "limit": limit,
            }
            if after_cursor:
                params["after"] = after_cursor

            try:
                response = requests.get(
                    f"https://api.pipedream.com/v1/connect/{project_id}/components",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "x-pd-environment": environment,
                    },
                    params=params,
                    timeout=30,
                )
                response.raise_for_status()
                data = response.json()
            except Exception as e:
                logger.error(
                    "Failed to list actions",
                    error=str(e),
                    app_slug=app_slug,
                    exc_info=True,
                )
                raise Exception(
                    f"Failed to list actions for {app_slug}: {str(e)}"
                ) from e

            actions = data.get("data", [])
            all_actions.extend(actions)

            page_info = data.get("page_info", {})
            if page_info.get("count", 0) < limit:
                break
            after_cursor = page_info.get("end_cursor")
            if not after_cursor:
                break

        logger.info(
            "Listed actions",
            app_slug=app_slug,
            count=len(all_actions),
        )
        return all_actions

    def list_triggers(self, app_slug: str) -> List[Dict[str, Any]]:
        """List all available trigger components for an app.

        Mirrors `list_actions` but with `component_type=trigger`. Returns the full
        component metadata including configurable_props so the frontend's dynamic
        prop renderer can render the configuration form without a second call.

        Args:
            app_slug: The Pipedream app slug, e.g. "slack".

        Returns:
            List of component objects (key, name, description, configurable_props,
            annotations, etc.). Filtered down further by the agent-schedules lambda
            against the curated PIPEDREAM_TRIGGER_APPS allowlist.
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()
        project_id = credentials["project_id"]
        environment = credentials["environment"]

        all_triggers: List[Dict[str, Any]] = []
        after_cursor: Optional[str] = None
        limit = 100

        while True:
            params: Dict[str, Any] = {
                "app": app_slug,
                "component_type": "trigger",
                "limit": limit,
            }
            if after_cursor:
                params["after"] = after_cursor

            try:
                response = requests.get(
                    f"https://api.pipedream.com/v1/connect/{project_id}/components",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "x-pd-environment": environment,
                    },
                    params=params,
                    timeout=30,
                )
                response.raise_for_status()
                data = response.json()
            except Exception as e:
                logger.error(
                    "Failed to list triggers",
                    error=str(e),
                    app_slug=app_slug,
                    exc_info=True,
                )
                raise Exception(
                    f"Failed to list triggers for {app_slug}: {str(e)}"
                ) from e

            triggers = data.get("data", [])
            all_triggers.extend(triggers)

            page_info = data.get("page_info", {})
            if page_info.get("count", 0) < limit:
                break
            after_cursor = page_info.get("end_cursor")
            if not after_cursor:
                break

        logger.info(
            "Listed triggers",
            _name="LIST_TRIGGERS",
            app_slug=app_slug,
            count=len(all_triggers),
        )
        return all_triggers

    def deploy_trigger(
        self,
        external_user_id: str,
        component_id: str,
        configured_props: Dict[str, Any],
        webhook_url: str,
    ) -> Dict[str, Any]:
        """Deploy a Pipedream trigger component for an external user.

        The deploy response includes:
          - id (dc_xxx) — the deployed-trigger handle used for update/delete
          - webhook_signing_key (64-char hex) — HMAC key the receiver uses to verify
            inbound deliveries; persisted on the schedule record by the caller
          - configurable_props / configured_props — echo of the deploy config

        IMPORTANT: validation that the (app_slug, component_id) pair is in the
        Numa-curated allowlist happens at the caller (agent-schedules lambda).
        This proxy method assumes inputs are already vetted.

        See: dev-notes/research/integrations/pipedream-docs/connect-api/deploy-trigger.md

        Args:
            external_user_id: The external user ID owning the trigger.
            component_id: The Pipedream component key, e.g. "slack-new-keyword-mention".
            configured_props: User-supplied prop values (channel, keyword, etc.) plus
                the auth prop ({slack: {authProvisionId: "apn_xxx"}}). The caller
                pre-resolves authProvisionId.
            webhook_url: Public HTTPS URL Pipedream will POST events to. Must be
                under our control — the receiver lambda's API Gateway endpoint.

        Returns:
            The full deployed-component object from Pipedream, including
            webhook_signing_key.
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()
        project_id = credentials["project_id"]
        environment = credentials["environment"]

        body: Dict[str, Any] = {
            "id": component_id,
            "external_user_id": external_user_id,
            "configured_props": configured_props,
            "webhook_url": webhook_url,
        }

        try:
            response = requests.post(
                f"https://api.pipedream.com/v1/connect/{project_id}/triggers/deploy",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "x-pd-environment": environment,
                    "Content-Type": "application/json",
                },
                json=body,
                timeout=30,
            )
            response.raise_for_status()
            data = response.json().get("data", {})
        except Exception as e:
            logger.error(
                "Failed to deploy trigger",
                _name="DEPLOY_TRIGGER_FAILED",
                error=str(e),
                component_id=component_id,
                external_user_id=external_user_id,
                exc_info=True,
            )
            raise Exception(f"Failed to deploy trigger {component_id}: {str(e)}") from e

        logger.info(
            "Deployed trigger",
            _name="DEPLOY_TRIGGER",
            component_id=component_id,
            external_user_id=external_user_id,
            deployed_trigger_id=data.get("id"),
            has_signing_key=bool(data.get("webhook_signing_key")),
        )
        return data

    def update_deployed_trigger(
        self,
        external_user_id: str,
        deployed_trigger_id: str,
        configured_props: Optional[Dict[str, Any]] = None,
        active: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Update a deployed trigger in place.

        Pipedream's PUT preserves the deployed_trigger_id and webhook_signing_key
        across updates (verified empirically — see dev-notes/tasks/pipedream-triggers/
        results/key_stability_summary.json). Both prop changes and active=true/false
        flow through this single endpoint.

        IMPORTANT: configured_props is REPLACED, not merged. Callers must send the
        full new configuration each time.

        Args:
            external_user_id: The external user ID owning the trigger.
            deployed_trigger_id: dc_xxx returned at deploy time.
            configured_props: Full replacement props blob, or None to leave unchanged.
            active: True to enable, False to pause, None to leave unchanged.

        Returns:
            The updated deployed-component object. Note: webhook_signing_key is NOT
            included in the response body — it's only returned on initial deploy.
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()
        project_id = credentials["project_id"]
        environment = credentials["environment"]

        body: Dict[str, Any] = {}
        if configured_props is not None:
            body["configured_props"] = configured_props
        if active is not None:
            body["active"] = active

        if not body:
            raise ValueError(
                "update_deployed_trigger requires at least one of "
                "configured_props or active"
            )

        try:
            response = requests.put(
                f"https://api.pipedream.com/v1/connect/{project_id}/deployed-triggers/{deployed_trigger_id}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "x-pd-environment": environment,
                    "Content-Type": "application/json",
                },
                params={"external_user_id": external_user_id},
                json=body,
                timeout=30,
            )
            response.raise_for_status()
            data = response.json().get("data", {})
        except Exception as e:
            logger.error(
                "Failed to update deployed trigger",
                _name="UPDATE_TRIGGER_FAILED",
                error=str(e),
                deployed_trigger_id=deployed_trigger_id,
                external_user_id=external_user_id,
                exc_info=True,
            )
            raise Exception(
                f"Failed to update deployed trigger {deployed_trigger_id}: {str(e)}"
            ) from e

        logger.info(
            "Updated deployed trigger",
            _name="UPDATE_TRIGGER",
            deployed_trigger_id=deployed_trigger_id,
            external_user_id=external_user_id,
            updated_active=active,
            updated_props=configured_props is not None,
        )
        return data

    def delete_deployed_trigger(
        self,
        external_user_id: str,
        deployed_trigger_id: str,
    ) -> Dict[str, Any]:
        """Delete a deployed trigger.

        Pipedream returns 204 No Content on success. We treat 404 as success too —
        the trigger is already gone, which is the desired end state. Any other
        error is propagated.

        Args:
            external_user_id: The external user ID owning the trigger.
            deployed_trigger_id: dc_xxx to remove.

        Returns:
            {"deleted": true, "deployed_trigger_id": "dc_xxx"} on success.
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()
        project_id = credentials["project_id"]
        environment = credentials["environment"]

        try:
            response = requests.delete(
                f"https://api.pipedream.com/v1/connect/{project_id}/deployed-triggers/{deployed_trigger_id}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "x-pd-environment": environment,
                },
                params={"external_user_id": external_user_id},
                timeout=30,
            )
            if response.status_code == 404:
                # Already gone — desired end state. Don't surface as error.
                logger.info(
                    "Delete deployed trigger: already gone (404)",
                    _name="DELETE_TRIGGER_ALREADY_GONE",
                    deployed_trigger_id=deployed_trigger_id,
                    external_user_id=external_user_id,
                )
                return {
                    "deleted": True,
                    "deployed_trigger_id": deployed_trigger_id,
                    "already_gone": True,
                }
            response.raise_for_status()
        except Exception as e:
            logger.error(
                "Failed to delete deployed trigger",
                _name="DELETE_TRIGGER_FAILED",
                error=str(e),
                deployed_trigger_id=deployed_trigger_id,
                external_user_id=external_user_id,
                exc_info=True,
            )
            raise Exception(
                f"Failed to delete deployed trigger {deployed_trigger_id}: {str(e)}"
            ) from e

        logger.info(
            "Deleted deployed trigger",
            _name="DELETE_TRIGGER",
            deployed_trigger_id=deployed_trigger_id,
            external_user_id=external_user_id,
        )
        return {
            "deleted": True,
            "deployed_trigger_id": deployed_trigger_id,
        }

    def list_deployed_triggers(self, external_user_id: str) -> List[Dict[str, Any]]:
        """List all deployed triggers for an external user.

        Used by the daily reconciliation worker to detect orphans (deployed
        triggers in Pipedream with no matching schedule in our DB).

        Args:
            external_user_id: The external user ID to scope the listing.

        Returns:
            List of deployed-component objects.
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()
        project_id = credentials["project_id"]
        environment = credentials["environment"]

        all_triggers: List[Dict[str, Any]] = []
        after_cursor: Optional[str] = None
        limit = 100

        while True:
            params: Dict[str, Any] = {
                "external_user_id": external_user_id,
                "limit": limit,
            }
            if after_cursor:
                params["after"] = after_cursor

            try:
                response = requests.get(
                    f"https://api.pipedream.com/v1/connect/{project_id}/deployed-triggers",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "x-pd-environment": environment,
                    },
                    params=params,
                    timeout=30,
                )
                response.raise_for_status()
                data = response.json()
            except Exception as e:
                logger.error(
                    "Failed to list deployed triggers",
                    _name="LIST_DEPLOYED_TRIGGERS_FAILED",
                    error=str(e),
                    external_user_id=external_user_id,
                    exc_info=True,
                )
                raise Exception(
                    f"Failed to list deployed triggers for {external_user_id}: {str(e)}"
                ) from e

            triggers = data.get("data", [])
            all_triggers.extend(triggers)

            page_info = data.get("page_info", {})
            if page_info.get("count", 0) < limit:
                break
            after_cursor = page_info.get("end_cursor")
            if not after_cursor:
                break

        logger.info(
            "Listed deployed triggers",
            _name="LIST_DEPLOYED_TRIGGERS",
            external_user_id=external_user_id,
            count=len(all_triggers),
        )
        return all_triggers

    def run_action(
        self,
        external_user_id: str,
        action_key: str,
        configured_props: Dict[str, Any],
        stash_id: Optional[str] = None,
        allowed_account_ids: Optional[list[str]] = None,
    ) -> Dict[str, Any]:
        """Execute a Pipedream Connect action.

        Args:
            external_user_id: The external user ID
            action_key: The action key (e.g., "google_drive-find-file")
            configured_props: Props for the action including auth
            stash_id: Optional stash ID for file operations
            allowed_account_ids: FEAT-019 — if provided, restrict authProvisionId
                resolution to this subset of the user's connected accounts.
                Used to honour per-conversation / per-schedule / per-app-run
                account scoping when an admin has enabled multi-account for
                this integration. Empty / None → legacy "first matching" rule.

        Returns:
            Action result with ret, exports, and optional stash data
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()
        project_id = credentials["project_id"]
        environment = credentials["environment"]

        # Auto-inject authProvisionId if set to "auto"
        configured_props = self._inject_auth_provision_id(
            external_user_id,
            action_key,
            configured_props,
            allowed_account_ids=allowed_account_ids,
        )

        body: Dict[str, Any] = {
            "id": action_key,
            "external_user_id": external_user_id,
            "configured_props": configured_props,
        }
        if stash_id:
            body["stash_id"] = stash_id

        try:
            logger.info(
                "Running action",
                action_key=action_key,
                external_user_id=external_user_id,
                has_stash_id=bool(stash_id),
            )

            response = requests.post(
                f"https://api.pipedream.com/v1/connect/{project_id}/actions/run",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                    "x-pd-environment": environment,
                },
                json=body,
                timeout=60,
            )
            response.raise_for_status()
            result = response.json()

            logger.info(
                "Action completed",
                action_key=action_key,
                external_user_id=external_user_id,
                has_ret=bool(result.get("ret")),
                has_exports=bool(result.get("exports")),
            )

            return result

        except Exception as e:
            logger.error(
                "Failed to run action",
                error=str(e),
                action_key=action_key,
                external_user_id=external_user_id,
                exc_info=True,
            )
            raise Exception(f"Failed to run action {action_key}: {str(e)}") from e

    def configure_props(
        self,
        external_user_id: str,
        action_key: str,
        prop_name: str,
        configured_props: Dict[str, Any],
        allowed_account_ids: Optional[list[str]] = None,
    ) -> Dict[str, Any]:
        """Get dynamic dropdown options for an action prop.

        Args:
            external_user_id: The external user ID
            action_key: The action key
            prop_name: The prop to configure (e.g., "drive")
            configured_props: Currently configured props
            allowed_account_ids: FEAT-019 — see run_action.

        Returns:
            Options list for the prop
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()
        project_id = credentials["project_id"]
        environment = credentials["environment"]

        # Auto-inject authProvisionId if set to "auto"
        configured_props = self._inject_auth_provision_id(
            external_user_id,
            action_key,
            configured_props,
            allowed_account_ids=allowed_account_ids,
        )

        body = {
            "id": action_key,
            "external_user_id": external_user_id,
            "prop_name": prop_name,
            "configured_props": configured_props,
        }

        try:
            response = requests.post(
                f"https://api.pipedream.com/v1/connect/{project_id}/components/configure",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                    "x-pd-environment": environment,
                },
                json=body,
                timeout=30,
            )
            response.raise_for_status()
            result = response.json()

            logger.info(
                "Configure props completed",
                action_key=action_key,
                prop_name=prop_name,
                external_user_id=external_user_id,
                options_count=len(result.get("options", [])),
            )

            return result

        except Exception as e:
            logger.error(
                "Failed to configure props",
                error=str(e),
                action_key=action_key,
                prop_name=prop_name,
                exc_info=True,
            )
            raise Exception(
                f"Failed to configure props for {action_key}.{prop_name}: {str(e)}"
            ) from e

    def _build_binary_result(
        self,
        response_content: bytes,
        content_type: str,
        content_disposition: str,
        external_user_id: str,
        request_id: Optional[str],
    ) -> Dict[str, Any]:
        """Build a binary response payload, falling back to S3 when oversized.

        Strategy: encode → measure → decide. The base64 body is built and
        wrapped in the same envelope the lambda will return. If the actual
        serialized size (plus a generous safety margin) fits inside the
        Lambda 6 MB sync invoke limit, the inline payload is returned. If
        not, the raw bytes are uploaded to the configured binary cache
        bucket and a short-lived presigned GET URL replaces the body.

        The two response shapes are intentionally distinguishable so old
        and new consumers can both handle them:
          - inline:   {binary, base64_body, content_type, size, filename_hint}
          - oversize: {binary, binary_storage="s3_presigned", presigned_url,
                       presigned_url_expires_in, content_type, size,
                       filename_hint}

        Old workspace agents that look for `base64_body` will find it on
        small files (today's behavior unchanged) and fall through to the
        existing JSON-save path on large files (URL surfaced to the user).
        """
        size = len(response_content)
        upstream_filename = _extract_filename_from_content_disposition(
            content_disposition
        )
        ext = _content_type_to_extension(content_type)
        filename_hint = _safe_filename(upstream_filename) if upstream_filename else ""

        # Build the inline candidate first so we can measure it precisely.
        b64 = base64.b64encode(response_content).decode()
        inline_result: Dict[str, Any] = {
            "binary": True,
            "base64_body": b64,
            "content_type": content_type,
            "size": size,
        }
        if filename_hint:
            inline_result["filename_hint"] = filename_hint

        # Measure against the actual envelope the lambda returns.
        # See lambda_function.handler: {"statusCode": 200, "body": json.dumps({"success": True, "operation": ..., "data": result})}
        envelope = {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "success": True,
                    "operation": "proxy_request",
                    "data": inline_result,
                }
            ),
        }
        encoded_size = len(json.dumps(envelope))

        if (
            encoded_size + LAMBDA_RESPONSE_SAFETY_MARGIN_BYTES
            < LAMBDA_RESPONSE_LIMIT_BYTES
        ):
            return inline_result

        # Oversize: upload to the binary cache bucket and return a
        # presigned GET URL instead of the inline body.
        bucket = os.environ.get("BINARY_CACHE_BUCKET")
        if not bucket:
            # No bucket configured — surface a clean error rather than
            # letting the runtime 413 the response.
            logger.error(
                "Oversize binary response and no BINARY_CACHE_BUCKET configured",
                size=size,
                content_type=content_type,
            )
            raise Exception(
                f"Upstream binary response is too large to inline "
                f"({size} bytes) and the binary cache bucket is not configured. "
                "Try a smaller file or contact support."
            )

        # Key layout: {tenant}/{request_id}/{uuid}{ext}
        # The tenant prefix from external_user_id (e.g. "tleaft_<sub>") gives
        # us per-tenant scoping for any future bucket-policy work; request_id
        # gives audit traceability; uuid4 prevents accidental collision when
        # request_id is missing.
        tenant_prefix = _safe_filename(external_user_id) or "unknown"
        request_segment = _safe_filename(request_id or "") or "no-request-id"
        object_uuid = uuid.uuid4().hex
        key = f"{tenant_prefix}/{request_segment}/{object_uuid}{ext}"

        s3 = self._get_s3_client()
        extra_args: Dict[str, Any] = {
            "ContentType": content_type or "application/octet-stream",
            "ServerSideEncryption": "AES256",
        }
        if upstream_filename:
            # Suggested filename when the user clicks the presigned URL.
            extra_args["ContentDisposition"] = (
                f'attachment; filename="{_safe_filename(upstream_filename)}"'
            )

        try:
            s3.upload_fileobj(
                io.BytesIO(response_content),
                bucket,
                key,
                ExtraArgs=extra_args,
            )
        except Exception as e:
            logger.error(
                "Failed to upload oversize binary response to cache bucket",
                bucket=bucket,
                key=key,
                size=size,
                error=str(e),
            )
            raise Exception(
                "Failed to stage oversize upstream binary response for download"
            ) from e

        try:
            presigned_url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=PRESIGNED_URL_EXPIRES_IN_SECONDS,
            )
        except Exception as e:
            logger.error(
                "Failed to generate presigned URL for oversize binary",
                bucket=bucket,
                key=key,
                error=str(e),
            )
            raise Exception(
                "Failed to generate download URL for oversize upstream binary"
            ) from e

        # NOTE: log only the bucket key, not the presigned URL. The URL is a
        # bearer token; CloudWatch retains logs for 30 days and that's longer
        # than we want any download credential to live.
        logger.info(
            "Oversize binary response staged to S3",
            bucket=bucket,
            key=key,
            size=size,
            content_type=content_type,
        )

        oversize_result: Dict[str, Any] = {
            "binary": True,
            "binary_storage": "s3_presigned",
            "presigned_url": presigned_url,
            "presigned_url_expires_in": PRESIGNED_URL_EXPIRES_IN_SECONDS,
            "content_type": content_type,
            "size": size,
        }
        if filename_hint:
            oversize_result["filename_hint"] = filename_hint
        return oversize_result

    def proxy_request(
        self,
        external_user_id: str,
        account_id: str,
        method: str,
        upstream_url: str,
        body: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        request_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Make a raw API call through Pipedream's proxy.

        The proxy injects the user's OAuth token automatically.

        Args:
            external_user_id: The external user ID
            account_id: The Pipedream account ID for the connected app
            method: HTTP method (GET, POST, etc.)
            upstream_url: The upstream API URL to call
            body: Optional JSON body for POST/PUT requests
            headers: Optional custom headers (e.g., x-pd-proxy- prefixed)
            request_id: Optional Lambda request ID, used as part of the S3 key
                when an oversize binary response is offloaded to the cache bucket.

        Returns:
            Raw upstream API response. For binary responses that fit within the
            Lambda response payload limit, the body is returned inline as
            base64. Larger binaries are uploaded to the binary cache bucket
            and a short-lived presigned GET URL is returned instead.
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()
        project_id = credentials["project_id"]
        environment = credentials["environment"]

        # Base64 encode the upstream URL (URL-safe, no padding)
        encoded_url = (
            base64.urlsafe_b64encode(upstream_url.encode()).rstrip(b"=").decode()
        )

        try:
            logger.info(
                "Proxy request",
                method=method,
                external_user_id=external_user_id,
                account_id=account_id,
                upstream_url=upstream_url[:100],
            )

            request_headers = {
                "Authorization": f"Bearer {access_token}",
                "x-pd-environment": environment,
            }
            if headers:
                request_headers.update(headers)

            response = requests.request(
                method=method,
                url=f"https://api.pipedream.com/v1/connect/{project_id}/proxy/{encoded_url}",
                headers=request_headers,
                params={
                    "external_user_id": external_user_id,
                    "account_id": account_id,
                },
                json=body,
                timeout=30,
            )

            # Parse response body before checking status so we can
            # surface the upstream API's error message on failure.
            try:
                result = response.json()
            except Exception:
                content_type = response.headers.get("content-type", "")
                if any(
                    t in content_type
                    for t in (
                        "image/",
                        "application/octet",
                        "application/pdf",
                        "force-download",
                    )
                ):
                    result = self._build_binary_result(
                        response_content=response.content,
                        content_type=content_type,
                        content_disposition=response.headers.get(
                            "content-disposition", ""
                        ),
                        external_user_id=external_user_id,
                        request_id=request_id,
                    )
                else:
                    result = {"text": response.text}

            if not response.ok:
                # Extract the most useful error message from the
                # upstream response for surfacing back to the user.
                error_detail = None
                if isinstance(result, dict):
                    error_detail = (
                        result.get("message")
                        or result.get("error")
                        or result.get("msg")
                    )
                if not error_detail:
                    error_detail = (
                        result.get("text", str(result))
                        if isinstance(result, dict)
                        else str(result)
                    )
                logger.error(
                    "Failed proxy request",
                    error=error_detail,
                    status_code=response.status_code,
                    method=method,
                    upstream_url=upstream_url[:100],
                )
                raise Exception(
                    f"Execution failed or timed out for proxy request: "
                    f"{method} {upstream_url} "
                    f"(HTTP {response.status_code}: {error_detail})"
                )

            logger.info(
                "Proxy request completed",
                method=method,
                external_user_id=external_user_id,
                status_code=response.status_code,
            )

            return result

        except requests.exceptions.Timeout:
            logger.error(
                "Proxy request timed out",
                method=method,
                upstream_url=upstream_url[:100],
            )
            raise Exception(
                f"Proxy request timed out after 30s: {method} {upstream_url}"
            )
        except Exception as e:
            if "Execution failed" in str(e) or "timed out" in str(e):
                raise  # Already formatted, don't wrap again
            logger.error(
                "Failed proxy request",
                error=str(e),
                method=method,
                upstream_url=upstream_url[:100],
                exc_info=True,
            )
            raise Exception(f"Proxy request failed: {str(e)}") from e

    def _get_action_schema_cached(self, action_key: str) -> Optional[Dict[str, Any]]:
        """Get action schema from cache or fetch via list_actions.

        Looks up the action schema for the given action_key, using a TTL cache
        to avoid repeated API calls.

        Args:
            action_key: The action key (e.g., "jira-create-issue")

        Returns:
            Action schema dict if found, None otherwise
        """
        cached = _ACTION_SCHEMA_CACHE.get(action_key)
        now = time.time()
        if cached and cached[1] > now:
            return cached[0]

        # Extract app_slug from action_key (e.g., "jira-create-issue" -> "jira")
        # Handle compound slugs like "microsoft_outlook_calendar-list-events"
        parts = action_key.split("-")
        if not parts:
            return None

        # Find the longest matching slug by trying progressively longer prefixes
        # e.g., for "microsoft_outlook_calendar-list-events", try:
        #   "microsoft_outlook_calendar", "microsoft_outlook", "microsoft"
        app_slug = parts[0]
        for i in range(1, len(parts)):
            candidate = "-".join(parts[: i + 1])
            # Slugs use underscores, not hyphens - convert to check
            if "_" in candidate.replace("-", "_"):
                # This might be a compound slug like "microsoft-outlook-calendar"
                # which should be "microsoft_outlook_calendar"
                pass
            else:
                # Reached the action name part
                break
            app_slug = candidate.replace("-", "_")

        # Actually, Pipedream uses underscores in slugs. The action_key format is:
        # "{app_slug}-{action_name}" where app_slug may contain underscores.
        # e.g., "microsoft_outlook_calendar-list-events"
        # So we need to find where the slug ends and action name begins.
        # The reliable way is to try list_actions with the first part.
        app_slug = parts[0]

        try:
            actions = self.list_actions(app_slug)
            for action in actions:
                if action.get("key") == action_key:
                    _ACTION_SCHEMA_CACHE[action_key] = (
                        action,
                        now + _ACTION_SCHEMA_TTL_SECONDS,
                    )
                    return action
        except Exception as e:
            logger.warning(
                "Failed to fetch action schema",
                action_key=action_key,
                app_slug=app_slug,
                error=str(e),
            )
        return None

    def _get_expected_auth_key(self, action_key: str) -> Optional[str]:
        """Get the expected auth prop key name from action schema.

        Different actions may expect different auth key names. For example,
        jira-create-issue expects "app" while jira-get-all-projects expects "jira".
        This method looks up the action schema to find the correct key.

        Args:
            action_key: The action key (e.g., "jira-create-issue")

        Returns:
            Expected auth key name (e.g., "app" or "jira"), or None if not found
        """
        schema = self._get_action_schema_cached(action_key)
        if not schema:
            return None

        for prop in schema.get("configurable_props", []):
            if prop.get("type") == "app":
                return prop.get("name")

        return None

    def _inject_auth_provision_id(
        self,
        external_user_id: str,
        action_key: str,
        configured_props: Dict[str, Any],
        allowed_account_ids: Optional[list[str]] = None,
    ) -> Dict[str, Any]:
        """Replace "auto" authProvisionId with the user's actual account ID.

        Also normalizes the auth key name to match what the action schema expects.
        This handles cases like Jira where some actions use "app" and others use
        "jira" as the auth prop key.

        Args:
            external_user_id: The external user ID
            action_key: The action key (used to derive app slug)
            configured_props: Props that may contain "auto" auth
            allowed_account_ids: FEAT-019 — if provided, narrow the candidate
                account list to this subset before picking the first match.
                When the caller passes an explicit `authProvisionId` (not the
                "auto" sentinel) this list is ignored — the caller has already
                picked. Used by chat / scheduled / app-run paths to honour
                per-context account scoping.

        Returns:
            Updated configured_props with real authProvisionId
        """
        # Make a shallow copy to avoid mutating input
        props = dict(configured_props)

        # Find the auth prop. If "auto", we resolve it below; if explicit
        # `apn_xxx`, we enforce the allow-list against it.
        auth_key = None
        auth_value = None
        explicit_provision_id: Optional[str] = None
        for key, value in list(props.items()):
            if isinstance(value, dict) and "authProvisionId" in value:
                auth_key = key
                auth_value = value
                provision = value.get("authProvisionId")
                if isinstance(provision, str) and provision and provision != "auto":
                    explicit_provision_id = provision
                break

        # FEAT-019: when a chat/schedule/app-run has narrowed the account
        # selection (allowed_account_ids non-empty) and the agent supplies an
        # explicit `apn_xxx` for the auth prop, that id MUST be in the
        # allow-list. Otherwise the agent can bypass the user's per-context
        # account scope just by picking the apn it knows from the prompt.
        # The agent currently sees every available account so it can iterate
        # for "each mailbox" requests; the narrowed-scope block tells it to
        # ignore the others, but enforcement belongs here.
        if (
            explicit_provision_id is not None
            and allowed_account_ids
            and explicit_provision_id not in allowed_account_ids
        ):
            logger.warning(
                "Rejected run_action with disallowed authProvisionId",
                _name="ACCOUNT_SCOPE_VIOLATION",
                external_user_id=external_user_id,
                action_key=action_key,
                requested=explicit_provision_id[:8] + "...",
                allowed=[a[:8] + "..." for a in allowed_account_ids],
            )
            raise ValueError(
                f"Account '{explicit_provision_id}' is not enabled in this "
                f"session. Allowed accounts: {allowed_account_ids}. "
                "Use one of the allowed apn ids, or call the action without "
                'authProvisionId (or with "auto") to let the proxy pick.'
            )

        if auth_key is None or auth_value is None:
            # No auth prop to process
            return props

        # Explicit (non-auto) authProvisionId — already allow-list-checked
        # above; let it pass through unchanged.
        if explicit_provision_id is not None:
            return props

        # Normalize auth key to match schema expectation
        expected_key = self._get_expected_auth_key(action_key)
        if expected_key and expected_key != auth_key:
            logger.info(
                "Normalizing auth key to match schema",
                provided_key=auth_key,
                expected_key=expected_key,
                action_key=action_key,
            )
            # Remove old key and add new one
            del props[auth_key]
            auth_key = expected_key
            props[auth_key] = auth_value

        # Look up user's connected accounts. FEAT-019: filter to the allow-
        # list before picking so single / multi-account selection paths share
        # the same code. The filter applies to the candidate set, not to the
        # connection-listing API call itself, so an empty allow-list = legacy
        # behaviour (all accounts considered).
        all_connections = self._get_user_connections(external_user_id)
        allow_set: Optional[set[str]] = None
        if allowed_account_ids:
            allow_set = {x for x in allowed_account_ids if x}
        if allow_set:
            connections = [c for c in all_connections if c.get("id") in allow_set]
            if not connections:
                # Caller asked for accounts the user no longer has — fall back
                # to the full list rather than failing, so a stale picker
                # doesn't break tool calls.
                logger.warning(
                    "Allow-list excluded every connected account; falling back to full list",
                    _name="ACCOUNT_ALLOWLIST_EMPTY_AFTER_FILTER",
                    requested=list(allow_set),
                    available=[c.get("id") for c in all_connections],
                    external_user_id=external_user_id,
                )
                connections = all_connections
        else:
            connections = all_connections
        account_id = None
        app_slug = None

        # Priority 1: Match via action_key (most specific).
        # Action keys follow the pattern "{app_slug}-{action_name}",
        # e.g., "microsoft_outlook_calendar-list-events".
        # This handles cases where the prop name is ambiguous (e.g.,
        # "microsoftOutlook" is used for both mail and calendar apps).
        if action_key:
            for conn in connections:
                conn_slug = self._get_app_name_from_pipedream(conn)
                if conn_slug and action_key.startswith(conn_slug + "-"):
                    account_id = conn.get("id")
                    app_slug = conn_slug
                    logger.info(
                        "Resolved auth via action_key",
                        prop_key=auth_key,
                        resolved_slug=conn_slug,
                        action_key=action_key,
                        scoped=bool(allow_set),
                    )
                    break

        # Priority 2: Match via prop name (fallback for legacy actions
        # or when action_key doesn't match).
        # Prop keys are camelCase (e.g., "googleDrive" -> "google_drive").
        if not account_id:
            app_slug = self._camel_to_slug(auth_key)
            for conn in connections:
                if self._get_app_name_from_pipedream(conn) == app_slug:
                    account_id = conn.get("id")
                    logger.info(
                        "Resolved auth via prop name",
                        prop_key=auth_key,
                        resolved_slug=app_slug,
                        scoped=bool(allow_set),
                    )
                    break

        if not account_id:
            raise ValueError(
                f"No connected account found for app '{app_slug}' "
                f"(user: {external_user_id})"
            )

        props[auth_key] = {"authProvisionId": account_id}
        logger.info(
            "Injected authProvisionId",
            app_slug=app_slug,
            auth_key=auth_key,
            external_user_id=external_user_id,
            account_id=account_id[:8] + "...",
        )

        return props

    @staticmethod
    def _camel_to_slug(camel: str) -> str:
        """Convert camelCase prop name to snake_case app slug.

        e.g., "googleDrive" -> "google_drive", "slack" -> "slack"
        """
        # Insert underscore before uppercase letters and lowercase everything
        slug = re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", camel).lower()
        return slug

    def _get_app_name_from_pipedream(self, pipedream_account: Dict[str, Any]) -> str:
        """Map Pipedream account app info to our standard app names."""
        return pipedream_account.get("app", {}).get("name_slug", "")
