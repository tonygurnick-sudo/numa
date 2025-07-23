"""
Configuration module for Numa Chat Agent.

Centralizes environment variables, constants, and client initialization.
"""

import os

import boto3
import structlog
from strands.models.bedrock import BedrockModel

# ── Environment Variables & Constants ──────────────────────────────────────
REGION = os.getenv("AWS_REGION", "us-east-1")

# Region-aware model configuration (matches frontend MODEL_MAP)
REGIONAL_MODEL_MAP = {
    "us-east-1": {
        "default": "us.anthropic.claude-sonnet-4-20250514-v1:0",
        "fallback": "us.anthropic.claude-3-5-sonnet-20240620-v1:0",
        "haiku": "anthropic.claude-3-haiku-20240307-v1:0",
    },
    "ap-southeast-2": {
        "default": "apac.anthropic.claude-sonnet-4-20250514-v1:0",
        "fallback": "anthropic.claude-3-5-sonnet-20241022-v2:0",
        "haiku": "anthropic.claude-3-haiku-20240307-v1:0",
    },
}


def get_regional_model(model_type="default"):
    """Get model ID for the current region and model type."""
    regional_models = REGIONAL_MODEL_MAP.get(REGION)
    if not regional_models:
        # Fall back to us-east-1 for unknown regions
        regional_models = REGIONAL_MODEL_MAP["us-east-1"]
    return regional_models.get(model_type, regional_models["default"])


# Set model constants with region-aware defaults, allowing env var override
MODEL_ID = os.getenv("MODEL_ID", get_regional_model("default"))
FALLBACK_MODEL_ID = os.getenv("FALLBACK_MODEL_ID", get_regional_model("fallback"))
HAIKU_MODEL_ID = get_regional_model("haiku")

# WebSocket Configuration
CONNECTION_TABLE = os.getenv("CONNECTION_TABLE")
WS_API_ENDPOINT_OVERRIDE = os.getenv("WS_API_ENDPOINT_OVERRIDE")

# Knowledge Base Configuration
QB_APPLICATION_ID = os.getenv("Q_APPLICATION_ID")
QB_RETRIEVER_ID = os.getenv("Q_RETRIEVER_ID")
BEDROCK_KNOWLEDGE_BASE_ID = os.getenv("BEDROCK_KNOWLEDGE_BASE_ID")
PREFERRED_KNOWLEDGE_BASE = os.getenv("PREFERRED_KNOWLEDGE_BASE", "q").lower()

logger = structlog.get_logger()


# ── Client Initialization ─────────────────────────────────────────────────
def get_qbusiness_client():
    """Get Q Business client instance."""
    return boto3.client("qbusiness", region_name=REGION)


def get_bedrock_agent_runtime_client():
    """Get Bedrock Agent Runtime client instance."""
    return boto3.client("bedrock-agent-runtime", region_name=REGION)


def get_bedrock_runtime_client():
    """Get Bedrock Runtime client instance."""
    return boto3.client("bedrock-runtime", region_name=REGION)


def get_dynamodb_resource():
    """Get DynamoDB resource instance."""
    return boto3.resource("dynamodb")


def get_sts_client():
    """Get STS client instance."""
    return boto3.client("sts", region_name=REGION)


def get_apigateway_management_client(endpoint_url: str):
    """Get API Gateway Management client for WebSocket connections."""
    return boto3.client("apigatewaymanagementapi", endpoint_url=endpoint_url)


# ── Model Configuration ───────────────────────────────────────────────────
def get_bedrock_model(model_id=None, streaming: bool = True, temperature: float = 0.15):
    """Create BedrockModel instance with specified or default model configuration."""
    effective_model_id = model_id or MODEL_ID
    logger.debug(
        "Creating BedrockModel",
        model_id=effective_model_id,
        streaming=streaming,
        temperature=temperature,
    )

    return BedrockModel(
        model_id=effective_model_id,
        streaming=streaming,
        temperature=temperature,
    )


def get_fallback_model(streaming: bool = True, temperature: float = 0.15):
    """Create BedrockModel instance with fallback model configuration."""
    logger.debug(
        "Creating fallback BedrockModel",
        model_id=FALLBACK_MODEL_ID,
        streaming=streaming,
        temperature=temperature,
    )

    return BedrockModel(
        model_id=FALLBACK_MODEL_ID,
        streaming=streaming,
        temperature=temperature,
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
)
