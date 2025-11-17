"""
Conversation management utilities for Claude Code Agent.

Provides functions for managing conversation history in JSON format,
stored in S3 for continuity across agent runs.
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import structlog

import s3_helpers
from utils.s3_operations import safe_s3_key

logger = structlog.get_logger(__name__)


def append_conversation_from_file(
    bucket: str, prefix: str, prompt: Optional[str], results_path: Optional[Path]
) -> None:
    """
    Append user prompt and assistant response to conversation.json.

    Reads the assistant response from a file path.

    Args:
        bucket: S3 bucket name
        prefix: S3 prefix for the job (e.g., "data-analysis/{user_id}/{job_id}")
        prompt: User's input prompt
        results_path: Local Path to the results file to read content from
    """
    conv_key = safe_s3_key(prefix, "history", "conversation.json")

    # Try to read existing conversation.json
    try:
        existing_bytes = s3_helpers.read(conv_key, bucket=bucket)
        conversation_data = json.loads(existing_bytes.decode("utf-8"))
        if (
            not isinstance(conversation_data, dict)
            or "messages" not in conversation_data
        ):
            # Invalid format, start fresh
            conversation_data = {"messages": []}
    except Exception:  # pylint: disable=broad-exception-caught
        # File doesn't exist or can't be parsed, start fresh
        conversation_data = {"messages": []}

    messages = conversation_data.get("messages", [])

    # Generate timestamp for both messages (same time for the turn)
    timestamp = datetime.now(timezone.utc).isoformat()

    # Append user message if prompt provided
    if prompt:
        user_message = {
            "id": str(uuid.uuid4()),
            "ts": timestamp,
            "role": "user",
            "textMd": prompt.strip(),
        }
        messages.append(user_message)

    # Append assistant message if results file provided
    if results_path and results_path.exists():
        try:
            # Read the full contents of the results file
            results_content = results_path.read_text(encoding="utf-8")
        except Exception:  # pylint: disable=broad-exception-caught
            logger.warning(
                "Failed to read results file for conversation", path=str(results_path)
            )
            results_content = "# Error\n\nFailed to load results content."

        assistant_message = {
            "id": str(uuid.uuid4()),
            "ts": timestamp,
            "role": "assistant",
            "textMd": results_content,
        }
        messages.append(assistant_message)

    # Update conversation data
    conversation_data["messages"] = messages

    # Write back to S3 as JSON
    s3_helpers.write(
        conv_key,
        json.dumps(conversation_data, indent=2).encode("utf-8"),
        content_type="application/json",
        bucket=bucket,
    )


def append_conversation_from_text(
    bucket: str, prefix: str, prompt: Optional[str], assistant_text: Optional[str]
) -> None:
    """
    Append user prompt and assistant response to conversation.json.

    Uses text directly for the assistant response.

    Args:
        bucket: S3 bucket name
        prefix: S3 prefix for the job
        prompt: User's input prompt
        assistant_text: Assistant's response text
    """
    conv_key = safe_s3_key(prefix, "history", "conversation.json")

    # Try to read existing conversation.json
    try:
        existing_bytes = s3_helpers.read(conv_key, bucket=bucket)
        conversation_data = json.loads(existing_bytes.decode("utf-8"))
        if (
            not isinstance(conversation_data, dict)
            or "messages" not in conversation_data
        ):
            conversation_data = {"messages": []}
    except Exception:  # pylint: disable=broad-exception-caught
        conversation_data = {"messages": []}

    messages = conversation_data.get("messages", [])
    timestamp = datetime.now(timezone.utc).isoformat()

    if prompt:
        messages.append(
            {
                "id": str(uuid.uuid4()),
                "ts": timestamp,
                "role": "user",
                "textMd": prompt.strip(),
            }
        )

    if assistant_text is not None:
        messages.append(
            {
                "id": str(uuid.uuid4()),
                "ts": timestamp,
                "role": "assistant",
                "textMd": assistant_text,
            }
        )

    conversation_data["messages"] = messages

    s3_helpers.write(
        conv_key,
        json.dumps(conversation_data, indent=2).encode("utf-8"),
        content_type="application/json",
        bucket=bucket,
    )


def load_conversation(bucket: str, prefix: str) -> Dict[str, Any]:
    """
    Load existing conversation history from S3.

    Args:
        bucket: S3 bucket name
        prefix: S3 prefix for the job

    Returns:
        Conversation data dictionary with messages list
    """
    conv_key = safe_s3_key(prefix, "history", "conversation.json")

    try:
        existing_bytes = s3_helpers.read(conv_key, bucket=bucket)
        conversation_data = json.loads(existing_bytes.decode("utf-8"))
        if (
            not isinstance(conversation_data, dict)
            or "messages" not in conversation_data
        ):
            return {"messages": []}
        return conversation_data
    except Exception:  # pylint: disable=broad-exception-caught
        return {"messages": []}


def get_conversation_messages(bucket: str, prefix: str) -> List[Dict[str, Any]]:
    """
    Get just the messages array from conversation history.

    Args:
        bucket: S3 bucket name
        prefix: S3 prefix for the job

    Returns:
        List of message dictionaries
    """
    conversation_data = load_conversation(bucket, prefix)
    return conversation_data.get("messages", [])
