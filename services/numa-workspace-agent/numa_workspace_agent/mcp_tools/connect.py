"""
Unified connectors MCP tool for the workspace agent.

Provides a single dispatcher tool for accessing external connectors: OAuth cloud
storage (Google Drive, OneDrive, Dropbox), Synergy 12d (PAT-based), and generic
authenticated HTTP for any OAuth-connected API.

Note: S3 data-bucket (My Files / Company Files) has been moved to the `files`
operation in numa_tool — it's a core Numa capability, not an external connector.

Architecture:
    Claude → connectors MCP (name="status|list_files|...") → _invoke_connect_tool() → Lambda
"""

import json
import os
import re
from typing import Any

import structlog
from claude_agent_sdk import tool

logger = structlog.get_logger()

# Connector type sets for routing
SYNERGY_CONNECTORS = {"synergy"}


def _invoke_connect_tool(tool_name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Invoke the oauth-workspace-tools Lambda with the given tool and params."""
    import boto3
    from botocore.config import Config

    lambda_name = os.environ.get("OAUTH_WORKSPACE_TOOLS_LAMBDA_NAME", "")
    if not lambda_name:
        client_name = os.environ.get("CLIENT_NAME", "")
        lambda_name = f"numa-{client_name}-oauth-workspace-tools" if client_name else ""

    if not lambda_name:
        raise ValueError("OAuth workspace tools Lambda name not configured")

    session = boto3.Session(
        aws_access_key_id=os.environ.get("NUMA_LOCAL_AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("NUMA_LOCAL_AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("NUMA_LOCAL_AWS_SESSION_TOKEN"),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )
    lambda_client = session.client(
        "lambda",
        config=Config(read_timeout=120),
    )

    event = {
        "tool": tool_name,
        "user_sub": os.environ.get("NUMA_USER_SUB", ""),
        "conversation_id": os.environ.get("NUMA_CONVERSATION_ID", ""),
        "params": params,
    }

    response = lambda_client.invoke(
        FunctionName=lambda_name,
        Payload=json.dumps(event),
    )
    payload = json.loads(response["Payload"].read())
    if isinstance(payload, dict) and payload.get("errorMessage"):
        raise RuntimeError(payload["errorMessage"])
    return payload


def _route_tool(
    connector: str, tool_suffix: str, params: dict[str, Any]
) -> dict[str, Any]:
    """Route a tool call to the correct Lambda handler based on connector type."""
    if connector == "data-bucket":
        raise ValueError(
            "data-bucket is not available via connectors. "
            "Use numa_tool with name='files' to browse My Files / Company Files."
        )
    if connector in SYNERGY_CONNECTORS:
        return _invoke_connect_tool(f"connect_synergy_{tool_suffix}", params)
    else:
        # OAuth providers (googledrive, onedrive, dropbox, custom)
        return _invoke_connect_tool(
            f"oauth_{tool_suffix}", {**params, "provider": connector}
        )


def _format_size(size: int) -> str:
    """Format a file size into a human-readable string."""
    if not size:
        return ""
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size // 1024} KB"
    return f"{size // (1024 * 1024)} MB"


# ═════════════════════════════════════════════════════════════════════════════
# Operation handlers
# ═════════════════════════════════════════════════════════════════════════════


async def _handle_status(params: dict[str, Any]) -> dict[str, Any]:
    """Check connection status for all connector types."""
    result = _invoke_connect_tool("connect_status", params)

    if isinstance(result, dict) and result.get("error"):
        return {
            "content": [{"type": "text", "text": f"Error: {result['error']}"}],
            "isError": True,
        }

    status_data = result.get("result", {}) if isinstance(result, dict) else {}
    if not status_data:
        return {
            "content": [
                {"type": "text", "text": "No connectors configured or accessible."}
            ],
        }

    lines = ["Connector Status:\n"]

    for connector_id, info in status_data.items():
        # Skip data-bucket — it's in numa_tool files now
        if connector_id == "data-bucket":
            continue
        display_name = info.get("display_name", connector_id.replace("-", " ").title())
        status = info.get("status", "unknown")
        auth_type = info.get("auth_type", "")
        auth_label = f" [{auth_type}]" if auth_type else ""

        if status == "connected":
            user_email = info.get("user_email", "")
            connected_at = info.get("connected_at", "")
            email_part = f" ({user_email})" if user_email else ""
            date_part = f" - Connected: {connected_at[:10]}" if connected_at else ""
            lines.append(
                f"  Connected: {display_name}{auth_label}{email_part}{date_part}"
            )
        elif status == "disconnected":
            connect_url = info.get("connect_url", "")
            url_hint = f" — connect at {connect_url}" if connect_url else ""
            lines.append(f"  Not connected: {display_name}{auth_label}{url_hint}")
        else:
            error_msg = info.get("error", "")
            lines.append(f"  {display_name}{auth_label}: {status} - {error_msg}")

    return {
        "content": [{"type": "text", "text": "\n".join(lines)}],
    }


async def _handle_list_files(params: dict[str, Any]) -> dict[str, Any]:
    """List files and folders from a connector."""
    connector = params.get("connector", "")
    result = _route_tool(
        connector,
        "list_files" if connector not in SYNERGY_CONNECTORS else "list",
        params,
    )

    if isinstance(result, dict) and result.get("error"):
        return {
            "content": [{"type": "text", "text": f"Error: {result['error']}"}],
            "isError": True,
        }

    data = result.get("result", {}) if isinstance(result, dict) else {}
    folders = data.get("folders", [])
    files = data.get("files", [])
    source = data.get("connector") or data.get("provider") or connector

    if not folders and not files:
        return {
            "content": [
                {"type": "text", "text": f"No files or folders found in {source}."}
            ],
        }

    lines = [f"{source} contents:\n"]

    if folders:
        for folder in folders:
            name = folder.get("name", "")
            folder_id = folder.get("folder_id", "")
            lines.append(f"  [folder] {name}  (folder_id: {folder_id})")

    if files:
        if folders:
            lines.append("")
        for file in files:
            name = file.get("name", "")
            size = file.get("size", 0)
            modified = file.get("modified_at", "")
            file_id = file.get("file_id", "")

            size_str = f" ({_format_size(size)})" if size else ""
            date_str = f" - {modified[:10]}" if modified else ""
            lines.append(f"  [file] {name}{size_str}{date_str}  (file_id: {file_id})")

    total = data.get("total_count", len(folders) + len(files))
    lines.append(f"\nTotal: {total} items")

    return {
        "content": [{"type": "text", "text": "\n".join(lines)}],
    }


async def _handle_search_files(params: dict[str, Any]) -> dict[str, Any]:
    """Search for files in a connector."""
    connector = params.get("connector", "")
    result = _route_tool(
        connector,
        "search_files" if connector not in SYNERGY_CONNECTORS else "search",
        params,
    )

    if isinstance(result, dict) and result.get("error"):
        return {
            "content": [{"type": "text", "text": f"Error: {result['error']}"}],
            "isError": True,
        }

    data = result.get("result", {}) if isinstance(result, dict) else {}
    folders = data.get("folders", [])
    files = data.get("files", [])
    source = data.get("connector") or data.get("provider") or connector
    query = data.get("query", params.get("query", ""))

    if not folders and not files:
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"No results matching '{query}' in {source}.",
                }
            ],
        }

    lines = [f"Search results in {source} for '{query}':\n"]

    if folders:
        for folder in folders:
            name = folder.get("name", "")
            folder_id = folder.get("folder_id", "")
            path = folder.get("path", "")
            path_str = f" — {path}" if path else ""
            lines.append(f"  [folder] {name}{path_str}  (folder_id: {folder_id})")

    if files:
        if folders:
            lines.append("")
        for file in files:
            name = file.get("name", "")
            size = file.get("size", 0)
            modified = file.get("modified_at", "")
            file_id = file.get("file_id", "")
            path = file.get("path", "")

            size_str = f" ({_format_size(size)})" if size else ""
            date_str = f" - {modified[:10]}" if modified else ""
            path_str = f"\n     Path: {path}" if path else ""
            lines.append(
                f"  [file] {name}{size_str}{date_str}  (file_id: {file_id}){path_str}"
            )

    total = data.get("total_count", len(folders) + len(files))
    lines.append(f"\nFound {total} matching items")

    return {
        "content": [{"type": "text", "text": "\n".join(lines)}],
    }


async def _handle_download_file(params: dict[str, Any]) -> dict[str, Any]:
    """Download a file from a connector to the workspace."""
    connector = params.get("connector", "")
    result = _route_tool(
        connector,
        "download_file" if connector not in SYNERGY_CONNECTORS else "download",
        params,
    )

    if isinstance(result, dict) and result.get("error"):
        return {
            "content": [{"type": "text", "text": f"Error: {result['error']}"}],
            "isError": True,
        }

    data = result.get("result", {}) if isinstance(result, dict) else {}

    if not data:
        return {
            "content": [{"type": "text", "text": "No download result received"}],
            "isError": True,
        }

    file_id = params.get("file_id", "unknown")
    source = data.get("connector") or data.get("provider") or connector
    size = data.get("size", 0)
    file_content_hex = data.get("file_content", "")

    if not file_content_hex:
        return {
            "content": [{"type": "text", "text": "No file content received"}],
            "isError": True,
        }

    # Construct safe workspace path
    filename = data.get("filename", f"download_{file_id[:8]}")
    safe_filename = re.sub(r"[^\w\s.-]", "_", os.path.basename(filename))
    safe_filename = safe_filename.strip(". ") or f"download_{file_id[:8]}"
    workspace_path = f"/workdir/uploads/connect-{source}/{safe_filename}"

    # Validate resolved path stays within allowed directory
    real_path = os.path.realpath(workspace_path)
    if not real_path.startswith("/workdir/uploads/"):
        return {
            "content": [{"type": "text", "text": "Invalid file path"}],
            "isError": True,
        }

    # Convert hex back to bytes and save to workspace
    file_content = bytes.fromhex(file_content_hex)
    os.makedirs(os.path.dirname(workspace_path), exist_ok=True)

    with open(workspace_path, "wb") as f:
        f.write(file_content)

    size_str = _format_size(size) if size else f"{len(file_content)} bytes"

    return {
        "content": [
            {
                "type": "text",
                "text": (
                    f"Downloaded {filename} from {source}\n"
                    f"Saved to: {workspace_path}\n"
                    f"Size: {size_str}\n\n"
                    f"The file is now available in your workspace and can be "
                    f"accessed by other tools for analysis or processing."
                ),
            }
        ],
    }


async def _handle_get_file_info(params: dict[str, Any]) -> dict[str, Any]:
    """Get detailed file metadata from a connector."""
    connector = params.get("connector", "")

    # For Synergy, file info isn't a separate endpoint
    if connector in SYNERGY_CONNECTORS:
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"File info is not available as a separate operation for {connector}. Use list_files to see file details.",
                }
            ],
        }

    # OAuth providers have a dedicated metadata endpoint
    result = _invoke_connect_tool(
        "oauth_get_file_metadata", {**params, "provider": connector}
    )

    if isinstance(result, dict) and result.get("error"):
        return {
            "content": [{"type": "text", "text": f"Error: {result['error']}"}],
            "isError": True,
        }

    data = result.get("result", {}) if isinstance(result, dict) else {}

    if not data:
        return {
            "content": [{"type": "text", "text": "No file information received"}],
            "isError": True,
        }

    name = data.get("name", "")
    size = data.get("size", 0)
    content_type = data.get("content_type", "")
    modified_at = data.get("modified_at", "")
    created_at = data.get("created_at", "")
    path = data.get("path", "")
    checksum = data.get("checksum", "")
    version = data.get("version", "")
    provider = data.get("provider", connector)

    lines = [f"File info from {provider}:\n"]
    lines.append(f"  Name: {name}")
    if path:
        lines.append(f"  Path: {path}")
    if size:
        lines.append(f"  Size: {_format_size(size)} ({size:,} bytes)")
    if content_type:
        lines.append(f"  Type: {content_type}")
    if created_at:
        lines.append(f"  Created: {created_at[:19].replace('T', ' ')}")
    if modified_at:
        lines.append(f"  Modified: {modified_at[:19].replace('T', ' ')}")
    if checksum:
        lines.append(f"  Checksum: {checksum}")
    if version:
        lines.append(f"  Version: {version}")

    file_id = data.get("file_id", "")
    if file_id:
        lines.append(f"  File ID: {file_id}")

    return {
        "content": [{"type": "text", "text": "\n".join(lines)}],
    }


async def _handle_request(params: dict[str, Any]) -> dict[str, Any]:
    """Make an authenticated HTTP request to an OAuth API."""
    result = _invoke_connect_tool("connect_request", params)

    if isinstance(result, dict) and result.get("error"):
        return {
            "content": [{"type": "text", "text": f"Error: {result['error']}"}],
            "isError": True,
        }

    data = result.get("result", {}) if isinstance(result, dict) else {}

    if not data:
        return {
            "content": [{"type": "text", "text": "No response received"}],
            "isError": True,
        }

    status_code = data.get("status_code", 0)
    body = data.get("body", "")
    description = data.get("description", "")

    lines = []
    if description:
        lines.append(f"Request: {description}")
    lines.append(f"Status: {status_code}")

    if isinstance(body, (dict, list)):
        body_str = json.dumps(body, indent=2)
    else:
        body_str = str(body)

    # Truncate very long responses
    if len(body_str) > 10000:
        body_str = body_str[:10000] + "\n... (truncated)"

    lines.append(f"\nResponse:\n{body_str}")

    return {
        "content": [{"type": "text", "text": "\n".join(lines)}],
    }


# ═════════════════════════════════════════════════════════════════════════════
# Connector operation dispatch map + MCP tool definition
# ═════════════════════════════════════════════════════════════════════════════

CONNECTOR_HANDLERS = {
    "status": _handle_status,
    "list_files": _handle_list_files,
    "search_files": _handle_search_files,
    "download_file": _handle_download_file,
    "get_file_info": _handle_get_file_info,
    "request": _handle_request,
}

CONNECTOR_OPERATIONS = list(CONNECTOR_HANDLERS.keys())


@tool(
    name="connectors",
    description=(
        "Access connected cloud storage and external services. Use for OAuth cloud "
        "storage (Google Drive, OneDrive, Dropbox), Synergy 12d, and authenticated "
        "HTTP calls to any OAuth-connected API. Use 'status' to see available "
        "connectors, then browse/search/download files or make API requests."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "enum": CONNECTOR_OPERATIONS,
                "description": "The connector operation to execute",
            },
            "params": {
                "type": "object",
                "description": (
                    "Operation-specific parameters. Most operations need 'connector' "
                    "(e.g. googledrive, onedrive, dropbox, synergy). "
                    "list_files/download_file need 'file_id' or 'folder_id'. "
                    "search_files needs 'query'. request needs 'url'."
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
async def connectors(args: dict[str, Any]) -> dict[str, Any]:
    """Unified connectors tool dispatcher.

    Routes to the appropriate handler based on the `name` parameter.
    """
    name = args.get("name", "")
    params = args.get("params", {})

    handler = CONNECTOR_HANDLERS.get(name)
    if not handler:
        return {
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"Unknown connector operation: '{name}'. "
                        f"Valid: {', '.join(CONNECTOR_OPERATIONS)}"
                    ),
                }
            ],
            "isError": True,
        }

    try:
        return await handler(params)
    except Exception as e:
        logger.exception("connectors handler failed", operation=name)
        return {
            "content": [{"type": "text", "text": f"Error in connectors.{name}: {e}"}],
            "isError": True,
        }
