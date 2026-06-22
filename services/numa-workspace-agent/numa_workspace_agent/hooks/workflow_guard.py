"""
PreToolUse hook guarding writes to /workdir/chat-workflows/ (Saved Workflows).

Saved workflows persist to the user's S3 prefix and are surfaced (by name +
description) in every future conversation, so a malformed or headerless file
would either be silently dropped from the prompt or pollute it. This hook
validates a workflow at authoring time — the moment Numa writes it — so it
can't accidentally save a broken script:

  - missing/invalid ``# --- numa-workflow ---`` frontmatter → DENY, with a
    message telling the model exactly what header to add.
  - a hardcoded-looking secret → WARN (allow). Numa chat shouldn't contain
    secrets (integration credentials are injected at runtime, outside the
    workspace), so a literal secret is almost certainly a mistake — but per
    product decision we surface it rather than hard-block.

Only fires for Write/Edit targeting chat-workflows/. Everything else is a no-op.
"""

from pathlib import Path
from typing import Any, Optional

from numa_workspace_agent.saved_workflows import (
    AGENT_WORKFLOWS_DIR,
    WORKFLOWS_DIR,
    scan_for_secrets,
    validate_workflow_content,
)

try:
    from claude_agent_sdk import HookContext
except ImportError:
    HookContext = Any  # type: ignore[misc,assignment]


def _is_workflow_path(file_path: str) -> bool:
    if not file_path:
        return False
    try:
        # Resolve relative paths against the workspace root (cwd is /workdir).
        p = Path(file_path)
        if not p.is_absolute():
            p = Path("/workdir") / p
        p = p.resolve()
        # Guard both the user-level (chat-workflows) and agent-scoped
        # (agent-workflows, FEAT-243) libraries — same format + validation.
        for base in (WORKFLOWS_DIR, AGENT_WORKFLOWS_DIR):
            root = base.resolve()
            if p == root or root in p.parents:
                return True
        return False
    except (OSError, ValueError):
        return False


def _resulting_edit_content(
    file_path: str, tool_input: dict[str, Any]
) -> Optional[str]:
    """Apply the proposed Edit to the current file content so we validate the
    RESULT, not the diff. Returns None when we can't determine it (missing file
    / unmatched old_string) — in which case we don't block; the Edit tool's own
    error handling takes over."""
    old = tool_input.get("old_string", "")
    new = tool_input.get("new_string", "")
    try:
        current = Path(file_path).read_text(encoding="utf-8")
    except OSError:
        return None
    if old and old not in current:
        return None
    if tool_input.get("replace_all"):
        return current.replace(old, new)
    return current.replace(old, new, 1)


def _deny(reason: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def _warn(message: str) -> dict[str, Any]:
    # Allow, but inject context the model sees so it can self-correct.
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": message,
        }
    }


async def workflow_guard_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    tool_name = input_data.get("tool_name")
    if tool_name not in ("Write", "Edit"):
        return {}

    tool_input = input_data.get("tool_input", {}) or {}
    file_path = tool_input.get("file_path", "")
    if not _is_workflow_path(file_path):
        return {}

    if tool_name == "Write":
        content = tool_input.get("content", "")
    else:  # Edit
        resulting = _resulting_edit_content(file_path, tool_input)
        if resulting is None:
            return {}  # can't determine the result → don't block
        content = resulting

    ok, error = validate_workflow_content(content)
    if not ok:
        return _deny(error or "Invalid saved workflow.")

    if scan_for_secrets(content):
        return _warn(
            "Heads up: this saved workflow looks like it hardcodes a secret. Numa "
            "chat should never contain secrets — integration credentials (native and "
            "Pipedream) are injected at runtime outside the workspace. Remove the "
            "literal value and fetch the credential at runtime instead. (Saved anyway.)"
        )

    return {}
