"""MCP tools for Numa Workspace Agent."""

from numa_workspace_agent.mcp_tools.execute_script import execute_script
from numa_workspace_agent.mcp_tools.integrations import (
    configure_props,
    proxy_request,
    run_action,
)

__all__ = [
    "execute_script",
    "run_action",
    "configure_props",
    "proxy_request",
]
