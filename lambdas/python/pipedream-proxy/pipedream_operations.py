"""
Pipedream API operations for the secure proxy.

Contains all the Pipedream-specific logic ported from existing lambdas.
"""

import json
import os
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
        """Get user's connected accounts from Pipedream API."""
        credentials = self.get_credentials()
        access_token = self.get_access_token()

        try:
            response = requests.get(
                f"https://api.pipedream.com/v1/connect/{credentials['project_id']}/accounts",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "x-pd-environment": credentials["environment"],
                },
                params={
                    "external_user_id": external_user_id,
                    "include_credentials": "false",
                },
                timeout=15,
            )
            response.raise_for_status()

            accounts_data = response.json()
            connections = accounts_data.get("data", [])

            logger.debug(
                "Successfully fetched Pipedream connections",
                external_user_id=external_user_id,
                connection_count=len(connections),
            )

            return connections

        except Exception as e:
            logger.error(
                "Failed to fetch Pipedream connections",
                error=str(e),
                external_user_id=external_user_id,
            )
            raise Exception(
                f"Failed to fetch connections from Pipedream API: {str(e)}"
            ) from e

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
                    }
                )
            else:
                connection_status.append(
                    {
                        "app_name": app_name,
                        "status": "not_connected",
                        "pipedream_account_id": None,
                        "last_auth_check": None,
                    }
                )

        return connection_status

    def _get_app_name_from_pipedream(self, pipedream_account: Dict[str, Any]) -> str:
        """Map Pipedream account app info to our standard app names."""
        return pipedream_account.get("app", {}).get("name_slug", "")
