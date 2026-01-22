"""
Stream logging utilities for numa-workspace-agent.

Captures the full conversation flow (text responses + tool calls) during streaming
and logs a comprehensive summary when the stream completes. This helps with debugging
by showing exactly what was said and what tools were used, in order.
"""

import time
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

import structlog

logger = structlog.get_logger()


def _truncate(value: Any, max_len: int = 200) -> str:
    """Truncate a value to max_len chars, adding length indicator if truncated."""
    s = str(value)
    if len(s) > max_len:
        return f"{s[:max_len]}... ({len(s)} chars)"
    return s


def _abbreviate_input(input_data: Optional[dict], max_value_len: int = 200) -> dict:
    """Abbreviate long values in tool input for logging."""
    if not input_data:
        return {}

    abbreviated = {}
    for k, v in input_data.items():
        if isinstance(v, str) and len(v) > max_value_len:
            abbreviated[k] = f"{v[:max_value_len]}... ({len(v)} chars)"
        elif isinstance(v, (list, dict)):
            # For complex types, just show a summary
            abbreviated[k] = f"<{type(v).__name__} with {len(v)} items>"
        else:
            abbreviated[k] = v
    return abbreviated


@dataclass
class StreamEntry:
    """Single entry in the stream log - either text, tool, or thinking."""

    entry_type: Literal["text", "tool", "thinking"]
    timestamp: float

    # For text entries
    text: Optional[str] = None

    # For thinking entries
    thinking: Optional[str] = None

    # For tool entries
    tool_name: Optional[str] = None
    tool_use_id: Optional[str] = None
    tool_input: Optional[dict] = None
    tool_result: Optional[Any] = None
    tool_duration_ms: Optional[float] = None
    is_error: bool = False
    error_message: Optional[str] = None

    def to_log_dict(self) -> dict:
        """Convert to dict for logging, with abbreviated values."""
        if self.entry_type == "text":
            return {
                "type": "text",
                "text": _truncate(self.text, 500),
            }
        elif self.entry_type == "thinking":
            return {
                "type": "thinking",
                "thinking": _truncate(self.thinking, 200),
            }
        elif self.entry_type == "tool":
            result = {
                "type": "tool",
                "name": self.tool_name,
            }
            if self.tool_input:
                result["input"] = _abbreviate_input(self.tool_input)
            if self.tool_duration_ms is not None:
                result["duration_ms"] = round(self.tool_duration_ms, 2)
            if self.is_error:
                result["is_error"] = True
                if self.error_message:
                    result["error"] = _truncate(self.error_message, 200)
            return result
        return {"type": "unknown"}


@dataclass
class StreamLog:
    """
    Accumulator for stream events that captures the full conversation flow.

    Records text responses and tool calls in order, then logs a comprehensive
    summary at stream completion.
    """

    conversation_id: str
    user_sub: str
    prompt: str
    start_time: float = field(default_factory=time.time)

    # Ordered list of entries (text + tools + thinking in sequence)
    entries: list[StreamEntry] = field(default_factory=list)

    # Tool tracking for matching results to tool starts
    pending_tools: dict[str, StreamEntry] = field(default_factory=dict)

    # Token usage (from ResultMessage)
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0

    # Result summary
    num_turns: int = 0
    total_cost_usd: float = 0.0
    is_error: bool = False
    error_message: Optional[str] = None
    stop_reason: Optional[str] = None

    def record_text(self, text: str) -> None:
        """Record a text response entry."""
        if not text or not text.strip():
            return
        entry = StreamEntry(
            entry_type="text",
            timestamp=time.time(),
            text=text,
        )
        self.entries.append(entry)

    def record_thinking(self, thinking: str) -> None:
        """Record a thinking block entry."""
        if not thinking or not thinking.strip():
            return
        entry = StreamEntry(
            entry_type="thinking",
            timestamp=time.time(),
            thinking=thinking,
        )
        self.entries.append(entry)

    def record_tool_start(
        self,
        tool_use_id: str,
        tool_name: str,
        tool_input: Optional[dict] = None,
    ) -> None:
        """Record a tool call starting."""
        entry = StreamEntry(
            entry_type="tool",
            timestamp=time.time(),
            tool_name=tool_name,
            tool_use_id=tool_use_id,
            tool_input=tool_input if isinstance(tool_input, dict) else None,
        )
        self.entries.append(entry)
        self.pending_tools[tool_use_id] = entry

    def record_tool_result(
        self,
        tool_use_id: str,
        result: Any,
        is_error: bool = False,
        error_message: Optional[str] = None,
    ) -> None:
        """Record a tool call completing with result."""
        if tool_use_id in self.pending_tools:
            entry = self.pending_tools[tool_use_id]
            entry.tool_duration_ms = (time.time() - entry.timestamp) * 1000
            entry.tool_result = result
            entry.is_error = is_error
            entry.error_message = error_message
            del self.pending_tools[tool_use_id]

    def finalize(self, result_message: Any) -> None:
        """Finalize the log with result data from ResultMessage."""
        if result_message:
            self.num_turns = getattr(result_message, "num_turns", 0) or 0
            self.total_cost_usd = getattr(result_message, "total_cost_usd", 0.0) or 0.0
            self.is_error = getattr(result_message, "is_error", False)

            usage = getattr(result_message, "usage", {}) or {}
            if isinstance(usage, dict):
                self.input_tokens = usage.get("input_tokens", 0) or 0
                self.output_tokens = usage.get("output_tokens", 0) or 0
                self.cache_read_tokens = usage.get("cache_read_input_tokens", 0) or 0
                self.cache_creation_tokens = (
                    usage.get("cache_creation_input_tokens", 0) or 0
                )

    def log_summary(self) -> None:
        """Log comprehensive summary of the stream."""
        end_time = time.time()
        total_duration_ms = (end_time - self.start_time) * 1000

        # Build conversation flow for logging
        conversation_flow = [entry.to_log_dict() for entry in self.entries]

        # Count entry types
        text_entries = sum(1 for e in self.entries if e.entry_type == "text")
        tool_entries = sum(1 for e in self.entries if e.entry_type == "tool")
        thinking_entries = sum(1 for e in self.entries if e.entry_type == "thinking")

        # Total text length
        total_text_chars = sum(
            len(e.text or "") for e in self.entries if e.entry_type == "text"
        )

        # Log the comprehensive summary
        # _name field sorts first alphabetically for easy log identification
        logger.info(
            "Stream completed - verbose summary",
            _name="STREAM_COMPLETE",
            phase="sdk",
            # Full IDs for searchability (never truncate)
            conversation_id=self.conversation_id,
            user_sub=self.user_sub,
            prompt=_truncate(self.prompt, 100),
            total_duration_ms=round(total_duration_ms, 2),
            # Full conversation flow
            conversation_flow=conversation_flow,
            # Summary stats
            text_entries=text_entries,
            tool_entries=tool_entries,
            thinking_entries=thinking_entries,
            total_text_chars=total_text_chars,
            # Token usage
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            cache_read_tokens=self.cache_read_tokens,
            cache_creation_tokens=self.cache_creation_tokens,
            # Result
            num_turns=self.num_turns,
            total_cost_usd=self.total_cost_usd,
            is_error=self.is_error,
            error_message=self.error_message,
            stop_reason=self.stop_reason,
        )

        # Dedicated cost log for easy cost tracking and aggregation
        logger.info(
            "Request cost",
            _name="COST",
            phase="sdk",
            conversation_id=self.conversation_id,
            user_sub=self.user_sub,
            total_cost_usd=self.total_cost_usd,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            cache_read_tokens=self.cache_read_tokens,
            cache_creation_tokens=self.cache_creation_tokens,
            total_tokens=self.input_tokens + self.output_tokens,
            num_turns=self.num_turns,
            duration_ms=round(total_duration_ms, 2),
        )
