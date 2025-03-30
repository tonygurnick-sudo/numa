"""
Bedrock Model Configuration

This module maps model types to specific Bedrock model IDs by AWS region.
Used to ensure regional data sovereignty and consistent model selection.

Model Types:
- "default": Our go to full-feature model for complex tasks (e.g., Claude Sonnet 3.5)

NOTE:
Any new model IDs added here must also be added to:
`infra/constructs/core-numa-infra-construct.ts` under the `const models` array,
to ensure quota requests are correctly handled during provisioning.
"""

from enum import Enum


class Region(str, Enum):
    US_EAST_1 = "us-east-1"
    AP_SOUTHEAST_2 = "ap-southeast-2"


class ModelTypes(str, Enum):
    DEFAULT = "default"
    CLAUDE_HAIKU = "claude_haiku"


MODEL_MAP = {
    Region.US_EAST_1: {
        ModelTypes.DEFAULT: "anthropic.claude-3-5-sonnet-20240620-v1:0",
        ModelTypes.CLAUDE_HAIKU: "anthropic.claude-3-haiku-20240307-v1:0",
    },
    Region.AP_SOUTHEAST_2: {
        ModelTypes.DEFAULT: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        ModelTypes.CLAUDE_HAIKU: "anthropic.claude-3-haiku-20240307-v1:0",
    },
}


def get_model_id(region: Region, model_type: ModelTypes = ModelTypes.DEFAULT) -> str:
    try:
        return MODEL_MAP[region][model_type]
    except KeyError as exc:
        raise ValueError(
            f"No model configured for region '{region}' and type '{model_type}'"
        ) from exc
