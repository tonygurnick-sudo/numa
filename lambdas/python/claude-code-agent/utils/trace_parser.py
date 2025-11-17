"""
Trace parser utilities for Claude Code Agent.

Provides functions for parsing Claude CLI trace NDJSON output files
to extract results, session IDs, and iterate through events.
"""

import json
from pathlib import Path
from typing import Any, Dict, Generator, Optional

import structlog

logger = structlog.get_logger(__name__)


def extract_result_from_trace(trace_path: Path) -> Optional[str]:
    """
    Extract the result field from the final result event in the trace.

    Parses the trace NDJSON file and looks for the last event with type="result",
    returning its "result" field value. This is useful when Claude completes
    successfully but doesn't write a results.md file.

    Args:
        trace_path: Path to the trace.jsonl file

    Returns:
        The result text from the trace, or None if not found or trace doesn't exist
    """
    if not trace_path.exists():
        return None

    result_text = None
    try:
        with trace_path.open("r", encoding="utf-8") as f:
            for line in f:
                try:
                    event = json.loads(line)
                    if event.get("type") == "result":
                        result_text = event.get("result")
                except json.JSONDecodeError:
                    continue
    except Exception as e:  # pylint: disable=broad-exception-caught
        logger.warning("Error reading trace file", error=str(e))
        return None

    return result_text


def extract_session_id(trace_path: Path) -> Optional[str]:
    """
    Extract the session ID from a trace file.

    Scans the trace file for an event containing a session_id field.

    Args:
        trace_path: Path to the trace.jsonl file

    Returns:
        The session ID if found, None otherwise
    """
    if not trace_path.exists():
        return None

    try:
        with trace_path.open("r", encoding="utf-8") as f:
            for line in f:
                try:
                    event = json.loads(line)
                    if isinstance(event, dict) and event.get("session_id"):
                        return event.get("session_id")
                except json.JSONDecodeError:
                    continue
    except Exception as e:  # pylint: disable=broad-exception-caught
        logger.warning("Error reading trace file for session ID", error=str(e))
        return None

    return None


def iterate_trace_events(trace_path: Path) -> Generator[Dict[str, Any], None, None]:
    """
    Iterate through all events in a trace file.

    Generator that yields each valid JSON event from the trace file.

    Args:
        trace_path: Path to the trace.jsonl file

    Yields:
        Parsed JSON event dictionaries
    """
    if not trace_path.exists():
        return

    try:
        with trace_path.open("r", encoding="utf-8") as f:
            for line in f:
                try:
                    event = json.loads(line)
                    if isinstance(event, dict):
                        yield event
                except json.JSONDecodeError:
                    # Skip invalid JSON lines
                    continue
    except Exception as e:  # pylint: disable=broad-exception-caught
        logger.warning("Error iterating trace file", error=str(e))
        return


def get_trace_summary(trace_path: Path) -> Dict[str, Any]:
    """
    Generate a summary of a trace file.

    Analyzes the trace to extract key information like session ID,
    tool usage counts, result, and event counts.

    Args:
        trace_path: Path to the trace.jsonl file

    Returns:
        Dictionary containing trace summary information
    """
    summary: Dict[str, Any] = {
        "session_id": None,
        "result": None,
        "total_events": 0,
        "tool_uses": {},
        "has_error": False,
        "completed": False,
    }

    if not trace_path.exists():
        return summary

    tool_uses: Dict[str, int] = {}

    for event in iterate_trace_events(trace_path):
        summary["total_events"] += 1

        # Extract session ID
        if event.get("session_id") and not summary["session_id"]:
            summary["session_id"] = event["session_id"]

        # Extract result
        if event.get("type") == "result":
            summary["result"] = event.get("result")
            summary["completed"] = True

        # Track tool uses
        if event.get("type") in {"content", "content_block"}:
            content = event.get("content")
            if isinstance(content, dict) and content.get("type") == "tool_use":
                tool_name = content.get("name", "unknown")
                tool_uses[tool_name] = tool_uses.get(tool_name, 0) + 1

        # Check for errors
        if event.get("type") == "error":
            summary["has_error"] = True

    summary["tool_uses"] = tool_uses
    return summary
