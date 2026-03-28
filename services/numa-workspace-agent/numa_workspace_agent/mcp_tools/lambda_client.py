"""
Shared Lambda client for invoking the workspace-chat-tools Lambda.

Extracted from integrations.py so both integration MCP tools and
the unified numa_tool can share the same invocation logic.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()

# Results directory for tool outputs
RESULTS_DIR = "/workdir/outputs/integrations-results"

# Preview length for truncated results shown inline
PREVIEW_LENGTH = 500


def pop_approval_id(action_key: str) -> str:
    """Pop the next approval ID for this action_key from NUMA_REQUEST_ID_MAP.

    The SDK runner stores a JSON dict of action_key -> [approval_id, ...] in
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


def is_auto_approved() -> bool:
    """Check if the current tool call was auto-approved by the SDK runner."""
    return os.environ.get("NUMA_APPROVAL_MODE", "") == "auto"


def extract_status(result: Any) -> str:
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


def invoke_workspace_tool(
    tool_name: str,
    params: dict[str, Any],
    extra_event_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Invoke the workspace-chat-tools Lambda with the given tool and params.

    Uses the same pattern as other workspace tools (knowledge_base, web_search, etc.)
    by invoking the Lambda through boto3 with NUMA_LOCAL_AWS credentials.

    Args:
        tool_name: The tool name to dispatch (e.g., "pipedream_run_action",
                   "query_knowledgebase", "web_search")
        params: Tool-specific parameters
        extra_event_fields: Optional dict of additional top-level fields to merge
                           into the event (e.g., allowed_kbs, allowed_kbs_with_names).
                           These are NOT placed inside params.

    Returns:
        Parsed response from the Lambda
    """
    import boto3
    from botocore.config import Config

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

    lambda_client = session.client(
        "lambda",
        config=Config(
            read_timeout=300
        ),  # Must match workspace-chat-tools Lambda timeout (300s)
    )

    # Diagnostic: log what env vars the MCP tool actually sees
    _enabled_tools_raw = os.environ.get("NUMA_ENABLED_TOOLS", "[]")
    logger.info(
        "Workspace tool invoking Lambda",
        _name="WORKSPACE_TOOL_INVOKE",
        tool_name=tool_name,
        numa_enabled_tools_raw=_enabled_tools_raw,
        numa_enabled_tools_parsed=json.loads(_enabled_tools_raw),
        numa_external_user_id=os.environ.get("NUMA_EXTERNAL_USER_ID", "NOT SET"),
    )

    # Build the event matching workspace-chat-tools expected format
    event: dict[str, Any] = {
        "tool": tool_name,
        "allowed_tools": json.loads(os.environ.get("NUMA_ENABLED_TOOLS", "[]")),
        "user_sub": os.environ.get("NUMA_USER_SUB", ""),
        "conversation_id": os.environ.get("NUMA_CONVERSATION_ID", ""),
        "external_user_id": os.environ.get("NUMA_EXTERNAL_USER_ID", ""),
        "params": params,
    }

    # Merge extra top-level fields (e.g., allowed_kbs for KB tools)
    if extra_event_fields:
        event.update(extra_event_fields)

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


def save_result(
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
    import urllib.request

    downloaded_files: list[str] = []
    inner_result = output.get("result", {})

    # Handle binary proxy responses (base64-encoded files from proxy_request)
    if (
        isinstance(inner_result, dict)
        and inner_result.get("binary")
        and inner_result.get("base64_body")
    ):
        import base64 as b64
        import mimetypes

        content_type = inner_result.get("content_type", "application/octet-stream")
        ext = mimetypes.guess_extension(content_type.split(";")[0].strip()) or ""
        binary_path = results_dir / f"{action_key}-binary{ext}"
        binary_path.write_bytes(b64.b64decode(inner_result["base64_body"]))
        downloaded_files.append(str(binary_path))

    if isinstance(inner_result, dict):
        exports = inner_result.get("exports", {})
        filestash_uploads = (
            exports.get("$filestash_uploads", []) if isinstance(exports, dict) else []
        )

        for upload in filestash_uploads:
            # Try multiple URL field names for robustness
            get_url = None
            for key in ("get_url", "downloadUrl", "downloadURL"):
                get_url = upload.get(key)
                if get_url:
                    break

            # Try multiple filename field names with UUID fallback
            filename = (
                upload.get("path")
                or upload.get("fileName")
                or f"download-{uuid.uuid4().hex[:8]}"
            )

            if not get_url:
                continue

            dest = results_dir / filename
            try:
                # Create parent directories (e.g., __stash/) if filename includes subdirs
                dest.parent.mkdir(parents=True, exist_ok=True)
                urllib.request.urlretrieve(get_url, str(dest))
                downloaded_files.append(str(dest))
            except Exception as dl_err:
                logger.warning(
                    "Failed to download file stash file",
                    filename=filename,
                    error=str(dl_err),
                )

        # Auto-download Zoom transcript VTT files from recordings API responses
        if isinstance(inner_result.get("download_access_token"), str) and isinstance(
            inner_result.get("recording_files"), list
        ):
            access_token = inner_result["download_access_token"]
            for rec_file in inner_result["recording_files"]:
                if not isinstance(rec_file, dict):
                    continue
                if rec_file.get("file_type") != "TRANSCRIPT":
                    continue

                download_url = rec_file.get("download_url", "")
                if not download_url:
                    continue

                separator = "&" if "?" in download_url else "?"
                authenticated_url = (
                    f"{download_url}{separator}access_token={access_token}"
                )

                meeting_id = inner_result.get(
                    "id", rec_file.get("meeting_id", "unknown")
                )
                ext = rec_file.get("file_extension", "VTT").lower()
                dest = results_dir / f"transcript-{meeting_id}.{ext}"

                try:
                    urllib.request.urlretrieve(authenticated_url, str(dest))
                    downloaded_files.append(str(dest))
                except Exception as dl_err:
                    logger.warning(
                        "Failed to download Zoom transcript",
                        meeting_id=str(meeting_id),
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
