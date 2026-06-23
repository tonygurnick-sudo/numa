"""
PostToolUse hook — stamp a saved workflow's last-run time when it executes.

When the agent runs a saved workflow via Bash (``python3 /workdir/chat-workflows/foo.py`` or
the agent-scoped ``/workdir/agent-workflows/foo.py``), this hook records the execution in the
directory's ``.last-run.json`` sidecar index. That lets the prompt builder order the workflow
list by most-recently-run, so the scripts a user actually uses stay at the top of the agent's
context (and survive the per-scope cap).

Code-driven by design: the agent never writes the index — execution is detected here, after the
Bash call, by matching the command string. Best-effort: any failure is swallowed so run-ordering
telemetry can never break a real command.
"""

import re
from typing import Any

try:
    from claude_agent_sdk import HookContext
except ImportError:  # pragma: no cover - SDK always present at runtime
    HookContext = Any  # type: ignore[misc,assignment]

# Capture any /workdir/{chat,agent}-workflows/<...>.py path in the command (handles trailing
# args, quotes, and subfolders like chat-workflows/<slug>/run.py).
_WORKFLOW_RUN_RE = re.compile(r"/workdir/(?:chat|agent)-workflows/[^\s'\"]+\.py")


async def workflow_run_tracker_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    if input_data.get("tool_name") != "Bash":
        return {}
    command = (input_data.get("tool_input") or {}).get("command", "")
    if "workflows/" not in command:
        return {}
    try:
        paths = _WORKFLOW_RUN_RE.findall(command)
        if not paths:
            return {}
        from ..saved_workflows import record_workflow_run

        for path in paths:
            record_workflow_run(path)
    except Exception:
        pass  # never break a run over run-ordering telemetry
    return {}
