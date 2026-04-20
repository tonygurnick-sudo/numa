"""
NetSuite MCP Tools for Numa Workspace Agent.

Provides native tool bindings for the 11 MCP standard tools exposed by NetSuite's AI Connector Service.
These are dispatched dynamically through the `oauth-workspace-tools` Lambda.
"""

from typing import Any

import structlog
from claude_agent_sdk import tool
from numa_workspace_agent.mcp_tools.connect import _await_approval, _invoke_connect_tool

logger = structlog.get_logger()


def _dispatch_netsuite_mcp(
    method: str, params: dict[str, Any], description: str
) -> dict[str, Any]:
    """Helper to dispatch NetSuite MCP JSON-RPC calls via OAuth lambda."""
    return _invoke_connect_tool(
        "connect_netsuite_mcp",
        {"method": method, "arguments": params, "description": description},
    )


# READ OPERATIONS (Auto-approved)


@tool(
    name="ns_getRecordTypeMetadata",
    description="Discover record fields and types for NetSuite.",
    input_schema={
        "type": "object",
        "properties": {
            "recordType": {
                "type": "string",
                "description": "The type of record (e.g., customer, invoice)",
            }
        },
    },
)
async def ns_getRecordTypeMetadata(args: dict[str, Any]) -> dict[str, Any]:
    return _dispatch_netsuite_mcp(
        "ns_getRecordTypeMetadata", args, "Get NetSuite record metadata"
    )


@tool(
    name="ns_getRecord",
    description="Get a single NetSuite record.",
    input_schema={
        "type": "object",
        "properties": {
            "recordType": {"type": "string"},
            "recordId": {"type": "string"},
            "fields": {
                "type": "string",
                "description": "Comma-separated list of fields",
            },
        },
        "required": ["recordType", "recordId"],
    },
)
async def ns_getRecord(args: dict[str, Any]) -> dict[str, Any]:
    return _dispatch_netsuite_mcp("ns_getRecord", args, "Get NetSuite record")


@tool(
    name="ns_listAllReports",
    description="List available NetSuite financial reports.",
    input_schema={"type": "object"},
)
async def ns_listAllReports(args: dict[str, Any]) -> dict[str, Any]:
    return _dispatch_netsuite_mcp("ns_listAllReports", args, "List NetSuite reports")


@tool(
    name="ns_runReport",
    description="Run a NetSuite report.",
    input_schema={
        "type": "object",
        "properties": {
            "reportId": {"type": "integer"},
            "dateFrom": {"type": "string"},
            "dateTo": {"type": "string"},
            "subsidiaryId": {"type": "integer"},
        },
        "required": ["reportId", "dateTo"],
    },
)
async def ns_runReport(args: dict[str, Any]) -> dict[str, Any]:
    return _dispatch_netsuite_mcp("ns_runReport", args, "Run NetSuite report")


@tool(
    name="ns_getSubsidiaries",
    description="List NetSuite subsidiaries for report filtering.",
    input_schema={"type": "object"},
)
async def ns_getSubsidiaries(args: dict[str, Any]) -> dict[str, Any]:
    return _dispatch_netsuite_mcp(
        "ns_getSubsidiaries", args, "List NetSuite subsidiaries"
    )


@tool(
    name="ns_listSavedSearches",
    description="List saved searches in NetSuite.",
    input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
)
async def ns_listSavedSearches(args: dict[str, Any]) -> dict[str, Any]:
    return _dispatch_netsuite_mcp(
        "ns_listSavedSearches", args, "List NetSuite saved searches"
    )


@tool(
    name="ns_runSavedSearch",
    description="Run a saved search in NetSuite.",
    input_schema={
        "type": "object",
        "properties": {
            "searchId": {"type": "string"},
            "type": {"type": "string"},
            "range_start": {"type": "integer"},
            "range_end": {"type": "integer"},
        },
        "required": ["searchId"],
    },
)
async def ns_runSavedSearch(args: dict[str, Any]) -> dict[str, Any]:
    return _dispatch_netsuite_mcp(
        "ns_runSavedSearch", args, "Run NetSuite saved search"
    )


@tool(
    name="ns_runCustomSuiteQL",
    description="Execute ad-hoc NetSuite SuiteQL queries.",
    input_schema={
        "type": "object",
        "properties": {
            "sqlQuery": {"type": "string"},
            "description": {"type": "string"},
            "pageSize": {"type": "integer"},
        },
        "required": ["sqlQuery", "description"],
    },
)
async def ns_runCustomSuiteQL(args: dict[str, Any]) -> dict[str, Any]:
    return _dispatch_netsuite_mcp(
        "ns_runCustomSuiteQL", args, args.get("description", "Execute SuiteQL query")
    )


@tool(
    name="ns_getSuiteQLMetadata",
    description="Discover SuiteQL table schemas.",
    input_schema={"type": "object", "properties": {"recordType": {"type": "string"}}},
)
async def ns_getSuiteQLMetadata(args: dict[str, Any]) -> dict[str, Any]:
    return _dispatch_netsuite_mcp(
        "ns_getSuiteQLMetadata", args, "Get NetSuite SuiteQL metadata"
    )


# WRITE OPERATIONS (Require Approval)


@tool(
    name="ns_createRecord",
    description="Create a NetSuite record.",
    input_schema={
        "type": "object",
        "properties": {
            "recordType": {"type": "string"},
            "data": {
                "type": "string",
                "description": "Stringified JSON object of the record data.",
            },
        },
        "required": ["recordType", "data"],
    },
)
async def ns_createRecord(args: dict[str, Any]) -> dict[str, Any]:
    decision = _await_approval(
        "netsuite-create", f"Create NetSuite record type: {args.get('recordType')}"
    )
    if decision != "approved":
        return {
            "content": [{"type": "text", "text": f"Action not approved ({decision})."}],
            "isError": True,
        }
    return _dispatch_netsuite_mcp("ns_createRecord", args, "Create NetSuite record")


@tool(
    name="ns_updateRecord",
    description="Update an existing NetSuite record.",
    input_schema={
        "type": "object",
        "properties": {
            "recordType": {"type": "string"},
            "recordId": {"type": "string"},
            "data": {
                "type": "string",
                "description": "Stringified JSON object of the record data.",
            },
        },
        "required": ["recordType", "recordId", "data"],
    },
)
async def ns_updateRecord(args: dict[str, Any]) -> dict[str, Any]:
    decision = _await_approval(
        "netsuite-update",
        f"Update NetSuite record {args.get('recordType')} (ID {args.get('recordId')})",
    )
    if decision != "approved":
        return {
            "content": [{"type": "text", "text": f"Action not approved ({decision})."}],
            "isError": True,
        }
    return _dispatch_netsuite_mcp("ns_updateRecord", args, "Update NetSuite record")
