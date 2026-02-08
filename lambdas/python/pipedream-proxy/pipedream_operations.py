"""
Pipedream API operations for the secure proxy.

Contains all the Pipedream-specific logic ported from existing lambdas.
"""

import base64
import json
import os
import re
import time
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

    def get_integration_status(self, external_user_id: str) -> Dict[str, Any]:
        """
        Get user's connected integrations status.

        Args:
            external_user_id: The external user ID for Pipedream

        Returns:
            Dict containing integration status data
        """
        try:
            # Get user's connected accounts from Pipedream
            pipedream_connections = self._get_user_connections(external_user_id)

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

    def _get_user_connections(self, external_user_id: str) -> List[Dict[str, Any]]:
        """Get user's connected accounts from Pipedream API.

        Paginates through results since the API defaults to 10 per page.
        """
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

        return all_connections

    def _build_connection_status(
        self, pipedream_connections: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Build connection status from Pipedream API data."""
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

        connection_status = []

        for app_name in supported_integrations:
            # Check if connected in Pipedream
            pipedream_connection = next(
                (
                    conn
                    for conn in pipedream_connections
                    if self._get_app_name_from_pipedream(conn) == app_name
                ),
                None,
            )

            if pipedream_connection:
                connection_status.append(
                    {
                        "app_name": app_name,
                        "status": "connected",
                        "pipedream_account_id": pipedream_connection.get("id"),
                        "last_auth_check": pipedream_connection.get("created_at"),
                        "healthy": pipedream_connection.get("healthy"),
                        "dead": pipedream_connection.get("dead"),
                        "connection_name": pipedream_connection.get("name"),
                        "connected_at": pipedream_connection.get("created_at"),
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

    def run_action(
        self,
        external_user_id: str,
        action_key: str,
        configured_props: Dict[str, Any],
        stash_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Execute a Pipedream Connect action.

        Args:
            external_user_id: The external user ID
            action_key: The action key (e.g., "google_drive-find-file")
            configured_props: Props for the action including auth
            stash_id: Optional stash ID for file operations

        Returns:
            Action result with ret, exports, and optional stash data
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()
        project_id = credentials["project_id"]
        environment = credentials["environment"]

        # Auto-inject authProvisionId if set to "auto"
        configured_props = self._inject_auth_provision_id(
            external_user_id, action_key, configured_props
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
    ) -> Dict[str, Any]:
        """Get dynamic dropdown options for an action prop.

        Args:
            external_user_id: The external user ID
            action_key: The action key
            prop_name: The prop to configure (e.g., "drive")
            configured_props: Currently configured props

        Returns:
            Options list for the prop
        """
        credentials = self.get_credentials()
        access_token = self.get_access_token()
        project_id = credentials["project_id"]
        environment = credentials["environment"]

        # Auto-inject authProvisionId if set to "auto"
        configured_props = self._inject_auth_provision_id(
            external_user_id, action_key, configured_props
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

    def proxy_request(
        self,
        external_user_id: str,
        account_id: str,
        method: str,
        upstream_url: str,
        body: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
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

        Returns:
            Raw upstream API response
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
            response.raise_for_status()

            # Try to parse as JSON, fall back to text (or base64 for binary)
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
                    result = {
                        "binary": True,
                        "base64_body": base64.b64encode(response.content).decode(),
                        "content_type": content_type,
                        "size": len(response.content),
                    }
                else:
                    result = {"text": response.text}

            logger.info(
                "Proxy request completed",
                method=method,
                external_user_id=external_user_id,
                status_code=response.status_code,
            )

            return result

        except Exception as e:
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
    ) -> Dict[str, Any]:
        """Replace "auto" authProvisionId with the user's actual account ID.

        Also normalizes the auth key name to match what the action schema expects.
        This handles cases like Jira where some actions use "app" and others use
        "jira" as the auth prop key.

        Args:
            external_user_id: The external user ID
            action_key: The action key (used to derive app slug)
            configured_props: Props that may contain "auto" auth

        Returns:
            Updated configured_props with real authProvisionId
        """
        # Make a shallow copy to avoid mutating input
        props = dict(configured_props)

        # Find the auth prop with "auto" value
        auth_key = None
        auth_value = None
        for key, value in list(props.items()):
            if isinstance(value, dict) and value.get("authProvisionId") == "auto":
                auth_key = key
                auth_value = value
                break

        if auth_key is None:
            # No auth prop to process
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

        # Look up user's connected accounts
        connections = self._get_user_connections(external_user_id)
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
