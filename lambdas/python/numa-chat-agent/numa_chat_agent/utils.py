"""
Utility functions for Numa Chat Agent.

Contains retry logic, shared helpers, and common functionality.
"""

import json
import time

import structlog

logger = structlog.get_logger()


def retry_aurora_operation(operation, max_retries=20, retry_delay=2.0):
    """
    Retry wrapper for Aurora database operations that may fail due to auto-pause.
    Similar to the frontend retryAuroraOperation but adapted for Python.

    Args:
        operation: Function to execute with retry logic
        max_retries: Maximum number of retry attempts (default: 20)
        retry_delay: Delay between retries in seconds (default: 2.0)

    Returns:
        Wrapper function that executes the operation with retry logic
    """

    def wrapper(*args, **kwargs):
        attempts = max_retries

        while attempts > 0:
            try:
                return operation(*args, **kwargs)
            except Exception as error:
                attempts -= 1

                # Check if this is an Aurora resuming error
                error_message = str(error).lower()
                is_resuming = (
                    "databaseresumingexception" in error_message
                    or "is resuming after being auto-paused" in error_message
                    or (
                        "aurora db instance" in error_message
                        and "resuming" in error_message
                    )
                )

                if is_resuming and attempts > 0:
                    logger.info(
                        "Aurora DB resuming - retrying operation",
                        retry_delay=retry_delay,
                        attempts_left=attempts,
                        error_message=str(error),
                    )
                    time.sleep(retry_delay)
                    continue

                # If not a resuming error or no attempts left, re-raise
                raise error

        # This should never be reached, but just in case
        raise RuntimeError("Retry operation failed without capturing an exception")

    return wrapper


def safe_json_convert(obj):
    """
    Convert non-serializable objects to strings for safe JSON serialization.

    Args:
        obj: Object to convert

    Returns:
        JSON-serializable version of the object
    """
    try:
        json.dumps(obj)
        return obj
    except (TypeError, ValueError):
        return str(obj)


def truncate_text(text: str, max_length: int = 100, suffix: str = "...") -> str:
    """
    Safely truncate text for logging purposes.

    Args:
        text: Text to truncate
        max_length: Maximum length before truncation
        suffix: Suffix to add when truncated

    Returns:
        Truncated text with suffix if needed
    """
    if not isinstance(text, str):
        text = str(text)

    if len(text) <= max_length:
        return text

    return text[: max_length - len(suffix)] + suffix


def extract_preview(content: str, max_length: int = 120) -> str:
    """
    Extract a preview of content for logging.

    Args:
        content: Content to preview
        max_length: Maximum length of preview

    Returns:
        Content preview suitable for logging
    """
    if not content:
        return "(empty)"

    # Replace newlines and tabs with spaces for cleaner preview
    preview = content.replace("\n", " ").replace("\t", " ")

    # Remove extra whitespace
    preview = " ".join(preview.split())

    return truncate_text(preview, max_length)


def log_token_usage(model_id: str, usage_stats: dict, context: str = ""):
    """
    Log token usage statistics in a consistent format.

    Args:
        model_id: Model identifier
        usage_stats: Usage statistics dictionary
        context: Additional context for the log entry
    """
    input_tokens = usage_stats.get("input_tokens", 0)
    output_tokens = usage_stats.get("output_tokens", 0)
    total_tokens = input_tokens + output_tokens

    logger.info(
        f"Token usage{' - ' + context if context else ''}",
        model_id=model_id,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
    )


def convert_tool_blocks_to_text(messages):
    """
    Convert toolUse and toolResult blocks to JSON text.

    This prevents AWS Bedrock ValidationException when conversation history contains
    tool blocks but no toolConfig is provided (which happens when tools are disabled).

    Args:
        messages (list): List of conversation messages

    Returns:
        list: Messages with tool blocks converted to text blocks
    """
    logger.info("Converting tool blocks to text (tools disabled)")
    converted_messages = []
    tool_blocks_converted = 0

    for message in messages:
        content = message.get("content", [])
        if not isinstance(content, list):
            converted_messages.append(message)
            continue

        converted_content = []

        for block in content:
            if isinstance(block, dict) and (
                "toolUse" in block or "toolResult" in block
            ):
                # Convert tool block to formatted JSON string
                converted_content.append(
                    {
                        "text": json.dumps(block, indent=2, ensure_ascii=False),
                    }
                )
                tool_blocks_converted += 1
                logger.debug(
                    "Converted tool block to text",
                    block_type="toolUse" if "toolUse" in block else "toolResult",
                    tool_name=(
                        block.get("toolUse", {}).get("name", "unknown")
                        if "toolUse" in block
                        else "N/A"
                    ),
                )
            else:
                # Keep non-tool blocks unchanged
                converted_content.append(block)

        converted_messages.append({**message, "content": converted_content})

    if tool_blocks_converted > 0:
        logger.info(
            "Tool block conversion completed",
            blocks_converted=tool_blocks_converted,
            total_messages=len(messages),
        )

    return converted_messages
