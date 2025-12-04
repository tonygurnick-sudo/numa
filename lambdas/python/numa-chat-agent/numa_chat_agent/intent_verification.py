"""
Shared intent verification utility for material tool calls.

Verifies that users explicitly requested high-impact actions before executing them.
Used for agent creation, sending messages, replying, deleting, etc.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import structlog

from .config import invoke_fast_model
from .dynamodb_utils import NumaChatDynamoUtils

logger = structlog.get_logger()


@dataclass
class IntentVerificationConfig:
    """Configuration for intent verification."""

    action_type: str
    """Identifier for the action type (e.g., 'create_agent', 'send', 'delete')."""

    action_description: str
    """Human-readable description used in the prompt (e.g., 'send a message')."""

    denial_message: str
    """Message to return when verification fails."""

    prompt_template: Optional[str] = None
    """Optional custom prompt template. If None, uses default based on action_type."""


@dataclass
class IntentVerificationResult:
    """Result of intent verification."""

    verified: bool
    """True if the user explicitly requested the action."""

    decision: str
    """The classifier decision: 'YES' or 'NO'."""

    denial_message: Optional[str]
    """Message to show user if verification failed. None if verified."""


# ── Predefined configurations for common action types ─────────────────────────


def get_agent_creation_config() -> IntentVerificationConfig:
    """Get configuration for agent creation verification."""
    return IntentVerificationConfig(
        action_type="create_agent",
        action_description="create a saved agent",
        denial_message=(
            "I won't create the agent without your explicit confirmation. "
            "Please say something like 'Yes, create this agent' when you're ready."
        ),
    )


def get_send_config(tool_name: str) -> IntentVerificationConfig:
    """Get configuration for send action verification."""
    return IntentVerificationConfig(
        action_type="send",
        action_description=f"send a message via {tool_name}",
        denial_message=(
            "I won't send anything without your explicit confirmation. "
            "Please say something like 'Yes, send it' when you're ready."
        ),
    )


def get_reply_config(tool_name: str) -> IntentVerificationConfig:
    """Get configuration for reply action verification."""
    return IntentVerificationConfig(
        action_type="reply",
        action_description=f"send a reply via {tool_name}",
        denial_message=(
            "I won't send a reply without your explicit confirmation. "
            "Please say something like 'Yes, send it' when you're ready."
        ),
    )


def get_delete_config(tool_name: str) -> IntentVerificationConfig:
    """Get configuration for delete action verification."""
    return IntentVerificationConfig(
        action_type="delete",
        action_description=f"delete via {tool_name}",
        denial_message=(
            "I won't delete anything without your explicit confirmation. "
            "Please clearly ask me to delete if that's what you want."
        ),
    )


# ── Prompt templates ──────────────────────────────────────────────────────────


def _build_guardrail_prompt(
    config: IntentVerificationConfig,
    context_snippets: str,
    latest_user_message: str,
) -> str:
    """Build the guardrail prompt for intent classification.

    Args:
        config: The verification configuration.
        context_snippets: Recent conversation transcript.
        latest_user_message: The most recent user message.

    Returns:
        The prompt string to send to the classifier.
    """
    if config.prompt_template:
        return config.prompt_template.format(
            action_description=config.action_description,
            context_snippets=context_snippets,
            latest_user_message=latest_user_message.strip(),
        )

    # Default prompts based on action type
    if config.action_type == "create_agent":
        return f"""You are an expert at determining if the user explicitly asked to create an agent, or if Numa (the assistant) has created out of turn. You will be given the last few messages between the user and the AI assistant and it's your job to determine if the user was asking for the agent to be created or not. This is necessary to avoid the AI assistant from creating agent unnecessarily.

        Return ONLY the word YES or NO. Respond YES only if the user clearly directs the assistant to create, set up, or has confirmed the creation of an agent the the assistant drafted. Otherwise, response NO. If the user says things like "Yes" after being drafted an agent, response YES. Or if you can see in the conversation them saying clearly to the assistant to create an agent based on what the assistant has drafted, return yes.

        Conversation excerpts:\n{context_snippets}

        Latest user message:\n{latest_user_message.strip()}

        Decision (YES or NO):"""

    if config.action_type == "delete":
        return f"""You are an expert at determining if the user explicitly asked to delete something, or if Numa (the assistant) is deleting proactively without clear direction. Deletion is irreversible, so we must be certain.

        Return ONLY the word YES or NO. Respond YES only if the user clearly directs the assistant to delete, remove, or trash something. Look for explicit delete/remove commands. Confirmation like "Yes, delete it" after being shown what will be deleted counts as YES. If the assistant is proactively deleting without clear user direction, respond NO.

        Conversation excerpts:\n{context_snippets}

        Latest user message:\n{latest_user_message.strip()}

        Decision (YES or NO):"""

    # Default for send/reply actions
    return f"""You are an expert at determining if the user explicitly asked to {config.action_description}, or if Numa (the assistant) is acting proactively without clear direction.

        Return ONLY the word YES or NO. Respond YES only if the user clearly asked to send, reply to, or forward a message. Confirmation like "Yes, send it" or "Go ahead" after a draft counts as YES. If the assistant is proactively sending without clear user direction, respond NO.

        Conversation excerpts:\n{context_snippets}

        Latest user message:\n{latest_user_message.strip()}

        Decision (YES or NO):"""


# ── Classifier ────────────────────────────────────────────────────────────────


def _call_fast_model_classifier(prompt: str) -> str:
    """Classify intent via fast model (Nova 2 Lite) with forced tool output.

    Args:
        prompt: The guardrail prompt.

    Returns:
        'YES' or 'NO' based on classifier decision.
    """
    tool_name = "confirm_intent"
    tools_schema = [
        {
            "name": tool_name,
            "description": "Confirm if the user explicitly requested this action",
            "input_schema": {
                "type": "object",
                "properties": {"answer": {"type": "string", "enum": ["YES", "NO"]}},
                "required": ["answer"],
            },
        }
    ]

    try:
        text, _, tool_uses = invoke_fast_model(
            prompt=prompt,
            max_tokens=10000,
            temperature=0,
            tools=tools_schema,
            tool_choice={"type": "tool", "name": tool_name},
        )

        # Check tool use response first
        if tool_uses and isinstance(tool_uses, list):
            for tool_use in tool_uses:  # pylint: disable=not-an-iterable
                if tool_use.get("name") == tool_name:
                    data = tool_use.get("input") or {}
                    ans = str(data.get("answer", "")).strip().upper()
                    if ans in ("YES", "NO"):
                        return ans

        # Fallback: check text response
        if text:
            text_upper = text.strip().upper()
            if text_upper.startswith("YES"):
                return "YES"
            if text_upper.startswith("NO"):
                return "NO"

    except Exception as e:
        logger.warning("Classifier call failed, falling back to NO", error=str(e))

    return "NO"


# ── Conversation context extraction ───────────────────────────────────────────


def get_recent_conversation_snippets(
    conversation_id: str,
    user_id: str,
    max_items: int = 12,
) -> Tuple[str, str, List[Dict[str, Any]]]:
    """Extract recent conversation context for intent verification.

    Args:
        conversation_id: The conversation ID.
        user_id: The user ID.
        max_items: Maximum number of conversation items to consider.

    Returns:
        Tuple of (transcript, latest_user_message, raw_items).
    """
    dynamo_utils = NumaChatDynamoUtils()
    items = dynamo_utils.query_conversations(
        conversation_id, limit=max(50, max_items), user_id=user_id
    )

    if not items:
        return "", "", []

    # Build a lightweight transcript that excludes tool plumbing
    # and focuses on natural user/assistant text turns.
    allow_message_types = {"text", "file", "image_description", "meta"}

    latest_user_text = ""
    filtered_snippets: List[Tuple[str, str]] = []

    for item in items[-max_items:]:
        message_type = item.get("message_type") or "text"
        role = item.get("role") or "system"

        # Skip tool plumbing to avoid confusing the classifier
        if message_type not in allow_message_types:
            continue

        # Normalise content
        content = (item.get("content") or "").strip()
        if message_type == "file" and item.get("fileInfo"):
            content = f"[Uploaded file: {item['fileInfo'].get('fileName', 'unknown')}]"
        if not content:
            continue

        # Keep only user/assistant roles for context
        if role not in ("user", "assistant"):
            continue

        filtered_snippets.append((role, content))
        if role == "user" and message_type == "text":
            latest_user_text = content

    # If we didn't find a user text message in the last window, search older ones
    if not latest_user_text:
        for item in reversed(items):
            if (
                (item.get("role") == "user")
                and (item.get("message_type") == "text")
                and str(item.get("content") or "").strip()
            ):
                latest_user_text = str(item.get("content") or "").strip()
                break

    # Keep the last ~8 conversational snippets for the guardrail prompt
    transcript = "\n".join(f"{role}: {text}" for role, text in filtered_snippets[-8:])
    return transcript, latest_user_text, items


# ── Main verification functions ───────────────────────────────────────────────


def verify_user_intent_with_context(
    config: IntentVerificationConfig,
    transcript: str,
    latest_user_message: str,
) -> IntentVerificationResult:
    """Verify user intent using pre-fetched conversation context.

    Use this when you've already fetched conversation history and need to
    avoid duplicate fetches (e.g., when history is also needed for other purposes).

    Args:
        config: Configuration specifying action type and messages.
        transcript: Pre-fetched conversation transcript.
        latest_user_message: Pre-fetched latest user message.

    Returns:
        IntentVerificationResult with verified status and decision.
    """
    try:
        guard_prompt = _build_guardrail_prompt(config, transcript, latest_user_message)
        decision = _call_fast_model_classifier(guard_prompt)

        logger.info(
            "Intent verification completed",
            action_type=config.action_type,
            decision=decision,
            has_latest_user_message=bool(latest_user_message),
            prompt=guard_prompt,
        )

    except Exception as e:
        logger.warning(
            "Intent verification failed; defaulting to NO",
            action_type=config.action_type,
            error=str(e),
        )
        decision = "NO"

    verified = decision == "YES"
    return IntentVerificationResult(
        verified=verified,
        decision=decision,
        denial_message=None if verified else config.denial_message,
    )


def verify_user_intent(
    config: IntentVerificationConfig,
    conversation_id: Optional[str],
    user_id: Optional[str],
) -> IntentVerificationResult:
    """Verify that the user explicitly requested the given action.

    This function fetches conversation context internally. If you already have
    the conversation context, use verify_user_intent_with_context instead.

    Args:
        config: Configuration specifying action type and messages.
        conversation_id: The conversation ID (None to skip verification).
        user_id: The user ID (None to skip verification).

    Returns:
        IntentVerificationResult with verified status and decision.
    """
    # If no context available, cannot verify - default to allowing
    # (matches existing agent_creation behavior)
    if not conversation_id or not user_id:
        logger.info(
            "Skipping intent verification - no conversation context",
            action_type=config.action_type,
            has_conversation_id=bool(conversation_id),
            has_user_id=bool(user_id),
        )
        return IntentVerificationResult(
            verified=True,
            decision="SKIPPED",
            denial_message=None,
        )

    try:
        transcript, latest_user_message, _ = get_recent_conversation_snippets(
            conversation_id, user_id, max_items=24
        )
    except Exception as e:
        logger.warning(
            "Failed to fetch conversation context; defaulting to NO",
            action_type=config.action_type,
            error=str(e),
        )
        return IntentVerificationResult(
            verified=False,
            decision="NO",
            denial_message=config.denial_message,
        )

    return verify_user_intent_with_context(config, transcript, latest_user_message)
