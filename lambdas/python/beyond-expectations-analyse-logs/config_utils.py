"""
Configuration utilities for the Beyond Expectations logs analysis lambda.
"""

import json
import os
from typing import Any, Dict

import jsonschema
import structlog
from jsonschema import ValidationError

import s3_helpers
from config_schema import CONFIG_SCHEMA

logger = structlog.get_logger()

# Default configuration as a constant
DEFAULT_CONFIG = {
    "notificationRequirements": {
        "external": {
            "notifyWhen": [
                "The error directly impacts client operations or data, and requires action from them",
                "If Beyond Expectations' client needs to be aware of the issue for their business operations",
                "The error indicates client configuration issues",
                "If the error affects a critical service or functionality that the client relies on",
            ],
            "dontNotifyWhen": [
                "If the error only affects Beyond Expectations' client's customers but doesn't require the client's action",
                "If the error is transient or has been automatically resolved",
                "If the error is minor and doesn't affect any critical functionality",
                "If the error is part of normal operation fluctuations and doesn't require intervention",
            ],
        },
        "internal": {
            "notifyWhen": [
                "If the error requires investigation or follow-up from the Beyond Expectations team",
                "If there's something the Beyond Expectations team can do to resolve the issue",
                "If a pattern of errors suggests a systemic issue that Beyond Expectations needs to address",
                "If the error indicates a potential security vulnerability or data breach",
            ],
            "dontNotifyWhen": [
                "If the error is self-resolving or doesn't require any action from Beyond Expectations",
                "If the error can be handled entirely by the client without any input from Beyond Expectations",
            ],
        },
    },
    "logsToIgnore": {
        "byClientTask": [
            # Example:
            # {
            #     "ClientId": 123456789,
            #     "TaskDescription": "Example task description"
            # }
        ],
        "byMessageContains": [
            # Example: "Example message pattern to ignore"
        ],
    },
}


def validate_config(config: Dict[str, Any]) -> bool:
    """Validate the configuration against the schema.

    Args:
        config: The configuration dictionary to validate

    Returns:
        True if validation passes, False otherwise
    """
    try:
        jsonschema.validate(instance=config, schema=CONFIG_SCHEMA)
        logger.info("Config validation passed")
        return True
    except ValidationError:
        logger.exception("Config validation failed")
        return False


def load_config() -> Dict[str, Any]:
    """Load configuration from S3 or use default.

    Attempts to load configuration from the path specified in the CONFIG_PATH
    environment variable. If not found or if the environment variable is not set,
    falls back to the default configuration.

    Returns:
        Dictionary containing the configuration
    """

    # Check if a custom config path is provided
    config_path = os.environ.get("CONFIG_PATH")
    if not config_path:
        logger.info("CONFIG_PATH not set, using default configuration")
        return DEFAULT_CONFIG

    # Try to load the custom config
    try:
        logger.info("Loading configuration", config_path=config_path)
        config_data = s3_helpers.read(config_path)
        custom_config = json.loads(config_data.decode("utf-8"))

        # Validate the config
        if validate_config(custom_config):
            logger.info("Successfully loaded custom configuration")
            return custom_config
        else:
            logger.warning(
                "Custom configuration failed validation, using default",
                config_path=config_path,
            )
            return DEFAULT_CONFIG
    except Exception as e:
        logger.warning(
            "Failed to load custom configuration, using default",
            error=str(e),
            config_path=config_path,
        )
        return DEFAULT_CONFIG


def update_prompt_with_config(base_prompt: str, config: Dict[str, Any]) -> str:
    """Update the prompt template with notification requirements from config.

    Args:
        base_prompt: The original prompt template
        config: The configuration dictionary

    Returns:
        Updated prompt with notification requirements from config
    """
    notification_reqs = config.get("notificationRequirements", {})

    # Format external notification requirements
    external = notification_reqs.get("external", {})
    external_notify_when = "\n  * ".join([""] + external.get("notifyWhen", []))
    external_dont_notify_when = "\n  * ".join([""] + external.get("dontNotifyWhen", []))

    # Format internal notification requirements
    internal = notification_reqs.get("internal", {})
    internal_notify_when = "\n  * ".join([""] + internal.get("notifyWhen", []))
    internal_dont_notify_when = "\n  * ".join([""] + internal.get("dontNotifyWhen", []))

    # Replace the notification guidelines in the prompt
    updated_prompt = base_prompt.replace(
        "- Client notification is needed when:\n  * The error directly impacts client operations or data, and requires action from them\n  * If Beyond Expectations' client needs to be aware of the issue for their business operations\n  * The error indicates client configuration issues\n  * If the error affects a critical service or functionality that the client relies on",
        f"- Client notification is needed when:{external_notify_when}",
    )

    updated_prompt = updated_prompt.replace(
        "- Client notification is not needed when:\n  * If the error only affects Beyond Expectations' client's customers but doesn't require the client's action\n  * If the error is transient or has been automatically resolved\n  * If the error is minor and doesn't affect any critical functionality\n  * If the error is part of normal operation fluctuations and doesn't require intervention",
        f"- Client notification is not needed when:{external_dont_notify_when}",
    )

    updated_prompt = updated_prompt.replace(
        "- Internal notification is needed when:\n  * If the error requires investigation or follow-up from the Beyond Expectations team\n  * If there's something the Beyond Expectations team can do to resolve the issue\n  * If a pattern of errors suggests a systemic issue that Beyond Expectations needs to address\n  * If the error indicates a potential security vulnerability or data breach",
        f"- Internal notification is needed when:{internal_notify_when}",
    )

    updated_prompt = updated_prompt.replace(
        "- Internal notification is not needed when:\n  * If the error is self-resolving or doesn't require any action from Beyond Expectations\n  * If the error can be handled entirely by the client without any input from Beyond Expectations",
        f"- Internal notification is not needed when:{internal_dont_notify_when}",
    )

    return updated_prompt
