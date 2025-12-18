from __future__ import annotations

from typing import Any

# Centralized Claude CLI sandbox/settings for the Nolia Translate agent.

ENV_VARS: dict[str, str] = {
    "MAX_THINKING_TOKENS": "10000",
}

SETTINGS_JSON: dict[str, Any] = {
    "permissions": {
        "defaultMode": "acceptEdits",
        "allow": [
            "Read(./**)",
            "Write(./outputs/**)",
            "Write(./tmp/**)",
            "Glob(./**)",
            "Grep(./**)",
            "Edit",
        ],
        "deny": [
            "Read(~/**)",
            "Read(./.env)",
            "Read(./secrets/**)",
            "WebFetch(*)",
        ],
    },
    "tools": {
        "allow": [
            "Read",
            "Write",
            "Glob",
            "Grep",
            "Edit",
            "TodoWrite",
        ],
        "bash_allow": [
            "ls:*",
            "head:*",
            "tail:*",
            "cat:*",
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
