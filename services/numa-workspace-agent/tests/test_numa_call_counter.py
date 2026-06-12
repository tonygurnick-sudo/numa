"""Tests for the per-command numa-call-counter reset hook.

The key property: it resets the counter as a SIDE EFFECT and returns {} — it
must never modify the Bash command (that's what broke the Bash(numa:*) allowlist
in the first, reverted, design)."""

import asyncio
import os

from numa_workspace_agent.hooks.numa_call_counter import (
    numa_call_counter_reset_hook,
    numa_call_limit_notice_hook,
)


def _run(coro):
    return asyncio.run(coro)


def _bash(cmd="numa files list -m x"):
    return {"tool_name": "Bash", "tool_input": {"command": cmd}}


def test_resets_counter_and_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setenv("NUMA_CLI_TMP_DIR", str(tmp_path))
    counter = tmp_path / ".numa-call-count"
    counter.write_bytes(b"\0" * 42)  # simulate prior calls this turn

    result = _run(
        numa_call_counter_reset_hook(
            {"tool_name": "Bash", "tool_input": {"command": "numa files list -m x"}},
            "id",
            None,
        )
    )

    # MUST NOT modify the command — no updatedInput, just {}.
    assert result == {}
    assert os.path.getsize(counter) == 0  # reset to 0


def test_creates_counter_dir_if_missing(tmp_path, monkeypatch):
    sub = tmp_path / "nested" / "numa-cli"
    monkeypatch.setenv("NUMA_CLI_TMP_DIR", str(sub))
    result = _run(
        numa_call_counter_reset_hook(
            {"tool_name": "Bash", "tool_input": {"command": "numa whoami -m x"}},
            "id",
            None,
        )
    )
    assert result == {}
    assert (sub / ".numa-call-count").exists()


def test_noop_for_non_bash_tools(tmp_path, monkeypatch):
    monkeypatch.setenv("NUMA_CLI_TMP_DIR", str(tmp_path))
    counter = tmp_path / ".numa-call-count"
    counter.write_bytes(b"\0" * 10)
    result = _run(
        numa_call_counter_reset_hook(
            {"tool_name": "Read", "tool_input": {"file_path": "/workdir/x"}}, "id", None
        )
    )
    assert result == {}
    # untouched (only Bash resets)
    assert os.path.getsize(counter) == 10


# ── PostToolUse cap-notice hook ──────────────────────────────────────────────
# Surfaces the per-command cap to the model out-of-band, so the signal lands
# even when the command redirected stdout/stderr (numa … >/dev/null 2>&1).


def test_notice_no_flag_is_noop(tmp_path, monkeypatch):
    monkeypatch.setenv("NUMA_CLI_TMP_DIR", str(tmp_path))
    assert _run(numa_call_limit_notice_hook(_bash(), "i", None)) == {}


def test_notice_surfaces_and_consumes_flag(tmp_path, monkeypatch):
    monkeypatch.setenv("NUMA_CLI_TMP_DIR", str(tmp_path))
    flag = tmp_path / ".numa-call-limited"
    flag.write_text("1")  # the CLI writes this when it caps a command
    r = _run(numa_call_limit_notice_hook(_bash(), "i", None))
    out = r["hookSpecificOutput"]
    assert out["hookEventName"] == "PostToolUse"
    assert "additionalContext" in out and "limit" in out["additionalContext"].lower()
    assert not flag.exists()  # consumed — one notice per capped command


def test_notice_noop_for_non_bash(tmp_path, monkeypatch):
    monkeypatch.setenv("NUMA_CLI_TMP_DIR", str(tmp_path))
    (tmp_path / ".numa-call-limited").write_text("1")
    ev = {"tool_name": "Read", "tool_input": {"file_path": "/workdir/x"}}
    assert _run(numa_call_limit_notice_hook(ev, "i", None)) == {}


def test_reset_clears_leftover_flag(tmp_path, monkeypatch):
    monkeypatch.setenv("NUMA_CLI_TMP_DIR", str(tmp_path))
    (tmp_path / ".numa-call-limited").write_text("1")
    _run(numa_call_counter_reset_hook(_bash(), "i", None))
    assert not (tmp_path / ".numa-call-limited").exists()
