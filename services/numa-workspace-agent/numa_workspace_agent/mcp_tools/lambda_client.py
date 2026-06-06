"""
Shared Lambda client for invoking the workspace-chat-tools Lambda.

Extracted from integrations.py so both integration MCP tools and
the unified numa_tool can share the same invocation logic.
"""

import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog
from numa_workspace_agent.atomic_io import (
    FileIntegrityError,
    atomic_download_url,
    atomic_write_bytes,
    atomic_write_text,
)
from numa_workspace_agent.mcp_tools.schema_preview import build_schema_preview

logger = structlog.get_logger()

# Results directory for tool outputs.
#
# Lives under /workdir/tmp/ rather than /workdir/outputs/ because:
#  - JSON response blobs and intermediate downloads are scratch — the user
#    didn't ask for raw API payloads to appear in their Files page.
#  - /workdir/tmp/ still syncs to S3 (root-level rglob in s3_workspace.py)
#    so the model has continuity across requests, compaction, and restarts.
#  - The Files UI lists only uploads/ and outputs/, so scratch stays hidden.
#
# When the model wants the user to see a downloaded file (attachment, export,
# transcript, etc.) it should `cp` or `mv` it from here into /workdir/outputs/.
RESULTS_DIR = "/workdir/tmp/integrations-results"

# Preview length for truncated results shown inline. Below this, the raw
# JSON fits in the response and we send it verbatim. Above this, we send
# a schema preview instead (see build_schema_preview) so the model gets
# the full shape of the result in <5KB rather than the first ~500 chars
# of a 1MB blob — and can then jq/python over the file on disk.
PREVIEW_LENGTH = 500

# Schema walker for large integration results lives in schema_preview.py
# so numa_ops and numa_files can reuse it.


def _atomic_urlretrieve(url: str, dest: str | Path) -> None:
    """Download `url` to `dest` atomically.

    urllib.request.urlretrieve writes directly to the final path as bytes
    stream in — a crash, OOM, or container kill mid-download leaves a
    truncated file at the final path that a later session would treat as a
    complete, valid download. We instead download to a temp file in the SAME
    directory (so os.replace stays on one filesystem and is atomic on POSIX)
    and only swap it into place once the transfer fully succeeds. On any
    failure the partial temp file is removed and the error re-raised, so the
    final path either holds a complete file or no file at all.
    """
    import urllib.request

    dest_path = Path(dest)
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    tmp_path = dest_path.parent / f"{dest_path.name}.part-{uuid.uuid4().hex}"
    try:
        urllib.request.urlretrieve(url, str(tmp_path))
        os.replace(str(tmp_path), str(dest_path))
    except BaseException:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
        raise


class OversizedResultIntegrityError(Exception):
    """Raised when a spilled oversized tool result fails sha256 verification.

    The destination MUST NOT use unverified bytes: a sha256 mismatch means the
    object behind ``result_url`` is not the result the producer hashed (truncated
    transfer, wrong object, corruption). We hard-fail rather than hand the model a
    silently-wrong result — that is the verification half of the 100% bar.
    """


def _fetch_and_verify_oversized(envelope: dict[str, Any]) -> Any:
    """Resolve a ``{"oversized": true, ...}`` spillover envelope losslessly.

    The workspace-chat-tools Lambda returns this fixed envelope when a structured
    tool result is too large for the 6 MB synchronous Lambda response payload. The
    FULL result JSON was written to S3 and presigned; here we:

      1. Download the exact bytes at ``result_url`` (streamed, hashed as we go).
      2. Verify the streamed sha256 == ``result_sha256`` — hard-fail on mismatch.
      3. Verify the byte count == ``result_size`` when the producer supplied one.
      4. Parse the verified bytes as JSON and return the COMPLETE result.

    Nothing is truncated or sampled — the caller receives exactly what would have
    been returned inline had it fit. On any failure we raise (never return
    unverified or partial data).
    """
    result_url = envelope.get("result_url")
    expected_sha = envelope.get("result_sha256")
    expected_size = envelope.get("result_size")

    if not result_url or not expected_sha:
        # Malformed envelope from a producer that set oversized=true but omitted
        # the pointer/hash. We cannot recover the result safely — fail loudly.
        raise OversizedResultIntegrityError(
            "Oversized tool result envelope missing result_url/result_sha256; "
            "cannot fetch or verify the full result."
        )

    # Stream the presigned URL to disk (never whole-file RAM) via the canonical
    # atomic_io helper, which hashes as it streams and verifies sha256/size
    # before swapping the temp file into place. This replaces the previous
    # in-memory bytearray accumulation that held the entire (multi-MB)
    # oversized result in RAM before parsing.
    #
    # Only enforce the size check when the producer supplied a usable count
    # (int >= 0) — preserve the original tolerance for missing/negative sizes.
    size_check = (
        expected_size if isinstance(expected_size, int) and expected_size >= 0 else None
    )
    # Spill to the system temp dir (writable everywhere) rather than RESULTS_DIR:
    # this blob is ephemeral scratch parsed and deleted immediately, and must not
    # appear under /workdir nor depend on /workdir being mounted/writable.
    tmp_path = Path(tempfile.gettempdir()) / f"oversized-result-{uuid.uuid4().hex}.json"
    # Do NOT log result_url — it is a presigned bearer token retained 30 days.
    try:
        total = atomic_download_url(
            result_url,
            tmp_path,
            expected_sha256=expected_sha,
            expected_size=size_check,
        )
    except FileIntegrityError as e:
        # atomic_io already discarded the temp file on mismatch. Re-raise as
        # this module's stable exception name so callers/tests keep one type.
        raise OversizedResultIntegrityError(
            "Oversized tool result failed integrity verification: "
            f"{e} Refusing to use unverified or possibly-truncated bytes."
        ) from e

    try:
        with open(tmp_path, "rb") as f:
            body = f.read()
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    logger.info(
        "Resolved oversized tool result losslessly",
        _name="OVERSIZED_RESULT_VERIFIED",
        result_size=total,
        result_sha256=expected_sha,
    )

    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise OversizedResultIntegrityError(
            f"Oversized tool result passed sha256 but is not valid JSON: {e}"
        ) from e


def resolve_oversized_result(result: Any) -> Any:
    """Return *result* unchanged unless it is an oversized spillover envelope.

    Tolerant/backward-compatible: an older Lambda that never emits the envelope
    returns its result inline, and this is a no-op. A newer Lambda that spilled a
    large result to S3 returns ``{"status":"success","oversized":true,...}`` which
    we resolve into the COMPLETE, sha256-verified result here.
    """
    if (
        isinstance(result, dict)
        and result.get("oversized") is True
        and "result_url" in result
    ):
        return _fetch_and_verify_oversized(result)
    return result


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
            read_timeout=900
        ),  # Must match workspace-chat-tools Lambda timeout (900s)
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
        "user_email": os.environ.get("NUMA_USER_EMAIL", ""),
        "user_name": os.environ.get("NUMA_USER_NAME", ""),
        "id_token": os.environ.get("NUMA_USER_ID_TOKEN", ""),
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

    # Lossless oversized-result resolution. When the tool's full result exceeded
    # the 6 MB synchronous Lambda payload, the Lambda spilled it to S3 and
    # returned a small {"oversized": true, result_url, result_sha256, ...}
    # envelope. Download it, VERIFY the sha256 over the exact bytes, and return
    # the COMPLETE result as if it had come back inline. Older Lambdas that never
    # emit the envelope pass through unchanged (backward-compatible).
    return resolve_oversized_result(response_payload.get("result", {}))


def invoke_workspace_tool_async(
    tool_name: str,
    params: dict[str, Any],
    extra_event_fields: dict[str, Any] | None = None,
) -> None:
    """Fire-and-forget invocation of the workspace-chat-tools Lambda.

    Same as invoke_workspace_tool but uses InvocationType='Event' so it
    returns immediately (HTTP 202) without waiting for the Lambda to finish.
    Use this for long-running tools where you want to poll for results separately.
    """
    import boto3

    lambda_name = os.environ.get("WORKSPACE_TOOLS_LAMBDA_NAME", "")
    if not lambda_name:
        raise ValueError("WORKSPACE_TOOLS_LAMBDA_NAME is not configured")

    session = boto3.Session(
        aws_access_key_id=os.environ.get("NUMA_LOCAL_AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("NUMA_LOCAL_AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("NUMA_LOCAL_AWS_SESSION_TOKEN"),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )

    lambda_client = session.client("lambda")

    event: dict[str, Any] = {
        "tool": tool_name,
        "allowed_tools": json.loads(os.environ.get("NUMA_ENABLED_TOOLS", "[]")),
        "user_sub": os.environ.get("NUMA_USER_SUB", ""),
        "conversation_id": os.environ.get("NUMA_CONVERSATION_ID", ""),
        "external_user_id": os.environ.get("NUMA_EXTERNAL_USER_ID", ""),
        "params": params,
    }

    if extra_event_fields:
        event.update(extra_event_fields)

    logger.info(
        "Invoking workspace tool async (fire-and-forget)",
        _name="WORKSPACE_TOOL_INVOKE_ASYNC",
        tool_name=tool_name,
    )

    response = lambda_client.invoke(
        FunctionName=lambda_name,
        Payload=json.dumps(event),
        InvocationType="Event",
    )

    status_code = response.get("StatusCode", 0)
    if status_code != 202:
        raise Exception(f"Async Lambda invoke failed with status {status_code}")


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
    atomic_write_text(content, file_path)

    # File stats for the agent
    file_size = len(content.encode("utf-8"))
    line_count = content.count("\n") + 1
    if file_size < 1024:
        size_str = f"{file_size} B"
    else:
        size_str = f"{file_size / 1024:.1f} KB"

    # Create preview. For small results, send the raw JSON inline (model can
    # work with it directly). For large results, send a schema-with-samples
    # preview that captures the full shape in <5KB — model uses jq/python to
    # extract specific fields from the full file rather than Reading it (which
    # would crowd context and may exceed the SDK's 256KB Read cap entirely).
    #
    # Both paths preview the full saved file (including the action_key /
    # status / result wrapper) so the model's jq paths match the on-disk
    # structure on the first try — previewing only output["result"] makes
    # it write `.ret` when the file actually wants `.result.ret`.
    result_str = json.dumps(output, indent=2, default=str)
    if len(result_str) > PREVIEW_LENGTH:
        schema = build_schema_preview(output)
        schema_json = json.dumps(schema, indent=2, default=str)
        preview_path = results_dir / f"{action_key}-{timestamp}.preview.json"
        atomic_write_text(schema_json, preview_path)
        preview = (
            "Full result on disk — schema preview below "
            "(use jq or python on the full file to extract specific fields):\n\n"
            f"{schema_json}\n\n"
            f"Schema sidecar (machine-readable): {preview_path}"
        )
    else:
        preview = result_str

    # Check for Pipedream file stash uploads and download them.
    # Downloads go through _atomic_urlretrieve (defined at module scope),
    # which imports urllib.request itself and writes atomically.
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
        atomic_write_bytes(b64.b64decode(inner_result["base64_body"]), binary_path)
        downloaded_files.append(str(binary_path))

    # Handle oversize binary proxy responses staged to S3 by the proxy.
    # When the upstream binary would exceed the Lambda 6 MB sync invoke
    # payload limit, the proxy uploads the raw bytes to a short-lived S3
    # cache and returns a presigned GET URL instead of base64-inlining.
    # We fetch the URL into /workdir so the agent sees a real file the
    # same way it does for small inline binaries above.
    if (
        isinstance(inner_result, dict)
        and inner_result.get("binary")
        and inner_result.get("binary_storage") == "s3_presigned"
        and inner_result.get("presigned_url")
    ):
        import mimetypes

        content_type = inner_result.get("content_type", "application/octet-stream")
        ext = mimetypes.guess_extension(content_type.split(";")[0].strip()) or ""

        # Prefer the upstream filename hint when present; otherwise fall
        # back to the same {action_key}-binary{ext} pattern the inline
        # base64 branch uses so the LLM gets a predictable name.
        filename_hint = inner_result.get("filename_hint", "")
        if isinstance(filename_hint, str) and filename_hint:
            # Defense in depth — the proxy already sanitizes, but never
            # trust an upstream-derived filename. Strip path separators,
            # drop leading dots, cap length.
            safe_name = (
                filename_hint.replace("/", "_").replace("\\", "_").lstrip(".")[:120]
            )
            if not safe_name:
                safe_name = f"{action_key}-binary{ext}"
            elif "." not in safe_name and ext:
                safe_name = f"{safe_name}{ext}"
            binary_path = results_dir / safe_name
        else:
            binary_path = results_dir / f"{action_key}-binary{ext}"

        try:
            # Do NOT log the presigned URL itself — it is a bearer token
            # and CloudWatch retains logs for 30 days.
            _atomic_urlretrieve(inner_result["presigned_url"], binary_path)
            downloaded_files.append(str(binary_path))
        except Exception as dl_err:
            logger.warning(
                "Failed to download oversize binary from proxy presigned URL",
                content_type=content_type,
                size=inner_result.get("size"),
                error=str(dl_err),
            )

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

            # Try multiple filename field names with UUID fallback.
            # Pipedream's microsoft_outlook-download-attachment returns
            # `path: "undefined"` (literal string) when its internal filename
            # derivation fails — verified live 2026-05-14. Treat known
            # sentinel values as missing so each download lands at a unique
            # path instead of silently overwriting prior ones.
            raw_name = upload.get("path") or upload.get("fileName")
            if isinstance(raw_name, str) and raw_name.strip().lower() in (
                "undefined",
                "null",
                "",
            ):
                raw_name = None
            filename = raw_name or f"download-{uuid.uuid4().hex[:8]}"

            if not get_url:
                continue

            dest = results_dir / filename
            try:
                # Create parent directories (e.g., __stash/) if filename
                # includes subdirs (also handled inside _atomic_urlretrieve).
                _atomic_urlretrieve(get_url, dest)
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
                    _atomic_urlretrieve(authenticated_url, dest)
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
