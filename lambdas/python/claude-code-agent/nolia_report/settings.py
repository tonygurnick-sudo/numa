from __future__ import annotations

from typing import Any

# Centralized Claude CLI sandbox/settings for the Nolia Report agent.

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
            "WebFetch(domain:arcanum.ai)",
            "WebFetch(domain:www.arcanum.ai)",
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
            "Task",
            "WebFetch",
            "BashOutput",
            "KillShell",
        ],
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
