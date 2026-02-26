"""
Session management module for Numa Workspace Agent.

Handles trace file session extraction for Claude Agent SDK.
"""

import json
from pathlib import Path
from typing import Any, Optional

import structlog

from .trace_parser import extract_session_id
from .workspace import get_workspace_paths

logger = structlog.get_logger()


def get_session_id_for_conversation(trace_file: Path) -> Optional[str]:
    """
    Get the session_id from a trace file.

    Args:
        trace_file: Path to the trace.jsonl file

    Returns:
        Session ID if found, None for new conversations
    """
    return extract_session_id(trace_file)


def get_conversation_metadata() -> dict[str, Any]:
    """
    Get metadata about the current conversation.

    Returns:
        Metadata dictionary
    """
    paths = get_workspace_paths()
    trace_file = paths["trace_file"]

    metadata = {
        "has_trace": trace_file.exists(),
        "session_id": None,
        "trace_size_bytes": 0,
    }

    if trace_file.exists():
        metadata["session_id"] = extract_session_id(trace_file)
        metadata["trace_size_bytes"] = trace_file.stat().st_size

    # Count files in uploads and tmp
    uploads_count = 0
    if paths["uploads"].exists():
        uploads_count = sum(1 for f in paths["uploads"].iterdir() if f.is_file())

    outputs_count = 0
    if paths["outputs"].exists():
        outputs_count = sum(1 for f in paths["outputs"].iterdir() if f.is_file())

    metadata["uploads_count"] = uploads_count
    metadata["outputs_count"] = outputs_count

    return metadata


def append_to_trace(event: dict[str, Any]) -> None:
    """
    Append an event to the trace file.

    Args:
        event: Event dictionary to append
    """
    paths = get_workspace_paths()
    trace_file = paths["trace_file"]

    with trace_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event) + "\n")
