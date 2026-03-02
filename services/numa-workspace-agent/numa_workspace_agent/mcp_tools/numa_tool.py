"""
Unified Numa MCP tool — single dispatcher for all Numa platform tools.

Replaces bash script invocations (knowledge_base.py, web_search.py,
extract_content.py, convert_document.py, numa-agents.py, numa-memories.py)
with a single MCP tool that invokes the workspace-chat-tools Lambda
directly. This brings all Numa tools into the MCP layer, enabling HITL
capability, consistent observability, and a cleaner architecture.

Architecture:
    Before:  Claude → Bash → python3 /workdir/tools/numa/script.py → boto3 → Lambda
    After:   Claude → numa_tool MCP → invoke_workspace_tool() → Lambda

The tool uses a single @tool() decorator with a `name` enum to dispatch
to per-tool handlers. Skills continue to teach Claude what params each
tool expects.
"""

import base64
import json
import logging
import os
from pathlib import Path
from typing import Any

from claude_agent_sdk import tool
from numa_workspace_agent.mcp_tools.lambda_client import invoke_workspace_tool
from numa_workspace_agent.mcp_tools.s3_helpers import (
    download_from_presigned_url,
    download_from_s3,
    ensure_file_in_s3,
)

logger = logging.getLogger(__name__)

# Upload size limit for KB uploads (matches knowledge_base.py)
MAX_UPLOAD_SIZE = 4 * 1024 * 1024


# ── Helper: build MCP response ──────────────────────────────────────────────


def _ok(text: str) -> dict[str, Any]:
    """Build a successful MCP tool response."""
    return {"content": [{"type": "text", "text": text}]}


def _err(text: str) -> dict[str, Any]:
    """Build an error MCP tool response."""
    return {"content": [{"type": "text", "text": text}], "isError": True}


# ── Helper: get KB config from environment ───────────────────────────────────


def _get_kb_config() -> tuple[list[dict], list[str], str]:
    """Read KB configuration from environment.

    Returns:
        Tuple of (allowed_kbs_with_names, allowed_kb_ids, user_sub)
    """
    allowed_kbs_json = os.environ.get("NUMA_ALLOWED_KBS", "[]")
    try:
        allowed_kbs = json.loads(allowed_kbs_json)
    except json.JSONDecodeError:
        allowed_kbs = []

    allowed_kb_ids = [kb.get("id") for kb in allowed_kbs if kb.get("id")]
    user_sub = os.environ.get("NUMA_USER_SUB", "")

    return allowed_kbs, allowed_kb_ids, user_sub


def _get_user_context() -> tuple[str, str]:
    """Read user_sub and conversation_id from environment.

    Returns:
        Tuple of (user_sub, conversation_id)
    """
    return (
        os.environ.get("NUMA_USER_SUB", ""),
        os.environ.get("NUMA_CONVERSATION_ID", ""),
    )


# ═════════════════════════════════════════════════════════════════════════════
# Per-tool handlers
# ═════════════════════════════════════════════════════════════════════════════


async def _handle_query_kb(params: dict[str, Any]) -> dict[str, Any]:
    """Query knowledge bases — ports knowledge_base.py cmd_query."""
    allowed_kbs, allowed_kb_ids, user_sub = _get_kb_config()

    query = params.get("query")
    user_intent = params.get("user_intent")
    if not query or not user_intent:
        return _err(
            "Both 'query' and 'user_intent' are required for query_knowledge_base."
        )

    max_results = min(max(int(params.get("max_results", 6)), 1), 15)

    result = invoke_workspace_tool(
        "query_knowledgebase",
        {
            "query": query,
            "user_intent": user_intent,
            "max_results": max_results,
            "kb_id": params.get("kb_id", "company"),
            "summarise_results": params.get("summarise_results", True),
            "all_kbs": params.get("all_kbs", False),
        },
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_kbs": allowed_kb_ids,
            "allowed_kbs_with_names": allowed_kbs,
        },
    )

    # If output_file requested, write results to file
    output_file = params.get("output_file")
    if output_file:
        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(result, indent=2))
        results_count = result.get(
            "results_count", result.get("total_results_count", 0)
        )
        return _ok(
            json.dumps(
                {
                    "status": "success",
                    "message": f"Results written to {output_path}",
                    "file_path": str(output_path),
                    "results_count": results_count,
                },
                indent=2,
            )
        )

    return _ok(json.dumps(result, indent=2))


async def _handle_web_search(params: dict[str, Any]) -> dict[str, Any]:
    """Search the web — ports web_search.py main."""
    query = params.get("query")
    user_intent = params.get("user_intent")
    if not query or not user_intent:
        return _err("Both 'query' and 'user_intent' are required for web_search.")

    max_results = max(1, min(int(params.get("max_results", 3)), 10))

    result = invoke_workspace_tool(
        "web_search",
        {
            "query": query,
            "user_intent": user_intent,
            "max_results": max_results,
        },
    )

    return _ok(json.dumps(result, indent=2))


async def _handle_extract_content(params: dict[str, Any]) -> dict[str, Any]:
    """Extract text from files — ports extract_content.py main."""
    file_path = params.get("file_path")
    if not file_path:
        return _err("'file_path' is required for extract_content.")

    user_sub, conversation_id = _get_user_context()
    if not user_sub or not conversation_id:
        return _err(
            "User context (NUMA_USER_SUB, NUMA_CONVERSATION_ID) required for extract_content."
        )

    # Ensure file is in S3 before Lambda invocation
    ensure_file_in_s3(file_path, user_sub, conversation_id)

    result = invoke_workspace_tool(
        "extract_content",
        {"file_path": file_path},
        extra_event_fields={
            "user_sub": user_sub,
            "conversation_id": conversation_id,
        },
    )

    output_path = result.get("output_path")
    s3_key = result.get("s3_key")

    if not output_path or not s3_key:
        return _err("No output path in Lambda response.")

    # Download extracted content from S3 to local workspace
    outputs_bucket = os.environ.get("OUTPUTS_BUCKET_NAME", "")
    if not outputs_bucket:
        return _err("OUTPUTS_BUCKET_NAME not configured for local download.")

    download_from_s3(outputs_bucket, s3_key, output_path)

    return _ok(
        json.dumps(
            {
                "status": "success",
                "message": result.get("message", f"Content extracted to {output_path}"),
                "output_path": output_path,
                "original_file": result.get("original_file", file_path),
                "text_length": result.get("text_length", 0),
            },
            indent=2,
        )
    )


async def _handle_convert_document(params: dict[str, Any]) -> dict[str, Any]:
    """Convert documents — ports convert_document.py main."""
    file_path = params.get("file_path")
    fmt = params.get("format")
    if not file_path or not fmt:
        return _err("Both 'file_path' and 'format' are required for convert_document.")

    if fmt not in ("pdf", "docx"):
        return _err(f"Invalid format '{fmt}'. Must be 'pdf' or 'docx'.")

    mode = params.get("mode", "markdown")
    if mode not in ("markdown", "file"):
        return _err(f"Invalid mode '{mode}'. Must be 'markdown' or 'file'.")

    # For file mode, validate input format
    if mode == "file":
        file_ext = Path(file_path).suffix.lower().lstrip(".")
        if file_ext not in ("pdf", "docx"):
            return _err(
                f"For mode 'file', input must be .pdf or .docx (got .{file_ext})."
            )
        if file_ext == fmt:
            return _err(
                f"Input and output format are the same ({file_ext}). No conversion needed."
            )

    user_sub, conversation_id = _get_user_context()
    if not user_sub or not conversation_id:
        return _err(
            "User context (NUMA_USER_SUB, NUMA_CONVERSATION_ID) required for convert_document."
        )

    # Ensure file is in S3 before Lambda invocation
    ensure_file_in_s3(file_path, user_sub, conversation_id)

    lambda_params: dict[str, Any] = {
        "file_path": file_path,
        "format": fmt,
        "mode": mode,
    }
    if params.get("title"):
        lambda_params["title"] = params["title"]

    result = invoke_workspace_tool(
        "convert_document",
        lambda_params,
        extra_event_fields={
            "user_sub": user_sub,
            "conversation_id": conversation_id,
        },
    )

    output_path = result.get("output_path")
    s3_key = result.get("s3_key")

    if not output_path or not s3_key:
        return _err("No output path in Lambda response.")

    # Download converted document from S3
    outputs_bucket = os.environ.get("OUTPUTS_BUCKET_NAME", "")
    if not outputs_bucket:
        return _err("OUTPUTS_BUCKET_NAME not configured for local download.")

    download_from_s3(outputs_bucket, s3_key, output_path)

    return _ok(
        json.dumps(
            {
                "status": "success",
                "message": result.get(
                    "message", f"Document converted to {output_path}"
                ),
                "output_path": output_path,
                "original_file": result.get("original_file", file_path),
                "format": fmt,
                "mode": mode,
                "size": result.get("size", 0),
            },
            indent=2,
        )
    )


async def _handle_kb_upload(params: dict[str, Any]) -> dict[str, Any]:
    """Upload file to KB — ports knowledge_base.py cmd_upload."""
    file_param = params.get("file")
    if not file_param:
        return _err("'file' (path to file in workspace) is required for kb_upload.")

    file_path = Path(file_param)
    if not file_path.exists():
        return _err(f"File not found: {file_param}")

    file_size = file_path.stat().st_size
    if file_size > MAX_UPLOAD_SIZE:
        size_mb = file_size / 1024 / 1024
        return _err(
            f"File too large ({size_mb:.1f} MB). Maximum is 4 MB. "
            "Please upload large files via the Numa web interface."
        )

    allowed_kbs, allowed_kb_ids, user_sub = _get_kb_config()

    with open(file_path, "rb") as f:
        content_base64 = base64.b64encode(f.read()).decode("utf-8")

    # kb_path is a folder prefix, not a destination filename.
    # If the caller passed a filename-like path (has extension), strip it to avoid
    # creating a spurious subdirectory (e.g. "file.md/file.md").
    kb_path = params.get("path", "")
    if kb_path and "." in Path(kb_path).name:
        kb_path = str(Path(kb_path).parent) if str(Path(kb_path).parent) != "." else ""

    result = invoke_workspace_tool(
        "add_to_kb",
        {
            "filename": file_path.name,
            "kb_id": params.get("kb_id", "company"),
            "kb_path": kb_path,
            "content_base64": content_base64,
            "size_bytes": file_size,
        },
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_kbs": allowed_kb_ids,
        },
    )

    return _ok(json.dumps(result, indent=2))


async def _handle_kb_download(params: dict[str, Any]) -> dict[str, Any]:
    """Download file from KB — ports knowledge_base.py cmd_download."""
    uri = params.get("uri")
    file_name = params.get("file")

    if not uri and not file_name:
        return _err("Either 'uri' or 'file' must be provided for kb_download.")

    allowed_kbs, allowed_kb_ids, user_sub = _get_kb_config()

    dl_params: dict[str, Any] = {"mode": "download"}
    if uri:
        dl_params["uri"] = uri
    else:
        dl_params["file"] = file_name
        dl_params["kb_id"] = params.get("kb_id", "company")

    result = invoke_workspace_tool(
        "retrieve_kb_file",
        dl_params,
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_kbs": allowed_kb_ids,
        },
    )

    # Save file to disk
    filename = result.get("filename", "downloaded_file")
    output_dir = Path(params.get("output_dir", "/workdir/outputs/"))
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename

    if result.get("presigned_url"):
        actual_size = download_from_presigned_url(
            url=result["presigned_url"],
            dest_path=str(output_path),
            expected_size=result.get("size_bytes", 0),
        )
        return _ok(
            json.dumps(
                {
                    "status": "success",
                    "message": f"File saved to {output_path}",
                    "filename": filename,
                    "size_bytes": actual_size,
                    "output_path": str(output_path),
                    "s3_uri": result.get("s3_uri"),
                },
                indent=2,
            )
        )

    elif result.get("content_base64"):
        file_content = base64.b64decode(result["content_base64"])
        with open(output_path, "wb") as f:
            f.write(file_content)
        return _ok(
            json.dumps(
                {
                    "status": "success",
                    "message": f"File saved to {output_path}",
                    "filename": filename,
                    "size_bytes": len(file_content),
                    "output_path": str(output_path),
                    "s3_uri": result.get("s3_uri"),
                },
                indent=2,
            )
        )

    return _ok(json.dumps(result, indent=2))


async def _handle_kb_list(params: dict[str, Any]) -> dict[str, Any]:
    """List files in a KB — ports knowledge_base.py cmd_list."""
    allowed_kbs, allowed_kb_ids, user_sub = _get_kb_config()

    result = invoke_workspace_tool(
        "retrieve_kb_file",
        {
            "mode": "list",
            "kb_id": params.get("kb_id", "company"),
            "pattern": params.get("pattern"),
        },
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_kbs": allowed_kb_ids,
        },
    )

    return _ok(json.dumps(result, indent=2))


async def _handle_kb_download_folder(params: dict[str, Any]) -> dict[str, Any]:
    """Download KB folder as zip — ports knowledge_base.py cmd_download_folder."""
    allowed_kbs, allowed_kb_ids, user_sub = _get_kb_config()

    result = invoke_workspace_tool(
        "retrieve_kb_file",
        {
            "mode": "download_folder",
            "kb_id": params.get("kb_id", "company"),
            "folder_path": params.get("folder_path", ""),
        },
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_kbs": allowed_kb_ids,
        },
    )

    # Save zip file to disk
    filename = result.get("filename", "download.zip")
    output_dir = Path(params.get("output_dir", "/workdir/outputs/"))
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename

    if result.get("presigned_url"):
        actual_size = download_from_presigned_url(
            url=result["presigned_url"],
            dest_path=str(output_path),
            expected_size=result.get("size_bytes", 0),
        )
        return _ok(
            json.dumps(
                {
                    "status": "success",
                    "message": f"Folder downloaded to {output_path}",
                    "filename": filename,
                    "size_bytes": actual_size,
                    "output_path": str(output_path),
                    "file_count": result.get("file_count", 0),
                    "total_files_in_folder": result.get("total_files_in_folder", 0),
                },
                indent=2,
            )
        )

    elif result.get("content_base64"):
        file_content = base64.b64decode(result["content_base64"])
        with open(output_path, "wb") as f:
            f.write(file_content)
        return _ok(
            json.dumps(
                {
                    "status": "success",
                    "message": f"Folder downloaded to {output_path}",
                    "filename": filename,
                    "size_bytes": len(file_content),
                    "output_path": str(output_path),
                    "file_count": result.get("file_count", 0),
                    "total_files_in_folder": result.get("total_files_in_folder", 0),
                },
                indent=2,
            )
        )

    return _ok(json.dumps(result, indent=2))


# ── Helpers: check tool enablement ───────────────────────────────────────────


def _get_enabled_tools() -> list[str]:
    """Parse NUMA_ENABLED_TOOLS from environment (frontend request toggles)."""
    raw = os.environ.get("NUMA_ENABLED_TOOLS", "[]")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return []


def _get_allowed_operations() -> list[str] | None:
    """Parse NUMA_ALLOWED_OPERATIONS from environment (agent type config).

    Returns None if not set (all operations allowed), or a list of permitted
    operation names.
    """
    raw = os.environ.get("NUMA_ALLOWED_OPERATIONS")
    if raw is None:
        return None  # No restriction — all operations allowed
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return []  # Malformed → fail-closed (no operations allowed)


# Maps MCP operation names to the frontend-toggle key that controls them.
# KB operations all share the same toggle (query_knowledge_base) — if the
# user hasn't enabled a KB, they shouldn't be able to upload/download/list
# either.  Operations not in this map are always allowed by frontend toggles
# (but can still be restricted by NUMA_ALLOWED_OPERATIONS at agent type level).
_OPERATION_TO_ENABLED_TOOL_KEY: dict[str, str] = {
    "knowledge_base": "query_knowledge_base",
    "web_search": "web_search",
    "agents": "create_agent_tool",
    "memories": "memories_tool",
}


def _check_operation_allowed(operation: str) -> str | None:
    """Check if an operation is allowed by both agent type config and frontend toggles.

    Returns None if allowed, or an error message string if blocked.
    """
    # Layer 1: Agent type config (developer-level hard limit)
    allowed_ops = _get_allowed_operations()
    if allowed_ops is not None and operation not in allowed_ops:
        return (
            f"The '{operation}' operation is not available for this agent type. "
            f"Available operations: {', '.join(allowed_ops) if allowed_ops else 'none'}."
        )

    # Layer 2: Frontend request toggles (user-level controls)
    toggle_key = _OPERATION_TO_ENABLED_TOOL_KEY.get(operation)
    if toggle_key is not None:
        enabled_tools = _get_enabled_tools()
        if toggle_key not in enabled_tools:
            # User-friendly messages per tool
            messages = {
                "knowledge_base": "Knowledge base is not enabled. Enable a knowledge base in chat settings.",
                "web_search": "Web search is not enabled. Enable 'Web Search' in chat settings.",
                "agents": "Agent tools are not enabled. Enable 'Agent Creation' in chat settings.",
                "memories": "Memory management is not enabled. Enable 'Update Memory' in chat settings.",
            }
            return messages.get(
                operation, f"'{operation}' is not enabled in chat settings."
            )

    return None  # Allowed


# ═════════════════════════════════════════════════════════════════════════════
# Knowledge Base handler (consolidated)
# ═════════════════════════════════════════════════════════════════════════════

_KB_OPERATIONS = {
    "query": _handle_query_kb,
    "upload": _handle_kb_upload,
    "download": _handle_kb_download,
    "list": _handle_kb_list,
    "download_folder": _handle_kb_download_folder,
}


async def _handle_knowledge_base(params: dict[str, Any]) -> dict[str, Any]:
    """Knowledge base operations — query, upload, download, list, download_folder.

    Params:
        operation: One of query, upload, download, list, download_folder
        (remaining keys are operation-specific, see knowledge-search SKILL.md)
    """
    operation = params.get("operation")
    handler = _KB_OPERATIONS.get(operation or "")
    if not handler:
        valid = ", ".join(_KB_OPERATIONS)
        return _err(f"Invalid knowledge_base operation: '{operation}'. Valid: {valid}")

    # Pass through all params except 'operation' to the sub-handler
    sub_params = {k: v for k, v in params.items() if k != "operation"}
    return await handler(sub_params)


# ═════════════════════════════════════════════════════════════════════════════
# Agents handler
# ═════════════════════════════════════════════════════════════════════════════

# Maps operation name → Lambda tool name
_AGENT_OP_TO_TOOL = {
    "list": "list_agents",
    "get": "get_agent",
    "create": "create_agent",
    "update": "update_agent",
    "duplicate": "duplicate_agent",
}


async def _handle_agents(params: dict[str, Any]) -> dict[str, Any]:
    """Agent management — list, get, create, update, duplicate.

    Ports numa-agents.py CLI wrapper. Each operation maps to a Lambda tool
    in workspace-chat-tools.

    Params:
        operation: One of list, get, create, update, duplicate
        (remaining keys are operation-specific, see agents SKILL.md)
    """
    operation = params.get("operation")
    tool_name = _AGENT_OP_TO_TOOL.get(operation or "")
    if not tool_name:
        valid = ", ".join(_AGENT_OP_TO_TOOL)
        return _err(f"Invalid agents operation: '{operation}'. Valid: {valid}")

    user_sub, conversation_id = _get_user_context()
    if not user_sub:
        return _err("NUMA_USER_SUB is required for agent operations.")

    # Build Lambda params from the flat params dict (minus 'operation')
    lambda_params: dict[str, Any] = {
        k: v for k, v in params.items() if k != "operation" and v is not None
    }

    # Handle file attachments for create/update
    attach_files: list[str] = lambda_params.pop("attach_files", []) or []
    if attach_files:
        if not conversation_id:
            return _err(
                "NUMA_CONVERSATION_ID is required when attaching files to agents."
            )
        for file_path in attach_files:
            ensure_file_in_s3(file_path, user_sub, conversation_id)
        lambda_params["attachFiles"] = attach_files

    result = invoke_workspace_tool(
        tool_name,
        lambda_params,
        extra_event_fields={
            "user_sub": user_sub,
            "conversation_id": conversation_id,
            "allowed_tools": _get_enabled_tools(),
        },
    )

    return _ok(json.dumps(result, indent=2))


# ═════════════════════════════════════════════════════════════════════════════
# Memories handler
# ═════════════════════════════════════════════════════════════════════════════

_MEMORY_OP_TO_TOOL = {
    "list": "user_profile_list_memories",
    "add": "user_profile_add_memory",
    "update": "user_profile_update_memory",
}


async def _handle_memories(params: dict[str, Any]) -> dict[str, Any]:
    """Memory management — list, add, update.

    Ports numa-memories.py CLI wrapper. Each operation maps to a Lambda tool
    in workspace-chat-tools.

    Params:
        operation: One of list, add, update
        (remaining keys are operation-specific, see memories SKILL.md)
    """
    operation = params.get("operation")
    tool_name = _MEMORY_OP_TO_TOOL.get(operation or "")
    if not tool_name:
        valid = ", ".join(_MEMORY_OP_TO_TOOL)
        return _err(f"Invalid memories operation: '{operation}'. Valid: {valid}")

    user_sub = os.environ.get("NUMA_USER_SUB", "")
    if not user_sub:
        return _err("NUMA_USER_SUB is required for memory operations.")

    # Build Lambda params from the flat params dict (minus 'operation')
    lambda_params: dict[str, Any] = {
        k: v for k, v in params.items() if k != "operation" and v is not None
    }

    result = invoke_workspace_tool(
        tool_name,
        lambda_params,
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_tools": _get_enabled_tools(),
        },
    )

    return _ok(json.dumps(result, indent=2))


# ═════════════════════════════════════════════════════════════════════════════
# Handler dispatch map
# ═════════════════════════════════════════════════════════════════════════════

TOOL_HANDLERS = {
    "knowledge_base": _handle_knowledge_base,
    "web_search": _handle_web_search,
    "extract_content": _handle_extract_content,
    "convert_document": _handle_convert_document,
    "agents": _handle_agents,
    "memories": _handle_memories,
}

TOOL_NAMES = list(TOOL_HANDLERS.keys())


# ═════════════════════════════════════════════════════════════════════════════
# MCP Tool definition
# ═════════════════════════════════════════════════════════════════════════════


@tool(
    name="numa_tool",
    description=(
        "Execute a Numa platform tool. Use for knowledge base operations, "
        "web search, content extraction, document conversion, agent management, "
        "and memory management. "
        "Always load the relevant Skill first to learn each tool's expected params."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "enum": TOOL_NAMES,
                "description": "The Numa tool to execute",
            },
            "params": {
                "type": "object",
                "description": (
                    "Tool-specific parameters (see Skills for each tool's expected params)"
                ),
            },
            "description": {
                "type": "string",
                "description": (
                    "Human-readable description of what this tool call does (shown to the user)"
                ),
            },
        },
        "required": ["name", "params", "description"],
    },
)
async def numa_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Unified Numa tool dispatcher.

    Routes to the appropriate handler based on the `name` parameter.
    The `description` parameter is used by the frontend for display
    (extracted from tool input, same pattern as execute_script).
    """
    name = args.get("name", "")
    params = args.get("params", {})

    handler = TOOL_HANDLERS.get(name)
    if not handler:
        return _err(
            f"Unknown Numa tool: '{name}'. Valid tools: {', '.join(TOOL_NAMES)}"
        )

    # Two-layer access control:
    # 1. Agent type config (NUMA_ALLOWED_OPERATIONS) — developer hard limit
    # 2. Frontend request toggles (NUMA_ENABLED_TOOLS) — user controls
    blocked_reason = _check_operation_allowed(name)
    if blocked_reason:
        return _err(blocked_reason)

    try:
        return await handler(params)
    except Exception as e:
        logger.exception("numa_tool handler failed", extra={"tool_name": name})
        return _err(f"Error executing {name}: {e}")
