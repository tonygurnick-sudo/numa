"""
PreToolUse hook that normalises common parameter-name slips for SDK built-ins.

Some models (notably Sonnet 4.6) consistently confuse parameter names across
tools — e.g. passing `file_path` to Grep when the canonical parameter is
`path`, because Read uses `file_path`. The SDK rejects the call, the model
re-reasons, and we burn tokens for nothing.

Numa-defined MCP tools already tolerate common slips inside their handlers
(see numa_tool.py). SDK built-ins can't be patched directly, so we rewrite
their inputs here before the SDK dispatches them.

Aliases live in PARAM_ALIASES as `tool_name -> {canonical: [aliases...]}`.
The rewrite is silent and lossless: when an alias key is present and the
canonical key is not, we copy the value across and drop the alias.
"""

from typing import Any

try:
    from claude_agent_sdk import HookContext
except ImportError:
    HookContext = Any  # type: ignore[misc,assignment]


PARAM_ALIASES: dict[str, dict[str, list[str]]] = {
    "Grep": {
        "path": ["file_path"],
    },
}


async def param_aliases_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    tool_name = input_data.get("tool_name")
    aliases = PARAM_ALIASES.get(tool_name or "")
    if not aliases:
        return {}

    tool_input = input_data.get("tool_input", {}) or {}
    updated: dict[str, Any] | None = None

    for canonical, alias_keys in aliases.items():
        if canonical in tool_input:
            continue
        for alias in alias_keys:
            if alias in tool_input:
                if updated is None:
                    updated = dict(tool_input)
                updated[canonical] = updated.pop(alias)
                break

    if updated is None:
        return {}

    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "updatedInput": updated,
        }
    }
