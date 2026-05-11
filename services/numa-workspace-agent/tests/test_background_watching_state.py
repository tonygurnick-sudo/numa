"""
Tests for the background-bash watching state in sdk_runner.

Verifies:
  - tool-result parsing (capturing shell_id + output_path from the SDK's message)
  - completion detection via output-file mtime stability
  - SSE event sequence (turn_state="watching" entry, running pulses, "completed"
    events, terminal event with appropriate state)
  - clean aborts on stop_event, client disconnect, all_completed, timeout
"""

import asyncio
import json
import os
import time
from pathlib import Path

import pytest
from numa_workspace_agent.sdk_runner import (
    _check_shell_completion,
    _emit_background_watching_state,
    _parse_background_bash_result,
    _read_output_preview,
)


def _parse_sse_event(chunk: bytes) -> dict:
    text = chunk.decode("utf-8")
    assert text.startswith("data: ")
    body = text[len("data: ") :].rstrip("\n")
    return json.loads(body)


@pytest.fixture
def trace_path(tmp_path: Path) -> Path:
    return tmp_path / "trace.jsonl"


# ── _parse_background_bash_result ────────────────────────────────────────────


class TestParseBackgroundBashResult:
    """Verify we correctly extract shell_id and output_path from the SDK's
    standard `run_in_background: true` tool-result message."""

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


# ── _check_shell_completion ──────────────────────────────────────────────────


class TestCheckShellCompletion:
    """The completion heuristic: file mtime stable for the configured window."""

    def test_returns_false_when_file_missing(self, tmp_path: Path):
        state: dict = {}
        result = _check_shell_completion(str(tmp_path / "nonexistent"), state)
        assert result is False

    def test_returns_false_on_first_observation(self, tmp_path: Path):
        """First poll always returns False — we need to see the file twice to
        know if it's stable."""
        output = tmp_path / "out.log"
        output.write_text("hello")
        state: dict = {}
        result = _check_shell_completion(str(output), state)
        assert result is False
        assert state.get("last_mtime") is not None
        assert state.get("stable_since") is not None

    def test_returns_false_when_file_recently_changed(self, tmp_path: Path):
        """If the file is updated between polls, the stability clock resets."""
        output = tmp_path / "out.log"
        output.write_text("first")
        state: dict = {}
        _check_shell_completion(str(output), state)
        time.sleep(0.05)
        output.write_text("first\nmore")
        new_time = time.time()
        os.utime(str(output), (new_time, new_time))
        result = _check_shell_completion(str(output), state)
        assert result is False

    def test_returns_true_after_stability_window(self, tmp_path: Path, monkeypatch):
        """File hasn't changed for longer than the stability window → completed."""
        monkeypatch.setattr(
            "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_COMPLETION_STABLE_SECONDS",
            0.05,
        )
        output = tmp_path / "out.log"
        output.write_text("done\n")
        state: dict = {}
        # First poll — records observation
        assert _check_shell_completion(str(output), state) is False
        time.sleep(0.1)
        # Second poll — same mtime/size, should now return True
        assert _check_shell_completion(str(output), state) is True

    def test_resets_stability_clock_when_file_grows(self, tmp_path: Path, monkeypatch):
        monkeypatch.setattr(
            "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_COMPLETION_STABLE_SECONDS",
            0.05,
        )
        output = tmp_path / "out.log"
        output.write_text("a")
        state: dict = {}
        _check_shell_completion(str(output), state)
        time.sleep(0.07)
        output.write_text("a\nb\nc")
        new_time = time.time()
        os.utime(str(output), (new_time, new_time))
        assert _check_shell_completion(str(output), state) is False


# ── _read_output_preview ─────────────────────────────────────────────────────


class TestReadOutputPreview:
    def test_reads_small_file(self, tmp_path: Path):
        output = tmp_path / "out.log"
        output.write_text("done\n")
        assert _read_output_preview(str(output)) == "done\n"

    def test_reads_last_max_bytes(self, tmp_path: Path):
        output = tmp_path / "out.log"
        big = "x" * 5000 + "TAIL"
        output.write_text(big)
        preview = _read_output_preview(str(output), max_bytes=128)
        assert preview.endswith("TAIL")
        assert len(preview) <= 128

    def test_returns_empty_when_file_missing(self, tmp_path: Path):
        assert _read_output_preview(str(tmp_path / "no-such-file")) == ""


# ── _emit_background_watching_state ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_emits_turn_state_watching_on_entry(
    trace_path: Path, tmp_path: Path, monkeypatch
) -> None:
    """First event is `turn_state: "watching"` with the tracked shells listed."""
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_MAX_SECONDS", 2
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_PULSE_INTERVAL", 1
    )

    output = tmp_path / "out.log"
    output.write_text("starting...")

    stop_event = asyncio.Event()
    events = []
    async for chunk in _emit_background_watching_state(
        trace_path=trace_path,
        stop_event=stop_event,
        disconnect_checker=None,
        request_id="req-entry",
        conversation_id="conv-entry",
        background_shells={
            "shell-1": {"command": "sleep 5", "output_path": str(output)}
        },
    ):
        events.append(_parse_sse_event(chunk))

    assert events[0]["type"] == "turn_state"
    assert events[0]["state"] == "watching"
    assert events[0]["shells"] == [{"shell_id": "shell-1", "command": "sleep 5"}]


@pytest.mark.asyncio
async def test_pulses_running_with_active_shells_count(
    trace_path: Path, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_MAX_SECONDS", 2
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_PULSE_INTERVAL", 1
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_COMPLETION_STABLE_SECONDS",
        99,  # never trigger completion in this test
    )

    output = tmp_path / "out.log"
    output.write_text("starting")

    stop_event = asyncio.Event()
    events = []
    async for chunk in _emit_background_watching_state(
        trace_path=trace_path,
        stop_event=stop_event,
        disconnect_checker=None,
        request_id=None,
        conversation_id="conv-pulse",
        background_shells={"s1": {"command": "sleep 60", "output_path": str(output)}},
    ):
        events.append(_parse_sse_event(chunk))

    pulses = [
        e
        for e in events
        if e["type"] == "background_task_status" and e["state"] == "running"
    ]
    assert pulses
    assert pulses[0]["active_shells"] == 1


@pytest.mark.asyncio
async def test_emits_completed_event_when_shell_goes_stable(
    trace_path: Path, tmp_path: Path, monkeypatch
) -> None:
    """When a tracked shell's output file goes stable, we emit a `state: completed`
    event with the shell_id + a preview of the output, and the watching state
    exits with `all_completed` once every tracked shell is done."""
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_MAX_SECONDS", 5
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_PULSE_INTERVAL", 1
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_COMPLETION_STABLE_SECONDS",
        0.5,
    )

    output = tmp_path / "out.log"
    output.write_text("task finished\n")
    # Backdate mtime so the file is already stable by first poll
    past = time.time() - 10
    os.utime(str(output), (past, past))

    stop_event = asyncio.Event()
    events = []
    async for chunk in _emit_background_watching_state(
        trace_path=trace_path,
        stop_event=stop_event,
        disconnect_checker=None,
        request_id=None,
        conversation_id="conv-complete",
        background_shells={
            "shell-done": {"command": "echo task finished", "output_path": str(output)}
        },
    ):
        events.append(_parse_sse_event(chunk))

    completed = [
        e
        for e in events
        if e["type"] == "background_task_status" and e["state"] == "completed"
    ]
    assert completed
    assert completed[0]["shell_id"] == "shell-done"
    assert "task finished" in completed[0]["output_preview"]

    terminal = events[-1]
    assert terminal["state"] == "all_completed"
    assert terminal["completed_shells"] == ["shell-done"]


@pytest.mark.asyncio
async def test_aborts_on_stop_event_mid_run(
    trace_path: Path, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_MAX_SECONDS", 30
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_PULSE_INTERVAL", 1
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_COMPLETION_STABLE_SECONDS",
        99,
    )

    output = tmp_path / "out.log"
    output.write_text("running")

    stop_event = asyncio.Event()

    async def collect():
        events = []
        async for chunk in _emit_background_watching_state(
            trace_path=trace_path,
            stop_event=stop_event,
            disconnect_checker=None,
            request_id=None,
            conversation_id="conv-stop",
            background_shells={
                "s": {"command": "sleep 60", "output_path": str(output)}
            },
        ):
            events.append(_parse_sse_event(chunk))
        return events

    async def trigger_stop():
        await asyncio.sleep(0.5)
        stop_event.set()

    events, _ = await asyncio.gather(collect(), trigger_stop())
    assert events[-1]["state"] == "stop_event"


@pytest.mark.asyncio
async def test_aborts_on_client_disconnect_mid_run(
    trace_path: Path, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_MAX_SECONDS", 30
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_PULSE_INTERVAL", 1
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_COMPLETION_STABLE_SECONDS",
        99,
    )

    output = tmp_path / "out.log"
    output.write_text("running")

    stop_event = asyncio.Event()
    disconnect_flag = {"value": False}

    async def disconnect_checker():
        return disconnect_flag["value"]

    async def collect():
        events = []
        async for chunk in _emit_background_watching_state(
            trace_path=trace_path,
            stop_event=stop_event,
            disconnect_checker=disconnect_checker,
            request_id=None,
            conversation_id="conv-disconnect",
            background_shells={
                "s": {"command": "sleep 60", "output_path": str(output)}
            },
        ):
            events.append(_parse_sse_event(chunk))
        return events

    async def trigger_disconnect():
        await asyncio.sleep(0.5)
        disconnect_flag["value"] = True

    events, _ = await asyncio.gather(collect(), trigger_disconnect())
    assert events[-1]["state"] == "client_disconnect"


@pytest.mark.asyncio
async def test_traces_entry_completion_and_terminal_but_not_pulses(
    trace_path: Path, tmp_path: Path, monkeypatch
) -> None:
    """Entry, completion, and terminal events go into the conversation trace
    so a replay sees them. Running pulses do NOT — they'd be too noisy."""
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_MAX_SECONDS", 2
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_PULSE_INTERVAL", 1
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_COMPLETION_STABLE_SECONDS",
        0.5,
    )

    output = tmp_path / "out.log"
    output.write_text("done\n")
    past = time.time() - 10
    os.utime(str(output), (past, past))

    stop_event = asyncio.Event()
    async for _chunk in _emit_background_watching_state(
        trace_path=trace_path,
        stop_event=stop_event,
        disconnect_checker=None,
        request_id="req-trace",
        conversation_id="conv-trace",
        background_shells={"s": {"command": "echo done", "output_path": str(output)}},
    ):
        pass

    assert trace_path.exists()
    trace_lines = trace_path.read_text().strip().split("\n")
    parsed = [json.loads(line) for line in trace_lines]
    states = [
        (p["type"], p.get("state"))
        for p in parsed
        if p["type"] in ("turn_state", "background_task_status")
    ]
    assert ("turn_state", "watching") in states
    assert ("background_task_status", "completed") in states
    assert ("background_task_status", "all_completed") in states
    assert ("background_task_status", "running") not in states
