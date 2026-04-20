"""MCP tools for Numa Workspace Agent."""

import os

from numa_workspace_agent.mcp_tools.connect import _invoke_connect_tool, connectors
from numa_workspace_agent.mcp_tools.execute_script import execute_script
from numa_workspace_agent.mcp_tools.integrations import (
    configure_props,
    proxy_request,
    run_action,
)
from numa_workspace_agent.mcp_tools.netsuite import (
    ns_createRecord,
    ns_getRecord,
    ns_getRecordTypeMetadata,
    ns_getSubsidiaries,
    ns_getSuiteQLMetadata,
    ns_listAllReports,
    ns_listSavedSearches,
    ns_runCustomSuiteQL,
    ns_runReport,
    ns_runSavedSearch,
    ns_updateRecord,
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
    "ns_getRecordTypeMetadata",
    "ns_getRecord",
    "ns_listAllReports",
    "ns_runReport",
    "ns_getSubsidiaries",
    "ns_listSavedSearches",
    "ns_runSavedSearch",
    "ns_runCustomSuiteQL",
    "ns_getSuiteQLMetadata",
    "ns_createRecord",
    "ns_updateRecord",
]

# Conditionally export numa_ops_tool when the feature flag is enabled.
# This allows sdk_config.py to import it only when NUMA_OPS_ENABLED is set.
if os.environ.get("NUMA_OPS_ENABLED", "").lower() in ("1", "true", "yes"):
    from numa_workspace_agent.mcp_tools.numa_ops import numa_ops_tool

    __all__.append("numa_ops_tool")
