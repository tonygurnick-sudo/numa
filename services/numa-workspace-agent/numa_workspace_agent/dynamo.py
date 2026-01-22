"""
DynamoDB operations for Numa Workspace Agent.

Handles updating conversation metadata in the shared chat history table.
"""

import time
from typing import Optional

import boto3
import structlog

from .sdk_config import DYNAMODB_TABLE_NAME, REGION

logger = structlog.get_logger()

# Initialize DynamoDB client
_dynamodb_client = None


def get_dynamodb_client():
    """Get or create DynamoDB client."""
    global _dynamodb_client
    if _dynamodb_client is None:
        _dynamodb_client = boto3.client("dynamodb", region_name=REGION)
    return _dynamodb_client


def update_conversation_meta(
    user_sub: str,
    conversation_id: str,
    latest_message: Optional[str] = None,
    conversation_name: Optional[str] = None,
) -> bool:
    """
    Update conversation metadata in DynamoDB after chat completion.

    This updates the 'meta' item for a conversation with:
    - latestTimestamp: Current timestamp in milliseconds
    - latestMessage: Preview of latest message (if provided)
    - conversationName: Conversation name (if provided)

    The frontend creates meta records with sort key format: {conversationId}#{timestamp}
    We need to query for the existing record to find its actual sort key.

    Args:
        user_sub: User's Cognito sub (partition key)
        conversation_id: Conversation ID
        latest_message: Optional preview of latest message
        conversation_name: Optional conversation name

    Returns:
        True if update succeeded, False otherwise
    """
    if not DYNAMODB_TABLE_NAME:
        logger.warning("DYNAMODB_TABLE_NAME not configured, skipping meta update")
        return False

    try:
        client = get_dynamodb_client()

        # Query for the existing meta record created by the frontend
        # Frontend uses sort key format: {conversationId}#{timestamp}
        query_response = client.query(
            TableName=DYNAMODB_TABLE_NAME,
            KeyConditionExpression="user_id = :u AND begins_with(sk, :c)",
            FilterExpression="message_type = :mtype",
            ExpressionAttributeValues={
                ":u": {"S": user_sub},
                ":c": {"S": f"{conversation_id}#"},
                ":mtype": {"S": "meta"},
            },
            Limit=1,
        )

        items = query_response.get("Items", [])
        if not items:
            logger.warning(
                "No meta record found for conversation - frontend may not have created it yet",
                user_sub=user_sub,
                conversation_id=conversation_id,
            )
            return False

        # Use the actual sort key from the found record
        actual_sk = items[0]["sk"]["S"]

        # Build update expression and attribute values
        update_parts = ["latestTimestamp = :ts"]
        expression_values = {
            ":ts": {"N": str(int(time.time() * 1000))},  # Milliseconds
        }

        if latest_message:
            update_parts.append("latestMessage = :msg")
            # Truncate message preview to 100 chars
            preview = (
                latest_message[:100] if len(latest_message) > 100 else latest_message
            )
            expression_values[":msg"] = {"S": preview}

        if conversation_name:
            update_parts.append("conversationName = :name")
            expression_values[":name"] = {"S": conversation_name}

        update_expression = "SET " + ", ".join(update_parts)

        client.update_item(
            TableName=DYNAMODB_TABLE_NAME,
            Key={
                "user_id": {"S": user_sub},
                "sk": {"S": actual_sk},
            },
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_values,
        )

        logger.info(
            "Updated conversation meta",
            _name="CONVERSATION_META_UPDATED",
            phase="cleanup",
            user_sub=user_sub,
            conversation_id=conversation_id,
        )
        return True

    except Exception as e:
        logger.error(
            "Failed to update conversation meta",
            _name="CONVERSATION_META_ERROR",
            phase="cleanup",
            user_sub=user_sub,
            conversation_id=conversation_id,
            error=str(e),
        )
        return False


# Note: Conversation creation is handled by the frontend via useConversationManager.ts
# which sets isWorkspaceConversation=true based on the NUMA_WORKSPACE_AGENT flag.
# The backend only needs to update existing conversation metadata.


def is_v1_conversation(user_sub: str, conversation_id: str) -> bool:
    """
    Check if a conversation is a V1 conversation (not a workspace conversation).

    V1 conversations have isWorkspaceConversation=False or missing in meta record.

    Args:
        user_sub: User's Cognito sub (partition key)
        conversation_id: Conversation ID

    Returns:
        True if this is a V1 conversation that needs migration, False otherwise
    """
    if not DYNAMODB_TABLE_NAME:
        logger.warning("DYNAMODB_TABLE_NAME not configured, cannot check V1 status")
        return False

    try:
        client = get_dynamodb_client()

        # Query for the meta record
        query_response = client.query(
            TableName=DYNAMODB_TABLE_NAME,
            KeyConditionExpression="user_id = :u AND begins_with(sk, :c)",
            FilterExpression="message_type = :mtype",
            ExpressionAttributeValues={
                ":u": {"S": user_sub},
                ":c": {"S": f"{conversation_id}#"},
                ":mtype": {"S": "meta"},
            },
            Limit=1,
        )

        items = query_response.get("Items", [])
        if not items:
            logger.debug(
                "No meta record found for conversation",
                user_sub=user_sub[:8] + "..." if user_sub else None,
                conversation_id=(
                    conversation_id[:8] + "..." if conversation_id else None
                ),
            )
            return False

        meta_item = items[0]
        # Check isWorkspaceConversation field - V1 chats have False or missing
        is_workspace = meta_item.get("isWorkspaceConversation", {}).get("BOOL", False)

        logger.debug(
            "Checked conversation V1 status",
            conversation_id=conversation_id[:8] + "..." if conversation_id else None,
            is_workspace=is_workspace,
            is_v1=not is_workspace,
        )

        return not is_workspace

    except Exception as e:
        logger.error(
            "Failed to check V1 conversation status",
            user_sub=user_sub[:8] + "..." if user_sub else None,
            conversation_id=conversation_id[:8] + "..." if conversation_id else None,
            error=str(e),
        )
        return False


def load_v1_conversation_history(
    user_sub: str, conversation_id: str, max_messages: int = 50
) -> list[dict]:
    """
    Load V1 conversation history from DynamoDB.

    Queries all message records for the conversation, sorted by timestamp.

    Args:
        user_sub: User's Cognito sub (partition key)
        conversation_id: Conversation ID
        max_messages: Maximum number of messages to load (default 50)

    Returns:
        List of message dicts with 'role' and 'content' fields, sorted by timestamp
    """
    if not DYNAMODB_TABLE_NAME:
        logger.warning("DYNAMODB_TABLE_NAME not configured, cannot load V1 history")
        return []

    try:
        client = get_dynamodb_client()

        # Query for all messages in this conversation (excluding meta)
        # Sort key format: {conversationId}#{timestamp}
        query_response = client.query(
            TableName=DYNAMODB_TABLE_NAME,
            KeyConditionExpression="user_id = :u AND begins_with(sk, :c)",
            FilterExpression="message_type <> :meta",
            ExpressionAttributeValues={
                ":u": {"S": user_sub},
                ":c": {"S": f"{conversation_id}#"},
                ":meta": {"S": "meta"},
            },
            ScanIndexForward=True,  # Sort ascending by timestamp
        )

        items = query_response.get("Items", [])
        if not items:
            logger.info(
                "No V1 messages found for conversation",
                conversation_id=(
                    conversation_id[:8] + "..." if conversation_id else None
                ),
            )
            return []

        messages = []
        for item in items[-max_messages:]:  # Take last N messages
            role = item.get("role", {}).get("S", "")
            content = item.get("content", {}).get("S", "")
            message_type = item.get("message_type", {}).get("S", "")

            # Skip non-text message types (tool calls, etc.)
            if message_type not in ("text", ""):
                # Format tool calls for context
                if message_type == "tool_call":
                    tool_name = item.get("toolName", {}).get("S", "tool")
                    tool_input = item.get("toolInput", {}).get("S", "")
                    messages.append(
                        {
                            "role": "assistant",
                            "content": f"[Tool: {tool_name}] {tool_input[:200]}",
                            "is_tool": True,
                        }
                    )
                elif message_type == "tool_result":
                    tool_name = item.get("toolName", {}).get("S", "tool")
                    messages.append(
                        {
                            "role": "system",
                            "content": f"[Tool result from {tool_name}]",
                            "is_tool": True,
                        }
                    )
                continue

            if role and content:
                messages.append(
                    {
                        "role": role,
                        "content": content,
                    }
                )

        logger.info(
            "Loaded V1 conversation history",
            _name="V1_HISTORY_LOADED",
            phase="migration",
            conversation_id=conversation_id[:8] + "..." if conversation_id else None,
            message_count=len(messages),
        )

        return messages

    except Exception as e:
        logger.error(
            "Failed to load V1 conversation history",
            user_sub=user_sub[:8] + "..." if user_sub else None,
            conversation_id=conversation_id[:8] + "..." if conversation_id else None,
            error=str(e),
        )
        return []


def mark_conversation_as_v2(user_sub: str, conversation_id: str) -> bool:
    """
    Mark a conversation as a V2 workspace conversation.

    Updates the meta record to set isWorkspaceConversation=True so future
    messages don't trigger migration logic.

    Args:
        user_sub: User's Cognito sub (partition key)
        conversation_id: Conversation ID

    Returns:
        True if update succeeded, False otherwise
    """
    if not DYNAMODB_TABLE_NAME:
        logger.warning("DYNAMODB_TABLE_NAME not configured, cannot mark as V2")
        return False

    try:
        client = get_dynamodb_client()

        # Query for the meta record to get its sort key
        query_response = client.query(
            TableName=DYNAMODB_TABLE_NAME,
            KeyConditionExpression="user_id = :u AND begins_with(sk, :c)",
            FilterExpression="message_type = :mtype",
            ExpressionAttributeValues={
                ":u": {"S": user_sub},
                ":c": {"S": f"{conversation_id}#"},
                ":mtype": {"S": "meta"},
            },
            Limit=1,
        )

        items = query_response.get("Items", [])
        if not items:
            logger.warning(
                "No meta record found for conversation - cannot mark as V2",
                user_sub=user_sub[:8] + "..." if user_sub else None,
                conversation_id=(
                    conversation_id[:8] + "..." if conversation_id else None
                ),
            )
            return False

        actual_sk = items[0]["sk"]["S"]

        # Update to mark as workspace conversation
        client.update_item(
            TableName=DYNAMODB_TABLE_NAME,
            Key={
                "user_id": {"S": user_sub},
                "sk": {"S": actual_sk},
            },
            UpdateExpression="SET isWorkspaceConversation = :v, latestTimestamp = :ts",
            ExpressionAttributeValues={
                ":v": {"BOOL": True},
                ":ts": {"N": str(int(time.time() * 1000))},
            },
        )

        logger.info(
            "Marked conversation as V2 workspace conversation",
            _name="V1_TO_V2_MIGRATED",
            phase="migration",
            user_sub=user_sub[:8] + "..." if user_sub else None,
            conversation_id=conversation_id[:8] + "..." if conversation_id else None,
        )
        return True

    except Exception as e:
        logger.error(
            "Failed to mark conversation as V2",
            user_sub=user_sub[:8] + "..." if user_sub else None,
            conversation_id=conversation_id[:8] + "..." if conversation_id else None,
            error=str(e),
        )
        return False
