"""
MCP (Model Context Protocol) integration for Pipedream services.

This module provides functions to create and manage MCP clients for
Slack, Notion, and Google Calendar through Pipedream's MCP servers.
"""

# Pylint complains about manual __enter__/__exit__ usage.
# We intentionally manage client lifecycles explicitly to keep sessions alive
# across the agent run and clean them up deterministically.
# pylint: disable=unnecessary-dunder-call

import json
import os
from contextlib import contextmanager
from typing import Any, List, Optional, Tuple

import structlog
from botocore.session import Session
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

from .auth import get_current_user_auth
from .config import PIPEDREAM_PROXY_LAMBDA_ARN, get_lambda_client

logger = structlog.get_logger()

# Get supported Pipedream MCP apps from environment configuration
SUPPORTED_MCP_APPS = json.loads(os.environ.get("SUPPORTED_INTEGRATIONS", "[]"))


def generate_sts_proof_url(region: str = "us-east-1", expires: int = 60) -> str:
    """
    Generate STS presigned GetCallerIdentity URL for identity verification.

    Args:
        region: AWS region for STS endpoint (default: us-east-1 for lowest proxy latency)
        expires: URL expiration in seconds (default: 60, max allowed)

    Returns:
        str: Presigned STS GetCallerIdentity URL
    """
    try:
        session = Session()
        # The generated client supports generate_presigned_url at runtime,
        # but type stubs may not include it. Use Any for typing here.
        sts_client: Any = session.create_client("sts", region_name=region)

        # Generate presigned URL for GetCallerIdentity
        presigned_url = sts_client.generate_presigned_url(
            "get_caller_identity",
            Params={},
            ExpiresIn=expires,
            HttpMethod="GET",
        )

        logger.debug(
            "Generated STS proof URL for proxy call",
            region=region,
            expires=expires,
            url_length=len(presigned_url),
        )

        return presigned_url

    except Exception as e:
        logger.error("Failed to generate STS proof URL", error=str(e))
        raise ValueError(f"STS proof URL generation failed: {str(e)}") from e


def get_external_user_id() -> Optional[str]:
    """
    Create external user ID for Pipedream MCP from current user auth.
    Format matches frontend: {client_id}_{cognito_user_id}

    Returns:
        str: External user ID in format {client_id}_{cognito_user_id}
        None: If no user auth context available
    """
    user_auth = get_current_user_auth()
    if not user_auth:
        logger.warning("No user auth context available for MCP integration")
        return None

    # Extract client ID from environment (CLIENT_NAME is always available in lambda)
    client_id = os.environ.get("CLIENT_NAME")

    # Extract Cognito user ID (sub claim from JWT)
    cognito_user_id = user_auth.get("sub") or user_auth.get("user_id")
    if not cognito_user_id:
        logger.warning(
            "Could not extract Cognito user ID from auth context",
            user_auth_keys=list(user_auth.keys()),
        )
        return None

    # Construct external user ID in same format as frontend
    external_user_id = f"{client_id}_{cognito_user_id}"
    logger.debug(
        "Generated external user ID for MCP",
        client_id=client_id,
        cognito_user_id=(
            cognito_user_id[:8] + "..." if len(cognito_user_id) > 8 else cognito_user_id
        ),
        external_user_id=(
            external_user_id[:20] + "..."
            if len(external_user_id) > 20
            else external_user_id
        ),
    )

    return external_user_id


def invoke_pipedream_proxy(operation: str, external_user_id: str, **kwargs) -> dict:
    """
    Invoke the secure Pipedream proxy lambda for operations.

    Args:
        operation: The operation to perform (e.g., 'create_mcp_client', 'get_integration_status')
        external_user_id: The external user ID for Pipedream
        **kwargs: Additional operation-specific parameters

    Returns:
        dict: Response from proxy lambda

    Raises:
        ValueError: If proxy not configured or invocation fails
    """
    if not PIPEDREAM_PROXY_LAMBDA_ARN:
        raise ValueError("Pipedream proxy not configured for this client")

    try:
        # Generate STS proof URL for caller identity verification
        try:
            sts_proof_url = generate_sts_proof_url()
            logger.debug("Generated STS proof URL for proxy call")
        except Exception as e:
            logger.error("Failed to generate STS proof URL", error=str(e))
            raise ValueError("Identity verification setup failed") from e

        lambda_client = get_lambda_client()

        payload = {
            "operation": operation,
            "external_user_id": external_user_id,
            "sts_proof_url": sts_proof_url,
            "parameters": kwargs,
        }

        logger.debug(
            "Invoking Pipedream proxy lambda",
            operation=operation,
            external_user_id=(
                external_user_id[:20] + "..."
                if len(external_user_id) > 20
                else external_user_id
            ),
            lambda_arn=PIPEDREAM_PROXY_LAMBDA_ARN,
            has_sts_proof=True,
        )

        response = lambda_client.invoke(
            FunctionName=PIPEDREAM_PROXY_LAMBDA_ARN,
            Payload=json.dumps(payload),
            InvocationType="RequestResponse",
        )

        # Parse lambda response
        response_payload = json.loads(response["Payload"].read())

        # Parse the response body (it's JSON stringified)
        try:
            body = json.loads(response_payload.get("body", "{}"))
        except (json.JSONDecodeError, TypeError) as e:
            logger.error(
                "Failed to parse proxy response body",
                error=str(e),
                body=response_payload.get("body"),
            )
            raise ValueError("Invalid proxy response format") from e

        logger.debug(
            "Proxy lambda response",
            status_code=response_payload.get("statusCode"),
            operation=operation,
            success=body.get("success"),
        )

        # Handle lambda execution errors
        if response.get("FunctionError"):
            error_message = response_payload.get("errorMessage", "Unknown lambda error")
            logger.error("Lambda function error", error=error_message)
            raise ValueError(f"Proxy lambda execution failed: {error_message}")

        # Handle HTTP-style error responses from lambda
        if response_payload.get("statusCode") != 200:
            error_message = body.get(
                "error", f"HTTP {response_payload.get('statusCode')} error"
            )
            raise ValueError(f"Proxy operation failed: {error_message}")

        return body

    except Exception as e:
        logger.error(
            "Failed to invoke Pipedream proxy lambda",
            error=str(e),
            operation=operation,
            external_user_id=(
                external_user_id[:20] + "..."
                if len(external_user_id) > 20
                else external_user_id
            ),
            exc_info=True,
        )
        raise ValueError(f"Pipedream proxy invocation failed: {str(e)}") from e


def get_mcp_connection_details_from_proxy(external_user_id: str, app_name: str) -> dict:
    """
    Get MCP client connection details via proxy lambda.

    Args:
        external_user_id: The external user ID for Pipedream
        app_name: The app name for MCP client

    Returns:
        dict: Connection details with base_url, headers, etc.

    Raises:
        ValueError: If proxy call fails
    """
    try:
        response = invoke_pipedream_proxy(
            "create_mcp_client", external_user_id, app_name=app_name
        )

        if not response.get("success"):
            raise ValueError(
                response.get("error", "Failed to get MCP connection details")
            )

        connection_details = response.get("data", {})

        logger.info(
            "Retrieved MCP connection details from proxy",
            app_name=app_name,
            external_user_id=(
                external_user_id[:20] + "..."
                if len(external_user_id) > 20
                else external_user_id
            ),
            base_url=connection_details.get("base_url"),
        )

        return connection_details

    except Exception as e:
        logger.error(
            "Failed to get MCP connection details from proxy",
            error=str(e),
            app_name=app_name,
            external_user_id=(
                external_user_id[:20] + "..."
                if len(external_user_id) > 20
                else external_user_id
            ),
            exc_info=True,
        )
        raise


def create_mcp_client(app_name: str, external_user_id: str) -> Optional[MCPClient]:
    """
    Create an MCP client for a specific Pipedream app using secure proxy.

    Args:
        app_name: Name of the app (slack, notion, google_calendar)
        external_user_id: External user ID for Pipedream

    Returns:
        MCPClient: Configured MCP client
        None: If client creation fails or proxy not configured
    """
    # Check if proxy is configured
    if not PIPEDREAM_PROXY_LAMBDA_ARN:
        logger.debug("Pipedream proxy not configured, skipping MCP client creation")
        return None

    if app_name not in SUPPORTED_MCP_APPS:
        logger.warning(
            "Unsupported MCP app", app_name=app_name, supported_apps=SUPPORTED_MCP_APPS
        )
        return None

    try:
        # Get connection details from secure proxy
        connection_details = get_mcp_connection_details_from_proxy(
            external_user_id, app_name
        )

        base_url = connection_details.get("base_url")
        headers = connection_details.get("headers", {})

        if not base_url:
            logger.error("No base URL received from proxy", app_name=app_name)
            return None

        logger.debug(
            "Creating MCP client via proxy", app_name=app_name, base_url=base_url
        )

        # Create MCP client using Strands' MCPClient with streamable HTTP and proxy headers
        def create_transport():
            return streamablehttp_client(base_url, headers=headers)

        client = MCPClient(create_transport)

        return client

    except Exception as e:
        logger.error(
            "Failed to create MCP client via proxy",
            app_name=app_name,
            error=str(e),
            exc_info=True,
        )
        return None


def create_all_mcp_clients(enabled_apps: Optional[List[str]] = None) -> List[MCPClient]:
    """
    Create MCP clients for all enabled Pipedream apps.

    Args:
        enabled_apps: List of app names to enable. Empty list means no MCP clients.
                     None defaults to all supported apps (for backwards compatibility).

    Returns:
        List[MCPClient]: List of successfully created MCP clients
    """
    # Handle empty list (Pipedream disabled) - natural graceful degradation
    if enabled_apps is not None and len(enabled_apps) == 0:
        logger.debug("No enabled apps specified, skipping MCP client creation")
        return []

    if enabled_apps is None:
        enabled_apps = SUPPORTED_MCP_APPS.copy()

    # Check if proxy is configured
    if not PIPEDREAM_PROXY_LAMBDA_ARN:
        logger.debug("Pipedream proxy not configured, skipping MCP client creation")
        return []

    # Get external user ID
    external_user_id = get_external_user_id()
    if not external_user_id:
        logger.warning("Cannot create MCP clients without user context")
        return []

    clients = []
    for app_name in enabled_apps or []:
        if app_name not in SUPPORTED_MCP_APPS:
            logger.warning("Skipping unsupported MCP app", app_name=app_name)
            continue

        client = create_mcp_client(app_name, external_user_id)
        if client:
            clients.append(client)
            logger.info("Successfully created MCP client", app_name=app_name)
        else:
            logger.warning("Failed to create MCP client", app_name=app_name)

    logger.info(
        "Created MCP clients via proxy",
        client_count=len(clients),
        requested_apps=enabled_apps,
    )
    return clients


@contextmanager
def mcp_clients_context(enabled_apps: Optional[List[str]] = None):
    """
    Context manager for MCP clients with proper lifecycle management.

    Args:
        enabled_apps: List of app names to enable. Defaults to all supported apps.

    Yields:
        List[MCPClient]: List of active MCP clients
    """
    clients = create_all_mcp_clients(enabled_apps)
    entered_clients = []  # Initialize before try block

    try:
        # Enter all clients
        for client in clients:
            try:
                entered_client = (
                    client.__enter__()
                )  # pylint: disable=unnecessary-dunder-call
                entered_clients.append((client, entered_client))
            except Exception as e:
                logger.error("Failed to enter MCP client context", error=str(e))

        # Yield the entered clients
        yield [entered_client for _, entered_client in entered_clients]

    finally:
        # Exit all clients in reverse order
        for client, _ in reversed(entered_clients):
            try:
                client.__exit__(None, None, None)  # type: ignore[arg-type]
            except Exception as e:
                logger.error("Failed to exit MCP client context", error=str(e))


def get_mcp_tools_for_agent(enabled_apps: Optional[List[str]] = None) -> List:
    """
    Get MCP tools for agent creation with proper lifecycle management.

    NOTE: This function is for quick testing only. For production use,
    use get_mcp_tools_and_clients_for_agent() which returns both tools and clients
    to keep them alive during agent execution.

    Args:
        enabled_apps: List of app names to enable. Defaults to all supported apps.

    Returns:
        List: List of MCP tools from all enabled clients
    """
    try:
        with mcp_clients_context(enabled_apps) as clients:
            all_tools: List[Any] = []
            for client in clients:
                try:
                    tools = client.list_tools_sync()
                    all_tools.extend(tools)
                    logger.debug("Retrieved MCP tools", client_tools_count=len(tools))
                except Exception as e:
                    logger.error(
                        "Failed to retrieve MCP tools from client", error=str(e)
                    )

            logger.info("Retrieved total MCP tools", total_tools_count=len(all_tools))
            return all_tools
    except Exception as e:
        logger.error("Failed to get MCP tools", error=str(e))
        return []


def get_mcp_tools_and_clients_for_agent(
    enabled_apps: Optional[List[str]] = None,
) -> Tuple[List, List[MCPClient]]:
    """
    Get MCP tools and their corresponding clients for agent creation.

    This function returns both tools and clients so the clients can be kept alive
    during agent execution to prevent "session not running" errors.

    Args:
        enabled_apps: List of app names to enable. Defaults to all supported apps.

    Returns:
        Tuple[List, List[MCPClient]]: (tools, clients) - Tools and their corresponding active clients
    """
    clients = create_all_mcp_clients(enabled_apps)

    if not clients:
        logger.warning("No MCP clients created")
        return [], []

    # Initialize all clients and collect tools
    initialized_clients = []
    all_tools: List[Any] = []

    for client in clients:
        try:
            # Initialize the client
            initialized_client = (
                client.__enter__()
            )  # pylint: disable=unnecessary-dunder-call
            initialized_clients.append(client)  # Keep reference to original for cleanup

            # Get tools from initialized client
            tools = initialized_client.list_tools_sync()
            all_tools.extend(tools)
            logger.debug("Retrieved MCP tools", client_tools_count=len(tools))

        except Exception as e:
            logger.error("Failed to initialize MCP client", error=str(e))
            # Clean up this client if initialization failed
            try:
                client.__exit__(None, None, None)  # type: ignore[arg-type]
            except Exception:
                pass

    logger.info(
        "Retrieved total MCP tools",
        total_tools_count=len(all_tools),
        active_clients=len(initialized_clients),
    )
    return all_tools, initialized_clients
