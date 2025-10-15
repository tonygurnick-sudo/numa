"""
DynamoDB utilities for Numa Chat Agent.

Python equivalent of the frontend DynamoDBUtils.ts for loading conversation history.
"""

import os
from typing import Any, Dict, List, Optional

import boto3
import structlog

logger = structlog.get_logger()


class NumaChatDynamoUtils:
    """
    Python equivalent of the frontend NumaChatDynamoUtils class.
    Used to load conversation history from DynamoDB in the backend.
    """

    def __init__(self, region: Optional[str] = None):
        """Initialize DynamoDB client and determine table name."""
        self.region = region or os.environ.get("AWS_REGION", "us-east-1")
        self.dynamodb = boto3.client("dynamodb", region_name=self.region)

        # Determine table name explicitly via environment, then fall back to client name
        explicit_table = os.environ.get("CHAT_HISTORY_TABLE")
        if explicit_table:
            self.table_name = explicit_table
        else:
            client_name = os.environ.get("CLIENT_NAME", "")
            if client_name:
                self.table_name = f"numa-{client_name}-chat-history"
            else:
                # Final fallback for safety (should not be used in managed stacks)
                self.table_name = "numa-chat-history"

        logger.info(
            "Initialized DynamoDB utils", table_name=self.table_name, region=self.region
        )

    def query_conversations(
        self, conversation_id: str, user_id: str, limit: int = 1000
    ) -> List[Dict[str, Any]]:
        """
        Query conversation messages for a specific conversation and user.

        Args:
            conversation_id: The conversation ID
            user_id: The user ID (Cognito sub)
            limit: Maximum number of messages to retrieve

        Returns:
            List of conversation messages sorted by timestamp (oldest first for agent processing)
        """
        try:
            logger.info(
                "Querying conversation history",
                conversation_id=conversation_id,
                user_id=user_id,
                limit=limit,
                table_name=self.table_name,
            )

            # Query using same pattern as frontend
            response = self.dynamodb.query(
                TableName=self.table_name,
                KeyConditionExpression="user_id = :u AND begins_with(sk, :c)",
                ExpressionAttributeValues={
                    ":u": {"S": user_id},
                    ":c": {"S": f"{conversation_id}#"},
                },
                ConsistentRead=True,
                ScanIndexForward=False,  # Sort descending by SK (newest first)
                Limit=limit,
            )

            # Parse DynamoDB response
            items = []
            for item in response.get("Items", []):
                # Convert DynamoDB item to dict
                parsed_item = self._parse_dynamodb_item(item)
                items.append(parsed_item)

            # Reverse to get oldest first (for conversation history)
            items.reverse()

            logger.info(
                "Successfully loaded conversation history",
                conversation_id=conversation_id,
                message_count=len(items),
            )

            return items

        except Exception as error:
            logger.error(
                "Error querying conversation history",
                conversation_id=conversation_id,
                user_id=user_id,
                error=str(error),
                exc_info=True,
            )
            return []

    def _parse_dynamodb_item(self, item: Dict) -> Dict[str, Any]:
        """
        Parse DynamoDB item format to regular dict.

        Args:
            item: DynamoDB item with type descriptors

        Returns:
            Regular dictionary with parsed values
        """
        parsed = {}

        for key, value in item.items():
            if "S" in value:  # String
                parsed[key] = value["S"]
            elif "N" in value:  # Number
                parsed[key] = (
                    int(value["N"]) if value["N"].isdigit() else float(value["N"])
                )
            elif "BOOL" in value:  # Boolean
                parsed[key] = value["BOOL"]
            elif "L" in value:  # List
                parsed[key] = [self._parse_dynamodb_value(v) for v in value["L"]]
            elif "M" in value:  # Map/Object
                parsed[key] = {
                    k: self._parse_dynamodb_value(v) for k, v in value["M"].items()
                }
            elif "SS" in value:  # String Set
                parsed[key] = value["SS"]
            elif "NULL" in value:  # Null
                parsed[key] = None
            else:
                # Fallback for any other types
                parsed[key] = value

        return parsed

    def _parse_dynamodb_value(self, value: Dict) -> Any:
        """Helper to parse individual DynamoDB values."""
        if "S" in value:
            return value["S"]
        elif "N" in value:
            return int(value["N"]) if value["N"].isdigit() else float(value["N"])
        elif "BOOL" in value:
            return value["BOOL"]
        elif "L" in value:
            return [self._parse_dynamodb_value(v) for v in value["L"]]
        elif "M" in value:
            return {k: self._parse_dynamodb_value(v) for k, v in value["M"].items()}
        elif "NULL" in value:
            return None
        else:
            return value


# Constants for conversation memory
MAX_DYNAMO_MESSAGES = 100  # Maximum number of messages to fetch from DynamoDB


def format_messages_for_chat(
    messages: List[Dict[str, Any]], load_files: bool = False
) -> List[Dict[str, Any]]:
    """
    Format conversation messages for Bedrock Chat API.

    Args:
        messages: Sorted conversation history from DynamoDB
        load_files: Whether to load file content (False for chat agents to avoid size limits)

    Returns:
        Formatted messages for Bedrock
    """
    formatted_messages = []
    i = 0

    while i < len(messages):
        item = messages[i]
        message_type = item.get("message_type")

        if message_type == "image_description":
            file_info = item.get("fileInfo", {})
            file_name = file_info.get("fileName", "unknown file")
            formatted_messages.append(
                {
                    "role": "assistant",
                    "content": [
                        {
                            "text": f"User has uploaded file: {file_name}. Extracting image content..."
                        },
                        {
                            "text": "Image content:"
                            + (item.get("content", "") or "No content found")
                        },
                    ],
                }
            )

        elif message_type == "file":
            file_info = item.get("fileInfo", {})
            s3_bucket = file_info.get("s3Bucket")
            extracted_content_s3_key = file_info.get("extractedContentS3Key")
            file_type = file_info.get("fileType")
            file_name = file_info.get("fileName", "unknown file")
            region = os.environ.get("AWS_REGION", "us-east-1")

            if load_files:
                # TODO: Implement S3 file loading if needed
                # For now, use placeholder content
                logger.warning("File loading not implemented in backend yet")
                formatted_messages.append(
                    {
                        "role": "assistant",
                        "content": [
                            {
                                "text": f"User has uploaded file:: {file_name} ({file_type}). Extracting content..."
                            },
                            {
                                "text": "File content loading not implemented in backend yet"
                            },
                        ],
                    }
                )
            else:
                # Pass file reference instead of content - for chat agents mode
                formatted_messages.append(
                    {
                        "role": "assistant",
                        "content": [
                            {
                                "text": f"User has uploaded file:: {file_name} ({file_type}). Extracting content..."
                            },
                            {
                                "fileRef": {
                                    "s3Bucket": s3_bucket,
                                    "extractedContentS3Key": extracted_content_s3_key,
                                    "fileType": file_type,
                                    "fileName": file_name,
                                    "region": region,
                                }
                            },
                        ],
                    }
                )

        elif message_type == "text":
            # Text messages - assistant or user role as stored
            content = item.get("content", "")
            if content and content.strip():
                formatted_messages.append(
                    {"role": item.get("role", "user"), "content": [{"text": content}]}
                )

        elif message_type == "tool_call":
            # Group consecutive tool calls into a single assistant message
            tool_use_blocks = []
            j = i

            # Collect all consecutive tool_call messages
            while j < len(messages) and messages[j].get("message_type") == "tool_call":
                tool_item = messages[j]
                tool_payload = tool_item.get("tool_payload", {})
                tool_use_blocks.append(
                    {
                        "toolUse": {
                            "toolUseId": tool_item.get("tool_use_id", "unknown"),
                            "name": tool_item.get("tool_name", "unknown"),
                            "input": tool_payload.get("input", {}),
                        }
                    }
                )
                j += 1

            # Add single assistant message with all tool use blocks
            formatted_messages.append({"role": "assistant", "content": tool_use_blocks})

            # Move index to the last processed tool call
            i = j - 1

        elif message_type == "tool_result":
            # Group consecutive tool results into a single user message
            tool_result_blocks = []
            j = i

            # Collect all consecutive tool_result messages
            while (
                j < len(messages) and messages[j].get("message_type") == "tool_result"
            ):
                result_item = messages[j]
                tool_payload = result_item.get("tool_payload", {})
                tool_result_blocks.append(
                    {
                        "toolResult": {
                            "toolUseId": result_item.get("tool_use_id", "unknown"),
                            "content": tool_payload.get("content", []),
                            "status": tool_payload.get("status", "success"),
                        }
                    }
                )
                j += 1

            # Add single user message with all tool result blocks
            formatted_messages.append({"role": "user", "content": tool_result_blocks})

            # Move index to the last processed tool result
            i = j - 1

        elif message_type == "knowledge":
            # Knowledge base results - include as assistant message
            content = item.get("content", "")
            if content and content.strip():
                formatted_messages.append(
                    {
                        "role": item.get("role", "assistant"),
                        "content": [{"text": content}],
                    }
                )

        elif message_type == "meta":
            # Meta messages (like "New conversation started")
            content = item.get("content", "")
            if content and content.strip():
                formatted_messages.append(
                    {
                        "role": item.get("role", "assistant"),
                        "content": [{"text": content}],
                    }
                )

        elif message_type == "summary":
            # Summary messages from progressive summarization
            content = item.get("content", "")
            if content and content.strip():
                formatted_messages.append(
                    {
                        "role": "assistant",
                        "content": [{"text": content}],
                    }
                )

        # Skip any other message types we don't recognize
        i += 1

    return formatted_messages


def validate_message_level_tool_counts(
    messages: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Validate message-level tool block count matching between consecutive assistant/user messages.
    AWS Bedrock requires that each assistant message with toolUse blocks is followed by a user message
    with exactly matching toolResult blocks (same count and IDs).

    Args:
        messages: Array of formatted message objects

    Returns:
        Messages with invalid tool conversation sequences removed
    """
    validated_messages = []
    removed_message_pairs = 0
    i = 0

    while i < len(messages):
        current_message = messages[i]

        # Check if current message is assistant with tool calls
        if (
            current_message.get("role") == "assistant"
            and current_message.get("content")
            and isinstance(current_message.get("content"), list)
        ):

            tool_use_blocks = [
                block for block in current_message["content"] if "toolUse" in block
            ]

            if tool_use_blocks:
                # Look for the next user message with tool results
                next_message = messages[i + 1] if i + 1 < len(messages) else None

                if not next_message or next_message.get("role") != "user":
                    logger.warning(
                        "Assistant message with tool calls not followed by user message, removing tool call message",
                        message_index=i,
                        tool_count=len(tool_use_blocks),
                    )
                    removed_message_pairs += 1
                    i += 1
                    continue

                tool_result_blocks = []
                if next_message.get("content") and isinstance(
                    next_message.get("content"), list
                ):
                    tool_result_blocks = [
                        block
                        for block in next_message["content"]
                        if "toolResult" in block
                    ]

                # Validate tool block counts and IDs match
                tool_use_ids = {
                    block["toolUse"]["toolUseId"] for block in tool_use_blocks
                }
                tool_result_ids = {
                    block["toolResult"]["toolUseId"] for block in tool_result_blocks
                }

                counts_match = len(tool_use_blocks) == len(tool_result_blocks)
                ids_match = tool_use_ids == tool_result_ids

                if not counts_match or not ids_match:
                    logger.warning(
                        "Tool block count/ID mismatch between consecutive messages, removing message pair",
                        message_index=i,
                        tool_use_count=len(tool_use_blocks),
                        tool_result_count=len(tool_result_blocks),
                        tool_use_ids=list(tool_use_ids),
                        tool_result_ids=list(tool_result_ids),
                        counts_match=counts_match,
                        ids_match=ids_match,
                    )
                    removed_message_pairs += 2
                    i += 2  # Skip both messages
                    continue

                # Both messages are valid, add them
                validated_messages.append(current_message)
                validated_messages.append(next_message)
                i += 2  # Skip the next message since we already processed it
            else:
                # No tool calls, add normally
                validated_messages.append(current_message)
                i += 1
        else:
            # Non-assistant message or already processed, add normally
            validated_messages.append(current_message)
            i += 1

    if removed_message_pairs > 0:
        logger.warning(
            f"Message-level validation removed {removed_message_pairs} messages due to tool block mismatches"
        )

    return validated_messages


def validate_and_clean_tool_pairs(
    messages: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Validate and clean tool call/result pairs to prevent Chat validation errors.
    Remove orphaned toolResult blocks without matching toolUse blocks.
    Remove orphaned toolUse blocks without matching toolResult blocks.

    Args:
        messages: Array of formatted message objects

    Returns:
        Cleaned array of message objects with orphaned tool blocks removed
    """
    # Collect all toolUseIds from toolUse and toolResult blocks
    tool_use_ids = set()
    tool_result_ids = set()

    # First pass: collect all tool IDs
    for message in messages:
        if message.get("content") and isinstance(message.get("content"), list):
            for content_block in message["content"]:
                if "toolUse" in content_block and content_block["toolUse"].get(
                    "toolUseId"
                ):
                    tool_use_ids.add(content_block["toolUse"]["toolUseId"])
                if "toolResult" in content_block and content_block["toolResult"].get(
                    "toolUseId"
                ):
                    tool_result_ids.add(content_block["toolResult"]["toolUseId"])

    removed_tool_use = 0
    removed_tool_result = 0

    # Second pass: remove orphaned blocks and log warnings
    cleaned_messages = []
    for message in messages:
        if not message.get("content") or not isinstance(message.get("content"), list):
            cleaned_messages.append(message)
            continue

        cleaned_content = []
        for content_block in message["content"]:
            # Remove orphaned toolResult blocks (results without matching tool calls)
            if "toolResult" in content_block:
                if content_block["toolResult"]["toolUseId"] not in tool_use_ids:
                    logger.warning(
                        "Removing orphaned toolResult block (no matching toolUse)",
                        tool_use_id=content_block["toolResult"]["toolUseId"],
                    )
                    removed_tool_result += 1
                    continue

            # Remove orphaned toolUse blocks (tool calls without matching results)
            if "toolUse" in content_block:
                if content_block["toolUse"]["toolUseId"] not in tool_result_ids:
                    logger.warning(
                        "Removing orphaned toolUse block (no matching toolResult)",
                        tool_use_id=content_block["toolUse"]["toolUseId"],
                        tool_name=content_block["toolUse"].get("name", "unknown"),
                    )
                    removed_tool_use += 1
                    continue

            cleaned_content.append(content_block)

        # Only add message if it has content after cleaning
        if cleaned_content:
            cleaned_messages.append({**message, "content": cleaned_content})
        else:
            logger.warning("Removing message with empty content after tool cleanup")

    # Log summary of cleanup
    if removed_tool_use > 0 or removed_tool_result > 0:
        logger.warning(
            f"Tool cleanup summary - Removed {removed_tool_use} orphaned toolUse blocks and {removed_tool_result} orphaned toolResult blocks"
        )

    # Third pass: Validate message-level tool block count matching
    final_messages = validate_message_level_tool_counts(cleaned_messages)

    return final_messages


def format_conversation_for_bedrock(
    conversation_items: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Convert DynamoDB conversation items to Bedrock message format.

    With progressive summarization, messages are already limited, so we skip
    the old truncation logic and directly format + validate.

    Args:
        conversation_items: Raw DynamoDB items (already summarized if needed)

    Returns:
        List of messages in Bedrock format
    """
    # Sort by timestamp (oldest first)
    sorted_history = sorted(conversation_items, key=lambda x: x.get("timestamp", 0))

    # Format messages for Bedrock (chat agents mode - don't load files)
    formatted_messages = format_messages_for_chat(sorted_history, load_files=False)

    # Validate and clean tool call/result pairs
    cleaned_messages = validate_and_clean_tool_pairs(formatted_messages)

    if len(cleaned_messages) != len(formatted_messages):
        logger.warning(
            f"Cleaned conversation history from {len(formatted_messages)} to {len(cleaned_messages)} messages due to orphaned tool blocks"
        )

    return cleaned_messages
