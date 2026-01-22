"""
Trace parser module for Numa Workspace Agent.

Parses Claude Agent SDK events from trace.jsonl files for conversation
history display in the frontend.
"""

import json
from pathlib import Path
from typing import Any, Iterator, Optional

import structlog

logger = structlog.get_logger()


def extract_session_id(trace_path: Path) -> Optional[str]:
    """
    Extract session_id from a trace.jsonl file.

    The session_id is found in:
    - ResultMessage events (type="result", session_id field)
    - SystemMessage init events (type="system", subtype="init", data.session_id)

    Args:
        trace_path: Path to trace.jsonl file

    Returns:
        Session ID if found, None otherwise
    """
    if not trace_path.exists():
        return None

    try:
        with trace_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue

                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue

                event_type = event.get("type")

                # Check result message for session_id
                if event_type == "result":
                    session_id = event.get("session_id")
                    if session_id:
                        logger.debug(
                            "Found session_id in result event",
                            trace_path=str(trace_path),
                            session_id=session_id,
                        )
                        return session_id

                # Check system init message for session_id
                if event_type == "system" and event.get("subtype") == "init":
                    data = event.get("data", {})
                    session_id = data.get("session_id")
                    if session_id:
                        logger.debug(
                            "Found session_id in system init event",
                            trace_path=str(trace_path),
                            session_id=session_id,
                        )
                        return session_id

    except Exception as e:
        logger.warning(
            "Failed to extract session_id", trace_path=str(trace_path), error=str(e)
        )

    return None


def iterate_trace_events(trace_path: Path) -> Iterator[dict[str, Any]]:
    """
    Iterate over events in a trace.jsonl file.

    Args:
        trace_path: Path to trace.jsonl file

    Yields:
        Parsed event dictionaries
    """
    if not trace_path.exists():
        return

    with trace_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            try:
                event = json.loads(line)
                yield event
            except json.JSONDecodeError as e:
                logger.warning(
                    "Failed to parse trace line",
                    trace_path=str(trace_path),
                    error=str(e),
                )
                continue


def _iterate_trace_content(content: str) -> Iterator[dict[str, Any]]:
    """
    Iterate over events in trace content string.

    Args:
        content: NDJSON trace content as a string

    Yields:
        Parsed event dictionaries
    """
    for line in content.split("\n"):
        line = line.strip()
        if not line:
            continue

        try:
            event = json.loads(line)
            yield event
        except json.JSONDecodeError as e:
            logger.warning("Failed to parse trace line", error=str(e))
            continue


def get_trace_stats(trace_path: Path) -> dict[str, Any]:
    """
    Get statistics about a trace file.

    Args:
        trace_path: Path to trace.jsonl file

    Returns:
        Dictionary with trace statistics
    """
    if not trace_path.exists():
        return {"exists": False}

    stats = {
        "exists": True,
        "size_bytes": trace_path.stat().st_size,
        "event_count": 0,
        "has_session_id": False,
        "session_id": None,
    }

    session_id = extract_session_id(trace_path)
    if session_id:
        stats["has_session_id"] = True
        stats["session_id"] = session_id

    # Count events
    for _ in iterate_trace_events(trace_path):
        stats["event_count"] += 1

    return stats


def _get_tool_steps(tool_name: str, input_data: dict[str, Any]) -> list[str]:
    """
    Generate display steps for a tool based on its input.

    Args:
        tool_name: Name of the tool (e.g., 'Read', 'Bash')
        input_data: Tool input parameters

    Returns:
        List of human-readable step descriptions
    """
    steps: list[str] = []

    if tool_name == "Read" and input_data.get("file_path"):
        steps.append(f"Reading: {input_data['file_path']}")
    elif tool_name == "Write" and input_data.get("file_path"):
        steps.append(f"Writing to: {input_data['file_path']}")
    elif tool_name == "Edit" and input_data.get("file_path"):
        steps.append(f"Editing: {input_data['file_path']}")
    elif tool_name == "Glob" and input_data.get("pattern"):
        steps.append(f"Pattern: {input_data['pattern']}")
        if input_data.get("path"):
            steps.append(f"In: {input_data['path']}")
    elif tool_name == "Grep" and input_data.get("pattern"):
        steps.append(f"Searching: {input_data['pattern']}")
    elif tool_name == "Bash" and input_data.get("command"):
        cmd = str(input_data["command"])[:80]
        steps.append(f"$ {cmd}")
    elif tool_name == "WebFetch" and input_data.get("url"):
        steps.append(f"URL: {input_data['url']}")
    elif tool_name == "WebSearch" and input_data.get("query"):
        steps.append(f"Query: {input_data['query']}")
    elif tool_name == "TodoWrite":
        steps.append("Updating task list")
    elif tool_name == "Task":
        desc = input_data.get("description", "")
        if desc:
            steps.append(f"Task: {desc}")

    return steps


def _get_tool_label(tool_name: str) -> str:
    """Get human-readable label for a tool."""
    labels = {
        "Read": "Reading file",
        "Write": "Writing file",
        "Edit": "Editing file",
        "Glob": "Searching files",
        "Grep": "Searching content",
        "Bash": "Running command",
        "WebFetch": "Fetching URL",
        "WebSearch": "Searching web",
        "TodoWrite": "Updating tasks",
        "Task": "Running task",
        "NotebookEdit": "Editing notebook",
    }
    return labels.get(tool_name, f"Using {tool_name}")


def _parse_events_to_messages(
    event_iterator: Iterator[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Parse SDK trace events into message list for frontend display.

    Handles:
    - User messages (type="user")
    - Assistant messages (type="assistant") with partial message merging
    - Tool use and tool results

    Args:
        event_iterator: Iterator of parsed trace events

    Returns:
        List of message dictionaries with role, content, and segments
    """
    messages: list[dict[str, Any]] = []
    tool_results: dict[str, dict[str, Any]] = {}  # tool_use_id -> result info

    # Collect all events for processing
    all_events = list(event_iterator)

    # First pass: collect all tool results for matching
    for event in all_events:
        event_type = event.get("type")

        # Tool results come in user messages
        if event_type == "user":
            msg = event.get("message", {})
            content_list = msg.get("content", [])
            for content in content_list:
                if isinstance(content, dict) and content.get("type") == "tool_result":
                    tool_use_id = content.get("tool_use_id")
                    if tool_use_id:
                        tool_results[tool_use_id] = {
                            "content": content.get("content"),
                            "is_error": content.get("is_error", False),
                        }

    # Second pass: collect assistant message content by ID
    # With streaming, we may get multiple partial messages with same ID
    assistant_messages: dict[str, dict[str, Any]] = {}

    for event in all_events:
        event_type = event.get("type")

        if event_type == "assistant":
            msg = event.get("message", {})
            msg_id = msg.get("id", "")
            if not msg_id:
                continue

            content_list = msg.get("content", [])

            # Initialize or get existing collected content for this message
            if msg_id not in assistant_messages:
                assistant_messages[msg_id] = {
                    "thinking": None,
                    "text_parts": [],
                    "tool_uses": {},  # tool_id -> tool_use data
                }

            collected = assistant_messages[msg_id]

            for content in content_list:
                if not isinstance(content, dict):
                    continue

                content_type = content.get("type")

                if content_type == "text":
                    text = content.get("text", "")
                    if text.strip() and text not in collected["text_parts"]:
                        collected["text_parts"].append(text)

                elif content_type == "tool_use":
                    tool_id = content.get("id", "")
                    if tool_id and tool_id not in collected["tool_uses"]:
                        collected["tool_uses"][tool_id] = {
                            "name": content.get("name", "unknown"),
                            "input": content.get("input", {}),
                        }

                elif content_type == "thinking":
                    thinking_text = content.get("thinking", "")
                    if thinking_text.strip():
                        # Keep the longest thinking (later partials may be more complete)
                        if not collected["thinking"] or len(thinking_text) > len(
                            collected["thinking"]
                        ):
                            collected["thinking"] = thinking_text

    # Build ordered events list for proper message sequencing
    ordered_events: list[tuple[str, Any]] = []
    seen_msg_ids: set[str] = set()
    seen_user_hashes: set[int] = set()

    for event in all_events:
        event_type = event.get("type")

        # Skip system and result messages for display ordering
        if event_type in ("system", "result"):
            continue

        if event_type == "user":
            msg = event.get("message", {})
            content_list = msg.get("content", [])

            # Check if this is a tool result message (skip for ordering)
            is_tool_result_msg = all(
                isinstance(c, dict) and c.get("type") == "tool_result"
                for c in content_list
                if isinstance(c, dict)
            )

            if not is_tool_result_msg:
                # Extract text content
                text_parts: list[str] = []
                for content in content_list:
                    if isinstance(content, dict) and content.get("type") == "text":
                        text_parts.append(content.get("text", ""))
                    elif isinstance(content, str):
                        text_parts.append(content)

                if text_parts:
                    user_text = "\n".join(text_parts).strip()
                    if user_text:
                        # Deduplicate user messages
                        content_hash = hash(user_text[:200])
                        if content_hash not in seen_user_hashes:
                            seen_user_hashes.add(content_hash)
                            ordered_events.append(("user", user_text))

        elif event_type == "assistant":
            msg_id = event.get("message", {}).get("id", "")
            if msg_id and msg_id not in seen_msg_ids:
                seen_msg_ids.add(msg_id)
                ordered_events.append(("assistant", msg_id))

    # Build final messages, grouping consecutive assistant events
    i = 0
    while i < len(ordered_events):
        event_type, data = ordered_events[i]

        if event_type == "user":
            messages.append({"role": "user", "content": data})
            i += 1

        elif event_type == "assistant":
            # Collect all consecutive assistant msg_ids
            assistant_msg_ids: list[str] = []
            while i < len(ordered_events) and ordered_events[i][0] == "assistant":
                assistant_msg_ids.append(ordered_events[i][1])
                i += 1

            # Build combined segments from all these msg_ids
            combined_segments: list[dict[str, Any]] = []
            combined_text_parts: list[str] = []

            for msg_id in assistant_msg_ids:
                if msg_id not in assistant_messages:
                    continue

                collected = assistant_messages[msg_id]

                # Add thinking first if present
                if collected["thinking"]:
                    combined_segments.append(
                        {
                            "kind": "thinking",
                            "text": collected["thinking"],
                            "collapsed": True,
                        }
                    )

                # Add text segments
                for text in collected["text_parts"]:
                    combined_segments.append(
                        {"kind": "text", "text": text, "finalized": True}
                    )
                    combined_text_parts.append(text)

                # Add tool cards
                for tool_id, tool_data in collected["tool_uses"].items():
                    result_info = tool_results.get(tool_id)
                    combined_segments.append(
                        {
                            "kind": "tool_card",
                            "toolUseId": tool_id,
                            "toolName": tool_data["name"],
                            "label": _get_tool_label(tool_data["name"]),
                            "input": tool_data["input"],
                            "steps": _get_tool_steps(
                                tool_data["name"],
                                (
                                    tool_data["input"]
                                    if isinstance(tool_data["input"], dict)
                                    else {}
                                ),
                            ),
                            "result": (
                                result_info.get("content") if result_info else None
                            ),
                            "isLoading": False,
                            "isError": (
                                result_info.get("is_error", False)
                                if result_info
                                else False
                            ),
                        }
                    )

            # Only add if we have segments
            if combined_segments:
                messages.append(
                    {
                        "role": "assistant",
                        "content": " ".join(combined_text_parts),
                        "segments": combined_segments,
                    }
                )

    return messages


def parse_trace_to_messages(trace_path: Path) -> list[dict[str, Any]]:
    """
    Parse trace.jsonl into a list of message dictionaries for frontend display.

    Args:
        trace_path: Path to trace.jsonl file

    Returns:
        List of message dictionaries with role, content, and segments
    """
    if not trace_path.exists():
        logger.warning("Trace file does not exist", trace_path=str(trace_path))
        return []

    return _parse_events_to_messages(iterate_trace_events(trace_path))


def parse_trace_content_to_messages(trace_content: str) -> list[dict[str, Any]]:
    """
    Parse trace content string into message dictionaries for frontend display.

    Same as parse_trace_to_messages but works with string content
    instead of reading from a file path. Used when fetching traces
    directly from S3.

    Args:
        trace_content: NDJSON trace content as a string

    Returns:
        List of message dictionaries with role, content, and segments
    """
    if not trace_content:
        return []

    return _parse_events_to_messages(_iterate_trace_content(trace_content))


def extract_result_from_trace(trace_path: Path) -> Optional[str]:
    """
    Extract the final result text from a trace.

    Looks for the last assistant message text in the trace.

    Args:
        trace_path: Path to trace.jsonl file

    Returns:
        Result text if found, None otherwise
    """
    if not trace_path.exists():
        return None

    last_text: list[str] = []

    for event in iterate_trace_events(trace_path):
        if event.get("type") == "assistant":
            msg = event.get("message", {})
            content_list = msg.get("content", [])

            for content in content_list:
                if isinstance(content, dict) and content.get("type") == "text":
                    text = content.get("text", "")
                    if text.strip():
                        last_text = [text]  # Reset to latest

    return "".join(last_text) if last_text else None
