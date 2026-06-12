"""
PreToolUse hook that resets the per-command `numa` call counter.

Powers the friendly per-command rate limit (a cost guard against an honest
runaway loop — `for f in *.pdf; do numa ...; done` firing thousands of calls in
one command). Each Bash command gets a fresh budget: this hook truncates the
counter file at the START of every Bash call. Crucially it's a **side effect**
— it does NOT modify the command — so it can't conflict with the `Bash(numa:*)`
allowlist the way an injected `export NUMA_BASH_CALL_ID=…;` prefix did (that
turned the command into a compound command the sandbox rejected).

The `numa` CLI appends one byte to this file on every invocation and reads the
file size as the count; once it's over the limit it self-aborts (skipping the
expensive work — no API call, no cost) so a runaway loop stops spending after
~500 calls. Because this hook resets the counter at the start of each new Bash
command, the model just continues in a fresh command and gets a fresh budget.

Best-effort: any I/O failure is swallowed and the CLI fails open (no cap) — the
limit must never break a real command.
"""

import os
from pathlib import Path
from typing import Any

try:
    from claude_agent_sdk import HookContext
except ImportError:
    HookContext = Any  # type: ignore[misc,assignment]


def _tmp_dir() -> Path:
    # Mirror the CLI's resolveTmpDir for the workspace path (and honour the
    # NUMA_CLI_TMP_DIR override) so both sides point at the same files.
    return Path(os.environ.get("NUMA_CLI_TMP_DIR") or "/workdir/tmp/numa-cli")


def _counter_file() -> Path:
    return _tmp_dir() / ".numa-call-count"


def _limit_flag_file() -> Path:
    # The CLI writes this when it caps a command; we turn it into model context.
    return _tmp_dir() / ".numa-call-limited"


async def numa_call_counter_reset_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    if input_data.get("tool_name") != "Bash":
        return {}
    try:
        path = _counter_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"")  # reset count to 0 for this command
        flag = _limit_flag_file()
        if flag.exists():
            flag.unlink()  # clear last command's cap flag
    except OSError:
        pass  # best-effort; the CLI fails open if the counter is unavailable
    return {}


async def numa_call_limit_notice_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    """PostToolUse (Bash): if the command hit the per-command call cap, tell the
    model — out-of-band, so the signal lands even when the command redirected
    stdout/stderr (``numa … >/dev/null 2>&1``). The CLI writes the flag when it
    caps; we consume it here."""
    if input_data.get("tool_name") != "Bash":
        return {}
    try:
        flag = _limit_flag_file()
        if not flag.exists():
            return {}
        flag.unlink()  # consume — one notice per capped command
    except OSError:
        return {}
    return {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": (
                "Note: that command reached the per-command limit on numa calls. "
                "Every numa call past the limit exited immediately WITHOUT running "
                "(no work done, no cost) — regardless of how the command's output "
                "was redirected. If the job isn't finished, continue in a NEW "
                "command (the per-command budget resets); split large jobs into "
                "several commands of a few hundred numa calls each."
            ),
        }
    }
