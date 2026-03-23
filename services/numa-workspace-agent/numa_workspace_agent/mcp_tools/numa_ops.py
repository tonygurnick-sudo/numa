"""
Numa Ops MCP tool for the workspace agent.

Provides a single tool for all Numa Ops operations (tickets, teams,
customers, suppliers, projects, config). Feature-flagged via
NUMA_OPS_ENABLED env var — only registered when the flag is true.

Operations route through the workspace-chat-tools Lambda, which then
invokes the appropriate ops Lambda (numa-ops-api, numa-ops-config-api,
numa-ops-crm-api) using cross-Lambda invocation.

Approval model:
- Safe (auto-approved): list_*, get_*, search_*, get_config, list_projects
- Unsafe (requires approval): create_*, update_*, delete_*, add_comment, upload_attachment
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from claude_agent_sdk import tool
from numa_workspace_agent.mcp_tools.lambda_client import invoke_workspace_tool

logger = logging.getLogger(__name__)

# Operations that are read-only and can be auto-approved
SAFE_OPERATIONS = frozenset(
    {
        "get_config",
        "list_teams",
        "get_team",
        "list_tickets",
        "get_ticket",
        "search_tickets",
        "list_comments",
        "list_customers",
        "get_customer",
        "list_suppliers",
        "get_supplier",
        "list_projects",
        "get_metrics",
    }
)

# All valid operations
VALID_OPERATIONS = SAFE_OPERATIONS | frozenset(
    {
        "create_team",
        "update_team",
        "create_ticket",
        "update_ticket",
        "delete_ticket",
        "add_comment",
        "create_customer",
        "update_customer",
        "delete_customer",
        "create_supplier",
        "update_supplier",
        "delete_supplier",
        "create_project",
        "update_project",
        "upload_attachment",
    }
)


def _ok(text: str) -> dict[str, Any]:
    """Build a successful MCP tool response."""
    return {"content": [{"type": "text", "text": text}]}


def _err(text: str) -> dict[str, Any]:
    """Build an error MCP tool response."""
    return {"content": [{"type": "text", "text": text}], "isError": True}


def is_safe_operation(operation: str) -> bool:
    """Check whether an ops operation is read-only (safe for auto-approval)."""
    return operation in SAFE_OPERATIONS


# Maximum inline result size (compact JSON chars). Results exceeding this are
# saved to a file so the LLM context stays lightweight.
MAX_INLINE = 2000


def _count_items(result: Any) -> int | None:
    """Count items in an ops API response (find first list value)."""
    if isinstance(result, list):
        return len(result)
    if isinstance(result, dict):
        for v in result.values():
            if isinstance(v, list):
                return len(v)
    return None


def _save_ops_result(result: Any, operation: str) -> str:
    """Save full ops result to /workdir/outputs/ops/, return file path."""
    results_dir = Path("/workdir/outputs/ops")
    results_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    file_path = results_dir / f"{operation}-{timestamp}.json"
    file_path.write_text(json.dumps(result, indent=2, default=str))
    return str(file_path)


@tool(
    name="numa_ops_tool",
    description=(
        "Manage Numa Ops boards — create/search tickets, manage teams, "
        "customers, suppliers, and projects. Call get_config first to load "
        "ticket types, statuses, and staff before creating tickets."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "operation": {
                "type": "string",
                "description": (
                    "The operation to perform. "
                    "Read operations: get_config, list_teams, get_team, list_tickets, "
                    "get_ticket, search_tickets, list_comments, list_customers, "
                    "get_customer, list_suppliers, get_supplier, list_projects, get_metrics. "
                    "Write operations: create_team, update_team, create_ticket, "
                    "update_ticket, delete_ticket, add_comment, create_customer, "
                    "update_customer, delete_customer, create_supplier, update_supplier, "
                    "delete_supplier, create_project, update_project, upload_attachment."
                ),
                "enum": sorted(VALID_OPERATIONS),
            },
            "params": {
                "type": "string",
                "description": (
                    "JSON string of operation-specific parameters. "
                    "See the ops skill documentation for required/optional params per operation."
                ),
            },
            "description": {
                "type": "string",
                "description": (
                    "Human-readable description of what this operation does. "
                    "For write operations, include the full content being created/changed "
                    "(shown to user for approval)."
                ),
            },
        },
        "required": ["operation", "params", "description"],
    },
)
async def numa_ops_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Execute a Numa Ops operation."""
    operation = args.get("operation", "")
    params_str = args.get("params", "{}")
    description = args.get("description", "")

    if operation not in VALID_OPERATIONS:
        return _err(
            f"Unknown operation: {operation}. "
            f"Valid operations: {', '.join(sorted(VALID_OPERATIONS))}"
        )

    # Parse params JSON
    try:
        params = json.loads(params_str) if isinstance(params_str, str) else params_str
    except json.JSONDecodeError as e:
        return _err(f"Invalid params JSON: {e}")

    # Determine approval mode for this operation
    ops_approval_mode = os.environ.get("NUMA_OPS_APPROVAL_MODE", "non_destructive")
    is_safe = is_safe_operation(operation)

    if ops_approval_mode == "auto":
        auto_approved = True
    elif ops_approval_mode == "non_destructive":
        auto_approved = is_safe
    else:  # "manual"
        auto_approved = False

    # Set approval mode env var for the tools Lambda
    os.environ["NUMA_APPROVAL_MODE"] = "auto" if auto_approved else "manual"

    try:
        result = invoke_workspace_tool(
            f"ops_{operation}",
            {
                "operation": operation,
                "params": params,
                "description": description,
                "auto_approved": auto_approved,
            },
        )

        # Compact JSON — no indent (saves tokens)
        result_text = json.dumps(result, default=str, separators=(",", ":"))

        # Large results → save to file, return lightweight summary
        if len(result_text) > MAX_INLINE:
            file_path = _save_ops_result(result, operation)
            count = _count_items(result)
            parts = [
                f"Ops operation completed: {operation}",
                f"Description: {description}",
            ]
            if count is not None:
                parts.append(f"Items found: {count}")
            parts.append(f"\nFull results saved to: {file_path}")
            parts.append(
                "Read the file with execute_script if you need specific details."
            )
            return _ok("\n".join(parts))

        return _ok(
            f"Ops operation completed: {operation}\n"
            f"Description: {description}\n\n"
            f"Result:\n{result_text}"
        )

    except Exception as e:
        return _err(f"Ops operation failed ({operation}): {e}")
