"""
Settings for the Default Claude Code Agent.

Provides basic, safe settings for general-purpose Claude CLI usage.
"""

import os
from typing import Any, Dict

# Environment variables to pass to Claude CLI
ENV_VARS: Dict[str, str] = {
    "MAX_THINKING_TOKENS": os.environ.get("MAX_THINKING_TOKENS", "80000"),
}

# Settings for Claude CLI configuration
SETTINGS_JSON: Dict[str, Any] = {
    "permissions": {
        "defaultMode": "allowed_tools",
    },
    "tools": {
        "allow": [
            "Read",
            "Write",
            "Edit",
            "Glob",
            "Grep",
        ],
        "bash_allow": [
            # Basic safe bash commands
            "ls:*",
            "pwd",
            "echo:*",
            "cat:*",
            "head:*",
            "tail:*",
            "wc:*",
            "date",
            "whoami",
            "env",
            "which:*",
            "file:*",
        ],
    },
    # No dangerous permissions
    "dangerouslyDisableSandbox": False,
}
