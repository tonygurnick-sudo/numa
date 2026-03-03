"""
Configuration module for Numa Chat Agent.

Centralizes environment variables, constants, and client initialization.
"""

import os
from functools import lru_cache
from typing import Any

import boto3
import structlog
from strands.models.bedrock import BedrockModel

# Import PRM (Partner Revenue Measurement) helper for AWS SDK clients
# This adds the APN User-Agent to all boto3 clients for AWS Partner tracking
from prm import client as prm_client
from prm import resource as prm_resource

# ── Environment Variables & Constants ──────────────────────────────────────
REGION = os.getenv("AWS_REGION", "us-east-1")

# Region-aware model configuration with max_tokens limits
REGIONAL_MODEL_MAP = {
    "us-east-1": {
        "primary": {
            "model_id": "us.anthropic.claude-sonnet-4-6",
            "max_tokens": 64000,
        },
        "fallback": {
            "model_id": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            "max_tokens": 64000,
        },
        "fast": {
            "model_id": "global.amazon.nova-2-lite-v1:0",
            "max_tokens": 100000,
        },
    },
    "ap-southeast-2": {
        "primary": {
            "model_id": "au.anthropic.claude-sonnet-4-6",
            "max_tokens": 64000,
        },
        "fallback": {
            "model_id": "au.anthropic.claude-haiku-4-5-20251001-v1:0",
            "max_tokens": 64000,
        },
        "fast": {
            "model_id": "global.amazon.nova-2-lite-v1:0",
            "max_tokens": 100000,
        },
    },
    "ap-southeast-3": {
        "primary": {
            "model_id": "global.anthropic.claude-sonnet-4-6",
            "max_tokens": 64000,
        },
        "fallback": {
            "model_id": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
            "max_tokens": 64000,
        },
        "fast": {
            "model_id": "global.amazon.nova-2-lite-v1:0",
            "max_tokens": 100000,
        },
    },
}


def get_regional_model(model_type="primary"):
    """Get model ID for the current region and model type."""
    regional_models = REGIONAL_MODEL_MAP.get(REGION)
    if not regional_models:
        # Fall back to us-east-1 for unknown regions
        regional_models = REGIONAL_MODEL_MAP["us-east-1"]

    model_config = regional_models.get(model_type, regional_models["primary"])
    return model_config["model_id"]


def get_regional_model_max_tokens(model_type="primary"):
    """Get max tokens for the current region and model type."""
    regional_models = REGIONAL_MODEL_MAP.get(REGION)
    if not regional_models:
        # Fall back to us-east-1 for unknown regions
        regional_models = REGIONAL_MODEL_MAP["us-east-1"]

    model_config = regional_models.get(model_type, regional_models["primary"])
    return model_config["max_tokens"]


# Set model constants with region-aware defaults, allowing env var override
MODEL_ID = os.getenv("MODEL_ID", get_regional_model("primary"))
FALLBACK_MODEL_ID = os.getenv("FALLBACK_MODEL_ID", get_regional_model("fallback"))
FAST_MODEL_ID = get_regional_model("fast")

# WebSocket Configuration
CONNECTION_TABLE = os.getenv("CONNECTION_TABLE")
WS_API_ENDPOINT_OVERRIDE = os.getenv("WS_API_ENDPOINT_OVERRIDE")

# Knowledge Base Configuration
QB_APPLICATION_ID = os.getenv("Q_APPLICATION_ID")
QB_RETRIEVER_ID = os.getenv("Q_RETRIEVER_ID")
BEDROCK_KNOWLEDGE_BASE_ID = os.getenv("BEDROCK_KNOWLEDGE_BASE_ID")
PREFERRED_KNOWLEDGE_BASE = os.getenv("PREFERRED_KNOWLEDGE_BASE", "q").lower()

# Cross-account Bedrock Quota Sharing
BEDROCK_ACCOUNT = os.getenv("BEDROCK_ACCOUNT")

# Pipedream Integration Configuration
PIPEDREAM_PROXY_LAMBDA_ARN = os.getenv("PIPEDREAM_PROXY_LAMBDA_ARN")
GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME = os.getenv(
    "GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME"
)
OUTPUTS_BUCKET_NAME = os.getenv("BUCKET")
TOOL_OUTPUTS_PREFIX = os.getenv("TOOL_OUTPUTS_PREFIX", "numa-chat/tool-outputs")
EXTRACT_CONTENT_LAMBDA_NAME = os.getenv(
    "EXTRACT_CONTENT_LAMBDA_NAME",
    (
        f"{os.getenv('CLIENT_NAME')}_extract-content"
        if os.getenv("CLIENT_NAME")
        else None
    ),
)

logger = structlog.get_logger()


# ── Client Initialization ─────────────────────────────────────────────────
def get_qbusiness_client():
    """Get Q Business client instance with PRM tracking."""
    return prm_client("qbusiness", region=REGION)


def get_bedrock_agent_runtime_client():
    """Get Bedrock Agent Runtime client instance with PRM tracking."""
    return prm_client("bedrock-agent-runtime", region=REGION)


def get_bedrock_runtime_client():
    """Get Bedrock Runtime client instance with PRM tracking."""
    return prm_client("bedrock-runtime", region=REGION)


def get_dynamodb_resource():
    """Get DynamoDB resource instance with PRM tracking."""
    return prm_resource("dynamodb")


def get_sts_client():
    """Get STS client instance with PRM tracking."""
    return prm_client("sts", region=REGION)


def get_apigateway_management_client(endpoint_url: str):
    """Get API Gateway Management client for WebSocket connections with PRM tracking."""
    return prm_client(
        "apigatewaymanagementapi", region=REGION, endpoint_url=endpoint_url
    )


def get_lambda_client(region_name: str | None = None):
    """Get Lambda client instance with PRM tracking."""
    return prm_client("lambda", region=region_name or "us-east-1")


def _get_cross_account_bedrock_session() -> boto3.Session | None:
    """Get boto3 session for cross-account Bedrock access if configured.

    When BEDROCK_ACCOUNT is set, assumes the bedrock-quota-sharing role
    in the target account and returns a session with temporary credentials.
    This enables using Bedrock quotas from a shared account.

    Returns:
        boto3.Session with cross-account credentials, or None to use default credentials.
    """
    if not BEDROCK_ACCOUNT:
        return None

    try:
        sts = prm_client("sts", region=REGION)
        credentials = sts.assume_role(
            RoleArn=f"arn:aws:iam::{BEDROCK_ACCOUNT}:role/bedrock-quota-sharing",
            RoleSessionName="numa-chat-agent",
        )["Credentials"]

        logger.info(
            "Assumed cross-account role for Bedrock",
            bedrock_account=BEDROCK_ACCOUNT,
        )

        return boto3.Session(
            aws_access_key_id=credentials["AccessKeyId"],
            aws_secret_access_key=credentials["SecretAccessKey"],
            aws_session_token=credentials["SessionToken"],
            region_name=REGION,
        )
    except Exception as e:
        logger.error(
            "Failed to assume cross-account role for Bedrock, falling back to local credentials",
            bedrock_account=BEDROCK_ACCOUNT,
            error=str(e),
        )
        return None


@lru_cache(maxsize=1)
def get_pipedream_routing_overrides() -> dict[str, str]:  # backward compat no-op
    """Deprecated. Environment-based routing overrides have been removed.

    Kept for backward compatibility with older imports; always returns empty.
    """
    return {}


def get_pipedream_routing_mode(
    app_name: str,
) -> str:  # backward compat
    """Deprecated. Always returns "numa" (tools-only) as integration default.

    Accepts ``app_name`` for backward compatibility; argument is intentionally unused.
    """
    # Explicitly consume argument to satisfy linters while keeping signature stable
    _ = app_name
    return "numa"


def get_pipedream_tool_routing_mode(
    app_name: str, tool_name: str | None
) -> str:  # backward compat
    """Deprecated. Always returns "numa" (tools-only). Use static overrides instead.

    Accepts ``app_name`` and ``tool_name`` for backward compatibility; arguments are unused.
    """
    # Explicitly consume arguments to satisfy linters while keeping signature stable
    _ = (app_name, tool_name)
    return "numa"


# ── Fast Model (Nova 2 Lite) Helper ───────────────────────────────────────
def invoke_fast_model(
    prompt: str,
    max_tokens: int = 10000,
    temperature: float = 0.1,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: dict[str, Any] | None = None,
    enable_reasoning: bool = True,
    reasoning_effort: str = "medium",
) -> tuple[str, dict[str, Any], list[dict[str, Any]] | None]:
    """
    Invoke the fast model (Nova 2 Lite) for summarization and classification tasks.

    Uses the Converse API for compatibility with reasoning config.

    Args:
        prompt: The user prompt to send
        max_tokens: Maximum tokens in response (default 10000)
        temperature: Sampling temperature (default 0.1 for consistency)
        tools: Optional list of tools in Claude format (will be converted to Nova format)
        tool_choice: Optional tool choice in Claude format (will be converted to Nova format)
        enable_reasoning: Whether to enable Nova reasoning (default True)
        reasoning_effort: Reasoning effort level: "low", "medium", "high" (default "medium")

    Returns:
        tuple: (response_text, usage_stats, tool_uses)
            - response_text: The text response from the model
            - usage_stats: Dict with input_tokens and output_tokens
            - tool_uses: List of tool use dicts if tools were used, None otherwise
    """
    client = get_bedrock_runtime_client()

    # Build converse API parameters
    messages = [{"role": "user", "content": [{"text": prompt}]}]

    inference_config = {
        "maxTokens": max_tokens,
        "temperature": temperature,
    }

    # Build optional parameters
    converse_kwargs: dict[str, Any] = {
        "modelId": FAST_MODEL_ID,
        "messages": messages,
        "inferenceConfig": inference_config,
    }

    # Add tool configuration if provided (convert Claude format to Nova format)
    if tools:
        nova_tools = []
        for tool in tools:
            nova_tools.append(
                {
                    "toolSpec": {
                        "name": tool["name"],
                        "description": tool.get("description", ""),
                        "inputSchema": {"json": tool["input_schema"]},
                    }
                }
            )
        tool_config: dict[str, Any] = {"tools": nova_tools}

        # Convert tool_choice if provided
        if tool_choice and tool_choice.get("type") == "tool":
            tool_config["toolChoice"] = {"tool": {"name": tool_choice["name"]}}
        elif tool_choice and tool_choice.get("type") == "any":
            tool_config["toolChoice"] = {"any": {}}

        converse_kwargs["toolConfig"] = tool_config

    # Add reasoning config if enabled (as API parameter, not in body)
    if enable_reasoning:
        converse_kwargs["additionalModelRequestFields"] = {
            "reasoningConfig": {
                "type": "enabled",
                "maxReasoningEffort": reasoning_effort,
            }
        }

    logger.debug(
        "Invoking fast model via converse API",
        model_id=FAST_MODEL_ID,
        max_tokens=max_tokens,
        temperature=temperature,
        has_tools=bool(tools),
        enable_reasoning=enable_reasoning,
    )

    response = client.converse(**converse_kwargs)

    # Extract content from converse response format: output.message.content
    content = response.get("output", {}).get("message", {}).get("content", [])

    # Extract text and tool uses
    text = ""
    tool_uses = []
    for item in content:
        if "text" in item:
            text = item["text"].strip()
        elif "toolUse" in item:
            tool_use = item["toolUse"]
            tool_uses.append(
                {
                    "type": "tool_use",
                    "id": tool_use.get("toolUseId"),
                    "name": tool_use.get("name"),
                    "input": tool_use.get("input", {}),
                }
            )

    # Extract usage stats (converse API uses camelCase)
    usage = response.get("usage", {})
    usage_stats = {
        "input_tokens": usage.get("inputTokens", 0),
        "output_tokens": usage.get("outputTokens", 0),
    }

    logger.debug(
        "Fast model response",
        model_id=FAST_MODEL_ID,
        input_tokens=usage_stats["input_tokens"],
        output_tokens=usage_stats["output_tokens"],
        has_tool_uses=bool(tool_uses),
    )

    return text, usage_stats, tool_uses if tool_uses else None


# ── Model Configuration ───────────────────────────────────────────────────
def get_bedrock_model(
    model_id=None,
    streaming: bool = True,
    temperature: float = 1,
):
    """Create BedrockModel instance with specified or default model configuration.

    If BEDROCK_ACCOUNT is configured, uses cross-account credentials from the
    shared Bedrock account for quota sharing.
    """
    effective_model_id = model_id or MODEL_ID

    # Use model-specific max_tokens
    max_tokens = get_regional_model_max_tokens("primary")

    # Get cross-account session if configured
    boto_session = _get_cross_account_bedrock_session()

    logger.debug(
        "Creating BedrockModel",
        model_id=effective_model_id,
        streaming=streaming,
        temperature=temperature,
        max_tokens=max_tokens,
        cross_account=boto_session is not None,
    )

    return BedrockModel(
        model_id=effective_model_id,
        streaming=streaming,
        temperature=temperature,
        max_tokens=max_tokens,
        boto_session=boto_session,
        additional_request_fields={
            "thinking": {"type": "enabled", "budget_tokens": 8000}  # Minimum of 1,024
        },
    )


def get_fallback_model(streaming: bool = True, temperature: float = 0.15):
    """Create BedrockModel instance with fallback model configuration.

    If BEDROCK_ACCOUNT is configured, uses cross-account credentials from the
    shared Bedrock account for quota sharing.
    """
    # Use model-specific max_tokens
    max_tokens = get_regional_model_max_tokens("fallback")

    # Get cross-account session if configured
    boto_session = _get_cross_account_bedrock_session()

    logger.debug(
        "Creating fallback BedrockModel",
        model_id=FALLBACK_MODEL_ID,
        streaming=streaming,
        temperature=temperature,
        max_tokens=max_tokens,
        cross_account=boto_session is not None,
    )

    return BedrockModel(
        model_id=FALLBACK_MODEL_ID,
        streaming=streaming,
        temperature=temperature,
        max_tokens=max_tokens,
        boto_session=boto_session,
    )


def is_quota_limit_error(error) -> bool:
    """
    Check if an error is related to quota limits or throttling.

    Args:
        error: The exception to check

    Returns:
        bool: True if the error indicates quota/throttling issues
    """
    # Check AWS SDK error format first
    if hasattr(error, "response") and error.response:
        error_code = error.response.get("Error", {}).get("Code", "")
        http_status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")

        # AWS Bedrock standard patterns
        return error_code == "ThrottlingException" or http_status == 429

    # Fallback check for exception class name
    if hasattr(error, "__class__"):
        return error.__class__.__name__ == "ThrottlingException"

    return False


# ── Configuration Validation ──────────────────────────────────────────────
def validate_config():
    """Validate essential configuration values."""
    issues = []

    if not CONNECTION_TABLE:
        issues.append("CONNECTION_TABLE not set")

    if PREFERRED_KNOWLEDGE_BASE == "q":
        if not QB_APPLICATION_ID:
            issues.append("Q_APPLICATION_ID not set but Q Business is preferred")
        if not QB_RETRIEVER_ID:
            issues.append("Q_RETRIEVER_ID not set but Q Business is preferred")

    elif PREFERRED_KNOWLEDGE_BASE == "bedrock":
        if not BEDROCK_KNOWLEDGE_BASE_ID:
            issues.append("BEDROCK_KNOWLEDGE_BASE_ID not set but Bedrock is preferred")

    if issues:
        logger.warning("Configuration issues detected", issues=issues)
        return False

    logger.info(
        "Configuration validated successfully",
        model_id=MODEL_ID,
        fallback_model_id=FALLBACK_MODEL_ID,
        region=REGION,
        preferred_kb=PREFERRED_KNOWLEDGE_BASE,
        connection_table=CONNECTION_TABLE,
    )
    return True


# Log configuration on import
logger = structlog.get_logger()
logger.info(
    "Configuration loaded",
    model_id=MODEL_ID,
    fallback_model_id=FALLBACK_MODEL_ID,
    region=REGION,
    preferred_kb=PREFERRED_KNOWLEDGE_BASE,
    qb_configured=bool(QB_APPLICATION_ID and QB_RETRIEVER_ID),
    bedrock_configured=bool(BEDROCK_KNOWLEDGE_BASE_ID),
    bedrock_quota_sharing=bool(BEDROCK_ACCOUNT),
    bedrock_account=BEDROCK_ACCOUNT or "local",
)
