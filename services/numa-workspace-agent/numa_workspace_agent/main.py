"""
Numa Workspace Agent - FastAPI application for AWS Bedrock AgentCore.

AgentCore HTTP Contract:
- GET /ping - Health check (returns {"status": "Healthy"})
- POST /invocations - Main request handler (dispatches by action)

Session is tied to conversation - each conversation gets its own MicroVM container.
Session ID = conv-{conversation_id} (set by the proxy Lambda).
"""

import asyncio
import base64
import json
import os
import shutil
import time
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Optional

import aiofiles
import boto3
import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from .agent_config import (
    AgentConfig,
    fetch_agent_config,
    fetch_user_email_signature,
    fetch_user_profile,
    resolve_approval_mode,
)
from .agent_types import (
    ALWAYS_COPY,
    TOOL_FILE_MAP,
    AgentTypeConfig,
    get_agent_type_config,
)
from .assistant import (
    AssistantContext,
    build_workspace_tree,
    format_assistant_advice,
    invoke_assistant,
)
from .dynamo import (
    is_v1_conversation,
    load_v1_conversation_history,
    mark_conversation_as_v2,
    update_conversation_meta,
)
from .pipeline import run_pipeline
from .prompts import format_v1_migration_context, load_company_profile_from_s3
from .s3_workspace import (
    FileChecksum,
    delete_uploads_from_s3,
    get_conversation_trace_from_s3,
    get_local_checksums,
    is_cold_start,
    list_conversation_files_from_s3,
    list_workspace_files_from_s3,
    read_result_from_s3,
    sync_agent_reference_files,
    sync_from_s3,
    sync_to_s3,
    sync_uploads_from_s3,
    write_result_to_s3,
)
from .sdk_config import CLIENT_NAME, LOCAL_ROOT
from .sdk_runner import (
    check_sdk_available,
    get_run,
    request_stop,
    run_claude_sdk,
    stream_claude_sdk,
)
from .trace_parser import parse_trace_content_to_messages, parse_trace_to_messages
from .workspace import (
    cleanup_session_files,
    ensure_directories,
    get_active_conversation,
    get_workspace_files,
    get_workspace_paths,
    set_active_conversation,
)

logger = structlog.get_logger()

logger.info("numa-workspace-agent module loading", version="0.5.0")

app = FastAPI(
    title="Numa Workspace Agent",
    description="AgentCore-based workspace agent with Claude Agent SDK",
    version="0.5.0",
)

# Local development CORS — only active when LOCAL_DEV=1
if os.environ.get("LOCAL_DEV") == "1":
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Conversation-Id"],
    )

logger.info("FastAPI app created successfully")


# Note: Hooks removed - using absolute paths directly now
# The path_transformer.py hook is no longer needed since we use absolute paths like /chat-workflows/

# Store checksums for change detection between requests
_checksums_cache: dict[str, FileChecksum] = {}

# Cache KB file listings for the current conversation
_kb_listings_cache: dict[str, dict] = {}
_kb_listings_conversation_id: str | None = None


def _fetch_kb_listings(
    available_kbs: list[dict], user_sub: str
) -> dict[str, dict] | None:
    """
    Fetch top-level file listings for all enabled knowledge bases.

    Invokes the workspace-chat-tools Lambda with the list_kb_files tool.
    Results are cached per-conversation.

    Args:
        available_kbs: List of {id, name} for enabled KBs
        user_sub: User's Cognito sub for permission verification

    Returns:
        Dict mapping kb_id -> {files, folders, total_count, truncated}
        or None if fetch failed
    """
    global _kb_listings_cache, _kb_listings_conversation_id

    if not available_kbs:
        return None

    workspace_tools_arn = os.environ.get("WORKSPACE_TOOLS_LAMBDA_ARN", "")
    if not workspace_tools_arn:
        logger.warning(
            "WORKSPACE_TOOLS_LAMBDA_ARN not configured, skipping KB listings"
        )
        return None

    kb_ids = [kb.get("id") for kb in available_kbs if kb.get("id")]
    if not kb_ids:
        return None

    logger.debug(
        "Fetching KB file listings",
        phase="init",
        kb_ids=kb_ids,
        user_sub=user_sub,
    )

    try:
        lambda_client = boto3.client(
            "lambda", region_name=os.environ.get("AWS_REGION", "us-east-1")
        )

        payload = {
            "tool": "list_kb_files",
            "params": {"kb_ids": kb_ids},
            "allowed_kbs": kb_ids,
            "user_sub": user_sub,
        }

        response = lambda_client.invoke(
            FunctionName=workspace_tools_arn,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload).encode("utf-8"),
        )

        response_payload = json.loads(response["Payload"].read().decode("utf-8"))

        if response_payload.get("status") == "error":
            logger.warning(
                "KB listings fetch failed",
                error=response_payload.get("error"),
            )
            return None

        result = response_payload.get("result", {})
        listings = result.get("listings", {})

        if listings:
            # Build the prompt content preview for logging
            from .prompts import build_kb_context

            kb_context_preview = build_kb_context(available_kbs, listings)

            logger.info(
                "KB listings fetched for system prompt",
                _name="KB_LISTINGS",
                phase="init",
                kb_count=len(listings),
                kb_ids=list(listings.keys()),
                total_items=sum(
                    len(l.get("files", [])) + len(l.get("folders", []))
                    for l in listings.values()
                ),
                prompt_content=kb_context_preview,
            )

        return listings if listings else None

    except Exception as e:
        logger.warning(
            "Failed to fetch KB listings",
            error=str(e),
            exc_info=True,
        )
        return None


def _get_cached_kb_listings(
    conversation_id: str,
    available_kbs: list[dict] | None,
    user_sub: str,
    force_refresh: bool = False,
) -> dict[str, dict] | None:
    """
    Get KB listings from cache or fetch fresh if needed.

    Args:
        conversation_id: Current conversation ID
        available_kbs: List of {id, name} for enabled KBs
        user_sub: User's Cognito sub
        force_refresh: If True, bypass cache and fetch fresh

    Returns:
        Dict mapping kb_id -> listing data, or None
    """
    global _kb_listings_cache, _kb_listings_conversation_id

    if not available_kbs:
        return None

    # Clear cache if conversation changed
    if _kb_listings_conversation_id != conversation_id:
        _kb_listings_cache = {}
        _kb_listings_conversation_id = conversation_id

    # Return cached if available and not forcing refresh
    if _kb_listings_cache and not force_refresh:
        logger.debug(
            "Using cached KB listings",
            conversation_id=conversation_id[:8] + "..." if conversation_id else "",
            kb_count=len(_kb_listings_cache),
        )
        return _kb_listings_cache

    # Fetch fresh listings
    listings = _fetch_kb_listings(available_kbs, user_sub)
    if listings:
        _kb_listings_cache = listings

    return listings


def _extract_user_sub_from_headers(headers: dict[str, str]) -> str:
    """
    Extract user sub from headers dict (either HTTP headers or proxy payload headers).

    Tries x-user-sub first, then falls back to decoding JWT from authorization header.
    """
    logger.info(
        "Extracting user_sub from headers",
        header_keys=list(headers.keys()),
        has_x_user_sub=bool(headers.get("x-user-sub")),
        has_authorization=bool(headers.get("authorization")),
    )

    # Check for explicit user sub header
    user_sub = headers.get("x-user-sub")
    if user_sub:
        logger.info(
            "Found x-user-sub header",
            user_sub=user_sub[:8] + "..." if user_sub else None,
        )
        return user_sub

    # Fall back to extracting from JWT in Authorization header
    auth_header = headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        try:
            # Decode JWT payload (AgentCore has already validated it)
            payload = token.split(".")[1]
            # Add padding if needed
            padding = 4 - len(payload) % 4
            if padding != 4:
                payload += "=" * padding
            decoded = json.loads(base64.urlsafe_b64decode(payload))
            sub = decoded.get("sub", "")
            if sub:
                logger.info(
                    "Extracted sub from JWT", sub=sub[:8] + "..." if sub else None
                )
                return sub
        except Exception as e:
            logger.warning("Failed to extract sub from JWT", error=str(e))

    logger.error(
        "Unable to identify user - returning 401",
        headers=headers,
        header_keys=list(headers.keys()),
    )
    raise HTTPException(status_code=401, detail="Unable to identify user")


def _extract_user_sub(
    request: Request, payload_headers: dict[str, str] | None = None
) -> str:
    """
    Extract user sub from request, trying multiple sources.

    Order of precedence:
    1. Payload headers from proxy (x-user-sub)
    2. HTTP headers (x-user-sub)
    3. AgentCore session ID header (user-{sub} format)
    4. JWT from payload or HTTP headers
    """
    # Source 1: Payload headers from proxy (x-user-sub)
    if payload_headers:
        user_sub = payload_headers.get("x-user-sub")
        if user_sub:
            return user_sub

    # Source 2: HTTP headers (x-user-sub)
    http_user_sub = request.headers.get("x-user-sub")
    if http_user_sub:
        return http_user_sub

    # Source 3: AgentCore session ID header
    # Legacy format: user-{sub} (backwards compat during rollout)
    # New format: conv-{conversation_id} (does not contain user_sub)
    session_id = request.headers.get("x-amzn-bedrock-agentcore-runtime-session-id", "")
    if session_id and session_id.startswith("user-"):
        return session_id[5:]  # Strip "user-" prefix (legacy format)

    # Source 4: JWT from either payload or HTTP headers
    auth_header = (payload_headers or {}).get("authorization") or request.headers.get(
        "authorization", ""
    )
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        try:
            payload = token.split(".")[1]
            padding = 4 - len(payload) % 4
            if padding != 4:
                payload += "=" * padding
            decoded = json.loads(base64.urlsafe_b64decode(payload))
            sub = decoded.get("sub", "")
            if sub:
                return sub
        except Exception as e:
            logger.warning(
                "Failed to extract sub from JWT",
                _name="AUTH_JWT_ERROR",
                phase="auth",
                error=str(e),
            )

    # All sources exhausted
    logger.error(
        "Could not identify user from any source",
        _name="AUTH_FAILED",
        phase="auth",
        has_payload_headers=payload_headers is not None,
    )
    raise HTTPException(status_code=401, detail="Unable to identify user")


def _get_session_id(request: Request) -> Optional[str]:
    """Get AgentCore session ID from request header."""
    return request.headers.get("x-amzn-bedrock-agentcore-runtime-session-id")


@app.get("/ping")
async def ping():
    """
    AgentCore health check endpoint.

    Returns status for AgentCore to determine container health.
    """
    sdk_available = check_sdk_available()
    return {
        "status": "Healthy" if sdk_available else "HealthyBusy",
        "time_of_last_update": int(__import__("time").time()),
    }


# =============================================================================
# LIGHTWEIGHT READ-ONLY ENDPOINTS
# These don't trigger workspace sync or require an active session.
# =============================================================================


@app.get("/history/{conversation_id}")
async def get_history(conversation_id: str, request: Request):
    """
    Get conversation history directly from S3.

    This is a read-only endpoint that doesn't trigger workspace sync
    or start a Claude CLI session. Used for loading conversation history
    in the UI without spinning up a full session.
    """
    user_sub = _extract_user_sub(request)

    logger.info(
        "Fetching conversation history",
        user_sub=user_sub[:8] + "..." if user_sub else None,
        conversation_id=conversation_id[:8] + "..." if conversation_id else None,
    )

    try:
        # Fetch trace content from S3
        trace_content = get_conversation_trace_from_s3(user_sub, conversation_id)

        if trace_content is None:
            return {
                "status": "success",
                "conversation": {
                    "conversationId": conversation_id,
                    "conversationName": f"Conversation {conversation_id[:8]}",
                    "messages": [],
                    "metadata": {
                        "hasTrace": False,
                        "uploadsCount": 0,
                        "sessionCount": 0,
                    },
                },
            }

        # Parse trace content (string) to messages
        messages = parse_trace_content_to_messages(trace_content)

        return {
            "status": "success",
            "conversation": {
                "conversationId": conversation_id,
                "conversationName": f"Conversation {conversation_id[:8]}",
                "messages": messages,
                "metadata": {
                    "hasTrace": True,
                    "uploadsCount": 0,
                    "sessionCount": 0,
                },
            },
        }
    except Exception as e:
        logger.error(
            "Failed to fetch conversation history",
            user_sub=user_sub[:8] + "..." if user_sub else None,
            conversation_id=conversation_id[:8] + "..." if conversation_id else None,
            error=str(e),
            exc_info=True,
        )
        # Return empty conversation on error instead of 500
        return {
            "status": "success",
            "conversation": {
                "conversationId": conversation_id,
                "conversationName": f"Conversation {conversation_id[:8]}",
                "messages": [],
                "metadata": {
                    "hasTrace": False,
                    "uploadsCount": 0,
                    "sessionCount": 0,
                    "error": str(e),
                },
            },
        }


@app.get("/trace/{conversation_id}")
async def get_raw_trace(conversation_id: str, request: Request):
    """
    Get raw trace.jsonl content for a conversation.

    This is a read-only endpoint that returns the raw NDJSON trace file
    without parsing. Used for downloading/viewing the full trace.
    """
    user_sub = _extract_user_sub(request)

    logger.debug(
        "Fetching raw trace",
        phase="request",
        user_sub=user_sub,
        conversation_id=conversation_id,
    )

    try:
        trace_content = get_conversation_trace_from_s3(user_sub, conversation_id)

        if trace_content is None:
            return Response(
                content="",
                media_type="application/x-ndjson",
                status_code=200,
            )

        return Response(
            content=trace_content,
            media_type="application/x-ndjson",
            status_code=200,
        )
    except Exception as e:
        logger.error(
            "Failed to fetch raw trace",
            user_sub=user_sub[:8] + "..." if user_sub else None,
            conversation_id=conversation_id[:8] + "..." if conversation_id else None,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/files")
async def list_files_endpoint(request: Request):
    """
    List files in user's workspace directly from S3.

    This is a read-only endpoint that doesn't trigger workspace sync.
    """
    user_sub = _extract_user_sub(request)

    logger.info(
        "Listing workspace files",
        user_sub=user_sub[:8] + "..." if user_sub else None,
    )

    files = list_workspace_files_from_s3(user_sub)

    return {
        "status": "success",
        "files": files,
    }


@app.get("/files/{conversation_id}")
async def list_conversation_files_endpoint(conversation_id: str, request: Request):
    """
    List files in a conversation's uploads/ and session/ directories from S3.

    This is a read-only endpoint that doesn't trigger workspace sync.
    Used for displaying conversation files in the settings panel.
    """
    user_sub = _extract_user_sub(request)

    logger.info(
        "Listing conversation files",
        user_sub=user_sub[:8] + "..." if user_sub else None,
        conversation_id=conversation_id[:8] + "..." if conversation_id else None,
    )

    files = list_conversation_files_from_s3(user_sub, conversation_id)

    return {
        "status": "success",
        "files": files,
    }


# =============================================================================
# LOCAL WORKSPACE FILE ENDPOINTS (for test UI / local dev)
# These read directly from the container's /workdir filesystem, not from S3.
# =============================================================================


@app.get("/workspace/files")
async def list_workspace_local_files():
    """List files in /workdir/session/ and /workdir/uploads/ from the local filesystem."""
    files = []
    for subdir in ("session", "uploads"):
        dir_path = LOCAL_ROOT / subdir
        if not dir_path.exists():
            continue
        for file_path in sorted(dir_path.rglob("*")):
            if not file_path.is_file():
                continue
            rel = file_path.relative_to(LOCAL_ROOT)
            files.append(
                {
                    "path": str(rel),
                    "name": file_path.name,
                    "size": file_path.stat().st_size,
                }
            )
    return {"files": files}


@app.get("/workspace/file")
async def read_workspace_local_file(path: str):
    """Read a file from the local /workdir filesystem.

    Query param ``path`` is relative to /workdir (e.g. ``session/result.json``).
    Rejects paths containing ``..`` to prevent traversal.
    """
    if ".." in path:
        raise HTTPException(status_code=400, detail="Invalid path")

    file_path = (LOCAL_ROOT / path).resolve()
    if not str(file_path).startswith(str(LOCAL_ROOT.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    content = file_path.read_text(errors="replace")

    # Return JSON for .json files so the UI can pretty-print
    if file_path.suffix == ".json":
        try:
            return JSONResponse(content=json.loads(content))
        except json.JSONDecodeError:
            pass

    return Response(content=content, media_type="text/plain")


# =============================================================================
# PROXY HANDLER FUNCTIONS
# These handle requests routed through the workspace-agent-proxy Lambda.
# AgentCore only POSTs to /invocations, so we route based on httpPath in payload.
# =============================================================================


async def _handle_proxy_files(user_sub: str) -> dict:
    """Handle /files request from proxy."""
    logger.info(
        "Listing workspace files (via proxy)",
        user_sub=user_sub[:8] + "..." if user_sub else None,
    )

    files = list_workspace_files_from_s3(user_sub)

    return {
        "status": "success",
        "files": files,
    }


async def _handle_proxy_conversation_files(user_sub: str, conversation_id: str) -> dict:
    """Handle /files/{conversation_id} request from proxy."""
    logger.info(
        "Listing conversation files (via proxy)",
        user_sub=user_sub[:8] + "..." if user_sub else None,
        conversation_id=conversation_id[:8] + "..." if conversation_id else None,
    )

    files = list_conversation_files_from_s3(user_sub, conversation_id)

    return {
        "status": "success",
        "files": files,
    }


async def _handle_proxy_history(user_sub: str, conversation_id: str) -> dict:
    """Handle /history/{conversation_id} request from proxy."""
    logger.info(
        "Fetching conversation history (via proxy)",
        user_sub=user_sub[:8] + "..." if user_sub else None,
        conversation_id=conversation_id[:8] + "..." if conversation_id else None,
    )

    try:
        # Fetch trace content from S3
        trace_content = get_conversation_trace_from_s3(user_sub, conversation_id)

        if trace_content is None:
            return {
                "status": "success",
                "conversation": {
                    "conversationId": conversation_id,
                    "conversationName": f"Conversation {conversation_id[:8]}",
                    "messages": [],
                    "metadata": {
                        "hasTrace": False,
                        "uploadsCount": 0,
                        "sessionCount": 0,
                    },
                },
            }

        # Parse trace content (string) to messages
        messages = parse_trace_content_to_messages(trace_content)

        return {
            "status": "success",
            "conversation": {
                "conversationId": conversation_id,
                "conversationName": f"Conversation {conversation_id[:8]}",
                "messages": messages,
                "metadata": {
                    "hasTrace": True,
                    "uploadsCount": 0,
                    "sessionCount": 0,
                },
            },
        }
    except Exception as e:
        logger.error(
            "Failed to fetch conversation history (via proxy)",
            user_sub=user_sub[:8] + "..." if user_sub else None,
            conversation_id=conversation_id[:8] + "..." if conversation_id else None,
            error=str(e),
            exc_info=True,
        )
        # Return empty conversation on error instead of 500
        return {
            "status": "success",
            "conversation": {
                "conversationId": conversation_id,
                "conversationName": f"Conversation {conversation_id[:8]}",
                "messages": [],
                "metadata": {
                    "hasTrace": False,
                    "uploadsCount": 0,
                    "sessionCount": 0,
                    "error": str(e),
                },
            },
        }


async def _handle_proxy_trace(user_sub: str, conversation_id: str) -> Response:
    """Handle /trace/{conversation_id} request from proxy - returns raw trace content."""
    logger.debug(
        "Fetching raw trace (via proxy)",
        phase="request",
        user_sub=user_sub,
        conversation_id=conversation_id,
    )

    try:
        trace_content = get_conversation_trace_from_s3(user_sub, conversation_id)

        if trace_content is None:
            return Response(
                content="",
                media_type="application/x-ndjson",
                status_code=200,
            )

        return Response(
            content=trace_content,
            media_type="application/x-ndjson",
            status_code=200,
        )
    except Exception as e:
        logger.error(
            "Failed to fetch raw trace (via proxy)",
            user_sub=user_sub[:8] + "..." if user_sub else None,
            conversation_id=conversation_id[:8] + "..." if conversation_id else None,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(e))


async def _handle_list_types() -> JSONResponse:
    """Handle /types — return all registered agent types.

    Returns a lightweight summary of every registered agent type for
    admin dashboards, auto-discovery UIs, or frontend type selectors.
    """
    from .agent_types import list_agent_types

    return JSONResponse(
        content={
            "status": "ok",
            "types": list_agent_types(),
        }
    )


async def _handle_run_status(user_sub: str, run_id: str) -> JSONResponse:
    """Handle /runs/{run_id}/status — poll for fire-and-forget result.

    Checks S3 for a ``_result.json`` written by :func:`_handle_fire_and_forget`.
    Returns ``{"status": "running"}`` if the file does not exist yet, or the
    full result payload if the run has completed (or errored).

    Note: ``s3_prefix`` is not passed here — the default template produces
    the same path as the fallback. Agent types with custom ``s3_prefix_template``
    values will need a future enhancement where the caller passes the agent
    type (or stores the prefix alongside the run).
    """
    logger.debug(
        "Polling run status",
        phase="request",
        user_sub=user_sub,
        run_id=run_id,
    )

    # Uses the default S3 prefix. Custom agent types with non-default
    # s3_prefix_template will need the type info passed through.
    result = read_result_from_s3(user_sub, run_id)

    if result is None:
        return JSONResponse(
            content={
                "status": "running",
                "run_id": run_id,
            }
        )

    return JSONResponse(
        content={
            "status": result.get("status", "completed"),
            "run_id": run_id,
            "result": {
                "text": result.get("text", ""),
                "artifacts": result.get("artifacts", []),
                "usage": result.get("usage", {}),
                "steps": result.get("steps", []),
            },
        }
    )


# =============================================================================
# AGENTCORE INVOCATION ENDPOINT
# This triggers workspace sync and manages session state.
# =============================================================================


@app.post("/invocations")
async def invocations(request: Request):
    """
    AgentCore main invocation endpoint.

    Dispatches to appropriate handler based on 'action' field in payload.
    Handles S3 workspace sync on cold start and conversation switches.

    Supports two payload formats:

    1. Direct format (for testing):
    {
        "action": "chat" | "status" | "list_files" | "upload" | "cleanup_session" | "stop",
        "prompt": "...",           # for chat action
        "conversationId": "...",   # required for most actions
        "timezone": "...",         # optional for chat
        "filename": "...",         # for upload
        "fileContent": "base64...", # for upload
    }

    2. Proxy-wrapped format (from workspace-agent-proxy Lambda):
    {
        "httpMethod": "POST",
        "httpPath": "/invocations",
        "headers": {"x-user-sub": "...", "authorization": "..."},
        "body": { <direct format payload> }
    }
    """
    global _checksums_cache

    raw_bytes = await request.body()

    logger.debug(
        "Invocation request received",
        phase="request",
        content_type=request.headers.get("content-type"),
        body_length=len(raw_bytes),
    )

    try:
        raw_body = json.loads(raw_bytes)
    except Exception as e:
        logger.error(
            "JSON parse failed",
            error=str(e),
            body_preview=raw_bytes[:200].decode("utf-8", errors="replace"),
        )
        raise HTTPException(status_code=400, detail="Invalid JSON body") from e

    # Detect proxy-wrapped payload format
    payload_headers: dict[str, str] | None = None
    http_path: str | None = None
    if "httpMethod" in raw_body and "headers" in raw_body:
        # This is a wrapped payload from the proxy Lambda
        payload_headers = raw_body.get("headers", {})
        body = raw_body.get("body", {})
        http_path = raw_body.get("httpPath", "")

        # Log the incoming request with payload details
        logger.info(
            "Received request via proxy",
            _name="REQUEST_RECEIVED",
            phase="request",
            http_method=raw_body.get("httpMethod"),
            http_path=http_path,
            action=body.get("action", "chat") if isinstance(body, dict) else None,
            conversation_id=(
                body.get("conversationId") if isinstance(body, dict) else None
            ),
            prompt_length=(
                len(body.get("prompt", "")) if isinstance(body, dict) else None
            ),
            has_attachments=(
                bool(body.get("attachments")) if isinstance(body, dict) else None
            ),
            model_id=body.get("modelId") if isinstance(body, dict) else None,
        )

        # Route requests to appropriate handlers based on httpPath
        # These don't need workspace sync, so handle them early
        user_sub = _extract_user_sub(request, payload_headers)
        if http_path == "/files":
            return await _handle_proxy_files(user_sub)
        elif http_path and http_path.startswith("/files/"):
            # /files/{conversation_id} - per-conversation file listing
            conversation_id = http_path.replace("/files/", "")
            return await _handle_proxy_conversation_files(user_sub, conversation_id)
        elif http_path and http_path.startswith("/history/"):
            conversation_id = http_path.replace("/history/", "")
            return await _handle_proxy_history(user_sub, conversation_id)
        elif http_path and http_path.startswith("/trace/"):
            conversation_id = http_path.replace("/trace/", "")
            return await _handle_proxy_trace(user_sub, conversation_id)
        elif (
            http_path
            and http_path.startswith("/runs/")
            and http_path.endswith("/status")
        ):
            # /runs/{run_id}/status — poll for fire-and-forget result
            run_id = http_path.replace("/runs/", "").replace("/status", "")
            return await _handle_run_status(user_sub, run_id)
        elif http_path == "/types":
            return await _handle_list_types()
    else:
        # Direct payload format
        body = raw_body

    action = body.get("action", "chat")
    user_sub = _extract_user_sub(request, payload_headers)
    conversation_id = body.get("conversationId") or str(uuid.uuid4())
    user_email = body.get("userEmail", "unknown")

    # Resolve agent type config (defaults to "numa-chat")
    agent_type_id = body.get("type", "numa-chat")
    agent_type_config = get_agent_type_config(agent_type_id)

    # Export user context to environment for tools (they read from env vars)
    os.environ["NUMA_USER_SUB"] = user_sub or "unknown"
    os.environ["NUMA_CONVERSATION_ID"] = conversation_id

    logger.info(
        "Invocation received",
        _name="INVOCATION",
        phase="request",
        action=action,
        user_email=user_email,
        user_sub=user_sub,
        conversation_id=conversation_id,
        agent_type=agent_type_id,
    )

    # Check for cold start
    cold_start = is_cold_start()
    if cold_start:
        logger.info("Cold start detected, syncing from S3")
        sync_result = sync_from_s3(user_sub, conversation_id)
        logger.info(
            "Cold start sync complete",
            files_downloaded=sync_result["files_downloaded"],
            errors=len(sync_result["errors"]),
        )

    # Ensure directories exist
    ensure_directories()

    # Selective tool copy: only copy tool scripts the agent type needs
    # This runs on every request but is fast (just a directory listing + diff)
    from .workspace import setup_agent_tools

    setup_agent_tools(
        enabled_numa_tools=agent_type_config.enabled_numa_tools,
        tools_source_dirs=agent_type_config.tools_source_dirs,
        tool_file_map=TOOL_FILE_MAP,
        always_copy=ALWAYS_COPY,
    )

    # Store checksums before request for change detection
    _checksums_cache = get_local_checksums(conversation_id)

    # Dispatch to appropriate handler
    # Note: read-only actions (get_history, list_files, status) have their own
    # lightweight GET endpoints and don't go through /invocations.
    #
    # Response mode routing: the agent type's response_mode determines how the
    # result is delivered. A request-level "responseMode" override is also
    # supported (useful for testing — e.g. stream a normally-sync agent).
    try:
        if action == "chat":
            # Response mode: explicit request field takes precedence.
            # If omitted, fall back to the agent type config's default.
            #
            # IMPORTANT: the proxy Lambda also reads "responseMode" from
            # the request body to decide stream-vs-collect. If the caller
            # omits responseMode and the agent type defaults to "sync" or
            # "fire-and-forget", the proxy would still stream (it can't
            # see agent type config). To keep proxy and container in sync:
            #   - If responseMode IS in the request → use it (proxy matches)
            #   - If responseMode is NOT in the request → default to "stream"
            #     even if agent type config says otherwise, and log a warning
            #     so developers know to add responseMode to their requests.
            request_mode = body.get("responseMode")
            type_default = agent_type_config.response_mode

            if request_mode:
                effective_mode = request_mode
            elif type_default != "stream":
                # Agent type wants non-stream, but caller didn't specify.
                # Default to stream to match the proxy. Log so devs notice.
                logger.warning(
                    "Agent type defaults to non-stream response mode but "
                    "request did not include responseMode — defaulting to "
                    "stream to match proxy. Add responseMode to the request "
                    "body to use the agent type's preferred mode.",
                    agent_type=agent_type_config.type_id,
                    type_default=type_default,
                )
                effective_mode = "stream"
            else:
                effective_mode = "stream"

            # Pipeline types cannot stream — streaming a multi-step pipeline
            # is confusing (which step's tokens are you seeing?). Fall back to
            # sync so the pipeline runs to completion and returns a single result.
            if effective_mode == "stream" and agent_type_config.pipeline_steps:
                logger.info(
                    "Pipeline type cannot stream — falling back to sync",
                    _name="PIPELINE_STREAM_FALLBACK",
                    phase="request",
                    agent_type=agent_type_config.type_id,
                    pipeline_steps=agent_type_config.pipeline_steps,
                )
                effective_mode = "sync"

            if effective_mode == "stream":
                return await _handle_chat(
                    body,
                    request,
                    user_sub,
                    conversation_id,
                    cold_start,
                    agent_type_config=agent_type_config,
                )
            elif effective_mode == "sync":
                return await _handle_sync(
                    body,
                    request,
                    user_sub,
                    conversation_id,
                    cold_start,
                    agent_type_config=agent_type_config,
                )
            elif effective_mode == "fire-and-forget":
                return await _handle_fire_and_forget(
                    body,
                    request,
                    user_sub,
                    conversation_id,
                    cold_start,
                    agent_type_config=agent_type_config,
                )
            else:
                logger.warning(
                    "Unknown response_mode, falling back to stream",
                    response_mode=effective_mode,
                    agent_type=agent_type_config.type_id,
                )
                return await _handle_chat(
                    body,
                    request,
                    user_sub,
                    conversation_id,
                    cold_start,
                    agent_type_config=agent_type_config,
                )
        elif action == "stop":
            return await _handle_stop(body, user_sub)
        elif action == "upload":
            return await _handle_upload(body, user_sub, conversation_id)
        elif action == "upload_complete":
            return await _handle_upload_complete(body, user_sub, conversation_id)
        elif action == "delete_uploads":
            return await _handle_delete_uploads(body, user_sub, conversation_id)
        elif action == "cleanup_session":
            return await _handle_cleanup_session()
        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {action}")
    finally:
        # Sync changed files to S3 after request (except chat which handles its own)
        if action not in ["chat", "stop"]:
            sync_to_s3(user_sub, conversation_id, _checksums_cache)


def _download_single_integration(
    app_slug: str,
    external_user_id: str,
    tools_dir: Path,
    lambda_client: Any,
    lambda_name: str,
) -> bool:
    """Download action schemas for a single integration.

    Returns True if schemas were successfully downloaded.
    """
    app_dir = tools_dir / app_slug

    try:
        event = {
            "tool": "pipedream_list_actions",
            "allowed_tools": [app_slug],
            "params": {
                "app_slug": app_slug,
                "external_user_id": external_user_id,
            },
        }

        response = lambda_client.invoke(
            FunctionName=lambda_name,
            Payload=json.dumps(event),
            InvocationType="RequestResponse",
        )
        payload = json.loads(response["Payload"].read())

        if payload.get("status") != "success":
            logger.warning(
                "Failed to list actions",
                app_slug=app_slug,
                error=payload.get("error"),
            )
            return False

        actions = payload.get("result", {}).get("actions", [])
        if not actions:
            logger.info("No actions found", app_slug=app_slug)
            return False

        # Save individual action files and build index
        app_dir.mkdir(parents=True, exist_ok=True)
        index_entries = []

        for action in actions:
            key = action.get("key", action.get("name_slug", "unknown"))
            name = action.get("name", key)
            description = action.get("description", "")
            annotations = action.get("annotations", {})
            props = action.get("configurable_props", [])

            # Save full action schema
            action_filename = key.replace("/", "_") + ".json"
            (app_dir / action_filename).write_text(
                json.dumps(action, indent=2, default=str)
            )

            # Build index entry
            index_entries.append(
                {
                    "key": key,
                    "name": name,
                    "description": description[:200],
                    "annotations": annotations,
                    "prop_count": len(props),
                    "file": action_filename,
                }
            )

        # Save index
        index_file = app_dir / "_index.json"
        index_file.write_text(json.dumps(index_entries, indent=2))

        logger.info(
            "Downloaded integration schemas",
            app_slug=app_slug,
            action_count=len(index_entries),
        )
        return True

    except Exception as e:
        logger.warning(
            "Failed to download schemas for integration",
            app_slug=app_slug,
            error=str(e),
        )
        return False


def _sync_integration_schemas(
    enabled_integrations: list[str],
    external_user_id: str,
) -> dict:
    """Sync integration schemas to match enabled integrations.

    Downloads schemas for newly enabled integrations and removes
    schemas for disabled ones. On the common path (nothing changed),
    this is just a directory listing — negligible overhead.

    Args:
        enabled_integrations: List of app slugs (e.g., ["google_drive", "slack"])
        external_user_id: The Pipedream external user ID

    Returns:
        {"added": [...], "removed": [...], "cached": [...]}
    """
    tools_dir = Path("/workdir/tools/integrations")
    tools_dir.mkdir(parents=True, exist_ok=True)

    enabled_set = set(enabled_integrations)
    on_disk = {d.name for d in tools_dir.iterdir() if d.is_dir()}

    to_download = enabled_set - on_disk
    to_remove = on_disk - enabled_set
    cached = enabled_set & on_disk

    # Remove disabled integrations
    for slug in to_remove:
        shutil.rmtree(tools_dir / slug, ignore_errors=True)

    # Download new integrations
    added = []
    if to_download:
        lambda_name = os.environ.get("WORKSPACE_TOOLS_LAMBDA_NAME", "")
        if not lambda_name:
            logger.warning("No WORKSPACE_TOOLS_LAMBDA_NAME, skipping schema download")
            return {"added": [], "removed": list(to_remove), "cached": list(cached)}

        lambda_client = boto3.client(
            "lambda", region_name=os.environ.get("AWS_REGION", "us-east-1")
        )

        for slug in to_download:
            if _download_single_integration(
                slug, external_user_id, tools_dir, lambda_client, lambda_name
            ):
                added.append(slug)

    result = {"added": added, "removed": list(to_remove), "cached": list(cached)}

    if added or to_remove:
        logger.info(
            "Integration schemas synced",
            _name="INTEGRATION_SCHEMAS_SYNCED",
            phase="integrations",
            added=added,
            removed=list(to_remove),
            cached=list(cached),
        )

    return result


async def _handle_chat(
    body: dict[str, Any],
    request: Request,
    user_sub: str,
    conversation_id: str,
    is_cold_start: bool,
    agent_type_config: Optional[AgentTypeConfig] = None,
) -> StreamingResponse:
    """Handle chat action - stream Claude CLI response."""
    global _checksums_cache

    # Resolve agent type config (default to numa-chat if not provided)
    if agent_type_config is None:
        agent_type_config = get_agent_type_config("numa-chat")

    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Missing prompt")

    timezone = body.get("timezone")
    user_email = body.get("userEmail")
    today_string = body.get("todayString")
    company_profile = load_company_profile_from_s3()
    available_kbs = body.get("availableKBs")  # List of {id, name} for KB tool
    enabled_tools = body.get(
        "enabledTools", []
    )  # List of enabled tool names (e.g., ["web_search"])

    # Apply agent type restrictions on KBs
    if agent_type_config.restrict_kbs:
        available_kbs = agent_type_config.default_kbs or []
    elif agent_type_config.default_kbs and not available_kbs:
        available_kbs = agent_type_config.default_kbs

    # Attachment handling - now supports both files and folders
    # Frontend sends: {files: [{path, filename, size}], folders?: [{name, path, fileCount, totalSize}]}
    attachments_data = body.get("attachments")
    attached_files = attachments_data.get("files", []) if attachments_data else []
    attached_folders = attachments_data.get("folders", []) if attachments_data else []
    has_uploads = body.get("hasUploads", False)
    expected_upload_paths = body.get("expectedUploadPaths", [])

    # Model selection (global cross-region inference profile)
    model_id = body.get("modelId")
    request_id = body.get("requestId") or str(uuid.uuid4())

    # Pipedream integrations - construct external_user_id for the relay
    # Format: "{client_name}_{user_sub}" matching what the frontend uses
    enabled_integrations = body.get("enabledConnections", [])

    # Apply agent type restrictions on integrations
    if agent_type_config.restrict_integrations:
        enabled_integrations = agent_type_config.default_integrations or []
    elif agent_type_config.default_integrations and not enabled_integrations:
        enabled_integrations = agent_type_config.default_integrations

    external_user_id = f"{CLIENT_NAME}_{user_sub}" if enabled_integrations else None

    # Add each connected integration slug to enabled_tools so the
    # workspace-chat-tools Lambda can validate per-integration access
    # (e.g. "google_drive", "google_calendar" rather than a blanket flag)
    if enabled_integrations:
        enabled_tools = list(enabled_tools)
        for slug in enabled_integrations:
            if slug not in enabled_tools:
                enabled_tools.append(slug)

    logger.info(
        "Integration tools configured",
        _name="INTEGRATION_TOOLS_CONFIGURED",
        phase="request",
        enabled_tools=enabled_tools,
        enabled_integrations=enabled_integrations,
        external_user_id=external_user_id,
    )

    # V1 to V2 migration flag - frontend sets this when loading a V1 conversation
    migrate_from_v1 = body.get("migrateFromV1", False)

    # Agent support - fetch agent config if agentId is provided
    agent_id = body.get("agentId")
    agent_config: Optional[AgentConfig] = None
    agent_file_paths: list[str] = []

    if agent_id:
        try:
            agent_config = fetch_agent_config(agent_id, user_sub)
            if agent_config:
                # Apply agent tool restrictions
                tools_config = agent_config.tools_config

                # Filter web_search if disabled by agent
                # auto_tools_enabled implies all tools are enabled
                if (
                    not tools_config.auto_tools_enabled
                    and not tools_config.web_search_enabled
                ):
                    enabled_tools = [t for t in enabled_tools if t != "web_search"]

                # Filter create_agent_tool if disabled by agent
                if (
                    not tools_config.auto_tools_enabled
                    and not tools_config.create_agent_enabled
                ):
                    enabled_tools = [
                        t for t in enabled_tools if t != "create_agent_tool"
                    ]

                # Apply KB restrictions
                allowed_kbs = tools_config.allowed_knowledge_bases
                if allowed_kbs is not None:
                    if len(allowed_kbs) == 0:
                        # No KBs allowed
                        available_kbs = []
                    elif available_kbs:
                        # Filter to only allowed KBs
                        available_kbs = [
                            kb for kb in available_kbs if kb.get("id") in allowed_kbs
                        ]

                # Download agent reference files
                if agent_config.reference_files:
                    agent_file_paths = sync_agent_reference_files(
                        agent_config, conversation_id, user_sub
                    )

                logger.info(
                    "Agent config applied",
                    _name="AGENT_CONFIG_APPLIED",
                    phase="request",
                    agent_id=agent_id,
                    agent_title=agent_config.title,
                    web_search_enabled=tools_config.web_search_enabled,
                    allowed_kbs=allowed_kbs,
                    reference_files_count=len(agent_file_paths),
                )
        except Exception as e:
            logger.warning(
                "Failed to fetch agent config, continuing without agent",
                agent_id=agent_id,
                error=str(e),
            )
            agent_config = None

    logger.info(
        "Chat request",
        _name="CHAT_REQUEST",
        phase="request",
        user_sub=user_sub,
        conversation_id=conversation_id,
        prompt_length=len(prompt),
        is_cold_start=is_cold_start,
        has_attachments=bool(attached_files),
        has_folders=bool(attached_folders),
        model_id=model_id,
        request_id=request_id,
        migrate_from_v1=migrate_from_v1,
        agent_id=agent_id,
        has_company_profile=bool(company_profile and company_profile.strip()),
        company_profile_length=len(company_profile) if company_profile else 0,
    )

    # Warm session sync guard: if uploads are expected but missing locally, fetch from S3
    if has_uploads and expected_upload_paths and not is_cold_start:
        paths = get_workspace_paths()
        uploads_dir = paths["uploads"]
        missing = [
            p
            for p in expected_upload_paths
            if not (uploads_dir / p.replace("uploads/", "")).exists()
        ]
        if missing:
            logger.info(
                "Syncing missing uploads from S3",
                missing_count=len(missing),
                conversation_id=conversation_id,
            )
            sync_uploads_from_s3(user_sub, conversation_id)

    async def stream_with_sync():
        """Stream CLI output with session/conversation events."""

        def emit_event(event: dict) -> str:
            """Emit event as SSE data line."""
            return f"data: {json.dumps(event)}\n\n"

        async def is_client_disconnected() -> bool:
            """Check if client dropped the SSE connection."""
            return await request.is_disconnected()

        # Emit session initialization event if cold start
        if is_cold_start:
            yield emit_event(
                {
                    "type": "session_init",
                    "isNewSession": True,
                    "status": "ready",
                }
            )

        # Set active conversation if not already set (first request in this container)
        if not get_active_conversation():
            set_active_conversation(conversation_id)

        # --- V1 to V2 Migration ---
        # Check if this is a V1 conversation being continued in V2
        v1_context = ""
        if migrate_from_v1:
            logger.info(
                "V1 migration flag set, checking conversation status",
                _name="V1_MIGRATION_CHECK",
                phase="migration",
                conversation_id=(
                    conversation_id[:8] + "..." if conversation_id else None
                ),
            )

            if is_v1_conversation(user_sub, conversation_id):
                v1_history = load_v1_conversation_history(user_sub, conversation_id)
                if v1_history:
                    v1_context = format_v1_migration_context(v1_history)
                    logger.info(
                        "V1 migration context prepared",
                        _name="V1_MIGRATION_CONTEXT",
                        phase="migration",
                        conversation_id=(
                            conversation_id[:8] + "..." if conversation_id else None
                        ),
                        message_count=len(v1_history),
                        context_length=len(v1_context),
                    )

                # Mark as V2 immediately so future messages don't re-migrate
                mark_conversation_as_v2(user_sub, conversation_id)
            else:
                logger.debug(
                    "Migration flag set but conversation is already V2",
                    conversation_id=(
                        conversation_id[:8] + "..." if conversation_id else None
                    ),
                )

        # --- Sync Integration Schemas ---
        # Diff-based sync on every request: download new, remove disabled
        if enabled_integrations and external_user_id:
            try:
                sync_result = _sync_integration_schemas(
                    enabled_integrations, external_user_id
                )
                if sync_result["added"] or sync_result["removed"]:
                    yield emit_event(
                        {
                            "type": "integrations_ready",
                            "integrations": enabled_integrations,
                            "added": sync_result["added"],
                            "removed": sync_result["removed"],
                        }
                    )
            except Exception as e:
                logger.warning(
                    "Failed to sync integration schemas",
                    error=str(e),
                    integrations=enabled_integrations,
                )
        elif not enabled_integrations:
            # No integrations enabled — clean up any stale schemas on disk
            tools_dir = Path("/workdir/tools/integrations")
            if tools_dir.exists() and any(tools_dir.iterdir()):
                shutil.rmtree(tools_dir, ignore_errors=True)

        # --- Fetch KB File Listings ---
        # Fetch top-level file listings for KBs on cold start
        kb_listings = None
        if available_kbs and is_cold_start:
            try:
                kb_listings = _get_cached_kb_listings(
                    conversation_id, available_kbs, user_sub, force_refresh=True
                )
            except Exception as e:
                logger.warning("Failed to fetch KB listings", error=str(e))
        elif available_kbs:
            # Subsequent messages: use cached listings if available
            kb_listings = _get_cached_kb_listings(
                conversation_id, available_kbs, user_sub, force_refresh=False
            )

        # --- Pre-Request Assistant ---
        # Run fast assistant to provide recommendations to Numa
        augmented_prompt = prompt
        try:
            paths = get_workspace_paths()
            workspace_tree = build_workspace_tree(str(paths["root"]))

            # Get recent messages and activated skills from trace
            recent_messages = None
            activated_skills = []
            try:
                trace_file = paths["trace_file"]
                if trace_file.exists():
                    all_messages = parse_trace_to_messages(trace_file)
                    # Get last 5 messages for context (user/assistant turns)
                    recent_messages = [
                        {"role": msg.get("role"), "content": msg.get("content", "")}
                        for msg in all_messages[-5:]
                    ]
                    # Extract skills already activated in this conversation
                    # by scanning raw trace for Skill tool_use entries
                    with trace_file.open("r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                event = json.loads(line)
                                if event.get("type") != "assistant":
                                    continue
                                contents = event.get("message", {}).get("content", [])
                                for c in contents:
                                    if (
                                        c.get("type") == "tool_use"
                                        and c.get("name") == "Skill"
                                    ):
                                        skill_name = c.get("input", {}).get("skill")
                                        if (
                                            skill_name
                                            and skill_name not in activated_skills
                                        ):
                                            activated_skills.append(skill_name)
                            except (json.JSONDecodeError, KeyError):
                                continue
            except Exception as e:
                logger.debug("Failed to read trace for recent messages", error=str(e))

            # Load integration index files for pre-assistant context
            integration_indexes = None
            if enabled_integrations:
                integration_indexes = {}
                for slug in enabled_integrations:
                    index_path = Path(f"/workdir/tools/integrations/{slug}/_index.json")
                    if index_path.exists():
                        try:
                            integration_indexes[slug] = json.loads(
                                index_path.read_text(encoding="utf-8")
                            )
                        except (json.JSONDecodeError, OSError):
                            pass

            assistant_context = AssistantContext(
                user_email=user_email,
                user_timezone=timezone,
                available_kbs=available_kbs,
                enabled_tools=enabled_tools,
                workspace_tree=workspace_tree,
                today_string=today_string,
                recent_messages=recent_messages,
                kb_listings=kb_listings,
                attached_folders=attached_folders,
                attached_files=attached_files,
                enabled_integrations=(
                    enabled_integrations if enabled_integrations else None
                ),
                activated_skills=activated_skills if activated_skills else None,
                integration_indexes=integration_indexes,
            )

            assistant_advice = invoke_assistant(prompt, assistant_context)

            if assistant_advice:
                # Emit event to frontend for visibility AND write to trace for history
                from datetime import datetime
                from datetime import timezone as tz

                advice_event = {
                    "type": "assistant_advice",
                    "content": assistant_advice,
                    "timestamp": datetime.now(tz.utc).isoformat(),
                }

                # Write to trace file for persistence
                trace_path = paths["trace_file"]
                with trace_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(advice_event) + "\n")

                # Yield to frontend for live display
                yield emit_event(advice_event)

                # Prepend advice to prompt for Numa to see
                augmented_prompt = format_assistant_advice(assistant_advice) + prompt

                logger.info(
                    "Pre-Numa assistant advice generated",
                    _name="ASSISTANT_ADVICE",
                    phase="assistant",
                    conversation_id=conversation_id,
                    user_sub=user_sub,
                    advice_content=assistant_advice,
                    advice_length=len(assistant_advice),
                    original_prompt_length=len(prompt),
                )
        except Exception as e:
            # Don't let assistant failures break the main flow
            logger.warning(
                "Assistant invocation failed, continuing without advice",
                _name="ASSISTANT_ERROR",
                phase="assistant",
                conversation_id=conversation_id,
                error=str(e),
            )

        stream_error: Exception | None = None
        try:
            # Wrap SDK stream with heartbeat to keep CloudFront connection alive
            # during long-running tool executions (CloudFront has 60s timeout)
            # Resolve integration approval mode (agent config > user setting > default)
            effective_approval_mode = resolve_approval_mode(user_sub, agent_config)
            email_signature = fetch_user_email_signature(user_sub)
            user_profile = fetch_user_profile(user_sub)

            sdk_stream = stream_claude_sdk(
                conversation_id,
                augmented_prompt,  # May include <numa-assistant> tags for Claude
                user_sub,
                timezone,
                user_email,
                today_string,
                available_kbs,
                enabled_tools,
                is_cold_start=is_cold_start,
                attached_files=attached_files,
                attached_folders=attached_folders,
                original_prompt=prompt,  # Clean prompt for trace storage
                model_id=model_id,  # Global cross-region inference profile
                kb_listings=kb_listings,  # KB file listings for prompt context
                request_id=request_id,
                disconnect_checker=is_client_disconnected,
                v1_migration_context=v1_context,  # V1 conversation history context
                agent_config=agent_config,  # Agent configuration (custom prompt, restrictions)
                agent_file_paths=agent_file_paths,  # Downloaded agent reference files
                external_user_id=external_user_id,  # Pipedream integrations user ID
                enabled_integrations=enabled_integrations,  # Connected integration app slugs
                approval_mode=effective_approval_mode,  # Integration approval mode
                email_signature=email_signature,  # Email signature settings
                agent_type_config=agent_type_config,  # Agent type configuration
                user_profile=user_profile,  # User profile for AI personalisation
                company_profile=company_profile,  # Company profile for system prompt
            )
            async for chunk in sdk_stream:
                # Stream chunk directly to frontend via HTTP SSE
                yield chunk
        except Exception as e:
            stream_error = e
            logger.error(
                "Stream error occurred",
                error=str(e),
                conversation_id=(
                    conversation_id[:8] + "..." if conversation_id else None
                ),
                exc_info=True,
            )
            # Re-raise to propagate error in HTTP response
            raise
        finally:
            # Update conversation meta in DynamoDB
            update_conversation_meta(
                user_sub=user_sub,
                conversation_id=conversation_id,
                latest_message=prompt,
            )

            # Sync changed files to S3 (sync_to_s3 logs its own summary)
            sync_to_s3(user_sub, conversation_id, _checksums_cache)

    return StreamingResponse(
        stream_with_sync(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Conversation-Id": conversation_id,
        },
    )


async def _handle_sync(
    body: dict[str, Any],
    request: Request,
    user_sub: str,
    conversation_id: str,
    is_cold_start: bool,
    agent_type_config: Optional[AgentTypeConfig] = None,
) -> JSONResponse:
    """Handle chat with synchronous response mode.

    Runs the full Claude SDK agent loop to completion — same workspace, same
    tools, same trace — but returns the final result as a single JSON response
    instead of streaming SSE events. Perfect for API callers, Step Functions,
    and other backend systems that need the answer as structured data.

    The response shape:
        {
            "status": "completed" | "error",
            "result": {
                "text": "...",
                "artifacts": [...],
                "usage": { "num_turns": N, "total_cost_usd": X, ... }
            }
        }
    """
    global _checksums_cache

    if agent_type_config is None:
        agent_type_config = get_agent_type_config("numa-chat")

    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Missing prompt")

    logger.info(
        "Sync chat request",
        _name="SYNC_CHAT_REQUEST",
        phase="request",
        user_sub=user_sub,
        conversation_id=conversation_id,
        prompt_length=len(prompt),
        agent_type=agent_type_config.type_id,
    )

    # Extract the same parameters as _handle_chat for SDK options
    timezone = body.get("timezone")
    user_email = body.get("userEmail")
    today_string = body.get("todayString")
    company_profile = load_company_profile_from_s3()
    available_kbs = body.get("availableKBs")
    enabled_tools = body.get("enabledTools", [])
    model_id = body.get("modelId")
    request_id = body.get("requestId") or str(uuid.uuid4())
    attachments_data = body.get("attachments")
    attached_files = attachments_data.get("files", []) if attachments_data else []
    attached_folders = attachments_data.get("folders", []) if attachments_data else []

    # Apply agent type restrictions on KBs
    if agent_type_config.restrict_kbs:
        available_kbs = agent_type_config.default_kbs or []
    elif agent_type_config.default_kbs and not available_kbs:
        available_kbs = agent_type_config.default_kbs

    # Integrations
    enabled_integrations = body.get("enabledConnections", [])
    if agent_type_config.restrict_integrations:
        enabled_integrations = agent_type_config.default_integrations or []
    elif agent_type_config.default_integrations and not enabled_integrations:
        enabled_integrations = agent_type_config.default_integrations

    external_user_id = f"{CLIENT_NAME}_{user_sub}" if enabled_integrations else None

    # KB listings
    kb_listings = None
    if available_kbs:
        kb_listings = _get_cached_kb_listings(
            conversation_id,
            available_kbs,
            user_sub,
            force_refresh=is_cold_start,
        )

    # Run SDK — either as a pipeline (sequential steps) or single agent
    if agent_type_config.pipeline_steps:
        result = await run_pipeline(
            pipeline_steps=agent_type_config.pipeline_steps,
            prompt=prompt,
            user_sub=user_sub,
            conversation_id=conversation_id,
            parent_type_config=agent_type_config,
            timezone=timezone,
            user_email=user_email,
            today_string=today_string,
            available_kbs=available_kbs,
            enabled_tools=enabled_tools,
            model_id=model_id,
            request_id=request_id,
            attached_files=attached_files,
            attached_folders=attached_folders,
            kb_listings=kb_listings,
            external_user_id=external_user_id,
            enabled_integrations=enabled_integrations,
        )
    else:
        result = await run_claude_sdk(
            conversation_id,
            prompt,
            user_sub,
            timezone_str=timezone,
            user_email=user_email,
            today_string=today_string,
            available_kbs=available_kbs,
            enabled_tools=enabled_tools,
            is_cold_start=is_cold_start,
            attached_files=attached_files,
            attached_folders=attached_folders,
            original_prompt=prompt,
            model_id=model_id,
            kb_listings=kb_listings,
            request_id=request_id,
            agent_config=None,
            external_user_id=external_user_id,
            enabled_integrations=enabled_integrations,
            agent_type_config=agent_type_config,
            company_profile=company_profile,
        )

    # If the agent type uses result_file mode, read /workdir/session/result.json
    # and use it as the response text instead of the raw SDK output. This is the
    # same convention used by pipelines, but here for single-step agent types
    # (e.g. document-summariser) that write structured output to a known file.
    if (
        agent_type_config
        and agent_type_config.pipeline_result_mode == "result_file"
        and not agent_type_config.pipeline_steps  # Pipelines handle this themselves
    ):
        result_path = Path("/workdir/session/result.json")
        if result_path.exists():
            try:
                structured = json.loads(result_path.read_text())
                result["text"] = json.dumps(structured, indent=2, default=str)
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(
                    "Failed to read result.json, using SDK text",
                    _name="RESULT_FILE_ERROR",
                    phase="result",
                    error=str(e),
                )
        else:
            logger.warning(
                "result.json not found, using SDK text",
                _name="RESULT_FILE_MISSING",
                phase="result",
                expected_path=str(result_path),
                agent_type=agent_type_config.type_id,
            )

    # Update conversation meta
    update_conversation_meta(
        user_sub=user_sub,
        conversation_id=conversation_id,
        latest_message=prompt,
    )

    # Sync workspace to S3
    sync_to_s3(user_sub, conversation_id, _checksums_cache)

    # Also persist result to S3 for retrieval via /runs endpoint
    s3_prefix = agent_type_config.s3_prefix_template if agent_type_config else None
    write_result_to_s3(user_sub, conversation_id, result, s3_prefix=s3_prefix)

    status_code = 200 if result.get("status") == "completed" else 500
    return JSONResponse(
        status_code=status_code,
        content={
            "status": result.get("status", "completed"),
            "result": {
                "text": result.get("text", ""),
                "artifacts": result.get("artifacts", []),
                "usage": result.get("usage", {}),
                "steps": result.get("steps", []),
            },
            "conversationId": conversation_id,
        },
    )


async def _handle_fire_and_forget(
    body: dict[str, Any],
    request: Request,
    user_sub: str,
    conversation_id: str,
    is_cold_start: bool,
    agent_type_config: Optional[AgentTypeConfig] = None,
) -> JSONResponse:
    """Handle chat with fire-and-forget response mode.

    Starts the Claude SDK agent loop as a background task and returns
    immediately with a ``run_id`` the caller can poll for status. The result
    is written to S3 (``_result.json``) when the agent finishes.

    This mode is designed for long-running tasks that exceed the Lambda proxy
    timeout (15 min). The AgentCore container can run for up to 8 hours.

    Immediate response:
        {
            "status": "started",
            "run_id": "<conversation_id>",
            "poll_endpoint": "/runs/<conversation_id>/status"
        }
    """
    global _checksums_cache

    if agent_type_config is None:
        agent_type_config = get_agent_type_config("numa-chat")

    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Missing prompt")

    logger.info(
        "Fire-and-forget chat request",
        _name="ASYNC_CHAT_REQUEST",
        phase="request",
        user_sub=user_sub,
        conversation_id=conversation_id,
        prompt_length=len(prompt),
        agent_type=agent_type_config.type_id,
    )

    # Extract the same parameters as _handle_chat
    timezone = body.get("timezone")
    user_email = body.get("userEmail")
    today_string = body.get("todayString")
    company_profile = load_company_profile_from_s3()
    available_kbs = body.get("availableKBs")
    enabled_tools = body.get("enabledTools", [])
    model_id = body.get("modelId")
    request_id = body.get("requestId") or str(uuid.uuid4())
    attachments_data = body.get("attachments")
    attached_files = attachments_data.get("files", []) if attachments_data else []
    attached_folders = attachments_data.get("folders", []) if attachments_data else []

    # Apply agent type restrictions
    if agent_type_config.restrict_kbs:
        available_kbs = agent_type_config.default_kbs or []
    elif agent_type_config.default_kbs and not available_kbs:
        available_kbs = agent_type_config.default_kbs

    enabled_integrations = body.get("enabledConnections", [])
    if agent_type_config.restrict_integrations:
        enabled_integrations = agent_type_config.default_integrations or []
    elif agent_type_config.default_integrations and not enabled_integrations:
        enabled_integrations = agent_type_config.default_integrations

    external_user_id = f"{CLIENT_NAME}_{user_sub}" if enabled_integrations else None

    kb_listings = None
    if available_kbs:
        kb_listings = _get_cached_kb_listings(
            conversation_id,
            available_kbs,
            user_sub,
            force_refresh=is_cold_start,
        )

    # Capture current checksums before background task starts
    pre_checksums = dict(_checksums_cache)
    s3_prefix = agent_type_config.s3_prefix_template if agent_type_config else None

    async def _background_run() -> None:
        """Run the SDK (or pipeline) and write the result to S3 when done."""
        try:
            if agent_type_config.pipeline_steps:
                result = await run_pipeline(
                    pipeline_steps=agent_type_config.pipeline_steps,
                    prompt=prompt,
                    user_sub=user_sub,
                    conversation_id=conversation_id,
                    parent_type_config=agent_type_config,
                    timezone=timezone,
                    user_email=user_email,
                    today_string=today_string,
                    available_kbs=available_kbs,
                    enabled_tools=enabled_tools,
                    model_id=model_id,
                    request_id=request_id,
                    attached_files=attached_files,
                    attached_folders=attached_folders,
                    kb_listings=kb_listings,
                    external_user_id=external_user_id,
                    enabled_integrations=enabled_integrations,
                )
            else:
                result = await run_claude_sdk(
                    conversation_id,
                    prompt,
                    user_sub,
                    timezone_str=timezone,
                    user_email=user_email,
                    today_string=today_string,
                    available_kbs=available_kbs,
                    enabled_tools=enabled_tools,
                    is_cold_start=is_cold_start,
                    attached_files=attached_files,
                    attached_folders=attached_folders,
                    original_prompt=prompt,
                    model_id=model_id,
                    kb_listings=kb_listings,
                    request_id=request_id,
                    agent_config=None,
                    external_user_id=external_user_id,
                    enabled_integrations=enabled_integrations,
                    agent_type_config=agent_type_config,
                    company_profile=company_profile,
                )

            # If the agent type uses result_file mode, read result.json
            if (
                agent_type_config
                and agent_type_config.pipeline_result_mode == "result_file"
                and not agent_type_config.pipeline_steps
            ):
                result_path = Path("/workdir/session/result.json")
                if result_path.exists():
                    try:
                        structured = json.loads(result_path.read_text())
                        result["text"] = json.dumps(
                            structured,
                            indent=2,
                            default=str,
                        )
                    except (json.JSONDecodeError, OSError) as e:
                        logger.warning(
                            "Failed to read result.json, using SDK text",
                            _name="RESULT_FILE_ERROR",
                            phase="result",
                            error=str(e),
                        )
                else:
                    logger.warning(
                        "result.json not found, using SDK text",
                        _name="RESULT_FILE_MISSING",
                        phase="result",
                        expected_path=str(result_path),
                        agent_type=agent_type_config.type_id,
                    )

            # Update conversation meta
            update_conversation_meta(
                user_sub=user_sub,
                conversation_id=conversation_id,
                latest_message=prompt,
            )

            # Sync workspace and write result to S3
            sync_to_s3(user_sub, conversation_id, pre_checksums)
            write_result_to_s3(
                user_sub,
                conversation_id,
                result,
                s3_prefix=s3_prefix,
            )

            logger.info(
                "Fire-and-forget run completed",
                _name="ASYNC_RUN_COMPLETE",
                phase="result",
                conversation_id=conversation_id,
                status=result.get("status"),
            )
        except Exception as e:
            logger.error(
                "Fire-and-forget run failed",
                _name="ASYNC_RUN_ERROR",
                phase="result",
                conversation_id=conversation_id,
                error=str(e),
                exc_info=True,
            )
            # Write error result so polling endpoint can report the failure
            write_result_to_s3(
                user_sub,
                conversation_id,
                {
                    "status": "error",
                    "text": "",
                    "artifacts": [],
                    "usage": {},
                    "error": str(e),
                },
                s3_prefix=s3_prefix,
            )

    # Launch the background task — FastAPI / asyncio will keep it running
    # even after we return the HTTP response
    asyncio.create_task(_background_run())

    return JSONResponse(
        status_code=202,
        content={
            "status": "started",
            "run_id": conversation_id,
            "conversationId": conversation_id,
            "poll_endpoint": f"/runs/{conversation_id}/status",
        },
    )


async def _handle_stop(body: dict[str, Any], user_sub: str) -> dict[str, Any]:
    """Handle stop action - interrupts an active chat run."""
    conversation_id = body.get("conversationId")
    request_id = body.get("requestId")

    if not conversation_id or not request_id:
        raise HTTPException(
            status_code=400, detail="Missing conversationId or requestId for stop"
        )

    run_key = (user_sub, conversation_id, request_id)
    handle = await get_run(run_key)
    if not handle:
        raise HTTPException(
            status_code=404, detail="No active chat found to stop for this request"
        )

    logger.info(
        "Stop requested",
        _name="STOP_REQUEST",
        phase="request",
        conversation_id=conversation_id,
        user_sub=user_sub,
        request_id=request_id,
    )

    stopped = await request_stop(run_key, reason="user_requested")

    return {
        "status": "stopped" if stopped else "not_found",
        "conversationId": conversation_id,
        "requestId": request_id,
    }


def _sanitize_upload_path(raw_path: str) -> str | None:
    """
    Validate and sanitize a relative upload path for security.

    Validates:
    - No absolute paths (/ or \\)
    - No parent directory traversal (..)
    - No hidden segments (starting with .)
    - No empty or whitespace-only segments
    - No control characters

    Also normalizes unicode:
    - Normalizes to NFC form for consistent representation
    - Replaces non-breaking spaces (U+00A0) and other unicode spaces with regular spaces
      (macOS uses non-breaking spaces in screenshot filenames which causes phantom file issues)

    Args:
        raw_path: The raw path from the upload request (e.g., "invoices/2024/a.pdf")

    Returns:
        Sanitized relative path, or None if invalid
    """
    if not raw_path:
        return None

    # Normalize unicode to NFC form for consistent representation
    raw_path = unicodedata.normalize("NFC", raw_path)

    # Replace various unicode space characters with regular ASCII space
    # macOS uses non-breaking spaces (U+00A0) in screenshot filenames like
    # "Screenshot 2026-01-14 at 7.43.42 am.png" which causes phantom file issues
    raw_path = raw_path.replace("\u00a0", " ")  # Non-breaking space
    raw_path = raw_path.replace("\u2007", " ")  # Figure space
    raw_path = raw_path.replace("\u202f", " ")  # Narrow no-break space

    # Reject absolute paths
    if raw_path.startswith("/") or raw_path.startswith("\\"):
        return None

    # Also reject Windows-style absolute paths like C:\
    if len(raw_path) >= 2 and raw_path[1] == ":":
        return None

    # Normalize path separators
    normalized = raw_path.replace("\\", "/")

    # Split and validate each segment
    segments = normalized.split("/")
    clean_segments: list[str] = []

    for segment in segments:
        # Skip empty segments (from // or trailing /)
        if not segment:
            continue
        # Reject parent directory traversal
        if segment == "..":
            return None
        # Reject current directory references
        if segment == ".":
            continue
        # Reject hidden files/directories
        if segment.startswith("."):
            return None
        # Reject segments with only whitespace
        if not segment.strip():
            return None
        # Reject segments with control characters
        if any(ord(c) < 32 for c in segment):
            return None
        clean_segments.append(segment)

    if not clean_segments:
        return None

    return "/".join(clean_segments)


async def _handle_upload(
    body: dict[str, Any],
    user_sub: str,
    conversation_id: str,
) -> dict[str, Any]:
    """Handle upload action - save file to uploads directory."""
    filename = body.get("filename")
    file_content_b64 = body.get("fileContent")

    if not filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if not file_content_b64:
        raise HTTPException(status_code=400, detail="Missing fileContent")

    # Decode base64 content
    try:
        content = base64.b64decode(file_content_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid base64 fileContent") from e

    paths = get_workspace_paths()

    # Sanitize the upload path - allows folder structure like "invoices/2024/a.pdf"
    safe_rel_path = _sanitize_upload_path(filename)
    if safe_rel_path is None:
        raise HTTPException(status_code=400, detail="Invalid filename or path")

    # Extract just the filename for the response
    safe_filename = safe_rel_path.split("/")[-1]

    # Write file, creating parent directories if needed
    upload_path = paths["uploads"] / safe_rel_path
    upload_path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(upload_path, "wb") as f:
        await f.write(content)

    logger.info(
        "File uploaded",
        conversation_id=conversation_id,
        path=safe_rel_path,
        filename=safe_filename,
        size=len(content),
    )

    return {
        "status": "success",
        "path": f"uploads/{safe_rel_path}",
        "filename": safe_filename,
        "size": len(content),
    }


async def _handle_upload_complete(
    body: dict[str, Any],
    user_sub: str,
    conversation_id: str,
) -> dict[str, Any]:
    """
    Handle upload_complete action - file was uploaded directly to S3.

    This is called after frontend uploads a file directly to S3 using a presigned URL.
    We need to sync the file from S3 to local EFS so the agent can access it.

    Body:
        filename: str - relative path within uploads/ (e.g., "folder/file.pdf" or "doc.txt")
        s3Key: str - full S3 key where the file was uploaded
        size: int - file size in bytes
    """
    from .s3_workspace import OUTPUTS_BUCKET

    filename = body.get("filename")
    s3_key = body.get("s3Key")
    size = body.get("size", 0)

    if not filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if not s3_key:
        raise HTTPException(status_code=400, detail="Missing s3Key")

    # Validate S3 key matches expected pattern (security check)
    expected_prefix = (
        f"numa-chat/workspace/{user_sub}/conversations/{conversation_id}/uploads/"
    )
    if not s3_key.startswith(expected_prefix):
        logger.warning(
            "Invalid S3 key - does not match expected prefix",
            s3_key=s3_key,
            expected_prefix=expected_prefix,
        )
        raise HTTPException(status_code=400, detail="Invalid S3 key")

    if not OUTPUTS_BUCKET:
        raise HTTPException(
            status_code=500, detail="OUTPUTS_BUCKET_NAME not configured"
        )

    # Sanitize the upload path
    safe_rel_path = _sanitize_upload_path(filename)
    if safe_rel_path is None:
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Sync file from S3 to local EFS
    paths = get_workspace_paths()
    local_path = paths["uploads"] / safe_rel_path
    local_path.parent.mkdir(parents=True, exist_ok=True)

    s3 = boto3.client("s3")
    try:
        s3.download_file(OUTPUTS_BUCKET, s3_key, str(local_path))
    except Exception as e:
        logger.error(
            "Failed to sync file from S3",
            s3_key=s3_key,
            local_path=str(local_path),
            error=str(e),
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to sync file from S3: {str(e)}"
        ) from e

    # Extract just the filename for the response
    safe_filename = safe_rel_path.split("/")[-1]

    logger.info(
        "File synced from S3",
        _name="UPLOAD_COMPLETE",
        phase="upload",
        conversation_id=conversation_id,
        path=safe_rel_path,
        filename=safe_filename,
        size=size,
        s3_key=s3_key,
    )

    return {
        "status": "success",
        "path": f"uploads/{safe_rel_path}",
        "filename": safe_filename,
        "size": size,
    }


async def _handle_delete_uploads(
    body: dict[str, Any],
    user_sub: str,
    conversation_id: str,
) -> dict[str, Any]:
    """
    Handle delete_uploads action - remove files from uploads directory and S3.

    Used when user unstages files before sending a message.

    Body:
        paths: list[str] - relative paths within uploads/ (e.g., ["folder/file.pdf", "doc.txt"])
    """
    paths_to_delete = body.get("paths", [])

    if not isinstance(paths_to_delete, list):
        raise HTTPException(status_code=400, detail="paths must be a list")

    if not paths_to_delete:
        return {"status": "success", "deleted": [], "errors": []}

    paths = get_workspace_paths()
    deleted: list[str] = []
    errors: list[dict[str, str]] = []

    for rel_path in paths_to_delete:
        # Validate path security
        safe_path = _sanitize_upload_path(rel_path)
        if safe_path is None:
            errors.append({"path": rel_path, "error": "Invalid path"})
            continue

        local_path = paths["uploads"] / safe_path

        # Delete locally
        try:
            if local_path.exists():
                local_path.unlink()
                # Try to remove empty parent directories
                _cleanup_empty_parents(local_path.parent, paths["uploads"])
                deleted.append(rel_path)
            else:
                errors.append({"path": rel_path, "error": "File not found locally"})
        except Exception as e:
            errors.append({"path": rel_path, "error": str(e)})

    # Also delete from S3 immediately
    if deleted:
        try:
            delete_uploads_from_s3(user_sub, conversation_id, deleted)
        except Exception as e:
            logger.error("Failed to delete from S3", error=str(e))
            # Don't fail the request - local delete succeeded

    logger.info(
        "Delete uploads completed",
        deleted=len(deleted),
        errors=len(errors),
        conversation_id=conversation_id,
    )

    return {"status": "success", "deleted": deleted, "errors": errors}


def _cleanup_empty_parents(start_dir: Path, stop_at: Path) -> None:
    """Remove empty parent directories up to (but not including) stop_at."""
    current = start_dir
    while current != stop_at and current.exists():
        try:
            if any(current.iterdir()):
                break  # Not empty
            current.rmdir()
            current = current.parent
        except Exception:
            break


async def _handle_cleanup_session() -> dict[str, Any]:
    """Handle cleanup_session action."""
    deleted = cleanup_session_files()
    return {
        "status": "success",
        "deleted": deleted,
    }


# Error handlers


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions."""
    logger.error("Unhandled exception", error=str(exc), exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"},
    )
