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
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog
from claude_agent_sdk import tool
from numa_workspace_agent.mcp_tools.lambda_client import invoke_workspace_tool

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
        "list_teams",
        "get_team",
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
        "create_team",
        "update_team",
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
        "create_work_unit",
        "update_work_unit",
        "delete_work_unit",
        "create_link",
        "delete_link",
        "create_project",
        "update_project",
        "delete_project",
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


def _pop_approval_id(action_key: str) -> str:
    """Pop the next approval ID for this action_key from NUMA_REQUEST_ID_MAP.

    The SDK runner stores a JSON dict of action_key → [approval_id, ...] in
    the env var. Each tool call pops the first entry (FIFO) so parallel calls
    to the same action each get their own unique ID.

    Falls back to the legacy single-value NUMA_REQUEST_ID env var.
    """
    raw = os.environ.get("NUMA_REQUEST_ID_MAP", "")
    if raw:
        try:
            id_map = json.loads(raw)
            ids = id_map.get(action_key, [])
            if ids:
                approval_id = ids.pop(0)
                if not ids:
                    id_map.pop(action_key, None)
                else:
                    id_map[action_key] = ids
                os.environ["NUMA_REQUEST_ID_MAP"] = json.dumps(id_map)
                return approval_id
        except (json.JSONDecodeError, TypeError):
            pass
    return os.environ.get("NUMA_REQUEST_ID", "")


# Maximum inline result size (compact JSON chars). Results exceeding this are
# saved to a file so the LLM context stays lightweight.
MAX_INLINE = 2000


def _enrich_ticket_urls(result: Any) -> Any:
    """Add ticketUrl to ticket objects that have a displayId."""
    if isinstance(result, dict):
        if "displayId" in result:
            result["ticketUrl"] = f"{_FRONTEND_URL}/ops?ticket={result['displayId']}"
        for v in result.values():
            if isinstance(v, list):
                for item in v:
                    if isinstance(item, dict) and "displayId" in item:
                        item["ticketUrl"] = (
                            f"{_FRONTEND_URL}/ops?ticket={item['displayId']}"
                        )
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
    if operation == "get_team" and isinstance(result, dict):
        zones = result.get("zones", [])
        stages = result.get("stages", [])
        team = result.get("team", {})
        name = team.get("name", "")
        parts = []
        if name:
            parts.append(f"Team: {name}")
        parts.append(f"{len(zones)} zones, {len(stages)} stages")
        stage_names = [s.get("name", "") for s in stages if isinstance(s, dict)]
        if stage_names:
            parts.append(f"Stages: {', '.join(stage_names)}")
        return ". ".join(parts)
    return None


def _save_ops_result(result: Any, operation: str) -> str:
    """Save full ops result to /workdir/outputs/ops/ and sync to S3.

    The file is uploaded to S3 immediately so the frontend can fetch it
    during live streaming (before the full workspace sync runs).
    """
    results_dir = Path("/workdir/outputs/ops")
    results_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    file_path = results_dir / f"{operation}-{timestamp}.json"
    file_content = json.dumps(result, indent=2, default=str)
    file_path.write_text(file_content)

    # Upload to S3 immediately so the frontend can render during streaming
    _sync_ops_file_to_s3(file_path, file_content)

    return str(file_path)


def _sync_ops_file_to_s3(file_path: Path, content: str) -> None:
    """Upload a single ops result file to S3 (fire-and-forget)."""
    try:
        bucket = os.environ.get("OUTPUTS_BUCKET_NAME", "")
        user_sub = os.environ.get("NUMA_USER_SUB", "")
        conversation_id = os.environ.get("NUMA_CONVERSATION_ID", "")

        if not bucket or not user_sub or not conversation_id:
            logger.debug("Skipping ops S3 sync — missing env vars")
            return

        # /workdir/outputs/ops/file.json -> outputs/ops/file.json
        rel_path = str(file_path).replace("/workdir/", "")
        s3_key = (
            f"numa-chat/workspace/{user_sub}"
            f"/conversations/{conversation_id}/{rel_path}"
        )

        import boto3

        s3 = boto3.client("s3")
        s3.put_object(
            Bucket=bucket,
            Key=s3_key,
            Body=content.encode("utf-8"),
            ContentType="application/json",
        )
        logger.debug("Synced ops result to S3", s3_key=s3_key)
    except Exception as e:
        # Non-fatal — workspace sync will catch it later
        logger.warning("Failed to sync ops result to S3", error=str(e))


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
                    "get_ticket, search_tickets, list_comments, get_audit, list_work_units, "
                    "list_customers, get_customer, list_suppliers, get_supplier, list_projects, get_metrics. "
                    "Write operations: create_team, update_team, update_zones, update_stages, "
                    "create_ticket, update_ticket, delete_ticket, bulk_update_tickets, "
                    "add_comment, create_work_unit, update_work_unit, delete_work_unit, "
                    "create_link, delete_link, "
                    "create_customer, update_customer, delete_customer, "
                    "create_supplier, update_supplier, delete_supplier, create_project, "
                    "update_project, delete_project, upload_attachment. "
                    "IMPORTANT: Ticket descriptions and comments use HTML format for rich text "
                    "(e.g. <p>, <strong>, <ul><li>), NOT markdown."
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
                return _ok(
                    f"Approval timed out for: {operation}. "
                    "The user did not respond within 90 seconds. "
                    "You can offer to try again if the user is ready."
                )

        if (
            operation == "upload_attachment"
            and isinstance(result, dict)
            and "uploadUrl" in result
        ):
            workspace_file_path = params.get("workspace_file_path")
            if workspace_file_path:
                try:
                    import urllib.request

                    local_path = Path(workspace_file_path)
                    if not local_path.is_file():
                        return _err(
                            f"Workspace file not found at {workspace_file_path}"
                        )

                    upload_url = result["uploadUrl"]
                    content_type = params.get(
                        "content_type", "application/octet-stream"
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

                    ticket_id = params.get("ticket_id")
                    if ticket_id and "s3Key" in result:
                        invoke_workspace_tool(
                            "ops_add_comment",
                            {
                                "operation": "add_comment",
                                "params": {
                                    "ticket_id": ticket_id,
                                    "content": f"📎 Attached: {local_path.name}",
                                    "attachments": [
                                        {
                                            "name": local_path.name,
                                            "s3Key": result["s3Key"],
                                            "size": file_size,
                                            "mimeType": content_type,
                                        }
                                    ],
                                },
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

        # Large results → save to file, return lightweight summary
        if len(result_text) > MAX_INLINE:
            file_path = _save_ops_result(result, operation)
            summary = _build_summary(result, operation)
            count = _count_items(result, operation)
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
