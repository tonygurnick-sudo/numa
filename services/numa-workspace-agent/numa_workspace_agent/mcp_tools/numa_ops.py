"""
Numa Ops MCP tool for the workspace agent.

Provides a single tool for all Numa Ops operations (tickets, boards,
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
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog
from claude_agent_sdk import tool
from numa_workspace_agent.atomic_io import atomic_write_text
from numa_workspace_agent.mcp_tools.lambda_client import invoke_workspace_tool
from numa_workspace_agent.mcp_tools.s3_helpers import sync_file_to_s3
from numa_workspace_agent.mcp_tools.schema_preview import build_schema_preview

logger = structlog.get_logger()

# Frontend URL for constructing ticket links.
# Explicit env var takes priority (for custom domains), otherwise derive from CLIENT_NAME.
_FRONTEND_URL = os.environ.get("NUMA_FRONTEND_URL") or (
    f"https://{os.environ.get('CLIENT_NAME', 'app')}.numa.arcanum.ai"
)

# Operations that are read-only and can be auto-approved
SAFE_OPERATIONS = frozenset(
    {
        "get_config",
        "list_boards",
        "get_board",
        "list_tickets",
        "get_ticket",
        "search_tickets",
        "list_comments",
        "get_audit",
        "list_work_units",
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
        "create_board",
        "update_board",
        "update_zones",
        "update_stages",
        "create_ticket",
        "update_ticket",
        "delete_ticket",
        "bulk_update_tickets",
        "add_comment",
        "create_customer",
        "update_customer",
        "delete_customer",
        "create_supplier",
        "update_supplier",
        "delete_supplier",
        "create_customer_activity",
        "update_customer_activity",
        "delete_customer_activity",
        "create_supplier_activity",
        "update_supplier_activity",
        "delete_supplier_activity",
        "create_work_unit",
        "update_work_unit",
        "delete_work_unit",
        "create_link",
        "delete_link",
        "create_project",
        "update_project",
        "delete_project",
        "upload_attachment",
        # Config management (admin-only at the backend)
        "create_field",
        "update_field",
        "delete_field",
        "create_ticket_type",
        "update_ticket_type",
        "delete_ticket_type",
        "create_status",
        "update_status",
        "update_crm_config",
        "update_supplier_config",
    }
)


def _ok(text: str) -> dict[str, Any]:
    """Build a successful MCP tool response."""
    return {"content": [{"type": "text", "text": text}]}


def _err(text: str) -> dict[str, Any]:
    """Build an error MCP tool response.

    Dual-write `is_error` and `isError`: claude-agent-sdk's in-process MCP
    handler reads snake_case `is_error`, but the MCP spec proper uses camelCase
    `isError`. Writing both keeps both transports correct.
    """
    return {
        "content": [{"type": "text", "text": text}],
        "is_error": True,
        "isError": True,
    }


def is_safe_operation(operation: str) -> bool:
    """Check whether an ops operation is read-only (safe for auto-approval)."""
    return operation in SAFE_OPERATIONS


def _pop_approval_id(action_key: str) -> str:
    """Pop this call's approval entry (id + mode) for ``action_key``.

    Thin delegate to the canonical popper in ``lambda_client`` so the per-call
    approval mode is pinned identically across every tool module — see that
    function for why the mode must travel with the id rather than ride a single
    global.
    """
    from numa_workspace_agent.mcp_tools.lambda_client import pop_approval_id

    return pop_approval_id(action_key)


# Maximum inline result size (compact JSON chars). Results exceeding this are
# saved to a file so the LLM context stays lightweight.
MAX_INLINE = 2000


def _enrich_ticket_urls(result: Any) -> Any:
    """Add ticketUrl to ticket objects that have a displayId.

    Handles the three response shapes the ops API returns:
      - top-level ticket:          {"displayId": ..., ...}
      - wrapped ticket (create/get/update/restore): {"ticket": {"displayId": ..., ...}, ...}
      - list of tickets (list/search):              {"tickets": [{"displayId": ..., ...}, ...]}

    Skips entries that already carry a ticketUrl (the HTTP API may have
    populated it from the request Origin header for browser/integration
    callers; we don't want to clobber that with the env-var fallback URL).
    """

    def _set_url(d: dict) -> None:
        if "displayId" in d and "ticketUrl" not in d:
            d["ticketUrl"] = f"{_FRONTEND_URL}/ops?ticket={d['displayId']}"

    if isinstance(result, dict):
        _set_url(result)
        for v in result.values():
            if isinstance(v, list):
                for item in v:
                    if isinstance(item, dict):
                        _set_url(item)
            elif isinstance(v, dict):
                _set_url(v)
    return result


def _count_items(result: Any, operation: str = "") -> int | None:
    """Count items in an ops API response (find first list value)."""
    if isinstance(result, list):
        return len(result)
    if isinstance(result, dict):
        for v in result.values():
            if isinstance(v, list):
                return len(v)
    return None


def _build_summary(result: Any, operation: str) -> str | None:
    """Build a richer summary for specific operations."""
    if operation == "get_board" and isinstance(result, dict):
        zones = result.get("zones", [])
        stages = result.get("stages", [])
        board = result.get("board", {})
        name = board.get("name", "")
        parts = []
        if name:
            parts.append(f"Board: {name}")
        parts.append(f"{len(zones)} zones, {len(stages)} stages")
        stage_names = [s.get("name", "") for s in stages if isinstance(s, dict)]
        if stage_names:
            parts.append(f"Stages: {', '.join(stage_names)}")
        return ". ".join(parts)
    return None


def _save_ops_result(result: Any, operation: str) -> str:
    """Save full ops result to /workdir/tmp/ops/ and sync to S3.

    Lives under /workdir/tmp/ rather than /workdir/outputs/ because this
    is raw tool data the model uses for continuity, not a deliverable.
    /workdir/outputs/ is the user-facing Files page; raw ops JSON should
    not appear there. /workdir/tmp/ still syncs to S3 (root-level rglob
    in s3_workspace.py catches it -- not in the protected_dirs exclusion
    list) so the frontend can fetch it during live streaming and the
    model retains access across compaction/restart.
    """
    results_dir = Path("/workdir/tmp/ops")
    results_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    file_path = results_dir / f"{operation}-{timestamp}.json"
    file_content = json.dumps(result, indent=2, default=str)
    atomic_write_text(file_content, file_path)

    sync_file_to_s3(str(file_path), file_content)

    return str(file_path)


@tool(
    name="numa_ops_tool",
    description=(
        "Manage Numa Ops boards — create/search tickets, manage boards, "
        "customers, suppliers, activities, and projects. Also supports admin config "
        "management: custom fields (ticket and CRM), ticket types, statuses, "
        "and CRM/supplier configuration (lifecycle stages, record layout, "
        "industries, territories, flags). Call get_config first to load "
        "ticket types, statuses, staff, and CRM config before mutating."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "operation": {
                "type": "string",
                "description": (
                    "The operation to perform. "
                    "Read operations: get_config, list_boards, get_board, list_tickets, "
                    "get_ticket, search_tickets, list_comments, get_audit, list_work_units, "
                    "list_customers, get_customer, list_suppliers, get_supplier, list_projects, get_metrics. "
                    "Write operations: create_board, update_board, update_zones, update_stages, "
                    "create_ticket, update_ticket, delete_ticket, bulk_update_tickets, "
                    "add_comment, create_work_unit, update_work_unit, delete_work_unit, "
                    "create_link, delete_link, "
                    "create_customer, update_customer, delete_customer, "
                    "create_customer_activity, update_customer_activity, delete_customer_activity, "
                    "create_supplier, update_supplier, delete_supplier, "
                    "create_supplier_activity, update_supplier_activity, delete_supplier_activity, "
                    "create_project, "
                    "update_project, delete_project, upload_attachment. "
                    "Config management (admin-only): create_field, update_field, delete_field, "
                    "create_ticket_type, update_ticket_type, delete_ticket_type, "
                    "create_status, update_status, update_crm_config, update_supplier_config. "
                    "IMPORTANT: Ticket descriptions and comments use HTML format for rich text "
                    "(e.g. <p>, <strong>, <ul><li>), NOT markdown."
                ),
                "enum": sorted(VALID_OPERATIONS),
            },
            "params": {
                "type": "string",
                "description": (
                    "JSON string of operation-specific parameters using camelCase keys "
                    "(e.g. boardId, stageId, ticketTypeId, assigneeId, displayId). "
                    "PREFER passing names instead of IDs -- the bridge resolves "
                    "boardName, stageName, zoneName, ticketTypeName, "
                    "assigneeName/reporterName/ownerName, customerName, supplierName, "
                    "projectName, workUnitName/sprintName, targetZoneName, and "
                    "lifecycleStageName to their corresponding IDs automatically. "
                    "NEVER invent IDs -- if you don't already know one, pass the name. "
                    "Sprint model: a sprint runs inside one board zone. Activating a "
                    "sprint (update_work_unit with status=active) REQUIRES targetZoneId "
                    "(or targetZoneName). On completion, pass rolloverToWorkUnitId to "
                    "auto-activate the next sprint into the same zone with stages "
                    "preserved. See the ops skill for required/optional params per "
                    "operation."
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

    # upload_attachment is a workspace-driven flow: the file must exist on the
    # MicroVM filesystem and must be linked to a ticket. Without both, the API
    # returns a presigned URL but the file is never uploaded and no comment is
    # created, so the call silently no-ops (BUG-065).
    if operation == "upload_attachment":
        ws_path = params.get("workspaceFilePath") or params.get("workspace_file_path")
        ticket_ref = (
            params.get("ticketId")
            or params.get("ticket_id")
            or params.get("displayId")
            or params.get("display_id")
        )
        if not ws_path:
            return _err(
                "upload_attachment requires workspaceFilePath. Pass an absolute path "
                "to the file in the workspace (e.g. '/workdir/uploads/screenshot.png'). "
                "The file is uploaded directly from the workspace; there is no other "
                "supported upload path from chat."
            )
        if not ticket_ref:
            return _err(
                "upload_attachment requires ticketId or displayId so the file can be "
                "linked to a ticket. Without one, the upload would not be associated "
                "with anything."
            )
        if not Path(ws_path).is_file():
            return _err(
                f"Workspace file not found at {ws_path}. "
                "User-pasted files land in /workdir/uploads/. Use the Glob tool to "
                "locate the actual filename before calling upload_attachment."
            )

    # Pop approval ID assigned by sdk_runner (must match its key format)
    approval_key = f"ops-{operation.replace('_', '-')}"
    request_id = _pop_approval_id(approval_key)
    approval_mode_raw = os.environ.get("NUMA_APPROVAL_MODE", "")
    auto_approved = approval_mode_raw == "auto"

    logger.info(
        "Ops tool approval state",
        _name="OPS_TOOL_APPROVAL",
        operation=operation,
        approval_key=approval_key,
        approval_mode_raw=approval_mode_raw,
        auto_approved=auto_approved,
        has_request_id=bool(request_id),
    )

    try:
        result = invoke_workspace_tool(
            f"ops_{operation}",
            {
                "operation": operation,
                "params": params,
                "description": description,
                "auto_approved": auto_approved,
                "request_id": request_id,
            },
        )

        # Handle approval decisions from the tools Lambda
        if isinstance(result, dict):
            status = result.get("status")
            if status == "denied":
                return _ok(f"Operation denied by user: {operation}. {description}")
            if status == "timeout":
                return _err(
                    f"Approval window expired for: {operation}. "
                    "An approval card was shown to the user but they did not respond before it timed out. "
                    "Do NOT retry this operation automatically. Wait for the user to ask before trying again."
                )

        if (
            operation == "upload_attachment"
            and isinstance(result, dict)
            and "uploadUrl" in result
        ):
            workspace_file_path = params.get("workspaceFilePath") or params.get(
                "workspace_file_path"
            )
            if workspace_file_path:
                try:
                    import urllib.request

                    local_path = Path(workspace_file_path)
                    if not local_path.is_file():
                        return _err(
                            f"Workspace file not found at {workspace_file_path}"
                        )

                    upload_url = result["uploadUrl"]
                    content_type = (
                        params.get("contentType")
                        or params.get("content_type")
                        or "application/octet-stream"
                    )
                    file_size = local_path.stat().st_size

                    with open(local_path, "rb") as f:
                        file_data = f.read()
                        req = urllib.request.Request(
                            upload_url, data=file_data, method="PUT"
                        )
                        req.add_header("Content-Type", content_type)
                        req.add_header("Content-Length", str(file_size))
                        urllib.request.urlopen(req, timeout=60.0)

                    ticket_id = params.get("ticketId") or params.get("ticket_id")
                    display_id = params.get("displayId") or params.get("display_id")
                    if (ticket_id or display_id) and "s3Key" in result:
                        comment_params: dict[str, Any] = {
                            "content": f"📎 Attached: {local_path.name}",
                            "attachments": [
                                {
                                    "name": local_path.name,
                                    "s3Key": result["s3Key"],
                                    "size": file_size,
                                    "mimeType": content_type,
                                }
                            ],
                        }
                        if ticket_id:
                            comment_params["ticketId"] = ticket_id
                        else:
                            comment_params["displayId"] = display_id
                        invoke_workspace_tool(
                            "ops_add_comment",
                            {
                                "operation": "add_comment",
                                "params": comment_params,
                                "description": f"Auto-attaching uploaded file {local_path.name} to ticket",
                                "auto_approved": True,
                                "request_id": None,
                            },
                        )

                    return _ok(
                        f"Successfully uploaded {workspace_file_path} as an attachment!"
                    )
                except Exception as e:
                    return _err(f"Failed to upload file using presigned URL: {e}")

        # Enrich ticket objects with clickable URLs
        if operation in (
            "create_ticket",
            "update_ticket",
            "get_ticket",
            "list_tickets",
            "search_tickets",
        ):
            _enrich_ticket_urls(result)

        # Compact JSON — no indent (saves tokens)
        result_text = json.dumps(result, default=str, separators=(",", ":"))

        # Large results → save to file, return schema-with-samples preview.
        # Schema (<5KB) gives the model every key, types, array lengths, and
        # example values so it can jq the file on disk for specific fields
        # rather than Reading the whole thing.
        if len(result_text) > MAX_INLINE:
            file_path = _save_ops_result(result, operation)
            summary = _build_summary(result, operation)
            count = _count_items(result, operation)
            schema = build_schema_preview(result)
            schema_json = json.dumps(schema, indent=2, default=str)
            parts = [
                f"Ops operation completed: {operation}",
                f"Description: {description}",
            ]
            if summary:
                parts.append(summary)
            elif count is not None:
                parts.append(f"Items found: {count}")
            parts.append(f"\nFull results saved to: {file_path}")
            parts.append(
                "Schema preview below (use jq or python on the full file to "
                "extract specific fields):\n\n"
                f"{schema_json}"
            )
            return _ok("\n".join(parts))

        return _ok(
            f"Ops operation completed: {operation}\n"
            f"Description: {description}\n\n"
            f"Result:\n{result_text}"
        )

    except Exception as e:
        return _err(f"Ops operation failed ({operation}): {e}")
