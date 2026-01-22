"""
Numa Workspace Agent - FastAPI application for AWS Bedrock AgentCore.

AgentCore HTTP Contract:
- GET /ping - Health check (returns {"status": "Healthy"})
- POST /invocations - Main request handler (dispatches by action)

Session is tied to user (not conversation) - same MicroVM reused across conversations.
Session ID = user_sub (from JWT).
"""

import base64
import json
import os
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Optional

import aiofiles
import boto3
import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from .agent_config import AgentConfig, fetch_agent_config
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
from .prompts import format_v1_migration_context
from .s3_workspace import (
    FileChecksum,
    delete_uploads_from_s3,
    get_conversation_trace_from_s3,
    get_local_checksums,
    is_cold_start,
    list_conversation_files_from_s3,
    list_workspace_files_from_s3,
    sync_agent_reference_files,
    sync_conversation_switch,
    sync_from_s3,
    sync_to_s3,
    sync_uploads_from_s3,
)
from .sdk_config import CLIENT_NAME
from .sdk_runner import (
    check_sdk_available,
    get_run,
    get_sdk_version,
    request_stop,
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

logger.info("FastAPI app created successfully")


# Note: Hooks removed - using absolute paths directly now
# The path_transformer.py hook is no longer needed since we use absolute paths like /chat-workflows/

# Store checksums for change detection between requests
_checksums_cache: dict[str, FileChecksum] = {}

# Cache KB file listings for the current conversation (cleared on conversation switch)
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

    # Source 3: AgentCore session ID header (user-{sub} format)
    # The proxy sets session_id = f"user-{user_sub}", AgentCore passes it via this header
    session_id = request.headers.get("x-amzn-bedrock-agentcore-runtime-session-id", "")
    if session_id and session_id.startswith("user-"):
        return session_id[5:]  # Strip "user-" prefix

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


@app.get("/status")
async def get_status(request: Request):
    """
    Get workspace agent status.

    This is a read-only endpoint for checking agent capabilities.
    """
    user_sub = _extract_user_sub(request)
    sdk_version = await get_sdk_version()
    active_conv = get_active_conversation()

    return {
        "status": "ready",
        "client": CLIENT_NAME,
        "capabilities": ["chat", "file-ops", "workspace"],
        "userSub": user_sub,
        "claudeSdkVersion": sdk_version,
        "activeConversation": active_conv,
    }


# =============================================================================
# PROXY HANDLER FUNCTIONS
# These handle requests routed through the workspace-agent-proxy Lambda.
# AgentCore only POSTs to /invocations, so we route based on httpPath in payload.
# =============================================================================


async def _handle_proxy_status(request: Request, user_sub: str) -> dict:
    """Handle /status request from proxy."""
    sdk_version = await get_sdk_version()
    active_conv = get_active_conversation()

    return {
        "status": "ready",
        "client": CLIENT_NAME,
        "capabilities": ["chat", "file-ops", "workspace"],
        "userSub": user_sub,
        "claudeSdkVersion": sdk_version,
        "activeConversation": active_conv,
    }


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
        if http_path == "/status":
            return await _handle_proxy_status(request, user_sub)
        elif http_path == "/files":
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
    else:
        # Direct payload format
        body = raw_body

    action = body.get("action", "chat")
    user_sub = _extract_user_sub(request, payload_headers)
    conversation_id = body.get("conversationId") or str(uuid.uuid4())
    user_email = body.get("userEmail", "unknown")

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

    # Check for conversation switch (warm session, different conversation)
    active_conv = get_active_conversation()
    conversation_switched = False

    if not cold_start and active_conv and active_conv != conversation_id:
        logger.info(
            "Conversation switch detected",
            from_conv=active_conv[:8] + "...",
            to_conv=conversation_id[:8] + "...",
        )
        conversation_switched = True
    elif not cold_start and not active_conv:
        # Edge case: Container is warm (.system exists) but no conversation is active.
        # This can happen when:
        # - A non-chat action (upload) warmed the container without setting active_conv
        # - Container was recycled but .system dir was preserved/recreated
        # We need to sync this conversation's files from S3.
        logger.debug(
            "Warm container with no active conversation, syncing from S3",
            phase="sync",
            conversation_id=conversation_id,
        )
        sync_from_s3(user_sub, conversation_id)  # sync_from_s3 logs its own summary

    # Store checksums before request for change detection
    _checksums_cache = get_local_checksums(conversation_id)

    # Dispatch to appropriate handler
    # Note: read-only actions (get_history, list_files, status) have their own
    # lightweight GET endpoints and don't go through /invocations.
    try:
        if action == "chat":
            return await _handle_chat(
                body,
                request,
                user_sub,
                conversation_id,
                cold_start,
                conversation_switched,
                active_conv,
            )
        elif action == "stop":
            return await _handle_stop(body, user_sub)
        elif action == "upload":
            return await _handle_upload(body, user_sub, conversation_id)
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


async def _handle_chat(
    body: dict[str, Any],
    request: Request,
    user_sub: str,
    conversation_id: str,
    is_cold_start: bool,
    conversation_switched: bool,
    old_conversation_id: Optional[str],
) -> StreamingResponse:
    """Handle chat action - stream Claude CLI response."""
    global _checksums_cache

    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Missing prompt")

    timezone = body.get("timezone")
    user_email = body.get("userEmail")
    today_string = body.get("todayString")
    available_kbs = body.get("availableKBs")  # List of {id, name} for KB tool
    enabled_tools = body.get(
        "enabledTools", []
    )  # List of enabled tool names (e.g., ["web_search"])

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
                if not tools_config.web_search_enabled:
                    enabled_tools = [t for t in enabled_tools if t != "web_search"]

                # Filter create_agent_tool if disabled by agent
                if not tools_config.create_agent_enabled:
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
        conversation_switched=conversation_switched,
        has_attachments=bool(attached_files),
        has_folders=bool(attached_folders),
        model_id=model_id,
        request_id=request_id,
        migrate_from_v1=migrate_from_v1,
        agent_id=agent_id,
    )

    # Warm session sync guard: if uploads are expected but missing locally, fetch from S3
    if (
        has_uploads
        and expected_upload_paths
        and not is_cold_start
        and not conversation_switched
    ):
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

        # Handle conversation switch
        if conversation_switched and old_conversation_id:
            # Emit switching event
            yield emit_event(
                {
                    "type": "conversation_switch",
                    "status": "switching",
                    "fromConversation": old_conversation_id,
                    "toConversation": conversation_id,
                }
            )

            # Perform the switch
            sync_conversation_switch(user_sub, old_conversation_id, conversation_id)
            set_active_conversation(conversation_id)

            yield emit_event(
                {
                    "type": "conversation_switch",
                    "status": "ready",
                    "conversationId": conversation_id,
                }
            )
        elif not get_active_conversation():
            # First conversation in session
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

        # --- Fetch KB File Listings ---
        # Fetch top-level file listings for KBs on conversation start/switch
        kb_listings = None
        if available_kbs and (is_cold_start or conversation_switched):
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

            # Get recent messages from trace for context
            recent_messages = None
            try:
                trace_file = paths["trace_file"]
                if trace_file.exists():
                    all_messages = parse_trace_to_messages(trace_file)
                    # Get last 5 messages for context (user/assistant turns)
                    recent_messages = [
                        {"role": msg.get("role"), "content": msg.get("content", "")}
                        for msg in all_messages[-5:]
                    ]
            except Exception as e:
                logger.debug("Failed to read trace for recent messages", error=str(e))

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

    # Ensure we're on the right conversation
    active_conv = get_active_conversation()
    if active_conv and active_conv != conversation_id:
        # Switch conversation first
        sync_conversation_switch(user_sub, active_conv, conversation_id)
        set_active_conversation(conversation_id)

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

    # Ensure we're on the right conversation
    active_conv = get_active_conversation()
    if active_conv and active_conv != conversation_id:
        sync_conversation_switch(user_sub, active_conv, conversation_id)
        set_active_conversation(conversation_id)

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
