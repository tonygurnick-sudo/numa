"""
Event streaming utilities for Claude Code agents.

Provides real-time status updates to the frontend during agent execution
by writing events to DynamoDB (or S3 as fallback).
"""

import importlib
import random
from pathlib import Path
from typing import Any, Dict, Optional, Union

import structlog
from typing_extensions import TypedDict

import helpers

logger = structlog.get_logger(__name__)

# Module-level narrator model cache
_narrator_model: Optional[Any] = None


class AppContext(TypedDict, total=False):
    """Context for event streaming."""

    job_id: str
    user_id: str
    app_id: str
    use_dynamodb: bool
    bucket: Optional[str]


def truthy(val: Optional[Union[str, bool]]) -> bool:
    """
    Interpret common truthy/falsey values from env/event overrides.

    Accepts bool or string. Strings like '0', 'false', 'no', 'off' are false; otherwise true.
    None defaults to True (feature enabled by default).

    Args:
        val: Value to interpret

    Returns:
        Boolean interpretation
    """
    if isinstance(val, bool):
        return val
    if val is None:
        return True
    s = str(val).strip().lower()
    if s in {"0", "false", "no", "off"}:
        return False
    return True


def setup_event_context(event: Dict[str, Any], bucket: str) -> Optional[AppContext]:
    """
    Setup app context for event streaming if enabled.

    Args:
        event: Lambda event containing job_id, user_id, app_id
        bucket: S3 bucket for fallback event storage

    Returns:
        AppContext if streaming is enabled, None otherwise
    """
    stream_events = truthy(event.get("stream_events", True))
    if not stream_events:
        logger.info("Event streaming disabled")
        return None

    use_dynamodb = truthy(event.get("use_dynamodb", True))
    logger.info("Event streaming enabled", use_dynamodb=use_dynamodb)
    return AppContext(
        job_id=event["job_id"],
        user_id=event["user_id"],
        app_id=event["app_id"],
        use_dynamodb=use_dynamodb,
        bucket=bucket if not use_dynamodb else None,
    )


def try_append_event(event_msg: str, app_context: Optional[AppContext]) -> None:
    """
    Attempt to append an event using the app context.

    Safely handles missing required fields in app_context.

    Args:
        event_msg: Message to send to frontend
        app_context: Context with job/user/app IDs
    """
    if not app_context:
        return

    job_id = app_context.get("job_id")
    user_id = app_context.get("user_id")
    app_id = app_context.get("app_id")

    # All three IDs are required for event appending
    if not (job_id and user_id and app_id):
        logger.warning(
            "Missing required IDs for event append",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
        )
        return

    try:
        logger.debug("Appending event", event_msg=event_msg, job_id=job_id)
        helpers.append_event(
            message=event_msg,
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=app_context.get("use_dynamodb", True),
            bucket=app_context.get("bucket"),
        )
    except Exception as e:
        logger.warning(
            "Failed to append event", msg=event_msg, error=str(e), exc_info=True
        )


def _get_narrator_model() -> Optional[Any]:
    """Get or initialize the Haiku model for command summarization."""
    global _narrator_model  # pylint: disable=global-statement
    if _narrator_model is not None:
        return _narrator_model
    try:
        bedrock_mod = importlib.import_module("bedrock")
        cfg_mod = importlib.import_module("bedrock.bedrock_model_config")
        bedrock_model_cls = getattr(bedrock_mod, "BedrockClaude3Model")
        model_types = getattr(cfg_mod, "ModelTypes")
        _narrator_model = bedrock_model_cls(
            model_type=model_types.CLAUDE_HAIKU,
            model_args={
                "max_tokens": 100,
                "temperature": 0.2,
            },
            enable_fallback=True,
            claude_only=True,
        )
        return _narrator_model
    except Exception as e:
        logger.warning(
            "Failed to initialize narrator model",
            error=str(e),
            exc_info=True,
        )
        return None


def _summarize_tool_command(command: str) -> Optional[str]:
    """Summarize a bash/code command using Haiku."""
    try:
        model = _get_narrator_model()
        if not model:
            return None
        truncated = (command or "").strip()
        if len(truncated) > 600:
            truncated = truncated[:600] + "..."
        prompt = (
            "Write a brief, human-friendly doing phrase that describes the intent of the command. "
            "Start with a present-participle verb ending in 'ing' (e.g., Analyzing, Filtering, "
            "Downloading, Installing). "
            "Use 12 words or fewer. No code, shell terms, IDs, or URLs. "
            "Respond with only the phrase, no extra punctuation.\n\n"
            f"Command:\n{truncated}\n"
        )
        result = model.run(prompt, name_for_logging="tool_narration")
        for item in result.response:
            if isinstance(item, dict) and item.get("type") == "text":
                summary = (item.get("text") or "").strip()
                if summary:
                    return summary
        logger.debug(
            "No text found in narrator model response", response=result.response
        )
        return None
    except Exception as e:
        logger.warning(
            "Failed to summarize tool command",
            error=str(e),
            exc_info=True,
        )
        return None


def _extract_tool_event(tool_name: str, tool_input: dict) -> Optional[str]:
    """Extract event message for a specific tool use."""

    def format_bash_command(inp: dict) -> Optional[str]:
        """Summarize a bash command to a human-friendly message, with fallback."""
        # First priority: Use Claude's own description if provided
        description = inp.get("description", "")
        if description:
            return f"Numa: {description}"

        # Second priority: Try LLM summary (for cases without description)
        command = inp.get("command", "")
        if command:
            summary = _summarize_tool_command(command)
            if summary:
                return f"Numa: {summary}"

        # Final fallback: Show command preview
        if command:
            cmd_preview = command[:60] + "..." if len(command) > 60 else command
            return f"Running: {cmd_preview}"

        return None

    def format_read_event(inp: dict) -> Optional[str]:
        """Format read event with simplified path."""
        file_path = inp.get("file_path", "")
        if not file_path:
            return None
        # Show just the filename to reduce noise
        filename = Path(file_path).name
        return f"Reading file: {filename}"

    def format_write_event(inp: dict) -> Optional[str]:
        """Summarize a file write, with LLM summary for code files."""
        file_path = inp.get("file_path", "")
        if not file_path:
            return None
        content = inp.get("content", "")
        # Check if this is a code file that should be summarized
        code_extensions = {".py", ".js", ".ts", ".sh", ".bash", ".r", ".R", ".sql"}
        if any(file_path.endswith(ext) for ext in code_extensions) and content:
            summary = _summarize_tool_command(content)
            if summary:
                return f"Numa: {summary}"
        # Fallback to basic message
        return f"Writing file: {file_path}"

    tool_events = {
        "Read": format_read_event,
        "Write": format_write_event,
        "Edit": lambda inp: (
            f"Editing file: {inp.get('file_path', '')}"
            if inp.get("file_path")
            else None
        ),
        "Bash": format_bash_command,
        "Glob": lambda _: "Searching files (Glob)",
        "Grep": lambda _: "Searching files (Grep)",
    }

    tool_handler = tool_events.get(tool_name)
    if tool_handler:
        return tool_handler(tool_input)
    if tool_name:
        return f"Using tool: {tool_name}"
    return None


def _extract_content_block_event(block: dict) -> Optional[str]:
    """Extract event message from a content block."""
    if not isinstance(block, dict):
        return None

    block_type = block.get("type")

    if block_type == "tool_use":
        return _extract_tool_event(block.get("name", ""), block.get("input", {}))

    if block_type == "text":
        text = block.get("text", "").strip()
        if text:
            truncated = text[:80] + "..." if len(text) > 80 else text
            return f"Numa: {truncated}"

    if block_type == "thinking":
        thinking_variants = [
            "Numa: Thinking...",
            "Numa: Analysing...",
            "Numa: Digging deeper...",
            "Numa: Exploring options...",
            "Numa: Reviewing data...",
            "Numa: Processing...",
            "Numa: Evaluating inputs...",
            "Numa: Reasoning...",
            "Numa: Planning steps...",
            "Numa: Working...",
        ]
        try:
            return random.choice(thinking_variants)  # nosec B311
        except IndexError:
            return "Numa: Thinking..."

    return None


def extract_meaningful_event(obj: Any) -> Optional[str]:
    """
    Extract meaningful event messages from Claude CLI trace events.

    Filters for events that provide useful status information to the user.
    Uses the CORRECT event types that Claude CLI actually emits.

    Args:
        obj: Parsed JSON object from trace line

    Returns:
        Event message string if meaningful, None otherwise
    """
    if not isinstance(obj, dict):
        return None

    event_type = obj.get("type")

    # Map simple event types to messages
    simple_events = {
        "session_init": "Session initialized",
        "result": "Task completed successfully",
    }

    if event_type in simple_events:
        return simple_events[event_type]

    # Error events with dynamic message
    if event_type == "error":
        error_msg = obj.get("error", "Unknown error")
        return f"Error: {error_msg}"

    # Assistant messages with nested content blocks - THIS IS THE KEY EVENT TYPE
    if event_type == "assistant":
        content_array = obj.get("message", {}).get("content") or obj.get("content")

        if content_array and isinstance(content_array, list):
            for block in content_array:
                event_msg = _extract_content_block_event(block)
                if event_msg:
                    return event_msg

    return None
