from __future__ import annotations

from typing import Any

# Centralized Claude CLI sandbox/settings for the code runner.
# These are written to $HOME/.claude/settings.json at runtime.

SETTINGS_JSON: dict[str, Any] = {
    "permissions": {
        "defaultMode": "acceptEdits",
        "allow": [
            # File access within the working directory
            "Read(./**)",
            "Write(./outputs/**)",
            "Write(./tmp/**)",
            # Common code-assist tools
            "Glob(./**)",
            "Grep(./**)",
            "Edit",
        ],
        "deny": [
            # Guard rails
            "Read(~/**)",
            "Read(./.env)",
            "Read(./secrets/**)",
            # No outbound network by default
            "WebFetch(*)",
        ],
    },
    # Runtime/CLI tool allowances used by the Lambda when invoking the Claude CLI
    # This ensures the CLI --allowedTools flag is derived from a single source of truth.
    "tools": {
        # Tool categories to enable at the CLI level (path restrictions are enforced by permissions above)
        "allow": [
            "Read",
            "Write",
            "Glob",
            "Grep",
            "Edit",
        ],
        # Bash command patterns allowed via the CLI (--allowedTools Bash(...))
        "bash_allow": [
            "python:*",
            "python3:*",
            "python3.13:*",
            "ls:*",
            "head:*",
            "tail:*",
            "cat:*",
            "tar:*",
            "unzip:*",
        ],
    },
    "sandbox": {
        "enabled": True,
        # Let the agent run bash commands matching the allowedTools filter
        "autoAllowBashIfSandboxed": True,
        "network": {"allowLocalBinding": False},
    },
    # Disallow bypass prompts; keep the sandbox on
    "disableBypassPermissionsMode": "disable",
}
