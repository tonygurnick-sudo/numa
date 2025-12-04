"""
Progressive Summarization with DynamoDB caching.

Implements efficient conversation memory management:
- Summarize every 30 conversation turns (configurable)
- Keep last 10 turns in full detail
- Store summaries in DynamoDB (no re-summarization)
- Use fast model (Nova 2 Lite) with explicit prompting for quality summaries

A "turn" = user input + tool calls + tool results + agent response
"""

from typing import Any, Dict, List, Tuple

import structlog

from .config import FAST_MODEL_ID, invoke_fast_model
from .dynamodb_utils import NumaChatDynamoUtils
from .utils import log_token_usage

logger = structlog.get_logger()

# Configuration - adjust these values to tune behavior
SUMMARIZATION_THRESHOLD = (
    30  # Summarize when 30+ unsummarized turns (user input + agent response cycles)
)
KEEP_RECENT_TURNS = 20  # Keep last 20 turns in full after summarization


def group_messages_into_turns(
    messages: List[Dict[str, Any]],
) -> List[List[Dict[str, Any]]]:
    """
    Group messages into conversation turns.

    A turn is defined as:
    - User message (text/file)
    - Followed by: assistant response + any tool calls + tool results + final response

    This treats (user input → tool calls → tool results → agent response) as 1 turn.

    Args:
        messages: List of message dicts sorted by timestamp

    Returns:
        List of turns, where each turn is a list of related messages
    """
    turns: List[List[Dict[str, Any]]] = []
    current_turn: List[Dict[str, Any]] = []

    for message in messages:
        message_type = message.get("message_type")
        role = message.get("role")

        # Start new turn on user text message (not tool results, those belong to previous turn)
        if role == "user" and message_type in ["text", "file", "image_description"]:
            # Save previous turn if it exists
            if current_turn:
                turns.append(current_turn)
                current_turn = []
            # Start new turn with user message
            current_turn.append(message)

        # Everything else belongs to current turn (assistant, tool calls, tool results, meta)
        else:
            current_turn.append(message)

    # Add final turn if it exists
    if current_turn:
        turns.append(current_turn)

    return turns


class ProgressiveSummarization:
    """
    Progressive conversation summarization with DynamoDB caching.

    Pattern:
    1. Load conversation from DynamoDB
    2. Group messages into turns (user input → tools → response = 1 turn)
    3. Check if unsummarized turns >= threshold (30)
    4. If yes: Create summary with fast model, store in DynamoDB
    5. If no: Load cached summary + recent messages (fast path)
    6. Repeat as conversation grows

    Example:
        summarizer = ProgressiveSummarization(dynamo_utils)
        messages, was_summarized = summarizer.load_conversation_with_summaries(
            conversation_id="conv_123",
            user_id="user_456"
        )
    """

    def __init__(self, dynamo_utils: NumaChatDynamoUtils):
        """
        Initialize progressive summarization.

        Args:
            dynamo_utils: DynamoDB utilities instance for storage
        """
        self.dynamo_utils = dynamo_utils

        logger.info(
            "Progressive summarization initialized",
            threshold=SUMMARIZATION_THRESHOLD,
            keep_recent_turns=KEEP_RECENT_TURNS,
        )

    def load_conversation_with_summaries(
        self, conversation_id: str, user_id: str
    ) -> Tuple[List[Dict[str, Any]], bool]:
        """
        Load conversation efficiently with progressive summarization.

        This is the main entry point. It:
        1. Loads messages from DynamoDB
        2. Checks if summarization is needed
        3. Returns either: cached summary + recent OR new summary + recent

        Args:
            conversation_id: Unique conversation identifier
            user_id: User's Cognito sub ID

        Returns:
            Tuple of (messages_for_agent, was_summarized)
            - messages_for_agent: List of message dicts to pass to agent
            - was_summarized: True if new summary was created this call
        """

        # Load all messages from DynamoDB
        all_messages = self.dynamo_utils.query_conversations(
            conversation_id=conversation_id, user_id=user_id, limit=100
        )

        if not all_messages:
            logger.info("No messages found", conversation_id=conversation_id)
            return [], False

        # Separate summaries from regular messages
        summaries = [m for m in all_messages if m.get("message_type") == "summary"]
        regular_messages = [
            m for m in all_messages if m.get("message_type") != "summary"
        ]

        # Count unsummarized messages
        if summaries:
            latest_summary = max(summaries, key=lambda m: m["timestamp"])
            cutoff_timestamp = latest_summary["timestamp"]
            unsummarized_messages = [
                m for m in regular_messages if m["timestamp"] > cutoff_timestamp
            ]
        else:
            unsummarized_messages = regular_messages

        # Group unsummarized messages into turns for counting
        unsummarized_turns = group_messages_into_turns(unsummarized_messages)

        logger.info(
            "Loaded conversation state",
            conversation_id=conversation_id,
            total_messages=len(all_messages),
            summaries_count=len(summaries),
            unsummarized_messages=len(unsummarized_messages),
            unsummarized_turns=len(unsummarized_turns),
        )

        # Check if we need to summarize (based on turn count, not message count)
        needs_summarization = len(unsummarized_turns) >= SUMMARIZATION_THRESHOLD

        if needs_summarization:
            logger.info(
                "Summarization threshold reached",
                conversation_id=conversation_id,
                unsummarized_turns=len(unsummarized_turns),
                threshold=SUMMARIZATION_THRESHOLD,
            )
            return (
                self._summarize_and_store(
                    conversation_id, user_id, summaries, unsummarized_turns
                ),
                True,
            )
        else:
            # Fast path: return cached summary + recent messages
            result = []
            if summaries:
                result.append(summaries[-1])  # Latest summary
            result.extend(unsummarized_messages)  # All unsummarized messages

            logger.info(
                "Using cached summary",
                conversation_id=conversation_id,
                returned_items=len(result),
            )

            return result, False

    def _summarize_and_store(
        self,
        conversation_id: str,
        user_id: str,
        existing_summaries: List[Dict],
        unsummarized_turns: List[List[Dict]],
    ) -> List[Dict[str, Any]]:
        """
        Create new summary using fast model and store in DynamoDB.

        This is the slow path - only runs when threshold is reached.

        Args:
            conversation_id: Unique conversation identifier
            user_id: User's Cognito sub ID
            existing_summaries: Previous summaries (if any)
            unsummarized_turns: Turns (grouped messages) that haven't been summarized yet

        Returns:
            List of messages to pass to agent: [NEW_SUMMARY] + recent messages
        """

        # Prepare messages for summarization
        # Include: old summary (if exists) + messages to compress
        to_summarize = []

        # Add latest existing summary as context (so we don't lose old info)
        if existing_summaries:
            latest_summary = max(existing_summaries, key=lambda m: m["timestamp"])
            to_summarize.append(latest_summary)

        # Keep last KEEP_RECENT_TURNS turns, summarize the rest
        if len(unsummarized_turns) > KEEP_RECENT_TURNS:
            turns_to_compress = unsummarized_turns[:-KEEP_RECENT_TURNS]
            keep_recent_turns = unsummarized_turns[-KEEP_RECENT_TURNS:]
        else:
            # Edge case: fewer turns than KEEP_RECENT_TURNS
            turns_to_compress = unsummarized_turns
            keep_recent_turns = []

        # Flatten turns into messages for summarization
        messages_to_compress = []
        for turn in turns_to_compress:
            messages_to_compress.extend(turn)

        keep_recent_messages = []
        for turn in keep_recent_turns:
            keep_recent_messages.extend(turn)

        # Add messages to compress to the summarization input
        to_summarize.extend(messages_to_compress)

        logger.info(
            "Summarization breakdown",
            conversation_id=conversation_id,
            turns_to_compress=len(turns_to_compress),
            keep_recent_turns=len(keep_recent_turns),
            messages_to_compress=len(messages_to_compress),
            keep_recent_messages=len(keep_recent_messages),
        )

        # Format messages for Bedrock API
        from .dynamodb_utils import (  # pylint: disable=import-outside-toplevel
            format_conversation_for_bedrock,
        )

        formatted_messages = format_conversation_for_bedrock(to_summarize)

        # Check if we're doing recursive summarization (extending an existing summary)
        has_existing_summary = len(existing_summaries) > 0

        # Use fast model to create summary
        summary_text = self._create_summary_with_fast_model(
            formatted_messages, has_existing_summary=has_existing_summary
        )

        # Store summary in DynamoDB
        summary_timestamp = (
            max(m["timestamp"] for m in messages_to_compress)
            if messages_to_compress
            else keep_recent_messages[-1]["timestamp"]
        )

        self._store_summary_in_dynamodb(
            conversation_id=conversation_id,
            user_id=user_id,
            summary_text=summary_text,
            summarized_count=len(messages_to_compress),
            latest_timestamp=summary_timestamp,
        )

        # Return: new summary + recent messages
        result = [
            {
                "role": "assistant",
                "content": summary_text,
                "message_type": "summary",
                "timestamp": summary_timestamp,
                "is_summary": True,
                "summarized_count": len(messages_to_compress),
            }
        ]

        if keep_recent_messages:
            result.extend(keep_recent_messages)

        logger.info(
            "Summarization complete",
            conversation_id=conversation_id,
            summary_length=len(summary_text),
            returned_items=len(result),
        )

        return result

    def _create_summary_with_fast_model(  # pylint: disable=too-many-nested-blocks
        self, messages: List[Dict[str, Any]], has_existing_summary: bool = False
    ) -> str:
        """
        Create summary by calling fast model (Nova 2 Lite) via Bedrock API.

        Args:
            messages: Formatted messages for Bedrock
            has_existing_summary: True if first message is an existing summary to extend

        Returns:
            Summary text
        """

        if not messages:
            return "Empty conversation"

        try:
            # Format messages into readable conversation text
            conversation_parts = []

            for msg in messages:
                role = msg.get("role", "unknown")
                content = msg.get("content", [])

                # Handle different content formats
                if isinstance(content, str):
                    text = content
                elif isinstance(content, list):
                    text_parts = []
                    for block in content:
                        if isinstance(block, dict) and "text" in block:
                            text_parts.append(block["text"])
                    text = "\n".join(text_parts)
                else:
                    continue

                if text.strip():
                    conversation_parts.append(f"{role.upper()}: {text}")

            conversation_text = "\n\n".join(conversation_parts)

            # Add context note if extending an existing summary
            recursive_note = ""
            if has_existing_summary:
                recursive_note = "\n\nNOTE: The first ASSISTANT message below is an existing summary from earlier in the conversation. Preserve all information from it and extend it with the new conversation content that follows."

            # Create explicit summarization prompt
            summarization_prompt = f"""Transform the following conversation into a dense, factual memory log optimized for future recall. Your goal is to maximize information retention while minimizing token usage.{recursive_note}

                CRITICAL RETENTION REQUIREMENTS:

                1. USER INPUTS & INTENT:
                - Extract specific requests, questions, and goals stated by the user
                - Capture user preferences, constraints, and requirements (e.g., "preferred Python over JavaScript", "budget limit $500")
                - Note any corrections or clarifications the user provided
                - Preserve exact terminology the user employs for domain-specific concepts

                2. TOOL CALLS & EXECUTION CHAIN:
                - Document each tool invoked with its purpose in context
                - Record input parameters with actual values (e.g., "search_query: 'authentication middleware'", "limit: 10")
                - Summarize tool responses: successful outputs, data returned, error messages
                - Link tool results to subsequent actions (e.g., "API returned 404 → user switched to alternative endpoint")
                - Preserve IDs, timestamps, status codes, and technical identifiers

                3. AGENT RESPONSES & REASONING:
                - Capture substantive explanations and technical guidance provided
                - Note recommendations made and rationale given
                - Extract code snippets, commands, or configuration examples shared
                - Document problem-solving steps and debugging approaches used

                4. DECISIONS & OUTCOMES:
                - Record choices made and alternatives considered
                - Note conclusions reached and their supporting evidence
                - Track state changes (e.g., "switched from REST to GraphQL", "enabled debug mode")
                - Document any planned next steps or unresolved issues

                5. CONTEXTUAL METADATA:
                - Preserve relationships between topics across conversation turns
                - Note topic transitions and why they occurred
                - Track evolving requirements or changing user goals
                - Maintain temporal sequence when order matters

                STRICT ELIMINATION RULES:

                - Remove ALL conversational filler: greetings, thanks, apologies, pleasantries
                - Cut phrases like "I understand", "Let me help", "Here's what I found", "Does that make sense?"
                - Eliminate redundant confirmations: "Sure", "Absolutely", "Of course"
                - Strip meta-commentary about the conversation itself unless it contains user preferences
                - Remove formatting instructions that were followed but don't need memory (e.g., "make it bold")
                - Omit system/UI elements that don't contain information (e.g., "Loading...", "...", decorative separators)

                OUTPUT FORMAT INSTRUCTIONS:

                - Write in third-person past tense, telegraphic style
                - Use hierarchical structure: Main topic → Subtopic/Action → Specific detail/Result
                - Omit articles (a/an/the), auxiliary verbs, and conjunctions where meaning stays clear
                - Use shorthand for common patterns:
                * "User requested X" → "Requested X"
                * "Tool returned Y" → "Returned Y"
                * "Agent explained Z" → "Explained Z"
                - Preserve exact syntax for: code, commands, file paths, URLs, API endpoints, error messages, version numbers
                - Use brackets for parameters/variables: [parameter: value]
                - Separate distinct topics with clear section breaks

                EXAMPLE STRUCTURE:
                - Topic: [What was discussed]
                - User requested: [Specific need]
                - Tool: [tool_name] called [parameters: values]
                    → Returned: [Key results, data, or errors]
                - Explained: [Core technical concept or solution]
                - Decision: [Choice made] because [reason]
                - Outcome: [Result or next state]

                CONVERSATION:
                {conversation_text}

                DENSE MEMORY SUMMARY:"""

            # Call fast model via helper
            summary_text, usage_stats, _ = invoke_fast_model(
                prompt=summarization_prompt,
                max_tokens=10000,
                temperature=0.1,
            )

            log_token_usage(
                model_id=FAST_MODEL_ID,
                usage_stats=usage_stats,
                context="Progressive summarization",
            )

            logger.info(
                "Summarization completed",
                original_messages=len(messages),
                conversation_length=len(conversation_text),
                summary_length=len(summary_text),
                input_tokens=usage_stats.get("input_tokens", 0),
                output_tokens=usage_stats.get("output_tokens", 0),
                summary_preview=(
                    summary_text[:500] if len(summary_text) > 500 else summary_text
                ),
            )

            # Log full summary for debugging
            logger.debug(
                "Full summary generated",
                summary_text=summary_text,
            )

            return summary_text

        except Exception as e:
            logger.error(
                "Summarization failed, using fallback",
                error=str(e),
                exc_info=True,
            )
            return self._create_fallback_summary(messages)

    def _create_fallback_summary(self, messages: List[Dict[str, Any]]) -> str:
        """
        Fallback: Create simple summary if fast model API call fails.

        Args:
            messages: Formatted messages

        Returns:
            Basic summary text
        """

        # Simple fallback: just concatenate key points
        parts = []
        for msg in messages[:5]:  # First 5 messages
            content = msg.get("content", [])
            if isinstance(content, list) and content:
                text = content[0].get("text", "")
                if text:
                    parts.append(text[:100])  # First 100 chars

        return (
            "Conversation summary: " + " ... ".join(parts)
            if parts
            else "No summary available"
        )

    def _store_summary_in_dynamodb(
        self,
        conversation_id: str,
        user_id: str,
        summary_text: str,
        summarized_count: int,
        latest_timestamp: int,
    ):
        """
        Store summary as a special message in DynamoDB.

        The summary is stored just like a regular message but with:
        - message_type: "summary"
        - is_summary: True
        - Special SK format: {conversation_id}#SUMMARY#{timestamp}

        Args:
            conversation_id: Unique conversation identifier
            user_id: User's Cognito sub ID
            summary_text: The generated summary
            summarized_count: Number of messages this summary represents
            latest_timestamp: Timestamp of the latest message included in summary
        """

        from boto3.dynamodb.types import (  # pylint: disable=import-outside-toplevel
            TypeSerializer,
        )

        serializer = TypeSerializer()

        timestamp = latest_timestamp
        sk = f"{conversation_id}#SUMMARY#{timestamp}"

        item = {
            "user_id": user_id,
            "sk": sk,
            "conversation_id": conversation_id,
            "timestamp": timestamp,
            "message_type": "summary",
            "role": "assistant",
            "content": summary_text,
            "is_summary": True,
            "summarized_count": summarized_count,
            "summarized_up_to": latest_timestamp,
        }

        try:
            self.dynamo_utils.dynamodb.put_item(
                TableName=self.dynamo_utils.table_name,
                Item={k: serializer.serialize(v) for k, v in item.items()},
            )

            logger.info(
                "Summary stored in DynamoDB",
                conversation_id=conversation_id,
                summarized_count=summarized_count,
                summary_length=len(summary_text),
            )

        except Exception as e:
            logger.error(
                "Failed to store summary in DynamoDB",
                conversation_id=conversation_id,
                error=str(e),
                exc_info=True,
            )
            raise
