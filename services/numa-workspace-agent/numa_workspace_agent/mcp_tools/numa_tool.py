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
import os
import re
from pathlib import Path
from typing import Any

import structlog
from claude_agent_sdk import tool
from numa_workspace_agent.mcp_tools.lambda_client import (
    invoke_workspace_tool,
    invoke_workspace_tool_async,
    is_auto_approved,
    pop_approval_id,
)
from numa_workspace_agent.mcp_tools.s3_helpers import (
    download_from_presigned_url,
    download_from_s3,
    ensure_file_in_s3,
    sync_file_to_s3,
    upload_to_presigned_url,
)
from numa_workspace_agent.mcp_tools.schema_preview import build_schema_preview

logger = structlog.get_logger()

# Upload size limit for KB uploads (matches knowledge_base.py threshold for presigned URLs)
PRESIGNED_URL_THRESHOLD = int(3.5 * 1024 * 1024)

# Size threshold (compact JSON chars) above which numa_files query/list results
# are spilled to a file and replaced with a schema-with-samples preview in the
# tool response. Big KB returns (folders with hundreds of files, queries with
# long snippets) otherwise dump verbatim into the model's context.
_KB_INLINE_LIMIT = 5000
_KB_RESULTS_DIR = Path("/workdir/tmp/numa-files")


def _save_kb_result(result: Any, operation: str) -> str:
    """Spill a large numa_files result to /workdir/tmp/numa-files/ and sync to S3."""
    from datetime import datetime, timezone

    _KB_RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    file_path = _KB_RESULTS_DIR / f"{operation}-{timestamp}.json"
    content = json.dumps(result, indent=2, default=str)
    file_path.write_text(content)
    sync_file_to_s3(str(file_path), content)
    return str(file_path)


def _kb_overflow_response(result: Any, operation: str) -> dict[str, Any]:
    """Build the file-save + schema-preview response for an oversize KB result."""
    file_path = _save_kb_result(result, operation)
    schema = build_schema_preview(result)
    schema_json = json.dumps(schema, indent=2, default=str)
    return _ok(
        f"{operation} returned a large result — full JSON saved to: {file_path}\n\n"
        "Schema preview below (use jq or python on the full file to extract "
        "specific fields):\n\n"
        f"{schema_json}"
    )


# ── Helper: build MCP response ──────────────────────────────────────────────


def _ok(text: str) -> dict[str, Any]:
    """Build a successful MCP tool response."""
    return {"content": [{"type": "text", "text": text}]}


def _err(text: str) -> dict[str, Any]:
    """Build an error MCP tool response."""
    # Dual-write: claude-agent-sdk's in-process MCP handler reads snake_case
    # `is_error`, but the MCP spec proper uses camelCase `isError`. Writing
    # both keeps both transports correct.
    return {
        "content": [{"type": "text", "text": text}],
        "is_error": True,
        "isError": True,
    }


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

    # Auto-inject root KB (user_sub) so users can always access their root files
    if user_sub and user_sub not in allowed_kb_ids:
        allowed_kb_ids.append(user_sub)
        allowed_kbs.append({"id": user_sub, "name": "My Files"})

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

    # Resolve "root" shorthand to user's root KB (user_sub)
    raw_kb_id = params.get("kb_id", "company")
    if raw_kb_id == "root" and user_sub:
        raw_kb_id = user_sub

    lambda_params: dict[str, Any] = {
        "query": query,
        "user_intent": user_intent,
        "max_results": max_results,
        "kb_id": raw_kb_id,
        "summarise_results": params.get("summarise_results", True),
        "all_kbs": params.get("all_kbs", False),
    }

    # Inject approval fields if approval was requested for this operation
    approval_key = "numa_knowledgeBases_query"
    request_id = pop_approval_id(approval_key)
    if request_id:
        lambda_params["request_id"] = request_id
        lambda_params["auto_approved"] = is_auto_approved()

    result = invoke_workspace_tool(
        "query_knowledgebase",
        lambda_params,
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_kbs": allowed_kb_ids,
            "allowed_kbs_with_names": allowed_kbs,
        },
    )

    # Handle approval denial/timeout from Lambda
    if isinstance(result, dict) and result.get("status") in ("denied", "timeout"):
        return _ok(json.dumps(result, indent=2))

    # If output_file requested, write results to file
    output_file = params.get("output_file")
    if output_file:
        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(result, indent=2))
        results_count = result.get(
            "results_count", result.get("total_results_count", 0)
        )
        schema = build_schema_preview(result)
        return _ok(
            json.dumps(
                {
                    "status": "success",
                    "message": f"Results written to {output_path}",
                    "file_path": str(output_path),
                    "results_count": results_count,
                    "schema_preview": schema,
                },
                indent=2,
            )
        )

    # Large results → spill to file + schema preview, keep context lean.
    compact = json.dumps(result, default=str, separators=(",", ":"))
    if len(compact) > _KB_INLINE_LIMIT:
        return _kb_overflow_response(result, "query")

    return _ok(json.dumps(result, indent=2))


FETCH_URL_FILE_THRESHOLD = 5000  # chars -- save to file if content exceeds this
FETCH_URL_PREVIEW_LENGTH = 500  # chars -- inline preview when saving to file
FETCH_URL_OUTPUT_DIR = Path("/workdir/tmp/web_fetch")
MAX_PDF_BYTES = 50 * 1024 * 1024  # 50 MiB cap on direct PDF downloads


def _save_fetch_url_to_file(result: dict[str, Any]) -> dict[str, Any]:
    """Save large fetch_url content to a file, return path + preview."""
    content = result.get("content", "")
    url = result.get("url", "unknown")
    title = result.get("title", "")

    if len(content) <= FETCH_URL_FILE_THRESHOLD:
        return result

    # Sanitize URL into a safe filename
    from urllib.parse import urlparse

    parsed = urlparse(url)
    safe_name = re.sub(r"[^\w\-.]", "_", f"{parsed.netloc}{parsed.path}".strip("/"))
    if not safe_name:
        safe_name = "page"
    safe_name = safe_name[:100]  # cap length

    FETCH_URL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    file_path = FETCH_URL_OUTPUT_DIR / f"{safe_name}.md"

    file_path.write_text(content, encoding="utf-8")
    logger.info(
        "Saved fetch_url content to file", path=str(file_path), size=len(content)
    )

    preview = content[:FETCH_URL_PREVIEW_LENGTH].rstrip()
    return {
        "url": url,
        "title": title,
        "status": "success",
        "content_type": result.get("content_type", "text/markdown"),
        "file_path": str(file_path),
        "content_length": len(content),
        "preview": f"{preview}...",
        "hint": f"Full content saved to {file_path}. Read the file for complete page content.",
    }


def _is_pdf_url(url: str) -> bool:
    """Detect PDF URLs by suffix (ignoring query string and fragment)."""
    return url.lower().split("?", 1)[0].split("#", 1)[0].endswith(".pdf")


async def _handle_fetch_url_pdf(url: str) -> dict[str, Any]:
    """Download a PDF directly to /workdir. Bypasses browser-lambda since
    Chromium opens PDFs in its built-in viewer (no DOM to scrape)."""
    from urllib.parse import urlparse

    import httpx

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            response = await client.get(url)

        if response.status_code != 200:
            return _err(f"PDF download failed: HTTP {response.status_code}")

        body = response.content
        if len(body) > MAX_PDF_BYTES:
            return _err(f"PDF too large: {len(body)} bytes (max {MAX_PDF_BYTES})")

        content_type = response.headers.get("content-type", "").lower()
        if "pdf" not in content_type and "octet-stream" not in content_type:
            logger.warning(
                "PDF URL returned non-PDF content-type",
                url=url,
                content_type=content_type,
            )

        parsed = urlparse(url)
        safe_name = re.sub(r"[^\w\-.]", "_", f"{parsed.netloc}{parsed.path}".strip("/"))
        if not safe_name:
            safe_name = "document"
        if not safe_name.lower().endswith(".pdf"):
            safe_name = safe_name + ".pdf"
        safe_name = safe_name[:120]

        FETCH_URL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        file_path = FETCH_URL_OUTPUT_DIR / safe_name
        file_path.write_bytes(body)

        logger.info(
            "Saved fetched PDF to file",
            url=url,
            path=str(file_path),
            size=len(body),
        )

        return _ok(
            json.dumps(
                {
                    "url": url,
                    "file_path": str(file_path),
                    "content_type": "application/pdf",
                    "content_length": len(body),
                    "status": "success",
                    "hint": (
                        f"PDF saved to {file_path}. Use the Read tool to " f"open it."
                    ),
                },
                indent=2,
            )
        )
    except Exception as e:
        logger.error("PDF download failed", url=url, error=str(e))
        return _err(f"PDF download failed: {e}")


async def _handle_web_search(params: dict[str, Any]) -> dict[str, Any]:
    """Search the web or fetch a specific URL.

    Supports two operations:
    - search (default): Returns URLs with titles and snippets
    - fetch_url: Fetches a URL with JS rendering, returns markdown content
    """
    operation = params.get("operation", "search")

    if operation == "fetch_url":
        url = params.get("url")
        if not url:
            return _err("'url' is required for fetch_url operation.")

        if _is_pdf_url(url):
            return await _handle_fetch_url_pdf(url)

        tool_params: dict[str, Any] = {
            "operation": "fetch_url",
            "url": url,
            "force_playwright": params.get("force_playwright", True),
        }
    else:
        query = params.get("query")
        if not query:
            return _err("'query' is required for web_search.")
        tool_params = {
            "query": query,
            "max_results": max(1, min(int(params.get("max_results", 5)), 10)),
        }
        # Pass through optional legacy params
        if params.get("user_intent"):
            tool_params["user_intent"] = params["user_intent"]
        if params.get("summarise"):
            tool_params["summarise"] = params["summarise"]

    result = invoke_workspace_tool("web_search", tool_params)

    # For fetch_url, save large content to file to avoid bloating context
    if operation == "fetch_url" and result.get("status") == "success":
        result = _save_fetch_url_to_file(result)

    return _ok(json.dumps(result, indent=2))


AUDIO_VIDEO_EXTENSIONS = {
    ".mp3",
    ".mp4",
    ".wav",
    ".flac",
    ".ogg",
    ".amr",
    ".webm",
    ".m4a",
    ".aac",
    ".mov",
    ".mkv",
    ".avi",
}

# S3 prefix and workspace root (must match workspace-chat-tools Lambda)
_S3_PREFIX = "numa-chat/workspace"
_WORKSPACE_ROOT = "/workdir"


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

    # Audio/video files use async invoke + S3 polling to avoid blocking
    # the stream connection during long transcriptions
    ext = Path(file_path).suffix.lower()
    if ext in AUDIO_VIDEO_EXTENSIONS:
        return await _handle_extract_content_async(file_path, user_sub, conversation_id)

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


async def _handle_extract_content_async(
    file_path: str, user_sub: str, conversation_id: str
) -> dict[str, Any]:
    """Async extract_content for audio/video: fire Lambda, poll S3 for result.

    Avoids blocking the agent stream for minutes during long transcriptions.
    The Lambda writes the transcript to a predictable S3 key; we poll for it.
    """
    import asyncio
    import time

    import boto3
    from botocore.exceptions import ClientError

    outputs_bucket = os.environ.get("OUTPUTS_BUCKET_NAME", "")
    if not outputs_bucket:
        return _err("OUTPUTS_BUCKET_NAME not configured.")

    # Compute the expected output S3 key (must match extract_content.py logic).
    # extract_content writes to /workdir/tmp/extracted_<file>.txt -- it's raw
    # tool data the model reads back, not a deliverable, so it lives in tmp/
    # and stays out of the user-facing Files page.
    filename_stem = Path(file_path).stem
    safe_filename = re.sub(r"[^a-zA-Z0-9_-]", "_", filename_stem)
    output_s3_key = (
        f"{_S3_PREFIX}/{user_sub}/conversations/{conversation_id}"
        f"/tmp/extracted_{safe_filename}.txt"
    )
    output_workspace_path = f"{_WORKSPACE_ROOT}/tmp/extracted_{safe_filename}.txt"

    # Create S3 client for polling
    session = boto3.Session(
        aws_access_key_id=os.environ.get("NUMA_LOCAL_AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("NUMA_LOCAL_AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("NUMA_LOCAL_AWS_SESSION_TOKEN"),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )
    s3_client = session.client("s3")

    # Delete any stale output from a previous run of the same file,
    # so we don't immediately poll and find old results
    try:
        s3_client.delete_object(Bucket=outputs_bucket, Key=output_s3_key)
        logger.info(
            "Deleted stale output before async transcription", key=output_s3_key
        )
    except ClientError:
        pass  # Didn't exist, that's fine

    logger.info(
        "Starting async audio transcription",
        file_path=file_path,
        expected_s3_key=output_s3_key,
    )

    # Fire Lambda asynchronously (returns immediately with 202)
    invoke_workspace_tool_async(
        "extract_content",
        {"file_path": file_path},
        extra_event_fields={
            "user_sub": user_sub,
            "conversation_id": conversation_id,
        },
    )

    # Poll S3 for the output file
    poll_interval = 5  # seconds
    max_wait = 900  # 15 minutes
    start = time.monotonic()

    while time.monotonic() - start < max_wait:
        try:
            head = s3_client.head_object(Bucket=outputs_bucket, Key=output_s3_key)
            # File exists -- transcription complete
            file_size = head.get("ContentLength", 0)
            elapsed = round(time.monotonic() - start, 1)
            logger.info(
                "Async transcription complete (S3 poll)",
                s3_key=output_s3_key,
                poll_seconds=elapsed,
                file_size=file_size,
            )
            break
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code in ("404", "NoSuchKey"):
                # Not ready yet -- expected during processing
                await asyncio.sleep(poll_interval)
            else:
                # Unexpected error (permissions, throttle, etc.)
                logger.error(
                    "S3 poll error during async transcription",
                    error_code=error_code,
                    error=str(e),
                )
                return _err(f"Failed to check transcription status: {e}")
    else:
        return _err(
            f"Transcription timed out after {max_wait // 60} minutes. "
            f"The file may still be processing -- try again or check "
            f"{output_workspace_path} later."
        )

    # Download to workspace
    download_from_s3(outputs_bucket, output_s3_key, output_workspace_path)

    # Get file size for response
    try:
        stat = Path(output_workspace_path).stat()
        text_length = stat.st_size
    except OSError:
        text_length = 0

    return _ok(
        json.dumps(
            {
                "status": "success",
                "message": f"Audio transcribed to {output_workspace_path}",
                "output_path": output_workspace_path,
                "original_file": file_path,
                "text_length": text_length,
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

    # For file mode, validate input format (matches document-converter Lambda).
    # MUST stay in sync with VALID_INPUT_FORMATS in
    # lambdas/python/workspace-chat-tools/tools/convert_document.py, the
    # LIBREOFFICE_EXTENSIONS allowlist in lambdas/node/document-converter/index.ts,
    # and LIBREOFFICE_CONVERTIBLE_FORMATS in
    # lambdas/python/extract-content-from-file/lambda_function.py.
    _SUPPORTED_INPUT_FORMATS = {
        "pdf",
        "docx",
        "doc",
        "dotx",
        "dot",
        "pptx",
        "ppt",
        "potx",
        "pot",
        "xlsx",
        "xls",
        "xltx",
        "xlt",
        "odp",
        "ods",
        "odt",
        "rtf",
        "html",
        "htm",
        "key",
        "numbers",
        "pages",
    }
    if mode == "file":
        file_ext = Path(file_path).suffix.lower().lstrip(".")
        if file_ext not in _SUPPORTED_INPUT_FORMATS:
            return _err(
                f"For mode 'file', input must be a supported format (got .{file_ext}). "
                f"Supported: {', '.join(sorted(_SUPPORTED_INPUT_FORMATS))}"
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

    # ===== NEW LOGIC START =====
    # Auto-convert PPT/PPTX to PDF before upload
    upload_filename = file_path.name
    if file_path.suffix.lower() in [".ppt", ".pptx"]:
        original_stem = file_path.stem
        convert_params = {
            "file_path": str(file_path),
            "format": "pdf",
            "mode": "file",
            "__user_sub": params.get("__user_sub", ""),
            "__conversation_id": params.get("__conversation_id", ""),
        }
        convert_result = await _handle_convert_document(convert_params)

        if convert_result.get("is_error") or convert_result.get("isError"):
            error_text = convert_result.get("content", [{}])[0].get(
                "text", "unknown error"
            )
            return _err(f"Failed to convert {file_path.suffix} to PDF: {error_text}")

        try:
            parsed = json.loads(convert_result["content"][0]["text"])
            file_param = parsed["output_path"]
            file_path = Path(file_param)
            upload_filename = f"{original_stem}.pdf"
        except (KeyError, json.JSONDecodeError, IndexError) as e:
            return _err(f"Failed to parse converted PDF path: {str(e)}")
    # ===== NEW LOGIC END =====

    file_size = file_path.stat().st_size
    is_large_file = file_size >= PRESIGNED_URL_THRESHOLD

    allowed_kbs, allowed_kb_ids, user_sub = _get_kb_config()

    # kb_path is a folder prefix, not a destination filename.
    # Accept common aliases — in long conversations the model sometimes
    # hallucinates "destination", "folder", etc. instead of "path".
    kb_path = (
        params.get("path")
        or params.get("destination")
        or params.get("folder")
        or params.get("folder_path")
        or params.get("target_path")
        or ""
    )
    # Strip the last segment if it looks like a filename (has a file extension)
    # but preserve folder names that happen to contain dots (e.g. "v2.7 reports/").
    if kb_path:
        last_segment = Path(kb_path).name
        if last_segment and re.match(r".+\.\w{1,10}$", last_segment):
            kb_path = (
                str(Path(kb_path).parent) if str(Path(kb_path).parent) != "." else ""
            )

    # Resolve "root" shorthand to user's root KB (user_sub)
    raw_kb_id = params.get("kb_id", "company")
    if raw_kb_id == "root" and user_sub:
        raw_kb_id = user_sub

    lambda_params: dict[str, Any] = {
        "filename": upload_filename,
        "kb_id": raw_kb_id,
        "kb_path": kb_path,
        "size_bytes": file_size,
    }

    if is_large_file:
        lambda_params["get_presigned_url"] = True
    else:
        with open(file_path, "rb") as f:
            lambda_params["content_base64"] = base64.b64encode(f.read()).decode("utf-8")

    # Inject approval fields for KB upload
    approval_key = "numa_knowledgeBases_upload"
    request_id = pop_approval_id(approval_key)
    if request_id:
        lambda_params["request_id"] = request_id
        lambda_params["auto_approved"] = is_auto_approved()

    result = invoke_workspace_tool(
        "add_to_kb",
        lambda_params,
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_kbs": allowed_kb_ids,
        },
    )

    # Handle approval denial/timeout from Lambda
    if isinstance(result, dict) and result.get("status") in ("denied", "timeout"):
        return _ok(json.dumps(result, indent=2))

    # Perform streaming upload for large files
    if is_large_file and isinstance(result, dict):
        presigned_url = result.get("presigned_url")
        if not presigned_url:
            return _err(
                "Backend failed to return a presigned URL for massive file streaming."
            )

        try:
            upload_to_presigned_url(presigned_url, str(file_path))

            # Finalize upload to trigger KB ingestion sidecars
            finalize_params = {
                "filename": lambda_params["filename"],
                "kb_id": lambda_params["kb_id"],
                "kb_path": lambda_params["kb_path"],
                "size_bytes": lambda_params["size_bytes"],
                "finalize_upload": True,
            }
            finalize_result = invoke_workspace_tool(
                "add_to_kb",
                finalize_params,
                extra_event_fields={
                    "user_sub": user_sub,
                    "allowed_kbs": allowed_kb_ids,
                },
            )

            if isinstance(finalize_result, dict) and finalize_result.get("status") in (
                "denied",
                "timeout",
            ):
                return _ok(json.dumps(finalize_result, indent=2))

            if isinstance(finalize_result, dict):
                result = finalize_result
                size_mb = file_size / 1024 / 1024
                # Prepend the stream success message
                original_msg = result.get("message", "")
                result["message"] = (
                    f"File '{file_path.name}' uploaded successfully via S3 stream (size {size_mb:.1f} MB). {original_msg}"
                )

        except Exception as e:
            return _err(f"Direct stream upload via S3 failed: {e}")

    return _ok(json.dumps(result, indent=2))


async def _handle_kb_download(params: dict[str, Any]) -> dict[str, Any]:
    """Download file from KB — ports knowledge_base.py cmd_download."""
    # Accept common LLM-reachable spellings. Models reliably reach for
    # `file_name`/`filename`/`path` and `destination`/`output_path`/`dest` —
    # alias them to the documented names rather than failing the call.
    uri = params.get("uri") or params.get("s3_uri")
    file_name = (
        params.get("file")
        or params.get("file_name")
        or params.get("filename")
        or params.get("path")
        or params.get("file_path")
    )

    if not uri and not file_name:
        provided = sorted(params.keys())
        return _err(
            "Either 'uri' or 'file' must be provided for kb_download. "
            f"(Got params: {provided}. The download operation expects "
            "`file` + `kb_id`, or `uri`.)"
        )

    allowed_kbs, allowed_kb_ids, user_sub = _get_kb_config()

    dl_params: dict[str, Any] = {"mode": "download"}
    if uri:
        dl_params["uri"] = uri
    else:
        dl_params["file"] = file_name
        raw_kb_id = params.get("kb_id", "company")
        if raw_kb_id == "root" and user_sub:
            raw_kb_id = user_sub
        dl_params["kb_id"] = raw_kb_id

    # Inject approval fields if approval was requested for this operation
    approval_key = "numa_knowledgeBases_download"
    request_id = pop_approval_id(approval_key)
    if request_id:
        dl_params["request_id"] = request_id
        dl_params["auto_approved"] = is_auto_approved()

    result = invoke_workspace_tool(
        "retrieve_kb_file",
        dl_params,
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_kbs": allowed_kb_ids,
        },
    )

    # Handle approval denial/timeout from Lambda
    if isinstance(result, dict) and result.get("status") in ("denied", "timeout"):
        return _ok(json.dumps(result, indent=2))

    # Save file to disk. Accept `output_dir` (documented) plus common
    # alternates the model reaches for.
    filename = result.get("filename", "downloaded_file")
    output_dir_raw = (
        params.get("output_dir")
        or params.get("destination")
        or params.get("output_path")
        or params.get("dest")
        or "/workdir/outputs/"
    )
    # If the caller passed a full file path (ends with the filename or has
    # a file extension), treat its parent as the output_dir.
    output_dir_path = Path(output_dir_raw)
    if output_dir_path.suffix:
        output_dir_path = output_dir_path.parent
    output_dir = output_dir_path
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

    raw_kb_id = params.get("kb_id", "company")
    if raw_kb_id == "root" and user_sub:
        raw_kb_id = user_sub

    lambda_params: dict[str, Any] = {
        "mode": "list",
        "kb_id": raw_kb_id,
        "pattern": params.get("pattern"),
    }

    # Optional folder scoping. `folder` is the preferred name; `folder_path`
    # (matching download_folder) and `path` (matching kb_upload) are accepted
    # as synonyms — our own KB operations spell this param three different
    # ways historically and the model often reaches for the wrong one.
    # Only forward when supplied so the Lambda sees a missing key, not null.
    folder = params.get("folder")
    if folder is None:
        folder = params.get("folder_path")
    if folder is None:
        folder = params.get("path")
    if folder is not None:
        lambda_params["folder"] = folder

    # Optional flag to return a flat recursive listing instead of a
    # one-level (files + immediate subfolders) view.
    if "recursive" in params:
        lambda_params["recursive"] = bool(params.get("recursive"))

    # Inject approval fields if approval was requested for this operation
    approval_key = "numa_knowledgeBases_list"
    request_id = pop_approval_id(approval_key)
    if request_id:
        lambda_params["request_id"] = request_id
        lambda_params["auto_approved"] = is_auto_approved()

    result = invoke_workspace_tool(
        "retrieve_kb_file",
        lambda_params,
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_kbs": allowed_kb_ids,
        },
    )

    # Handle approval denial/timeout from Lambda
    if isinstance(result, dict) and result.get("status") in ("denied", "timeout"):
        return _ok(json.dumps(result, indent=2))

    # Large listings (folders with 100+ files) → spill to file + schema preview.
    compact = json.dumps(result, default=str, separators=(",", ":"))
    if len(compact) > _KB_INLINE_LIMIT:
        return _kb_overflow_response(result, "list")

    return _ok(json.dumps(result, indent=2))


async def _handle_kb_download_folder(params: dict[str, Any]) -> dict[str, Any]:
    """Download KB folder as zip — ports knowledge_base.py cmd_download_folder."""
    allowed_kbs, allowed_kb_ids, user_sub = _get_kb_config()

    raw_kb_id = params.get("kb_id", "company")
    if raw_kb_id == "root" and user_sub:
        raw_kb_id = user_sub

    lambda_params: dict[str, Any] = {
        "mode": "download_folder",
        "kb_id": raw_kb_id,
        "folder_path": params.get("folder_path", ""),
    }

    # Inject approval fields if approval was requested for this operation
    approval_key = "numa_knowledgeBases_download_folder"
    request_id = pop_approval_id(approval_key)
    if request_id:
        lambda_params["request_id"] = request_id
        lambda_params["auto_approved"] = is_auto_approved()

    result = invoke_workspace_tool(
        "retrieve_kb_file",
        lambda_params,
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_kbs": allowed_kb_ids,
        },
    )

    # Handle approval denial/timeout from Lambda
    if isinstance(result, dict) and result.get("status") in ("denied", "timeout"):
        return _ok(json.dumps(result, indent=2))

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


async def _handle_kb_delete(params: dict[str, Any]) -> dict[str, Any]:
    """Delete file from KB."""
    filename = params.get("file") or params.get("filename")
    if not filename:
        return _err(
            "'file' (relative path within KB, e.g. 'reports/doc.pdf') "
            "is required for delete."
        )

    allowed_kbs, allowed_kb_ids, user_sub = _get_kb_config()

    raw_kb_id = params.get("kb_id", "company")
    if raw_kb_id == "root" and user_sub:
        raw_kb_id = user_sub

    lambda_params: dict[str, Any] = {
        "filename": filename,
        "kb_id": raw_kb_id,
    }

    # Inject approval fields for KB delete
    approval_key = "numa_knowledgeBases_delete"
    request_id = pop_approval_id(approval_key)
    if request_id:
        lambda_params["request_id"] = request_id
        lambda_params["auto_approved"] = is_auto_approved()

    result = invoke_workspace_tool(
        "delete_kb_file",
        lambda_params,
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_kbs": allowed_kb_ids,
        },
    )

    # Handle approval denial/timeout from Lambda
    if isinstance(result, dict) and result.get("status") in ("denied", "timeout"):
        return _ok(json.dumps(result, indent=2))

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


# Maps MCP operation names to the toggle keys that enable them.
# KB operations all share the same toggle — if the user hasn't enabled a KB,
# they shouldn't be able to upload/download/list either.
# Operations not in this map are always allowed by frontend toggles
# (but can still be restricted by NUMA_ALLOWED_OPERATIONS at agent type level).
#
# Each operation maps to a *list* of accepted toggle keys. The canonical name
# is "numa_files" (matching the user-facing rebrand). Legacy names
# ("knowledge_base", "query_knowledge_base", "knowledge_search") are accepted
# for backward compatibility with chat history replay, scheduled runs, and
# existing agent configs in DynamoDB.
_KB_TOGGLE_KEYS = [
    "numa_files",
    "knowledge_base",
    "query_knowledge_base",
    "knowledge_search",
]
_OPERATION_TO_ENABLED_TOOL_KEYS: dict[str, list[str]] = {
    "numa_files": _KB_TOGGLE_KEYS,
    "knowledge_base": _KB_TOGGLE_KEYS,  # legacy operation name, same gating
    "web_search": ["web_search"],
    "agents": ["create_agent_tool"],
    "memories": ["memories_tool"],
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
    toggle_keys = _OPERATION_TO_ENABLED_TOOL_KEYS.get(operation)
    if toggle_keys is not None:
        enabled_tools = _get_enabled_tools()
        if not any(key in enabled_tools for key in toggle_keys):
            # User-friendly messages per tool
            messages = {
                "numa_files": "No folders are enabled. Enable a folder in chat settings.",
                "knowledge_base": "No folders are enabled. Enable a folder in chat settings.",
                "web_search": "Web search is not enabled. Enable 'Web Search' in chat settings.",
                "agents": "Agent tools are not enabled. Enable 'Agent Creation' in chat settings.",
                "memories": "Memory management is not enabled. Enable 'Update Memory' in chat settings.",
            }
            return messages.get(
                operation, f"'{operation}' is not enabled in chat settings."
            )

    return None  # Allowed


# ═════════════════════════════════════════════════════════════════════════════
# Numa Files handler (consolidated)
# ═════════════════════════════════════════════════════════════════════════════

_KB_OPERATIONS = {
    "query": _handle_query_kb,
    "upload": _handle_kb_upload,
    "download": _handle_kb_download,
    "list": _handle_kb_list,
    "download_folder": _handle_kb_download_folder,
    "delete": _handle_kb_delete,
}


def _get_allowed_kb_operations() -> list[str] | None:
    """Return the allowed Numa Files sub-operations, or None if unrestricted."""
    raw = os.environ.get("NUMA_ALLOWED_KB_OPERATIONS")
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return []  # Malformed → fail-closed


async def _handle_knowledge_base(params: dict[str, Any]) -> dict[str, Any]:
    """Numa Files operations — query, upload, download, list, download_folder, delete.

    Dispatched by both `name="numa_files"` (preferred) and the legacy
    `name="knowledge_base"` (kept for chat history replay).

    Params:
        operation: One of query, upload, download, list, download_folder, delete
        (remaining keys are operation-specific, see numa-files-search SKILL.md)
    """
    operation = params.get("operation")
    handler = _KB_OPERATIONS.get(operation or "")
    if not handler:
        valid = ", ".join(_KB_OPERATIONS)
        return _err(f"Invalid numa_files operation: '{operation}'. Valid: {valid}")

    # Check agent-type-level Numa Files sub-operation restriction (e.g. read-only access)
    allowed_kb_ops = _get_allowed_kb_operations()
    if allowed_kb_ops is not None and operation not in allowed_kb_ops:
        return _err(
            f"The '{operation}' Numa Files operation is not available for this agent type. "
            f"Available operations: {', '.join(allowed_kb_ops) if allowed_kb_ops else 'none'}."
        )

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


_AGENT_WRITE_OPS = {"create", "update", "duplicate"}


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

    # Inject approval fields if approval was requested for this operation
    approval_key = f"numa_agents_{operation}"
    request_id = pop_approval_id(approval_key)
    if request_id:
        lambda_params["request_id"] = request_id
        lambda_params["auto_approved"] = is_auto_approved()

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

    # Handle approval denial/timeout from Lambda
    if isinstance(result, dict) and result.get("status") in ("denied", "timeout"):
        return _ok(json.dumps(result, indent=2))

    return _ok(json.dumps(result, indent=2))


# ═════════════════════════════════════════════════════════════════════════════
# Memories handler
# ═════════════════════════════════════════════════════════════════════════════

_MEMORY_OP_TO_TOOL = {
    "list": "user_profile_list_memories",
    "add": "user_profile_add_memory",
    "update": "user_profile_update_memory",
}


_MEMORY_WRITE_OPS = {"add", "update"}


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

    # Inject approval fields if approval was requested for this operation
    approval_key = f"numa_memories_{operation}"
    request_id = pop_approval_id(approval_key)
    if request_id:
        lambda_params["request_id"] = request_id
        lambda_params["auto_approved"] = is_auto_approved()

    result = invoke_workspace_tool(
        tool_name,
        lambda_params,
        extra_event_fields={
            "user_sub": user_sub,
            "allowed_tools": _get_enabled_tools(),
        },
    )

    # Handle approval denial/timeout from Lambda
    if isinstance(result, dict) and result.get("status") in ("denied", "timeout"):
        return _ok(json.dumps(result, indent=2))

    return _ok(json.dumps(result, indent=2))


# ═════════════════════════════════════════════════════════════════════════════
# Render handler
# ═════════════════════════════════════════════════════════════════════════════

_RENDER_MAX_INLINE = 2000

_IMAGE_MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}


async def _handle_render(params: dict[str, Any]) -> dict[str, Any]:
    """Render HTML or image content visually in the chat.

    This is a display pass-through: the agent provides content (inline or
    from a file), and the result is returned as structured JSON for the
    frontend to render in a sandboxed iframe or img tag.

    Params:
        type: "html" or "image"
        content: Inline HTML string or base64-encoded image data
        file_path: Path to a file in /workdir/ (alternative to content)
        title: Optional title shown above the rendered content
        height: Optional iframe height in pixels (default 400)
    """
    render_type = params.get("type")
    content = params.get("content")
    file_path = params.get("file_path")

    if not content and not file_path:
        return _err("Either 'content' or 'file_path' is required.")

    # Infer type from file extension when missing. The model often
    # forgets `type` when calling with `file_path` alone — infer rather
    # than fail. Fall through to a helpful error if it can't be inferred.
    if render_type not in ("html", "image"):
        inferred = None
        if file_path:
            ext = os.path.splitext(file_path)[1].lower()
            if ext in (".html", ".htm", ".svg"):
                inferred = "html"
            elif ext in _IMAGE_MIME_TYPES:
                inferred = "image"
        if inferred is None and content:
            stripped = content.lstrip()[:32].lower()
            if stripped.startswith(
                (
                    "<!doctype",
                    "<html",
                    "<svg",
                    "<div",
                    "<style",
                    "<script",
                    "<section",
                    "<article",
                )
            ):
                inferred = "html"
        if inferred is None:
            return _err(
                "'type' must be 'html' or 'image' "
                f"(could not infer from file_path={file_path!r})."
            )
        render_type = inferred

    mime_type = None

    if file_path:
        real = os.path.realpath(file_path)
        if not real.startswith("/workdir/"):
            return _err("file_path must be within /workdir/.")
        if not os.path.exists(real):
            return _err(f"File not found: {file_path}")
        try:
            if render_type == "image":
                with open(real, "rb") as f:
                    content = base64.b64encode(f.read()).decode()
                ext = os.path.splitext(file_path)[1].lower()
                mime_type = _IMAGE_MIME_TYPES.get(ext, "image/png")
            else:
                with open(real, "r", encoding="utf-8") as f:
                    content = f.read()
        except Exception as e:
            return _err(f"Failed to read {file_path}: {e}")

    if len(content) > 2 * 1024 * 1024:
        return _err("Content exceeds 2MB limit.")

    result = {
        "render_type": render_type,
        "content": content,
        "title": params.get("title"),
        "height": params.get("height", 400),
        "mime_type": mime_type,
    }

    # Large content: save to file and sync to S3 so the frontend can
    # fetch it during streaming without waiting for end-of-turn sync.
    # Lives under /workdir/tmp/ so the streaming-backing scratch file
    # does not show up in the user-facing Files page (which lists only
    # uploads/ and outputs/). tmp/ still syncs to S3 so the frontend
    # can fetch by relative path the same way it does for outputs/.
    if len(content) > _RENDER_MAX_INLINE:
        from datetime import datetime, timezone

        results_dir = Path("/workdir/tmp/render")
        results_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        ext = ".html" if render_type == "html" else ".json"
        saved_path = results_dir / f"render-{timestamp}{ext}"
        saved_content = json.dumps(result, indent=2)
        saved_path.write_text(saved_content)

        sync_file_to_s3(str(saved_path), saved_content)

        # Return lightweight reference; frontend fetches full content from S3
        result["content"] = ""
        result["file_path"] = str(saved_path)

    return _ok(json.dumps(result))


# ═════════════════════════════════════════════════════════════════════════════
# Handler dispatch map
# ═════════════════════════════════════════════════════════════════════════════

TOOL_HANDLERS = {
    "numa_files": _handle_knowledge_base,
    "knowledge_base": _handle_knowledge_base,  # legacy alias for chat history replay
    "web_search": _handle_web_search,
    "extract_content": _handle_extract_content,
    "convert_document": _handle_convert_document,
    "agents": _handle_agents,
    "memories": _handle_memories,
    "render": _handle_render,
}

TOOL_NAMES = list(TOOL_HANDLERS.keys())


# ═════════════════════════════════════════════════════════════════════════════
# MCP Tool definition
# ═════════════════════════════════════════════════════════════════════════════


@tool(
    name="numa_tool",
    description=(
        'Execute a Numa platform tool. Use `name="numa_files"` to search, '
        "upload, download, or list files in the user's Numa Files folders. "
        "Other names: web_search, extract_content, convert_document, agents, "
        "memories. "
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

    # Recover from a known model malformation: when the params payload is large,
    # Claude sometimes inlines it as a JSON-encoded string instead of an object.
    # Parse it back, or return a structured error so the model can self-correct.
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except json.JSONDecodeError as e:
            return _err(
                f"Invalid params for '{name}': expected an object, got a string "
                f"that could not be parsed as JSON ({e}). Pass params as a JSON "
                f"object, not a stringified blob."
            )
    if not isinstance(params, dict):
        return _err(
            f"Invalid params for '{name}': expected object, got {type(params).__name__}."
        )

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
        logger.exception("numa_tool handler failed", tool_name=name)
        return _err(f"Error executing {name}: {e}")
