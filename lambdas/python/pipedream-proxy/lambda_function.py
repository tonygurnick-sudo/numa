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
        return _error_response(500, "Internal server error")


def _error_response(status_code: int, message: str) -> Dict[str, Any]:
    """Create standardized error response."""
    return {
        "statusCode": status_code,
        "body": json.dumps({"success": False, "error": message}),
    }
