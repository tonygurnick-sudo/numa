"""
Tests for background-bash tool-result parsing and the pending-tasks note
emitted at turn end.

When the model launches a Bash command with run_in_background=True, the
task keeps running in the MicroVM after the model's turn ends. At turn
end the harness emits a single `background_tasks_pending` SSE event so
the frontend can render a subtle italic footer beneath the assistant's
final message — no held connection, no polling chip, no mtime detection.
"""

from numa_workspace_agent.sdk_runner import (
    _build_pending_background_tasks_event,
    _parse_background_bash_result,
)

# ── _parse_background_bash_result ────────────────────────────────────────────


class TestParseBackgroundBashResult:
    """Extract shell_id + output_path from the SDK's standard
    `run_in_background: true` tool-result message."""

    def test_parses_standard_message(self):
        content = (
            "Command running in background with ID: bd5ahq352. "
            "Output is being written to: /tmp/claude-1000/abc/tasks/bd5ahq352.output"
        )
        result = _parse_background_bash_result(content)
        assert result is not None
        shell_id, path = result
        assert shell_id == "bd5ahq352"
        assert path == "/tmp/claude-1000/abc/tasks/bd5ahq352.output"

    def test_parses_manually_backgrounded(self):
        content = (
            "Command was manually backgrounded by user with ID: abc123. "
            "Output is being written to: /tmp/claude-1000/x/tasks/abc123.output"
        )
        result = _parse_background_bash_result(content)
        assert result is not None
        assert result[0] == "abc123"

    def test_parses_assistant_auto_backgrounded(self):
        content = (
            "Command exceeded the assistant-mode blocking budget (60s) "
            "and was moved to the background with ID: xyz789. "
            "It is still running — you will be notified when it completes. "
            "Output is being written to: /tmp/claude-1000/x/tasks/xyz789.output"
        )
        result = _parse_background_bash_result(content)
        assert result is not None
        assert result[0] == "xyz789"

    def test_parses_list_content_blocks(self):
        """ToolResultBlock.content can be a list of {type, text} dicts."""
        content = [
            {
                "type": "text",
                "text": (
                    "Command running in background with ID: shell-1. "
                    "Output is being written to: /tmp/claude/tasks/shell-1.output"
                ),
            }
        ]
        result = _parse_background_bash_result(content)
        assert result is not None
        assert result[0] == "shell-1"

    def test_returns_none_on_non_background_result(self):
        """A regular foreground Bash result shouldn't match."""
        result = _parse_background_bash_result("hello world\nexit 0")
        assert result is None

    def test_returns_none_on_empty_or_invalid(self):
        assert _parse_background_bash_result(None) is None
        assert _parse_background_bash_result("") is None
        assert _parse_background_bash_result({"not": "a list or string"}) is None


# ── _build_pending_background_tasks_event ────────────────────────────────────


class TestBuildPendingBackgroundTasksEvent:
    """At turn end, if any tracked background shells are still live, emit
    a single SSE event the frontend can render as a footer note."""

    def test_single_shell(self):
        event = _build_pending_background_tasks_event(
            background_shells={
                "shell-1": {
                    "command": "python3 /workdir/tmp/extract.py",
                    "output_path": "/tmp/claude-1000/x/tasks/shell-1.output",
                    "tool_use_id": "toolu_abc",
                },
            },
            request_id="req-A",
        )
        assert event["type"] == "background_tasks_pending"
        assert event["count"] == 1
        assert event["shells"] == [
            {"shell_id": "shell-1", "command": "python3 /workdir/tmp/extract.py"}
        ]
        assert event["request_id"] == "req-A"
        assert "timestamp" in event

    def test_multiple_shells(self):
        event = _build_pending_background_tasks_event(
            background_shells={
                "s-A": {"command": "cmd-A", "output_path": "/tmp/a"},
                "s-B": {"command": "cmd-B", "output_path": "/tmp/b"},
            },
            request_id=None,
        )
        assert event["count"] == 2
        shell_ids = {s["shell_id"] for s in event["shells"]}
        assert shell_ids == {"s-A", "s-B"}
        assert event["request_id"] == ""

    def test_includes_only_required_shell_fields(self):
        """Event payload should NOT leak output_path or tool_use_id to the
        frontend — those are harness-internal."""
        event = _build_pending_background_tasks_event(
            background_shells={
                "shell-1": {
                    "command": "cmd",
                    "output_path": "/tmp/sensitive/path",
                    "tool_use_id": "toolu_internal",
                },
            },
            request_id="req-B",
        )
        shell_payload = event["shells"][0]
        assert set(shell_payload.keys()) == {"shell_id", "command"}
