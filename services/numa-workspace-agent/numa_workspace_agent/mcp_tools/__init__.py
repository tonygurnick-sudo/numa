"""MCP tools for Numa Workspace Agent."""

import os

from numa_workspace_agent.mcp_tools.connect import _invoke_connect_tool, connectors
from numa_workspace_agent.mcp_tools.execute_script import execute_script
from numa_workspace_agent.mcp_tools.integrations import (
    configure_props,
    proxy_request,
    run_action,
)
from numa_workspace_agent.mcp_tools.numa_tool import numa_tool
from numa_workspace_agent.mcp_tools.vault import vault

__all__ = [
    "execute_script",
    "run_action",
    "configure_props",
    "proxy_request",
    "numa_tool",
    "connectors",
    "_invoke_connect_tool",
    "vault",
]

# Conditionally export numa_ops_tool when the feature flag is enabled.
# This allows sdk_config.py to import it only when NUMA_OPS_ENABLED is set.
if os.environ.get("NUMA_OPS_ENABLED", "").lower() in ("1", "true", "yes"):
    from numa_workspace_agent.mcp_tools.numa_ops import numa_ops_tool

    __all__.append("numa_ops_tool")
