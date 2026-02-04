"""
Pipedream integration MCP tools for the workspace agent.

Provides tools for executing integration actions through the Pipedream
Connect API via the workspace-chat-tools Lambda. Actions requiring
side effects (run_action, proxy_request) go through human-in-the-loop
approval before execution.

Results are saved to files in /workdir/session/integrations-results/ to
avoid flooding the agent's context window with large API responses.
Files returned via Pipedream's file stash are automatically downloaded
into the same directory.
"""

import json
import logging
import os
import urllib.request
from pathlib import Path
from typing import Any

from claude_agent_sdk import tool

logger = logging.getLogger(__name__)

# Results directory for integration outputs
RESULTS_DIR = "/workdir/session/integrations-results"

# Preview length for truncated results shown inline
PREVIEW_LENGTH = 500


def _extract_status(result: Any) -> str:
    """Safely extract status from result, handling list responses.

    When the workspace-chat-tools Lambda returns raw API data (e.g., from
    /accessible-resources which returns a list), we can't call .get() on it.
    This helper handles both dict responses (with status field) and list
    responses (which are successful raw data).
    """
    if isinstance(result, list):
        return "success"  # Lists are successful raw data
    if isinstance(result, dict):
        return result.get("status", "success")
    return "success"


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
                # Write back with consumed entry removed
                if not ids:
                    id_map.pop(action_key, None)
                else:
                    id_map[action_key] = ids
                os.environ["NUMA_REQUEST_ID_MAP"] = json.dumps(id_map)
                return approval_id
        except (json.JSONDecodeError, TypeError):
            pass
    # Fallback: legacy single-value env var
    return os.environ.get("NUMA_REQUEST_ID", "")


def _invoke_workspace_tool(tool_name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Invoke the workspace-chat-tools Lambda with the given tool and params.

    Uses the same pattern as other workspace tools (knowledge_base, web_search, etc.)
    by invoking the Lambda through boto3 with NUMA_LOCAL_AWS credentials.

    Args:
        tool_name: The tool name to dispatch (e.g., "pipedream_run_action")
        params: Tool-specific parameters

    Returns:
        Parsed response from the Lambda
    """
    import boto3

    lambda_name = os.environ.get("WORKSPACE_TOOLS_LAMBDA_NAME", "")
    if not lambda_name:
        raise ValueError("WORKSPACE_TOOLS_LAMBDA_NAME is not configured")

    # Use local credentials (not cross-account Bedrock creds)
    session = boto3.Session(
        aws_access_key_id=os.environ.get("NUMA_LOCAL_AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("NUMA_LOCAL_AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("NUMA_LOCAL_AWS_SESSION_TOKEN"),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )
    from botocore.config import Config

    lambda_client = session.client(
        "lambda",
        config=Config(read_timeout=120),  # Must exceed 90s approval timeout
    )

    # Diagnostic: log what env vars the MCP tool actually sees
    import structlog as _structlog

    _diag_logger = _structlog.get_logger()
    _enabled_tools_raw = os.environ.get("NUMA_ENABLED_TOOLS", "[]")
    _diag_logger.info(
        "Integration tool invoking workspace Lambda",
        _name="INTEGRATION_TOOL_INVOKE",
        tool_name=tool_name,
        numa_enabled_tools_raw=_enabled_tools_raw,
        numa_enabled_tools_parsed=json.loads(_enabled_tools_raw),
        numa_external_user_id=os.environ.get("NUMA_EXTERNAL_USER_ID", "NOT SET"),
    )

    # Build the event matching workspace-chat-tools expected format
    event = {
        "tool": tool_name,
        "allowed_tools": json.loads(os.environ.get("NUMA_ENABLED_TOOLS", "[]")),
        "user_sub": os.environ.get("NUMA_USER_SUB", ""),
        "conversation_id": os.environ.get("NUMA_CONVERSATION_ID", ""),
        "external_user_id": os.environ.get("NUMA_EXTERNAL_USER_ID", ""),
        "params": params,
    }

    response = lambda_client.invoke(
        FunctionName=lambda_name,
        Payload=json.dumps(event),
        InvocationType="RequestResponse",
    )

    response_payload = json.loads(response["Payload"].read())

    if response.get("FunctionError"):
        raise Exception(f"Workspace tools Lambda failed: {response_payload}")

    status = response_payload.get("status", "error")
    if status == "error":
        error_msg = response_payload.get("error", "Unknown error")
        raise Exception(f"Tool error: {error_msg}")

    return response_payload.get("result", {})


def _save_result(
    result: dict[str, Any], action_key: str, description: str
) -> tuple[str, str]:
    """Save a result to a JSON file and return the path and a truncated preview.

    Args:
        result: The result data to save
        action_key: The action that produced this result
        description: Human-readable description

    Returns:
        Tuple of (file_path, preview_text)
    """
    from datetime import datetime, timezone

    results_dir = Path(RESULTS_DIR)
    results_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    file_path = results_dir / f"{action_key}-{timestamp}.json"

    output = {
        "action_key": action_key,
        "description": description,
        "status": result.get("status", "success"),
        "result": result.get("result", result),
    }

    content = json.dumps(output, indent=2, default=str)
    file_path.write_text(content)

    # File stats for the agent
    file_size = len(content.encode("utf-8"))
    line_count = content.count("\n") + 1
    if file_size < 1024:
        size_str = f"{file_size} B"
    else:
        size_str = f"{file_size / 1024:.1f} KB"

    # Create preview
    result_str = json.dumps(output["result"], indent=2, default=str)
    result_lines = result_str.count("\n") + 1
    if len(result_str) > PREVIEW_LENGTH:
        preview_lines = result_str[:PREVIEW_LENGTH].count("\n") + 1
        preview = (
            result_str[:PREVIEW_LENGTH]
            + f"\n... (truncated, showing ~{preview_lines}/{result_lines} lines — see file for full result)"
        )
    else:
        preview = result_str

    # Check for Pipedream file stash uploads and download them
    downloaded_files: list[str] = []
    inner_result = output.get("result", {})

    # Handle binary proxy responses (base64-encoded files from proxy_request)
    if inner_result.get("binary") and inner_result.get("base64_body"):
        import base64 as b64
        import mimetypes

        content_type = inner_result.get("content_type", "application/octet-stream")
        ext = mimetypes.guess_extension(content_type.split(";")[0].strip()) or ""
        binary_path = results_dir / f"{action_key}-binary{ext}"
        binary_path.write_bytes(b64.b64decode(inner_result["base64_body"]))
        downloaded_files.append(str(binary_path))

    exports = inner_result.get("exports", {})
    filestash_uploads = exports.get("$filestash_uploads", [])

    for upload in filestash_uploads:
        get_url = upload.get("get_url")
        filename = upload.get("path")
        if not get_url or not filename:
            continue
        dest = results_dir / filename
        try:
            urllib.request.urlretrieve(get_url, str(dest))
            downloaded_files.append(str(dest))
        except Exception as dl_err:
            import structlog

            structlog.get_logger().warning(
                "Failed to download file stash file",
                filename=filename,
                error=str(dl_err),
            )

    download_summary = ""
    if downloaded_files:
        paths = "\n".join(f"  - {p}" for p in downloaded_files)
        download_summary = f"\n\nDownloaded files:\n{paths}"

    return (
        str(file_path),
        f"({line_count} lines, {size_str})\n\n{preview}{download_summary}",
    )


@tool(
    name="run_action",
    description=(
        "Execute a Pipedream integration action (e.g., search Google Drive, send Slack message). "
        "Requires user approval before execution. Results are saved to a file. "
        "Read action schemas from /workdir/tools/integrations/{app_slug}/ first."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action_key": {
                "type": "string",
                "description": "The action key from the schema (e.g., 'google_drive-find-file')",
            },
            "props": {
                "type": "string",
                "description": (
                    'JSON string of configured props. Include auth with "auto": '
                    'e.g., \'{"googleDrive":{"authProvisionId":"auto"},"nameSearchTerm":"report"}\''
                ),
            },
            "description": {
                "type": "string",
                "description": (
                    "Human-readable description shown to user for approval. "
                    "For write/send/create operations, include the full content verbatim "
                    "(e.g., email subject + body, message text, record fields being set)."
                ),
            },
            "stash_id": {
                "type": "string",
                "description": "Optional stash ID for file operations (use 'NEW' for first file download)",
            },
        },
        "required": ["action_key", "props", "description"],
    },
)
async def run_action(args: dict[str, Any]) -> dict[str, Any]:
    """Execute a Pipedream integration action with approval."""
    action_key = args.get("action_key", "")
    props_str = args.get("props", "{}")
    description = args.get("description", "")
    stash_id = args.get("stash_id")

    # Early check: reject if integration is not enabled
    integration_slug = action_key.split("-")[0] if action_key else ""
    enabled_raw = os.environ.get("NUMA_ENABLED_INTEGRATIONS", "")
    if enabled_raw and integration_slug:
        try:
            enabled = json.loads(enabled_raw)
            if integration_slug not in enabled:
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Integration not enabled: {integration_slug}. The user has not enabled this integration.",
                        }
                    ],
                    "isError": True,
                }
        except json.JSONDecodeError:
            pass

    # Parse props JSON
    try:
        configured_props = json.loads(props_str)
    except json.JSONDecodeError as e:
        return {
            "content": [{"type": "text", "text": f"Error: Invalid props JSON: {e}"}],
            "isError": True,
        }

    # If any prop values reference /workdir/ paths, sync local files to S3 first
    # so the workspace-chat-tools Lambda can find them when generating presigned URLs
    def _has_workdir_path(v: object) -> bool:
        if isinstance(v, str) and v.startswith("/workdir/"):
            return True
        if isinstance(v, list):
            return any(isinstance(el, str) and el.startswith("/workdir/") for el in v)
        return False

    has_workdir_paths = any(_has_workdir_path(v) for v in configured_props.values())
    if has_workdir_paths:
        user_sub = os.environ.get("NUMA_USER_SUB", "")
        conversation_id = os.environ.get("NUMA_CONVERSATION_ID", "")
        if user_sub and conversation_id:
            logger.info(
                "Syncing workspace files to S3 before integration tool call",
                extra={"action_key": action_key},
            )
            from numa_workspace_agent.s3_workspace import sync_to_s3

            sync_to_s3(user_sub, conversation_id)

    try:
        result = _invoke_workspace_tool(
            "pipedream_run_action",
            {
                "action_key": action_key,
                "configured_props": configured_props,
                "description": description,
                "stash_id": stash_id,
                "request_id": _pop_approval_id(action_key),
                "auto_approved": os.environ.get("NUMA_APPROVAL_MODE") == "auto",
            },
        )

        # Handle approval decisions
        status = _extract_status(result)
        if status == "denied":
            return {
                "content": [
                    {"type": "text", "text": f"Action denied by user: {action_key}"}
                ],
            }
        if status == "timeout":
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Approval timed out for: {action_key}. "
                            "This workspace has human-in-the-loop approval enabled for integration tools. "
                            "An approval card was shown to the user but they did not respond within the "
                            "90-second window. You can offer to try again if the user is ready to approve."
                        ),
                    }
                ],
            }

        # Save result to file
        file_path, preview = _save_result(result, action_key, description)

        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Action completed: {action_key}\nResult saved to: {file_path}\n\nPreview:\n{preview}",
                }
            ],
        }

    except Exception as e:
        return {
            "content": [{"type": "text", "text": f"Error executing {action_key}: {e}"}],
            "isError": True,
        }


@tool(
    name="configure_props",
    description=(
        "Get dynamic dropdown options for an action prop. "
        "Use this to discover valid values for props like 'drive', 'parentId', etc. "
        "Does NOT require user approval (read-only metadata)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action_key": {
                "type": "string",
                "description": "The action key (e.g., 'google_drive-list-files')",
            },
            "prop_name": {
                "type": "string",
                "description": "The prop to get options for (e.g., 'drive')",
            },
            "configured_props": {
                "type": "string",
                "description": (
                    "JSON string of currently configured props. "
                    'Include auth: \'{"googleDrive":{"authProvisionId":"auto"}}\''
                ),
            },
        },
        "required": ["action_key", "prop_name", "configured_props"],
    },
)
async def configure_props(args: dict[str, Any]) -> dict[str, Any]:
    """Get dynamic dropdown options for an action prop."""
    action_key = args.get("action_key", "")
    prop_name = args.get("prop_name", "")
    configured_props_str = args.get("configured_props", "{}")

    try:
        configured_props = json.loads(configured_props_str)
    except json.JSONDecodeError as e:
        return {
            "content": [
                {"type": "text", "text": f"Error: Invalid configured_props JSON: {e}"}
            ],
            "isError": True,
        }

    try:
        result = _invoke_workspace_tool(
            "pipedream_configure_props",
            {
                "action_key": action_key,
                "prop_name": prop_name,
                "configured_props": configured_props,
            },
        )

        options = result.get("options", [])
        options_text = json.dumps(options, indent=2, default=str)

        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Options for {action_key}.{prop_name}:\n{options_text}",
                }
            ],
        }

    except Exception as e:
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Error configuring {action_key}.{prop_name}: {e}",
                }
            ],
            "isError": True,
        }


@tool(
    name="proxy_request",
    description=(
        "Make a raw API call through Pipedream's proxy. "
        "Use this when no pre-built action exists for what you need. "
        "Pipedream injects the user's OAuth token automatically. "
        "Requires user approval."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "method": {
                "type": "string",
                "description": "HTTP method (GET, POST, PUT, DELETE)",
                "enum": ["GET", "POST", "PUT", "DELETE"],
            },
            "upstream_url": {
                "type": "string",
                "description": "The upstream API URL to call (e.g., 'https://www.googleapis.com/drive/v3/files/FILE_ID/revisions')",
            },
            "description": {
                "type": "string",
                "description": "Human-readable description of what this API call does (shown for approval)",
            },
            "integration_slug": {
                "type": "string",
                "description": "The integration slug (e.g., 'google_drive', 'slack', 'hubspot')",
            },
            "body": {
                "type": "object",
                "description": "Optional JSON body for POST/PUT requests (e.g., event data, query parameters)",
            },
        },
        "required": [
            "method",
            "upstream_url",
            "description",
            "integration_slug",
        ],
    },
)
async def proxy_request(args: dict[str, Any]) -> dict[str, Any]:
    """Make a raw API call through Pipedream's proxy with approval."""
    method = args.get("method", "GET")
    upstream_url = args.get("upstream_url", "")
    description = args.get("description", "")
    integration_slug = args.get("integration_slug", "")
    body = args.get("body")

    # Early check: reject if integration is not enabled
    enabled_raw = os.environ.get("NUMA_ENABLED_INTEGRATIONS", "")
    if enabled_raw and integration_slug:
        try:
            enabled = json.loads(enabled_raw)
            if integration_slug not in enabled:
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Integration not enabled: {integration_slug}. The user has not enabled this integration.",
                        }
                    ],
                    "isError": True,
                }
        except json.JSONDecodeError:
            pass

    try:
        result = _invoke_workspace_tool(
            "pipedream_proxy_request",
            {
                "method": method,
                "upstream_url": upstream_url,
                "integration_slug": integration_slug,
                "description": description,
                "body": body,
                "request_id": _pop_approval_id(f"{integration_slug}-{method}"),
                "auto_approved": os.environ.get("NUMA_APPROVAL_MODE") == "auto",
            },
        )

        status = _extract_status(result)
        if status == "denied":
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Proxy request denied by user: {method} {upstream_url}",
                    }
                ],
            }
        if status == "timeout":
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Approval timed out for proxy request: {method} {upstream_url}. "
                            "This workspace has human-in-the-loop approval enabled for integration tools. "
                            "An approval card was shown to the user but they did not respond within the "
                            "90-second window. You can offer to try again if the user is ready to approve."
                        ),
                    }
                ],
            }

        # Save result to file
        file_path, preview = _save_result(result, f"proxy_{method}", description)

        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Proxy request completed: {method} {upstream_url}\nResult saved to: {file_path}\n\nPreview:\n{preview}",
                }
            ],
        }

    except Exception as e:
        return {
            "content": [{"type": "text", "text": f"Error in proxy request: {e}"}],
            "isError": True,
        }
