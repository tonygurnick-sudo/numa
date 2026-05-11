"""
Tests for the background-bash watching state in sdk_runner.

Verifies that when a turn launches a `run_in_background` shell, the harness
holds the SSE stream open with chip pulses + a terminal event, and aborts
cleanly on stop, disconnect, or timeout.
"""

import asyncio
import json
from pathlib import Path

import pytest
from numa_workspace_agent.sdk_runner import _emit_background_watching_state


def _parse_sse_event(chunk: bytes) -> dict:
    """SSE format is 'data: <json>\\n\\n' — pull the JSON."""
    text = chunk.decode("utf-8")
    assert text.startswith("data: ")
    body = text[len("data: ") :].rstrip("\n")
    return json.loads(body)


@pytest.fixture
def trace_path(tmp_path: Path) -> Path:
    return tmp_path / "trace.jsonl"


@pytest.mark.asyncio
async def test_emits_turn_state_watching_on_entry(
    trace_path: Path, monkeypatch
) -> None:
    """First event must be `turn_state: "watching"` so the frontend can
    transition: mark assistant message complete + enable composer + show chip."""
    # Shorten timings so the test is fast
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_MAX_SECONDS", 2
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_PULSE_INTERVAL", 1
    )

    stop_event = asyncio.Event()

    events: list[dict] = []
    async for chunk in _emit_background_watching_state(
        trace_path=trace_path,
        stop_event=stop_event,
        disconnect_checker=None,
        request_id="req-1",
        conversation_id="conv-1",
    ):
        events.append(_parse_sse_event(chunk))

    assert events[0]["type"] == "turn_state"
    assert events[0]["state"] == "watching"
    assert events[0]["request_id"] == "req-1"


@pytest.mark.asyncio
async def test_pulses_with_elapsed_seconds(trace_path: Path, monkeypatch) -> None:
    """Between entry and terminal, we should see at least one
    background_task_status pulse with elapsed_seconds set."""
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_MAX_SECONDS", 2
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_PULSE_INTERVAL", 1
    )

    stop_event = asyncio.Event()
    events = []
    async for chunk in _emit_background_watching_state(
        trace_path=trace_path,
        stop_event=stop_event,
        disconnect_checker=None,
        request_id=None,
        conversation_id="conv-2",
    ):
        events.append(_parse_sse_event(chunk))

    pulses = [
        e
        for e in events
        if e["type"] == "background_task_status" and e["state"] == "running"
    ]
    assert pulses, "expected at least one running pulse"
    # elapsed_seconds is a non-negative int
    assert pulses[0]["elapsed_seconds"] >= 0


@pytest.mark.asyncio
async def test_emits_timeout_terminal_event(trace_path: Path, monkeypatch) -> None:
    """When we hit the wall-clock cap with no abort signal, the last event
    must be state=timeout so the frontend can dismiss the chip with the
    'task still running — ping me to check' message."""
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_MAX_SECONDS", 1
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_PULSE_INTERVAL", 1
    )

    stop_event = asyncio.Event()
    events = []
    async for chunk in _emit_background_watching_state(
        trace_path=trace_path,
        stop_event=stop_event,
        disconnect_checker=None,
        request_id=None,
        conversation_id="conv-3",
    ):
        events.append(_parse_sse_event(chunk))

    assert events[-1]["type"] == "background_task_status"
    assert events[-1]["state"] == "timeout"


@pytest.mark.asyncio
async def test_aborts_on_stop_event(trace_path: Path, monkeypatch) -> None:
    """If the user clicks Stop (which sets stop_event), the loop aborts and
    we emit a terminal event with state=stop_event."""
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_MAX_SECONDS", 30
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_PULSE_INTERVAL", 1
    )

    stop_event = asyncio.Event()

    async def collect_with_stop():
        events = []
        agen = _emit_background_watching_state(
            trace_path=trace_path,
            stop_event=stop_event,
            disconnect_checker=None,
            request_id=None,
            conversation_id="conv-4",
        )
        async for chunk in agen:
            events.append(_parse_sse_event(chunk))
        return events

    async def trigger_stop_after_delay():
        await asyncio.sleep(0.5)
        stop_event.set()

    events, _ = await asyncio.gather(collect_with_stop(), trigger_stop_after_delay())

    assert events[-1]["state"] == "stop_event"


@pytest.mark.asyncio
async def test_aborts_on_client_disconnect(trace_path: Path, monkeypatch) -> None:
    """If the SSE detects a client disconnect (frontend closed the stream,
    likely because user sent a new message), the loop aborts and emits a
    terminal event with state=client_disconnect."""
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_MAX_SECONDS", 30
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_PULSE_INTERVAL", 1
    )

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
            conversation_id="conv-5",
        ):
            events.append(_parse_sse_event(chunk))
        return events

    async def trigger_disconnect_after_delay():
        await asyncio.sleep(0.5)
        disconnect_flag["value"] = True

    events, _ = await asyncio.gather(collect(), trigger_disconnect_after_delay())

    assert events[-1]["state"] == "client_disconnect"


@pytest.mark.asyncio
async def test_writes_entry_and_terminal_to_trace(
    trace_path: Path, monkeypatch
) -> None:
    """The watching-state entry and terminal events get persisted to the
    trace (so a conversation replay includes them). Pulses are NOT traced
    (would be noisy)."""
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_MAX_SECONDS", 1
    )
    monkeypatch.setattr(
        "numa_workspace_agent.sdk_runner._BACKGROUND_WATCH_PULSE_INTERVAL", 1
    )

    stop_event = asyncio.Event()
    async for _chunk in _emit_background_watching_state(
        trace_path=trace_path,
        stop_event=stop_event,
        disconnect_checker=None,
        request_id="req-trace",
        conversation_id="conv-trace",
    ):
        pass

    assert trace_path.exists()
    trace_lines = trace_path.read_text().strip().split("\n")
    types = [json.loads(line)["type"] for line in trace_lines]
    # Both entry and terminal should be traced
    assert "turn_state" in types
    assert "background_task_status" in types
    # Pulses ("running" state) intentionally not traced — only the terminal one
    terminal_states = [
        json.loads(line)["state"]
        for line in trace_lines
        if json.loads(line)["type"] == "background_task_status"
    ]
    assert (
        "running" not in terminal_states
    ), "running pulses should not be traced (noisy)"
    assert "timeout" in terminal_states
