"""MCP tools for Numa Workspace Agent.

The in-process MCP tool layer was removed in Phase 6 — all agent types are
MCP-free and workspace capabilities are now served via the ``numa`` CLI / Bash.
The only surviving module is ``integration_preferences``, a pure-Python helper
imported directly as a submodule by ``prompts.py`` (it has no MCP dependency).
"""
