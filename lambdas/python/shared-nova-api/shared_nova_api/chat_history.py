"""
Chat history management for Shared Document Q&A with compression.

Implements conversation memory similar to numa-chat-agent:
- Store messages in separate DynamoDB table (shared-chat-history)
- Summarize every 30 conversation turns
- Keep last 20 turns in full detail
- Use fast model (Nova 2 Lite) for summarization
- NEVER compress the document text (passed separately to each query)

Schema for shared-chat-history table:
- uuid (PK): Share UUID
- sk (SK): "MSG#{session_id}#{timestamp}" or "SUMMARY#{timestamp}"
- session_id: Browser session ID for analytics grouping
- role: "user" or "assistant"
- content: Message text
- timestamp: Unix timestamp
- expiry: TTL (matches share expiry, omitted for permanent shares)
- is_summary: True for compressed summaries
- ip_address: Visitor IP (for analytics)
- user_agent: Browser user agent (for analytics)
"""

from __future__ import annotations

import os
import time
from decimal import Decimal
from typing import Any, Dict, List

import structlog

from prm import resource as prm_resource

logger = structlog.get_logger()

# Configuration - matches numa-chat-agent settings
SUMMARIZATION_THRESHOLD = 30  # Summarize when 30+ turns
KEEP_RECENT_TURNS = 20  # Keep last 20 turns after summarization

REGION = os.environ.get("AWS_REGION", "us-east-1")
CHAT_HISTORY_TABLE_NAME = os.environ.get("SHARED_CHAT_HISTORY_TABLE_NAME", "")

_chat_history_table = None


def get_chat_history_table():
    """Get DynamoDB table resource for chat history."""
    global _chat_history_table  # pylint: disable=global-statement
    if _chat_history_table is None:
        dynamodb = prm_resource("dynamodb", region=REGION)
        _chat_history_table = dynamodb.Table(CHAT_HISTORY_TABLE_NAME)
    return _chat_history_table


def group_messages_into_turns(
    messages: List[Dict[str, Any]],
) -> List[List[Dict[str, Any]]]:
    """
    Group messages into conversation turns.

    A turn is: user message + assistant response.

    Args:
        messages: List of message dicts sorted by timestamp

    Returns:
        List of turns, where each turn is [user_msg, assistant_msg]
    """
    turns: List[List[Dict[str, Any]]] = []
    current_turn: List[Dict[str, Any]] = []

    for message in messages:
        role = message.get("role")

        if role == "user":
            # Start new turn on user message
            if current_turn:
                turns.append(current_turn)
                current_turn = []
            current_turn.append(message)
        elif role == "assistant":
            # Assistant response completes the turn
            current_turn.append(message)

    # Add final turn if it exists
    if current_turn:
        turns.append(current_turn)

    return turns


class SharedChatHistory:
    """
    Manages chat history for shared document Q&A with compression.

    Each share has its own conversation history stored in the shared-chat-history
    table. Messages include session_id for grouping by visitor for analytics.
    """

    def __init__(self, share_uuid: str, share_expiry: int | None):
        """
        Initialize chat history manager.

        Args:
            share_uuid: The share's unique identifier
            share_expiry: Unix timestamp when share expires (used for TTL), None for permanent
        """
        self.share_uuid = share_uuid
        self.share_expiry = share_expiry
        self.table = get_chat_history_table()

    def load_history(self, session_id: str | None = None) -> List[Dict[str, Any]]:
        """
        Load chat history for a share, applying compression if needed.

        Args:
            session_id: Optional session ID to filter by (for per-session history)

        Returns:
            List of messages (may include compressed summaries)
        """
        if not CHAT_HISTORY_TABLE_NAME:
            logger.warning("Chat history table not configured")
            return []

        try:
            # Query all messages for this share
            response = self.table.query(
                KeyConditionExpression="#uuid = :uuid",
                ExpressionAttributeNames={"#uuid": "uuid"},
                ExpressionAttributeValues={":uuid": self.share_uuid},
                ScanIndexForward=True,  # Oldest first
            )

            all_items = response.get("Items", [])

            # Convert Decimal to int for timestamps
            for item in all_items:
                if "timestamp" in item and isinstance(item["timestamp"], Decimal):
                    item["timestamp"] = int(item["timestamp"])

            # Separate summaries from regular messages
            summaries = [m for m in all_items if m.get("is_summary")]
            regular_messages = [m for m in all_items if not m.get("is_summary")]

            # Filter by session_id if provided
            if session_id:
                regular_messages = [
                    m for m in regular_messages if m.get("session_id") == session_id
                ]

            logger.info(
                "Loaded chat history",
                uuid=self.share_uuid,
                total_items=len(all_items),
                summaries=len(summaries),
                regular_messages=len(regular_messages),
                session_id=session_id,
            )

            # Check if compression is needed
            turns = group_messages_into_turns(regular_messages)
            if len(turns) >= SUMMARIZATION_THRESHOLD:
                logger.info(
                    "Compression threshold reached",
                    uuid=self.share_uuid,
                    turns=len(turns),
                    threshold=SUMMARIZATION_THRESHOLD,
                )
                return self._compress_and_reload(summaries, turns)

            # Return existing summary (if any) + recent messages
            result = []
            if summaries:
                # Add latest summary
                latest_summary = max(summaries, key=lambda m: m.get("timestamp", 0))
                result.append(latest_summary)

            result.extend(regular_messages)
            return result

        except Exception as e:
            logger.error(
                "Failed to load chat history", uuid=self.share_uuid, error=str(e)
            )
            return []

    def _compress_and_reload(
        self,
        existing_summaries: List[Dict[str, Any]],
        turns: List[List[Dict[str, Any]]],
    ) -> List[Dict[str, Any]]:
        """
        Compress older turns into a summary and return updated history.

        Args:
            existing_summaries: Previous summaries
            turns: Grouped message turns

        Returns:
            Updated message list with new summary + recent turns
        """
        # Keep last KEEP_RECENT_TURNS, compress the rest
        if len(turns) > KEEP_RECENT_TURNS:
            turns_to_compress = turns[:-KEEP_RECENT_TURNS]
            keep_recent = turns[-KEEP_RECENT_TURNS:]
        else:
            # Not enough turns to compress
            keep_recent = turns
            turns_to_compress = []

        if not turns_to_compress:
            # Nothing to compress
            result = []
            if existing_summaries:
                result.append(
                    max(existing_summaries, key=lambda m: m.get("timestamp", 0))
                )
            for turn in keep_recent:
                result.extend(turn)
            return result

        # Flatten turns to compress into messages
        messages_to_compress = []
        for turn in turns_to_compress:
            messages_to_compress.extend(turn)

        # Create summary using Nova 2 Lite
        summary_text = self._create_summary(existing_summaries, messages_to_compress)

        # Get timestamp for summary (latest message being compressed)
        latest_timestamp = max(m.get("timestamp", 0) for m in messages_to_compress)

        # Store summary
        self._store_summary(summary_text, len(messages_to_compress), latest_timestamp)

        # Delete compressed messages to save space
        self._delete_compressed_messages(messages_to_compress)

        # Build result: new summary + recent messages
        result = [
            {
                "role": "assistant",
                "content": summary_text,
                "is_summary": True,
                "timestamp": latest_timestamp,
                "summarized_count": len(messages_to_compress),
            }
        ]

        for turn in keep_recent:
            result.extend(turn)

        logger.info(
            "Compression complete",
            uuid=self.share_uuid,
            compressed_messages=len(messages_to_compress),
            kept_turns=len(keep_recent),
        )

        return result

    def _create_summary(
        self,
        existing_summaries: List[Dict[str, Any]],
        messages: List[Dict[str, Any]],
    ) -> str:
        """
        Create summary using Nova 2 Lite.

        Args:
            existing_summaries: Previous summaries to extend
            messages: Messages to compress

        Returns:
            Summary text
        """
        from prm import client as prm_client  # pylint: disable=import-outside-toplevel

        try:
            bedrock = prm_client("bedrock-runtime", region=REGION)

            # Format conversation text
            conversation_parts = []

            # Include existing summary if present
            if existing_summaries:
                latest = max(existing_summaries, key=lambda m: m.get("timestamp", 0))
                conversation_parts.append(
                    f"PREVIOUS SUMMARY:\n{latest.get('content', '')}\n"
                )

            # Add messages to summarize
            for msg in messages:
                role = msg.get("role", "unknown").upper()
                content = msg.get("content", "")
                conversation_parts.append(f"{role}: {content}")

            conversation_text = "\n\n".join(conversation_parts)

            # Summarization prompt
            prompt = f"""Summarize the following conversation into a concise memory log.
Preserve key information: user questions, topics discussed, answers given.
Write in third-person past tense.

CONVERSATION:
{conversation_text}

SUMMARY:"""

            response = bedrock.converse(
                modelId="global.amazon.nova-2-lite-v1:0",
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig={"maxTokens": 2000, "temperature": 0.1},
            )

            output = response.get("output", {})
            message = output.get("message", {})
            content = message.get("content", [])

            if content and isinstance(content[0], dict):
                return content[0].get("text", "Summary unavailable")

            return "Summary unavailable"

        except Exception as e:
            logger.error("Summarization failed", uuid=self.share_uuid, error=str(e))
            # Fallback: simple concatenation
            return f"Conversation with {len(messages)} messages (summarization failed)"

    def _store_summary(
        self, summary_text: str, summarized_count: int, timestamp: int
    ) -> None:
        """Store a summary in DynamoDB."""
        try:
            item: Dict[str, Any] = {
                "uuid": self.share_uuid,
                "sk": f"SUMMARY#{timestamp}",
                "role": "assistant",
                "content": summary_text,
                "is_summary": True,
                "summarized_count": summarized_count,
                "timestamp": timestamp,
            }

            # Only set expiry for TTL if share has an expiry
            if self.share_expiry is not None:
                item["expiry"] = self.share_expiry

            self.table.put_item(Item=item)
            logger.info("Summary stored", uuid=self.share_uuid, timestamp=timestamp)
        except Exception as e:
            logger.error("Failed to store summary", uuid=self.share_uuid, error=str(e))

    def _delete_compressed_messages(self, messages: List[Dict[str, Any]]) -> None:
        """Delete messages that have been compressed into a summary."""
        try:
            with self.table.batch_writer() as batch:
                for msg in messages:
                    sk = msg.get("sk")
                    if sk:
                        batch.delete_item(Key={"uuid": self.share_uuid, "sk": sk})

            logger.info(
                "Deleted compressed messages",
                uuid=self.share_uuid,
                count=len(messages),
            )
        except Exception as e:
            logger.error("Failed to delete compressed messages", error=str(e))

    def add_message(
        self,
        role: str,
        content: str,
        session_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> None:
        """
        Store a new chat message.

        Args:
            role: "user" or "assistant"
            content: Message text
            session_id: Browser session ID for analytics grouping
            ip_address: Visitor IP address
            user_agent: Browser user agent
        """
        if not CHAT_HISTORY_TABLE_NAME:
            logger.warning(
                "Chat history table not configured, skipping message storage"
            )
            return

        timestamp = int(time.time() * 1000)  # Milliseconds for uniqueness
        sk = f"MSG#{session_id or 'unknown'}#{timestamp}"

        item: Dict[str, Any] = {
            "uuid": self.share_uuid,
            "sk": sk,
            "role": role,
            "content": content,
            "timestamp": timestamp,
        }

        # Only set expiry for TTL if share has an expiry
        if self.share_expiry is not None:
            item["expiry"] = self.share_expiry

        if session_id:
            item["session_id"] = session_id
        if ip_address:
            item["ip_address"] = ip_address
        if user_agent:
            item["user_agent"] = user_agent

        try:
            self.table.put_item(Item=item)
            logger.debug(
                "Message stored",
                uuid=self.share_uuid,
                role=role,
                session_id=session_id,
            )
        except Exception as e:
            logger.error(
                "Failed to store message",
                uuid=self.share_uuid,
                error=str(e),
            )

    def get_all_messages(self) -> List[Dict[str, Any]]:
        """
        Get all messages for this share (for analytics).

        Returns:
            List of all messages including metadata
        """
        if not CHAT_HISTORY_TABLE_NAME:
            return []

        try:
            response = self.table.query(
                KeyConditionExpression="#uuid = :uuid",
                ExpressionAttributeNames={"#uuid": "uuid"},
                ExpressionAttributeValues={":uuid": self.share_uuid},
                ScanIndexForward=True,
            )

            items = response.get("Items", [])

            # Convert Decimal to int
            for item in items:
                if "timestamp" in item and isinstance(item["timestamp"], Decimal):
                    item["timestamp"] = int(item["timestamp"])
                if "expiry" in item and isinstance(item["expiry"], Decimal):
                    item["expiry"] = int(item["expiry"])

            return items

        except Exception as e:
            logger.error(
                "Failed to get all messages", uuid=self.share_uuid, error=str(e)
            )
            return []
