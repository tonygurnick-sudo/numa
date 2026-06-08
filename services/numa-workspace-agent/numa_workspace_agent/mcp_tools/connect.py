"""
Unified connectors MCP tool for the workspace agent.

Provides a single dispatcher tool for accessing external connectors: OAuth cloud
storage (Google Drive, OneDrive, Dropbox), Synergy 12d (PAT-based), and generic
authenticated HTTP for any OAuth-connected API.

Note: Personal / Company Files are Numa Files folders — query them via the
`numa_files` operation in numa_tool.

Architecture:
    Claude → connectors MCP (name="status|list_files|...") → _invoke_connect_tool() → Lambda

Approval model:
- Safe (auto-approved): status, list_files, search_files, download_file, get_file_info
- Unsafe (requires approval): request (arbitrary HTTP calls incl. sending email)
"""

import hashlib
import json
import os
import re
import uuid
from typing import Any

import structlog
from claude_agent_sdk import tool
from numa_workspace_agent import atomic_io

logger = structlog.get_logger()


def _atomic_write_bytes(data: bytes, dest: str) -> None:
    """Write bytes to dest atomically (temp file in same dir + os.replace)."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = f"{dest}.part-{uuid.uuid4().hex}"
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _atomic_download_url(
    url: str, dest: str, expected_sha256: str | None = None
) -> int:
    """Stream a (presigned S3) URL to dest atomically; verify sha256 if given.

    Returns bytes written. Raises FileIntegrityError on checksum mismatch (the
    temp file is discarded, so the final path is never corrupted). Thin wrapper
    over the canonical ``atomic_io.atomic_download_url`` so connector downloads
    share the single streaming + verification implementation and exception
    contract with the rest of the /workdir boundary.
    """
    return atomic_io.atomic_download_url(url, dest, expected_sha256=expected_sha256)


# Connector type sets for routing
SYNERGY_CONNECTORS = {"synergy"}

# Operations that are read-only and safe to auto-approve. `mcp_call` is
# conditionally safe (per-method); the handler gates write methods on approval.
SAFE_CONNECTOR_OPERATIONS = frozenset(
    {
        "status",
        "list_files",
        "search_files",
        "download_file",
        "get_file_info",
        "mcp_call",
    }
)

# Operations that always mutate external state and require approval
UNSAFE_CONNECTOR_OPERATIONS = frozenset({"request"})

# Connector-specific write methods. Keys are method names the agent passes to
# `mcp_call`; values are human-readable descriptions shown in the approval
# prompt. Listed methods require explicit user approval before dispatch.
MCP_WRITE_METHODS: dict[str, str] = {
    "ns_createRecord": "Create a NetSuite record",
    "ns_updateRecord": "Update a NetSuite record",
}


def is_safe_connector_operation(operation: str) -> bool:
    """Check if a connector operation is read-only (safe to auto-approve)."""
    return operation in SAFE_CONNECTOR_OPERATIONS


# ---------------------------------------------------------------------------
# Approval gate for unsafe connector operations
# ---------------------------------------------------------------------------


def _pop_approval_id(action_key: str) -> str:
    """Pop this call's approval entry (id + mode) for ``action_key``.

    Thin delegate to the canonical popper in ``lambda_client`` so the per-call
    approval mode is pinned identically across every tool module — see that
    function for why the mode must travel with the id rather than ride a single
    global.
    """
    from numa_workspace_agent.mcp_tools.lambda_client import pop_approval_id

    return pop_approval_id(action_key)


def _await_approval(approval_key: str, description: str = "") -> str:
    """Block until the user approves or denies via workspace-chat-tools Lambda.

    Routes through the same Lambda that handles integration approvals so we
    reuse existing DynamoDB permissions and polling logic.

    Returns 'approved', 'denied', or 'timeout'.  Never fails open — if
    anything goes wrong the operation is blocked (fail-closed).
    """
    # Pop first: the popper pins NUMA_APPROVAL_MODE to this call's mode, so the
    # auto-approve check must read it *after* popping (not before).
    request_id = _pop_approval_id(approval_key)
    is_auto = os.environ.get("NUMA_APPROVAL_MODE") == "auto"

    if is_auto:
        logger.info("Connector operation auto-approved", action_key=approval_key)
        return "approved"

    if not request_id:
        logger.warning(
            "No approval ID for connector operation — blocking (fail-closed)",
            action_key=approval_key,
        )
        return "denied"

    try:
        from numa_workspace_agent.mcp_tools.lambda_client import (
            invoke_workspace_tool,
        )

        result = invoke_workspace_tool(
            "poll_connector_approval",
            {
                "action_key": approval_key,
                "description": description or f"Connector: {approval_key}",
                "request_id": request_id,
                "auto_approved": False,
            },
        )

        status = (
            result.get("status", "timeout") if isinstance(result, dict) else "timeout"
        )
        logger.info(
            "Connector approval decision",
            action_key=approval_key,
            status=status,
        )
        return status

    except Exception as e:
        logger.error(f"Connector approval failed: {e}", exc_info=True)
        # Fail closed — do not execute without confirmed approval
        return "denied"


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
            "Use numa_tool with name='numa_files' to browse Personal / Company Files."
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
            "is_error": True,
            "isError": True,
        }

    status_data = result.get("result", {}) if isinstance(result, dict) else {}
    if not status_data:
        return {
            "content": [
                {"type": "text", "text": "No connectors configured or accessible."}
            ],
        }

    # Per-chat enable filter: only surface connectors the user has enabled
    # for THIS conversation. Without this filter the status output lists
    # every admin-configured connector, which misleads the agent into
    # trying disabled ones (and then we have to reject each call). The
    # var is always set by sdk_config.py — empty string means
    # "no native connectors enabled" (i.e. the whole tool family is off).
    _enabled_raw = os.environ.get("NUMA_ENABLED_NATIVE_CONNECTORS", "")
    try:
        _enabled_native = json.loads(_enabled_raw) if _enabled_raw else []
    except json.JSONDecodeError:
        _enabled_native = []
    _enabled_set = set(_enabled_native)

    lines = ["Connector Status:\n"]
    credential_markers: list[str] = []

    for connector_id, info in status_data.items():
        # Skip data-bucket — it's in numa_tool files now
        if connector_id == "data-bucket":
            continue
        # Hide connectors not enabled for this chat. Tells the agent the
        # truth about what it CAN call — anything else gets rejected at
        # the dispatch layer anyway.
        if connector_id not in _enabled_set:
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
            pending_hint = info.get("pending_hint", "")
            credential_fields = info.get("credential_fields") or []

            # Chat-only connector with known credential fields: embed the
            # credential-request marker so the chat UI renders an inline entry
            # card for this connector. The frontend extracts the marker and
            # strips it from the text the user sees.
            if not connect_url and credential_fields:
                marker_payload = {
                    "connector_id": connector_id,
                    "display_name": display_name,
                    "auth_type": auth_type,
                    "credential_fields": credential_fields,
                }
                credential_markers.append(
                    f"[[NUMA_CREDENTIAL_REQUEST:{json.dumps(marker_payload)}]]"
                )
                lines.append(
                    f"  Awaiting credential: {display_name}{auth_label} — an "
                    "inline credential form is now shown to the user in chat. "
                    "They should fill it in there. Do NOT tell them to visit "
                    "settings and do NOT ask them to paste the credential into "
                    "chat."
                )
                continue

            if connect_url:
                hint = f" — connect at {connect_url}"
            elif pending_hint:
                hint = f" — {pending_hint}"
            else:
                hint = ""
            lines.append(f"  Not connected: {display_name}{auth_label}{hint}")
        else:
            error_msg = info.get("error", "")
            lines.append(f"  {display_name}{auth_label}: {status} - {error_msg}")

    # If the filter dropped everything, the header alone is confusing.
    # Give the agent a clear "nothing usable" signal so it doesn't keep
    # trying connector calls that will all be rejected.
    if len(lines) == 1:
        return {
            "content": [
                {
                    "type": "text",
                    "text": (
                        "No native connectors are enabled for this chat session. "
                        "The user has them turned off in the Integrations panel of "
                        "the chat sidebar. Tell them to enable a connector there if "
                        "they want you to use one."
                    ),
                }
            ],
        }

    text = "\n".join(lines)
    if credential_markers:
        text = "\n".join(credential_markers) + "\n" + text

    return {
        "content": [{"type": "text", "text": text}],
    }


def _check_auth_error(result: dict[str, Any]) -> dict[str, Any] | None:
    """If the result contains an auth_error, return an LLM-friendly error response."""
    if isinstance(result, dict) and result.get("error_code") == "auth_error":
        return {
            "content": [
                {
                    "type": "text",
                    "text": (
                        "The user's Synergy 12d access token has expired or been revoked. "
                        "They need to reconnect with new credentials on the Integrations page. "
                        "Do not retry this operation until they confirm reconnection."
                    ),
                }
            ],
            "is_error": True,
            "isError": True,
        }
    return None


def _check_needs_credential(result: dict[str, Any]) -> dict[str, Any] | None:
    """Signal that a tool call can't proceed until the user supplies a credential.

    Backend handlers for token / api-key / username-password connectors return
      {"error_code": "needs_credential", "connector_id": "fergus",
       "display_name": "Fergus", "auth_type": "token",
       "credential_fields": [{"key": "api_key", "label": "API Key", "type": "password"}]}
    when no user credential exists yet.

    The chat UI picks up the `[[NUMA_CREDENTIAL_REQUEST:{...}]]` marker from the
    content text, attaches a `credentialRequest` object to the matching
    inline_tool segment, and renders an inline credential entry card — mirroring
    Nathan's `tool_approval` HITL pattern (same segment-mutation approach).
    """
    if not isinstance(result, dict) or result.get("error_code") != "needs_credential":
        return None
    connector_id = result.get("connector_id", "")
    display_name = result.get("display_name", connector_id or "this connector")
    auth_type = result.get("auth_type", "token")
    fields = result.get("credential_fields") or []
    field_labels = (
        ", ".join(f.get("label", f.get("key", "")) for f in fields) or "credential"
    )

    marker_payload = {
        "connector_id": connector_id,
        "display_name": display_name,
        "auth_type": auth_type,
        "credential_fields": fields,
    }
    marker = f"[[NUMA_CREDENTIAL_REQUEST:{json.dumps(marker_payload)}]]"
    llm_text = (
        f"The user has not connected {display_name} yet. "
        f"Ask them to enter their {field_labels} — the chat UI will show an inline "
        "credential prompt and store the value in their personal vault. "
        "Do not retry this operation until they confirm they've connected."
    )
    return {
        "content": [{"type": "text", "text": f"{marker}\n{llm_text}"}],
        "is_error": True,
        "isError": True,
    }


async def _handle_list_files(params: dict[str, Any]) -> dict[str, Any]:
    """List files and folders from a connector."""
    connector = params.get("connector", "")
    result = _route_tool(
        connector,
        "list_files" if connector not in SYNERGY_CONNECTORS else "list",
        params,
    )

    if isinstance(result, dict) and (result.get("error") or result.get("error_code")):
        needs_cred = _check_needs_credential(result)
        if needs_cred:
            return needs_cred
        auth_err = _check_auth_error(result)
        if auth_err:
            return auth_err
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Error: {result.get('error', result.get('error_code'))}",
                }
            ],
            "is_error": True,
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

    if isinstance(result, dict) and (result.get("error") or result.get("error_code")):
        needs_cred = _check_needs_credential(result)
        if needs_cred:
            return needs_cred
        auth_err = _check_auth_error(result)
        if auth_err:
            return auth_err
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Error: {result.get('error', result.get('error_code'))}",
                }
            ],
            "is_error": True,
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

    if isinstance(result, dict) and (result.get("error") or result.get("error_code")):
        needs_cred = _check_needs_credential(result)
        if needs_cred:
            return needs_cred
        auth_err = _check_auth_error(result)
        if auth_err:
            return auth_err
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Error: {result.get('error', result.get('error_code'))}",
                }
            ],
            "is_error": True,
            "isError": True,
        }

    data = result.get("result", {}) if isinstance(result, dict) else {}

    if not data:
        return {
            "content": [{"type": "text", "text": "No download result received"}],
            "is_error": True,
            "isError": True,
        }

    file_id = params.get("file_id", "unknown")
    source = data.get("connector") or data.get("provider") or connector
    size = data.get("size", 0)
    # Tolerant reader: large files arrive as a presigned S3 URL
    # (`file_content_url`), small/legacy ones inline as hex (`file_content`).
    file_content_hex = data.get("file_content", "")
    file_content_url = data.get("file_content_url", "")
    expected_sha256 = data.get("content_sha256") or None

    if not file_content_hex and not file_content_url:
        return {
            "content": [{"type": "text", "text": "No file content received"}],
            "is_error": True,
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
            "is_error": True,
            "isError": True,
        }

    # Save to the workspace atomically (temp file + os.replace) so an
    # interrupted/partial transfer never leaves a truncated file at the final
    # path. Verify the sha256 end-to-end when the lambda provides one.
    try:
        if file_content_url:
            written = _atomic_download_url(
                file_content_url, workspace_path, expected_sha256
            )
        else:
            file_content = bytes.fromhex(file_content_hex)
            if expected_sha256:
                actual = hashlib.sha256(file_content).hexdigest()
                if actual != expected_sha256:
                    raise ValueError(
                        f"Checksum mismatch (expected {expected_sha256[:12]}…, "
                        f"got {actual[:12]}…)"
                    )
            _atomic_write_bytes(file_content, workspace_path)
            written = len(file_content)
    except Exception as e:
        logger.error("connector_download_write_failed", error=str(e))
        return {
            "content": [{"type": "text", "text": f"Error saving downloaded file: {e}"}],
            "is_error": True,
            "isError": True,
        }

    size_str = _format_size(size) if size else f"{written} bytes"

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
            "is_error": True,
            "isError": True,
        }

    data = result.get("result", {}) if isinstance(result, dict) else {}

    if not data:
        return {
            "content": [{"type": "text", "text": "No file information received"}],
            "is_error": True,
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

    if isinstance(result, dict) and (result.get("error") or result.get("error_code")):
        needs_cred = _check_needs_credential(result)
        if needs_cred:
            return needs_cred
        auth_err = _check_auth_error(result)
        if auth_err:
            return auth_err
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Error: {result.get('error', result.get('error_code'))}",
                }
            ],
            "is_error": True,
            "isError": True,
        }

    data = result.get("result", {}) if isinstance(result, dict) else {}

    if not data:
        return {
            "content": [{"type": "text", "text": "No response received"}],
            "is_error": True,
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


async def _handle_mcp_call(params: dict[str, Any]) -> dict[str, Any]:
    """Dispatch a JSON-RPC 2.0 MCP method to a connector that speaks MCP.

    Today only NetSuite exposes an MCP endpoint (`com.netsuite.mcpstandardtools`).
    The Lambda-side routing key is `connect_{connector}_mcp`.

    Write methods listed in `MCP_WRITE_METHODS` are gated by the approval
    system; read methods run immediately.
    """
    connector = (params.get("connector") or "").strip()
    method = (params.get("method") or "").strip()
    arguments = params.get("arguments") or {}

    if not connector:
        return {
            "content": [
                {"type": "text", "text": "Error: 'connector' is required for mcp_call"}
            ],
            "isError": True,
        }
    if not method:
        return {
            "content": [
                {"type": "text", "text": "Error: 'method' is required for mcp_call"}
            ],
            "isError": True,
        }

    write_desc = MCP_WRITE_METHODS.get(method)
    if write_desc:
        decision = _await_approval(f"{connector}-{method}", write_desc)
        if decision != "approved":
            return {
                "content": [
                    {"type": "text", "text": f"Action not approved ({decision})."}
                ],
                "isError": True,
            }

    result = _invoke_connect_tool(
        f"connect_{connector}_mcp",
        {"method": method, "arguments": arguments},
    )

    if isinstance(result, dict) and (result.get("error") or result.get("error_code")):
        needs_cred = _check_needs_credential(result)
        if needs_cred:
            return needs_cred
        auth_err = _check_auth_error(result)
        if auth_err:
            return auth_err
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Error: {result.get('error', result.get('error_code'))}",
                }
            ],
            "isError": True,
        }

    data = result.get("result", {}) if isinstance(result, dict) else {}
    body_str = (
        json.dumps(data, indent=2) if isinstance(data, (dict, list)) else str(data)
    )
    if len(body_str) > 10000:
        body_str = body_str[:10000] + "\n... (truncated)"
    return {"content": [{"type": "text", "text": body_str}]}


CONNECTOR_HANDLERS = {
    "status": _handle_status,
    "list_files": _handle_list_files,
    "search_files": _handle_search_files,
    "download_file": _handle_download_file,
    "get_file_info": _handle_get_file_info,
    "request": _handle_request,
    "mcp_call": _handle_mcp_call,
}

CONNECTOR_OPERATIONS = list(CONNECTOR_HANDLERS.keys())


@tool(
    name="connectors",
    description=(
        "Access connected cloud storage and external services. Use for OAuth cloud "
        "storage (Google Drive, OneDrive, Dropbox), Synergy 12d, authenticated "
        "HTTP calls to any OAuth-connected API, and MCP-based ERPs (NetSuite). "
        "Use 'status' to see available connectors, then browse/search/download "
        "files, make API requests, or invoke MCP methods via 'mcp_call' with "
        "{connector, method, arguments}."
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
                    "(e.g. googledrive, onedrive, dropbox, synergy, netsuite). "
                    "list_files/download_file need 'file_id' or 'folder_id'. "
                    "search_files needs 'query'. request needs 'url'. "
                    "mcp_call needs 'connector', 'method' (e.g. ns_runCustomSuiteQL), "
                    "and 'arguments' (method-specific object)."
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
    Unsafe operations (e.g. request) are gated by the approval system.
    """
    name = args.get("name", "")
    params = args.get("params", {})
    description = args.get("description", "")

    # Recover from a known model malformation: when the params payload is large,
    # Claude sometimes inlines it as a JSON-encoded string instead of an object.
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except json.JSONDecodeError as e:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Invalid params for '{name}': expected an object, got a "
                            f"string that could not be parsed as JSON ({e}). Pass params "
                            f"as a JSON object, not a stringified blob."
                        ),
                    }
                ],
                "is_error": True,
                "isError": True,
            }
    if not isinstance(params, dict):
        return {
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"Invalid params for '{name}': expected object, "
                        f"got {type(params).__name__}."
                    ),
                }
            ],
            "is_error": True,
            "isError": True,
        }

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
            "is_error": True,
            "isError": True,
        }

    # Honour the admin's per-service preferred_method choice. When admin has
    # chosen Pipedream for a service that exists as both, refuse the native
    # connector call and let the agent fall through to the integrations tools.
    connector = params.get("connector", "") if isinstance(params, dict) else ""
    if connector:
        from numa_workspace_agent.mcp_tools.integration_preferences import (
            is_native_allowed,
        )

        if not is_native_allowed(connector):
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"This workspace uses Pipedream for '{connector}', not the native "
                            "Numa connector. Use the integration tools (mcp__integrations__*) instead."
                        ),
                    }
                ],
                "isError": True,
            }

        # Per-chat enable check — fail-CLOSED to mirror the Pipedream
        # enforcement in mcp_tools/integrations.py exactly: if the env var
        # is unset, empty, or doesn't list this connector, refuse the call.
        # sdk_config.py always sets NUMA_ENABLED_NATIVE_CONNECTORS (at
        # minimum to "[]") for any container shipping this code path, so
        # there is no legitimate scenario where the var is missing — only
        # disabled chats. The prompt already lists only enabled connectors,
        # but the agent can still try a disabled one from memory, from a
        # `status` call's output, or from the user's own context, and we
        # don't want that to succeed.
        enabled_raw = os.environ.get("NUMA_ENABLED_NATIVE_CONNECTORS", "")
        try:
            enabled_native = json.loads(enabled_raw) if enabled_raw else []
        except json.JSONDecodeError:
            enabled_native = []
        if not enabled_native or connector not in enabled_native:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"The '{connector}' connector is not enabled for this chat session. "
                            "The user has it turned off in the Integrations panel of the chat "
                            "sidebar. Tell them to enable it there if they want you to use it; "
                            "do not retry."
                        ),
                    }
                ],
                "isError": True,
            }

    # Gate unsafe operations behind approval (fail-closed)
    if not is_safe_connector_operation(name):
        connector = params.get("connector", "")
        approval_key = (
            f"connector-{connector}-{name}" if connector else f"connector-{name}"
        )
        decision = _await_approval(approval_key, description)
        if decision != "approved":
            if decision == "timeout":
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Approval timed out. This workspace requires approval "
                                "for connector write operations. Please try again when "
                                "ready to approve."
                            ),
                        }
                    ],
                }
            return {
                "content": [
                    {"type": "text", "text": f"Action not approved ({decision})."}
                ],
            }

    try:
        return await handler(params)
    except Exception as e:
        logger.exception("connectors handler failed", operation=name)
        return {
            "content": [{"type": "text", "text": f"Error in connectors.{name}: {e}"}],
            "is_error": True,
            "isError": True,
        }
