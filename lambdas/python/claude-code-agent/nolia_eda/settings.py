from __future__ import annotations

from typing import Any

# Centralized Claude CLI sandbox/settings for the Nolia EDA agent.
# These are written to $HOME/.claude/settings.json at runtime.

# Environment variables for Claude CLI runtime behavior
ENV_VARS: dict[str, str] = {
    # Extended thinking token budget for complex document analysis
    "MAX_THINKING_TOKENS": "10000",
}

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
            # Allow fetching Arcanum documentation
            "WebFetch(domain:arcanum.ai)",
            "WebFetch(domain:www.arcanum.ai)",
        ],
        "deny": [
            # Guard rails
            "Read(~/**)",
            "Read(./.env)",
            "Read(./secrets/**)",
            # No outbound network by default (except allowed domains above)
            "WebFetch(*)",
        ],
    },
    # Runtime/CLI tool allowances used by the Lambda when invoking the Claude CLI
    "tools": {
        "allow": [
            "Read",
            "Write",
            "Glob",
            "Grep",
            "Edit",
            "TodoWrite",
            "Task",
            "WebFetch",
            "BashOutput",
            "KillShell",
        ],
        # Bash command patterns allowed via the CLI
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
            "mkdir:*",
            "mv:*",
            "cp:*",
            "wc:*",
            "file:*",
        ],
    },
    "sandbox": {
        "enabled": True,
        "autoAllowBashIfSandboxed": True,
        "network": {"allowLocalBinding": False},
    },
    "disableBypassPermissionsMode": "disable",
}
