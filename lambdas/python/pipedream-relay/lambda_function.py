"""
Pipedream Relay Lambda - Client-side relay for Pipedream operations.

This lambda acts as a local relay in each client account to forward frontend requests
to the cross-account Pipedream proxy, providing cryptographically verified caller identity
via STS presigned URLs.

Architecture:
- Frontend → Local Relay Lambda (this) → Cross-Account Proxy Lambda
- numa-chat-agent → Cross-Account Proxy Lambda (direct with STS proof)
"""

import json
import os
from functools import lru_cache
from typing import Any, Dict

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.session import Session

from policy_store import PolicyStore
from prm import client as prm_client
from prm import resource as prm_resource


@lru_cache(maxsize=1)
def _get_global_table():
    """Return the global integration settings DynamoDB table (or None if not configured).

    Cached to avoid repeated client construction during a warm lambda runtime.
    """
    table_name = os.environ.get("GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME")
    if not table_name:
        return None
    dynamodb = prm_resource("dynamodb")
    return dynamodb.Table(table_name)


def _get_global_settings(app_name: str) -> dict:
    table = _get_global_table()
    if not table:
        return {"status": "disabled", "denyTools": []}
    try:
        resp = table.get_item(Key={"integration": app_name})
        item = resp.get("Item") or {}
        status = item.get("status", "disabled")
        deny = item.get("denyTools", []) or []
        if not isinstance(deny, list):
            deny = []
        return {"status": status, "denyTools": deny}
    except Exception as e:
        logger.warning(
            "Failed to read global settings", app_name=app_name, error=str(e)
        )
        return {"status": "disabled", "denyTools": []}


# Set up structured logging
logger = structlog.get_logger()


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
        # Type ignore for mypy - STS client does have generate_presigned_url method
        sts_client = session.create_client("sts", region_name=region)  # type: ignore

        # Generate presigned URL for GetCallerIdentity
        presigned_url = sts_client.generate_presigned_url(  # type: ignore
            "get_caller_identity",
            Params={},
            ExpiresIn=expires,
            HttpMethod="GET",
        )

        logger.debug(
            "Generated STS proof URL",
            region=region,
            expires=expires,
            url_length=len(presigned_url),
        )

        return presigned_url

    except Exception as e:
        logger.error("Failed to generate STS proof URL", error=str(e))
        raise ValueError(f"STS proof URL generation failed: {str(e)}") from e


def handler(event: Dict[str, Any], _: LambdaContext) -> Dict[str, Any]:
    """
    Relay handler that forwards frontend requests to the cross-account Pipedream proxy.

    Expected request format (same as proxy):
    {
        "operation": "generate_connect_token|get_integration_status|create_mcp_client|list_mcp_tools|get_mcp_policy|set_mcp_policy",
        "external_user_id": "client_name_user123",
        "parameters": {
            // Operation-specific parameters (optional)
        }
    }
    """
    try:
        logger.info("Pipedream relay request received", request_event=event)

        proxy_lambda_arn = os.environ.get("PIPEDREAM_PROXY_LAMBDA_ARN")
        policy_table = os.environ.get(
            "USER_INTEGRATION_SETTINGS_TABLE_NAME"
        ) or os.environ.get("MCP_POLICY_TABLE_NAME")

        operation = event.get("operation")
        external_user_id = event.get("external_user_id")
        parameters = event.get("parameters", {})

        # Validate required fields
        if not external_user_id:
            return _error_response(400, "external_user_id is required")

        # Handle local policy ops without proxy
        if operation in ("get_mcp_policy", "set_mcp_policy"):
            if not policy_table:
                return _error_response(500, "Policy table not configured")

            store = PolicyStore()
            if operation == "get_mcp_policy":
                app_name = parameters.get("app_name")
                if not app_name:
                    return _error_response(400, "get_mcp_policy requires app_name")
                result = store.get_policy(external_user_id, app_name)
                return {"statusCode": 200, "body": {"success": True, "data": result}}
            else:
                app_name = parameters.get("app_name")
                if not app_name:
                    return _error_response(400, "set_mcp_policy requires app_name")
                mode = parameters.get("mode", "deny")
                deny_tools = parameters.get("denyTools", [])
                # Enforce global denies: reject attempts to enable globally-disabled tools
                global_settings = _get_global_settings(app_name)
                global_deny = set(global_settings.get("denyTools", []) or [])
                # If user attempts to enable a tool in global deny (i.e., not present in deny_tools), reject
                attempted_enables = [
                    t for t in global_deny if t not in (deny_tools or [])
                ]
                if attempted_enables:
                    return _error_response(
                        400,
                        f"One or more tools are disabled by admin: {', '.join(sorted(attempted_enables))}",
                    )
                result = store.set_policy(external_user_id, app_name, mode, deny_tools)
                return {"statusCode": 200, "body": {"success": True, "data": result}}

        if operation in (
            "generate_connect_token",
            "get_integration_status",
            "create_mcp_client",
            "list_mcp_tools",
            "disconnect_integration",
            "list_actions",
            "run_action",
            "configure_props",
            "proxy_request",
            "batch_get_schemas",
        ):
            if not proxy_lambda_arn:
                logger.error("PIPEDREAM_PROXY_LAMBDA_ARN environment variable not set")
                return _error_response(500, "Relay configuration error")

            # Generate STS proof URL for caller identity verification
            try:
                sts_proof_url = generate_sts_proof_url()
                logger.debug("Generated STS proof URL for proxy request")
            except Exception as e:
                logger.error("Failed to generate STS proof URL", error=str(e))
                return _error_response(500, "Identity verification setup failed")

            # Create Lambda client for cross-account invocation (target region us-east-1)
            lambda_client = prm_client("lambda", region="us-east-1")

            # Add STS proof URL to the request payload
            proxy_payload = event.copy()
            proxy_payload["sts_proof_url"] = sts_proof_url

            # Forward the request to the cross-account proxy lambda
            logger.info(
                "Forwarding request to cross-account proxy",
                proxy_lambda_arn=proxy_lambda_arn,
                operation=operation,
                external_user_id=external_user_id,
                has_sts_proof=True,
            )

            # If list_mcp_tools: optionally filter tools server-side based on global denies for additional safety
            if operation == "list_mcp_tools":
                app_name = parameters.get("app_name")
                gs = _get_global_settings(app_name) if app_name else {"denyTools": []}
                proxy_payload["global_deny_tools"] = gs.get("denyTools", [])

            response = lambda_client.invoke(
                FunctionName=proxy_lambda_arn,
                Payload=json.dumps(proxy_payload),
                InvocationType="RequestResponse",
            )

            # Parse the proxy lambda response
            response_payload = json.loads(response["Payload"].read())

            # Handle lambda execution errors
            if response.get("FunctionError"):
                logger.error(
                    "Cross-account proxy lambda execution failed",
                    function_error=response["FunctionError"],
                    response_payload=response_payload,
                )
                return _error_response(500, "Proxy lambda execution failed")

            # Check if proxy returned an error status
            status_code = response_payload.get("statusCode")

            # Parse the response body (it's JSON stringified)
            try:
                body = json.loads(response_payload.get("body", "{}"))
            except (json.JSONDecodeError, TypeError) as e:
                logger.error(
                    "Failed to parse proxy response body",
                    error=str(e),
                    body=response_payload.get("body"),
                )
                return _error_response(500, "Invalid proxy response format")

            if status_code != 200:
                error_details = body.get("error", "Unknown error")
                logger.error(
                    "Cross-account proxy returned error response",
                    status_code=status_code,
                    operation=operation,
                    error_details=error_details,
                    full_response=response_payload,
                )
            else:
                logger.info(
                    "Successfully relayed request to cross-account proxy",
                    status_code=status_code,
                    operation=operation,
                )

            # Return the response with parsed body (maintain original structure for frontend compatibility)
            return {
                "statusCode": status_code,
                "body": body,
            }

        # Unknown operation
        return _error_response(400, "Unsupported operation")

    except Exception as e:
        logger.exception(
            "Unexpected error in relay lambda",
            operation=event.get("operation"),
            external_user_id=event.get("external_user_id"),
        )
        return _error_response(500, "Internal relay error")


def _error_response(status_code: int, message: str) -> Dict[str, Any]:
    """Create standardized error response."""
    return {
        "statusCode": status_code,
        "body": json.dumps({"success": False, "error": message}),
    }
