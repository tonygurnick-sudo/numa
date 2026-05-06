"""
Pipedream Proxy Lambda - Secure cross-account proxy for Pipedream operations.

This lambda provides a secure proxy for Pipedream API operations with:
- IAM-based caller validation using STS get-caller-identity
- Role name validation against allowlist
- DynamoDB security mapping with negative case handling
- Support for generate_connect_token, get_integration_status, and create_mcp_client operations
"""

import json
import os
from typing import Any, Dict

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

from pipedream_operations import PipedreamOperations
from prm import client as prm_client
from security_validator import SecurityValidationError, SecurityValidator

# Set up structured logging
logger = structlog.get_logger()

# Hardcoded allowlist of supported operations
SUPPORTED_OPERATIONS = [
    "generate_connect_token",
    "get_integration_status",
    "create_mcp_client",
    "disconnect_integration",
    "list_mcp_tools",
    "list_actions",
    "run_action",
    "configure_props",
    "proxy_request",
    "batch_get_schemas",
    # Trigger lifecycle (Pipedream Connect Triggers API)
    "list_triggers",
    "deploy_trigger",
    "update_deployed_trigger",
    "delete_deployed_trigger",
    "list_deployed_triggers",
]


def handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Main lambda handler for Pipedream proxy operations.

    Expected request format (from cross-account lambda invocation):
    {
        "operation": "generate_connect_token|get_integration_status|create_mcp_client",
        "external_user_id": "arcanum_tenant_user123",
        "sts_proof_url": "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&...",
        "parameters": {
            // Operation-specific parameters (optional)
        }
    }
    """

    # Set up logging context
    structlog.contextvars.bind_contextvars(
        function_name=context.function_name,
        request_id=context.aws_request_id,
        environment=os.environ.get("ENVIRONMENT", "unknown"),
    )

    logger.info(
        "Pipedream proxy request received",
        operation=event.get("operation"),
        external_user_id=event.get("external_user_id"),
    )

    try:
        # Extract and validate request parameters
        operation = event.get("operation")
        external_user_id = event.get("external_user_id")
        sts_proof_url = event.get("sts_proof_url")
        parameters = event.get("parameters", {})

        if not operation:
            logger.info(
                "Request validation failed", error="Missing operation parameter"
            )
            return _error_response(400, "Missing required parameter: operation")

        if not external_user_id:
            logger.info(
                "Request validation failed", error="Missing external_user_id parameter"
            )
            return _error_response(400, "Missing required parameter: external_user_id")

        if not sts_proof_url:
            logger.info(
                "Request validation failed", error="Missing sts_proof_url parameter"
            )
            return _error_response(400, "Missing required parameter: sts_proof_url")

        if operation not in SUPPORTED_OPERATIONS:
            logger.info(
                "Request validation failed", error=f"Unsupported operation: {operation}"
            )
            return _error_response(400, f"Unsupported operation: {operation}")

        # Validate external_user_id format (should be tenant_userid)
        if external_user_id.count("_") < 1:
            logger.info(
                "Request validation failed",
                error="Invalid external_user_id format - no underscore separator",
            )
            return _error_response(400, "Invalid external_user_id format")

        logger.info(
            "Processing proxy request",
            operation=operation,
            external_user_id=external_user_id,
            has_parameters=bool(parameters),
        )

        # Security validation
        logger.info("Starting security validation", external_user_id=external_user_id)

        try:
            security_validator = SecurityValidator()
            validation_result = security_validator.validate_request(
                external_user_id, sts_proof_url
            )
        except Exception as e:
            logger.error(
                "SecurityValidator failed",
                error=str(e),
                security_table=os.environ.get("SECURITY_MAPPING_TABLE"),
                allowed_table=os.environ.get("ALLOWED_ACCOUNTS_TABLE"),
            )
            raise

        logger.info(
            "Security validation passed",
            caller_account=validation_result["caller_account_id"],
            role_name=validation_result["role_name"],
        )

        # Execute the requested operation
        pipedream_ops = PipedreamOperations()

        if operation == "generate_connect_token":
            result = pipedream_ops.generate_connect_token(external_user_id)

        elif operation == "get_integration_status":
            result = pipedream_ops.get_integration_status(external_user_id)

        elif operation == "create_mcp_client":
            app_name = parameters.get("app_name")
            if not app_name:
                return _error_response(
                    400, "create_mcp_client operation requires app_name parameter"
                )
            result = pipedream_ops.create_mcp_client(external_user_id, app_name)

        elif operation == "disconnect_integration":
            # Accept either account_id or app_name (preferred for UI)
            app_name = (
                parameters.get("app_name") if isinstance(parameters, dict) else None
            )
            account_id = (
                parameters.get("account_id") if isinstance(parameters, dict) else None
            )
            if not app_name and not account_id:
                return _error_response(
                    400,
                    "disconnect_integration requires account_id or app_name",
                )
            result = pipedream_ops.disconnect_integration(
                external_user_id, app_name=app_name, account_id=account_id
            )

        elif operation == "list_mcp_tools":
            app_name = parameters.get("app_name")
            if not app_name:
                return _error_response(
                    400, "list_mcp_tools operation requires app_name parameter"
                )
            result = {"tools": pipedream_ops.list_mcp_tools(external_user_id, app_name)}

        elif operation == "list_actions":
            app_slug = parameters.get("app_slug")
            if not app_slug:
                return _error_response(
                    400, "list_actions operation requires app_slug parameter"
                )
            result = {"actions": pipedream_ops.list_actions(app_slug)}

        elif operation == "run_action":
            action_key = parameters.get("action_key")
            configured_props = parameters.get("configured_props", {})
            stash_id = parameters.get("stash_id")
            if not action_key:
                return _error_response(
                    400, "run_action operation requires action_key parameter"
                )
            result = pipedream_ops.run_action(
                external_user_id, action_key, configured_props, stash_id
            )

        elif operation == "configure_props":
            action_key = parameters.get("action_key")
            prop_name = parameters.get("prop_name")
            configured_props = parameters.get("configured_props", {})
            if not action_key or not prop_name:
                return _error_response(
                    400,
                    "configure_props requires action_key and prop_name parameters",
                )
            result = pipedream_ops.configure_props(
                external_user_id, action_key, prop_name, configured_props
            )

        elif operation == "proxy_request":
            method = parameters.get("method", "GET")
            upstream_url = parameters.get("upstream_url")
            account_id = parameters.get("account_id")
            body = parameters.get("body")
            headers = parameters.get("headers")
            if not upstream_url or not account_id:
                return _error_response(
                    400,
                    "proxy_request requires upstream_url and account_id parameters",
                )
            result = pipedream_ops.proxy_request(
                external_user_id,
                account_id,
                method,
                upstream_url,
                body,
                headers,
                request_id=context.aws_request_id,
            )

        elif operation == "batch_get_schemas":
            app_slugs = parameters.get("app_slugs", [])
            if not app_slugs:
                return _error_response(
                    400, "batch_get_schemas requires app_slugs parameter"
                )
            result = _batch_get_schemas(app_slugs)

        elif operation == "list_triggers":
            app_slug = parameters.get("app_slug")
            if not app_slug:
                return _error_response(
                    400, "list_triggers operation requires app_slug parameter"
                )
            result = {"triggers": pipedream_ops.list_triggers(app_slug)}

        elif operation == "deploy_trigger":
            component_id = parameters.get("component_id")
            configured_props = parameters.get("configured_props")
            webhook_url = parameters.get("webhook_url")
            if not component_id or not webhook_url or configured_props is None:
                return _error_response(
                    400,
                    "deploy_trigger requires component_id, configured_props, and webhook_url",
                )
            result = pipedream_ops.deploy_trigger(
                external_user_id, component_id, configured_props, webhook_url
            )

        elif operation == "update_deployed_trigger":
            deployed_trigger_id = parameters.get("deployed_trigger_id")
            configured_props = parameters.get("configured_props")  # optional
            active = parameters.get("active")  # optional
            if not deployed_trigger_id:
                return _error_response(
                    400,
                    "update_deployed_trigger requires deployed_trigger_id",
                )
            if configured_props is None and active is None:
                return _error_response(
                    400,
                    "update_deployed_trigger requires at least one of configured_props or active",
                )
            result = pipedream_ops.update_deployed_trigger(
                external_user_id,
                deployed_trigger_id,
                configured_props=configured_props,
                active=active,
            )

        elif operation == "delete_deployed_trigger":
            deployed_trigger_id = parameters.get("deployed_trigger_id")
            if not deployed_trigger_id:
                return _error_response(
                    400,
                    "delete_deployed_trigger requires deployed_trigger_id",
                )
            result = pipedream_ops.delete_deployed_trigger(
                external_user_id, deployed_trigger_id
            )

        elif operation == "list_deployed_triggers":
            result = {
                "deployed_triggers": pipedream_ops.list_deployed_triggers(
                    external_user_id
                )
            }

        else:
            return _error_response(
                500, f"Operation handler not implemented: {operation}"
            )

        logger.info(
            "Proxy request completed successfully",
            operation=operation,
            external_user_id=external_user_id,
        )

        return {
            "statusCode": 200,
            "body": json.dumps(
                {"success": True, "operation": operation, "data": result}
            ),
        }

    except SecurityValidationError as e:
        logger.error(
            "Security validation failed",
            error=str(e),
            operation=event.get("operation"),
            external_user_id=event.get("external_user_id"),
        )
        return _error_response(403, "Access denied")

    except ValueError as e:
        logger.error(
            "Invalid request parameters", error=str(e), operation=event.get("operation")
        )
        return _error_response(400, "Invalid request")

    except Exception as e:
        logger.exception(
            "Unexpected error processing proxy request",
            operation=event.get("operation"),
            external_user_id=event.get("external_user_id"),
        )
        return _error_response(500, str(e) or "Internal server error")


def _batch_get_schemas(app_slugs: list) -> Dict[str, Any]:
    """Read cached integration schemas from DynamoDB in a single batch.

    Returns a dict mapping app_slug to {actions: [...], index: [...]}.
    Slugs not found in the cache are omitted from the result.
    """
    table_name = os.environ.get("SCHEMA_CACHE_TABLE", "")
    if not table_name:
        raise ValueError("SCHEMA_CACHE_TABLE not configured")

    dynamo = prm_client("dynamodb")

    # BatchGetItem supports max 100 keys per call
    keys = [{"app_slug": {"S": slug}} for slug in app_slugs[:100]]

    response = dynamo.batch_get_item(
        RequestItems={table_name: {"Keys": keys}},
    )

    result: Dict[str, Any] = {}
    for item in response.get("Responses", {}).get(table_name, []):
        slug = item["app_slug"]["S"]
        schemas_json = item.get("schemas", {}).get("S", "{}")
        try:
            result[slug] = json.loads(schemas_json)
        except (json.JSONDecodeError, TypeError):
            logger.warning("Invalid schema JSON for slug", app_slug=slug)

    logger.info(
        "Batch schema lookup",
        requested=len(app_slugs),
        found=len(result),
    )

    return {"schemas": result}


def _error_response(status_code: int, message: str) -> Dict[str, Any]:
    """Create standardized error response."""
    return {
        "statusCode": status_code,
        "body": json.dumps({"success": False, "error": message}),
    }
