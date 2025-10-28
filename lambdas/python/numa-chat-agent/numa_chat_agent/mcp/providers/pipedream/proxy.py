"""
Helpers for invoking the secure Pipedream proxy lambda.
"""

import json
from typing import Any, Dict

import structlog
from botocore.session import Session

from ....config import PIPEDREAM_PROXY_LAMBDA_ARN, get_lambda_client

logger = structlog.get_logger(__name__)


def generate_sts_proof_url(region: str = "us-east-1", expires: int = 60) -> str:
    """
    Generate STS presigned GetCallerIdentity URL for identity verification.
    """
    try:
        session = Session()
        sts_client: Any = session.create_client("sts", region_name=region)
        presigned_url = sts_client.generate_presigned_url(
            "get_caller_identity",
            Params={},
            ExpiresIn=expires,
            HttpMethod="GET",
        )
        return presigned_url

    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Failed to generate STS proof URL", error=str(exc))
        raise ValueError(f"STS proof URL generation failed: {exc}") from exc


def invoke_pipedream_proxy(operation: str, external_user_id: str, **kwargs) -> Dict:
    """
    Invoke the secure Pipedream proxy lambda for operations.
    """
    if not PIPEDREAM_PROXY_LAMBDA_ARN:
        raise ValueError("Pipedream proxy not configured for this client")

    try:
        try:
            sts_proof_url = generate_sts_proof_url()
        except Exception as exc:
            logger.error("Failed to generate STS proof URL", error=str(exc))
            raise ValueError("Identity verification setup failed") from exc

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

        response_payload = json.loads(response["Payload"].read())

        try:
            body = json.loads(response_payload.get("body", "{}"))
        except (json.JSONDecodeError, TypeError) as exc:
            logger.error(
                "Failed to parse proxy response body",
                error=str(exc),
                body=response_payload.get("body"),
            )
            raise ValueError("Invalid proxy response format") from exc

        logger.debug(
            "Proxy lambda response",
            status_code=response_payload.get("statusCode"),
            operation=operation,
            success=body.get("success"),
        )

        if response.get("FunctionError"):
            error_message = response_payload.get("errorMessage", "Unknown lambda error")
            logger.error("Lambda function error", error=error_message)
            raise ValueError(f"Proxy lambda execution failed: {error_message}")

        if response_payload.get("statusCode") != 200:
            error_message = body.get(
                "error", f"HTTP {response_payload.get('statusCode')} error"
            )
            raise ValueError(f"Proxy operation failed: {error_message}")

        return body

    except Exception as exc:
        logger.error(
            "Failed to invoke Pipedream proxy lambda",
            error=str(exc),
            operation=operation,
            external_user_id=(
                external_user_id[:20] + "..."
                if len(external_user_id) > 20
                else external_user_id
            ),
            exc_info=True,
        )
        raise ValueError(f"Pipedream proxy invocation failed: {exc}") from exc


def get_mcp_connection_details_from_proxy(external_user_id: str, app_name: str) -> Dict:
    """
    Get MCP client connection details via proxy lambda.
    """
    response = invoke_pipedream_proxy(
        "create_mcp_client", external_user_id, app_name=app_name
    )

    if not response.get("success"):
        raise ValueError(response.get("error", "Failed to get MCP connection details"))

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
