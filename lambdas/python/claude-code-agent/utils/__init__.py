"""
Shared utilities for Claude Code Agent lambda.

These utilities provide common functionality that can be reused across different agent types.
"""

# Optional: Export commonly used functions for easier imports
# from .workspace import setup_workspace, hydrate_inputs
# from .session import restore_session, archive_session
# from .cli_runner import ensure_claude_cli, run_claude_stream

from .bedrock_session import get_cross_account_bedrock_credentials
