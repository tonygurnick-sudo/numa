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
import errno
import json
import mimetypes
import os
import shutil
import subprocess
import time
import unicodedata
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import boto3
import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from .agent_config import (
    AgentConfig,
    clear_user_settings_cache,
    fetch_agent_config,
    fetch_user_email_signature,
    fetch_user_profile,
    resolve_all_approval_modes,
    resolve_approval_mode,
    resolve_per_integration_approval_modes,
)
from .agent_types import (
    AgentTypeConfig,
    get_agent_type_config,
)
from .atomic_io import atomic_write_bytes, atomic_write_text
from .dynamo import (
    is_v1_conversation,
    load_v1_conversation_history,
    mark_conversation_as_v2,
    update_conversation_meta,
    upsert_active_run,
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
    read_progress_from_s3,
    read_result_from_s3,
    sync_agent_reference_files,
    sync_ext_api_docs_for_connectors,
    sync_from_s3,
    sync_to_s3,
    sync_uploads_from_s3,
    write_result_to_s3,
)
from .sdk_config import CLIENT_NAME, LOCAL_ROOT, parse_model_id_with_thinking
from .sdk_runner import (
    check_sdk_available,
    format_sse_event,
    get_run,
    has_active_run,
    request_stop,
    run_claude_sdk,
    stream_claude_sdk,
)
from .trace_parser import parse_trace_content_to_messages
from .workspace import (
    cleanup_session_files,
    ensure_directories,
    get_active_conversation,
    get_workspace_files,
    get_workspace_paths,
    set_active_agent_id,
    set_active_conversation,
)

logger = structlog.get_logger()

logger.info("numa-workspace-agent module loading", version="0.5.0")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """App lifecycle hook.

    Starts the in-container Numa Standard Model proxy (localhost:4100) as a
    daemon thread at startup, so the Claude SDK can reach the opaque
    non-Anthropic model via ANTHROPIC_BASE_URL the moment a request selects it.
    The proxy binds loopback only and forwards (translated to OpenAI Chat
    Completions, STS-proof authed) to the deployer-account relay. Mirrors the
    existing localhost-only /internal/* endpoints' in-container HTTP model.

    Starting it here (rather than lazily per request) means the first
    standard-model turn doesn't pay the ~uvicorn-startup latency, and a startup
    failure is visible immediately in the container logs. `ensure_running` is
    idempotent and failure-tolerant (it still binds even if the relay URL is
    unset), so it never blocks the agent from serving Anthropic traffic.
    """
    try:
        from .bedrock_mantle_proxy import ensure_running

        await ensure_running(region=os.environ.get("AWS_REGION", "us-east-1"))
    except Exception as e:  # never let proxy startup take down the whole app
        logger.error(
            "Standard-model proxy failed to start at app startup",
            _name="STANDARD_PROXY_BOOT_ERROR",
            error=str(e),
            error_type=type(e).__name__,
        )
    yield


app = FastAPI(
    title="Numa Workspace Agent",
    description="AgentCore-based workspace agent with Claude Agent SDK",
    version="0.5.0",
    lifespan=_lifespan,
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


# ── Per-conversation approval-event queue ────────────────────────────────────
# Populated by POST /internal/emit-approval (called by `numa` CLI subprocesses
# in workspace-IAM mode). Drained by the active stream_with_sync() generator
# interleaved with SDK events. One slot per active conversation; the SSE
# generator unregisters on completion.
_approval_queues: dict[str, asyncio.Queue[dict]] = {}
_approval_queues_lock = asyncio.Lock()


async def register_approval_queue(cid: str) -> asyncio.Queue[dict]:
    async with _approval_queues_lock:
        q = _approval_queues.get(cid)
        if q is None:
            q = asyncio.Queue(maxsize=64)
            _approval_queues[cid] = q
        return q


async def unregister_approval_queue(cid: str) -> None:
    async with _approval_queues_lock:
        _approval_queues.pop(cid, None)


async def get_approval_queue(cid: str) -> "asyncio.Queue[dict] | None":
    async with _approval_queues_lock:
        return _approval_queues.get(cid)


@app.post("/internal/emit-approval")
async def emit_approval(request: Request):
    """CLI-driven HITL approval emission. Localhost-only.

    The @numa/cli binary inside the MicroVM POSTs here when it detects a
    write-op. The agent pushes the event onto the active conversation's
    asyncio.Queue; the SSE stream drains it (interleaved with SDK events)
    and flushes through AgentCore's transport buffer.
    """
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="localhost only")

    body = await request.json()
    cid = body.get("conversation_id")
    rid = body.get("request_id")
    tuid = body.get("tool_use_id")
    if not (cid and rid and tuid):
        raise HTTPException(status_code=400, detail="missing required fields")

    q = await get_approval_queue(cid)
    if q is None:
        raise HTTPException(status_code=409, detail="no active stream for conversation")

    event = {
        "type": "tool_approval",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "created_at": int(time.time()),
        "tool_use_id": tuid,
        "tool_name": body.get("tool_name", "numa_cli"),
        "action_key": body.get("action_key", ""),
        "description": body.get("description", ""),
        "props_preview": body.get("props_preview", {}),
        "request_id": rid,
        "auto_approved": False,
        "approval_category": body.get("approval_category", "numa_tool"),
        "parent_tool_use_id": body.get("parent_tool_use_id"),
    }

    try:
        q.put_nowait(event)
    except asyncio.QueueFull:
        raise HTTPException(status_code=503, detail="approval queue full")

    return {"status": "queued"}


@app.post("/internal/emit-render")
async def emit_render(request: Request):
    """CLI-driven inline render emission. Localhost-only.

    The `numa render` CLI command POSTs here to display HTML/SVG/image content
    inline in the chat. Render is not a data call — it pushes a `tool_render`
    event onto the active conversation's queue, drained by the SSE stream (the
    SAME rail as HITL approvals). The frontend renders it via RenderToolRenderer.
    Only works while a stream is active (streaming agent types); non-streaming
    runs have no queue drained, so the CLI gets a 409.
    """
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="localhost only")

    body = await request.json()
    cid = body.get("conversation_id")
    tuid = body.get("tool_use_id")
    render_type = body.get("render_type")
    content = body.get("content")
    file_path = body.get("file_path")
    if not (cid and tuid and render_type):
        raise HTTPException(status_code=400, detail="missing required fields")
    if not (content or file_path):
        raise HTTPException(status_code=400, detail="content or file_path required")

    q = await get_approval_queue(cid)
    if q is None:
        raise HTTPException(status_code=409, detail="no active stream for conversation")

    event = {
        "type": "tool_render",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "tool_use_id": tuid,
        "render_type": render_type,
        "content": content or "",
        "title": body.get("title"),
        "height": body.get("height", 400),
        "mime_type": body.get("mime_type"),
        "file_path": file_path,
    }

    try:
        q.put_nowait(event)
    except asyncio.QueueFull:
        raise HTTPException(status_code=503, detail="render queue full")

    return {"status": "queued"}


# Note: Hooks removed - using absolute paths directly now
# The path_transformer.py hook is no longer needed since we use absolute paths like /chat-workflows/

# Store checksums for change detection between requests
_checksums_cache: dict[str, FileChecksum] = {}

# Default S3 prefix template from AgentTypeConfig (used to detect custom prefixes)
_DEFAULT_S3_PREFIX_TEMPLATE = (
    "numa-chat/workspace/{user_sub}/conversations/{conversation_id}"
)


def _normalise_integrations_payload(
    body: dict,
) -> tuple[list[dict], list[dict]]:
    """Soft-window adapter for the integrations chat payload.

    Returns ``(enabled, available)`` where each item is
    ``{"slug": str, "method": "pipedream"|"native", "name": str}``.

    Accepts BOTH:
    * **New shape** — ``enabledIntegrations`` / ``availableIntegrations`` as
      ``list[{slug, method, name}]``. Method-tagged at the source.
    * **Legacy shape** — ``enabledConnections`` (Pipedream slugs, list[str]),
      ``availableIntegrations`` (Pipedream items, list[{id, name}]),
      ``connectedDataConnectors`` / ``availableDataConnectors`` (native items,
      list[{id, name}]).

    The legacy four-field payload is detected when ``availableIntegrations``
    items lack a ``method`` field. We can drop this branch after one release.
    """

    def _is_new_shape(items: list) -> bool:
        return bool(items) and isinstance(items[0], dict) and "method" in items[0]

    enabled_new = body.get("enabledIntegrations") or []
    available_new = body.get("availableIntegrations") or []

    new_shape = _is_new_shape(enabled_new) or _is_new_shape(available_new)

    def _normalise_item(it: object) -> Optional[dict]:
        if not isinstance(it, dict):
            return None
        slug = it.get("slug") or it.get("id") or ""
        if not slug:
            return None
        method = it.get("method")
        if method not in ("pipedream", "native"):
            method = "pipedream"
        # isFileStore: forwarded from the frontend (camelCase on the wire,
        # snake_case once normalised). Optional — absent on legacy payloads
        # and on payloads built before the field was added; the prompt
        # builder falls back to a slug allowlist in that case.
        is_file_store = it.get("isFileStore")
        if is_file_store is None:
            is_file_store = it.get("is_file_store")
        # FEAT-019: per-conversation account scope for Pipedream integrations.
        # account_ids is a strict subset of the user's connected accounts for
        # this app. Absent / empty list means "all of the user's connected
        # accounts are eligible" — legacy behaviour. account_names is a
        # display-name map keyed by account id, used by the prompt builder so
        # the model can name the active accounts in responses.
        raw_account_ids = it.get("accountIds")
        if raw_account_ids is None:
            raw_account_ids = it.get("account_ids")
        account_ids: Optional[list[str]] = None
        if isinstance(raw_account_ids, list):
            account_ids = [x for x in raw_account_ids if isinstance(x, str) and x]
        raw_account_names = it.get("accountNames")
        if raw_account_names is None:
            raw_account_names = it.get("account_names")
        account_names: Optional[dict[str, str]] = None
        if isinstance(raw_account_names, dict):
            account_names = {
                str(k): str(v)
                for k, v in raw_account_names.items()
                if isinstance(k, str) and isinstance(v, str)
            }
        # FEAT-019: informational full account list (NOT an allow-list). Sent
        # by the FE for every multi-account Pipedream integration so the agent
        # prompt can list them with their apn_xxx ids — the model needs the
        # ids to target a specific account via explicit `authProvisionId`
        # rather than relying on the proxy's first-match `auto` resolution.
        raw_available = it.get("availableAccounts")
        if raw_available is None:
            raw_available = it.get("available_accounts")
        available_accounts: Optional[list[dict]] = None
        if isinstance(raw_available, list):
            available_accounts = []
            for entry in raw_available:
                if not isinstance(entry, dict):
                    continue
                acc_id = entry.get("account_id") or entry.get("accountId")
                if not isinstance(acc_id, str) or not acc_id:
                    continue
                name = entry.get("name")
                available_accounts.append(
                    {
                        "account_id": acc_id,
                        "name": str(name) if isinstance(name, str) else None,
                    }
                )
        return {
            "slug": slug,
            "method": method,
            "name": it.get("name") or slug,
            "is_file_store": bool(is_file_store) if is_file_store is not None else None,
            "account_ids": account_ids,
            "account_names": account_names,
            "available_accounts": available_accounts,
        }

    # FEAT-019: per-app account scope can also arrive as a top-level
    # `selectedAccountsByApp` dict (Pipedream slug → list of accountIds).
    # The V2 apps run config sends this shape because the chat-picker state
    # is naturally keyed by app, not per-integration row. Merge it onto the
    # normalised rows so the env-var plumbing in sdk_config sees a uniform
    # shape regardless of producer.
    raw_selected_map = body.get("selectedAccountsByApp")
    selected_map: dict[str, list[str]] = {}
    if isinstance(raw_selected_map, dict):
        for k, v in raw_selected_map.items():
            if not isinstance(k, str) or not isinstance(v, list):
                continue
            selected_map[k] = [x for x in v if isinstance(x, str) and x]

    def _apply_selected_map(rows: list[dict]) -> list[dict]:
        if not selected_map:
            return rows
        for r in rows:
            if r.get("method") != "pipedream":
                continue
            slug = r.get("slug")
            if (
                isinstance(slug, str)
                and slug in selected_map
                and not r.get("account_ids")
            ):
                r["account_ids"] = list(selected_map[slug])
        return rows

    if new_shape:
        enabled = [x for x in (_normalise_item(it) for it in enabled_new) if x]
        available = [x for x in (_normalise_item(it) for it in available_new) if x]
        _apply_selected_map(enabled)
        return enabled, available

    # Legacy: stitch four separate fields back into the unified shape.
    raw_enabled_slugs = body.get("enabledConnections") or []
    raw_available = body.get("availableIntegrations") or []  # Pipedream
    raw_connected_dc = body.get("connectedDataConnectors") or []
    raw_available_dc = body.get("availableDataConnectors") or []

    enabled: list[dict] = []
    for s in raw_enabled_slugs:
        if isinstance(s, str) and s:
            enabled.append({"slug": s, "method": "pipedream", "name": s})
    for it in raw_connected_dc:
        if isinstance(it, dict) and it.get("id"):
            enabled.append(
                {
                    "slug": it["id"],
                    "method": "native",
                    "name": it.get("name") or it["id"],
                }
            )

    available: list[dict] = []
    for it in raw_available:
        if isinstance(it, dict) and it.get("id"):
            available.append(
                {
                    "slug": it["id"],
                    "method": "pipedream",
                    "name": it.get("name") or it["id"],
                }
            )
    for it in raw_available_dc:
        if isinstance(it, dict) and it.get("id"):
            available.append(
                {
                    "slug": it["id"],
                    "method": "native",
                    "name": it.get("name") or it["id"],
                }
            )

    # FEAT-019: same selectedAccountsByApp merge for legacy-shape payloads.
    _apply_selected_map(enabled)
    return enabled, available


def _resolve_s3_prefix(
    agent_type_config: Optional[AgentTypeConfig],
    user_sub: str,
    conversation_id: str,
) -> str | None:
    """Resolve a custom S3 prefix from the agent type config.

    Returns the formatted S3 prefix string if the agent type uses a custom
    ``s3_prefix_template`` (i.e. different from the default chat workspace path).
    Returns ``None`` if the default prefix should be used.

    This allows V2 apps to store workspace files under their own S3 paths
    (e.g. ``v2-apps/data-analysis/{user_sub}/{runId}``) while chat conversations
    continue using the default ``numa-chat/workspace/...`` path.
    """
    if not agent_type_config:
        return None
    template = agent_type_config.s3_prefix_template
    if template == _DEFAULT_S3_PREFIX_TEMPLATE:
        return None
    return template.format(user_sub=user_sub, conversation_id=conversation_id)


def _maybe_add_synergy_kb(
    available_kbs: list[dict] | None,
    feature_flags: dict | None,
    restrict_kbs: bool,
) -> list[dict] | None:
    """Make the cross-job Synergy KB available to the agent when the feature is on.

    Synergy cross-job search is a capability of the assistant, not a Numa Files
    folder the user toggles per conversation. So whenever ``SYNERGY`` is
    on we add the ``synergy`` KB to the queryable set (it flows into
    ``NUMA_ALLOWED_KBS`` and ``build_kb_context``) regardless of the user's folder
    selection — otherwise a fresh conversation sends no KBs and the agent is
    fail-closed denied from ever querying it. Skipped for ``restrict_kbs`` agent
    types (locked-down pipelines), which only get their explicit ``default_kbs``.
    """
    if restrict_kbs:
        return available_kbs
    if not (feature_flags or {}).get("SYNERGY"):
        return available_kbs
    kbs = list(available_kbs or [])
    if any(kb.get("id") == "synergy" for kb in kbs):
        return kbs
    kbs.append({"id": "synergy", "name": "Synergy (all jobs)"})
    return kbs


# NOTE: per-folder file listings are no longer injected into the system prompt
# (BUG-375). The agent finds files by searching/traversing folders on demand, so
# the old `_fetch_kb_listings` / `_get_cached_kb_listings` machinery (and its S3
# round-trip on every cold start) was removed. `build_kb_context` now renders
# folder headers only.


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
                        "outputsCount": 0,
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
                    "outputsCount": 0,
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
                    "outputsCount": 0,
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
    List files in a conversation's uploads/ and outputs/ directories from S3.

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
    """List files in /workdir/outputs/ and /workdir/uploads/ from the local filesystem."""
    files = []
    for subdir in ("outputs", "uploads"):
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

    Query param ``path`` is relative to /workdir (e.g. ``outputs/result.json``).
    Rejects paths containing ``..`` to prevent traversal.
    """
    if ".." in path:
        raise HTTPException(status_code=400, detail="Invalid path")

    file_path = (LOCAL_ROOT / path).resolve()
    if not str(file_path).startswith(str(LOCAL_ROOT.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # Only text-decode when we actually need text (.json pretty-print). For any
    # other file, serve the raw bytes verbatim so arbitrary /workdir files
    # (including binaries) download uncorrupted — never lossy-decode them.
    if file_path.suffix == ".json":
        text = file_path.read_text(errors="replace")
        try:
            return JSONResponse(content=json.loads(text))
        except json.JSONDecodeError:
            return Response(content=text, media_type="text/plain")

    raw = file_path.read_bytes()
    media_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    return Response(content=raw, media_type=media_type)


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
                        "outputsCount": 0,
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
                    "outputsCount": 0,
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
                    "outputsCount": 0,
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


async def _handle_run_status(
    user_sub: str,
    run_id: str,
    s3_prefix: str | None = None,
) -> JSONResponse:
    """Handle /runs/{run_id}/status — poll for fire-and-forget result.

    Checks S3 for a ``_result.json`` written by :func:`_handle_fire_and_forget`.
    Returns ``{"status": "running"}`` if the file does not exist yet, or the
    full result payload if the run has completed (or errored).

    Args:
        user_sub: Cognito user sub.
        run_id: The run/conversation ID to poll.
        s3_prefix: Optional custom S3 prefix template (with ``{user_sub}``
            and ``{conversation_id}`` placeholders). When provided, looks for
            ``_result.json`` under this prefix instead of the default chat
            workspace path. Used by V2 apps.
    """
    logger.debug(
        "Polling run status",
        phase="request",
        user_sub=user_sub,
        run_id=run_id,
        s3_prefix=s3_prefix or "default",
    )

    result = read_result_from_s3(user_sub, run_id, s3_prefix=s3_prefix)

    if result is None:
        # No result yet — check for progress events and in-memory active runs
        progress = read_progress_from_s3(user_sub, run_id, s3_prefix=s3_prefix)
        is_active = await has_active_run(user_sub, run_id)
        response: dict[str, Any] = {
            "status": "running",
            "run_id": run_id,
            "active": is_active,
        }
        if progress and progress.get("events"):
            response["events"] = progress["events"]
        return JSONResponse(content=response)

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


def _build_workspace_error_payload(e: OSError) -> dict[str, Any]:
    """Build a structured error payload for an OS-level workspace error.

    Adds a friendly, actionable prefix when the disk is full (ENOSPC = 28).
    AgentCore container disk is fixed and not configurable, so users hit this
    on conversations that have accumulated large files across turns.
    """
    is_disk_full = getattr(e, "errno", None) == errno.ENOSPC
    if is_disk_full:
        message = (
            f"Workspace storage is full ({e}). "
            "Free space by deleting files in the workspace settings panel "
            "(uploads/outputs tabs), or start a new conversation."
        )
    else:
        message = f"Workspace I/O error: {e}"
    return {
        "type": "error",
        "error": message,
        "error_type": type(e).__name__,
        "errno": getattr(e, "errno", None),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# Safety margin reserved on top of an incoming write's size before we allow it.
# The container filesystem is fixed and shared (uploads, outputs, tool scripts,
# trace.jsonl, temp files written mid-request), so leave headroom rather than
# filling /workdir to the byte. 100 MB matches the margin called out in the
# reactive ENOSPC handling notes above.
WORKSPACE_FREE_SPACE_MARGIN_BYTES = 100 * 1024 * 1024

# Hard cap on a single browser-uploaded file, mirroring the 500 MB limit the
# frontend enforces in WorkspaceChatFileUpload.tsx. Enforced server-side so a
# crafted/bypassed request can't push an arbitrarily large object into the
# workspace.
MAX_UPLOAD_BYTES = 500 * 1024 * 1024


def get_workspace_free_bytes() -> Optional[int]:
    """Return the number of free bytes available on the /workdir filesystem.

    Uses ``os.statvfs`` (``f_bavail`` blocks available to a non-privileged
    process × ``f_frsize`` fragment size). Returns ``None`` if the stat fails
    (e.g. the path doesn't exist yet in a local/test environment) so callers
    can treat "unknown" as "don't block" and fall back to the reactive ENOSPC
    backstop rather than spuriously rejecting a write.
    """
    try:
        stat = os.statvfs(str(LOCAL_ROOT))
    except OSError as e:
        logger.warning(
            "Could not stat workspace filesystem for free-space check",
            _name="WORKSPACE_STATVFS_FAILED",
            phase="upload",
            error=str(e),
        )
        return None
    return stat.f_bavail * stat.f_frsize


def _format_bytes(n: int) -> str:
    """Human-readable byte size for error messages (e.g. ``512.0 MB``)."""
    value = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} TB"


def _build_workspace_quota_error_payload(
    *, needed_bytes: int, free_bytes: int
) -> dict[str, Any]:
    """Structured error for a proactive (pre-write) disk-full rejection.

    Mirrors the shape/style of :func:`_build_workspace_error_payload` (the
    reactive ENOSPC envelope) so the frontend's existing SSE/JSON error handler
    renders it identically. ``errno`` is set to ENOSPC so existing log filters
    and client-side handling that key off the disk-full errno keep working.
    """
    message = (
        f"Workspace disk full: needs {_format_bytes(needed_bytes)}, "
        f"has {_format_bytes(free_bytes)}. "
        "Delete files in the workspace settings panel (uploads/outputs tabs) "
        "to free space, or start a new conversation."
    )
    return {
        "type": "error",
        "error": message,
        "error_type": "OSError",
        "errno": errno.ENOSPC,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _ensure_workspace_has_room(needed_bytes: int) -> Optional[dict[str, Any]]:
    """Proactively check /workdir has room for an incoming ``needed_bytes`` write.

    Returns ``None`` when the write is safe to proceed (or when free space can't
    be determined — see :func:`get_workspace_free_bytes`). When there isn't
    enough room (free space < ``needed_bytes`` + safety margin) returns a
    structured quota-error payload so the caller can surface a clean error
    instead of letting the write fail mid-stream with ENOSPC.
    """
    if needed_bytes <= 0:
        return None
    free_bytes = get_workspace_free_bytes()
    if free_bytes is None:
        # Unknown free space — defer to the reactive ENOSPC backstop.
        return None
    required = needed_bytes + WORKSPACE_FREE_SPACE_MARGIN_BYTES
    if free_bytes >= required:
        return None
    logger.warning(
        "Rejecting write: insufficient workspace free space",
        _name="WORKSPACE_DISK_FULL_PROACTIVE",
        phase="upload",
        needed_bytes=needed_bytes,
        margin_bytes=WORKSPACE_FREE_SPACE_MARGIN_BYTES,
        free_bytes=free_bytes,
    )
    return _build_workspace_quota_error_payload(
        needed_bytes=required, free_bytes=free_bytes
    )


def _s3_prefix_total_bytes(s3_prefix: str) -> Optional[int]:
    """Sum ``ContentLength`` over every object under ``s3_prefix`` in OUTPUTS_BUCKET.

    Used by the cold-start sync guard to learn the incoming download size before
    ``sync_from_s3`` starts writing. Returns ``None`` (treat as "unknown" → don't
    block) if the bucket isn't configured or the listing fails, so a transient S3
    error never blocks a normal sync — the reactive ENOSPC handler is the
    backstop. ``list_objects_v2`` already returns sizes, so this adds no
    per-object HEAD calls.
    """
    from .s3_workspace import OUTPUTS_BUCKET

    if not OUTPUTS_BUCKET:
        return None
    try:
        s3 = boto3.client("s3")
        paginator = s3.get_paginator("list_objects_v2")
        total = 0
        for page in paginator.paginate(
            Bucket=OUTPUTS_BUCKET, Prefix=f"{s3_prefix.rstrip('/')}/"
        ):
            for obj in page.get("Contents", []):
                total += obj.get("Size", 0)
        return total
    except Exception as e:  # noqa: BLE001 - best-effort; never block sync on this
        logger.warning(
            "Could not compute S3 prefix size for cold-start disk guard",
            _name="COLD_START_SIZE_CHECK_FAILED",
            phase="sync",
            error=str(e),
        )
        return None


def _workspace_error_envelope_response(
    payload: dict[str, Any], *, body: dict[str, Any], agent_type_config: Any
) -> Response:
    """Wrap a workspace error envelope in the response shape the client expects.

    Always returns HTTP 200 so AgentCore doesn't wrap it as a generic
    RuntimeClientError 500. Mirrors the response-mode resolution used by the chat
    dispatch below so the client gets back a shape it knows how to parse: a
    streaming chat request gets a single SSE error event; everything else gets
    JSON. Used by both the OSError setup handler and the proactive disk guard so
    they emit identical shapes.
    """
    action = body.get("action", "chat")
    request_mode = body.get("responseMode")
    type_default = getattr(agent_type_config, "response_mode", "stream")
    if request_mode:
        effective_mode = request_mode
    elif type_default != "stream":
        effective_mode = type_default
    else:
        effective_mode = "stream"

    if action == "chat" and effective_mode == "stream":

        async def _single_error_stream():
            yield format_sse_event(payload)

        return StreamingResponse(_single_error_stream(), media_type="text/event-stream")

    # Sync / fire-and-forget / non-chat actions get JSON
    return JSONResponse(content={"status": "error", **payload})


def _workspace_setup_error_response(
    e: OSError, *, body: dict[str, Any], agent_type_config: Any
) -> Response:
    """Return a structured response for an OSError during workspace setup.

    Always returns HTTP 200 so AgentCore doesn't wrap it as a generic
    RuntimeClientError 500. The frontend's existing SSE error handler
    renders the `error` field cleanly.
    """
    payload = _build_workspace_error_payload(e)
    logger.error(
        "Workspace setup failed",
        _name="WORKSPACE_SETUP_ERROR",
        phase="request",
        errno=payload.get("errno"),
        error=str(e),
    )
    return _workspace_error_envelope_response(
        payload, body=body, agent_type_config=agent_type_config
    )


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
            # Extract s3Prefix from body if the proxy forwarded it
            s3_prefix_param = body.get("s3Prefix") if isinstance(body, dict) else None
            return await _handle_run_status(user_sub, run_id, s3_prefix=s3_prefix_param)
        elif http_path == "/types":
            return await _handle_list_types()
    else:
        # Direct payload format
        body = raw_body

    action = body.get("action", "chat")
    user_sub = _extract_user_sub(request, payload_headers)
    conversation_id = body.get("conversationId") or str(uuid.uuid4())
    user_email = body.get("userEmail", "unknown")
    # FEAT-243 — capture the agent scope for this request before any S3 sync, so
    # the agent-workflows library (per-user-per-agent) is synced + injected.
    # MicroVMs are conversation-pinned, so this is stable for the container life.
    set_active_agent_id(body.get("agentId"))

    # Pull the raw Cognito JWT (already signature-verified by the proxy). Downstream
    # tools that hit identity-aware AWS services — currently Q Business via
    # AssumeRoleWithWebIdentity — need the original token, not just the sub claim.
    auth_header = (payload_headers or {}).get("authorization") or request.headers.get(
        "authorization", ""
    )
    id_token = auth_header[7:] if auth_header.startswith("Bearer ") else ""
    if id_token and user_email in ("", "unknown"):
        try:
            jwt_payload = id_token.split(".")[1]
            padding = 4 - len(jwt_payload) % 4
            if padding != 4:
                jwt_payload += "=" * padding
            user_email = (
                json.loads(base64.urlsafe_b64decode(jwt_payload)).get("email")
                or user_email
            )
        except Exception:
            pass

    # Resolve agent type config (defaults to "numa-chat")
    agent_type_id = body.get("type", "numa-chat")
    agent_type_config = get_agent_type_config(agent_type_id)

    # Export user context to environment for tools (they read from env vars)
    os.environ["NUMA_USER_SUB"] = user_sub or "unknown"
    os.environ["NUMA_USER_EMAIL"] = user_email or ""
    os.environ["NUMA_USER_ID_TOKEN"] = id_token
    os.environ["NUMA_CONVERSATION_ID"] = conversation_id

    # Identity credential the numa CLI presents to numa-cli-api. The proxy sets
    # x-numa-identity-token: the user's Cognito id token for interactive chat,
    # or a signed service token for non-interactive runs (which have no user
    # token). Fall back to the raw id token for local/direct invocations that
    # bypass the proxy. Distinct from NUMA_USER_ID_TOKEN, which stays the real
    # Cognito id token used for Q Business AssumeRoleWithWebIdentity.
    identity_token = (payload_headers or {}).get("x-numa-identity-token") or id_token
    os.environ["NUMA_IDENTITY_TOKEN"] = identity_token

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

    # Mirror the active run to DynamoDB as EARLY as possible — before cold-start
    # sync and the parallel data loads — so that returning to a conversation
    # DURING workspace setup (which can take ~10s) still detects the run as
    # active and shows the "running in background" banner instead of a load
    # error (BUG-140). register_run later starts the 60s heartbeat that keeps
    # this fresh during streaming, and pop_run clears it on completion. If the
    # request fails before register_run, this single write has no heartbeat and
    # goes stale within ACTIVE_RUN_STALE_SECONDS, so the proxy stops reporting
    # it as active — no leak. Best-effort: upsert_active_run swallows errors.
    if action == "chat":
        _early_request_id = body.get("requestId")
        if _early_request_id:
            await asyncio.to_thread(
                upsert_active_run, user_sub, conversation_id, _early_request_id
            )

    # Check for cold start
    cold_start = is_cold_start()
    if cold_start:
        resolved_prefix = _resolve_s3_prefix(
            agent_type_config, user_sub, conversation_id
        )
        logger.info(
            "Cold start detected, syncing from S3",
            s3_prefix=resolved_prefix or "default",
        )

        # Proactive /workdir disk guard: a conversation can accumulate multi-GB
        # of files across turns. On cold start we re-download all of them into
        # the fixed-size container disk. If the incoming total won't fit, reject
        # up front with an actionable error instead of letting sync_from_s3 fail
        # mid-stream with ENOSPC (which leaves a half-synced workspace). The
        # reactive ENOSPC handler below remains the backstop for the unknown /
        # mid-request-growth cases.
        # When resolved_prefix is None, sync_from_s3 pulls from the default
        # conversation prefix — mirror that path here (reusing s3_workspace's
        # S3_PREFIX constant) so the size estimate matches what actually gets
        # written and the two stay in lockstep if the prefix ever changes.
        from .s3_workspace import S3_PREFIX as _DEFAULT_WS_PREFIX

        cold_start_prefix = resolved_prefix or (
            f"{_DEFAULT_WS_PREFIX}/{user_sub}/conversations/{conversation_id}"
        )
        incoming_bytes = _s3_prefix_total_bytes(cold_start_prefix)
        if incoming_bytes is not None:
            quota_error = _ensure_workspace_has_room(incoming_bytes)
            if quota_error is not None:
                logger.error(
                    "Cold start sync would exceed workspace disk",
                    _name="COLD_START_DISK_FULL",
                    phase="sync",
                    conversation_id=conversation_id,
                    incoming_bytes=incoming_bytes,
                )
                return _workspace_error_envelope_response(
                    quota_error, body=body, agent_type_config=agent_type_config
                )

        sync_result = sync_from_s3(user_sub, conversation_id, s3_prefix=resolved_prefix)
        logger.info(
            "Cold start sync complete",
            files_downloaded=sync_result["files_downloaded"],
            errors=len(sync_result["errors"]),
        )

    # Ensure directories exist.
    # If the workspace filesystem is full or otherwise unwritable, surface the
    # OS error as a structured response (HTTP 200) rather than letting it
    # propagate as an uncaught exception → AgentCore RuntimeClientError 500.
    # The most common case is ENOSPC after a conversation processed multi-GB
    # files; the user has no recourse from a raw RuntimeClientError 500.
    try:
        ensure_directories()
    except OSError as e:
        return _workspace_setup_error_response(
            e, body=body, agent_type_config=agent_type_config
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
                # Agent type wants non-stream — use the type's default.
                # In production the proxy always sends responseMode, but
                # for local testing / direct calls honour the type config.
                effective_mode = type_default
            else:
                effective_mode = "stream"

            # Pipeline/orchestrator types cannot stream — streaming a multi-step
            # pipeline is confusing (which step's tokens are you seeing?). Fall
            # back to sync so the pipeline runs to completion and returns a
            # single result.
            if effective_mode == "stream" and (
                agent_type_config.pipeline_steps
                or agent_type_config.pipeline_orchestrator
            ):
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
            resolved_prefix = _resolve_s3_prefix(
                agent_type_config, user_sub, conversation_id
            )
            sync_to_s3(
                user_sub, conversation_id, _checksums_cache, s3_prefix=resolved_prefix
            )


def _write_schemas_to_disk(
    app_slug: str,
    actions: list[dict],
    index: list[dict],
    tools_dir: Path,
) -> None:
    """Write action schemas and index to disk in the expected format.

    Creates /workdir/tools/integrations/{app_slug}/ with:
    - _index.json: compact action summaries
    - {key}.json: full action schema per action
    """
    app_dir = tools_dir / app_slug
    app_dir.mkdir(parents=True, exist_ok=True)

    # Write individual action files
    for action in actions:
        key = action.get("key", action.get("name_slug", "unknown"))
        action_filename = key.replace("/", "_") + ".json"
        atomic_write_text(
            json.dumps(action, indent=2, default=str), app_dir / action_filename
        )

    # Write index (use pre-built index if available, otherwise build from actions)
    if not index:
        index = []
        for action in actions:
            key = action.get("key", "")
            index.append(
                {
                    "key": key,
                    "name": action.get("name", key),
                    "description": (action.get("description") or "")[:200],
                    "annotations": action.get("annotations", {}),
                    "prop_count": len(action.get("configurable_props", [])),
                    "file": key.replace("/", "_") + ".json",
                }
            )

    atomic_write_text(json.dumps(index, indent=2), app_dir / "_index.json")


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

        result = payload.get("result", {})
        actions = result.get("actions", [])
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
            atomic_write_text(
                json.dumps(action, indent=2, default=str), app_dir / action_filename
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
        atomic_write_text(json.dumps(index_entries, indent=2), index_file)

        # Write denied tools metadata if present (from relay policy filtering)
        denied_tools = result.get("denied_tools", [])
        denied_file = app_dir / "_denied_tools.json"
        if denied_tools:
            atomic_write_text(json.dumps(denied_tools, indent=2), denied_file)
        elif denied_file.exists():
            denied_file.unlink()

        logger.info(
            "Downloaded integration schemas",
            app_slug=app_slug,
            action_count=len(index_entries),
            denied_tools_count=len(denied_tools),
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

    # Download new integrations -- try batch endpoint first, fall back to per-slug
    added = []
    if to_download:
        lambda_name = os.environ.get("WORKSPACE_TOOLS_LAMBDA_NAME", "")
        if not lambda_name:
            logger.warning("No WORKSPACE_TOOLS_LAMBDA_NAME, skipping schema download")
            return {"added": [], "removed": list(to_remove), "cached": list(cached)}

        lambda_client = boto3.client(
            "lambda", region_name=os.environ.get("AWS_REGION", "us-east-1")
        )

        batch_remaining = set(to_download)

        # Try batch endpoint (single call for all slugs via DynamoDB cache)
        try:
            batch_event = {
                "tool": "pipedream_batch_get_schemas",
                "allowed_tools": list(to_download),
                "params": {
                    "app_slugs": list(to_download),
                    "external_user_id": external_user_id,
                },
            }
            batch_response = lambda_client.invoke(
                FunctionName=lambda_name,
                Payload=json.dumps(batch_event),
                InvocationType="RequestResponse",
            )
            batch_payload = json.loads(batch_response["Payload"].read())

            if batch_payload.get("status") == "success":
                batch_result = batch_payload.get("result", {})
                schemas = batch_result.get("schemas", {})
                denied_by_app = batch_result.get("denied_tools_by_app", {})
                for slug, schema_data in schemas.items():
                    actions = schema_data.get("actions", [])
                    index = schema_data.get("index", [])
                    if actions:
                        _write_schemas_to_disk(slug, actions, index, tools_dir)
                        added.append(slug)
                        batch_remaining.discard(slug)

                        # Write denied tools metadata from batch response
                        denied_tools = denied_by_app.get(slug, [])
                        denied_file = tools_dir / slug / "_denied_tools.json"
                        if denied_tools:
                            atomic_write_text(
                                json.dumps(denied_tools, indent=2), denied_file
                            )
                        elif denied_file.exists():
                            denied_file.unlink()

                if schemas:
                    logger.info(
                        "Batch schema load from cache",
                        _name="BATCH_SCHEMA_LOAD",
                        phase="integrations",
                        loaded=list(schemas.keys()),
                        remaining=list(batch_remaining),
                        denied_tools_by_app=denied_by_app,
                    )
        except Exception as e:
            logger.warning(
                "Batch schema load failed, falling back to per-slug",
                error=str(e),
            )

        # Fall back to per-slug download for any missing from batch
        for slug in batch_remaining:
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

    # Clear per-request caches so user settings changes take effect immediately
    clear_user_settings_cache()

    # Resolve agent type config (default to numa-chat if not provided)
    if agent_type_config is None:
        agent_type_config = get_agent_type_config("numa-chat")

    prompt = (body.get("prompt") or "").strip()
    voice_recordings = body.get(
        "voiceRecordings", []
    )  # Paths to voice recordings for auto-transcription
    if not prompt and not voice_recordings:
        raise HTTPException(status_code=400, detail="Missing prompt")

    feature_flags = body.get("featureFlags", {})
    timezone = body.get("timezone")
    user_email = body.get("userEmail")
    today_string = body.get("todayString")
    available_kbs = body.get("availableKBs")  # List of {id, name} for KB tool
    accessible_kbs = body.get(
        "accessibleKBs"
    )  # All folders the user can toggle for this chat (informational; not queryable unless also in availableKBs)
    enabled_tools = body.get(
        "enabledTools", []
    )  # List of enabled tool names (e.g., ["web_search"])

    # Apply agent type restrictions on KBs
    if agent_type_config.restrict_kbs:
        available_kbs = agent_type_config.default_kbs or []
        # Restricted agent types should not advertise folders the user cannot enable here
        accessible_kbs = available_kbs
    elif agent_type_config.default_kbs and not available_kbs:
        available_kbs = agent_type_config.default_kbs

    # Cross-job Synergy search: make the synergy KB queryable + advertised when
    # the feature flag is on, independent of the user's per-conversation folders.
    available_kbs = _maybe_add_synergy_kb(
        available_kbs, feature_flags, agent_type_config.restrict_kbs
    )

    # Attachment handling - now supports both files and folders
    # Frontend sends: {files: [{path, filename, size}], folders?: [{name, path, fileCount, totalSize}]}
    attachments_data = body.get("attachments")
    attached_files = attachments_data.get("files", []) if attachments_data else []
    attached_folders = attachments_data.get("folders", []) if attachments_data else []
    has_uploads = body.get("hasUploads", False)
    expected_upload_paths = body.get("expectedUploadPaths", [])

    # Model selection (global cross-region inference profile).
    # Frontend may send a composite ID like "anthropic.claude-sonnet-4-6@high-thinking"
    # which encodes a thinking-preset suffix. Split it here so the bare ID flows
    # through validate_model_id() unchanged and the preset is threaded to the runner.
    raw_model_id = body.get("modelId")
    model_id, thinking_override = parse_model_id_with_thinking(raw_model_id)
    if thinking_override:
        logger.info(
            "Thinking override selected",
            _name="MODEL_THINKING_OVERRIDE",
            phase="request",
            raw_model_id=raw_model_id,
            bare_model_id=model_id,
            thinking_override=thinking_override,
        )
    request_id = body.get("requestId") or str(uuid.uuid4())

    # Unified integrations payload — `enabled_unified` / `available_unified`
    # are list[{slug, method, name}]. The adapter accepts both the new shape
    # and the legacy four-field payload (enabledConnections + availableIntegrations
    # + connectedDataConnectors + availableDataConnectors).
    enabled_unified, available_unified = _normalise_integrations_payload(body)

    # Derived Pipedream-only slug list. Used internally for schema sync,
    # external_user_id, enabled_tools tagging — those paths remain Pipedream-
    # specific because they're tied to the Pipedream relay/proxy.
    enabled_integrations = [
        it["slug"] for it in enabled_unified if it["method"] == "pipedream"
    ]

    # Apply agent type restrictions on integrations. agent_type_config holds
    # legacy Pipedream slug lists; if the agent type restricts integrations we
    # also rebuild the unified list from those defaults.
    if agent_type_config.restrict_integrations:
        enabled_integrations = agent_type_config.default_integrations or []
        enabled_unified = [
            {"slug": s, "method": "pipedream", "name": s} for s in enabled_integrations
        ]
    elif agent_type_config.default_integrations and not enabled_integrations:
        enabled_integrations = agent_type_config.default_integrations
        enabled_unified = enabled_unified + [
            {"slug": s, "method": "pipedream", "name": s}
            for s in enabled_integrations
            if s not in {it["slug"] for it in enabled_unified}
        ]

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
        enabled_pipedream=enabled_integrations,
        enabled_native=[
            it["slug"] for it in enabled_unified if it["method"] == "native"
        ],
        external_user_id=external_user_id,
    )

    # V1 to V2 migration flag - frontend sets this when loading a V1 conversation
    migrate_from_v1 = body.get("migrateFromV1", False)

    agent_id = body.get("agentId")

    # --- Parallel Data Loads ---
    # All pre-SDK data loads are independent and can run concurrently.
    # This eliminates the sequential waterfall that added seconds to every request.
    load_start = time.monotonic()

    async def _load_company_profile():
        return await asyncio.to_thread(load_company_profile_from_s3)

    async def _load_agent_config():
        if not agent_id:
            return None
        try:
            return await asyncio.to_thread(fetch_agent_config, agent_id, user_sub)
        except Exception as e:
            logger.warning(
                "Failed to fetch agent config, continuing without agent",
                agent_id=agent_id,
                error=str(e),
            )
            return None

    async def _load_integration_schemas():
        if not enabled_integrations or not external_user_id:
            return {"added": [], "removed": [], "cached": []}
        return await asyncio.to_thread(
            _sync_integration_schemas, enabled_integrations, external_user_id
        )

    async def _load_kb_listings():
        # File listings are no longer injected into the prompt (BUG-375); the
        # agent searches/traverses folders on demand. Kept as a no-op so the
        # gather() tuple below stays positionally stable.
        return None

    async def _load_user_data():
        # Prime the consolidated user settings cache (single DynamoDB GetItem).
        # Both functions share the cache -- first call fetches, second is instant.
        sig = await asyncio.to_thread(fetch_user_email_signature, user_sub)
        prof = await asyncio.to_thread(fetch_user_profile, user_sub)
        return sig, prof

    async def _load_ext_api_docs():
        connector_names = [
            it["slug"] for it in enabled_unified if it["method"] == "native"
        ]
        return await asyncio.to_thread(
            sync_ext_api_docs_for_connectors, connector_names
        )

    (
        company_profile,
        agent_config,
        integration_sync_result,
        kb_listings,
        (email_signature, user_profile),
        _api_docs_synced,
    ) = await asyncio.gather(
        _load_company_profile(),
        _load_agent_config(),
        _load_integration_schemas(),
        _load_kb_listings(),
        _load_user_data(),
        _load_ext_api_docs(),
    )

    load_elapsed_ms = (time.monotonic() - load_start) * 1000
    logger.info(
        "Parallel data loads complete",
        _name="PARALLEL_LOADS",
        phase="request",
        elapsed_ms=round(load_elapsed_ms, 1),
        has_company_profile=bool(company_profile),
        has_agent_config=agent_config is not None,
        integration_added=len(integration_sync_result.get("added", [])),
        integration_cached=len(integration_sync_result.get("cached", [])),
        has_kb_listings=kb_listings is not None,
    )

    # Model precedence: an explicit request modelId wins; otherwise fall back to the agent's
    # configured model (Standard / Premium / Expert), parsing its @thinking suffix the same way.
    # Scheduled runs carry no request modelId, so the agent's model is authoritative there; if
    # neither is set, model_id stays None and resolves to DEFAULT_MODEL (Premium / Sonnet 4.6).
    if not raw_model_id and agent_config and agent_config.model_id:
        model_id, thinking_override = parse_model_id_with_thinking(
            agent_config.model_id
        )

    # --- Post-gather: Apply agent config ---
    agent_file_paths: list[str] = []
    if agent_config:
        # Tool selection (enabledTools, availableKBs, enabledConnections) is resolved
        # upstream by the caller (frontend UI or schedule runner). The agent's
        # tools_config sets the initial defaults; the caller can override them.
        # We do NOT re-filter here -- the request payload is the source of truth.

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
            reference_files_count=len(agent_file_paths),
        )

    # Clean up stale integration schemas if no integrations enabled
    if not enabled_integrations:
        tools_dir = Path("/workdir/tools/integrations")
        if tools_dir.exists() and any(tools_dir.iterdir()):
            shutil.rmtree(tools_dir, ignore_errors=True)

    # Resolve approval modes (uses cached user settings -- instant)
    all_approval_modes = resolve_all_approval_modes(user_sub, agent_config)
    effective_approval_mode = all_approval_modes.get("integrations", "non_destructive")
    numa_tool_approval_mode = {
        k: v for k, v in all_approval_modes.items() if k != "integrations"
    }
    # TASK-127: per-integration approval-mode overrides set by the user on
    # the Integrations page. Empty when no overrides have been configured.
    integration_approval_modes = resolve_per_integration_approval_modes(
        user_sub, agent_config
    )

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
        has_company_profile=bool(company_profile),
        company_profile_length=(
            len(company_profile.get("companyInformation", ""))
            if isinstance(company_profile, dict)
            else 0
        ),
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

        # Emit integration sync results (computed in parallel gather above)
        if integration_sync_result.get("added") or integration_sync_result.get(
            "removed"
        ):
            yield emit_event(
                {
                    "type": "integrations_ready",
                    "integrations": enabled_integrations,
                    "added": integration_sync_result["added"],
                    "removed": integration_sync_result["removed"],
                }
            )

        # Register the approval queue for this conversation so CLI
        # subprocesses can POST approval events into the active SSE stream.
        approval_q = await register_approval_queue(conversation_id)

        stream_error: Exception | None = None
        try:
            sdk_stream = stream_claude_sdk(
                conversation_id,
                prompt,
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
                enabled_integrations=enabled_unified,  # Unified [{slug, method, name}]
                available_integrations=available_unified,  # Unified [{slug, method, name}]
                approval_mode=effective_approval_mode,  # Integration approval mode
                numa_tool_approval_mode=numa_tool_approval_mode,  # Per-category numa tool approval
                integration_approval_modes=integration_approval_modes,  # TASK-127: per-slug overrides
                email_signature=email_signature,  # Email signature settings
                agent_type_config=agent_type_config,  # Agent type configuration
                user_profile=user_profile,  # User profile for AI personalisation
                company_profile=company_profile,  # Company profile for system prompt
                feature_flags=feature_flags,  # Feature flags for conditional tools
                voice_recordings=voice_recordings,  # Voice recordings to auto-transcribe
                thinking_override=thinking_override,  # @<suffix> override from modelId
                accessible_kbs=accessible_kbs,  # All folders the user can toggle (for awareness in prompt)
            )

            # Interleave SDK stream chunks with CLI-emitted approval events.
            # asyncio.wait on two tasks: (1) next SDK chunk, (2) next queue item.
            # Whichever completes first gets yielded; the other keeps waiting.
            sdk_iter = sdk_stream.__aiter__()
            sdk_task: asyncio.Task | None = asyncio.ensure_future(sdk_iter.__anext__())
            q_task: asyncio.Task = asyncio.ensure_future(approval_q.get())

            try:
                while sdk_task is not None:
                    done, _ = await asyncio.wait(
                        {sdk_task, q_task},
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if q_task in done:
                        ev = q_task.result()
                        yield format_sse_event(ev)
                        # 128 KB padding flush to force AgentCore transport buffer
                        yield b": " + b"x" * 131072 + b"\n\n"
                        q_task = asyncio.ensure_future(approval_q.get())
                    if sdk_task in done:
                        try:
                            chunk = sdk_task.result()
                        except StopAsyncIteration:
                            sdk_task = None
                            break
                        yield chunk
                        sdk_task = asyncio.ensure_future(sdk_iter.__anext__())
            finally:
                q_task.cancel()
                if sdk_task is not None:
                    sdk_task.cancel()
                # Drain any tail events emitted after the SDK loop finished
                while not approval_q.empty():
                    ev = approval_q.get_nowait()
                    yield format_sse_event(ev)
                    yield b": " + b"x" * 131072 + b"\n\n"

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
            await unregister_approval_queue(conversation_id)

            # Update conversation meta in DynamoDB
            update_conversation_meta(
                user_sub=user_sub,
                conversation_id=conversation_id,
                latest_message=prompt,
            )

            # Sync changed files to S3 (sync_to_s3 logs its own summary)
            resolved_prefix = _resolve_s3_prefix(
                agent_type_config, user_sub, conversation_id
            )
            sync_to_s3(
                user_sub, conversation_id, _checksums_cache, s3_prefix=resolved_prefix
            )

            # Live credit metering — no-op unless CREDIT_METERING_ENABLED. Best-effort.
            # agent_id (set for agent chats + scheduled runs) → debit prices on the agent tier.
            from .credit_metering import maybe_emit_credit_event

            maybe_emit_credit_event(user_sub, conversation_id, agent_id=agent_id)

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

    # Record the active conversation before the SDK runs. The interactive path
    # (_handle_chat) does this; sync/scheduled runs must too, or the eager
    # pre-tool workspace->S3 sync hook (hooks/workspace_sync.py) reads a null
    # get_active_conversation() and silently no-ops — leaving agent-generated
    # files un-synced until the post-turn sync, so integration file uploads
    # (e.g. Slack attach) 404 on a file the agent just created. (BUG-376)
    if not get_active_conversation():
        set_active_conversation(conversation_id)

    # Extract the same parameters as _handle_chat for SDK options
    feature_flags = body.get("featureFlags", {})
    timezone = body.get("timezone")
    user_email = body.get("userEmail")
    today_string = body.get("todayString")
    company_profile = load_company_profile_from_s3()
    available_kbs = body.get("availableKBs")
    accessible_kbs = body.get("accessibleKBs")
    enabled_tools = body.get("enabledTools", [])
    # Frontend may send "anthropic.claude-sonnet-4-6@high-thinking" — split the
    # thinking-preset suffix here so the bare ID flows through validate_model_id
    # unchanged and the preset is threaded to the runner. Mirrors _handle_chat.
    raw_model_id = body.get("modelId")
    model_id, thinking_override = parse_model_id_with_thinking(raw_model_id)
    request_id = body.get("requestId") or str(uuid.uuid4())
    attachments_data = body.get("attachments")
    attached_files = attachments_data.get("files", []) if attachments_data else []
    attached_folders = attachments_data.get("folders", []) if attachments_data else []

    # Apply agent type restrictions on KBs
    if agent_type_config.restrict_kbs:
        available_kbs = agent_type_config.default_kbs or []
        accessible_kbs = available_kbs
    elif agent_type_config.default_kbs and not available_kbs:
        available_kbs = agent_type_config.default_kbs

    # Cross-job Synergy search: mirror _handle_chat so sync/scheduled runs can
    # query the synergy KB when the feature flag is on.
    available_kbs = _maybe_add_synergy_kb(
        available_kbs, body.get("featureFlags", {}), agent_type_config.restrict_kbs
    )

    # Integrations — unified payload via the shared adapter
    enabled_unified, available_unified = _normalise_integrations_payload(body)
    enabled_integrations = [
        it["slug"] for it in enabled_unified if it["method"] == "pipedream"
    ]

    if agent_type_config.restrict_integrations:
        enabled_integrations = agent_type_config.default_integrations or []
        enabled_unified = [
            {"slug": s, "method": "pipedream", "name": s} for s in enabled_integrations
        ]
    elif agent_type_config.default_integrations and not enabled_integrations:
        enabled_integrations = agent_type_config.default_integrations
        enabled_unified = enabled_unified + [
            {"slug": s, "method": "pipedream", "name": s}
            for s in enabled_integrations
            if s not in {it["slug"] for it in enabled_unified}
        ]

    external_user_id = f"{CLIENT_NAME}_{user_sub}" if enabled_integrations else None

    # Add each connected integration slug to enabled_tools so the
    # workspace-chat-tools Lambda can validate per-integration access
    # (mirrors the same logic in _handle_chat for streaming requests)
    if enabled_integrations:
        enabled_tools = list(enabled_tools)
        for slug in enabled_integrations:
            if slug not in enabled_tools:
                enabled_tools.append(slug)

    # --- Sync Integration Schemas (same as _handle_chat) ---
    # Must happen before SDK runs so that non_destructive approval mode
    # can check readOnlyHint annotations from the schema files on disk.
    # Without this, scheduled runs default to fail-closed (require approval)
    # because the schema files don't exist.
    if enabled_integrations and external_user_id:
        try:
            sync_result = _sync_integration_schemas(
                enabled_integrations, external_user_id
            )
            if sync_result["added"] or sync_result["removed"]:
                logger.info(
                    "Integration schemas synced in sync handler",
                    _name="SYNC_INTEGRATION_SCHEMAS",
                    phase="integrations",
                    added=sync_result["added"],
                    removed=sync_result["removed"],
                    cached=sync_result.get("cached", []),
                )
        except Exception as e:
            logger.warning(
                "Failed to sync integration schemas in sync handler",
                error=str(e),
                integrations=enabled_integrations,
            )
    elif not enabled_integrations:
        # No integrations enabled — clean up any stale schemas on disk
        tools_dir = Path("/workdir/tools/integrations")
        if tools_dir.exists() and any(tools_dir.iterdir()):
            shutil.rmtree(tools_dir, ignore_errors=True)

    # Agent config — fetch if agentId provided (same as _handle_chat)
    agent_id = body.get("agentId")
    agent_config: Optional[AgentConfig] = None
    if agent_id:
        try:
            agent_config = fetch_agent_config(agent_id, user_sub)
        except Exception as e:
            logger.warning(
                "Failed to fetch agent config in sync handler",
                agent_id=agent_id,
                error=str(e),
            )

    # Model precedence: explicit request modelId wins; else fall back to the agent's configured
    # model (parsing its @thinking suffix). Neither set → DEFAULT_MODEL (Premium / Sonnet 4.6).
    if not raw_model_id and agent_config and agent_config.model_id:
        model_id, thinking_override = parse_model_id_with_thinking(
            agent_config.model_id
        )

    # Resolve all approval modes (agent overrides > user settings > defaults)
    all_approval_modes_sync = resolve_all_approval_modes(user_sub, agent_config)
    effective_approval_mode = all_approval_modes_sync.get(
        "integrations", "non_destructive"
    )
    # TASK-127: per-integration overrides from the user's Integrations page.
    integration_approval_modes_sync = resolve_per_integration_approval_modes(
        user_sub, agent_config
    )
    logger.info(
        "Resolved approval modes for sync request",
        _name="SYNC_APPROVAL_MODE",
        resolved_modes=all_approval_modes_sync,
        per_integration_overrides=integration_approval_modes_sync,
        agent_id=agent_id,
    )

    # KB listings are no longer fetched/injected (BUG-375) — folder headers only.
    kb_listings = None

    # Sync ext API docs for any enabled native connectors (instant if cached)
    _connector_names_sync = [
        it["slug"] for it in enabled_unified if it["method"] == "native"
    ]
    sync_ext_api_docs_for_connectors(_connector_names_sync)

    # Run SDK — custom orchestrator, sequential pipeline, or single agent
    request_metadata = body.get("metadata", {})

    if agent_type_config.pipeline_orchestrator:
        result = await agent_type_config.pipeline_orchestrator(
            prompt=prompt,
            user_sub=user_sub,
            conversation_id=conversation_id,
            parent_config=agent_type_config,
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
            request_metadata=request_metadata,
        )
    elif agent_type_config.pipeline_steps:
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
            approval_mode=effective_approval_mode,
            numa_tool_approval_mode={
                k: v for k, v in all_approval_modes_sync.items() if k != "integrations"
            },
            integration_approval_modes=integration_approval_modes_sync,
        )
    else:
        numa_tool_approval_mode_sync = {
            k: v for k, v in all_approval_modes_sync.items() if k != "integrations"
        }
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
            agent_config=agent_config,
            external_user_id=external_user_id,
            enabled_integrations=enabled_unified,
            available_integrations=available_unified,
            approval_mode=effective_approval_mode,
            numa_tool_approval_mode=numa_tool_approval_mode_sync,
            integration_approval_modes=integration_approval_modes_sync,
            agent_type_config=agent_type_config,
            company_profile=company_profile,
            feature_flags=feature_flags,
            thinking_override=thinking_override,
            accessible_kbs=accessible_kbs,
        )

    # If the agent type uses result_file mode, read /workdir/outputs/result.json
    # and use it as the response text instead of the raw SDK output. This is the
    # same convention used by pipelines, but here for single-step agent types
    # (e.g. document-summariser) that write structured output to a known file.
    # Pipelines and custom orchestrators handle result extraction themselves.
    if (
        agent_type_config
        and agent_type_config.pipeline_result_mode == "result_file"
        and not agent_type_config.pipeline_steps
        and not agent_type_config.pipeline_orchestrator
    ):
        result_path = Path("/workdir/outputs/result.json")
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
    resolved_prefix = _resolve_s3_prefix(agent_type_config, user_sub, conversation_id)
    sync_to_s3(user_sub, conversation_id, _checksums_cache, s3_prefix=resolved_prefix)

    # Live credit metering — no-op unless CREDIT_METERING_ENABLED. Best-effort.
    # agent_id (set for agent chats + scheduled runs) → debit prices on the agent tier.
    from .credit_metering import maybe_emit_credit_event

    maybe_emit_credit_event(user_sub, conversation_id, agent_id=agent_id)

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

    # Record the active conversation before the background SDK run starts. The
    # interactive path (_handle_chat) does this; fire-and-forget (scheduled
    # agents, V2 apps) must too, or the eager pre-tool workspace->S3 sync hook
    # (hooks/workspace_sync.py) reads a null get_active_conversation() and
    # silently no-ops — leaving agent-generated files un-synced until the
    # post-turn sync, so integration file uploads (e.g. Slack attach) 404 on a
    # file the agent just created. (BUG-376)
    if not get_active_conversation():
        set_active_conversation(conversation_id)

    # Extract the same parameters as _handle_chat
    feature_flags = body.get("featureFlags", {})
    timezone = body.get("timezone")
    user_email = body.get("userEmail")
    today_string = body.get("todayString")
    company_profile = load_company_profile_from_s3()
    available_kbs = body.get("availableKBs")
    accessible_kbs = body.get("accessibleKBs")
    enabled_tools = body.get("enabledTools", [])
    # Frontend may send "anthropic.claude-sonnet-4-6@high-thinking" — split the
    # thinking-preset suffix here so the bare ID flows through validate_model_id
    # unchanged and the preset is threaded to the runner. Mirrors _handle_chat.
    raw_model_id = body.get("modelId")
    model_id, thinking_override = parse_model_id_with_thinking(raw_model_id)
    request_id = body.get("requestId") or str(uuid.uuid4())
    attachments_data = body.get("attachments")
    attached_files = attachments_data.get("files", []) if attachments_data else []
    attached_folders = attachments_data.get("folders", []) if attachments_data else []

    # Sync app workspace files (company-scoped and user-scoped) into /workdir/app-workspace/
    workspace_prefixes = body.get("workspacePrefixes", [])
    if workspace_prefixes:
        from .s3_workspace import sync_workspace_prefixes

        sync_workspace_prefixes(workspace_prefixes)

    # Sync uploaded files into /workdir/uploads/ (essential for follow-up runs
    # where the cold start sync doesn't re-run)
    upload_prefixes = body.get("uploadPrefixes", [])
    if upload_prefixes:
        from .s3_workspace import sync_workspace_prefixes

        sync_workspace_prefixes(upload_prefixes, target_dir="uploads")

    # Apply agent type restrictions
    if agent_type_config.restrict_kbs:
        available_kbs = agent_type_config.default_kbs or []
        accessible_kbs = available_kbs
    elif agent_type_config.default_kbs and not available_kbs:
        available_kbs = agent_type_config.default_kbs

    # Cross-job Synergy search: mirror _handle_chat/_handle_sync so V2-app
    # (fire-and-forget) runs can query the synergy KB when the feature flag is on.
    available_kbs = _maybe_add_synergy_kb(
        available_kbs, feature_flags, agent_type_config.restrict_kbs
    )

    enabled_unified, available_unified = _normalise_integrations_payload(body)
    enabled_integrations = [
        it["slug"] for it in enabled_unified if it["method"] == "pipedream"
    ]
    if agent_type_config.restrict_integrations:
        enabled_integrations = agent_type_config.default_integrations or []
        enabled_unified = [
            {"slug": s, "method": "pipedream", "name": s} for s in enabled_integrations
        ]
    elif agent_type_config.default_integrations and not enabled_integrations:
        enabled_integrations = agent_type_config.default_integrations
        enabled_unified = enabled_unified + [
            {"slug": s, "method": "pipedream", "name": s}
            for s in enabled_integrations
            if s not in {it["slug"] for it in enabled_unified}
        ]

    external_user_id = f"{CLIENT_NAME}_{user_sub}" if enabled_integrations else None

    # Add integration slugs to enabled_tools for workspace-chat-tools validation
    if enabled_integrations:
        enabled_tools = list(enabled_tools)
        for slug in enabled_integrations:
            if slug not in enabled_tools:
                enabled_tools.append(slug)

    # --- Sync Integration Schemas (same as _handle_chat) ---
    # Must happen before SDK runs so that non_destructive approval mode
    # can check readOnlyHint annotations from the schema files on disk.
    if enabled_integrations and external_user_id:
        try:
            sync_result = _sync_integration_schemas(
                enabled_integrations, external_user_id
            )
            if sync_result["added"] or sync_result["removed"]:
                logger.info(
                    "Integration schemas synced in fire-and-forget handler",
                    _name="ASYNC_INTEGRATION_SCHEMAS",
                    phase="integrations",
                    added=sync_result["added"],
                    removed=sync_result["removed"],
                    cached=sync_result.get("cached", []),
                )
        except Exception as e:
            logger.warning(
                "Failed to sync integration schemas in fire-and-forget handler",
                error=str(e),
                integrations=enabled_integrations,
            )
    elif not enabled_integrations:
        tools_dir = Path("/workdir/tools/integrations")
        if tools_dir.exists() and any(tools_dir.iterdir()):
            shutil.rmtree(tools_dir, ignore_errors=True)

    # Agent config and approval mode
    agent_id = body.get("agentId")
    agent_config: Optional[AgentConfig] = None
    if agent_id:
        try:
            agent_config = fetch_agent_config(agent_id, user_sub)
        except Exception as e:
            logger.warning(
                "Failed to fetch agent config in fire-and-forget handler",
                agent_id=agent_id,
                error=str(e),
            )
    # Model precedence: explicit request modelId wins; else fall back to the agent's configured
    # model (parsing its @thinking suffix). Neither set → DEFAULT_MODEL (Premium / Sonnet 4.6).
    if not raw_model_id and agent_config and agent_config.model_id:
        model_id, thinking_override = parse_model_id_with_thinking(
            agent_config.model_id
        )
    all_approval_modes_async = resolve_all_approval_modes(user_sub, agent_config)
    effective_approval_mode = all_approval_modes_async.get(
        "integrations", "non_destructive"
    )
    # TASK-127: per-integration overrides from the user's Integrations page.
    integration_approval_modes_async = resolve_per_integration_approval_modes(
        user_sub, agent_config
    )
    logger.info(
        "Resolved approval modes for fire-and-forget request",
        _name="ASYNC_APPROVAL_MODE",
        resolved_modes=all_approval_modes_async,
        per_integration_overrides=integration_approval_modes_async,
        agent_id=agent_id,
    )

    # KB listings are no longer fetched/injected (BUG-375) — folder headers only.
    kb_listings = None

    # Sync ext API docs for any enabled native connectors (instant if cached)
    _connector_names_async = [
        it["slug"] for it in enabled_unified if it["method"] == "native"
    ]
    sync_ext_api_docs_for_connectors(_connector_names_async)

    # Capture current checksums before background task starts
    pre_checksums = dict(_checksums_cache)
    s3_prefix = agent_type_config.s3_prefix_template if agent_type_config else None
    resolved_prefix = _resolve_s3_prefix(agent_type_config, user_sub, conversation_id)

    # Extract metadata for custom orchestrators
    request_metadata = body.get("metadata", {})

    async def _background_run() -> None:
        """Run the SDK (or pipeline/orchestrator) and write the result to S3."""
        # Keep a dummy subprocess alive so AgentCore sees activity and
        # doesn't SIGKILL us between pipeline phases.  AgentCore defers
        # idle-timeout kills while subprocesses exist, so this prevents
        # the container from being killed in the gaps between SDK calls.
        heartbeat = subprocess.Popen(
            ["sleep", "infinity"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            if agent_type_config.pipeline_orchestrator:
                result = await agent_type_config.pipeline_orchestrator(
                    prompt=prompt,
                    user_sub=user_sub,
                    conversation_id=conversation_id,
                    parent_config=agent_type_config,
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
                    request_metadata=request_metadata,
                )
            elif agent_type_config.pipeline_steps:
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
                    approval_mode=effective_approval_mode,
                    numa_tool_approval_mode={
                        k: v
                        for k, v in all_approval_modes_async.items()
                        if k != "integrations"
                    },
                    integration_approval_modes=integration_approval_modes_async,
                )
            else:
                numa_tool_approval_mode_async = {
                    k: v
                    for k, v in all_approval_modes_async.items()
                    if k != "integrations"
                }
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
                    agent_config=agent_config,
                    external_user_id=external_user_id,
                    enabled_integrations=enabled_unified,
                    available_integrations=available_unified,
                    approval_mode=effective_approval_mode,
                    numa_tool_approval_mode=numa_tool_approval_mode_async,
                    integration_approval_modes=integration_approval_modes_async,
                    agent_type_config=agent_type_config,
                    company_profile=company_profile,
                    feature_flags=feature_flags,
                    thinking_override=thinking_override,
                    accessible_kbs=accessible_kbs,
                )

            # If the agent type uses result_file mode, read result.json
            # Pipelines and custom orchestrators handle this themselves.
            if (
                agent_type_config
                and agent_type_config.pipeline_result_mode == "result_file"
                and not agent_type_config.pipeline_steps
                and not agent_type_config.pipeline_orchestrator
            ):
                result_path = Path("/workdir/outputs/result.json")
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
            sync_to_s3(
                user_sub, conversation_id, pre_checksums, s3_prefix=resolved_prefix
            )
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
        finally:
            heartbeat.kill()
            heartbeat.wait()

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


def _path_has_hidden_segment(raw_path: str) -> bool:
    """True if any path segment starts with `.` (e.g. `.git/objects/abc`).

    Used by `_handle_upload_complete` to silently skip hidden files from
    folder uploads instead of surfacing them as 400 errors. Folder uploads
    routinely include `.git/`, `.cache/`, `.DS_Store`, etc.; the frontend
    filters these out, but this is a defence in depth so a slipped-through
    item doesn't break the user's upload flow.
    """
    if not raw_path:
        return False
    normalized = raw_path.replace("\\", "/")
    return any(seg.startswith(".") for seg in normalized.split("/") if seg)


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

    # Backend upload size cap — mirror the frontend's 500 MB limit so a crafted
    # request can't bypass it. Here we have the actual decoded bytes, so the
    # check is exact.
    if len(content) > MAX_UPLOAD_BYTES:
        logger.warning(
            "Rejecting oversized upload",
            _name="UPLOAD_TOO_LARGE",
            phase="upload",
            conversation_id=conversation_id,
            size=len(content),
            max_bytes=MAX_UPLOAD_BYTES,
        )
        raise HTTPException(
            status_code=413,
            detail=(
                f"File exceeds the {_format_bytes(MAX_UPLOAD_BYTES)} upload limit "
                f"({_format_bytes(len(content))})."
            ),
        )

    # Proactive /workdir disk guard — reject before writing if there isn't room,
    # rather than failing mid-write with ENOSPC.
    quota_error = _ensure_workspace_has_room(len(content))
    if quota_error is not None:
        raise HTTPException(status_code=507, detail=quota_error["error"])

    paths = get_workspace_paths()

    # Sanitize the upload path - allows folder structure like "invoices/2024/a.pdf"
    safe_rel_path = _sanitize_upload_path(filename)
    if safe_rel_path is None:
        raise HTTPException(status_code=400, detail="Invalid filename or path")

    # Extract just the filename for the response
    safe_filename = safe_rel_path.split("/")[-1]

    # Write file atomically (temp + fsync + os.replace); atomic_write_bytes
    # creates parent directories as needed, so a crash mid-upload can never
    # leave a truncated file at the final path.
    upload_path = paths["uploads"] / safe_rel_path
    try:
        await asyncio.to_thread(atomic_write_bytes, content, upload_path)
    except OSError as e:
        if "No space left on device" in str(e) or e.errno == errno.ENOSPC:  # ENOSPC
            logger.warning(
                "Disk full while writing file",
                conversation_id=conversation_id,
                error=str(e),
            )
            raise HTTPException(
                status_code=507,
                detail="Insufficient storage space available",
            ) from e
        raise

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

    # Backend upload size cap (fail fast on the reported size before doing any
    # S3 work). Mirrors the frontend's 500 MB limit; the browser uploaded
    # straight to S3 via a presigned URL, so this is the first server-side
    # gate. The reported size is validated against the real S3 object below.
    try:
        reported_size = int(size or 0)
    except (TypeError, ValueError):
        reported_size = 0
    if reported_size > MAX_UPLOAD_BYTES:
        logger.warning(
            "Rejecting oversized upload (reported size)",
            _name="UPLOAD_TOO_LARGE",
            phase="upload",
            conversation_id=conversation_id,
            size=reported_size,
            max_bytes=MAX_UPLOAD_BYTES,
        )
        raise HTTPException(
            status_code=413,
            detail=(
                f"File exceeds the {_format_bytes(MAX_UPLOAD_BYTES)} upload limit "
                f"({_format_bytes(reported_size)})."
            ),
        )

    # Silently skip hidden segments (e.g. .git/, .DS_Store) instead of 400ing.
    # Folder uploads can surface dozens of these per drop; erroring back to the
    # browser turns into a chat-wide failure message. The FE filters these out,
    # but treat this path as defence in depth.
    if _path_has_hidden_segment(filename):
        logger.info(
            "Skipping hidden-path upload",
            _name="UPLOAD_SKIPPED_HIDDEN",
            phase="upload",
            conversation_id=conversation_id,
            filename=filename,
        )
        return {"status": "skipped", "reason": "hidden", "path": filename}

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

    s3 = boto3.client("s3")

    # HEAD the object to learn its authoritative size. The browser uploaded
    # directly to S3, so the reported `size` is untrusted: a partial/aborted
    # upload or a crafted request could understate it. The HEAD is one cheap
    # metadata call (no body transfer). We use the real size for both the
    # upload cap and the proactive disk check, and reject on a large mismatch
    # versus the reported size (defends against truncated/partial uploads).
    # All size checks run BEFORE we touch the local filesystem so a rejected
    # upload doesn't leave behind empty directories.
    actual_size: Optional[int] = None
    try:
        head = s3.head_object(Bucket=OUTPUTS_BUCKET, Key=s3_key)
        actual_size = int(head.get("ContentLength", 0))
    except Exception as e:  # noqa: BLE001 - best-effort; download path still guards
        # If HEAD fails (object not yet visible, permissions, transient error),
        # fall back to the reported size for the caps below and let the
        # download attempt surface any real problem. Do NOT silently skip the
        # cap — apply it to whatever size we have.
        logger.warning(
            "Could not HEAD uploaded object; falling back to reported size",
            _name="UPLOAD_HEAD_FAILED",
            phase="upload",
            conversation_id=conversation_id,
            s3_key=s3_key,
            error=str(e),
        )

    effective_size = actual_size if actual_size is not None else reported_size

    # Enforce the cap against the authoritative size.
    if effective_size > MAX_UPLOAD_BYTES:
        logger.warning(
            "Rejecting oversized upload (actual S3 size)",
            _name="UPLOAD_TOO_LARGE",
            phase="upload",
            conversation_id=conversation_id,
            size=effective_size,
            reported_size=reported_size,
            max_bytes=MAX_UPLOAD_BYTES,
        )
        raise HTTPException(
            status_code=413,
            detail=(
                f"File exceeds the {_format_bytes(MAX_UPLOAD_BYTES)} upload limit "
                f"({_format_bytes(effective_size)})."
            ),
        )

    # Reject a meaningful mismatch between reported and actual size. A small
    # delta is tolerated (clients estimate slightly differently); a large gap
    # signals a partial/aborted upload or a spoofed request.
    if actual_size is not None and reported_size > 0:
        delta = abs(actual_size - reported_size)
        if delta > max(1024, reported_size // 100):  # >1 KB or >1% of reported
            logger.warning(
                "Upload size mismatch between reported and actual S3 object",
                _name="UPLOAD_SIZE_MISMATCH",
                phase="upload",
                conversation_id=conversation_id,
                s3_key=s3_key,
                reported_size=reported_size,
                actual_size=actual_size,
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    "Uploaded file size does not match the reported size "
                    f"(reported {_format_bytes(reported_size)}, "
                    f"found {_format_bytes(actual_size)}). "
                    "The upload may be incomplete — please retry."
                ),
            )

    # Proactive /workdir disk guard — reject before downloading if there isn't
    # room, rather than failing mid-download with ENOSPC.
    quota_error = _ensure_workspace_has_room(effective_size)
    if quota_error is not None:
        raise HTTPException(status_code=507, detail=quota_error["error"])

    # Sync file from S3 to local EFS (size checks passed).
    paths = get_workspace_paths()
    local_path = paths["uploads"] / safe_rel_path
    local_path.parent.mkdir(parents=True, exist_ok=True)

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
