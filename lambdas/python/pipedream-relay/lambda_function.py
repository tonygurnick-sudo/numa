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
from typing import Any, Dict

import boto3
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.session import Session

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
        "operation": "generate_connect_token|get_integration_status|create_mcp_client",
        "external_user_id": "client_name_user123",
        "parameters": {
            // Operation-specific parameters (optional)
        }
    }
    """
    try:
        logger.info("Pipedream relay request received", request_event=event)

        # Get the cross-account proxy lambda ARN from environment
        proxy_lambda_arn = os.environ.get("PIPEDREAM_PROXY_LAMBDA_ARN")
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
        lambda_client = boto3.client("lambda", region_name="us-east-1")

        # Add STS proof URL to the request payload
        proxy_payload = event.copy()
        proxy_payload["sts_proof_url"] = sts_proof_url

        # Forward the request to the cross-account proxy lambda
        logger.info(
            "Forwarding request to cross-account proxy",
            proxy_lambda_arn=proxy_lambda_arn,
            operation=event.get("operation"),
            external_user_id=event.get("external_user_id"),
            has_sts_proof=True,
        )

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
                operation=event.get("operation"),
                error_details=error_details,
                full_response=response_payload,
            )
        else:
            logger.info(
                "Successfully relayed request to cross-account proxy",
                status_code=status_code,
                operation=event.get("operation"),
            )

        # Return the response with parsed body (maintain original structure for frontend compatibility)
        return {
            "statusCode": status_code,
            "body": body,
        }

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
