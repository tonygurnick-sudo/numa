"""
Pipedream API operations for the secure proxy.

Contains all the Pipedream-specific logic ported from existing lambdas.
"""

import json
import os
from typing import Any, Dict, List, Optional

import boto3
import requests
import structlog

logger = structlog.get_logger()


class PipedreamOperations:
    """Handles all Pipedream API operations."""

    def __init__(self) -> None:
        self.secret_arn = os.environ.get("PIPEDREAM_SECRET_ARN")
        if not self.secret_arn:
            raise ValueError("PIPEDREAM_SECRET_ARN environment variable not set")

        self.secrets_client = boto3.client("secretsmanager")
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
