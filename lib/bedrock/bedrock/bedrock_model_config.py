"""
Bedrock Model Configuration

This module maps model types to specific Bedrock model IDs by AWS region.
Used to ensure regional data sovereignty and consistent model selection.

Model Types:
- "default": Our go-to full-feature model for complex tasks with automatic fallback on quota limits
- "claude_haiku": Fast and economical model for simple tasks

NOTE:
Any new model IDs added here must also be added to:
`infra/constructs/core-numa-infra-construct.ts` under the `const models` array,
to ensure quota requests are correctly handled during provisioning.
"""

from dataclasses import dataclass
from enum import Enum
from typing import List


class Region(str, Enum):
    US_EAST_1 = "us-east-1"
    AP_SOUTHEAST_2 = "ap-southeast-2"


class ModelTypes(str, Enum):
    DEFAULT = "default"
    CLAUDE_HAIKU = "claude_haiku"


@dataclass
class ModelInfo:
    """Information about a specific model"""

    model_id: str
    provider: str = "anthropic"
    name: str = ""
    input_cost: float = 0.0
    output_cost: float = 0.0
    max_tokens: int = 4096


# Define fallback sequences for each region
# Order matters: first model is most preferred (primary), last model is least preferred
# Model 1 → Model 2 → Model 3 → Model 4 as quota exceptions occur
FALLBACK_SEQUENCES = {
    Region.US_EAST_1: [
        ModelInfo(
            model_id="us.anthropic.claude-sonnet-4-6",
            provider="anthropic",
            name="Claude Sonnet 4.6",
            input_cost=0.003,
            output_cost=0.015,
            max_tokens=64000,
        ),
        ModelInfo(
            model_id="us.anthropic.claude-haiku-4-5-20251001-v1:0",
            provider="anthropic",
            name="Claude Haiku 4.5",
            input_cost=0.001,
            output_cost=0.005,
            max_tokens=64000,
        ),
        ModelInfo(
            model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
            provider="anthropic",
            name="Claude Sonnet 4",
            input_cost=0.003,
            output_cost=0.015,
            max_tokens=64000,
        ),
        ModelInfo(
            model_id="us.amazon.nova-pro-v1:0",
            provider="amazon",
            name="Nova Pro",
            input_cost=0.0008,
            output_cost=0.0032,
            max_tokens=10000,
        ),
    ],
    Region.AP_SOUTHEAST_2: [
        ModelInfo(
            model_id="au.anthropic.claude-sonnet-4-6",
            provider="anthropic",
            name="Claude Sonnet 4.6",
            input_cost=0.003,
            output_cost=0.015,
            max_tokens=64000,
        ),
        ModelInfo(
            model_id="au.anthropic.claude-haiku-4-5-20251001-v1:0",
            provider="anthropic",
            name="Claude Haiku 4.5",
            input_cost=0.001,
            output_cost=0.005,
            max_tokens=64000,
        ),
        ModelInfo(
            model_id="apac.anthropic.claude-sonnet-4-20250514-v1:0",
            provider="anthropic",
            name="Claude Sonnet 4",
            input_cost=0.003,
            output_cost=0.015,
            max_tokens=64000,
        ),
        ModelInfo(
            model_id="apac.amazon.nova-pro-v1:0",
            provider="amazon",
            name="Nova Pro",
            input_cost=0.0008,
            output_cost=0.0032,
            max_tokens=10000,
        ),
    ],
}


MODEL_MAP = {
    Region.US_EAST_1: {
        ModelTypes.DEFAULT: FALLBACK_SEQUENCES[Region.US_EAST_1][
            0
        ].model_id,  # Primary model (first in sequence)
        ModelTypes.CLAUDE_HAIKU: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    },
    Region.AP_SOUTHEAST_2: {
        ModelTypes.DEFAULT: FALLBACK_SEQUENCES[Region.AP_SOUTHEAST_2][
            0
        ].model_id,  # Primary model (first in sequence)
        ModelTypes.CLAUDE_HAIKU: "au.anthropic.claude-haiku-4-5-20251001-v1:0",
    },
}


def get_model_id(region: Region, model_type: ModelTypes = ModelTypes.DEFAULT) -> str:
    """Get a single model ID for the specified region and type"""
    try:
        return MODEL_MAP[region][model_type]
    except KeyError as exc:
        raise ValueError(
            f"No model configured for region '{region}' and type '{model_type}'"
        ) from exc


def get_model_max_tokens(model_id: str) -> int:
    """
    Get the maximum tokens for a specific model ID.

    Args:
        model_id: The model ID to look up

    Returns:
        int: Maximum tokens for the model, or 4096 as default if not found
    """
    for region_sequence in FALLBACK_SEQUENCES.values():
        for model_info in region_sequence:
            if model_info.model_id == model_id:
                return model_info.max_tokens

    # Default fallback for unknown models
    return 4096


def get_fallback_sequence(region: Region, claude_only: bool = False) -> List[ModelInfo]:
    """
    Get the fallback sequence for a region.

    Args:
        region: The AWS region
        claude_only: If True, only return Claude models

    Returns:
        List of ModelInfo objects in fallback order
    """
    try:
        sequence = FALLBACK_SEQUENCES[region]
        if claude_only:
            sequence = [model for model in sequence if model.provider == "anthropic"]
        return sequence
    except KeyError as exc:
        raise ValueError(
            f"No fallback sequence configured for region '{region}'"
        ) from exc


def is_quota_limit_error(error) -> bool:
    """
    Check if an error is related to quota limits or throttling.

    Args:
        error: The exception to check

    Returns:
        bool: True if the error indicates quota/throttling issues
    """
    if not hasattr(error, "response"):
        return False

    error_code = error.response.get("Error", {}).get("Code", "")
    error_message = str(error).lower()

    # Check for specific error codes and messages that indicate quota/throttling
    quota_indicators = [
        "throttlingexception",
        "serviceQuotaExceededException",
        "modelNotReadyException",
        "quotaexceeded",
        "throttled",
        "rate limit",
        "too many requests",
        "quota",
        "capacity",
    ]

    return error_code.lower() in [
        indicator.lower() for indicator in quota_indicators
    ] or any(indicator in error_message for indicator in quota_indicators)
