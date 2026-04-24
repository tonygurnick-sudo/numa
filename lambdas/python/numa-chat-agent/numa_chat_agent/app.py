from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, AsyncGenerator, Dict, List, Optional

import jwt
import requests
import structlog
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from jwt import algorithms

from kb_core import KnowledgeBaseManager

from . import (
    clear_current_user_auth,
    create_fresh_agent,
    set_current_user_auth,
    set_request_scoped_user_auth,
)
from .dynamodb_utils import (
    NumaChatDynamoUtils,
    format_conversation_for_bedrock,
)
from .progressive_summarization import ProgressiveSummarization
from .utils import (
    cleanup_mcp_clients,
    convert_tool_blocks_to_text,
    process_messages_with_file_refs,
    safe_json_convert,
)

logger = structlog.get_logger()

app = FastAPI()

REGION = os.environ.get("AWS_REGION", "us-east-1")
USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID")
USER_POOL_CLIENT_ID = os.environ.get("COGNITO_USER_POOL_CLIENT_ID")
CF_SHARED_SECRET = os.environ.get("CLOUDFRONT_SHARED_SECRET")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "")
SCHEDULE_RUNNER_SECRET = os.environ.get("SCHEDULE_RUNNER_SECRET")

_jwks_cache: Dict[str, Any] = {"data": None}


def _get_jwks() -> Dict[str, Any]:
    if _jwks_cache["data"] is None:
        jwks_url = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"
        resp = requests.get(jwks_url, timeout=10)
        resp.raise_for_status()
        _jwks_cache["data"] = resp.json()
    return _jwks_cache["data"]


def _verify_jwt_token(token: str) -> Dict[str, Any]:
    if token.startswith("Bearer "):
        token = token[7:]

    jwks = _get_jwks()
    unverified = jwt.get_unverified_header(token)
    kid = unverified.get("kid")
    if not kid:
        raise ValueError("Token missing 'kid' header")

    rsa_key = None
    for jwk in jwks.get("keys", []):
        if jwk.get("kid") == kid:
            rsa_key = algorithms.RSAAlgorithm.from_jwk(jwk)
            break
    if not rsa_key:
        raise ValueError("Unable to find matching key")

    payload_check = jwt.decode(
        token,
        rsa_key,  # type: ignore[arg-type]
        algorithms=["RS256"],
        issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}",
        options={"verify_exp": True, "verify_aud": False},
    )

    token_use = payload_check.get("token_use")
    if token_use == "id":
        payload = jwt.decode(
            token,
            rsa_key,  # type: ignore[arg-type]
            algorithms=["RS256"],
            audience=USER_POOL_CLIENT_ID,
            issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}",
            options={"verify_exp": True},
        )
    elif token_use == "access":
        if payload_check.get("client_id") != USER_POOL_CLIENT_ID:
            raise ValueError("Invalid client_id")
        payload = payload_check
    else:
        raise ValueError(f"Unknown token_use: {token_use}")

    if not payload.get("sub"):
        raise ValueError("Token missing required 'sub' claim")
    return payload


def _ndjson(obj: Dict[str, Any]) -> str:
    return json.dumps(obj, default=safe_json_convert, separators=(",", ":")) + "\n"


def _safe_event_frame(event: Dict[str, Any]) -> Dict[str, Any]:
    """Thin, WS-era compatible wrapper for streaming frames.

    - Pass through Strands/Bedrock event shape as-is (including nested "event" fields).
    - Drop only heavy/noisy internals that are not needed by FE.
    - Ensure a top-level type='event' marker for the client stream handler.

    Intentionally does NOT:
    - Flatten nested Bedrock-like fields into top-level keys
    - Synthesize contentBlockDelta from other token channels
    - Remove top-level 'delta' or 'data' fields
    """
    drop_keys = {
        "messages",
        "agent",
        "event_loop_cycle_trace",
        "event_loop_cycle_span",
        "request_state",
    }
    out: Dict[str, Any] = {k: v for k, v in event.items() if k not in drop_keys}

    if out.get("type") is None:
        out["type"] = "event"
    return out


def _build_messages_from_history(
    conversation_id: Optional[str], user_auth: Dict[str, Any], prompt: str
) -> list[dict]:
    """Load and format conversation history with progressive summarization.

    Uses progressive summarization to efficiently manage long conversation histories:
    - Summarizes older messages when threshold is reached (30+ messages)
    - Caches summaries in DynamoDB to avoid re-computation
    - Returns: [summary] + [recent messages] for optimal token usage

    We pass the current prompt separately to the agent stream call to avoid
    duplicating the latest user message. If Dynamo already contains the latest
    user text equal to the prompt, drop that last user message from history so
    that the agent only sees it once via the `prompt` parameter.
    """
    history: list[dict] = []
    if conversation_id and user_auth and user_auth.get("sub"):
        try:
            dynamo_utils = NumaChatDynamoUtils()
            summarizer = ProgressiveSummarization(dynamo_utils)

            # LAYER 1: Load conversation with progressive summarization
            cached_messages, was_summarized = (
                summarizer.load_conversation_with_summaries(
                    conversation_id=conversation_id, user_id=user_auth["sub"]
                )
            )

            logger.info(
                "Loaded conversation with progressive summarization",
                conversation_id=conversation_id,
                cached_items=len(cached_messages),
                was_summarized=was_summarized,
            )

            # Convert DynamoDB items to Bedrock message format
            history = format_conversation_for_bedrock(cached_messages) or []

        except Exception as e:  # pylint: disable=broad-except
            logger.error(
                "Failed to load conversation history with summarization",
                conversation_id=conversation_id,
                error=str(e),
                exc_info=True,
            )
            # Fallback: proceed without history rather than failing the request
            history = []

    # If the last message in history is a user text that exactly matches the
    # current prompt (ignoring surrounding whitespace), drop it from history to
    # avoid sending the same content twice (once in history and once as prompt).
    norm_prompt = (prompt or "").strip()
    if history:
        last = history[-1] or {}
        if last.get("role") == "user":
            content = last.get("content") or []
            for block in content:
                txt = block.get("text") if isinstance(block, dict) else None
                if isinstance(txt, str) and txt.strip() == norm_prompt:
                    history = history[:-1]
                    break

    return history


async def _stream_agent_events(
    agent, prompt: str, heartbeat_interval: float = 25.0
) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue[Any] = asyncio.Queue()
    done_sentinel = object()

    async def _runner():
        try:
            async for ev in agent.stream_async(prompt):
                await queue.put(ev)
            await queue.put({"complete": True})
        except Exception as exc:  # pylint: disable=broad-except
            await queue.put({"type": "error", "error": str(exc)})
        finally:
            await queue.put(done_sentinel)

    asyncio.create_task(_runner())
    yield _ndjson({"type": "start"})
    last_emit = time.time()
    while True:
        try:
            item = await asyncio.wait_for(queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            item = None

        now = time.time()
        if now - last_emit > heartbeat_interval:
            yield _ndjson({"type": "ping", "ts": int(now)})
            last_emit = now

        if item is None:
            continue
        if item is done_sentinel:
            break
        if isinstance(item, dict):
            wrapped = _safe_event_frame(item)
            yield _ndjson(wrapped)
            last_emit = time.time()

    yield _ndjson({"type": "completion", "status": "completed"})


@app.get("/")
async def root() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/numa-chat-agent/stream")
async def http_stream(request: Request) -> Response:
    try:
        headers = {k.lower(): v for k, v in request.headers.items()}
        if CF_SHARED_SECRET:
            if headers.get("x-arcanum-cloudfront-secret") != CF_SHARED_SECRET:
                return JSONResponse({"error": "Forbidden"}, status_code=403)

        auth = headers.get("authorization")
        body = await request.json()

        internal_user_override: Optional[dict] = None
        if (
            SCHEDULE_RUNNER_SECRET
            and auth == f"Bearer {SCHEDULE_RUNNER_SECRET}"
            and isinstance(body, dict)
        ):
            internal_user_override = body.get("internalUser") or {}

        if internal_user_override:
            if not internal_user_override.get("sub"):
                return JSONResponse(
                    {"error": "Missing internal user context"}, status_code=400
                )
            user = internal_user_override
        else:
            if not auth:
                return JSONResponse(
                    {"error": "Missing Authorization header"}, status_code=401
                )
            user = _verify_jwt_token(auth)

        prompt: str = (body.get("prompt") or "").strip()
        if not prompt:
            return JSONResponse({"error": "Missing prompt"}, status_code=400)

        conversation_id: Optional[str] = body.get("conversationId")
        enabled_tools = (
            body.get("enabledTools", ["query_knowledge_base", "web_search"]) or []
        )
        enabled_connections = body.get("enabledConnections", []) or []
        logger.error(
            "SECURITY_RISK: Frontend controls enabled integrations - no server-side validation",
            user_id=user.get("sub", "unknown")[:8] + "...",
            requested_connections=enabled_connections,
            request_source="frontend_unvalidated",
            security_concern="User could enable unauthorized integrations",
        )
        # Add this validation check:
        if enabled_connections:
            logger.warning(
                "SECURITY_TODO: Validate enabled_connections against user permissions",
                connections_to_validate=enabled_connections,
                current_validation="NONE - SECURITY GAP",
            )

        # IMPROVEMENT NEEDED: Server-side validation of enabled integrations
        # RATIONALE: Currently, the frontend completely controls which integrations are enabled
        # without any server-side validation against user permissions or policies. This creates
        # a significant security vulnerability where malicious clients could enable unauthorized
        # integrations by manipulating the request.
        # CONSEQUENCE: Without this fix, users could potentially access integrations they don't
        # have permission for, leading to data breaches, unauthorized actions, and compliance violations.
        #
        # PROPOSED FIX:
        # if enabled_connections:
        #     # Validate against user's allowed integrations from DynamoDB/policy store
        #     user_allowed_integrations = get_user_allowed_integrations(user.get("sub"))
        #     validated_connections = []
        #     for connection in enabled_connections:
        #         if connection in user_allowed_integrations:
        #             validated_connections.append(connection)
        #         else:
        #             logger.warning(
        #                 "SECURITY_VIOLATION: User attempted to enable unauthorized integration",
        #                 user_id=user.get("sub", "unknown")[:8] + "...",
        #                 attempted_integration=connection,
        #                 allowed_integrations=user_allowed_integrations
        #             )
        #     enabled_connections = validated_connections
        system_prompt = body.get("systemPrompt", "") or ""
        model_id = body.get("modelId")
        user_id = user.get("sub")

        # Multi‑KB: compute per‑turn active KBs = request list ∩ allowed list
        requested_kbs_raw = body.get("enabledKBIds") or []
        requested_kb_ids: list[str] = []
        if isinstance(requested_kbs_raw, list):
            for v in requested_kbs_raw:
                if isinstance(v, str) and v.strip():
                    requested_kb_ids.append(v.strip())
        # Allowed = 'company' and any user-accessible KBs from Dynamo
        allowed_kb_ids: set[str] = {"company"}
        try:
            if isinstance(user_id, str) and user_id:
                kb_manager = KnowledgeBaseManager()
                for m in kb_manager.list_user_kbs(user_id) or []:
                    kid = m.get("kb_id")
                    if isinstance(kid, str) and kid.strip():
                        allowed_kb_ids.add(kid.strip())
        except Exception as e:  # defensive; default to company only
            logger.warning(
                "Failed to load user KBs; defaulting allowed set to 'company' only",
                error=str(e),
            )
        active_kb_ids: list[str] = [
            kid for kid in requested_kb_ids if kid in allowed_kb_ids
        ]

        # Capture optional client-local time info for downstream tools/prompts
        client_time_info = body.get("timeInfo") or {}

        # Capture optional client locale for language preference
        client_locale = body.get("locale") or {}

        user_auth = {
            **(
                {
                    "sub": user.get("sub"),
                    "email": user.get("email"),
                    "groups": user.get("cognito:groups", []),
                }
            ),
            **(body.get("userAuth") or {}),
            # Per‑turn enabled KBs (intersection with allowed set)
            "enabled_kb_ids": active_kb_ids,
            "conversation_id": conversation_id,
            "conversationId": conversation_id,
        }
        if client_time_info:
            # Attach to auth context for request-scoped access by tools/routers
            try:
                if isinstance(client_time_info, dict):
                    user_auth["timeInfo"] = client_time_info
                else:
                    user_auth["timeInfo"] = {"raw": client_time_info}
            except Exception:  # defensive
                user_auth["timeInfo"] = {"raw": str(client_time_info)}

        messages = _build_messages_from_history(conversation_id, user_auth, prompt)

        if not enabled_tools:
            messages = convert_tool_blocks_to_text(messages)
        messages = process_messages_with_file_refs(messages)
        # IMPROVEMENT NEEDED: Replace global user auth context with request-scoped context
        # RATIONALE: The current implementation uses a global variable to store user authentication
        # context, which creates race conditions in concurrent requests. When multiple requests
        # are processed simultaneously, one request can overwrite another's auth context.
        # CONSEQUENCE: Without this fix, tools executing in one user's request could inherit
        # authentication from a different user's concurrent request, leading to authorization
        # bypass and potential data leakage between users.
        #
        # PROPOSED FIX:
        # Instead of global context, pass user_auth directly to tools that need it:
        # - Modify create_fresh_agent to accept user_auth parameter
        # - Pass user_auth through the tool chain to _execute_via_sub_agent
        # - Store auth context in tool execution context rather than global state
        # - Use threading.local() if global state is absolutely necessary
        #
        # BETTER APPROACH:
        # def create_fresh_agent_with_auth(enabled_tools, system_prompt, model_id, messages, enabled_connections, user_auth):
        #     # Pass user_auth directly to MCP providers and tools
        #     return create_agent_with_scoped_auth(enabled_tools, system_prompt, model_id, messages, enabled_connections, user_auth)

        logger.warning(
            "RELIABILITY_RISK: Setting global user authentication context - critical race condition vulnerability",
            user_id=user_auth.get("sub", "unknown")[:8] + "...",
            conversation_id=conversation_id,
            enabled_connections_count=len(enabled_connections),
            timestamp=time.time(),
            reliability_concerns=[
                "global_state_creates_race_conditions_between_concurrent_requests",
                "one_users_context_can_overwrite_anothers_in_concurrent_execution",
                "authentication_context_inheritance_between_unrelated_users",
                "potential_data_leakage_between_user_sessions",
                "potential_data_leakage_between_user_sessions",
            ],
            concurrency_risks=[
                "concurrent_lambda_invocations_share_global_state",
                "no_request_isolation_for_authentication_context",
                "thread_unsafe_global_variable_access",
                "intermittent_auth_failures_depend_on_request_timing",
            ],
        )

        # RELIABILITY IMPROVEMENT NEEDED: Replace global authentication context with request-scoped context
        # RATIONALE: The current implementation uses a global variable (CURRENT_USER_AUTH) to store user
        # authentication context, which creates severe race conditions in concurrent requests. When multiple
        # users make requests simultaneously, one request can overwrite another's auth context, causing
        # intermittent authentication failures and potential data leakage between users.
        # CONSEQUENCE OF NOT FIXING: The system experiences critical reliability issues where:
        # - One user's tools can inherit authentication from a different concurrent user's request
        # - Intermittent authentication failures that appear random but depend on request concurrency
        # - Potential data leakage between user sessions when auth context gets mixed up
        # - Tools executing in one user's request could access another user's data or permissions
        # - Debugging becomes extremely difficult due to race condition timing dependencies
        # CONSEQUENCE OF FIXING: With request-scoped authentication, the system would have:
        # - Complete isolation between concurrent user requests and their authentication contexts
        # - Elimination of cross-user authentication inheritance and data leakage risks
        # - Consistent and reliable authentication behavior regardless of request concurrency
        # - Enhanced security with proper request isolation and no auth context mixing
        # - Easier debugging with predictable authentication behavior independent of timing
        #
        # PROPOSED REQUEST-SCOPED AUTHENTICATION FIX:
        # import threading
        # from contextvars import ContextVar
        # from typing import Optional, Dict, Any
        #
        # # Use context variables for proper request isolation instead of global state
        # request_user_auth: ContextVar[Optional[Dict[str, Any]]] = ContextVar('request_user_auth', default=None)
        #
        # def set_request_scoped_user_auth(user_auth: Dict[str, Any]):
        #     """Set user authentication context scoped to current request."""
        #     request_user_auth.set(user_auth)
        #     logger.info(
        #         "AUTH_CONTEXT_SCOPED: User authentication context set with request isolation",
        #         user_id=user_auth.get("sub", "unknown")[:8] + "...",
        #         context_isolation="REQUEST_SCOPED",
        #         thread_safety="GUARANTEED"
        #     )
        #
        # def get_request_scoped_user_auth() -> Optional[Dict[str, Any]]:
        #     """Get user authentication context for current request only."""
        #     auth_context = request_user_auth.get()
        #     if auth_context:
        #         logger.debug(
        #             "AUTH_CONTEXT_RETRIEVED: Retrieved request-scoped authentication context",
        #             user_id=auth_context.get("sub", "unknown")[:8] + "...",
        #             context_isolation="REQUEST_SCOPED"
        #         )
        #     return auth_context
        #
        # def clear_request_scoped_user_auth():
        #     """Clear user authentication context for current request."""
        #     request_user_auth.set(None)
        #     logger.info(
        #         "AUTH_CONTEXT_CLEARED: Request-scoped authentication context cleared",
        #         context_isolation="REQUEST_SCOPED"
        #     )
        #
        # # Instead of modifying the create_fresh_agent function (complex change),
        # # pass user_auth directly to tools that need it as a parameter:
        # def create_fresh_agent_with_auth_context(enabled_tools, system_prompt, model_id, messages, enabled_connections, user_auth_context):
        #     """Create agent with explicit authentication context passing instead of global state."""
        #     # Pass user_auth_context directly to MCP providers and tools
        #     # This requires modifying MCP provider constructors to accept auth_context parameter
        #     # and pass it through the execution chain instead of relying on global state
        #     return create_agent_with_explicit_auth(enabled_tools, system_prompt, model_id, messages, enabled_connections, user_auth_context)
        #
        # Use request-scoped authentication instead of global state
        set_request_scoped_user_auth(user_auth)

        # DEPRECATED: Keeping global auth for backward compatibility during migration
        set_current_user_auth(user_auth)
        logger.error(
            "RELIABILITY_FAILURE: Using global authentication context - ACTIVE RACE CONDITION VULNERABILITY",
            user_id=user_auth.get("sub", "unknown")[:8] + "...",
            conversation_id=conversation_id,
            enabled_connections_count=len(enabled_connections),
            timestamp=time.time(),
            current_risk_level="CRITICAL",
            potential_impact=[
                "cross_user_data_leakage",
                "authentication_bypass_between_concurrent_users",
                "unpredictable_tool_execution_context",
                "intermittent_permission_errors",
            ],
        )
        logger.info(
            "USER_AUTH_CONTEXT_SET: User authentication context established",
            user_id=user_auth.get("sub", "unknown")[:8] + "...",
            conversation_id=conversation_id,
            enabled_tools_count=len(enabled_tools),
            enabled_connections_count=len(enabled_connections),
            active_kb_ids_count=len(active_kb_ids),
            has_system_prompt=bool(system_prompt),
            model_id=model_id,
            request_timestamp=time.time(),
        )
        logger.debug(
            "REQUEST_DETAILS: Full request parameters",
            user_groups=user_auth.get("groups", []),
            enabled_tools=enabled_tools,
            enabled_connections=enabled_connections,
            active_kb_ids=active_kb_ids,
            has_client_time_info=bool(client_time_info),
            prompt_length=len(prompt),
        )
        request_timestamp = time.time()  # Track total request duration
        try:
            # Progressive summarization already handled in LAYER 1 (DynamoDB loading)
            # Agent will use default context management during execution
            # Remove KB tool if no KBs are active this turn
            if not active_kb_ids and "query_knowledge_base" in enabled_tools:
                logger.info(
                    "KB_TOOL_REMOVAL: Removing query_knowledge_base tool due to no active KBs",
                    original_tools=enabled_tools,
                    active_kb_ids=active_kb_ids,
                )
                enabled_tools = [
                    t for t in enabled_tools if t != "query_knowledge_base"
                ]

            logger.info(
                "AGENT_CREATION_START: Creating fresh agent with tools and connections",
                enabled_tools=enabled_tools,
                enabled_connections=enabled_connections,
                messages_count=len(messages),
                has_system_prompt=bool(system_prompt),
                model_id=model_id,
            )
            agent_creation_start = time.time()
            agent, mcp_clients = create_fresh_agent(
                enabled_tools,
                system_prompt,
                model_id,
                messages,
                enabled_connections,
                locale=client_locale,
            )
            agent_creation_time = time.time() - agent_creation_start
            logger.info(
                "AGENT_CREATION_COMPLETE: Fresh agent created successfully",
                agent_creation_duration_ms=round(agent_creation_time * 1000, 2),
                mcp_clients_count=len(mcp_clients) if mcp_clients else 0,
                agent_type=type(agent).__name__ if agent else "None",
            )

            async def generator() -> AsyncGenerator[bytes, None]:
                stream_start = time.time()
                chunk_count = 0
                total_bytes = 0
                logger.info(
                    "STREAM_START: Beginning agent response streaming without backpressure control",
                    prompt_length=len(prompt),
                    agent_type=type(agent).__name__,
                    mcp_clients_active=len(mcp_clients) if mcp_clients else 0,
                    reliability_status="NO_BACKPRESSURE_CONTROL",
                )

                logger.warning(
                    "RELIABILITY_RISK: Agent response streaming without backpressure control or rate limiting",
                    reliability_concerns=[
                        "no_client_consumption_monitoring",
                        "unlimited_chunk_generation_rate",
                        "potential_memory_pressure_from_fast_generation",
                        "no_flow_control_for_slow_clients",
                    ],
                    streaming_risks=[
                        "memory_buildup_if_client_reads_slowly",
                        "lambda_timeout_from_excessive_buffering",
                        "poor_performance_under_variable_network_conditions",
                        "resource_waste_from_uncontrolled_generation",
                    ],
                )

                # RELIABILITY IMPROVEMENT NEEDED: Implement streaming backpressure and rate limiting
                # RATIONALE: The current implementation generates and yields chunks without any backpressure
                # control or monitoring of client consumption rates. This can lead to memory pressure when
                # clients read slowly or network conditions are poor, causing Lambda timeouts and resource
                # waste from uncontrolled generation rates.
                # CONSEQUENCE OF NOT FIXING: The system experiences performance issues where:
                # - Memory buildup occurs when client reads chunks slower than generation rate
                # - Lambda functions may timeout due to excessive buffering and memory pressure
                # - Poor performance under variable network conditions with slow clients
                # - Resource waste from generating content faster than clients can consume
                # - Unpredictable behavior that depends on network timing and client implementation
                # CONSEQUENCE OF FIXING: With backpressure control, the system would have:
                # - Controlled memory usage regardless of client consumption rate
                # - Better performance under variable network conditions
                # - Predictable resource utilization with rate limiting
                # - Enhanced reliability with flow control mechanisms
                # - Improved user experience with adaptive streaming rates
                #
                # PROPOSED STREAMING BACKPRESSURE FIX:
                # import asyncio
                # from collections import deque
                #
                # class StreamingBackpressureController:
                #     """Control streaming backpressure and rate limiting."""
                #     def __init__(self, max_buffer_size: int = 1024*1024, max_chunks_per_second: int = 100):
                #         self.max_buffer_size = max_buffer_size  # Max buffered bytes
                #         self.max_chunks_per_second = max_chunks_per_second
                #         self.buffer_queue = asyncio.Queue(maxsize=50)  # Max 50 chunks buffered
                #         self.current_buffer_size = 0
                #         self.last_yield_time = 0.0
                #         self.chunks_this_second = 0
                #         self.second_start = time.time()
                #
                #     async def yield_with_backpressure(self, chunk_bytes: bytes):
                #         """Yield chunk with backpressure and rate limiting."""
                #         now = time.time()
                #
                #         # Reset per-second counters
                #         if now - self.second_start >= 1.0:
                #             self.chunks_this_second = 0
                #             self.second_start = now
                #
                #         # Rate limiting
                #         if self.chunks_this_second >= self.max_chunks_per_second:
                #             sleep_time = 1.0 - (now - self.second_start)
                #             if sleep_time > 0:
                #                 logger.debug(
                #                     "STREAMING_RATE_LIMIT: Applying rate limit delay",
                #                     sleep_time_ms=round(sleep_time * 1000, 2),
                #                     chunks_this_second=self.chunks_this_second
                #                 )
                #                 await asyncio.sleep(sleep_time)
                #
                #         # Buffer size monitoring
                #         chunk_size = len(chunk_bytes)
                #         if self.current_buffer_size + chunk_size > self.max_buffer_size:
                #             logger.warning(
                #                 "STREAMING_BACKPRESSURE: Buffer size limit approaching, applying backpressure",
                #                 current_buffer_size=self.current_buffer_size,
                #                 chunk_size=chunk_size,
                #                 max_buffer_size=self.max_buffer_size
                #             )
                #             # Apply backpressure by waiting
                #             await asyncio.sleep(0.01)  # Small delay to allow client to catch up
                #
                #         self.current_buffer_size += chunk_size
                #         self.chunks_this_second += 1
                #         return chunk_bytes
                #
                #     def mark_chunk_consumed(self, chunk_size: int):
                #         """Mark chunk as consumed by client."""
                #         self.current_buffer_size = max(0, self.current_buffer_size - chunk_size)
                #
                # backpressure_controller = StreamingBackpressureController()

                try:
                    # Do not include the prompt inside messages; provide it here only
                    async for chunk in _stream_agent_events(agent, prompt):
                        chunk_bytes = chunk.encode("utf-8")
                        chunk_count += 1
                        total_bytes += len(chunk_bytes)

                        yield chunk_bytes

                    stream_duration = time.time() - stream_start
                    logger.info(
                        "STREAM_COMPLETE: Agent response streaming finished",
                        total_chunks=chunk_count,
                        total_bytes=total_bytes,
                        stream_duration_ms=round(stream_duration * 1000, 2),
                        avg_bytes_per_chunk=round(
                            total_bytes / chunk_count if chunk_count > 0 else 0, 2
                        ),
                    )
                finally:
                    cleanup_start = time.time()
                    try:
                        logger.info(
                            "CLEANUP_START: Beginning MCP client cleanup",
                            clients_to_cleanup=len(mcp_clients) if mcp_clients else 0,
                        )
                        cleanup_mcp_clients(mcp_clients)
                        cleanup_duration = time.time() - cleanup_start
                        logger.info(
                            "CLEANUP_COMPLETE: MCP client cleanup successful",
                            cleanup_duration_ms=round(cleanup_duration * 1000, 2),
                        )
                    except Exception as e:  # pylint: disable=broad-except
                        logger.warning("MCP client cleanup failed", error=str(e))
                        logger.error(
                            "CLEANUP_FAILED: MCP client cleanup encountered error",
                            error_type=type(e).__name__,
                            error_message=str(e),
                            cleanup_duration_ms=round(
                                (time.time() - cleanup_start) * 1000, 2
                            ),
                        )
                    # Clear per-request user auth context after streaming completes
                    try:
                        clear_current_user_auth()
                        logger.warning(
                            "SECURITY_RISK: User auth context cleared - tools may lose authentication if still executing",
                            timestamp=time.time(),
                        )
                        logger.info(
                            "AUTH_CONTEXT_CLEARED: User authentication context cleared",
                            total_request_duration_ms=round(
                                (time.time() - request_timestamp) * 1000, 2
                            ),
                            timestamp=time.time(),
                        )
                    except Exception:
                        pass

            return StreamingResponse(
                generator(),
                media_type="application/x-ndjson",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
                status_code=200,
            )
        finally:
            # Do not clear auth context here for streaming responses.
            # The generator runs after this function returns; clearing here would
            # remove context needed by downstream tools/prompts (e.g., local time).
            # Auth context is cleared in the generator's finally block instead.
            pass
    except Exception as exc:  # pylint: disable=broad-except
        # Ensure any previously set auth context is cleared on failure paths
        try:
            clear_current_user_auth()
        except Exception:
            pass
        logger.error("HTTP stream handler failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.post("/api/numa-chat-agent/invoke")
async def http_invoke(request: Request) -> Response:
    """Non-streaming invocation that returns a single JSON result.

    Mirrors the auth/body parsing of the streaming route, but buffers the
    response by aggregating token deltas into a final string.
    """
    try:
        headers = {k.lower(): v for k, v in request.headers.items()}
        if CF_SHARED_SECRET:
            if headers.get("x-arcanum-cloudfront-secret") != CF_SHARED_SECRET:
                return JSONResponse({"error": "Forbidden"}, status_code=403)

        auth = headers.get("authorization")
        body = await request.json()

        internal_user_override: Optional[dict] = None
        if (
            SCHEDULE_RUNNER_SECRET
            and auth == f"Bearer {SCHEDULE_RUNNER_SECRET}"
            and isinstance(body, dict)
        ):
            internal_user_override = body.get("internalUser") or {}

        if internal_user_override:
            if not internal_user_override.get("sub"):
                return JSONResponse(
                    {"error": "Missing internal user context"}, status_code=400
                )
            user = internal_user_override
        else:
            if not auth:
                return JSONResponse(
                    {"error": "Missing Authorization header"}, status_code=401
                )
            user = _verify_jwt_token(auth)

        prompt: str = (body.get("prompt") or "").strip()
        if not prompt:
            return JSONResponse({"error": "Missing prompt"}, status_code=400)

        conversation_id: Optional[str] = body.get("conversationId")
        enabled_tools = (
            body.get("enabledTools", ["query_knowledge_base", "web_search"]) or []
        )
        enabled_connections = body.get("enabledConnections", []) or []
        system_prompt = body.get("systemPrompt", "") or ""
        model_id = body.get("modelId")
        user_id = user.get("sub")

        # Multi‑KB: compute per‑turn active KBs = request list ∩ allowed list
        requested_kbs_raw = body.get("enabledKBIds") or []
        requested_kb_ids: list[str] = []
        if isinstance(requested_kbs_raw, list):
            for v in requested_kbs_raw:
                if isinstance(v, str) and v.strip():
                    requested_kb_ids.append(v.strip())
        # Allowed = 'company' and any user-accessible KBs from Dynamo
        allowed_kb_ids: set[str] = {"company"}
        try:
            if isinstance(user_id, str) and user_id:
                kb_manager = KnowledgeBaseManager()
                for m in kb_manager.list_user_kbs(user_id) or []:
                    kid = m.get("kb_id")
                    if isinstance(kid, str) and kid.strip():
                        allowed_kb_ids.add(kid.strip())
        except Exception as e:  # defensive
            logger.warning(
                "Failed to load user KBs (invoke); defaulting allowed set to 'company' only",
                error=str(e),
            )
        active_kb_ids: list[str] = [
            kid for kid in requested_kb_ids if kid in allowed_kb_ids
        ]

        # Capture optional client-local time info for downstream tools/prompts
        client_time_info = body.get("timeInfo") or {}

        # Capture optional client locale for language preference
        client_locale = body.get("locale") or {}

        user_auth = {
            **(
                {
                    "sub": user.get("sub"),
                    "email": user.get("email"),
                    "groups": user.get("cognito:groups", []),
                }
            ),
            **(body.get("userAuth") or {}),
            "enabled_kb_ids": active_kb_ids,
            "conversation_id": conversation_id,
            "conversationId": conversation_id,
        }
        if client_time_info:
            try:
                if isinstance(client_time_info, dict):
                    user_auth["timeInfo"] = client_time_info
                else:
                    user_auth["timeInfo"] = {"raw": client_time_info}
            except Exception:  # defensive
                user_auth["timeInfo"] = {"raw": str(client_time_info)}

        messages = _build_messages_from_history(conversation_id, user_auth, prompt)

        if not enabled_tools:
            messages = convert_tool_blocks_to_text(messages)
        messages = process_messages_with_file_refs(messages)
        # Set both new scoped auth and legacy global auth during migration
        set_request_scoped_user_auth(user_auth)
        set_current_user_auth(user_auth)

        try:
            # Progressive summarization already handled in LAYER 1 (DynamoDB loading)
            # Agent will use default context management during execution
            # Remove KB tool if no KBs are active this turn
            if not active_kb_ids and "query_knowledge_base" in enabled_tools:
                enabled_tools = [
                    t for t in enabled_tools if t != "query_knowledge_base"
                ]
            agent, mcp_clients = create_fresh_agent(
                enabled_tools,
                system_prompt,
                model_id,
                messages,
                enabled_connections,
                locale=client_locale,
            )

            try:
                # Aggregate token deltas into a single string
                text_out: list[str] = []
                async for ev in agent.stream_async(prompt):
                    # Common places for token deltas without exceptions
                    delta_text = None
                    if isinstance(ev, dict):
                        maybe_delta = ev.get("delta")
                        if isinstance(maybe_delta, dict):
                            maybe_text = maybe_delta.get("text")
                            if isinstance(maybe_text, str):
                                delta_text = maybe_text
                    if isinstance(delta_text, str):
                        text_out.append(delta_text)
                        continue
                    if isinstance(ev, dict):
                        data_val = ev.get("data")
                        if isinstance(data_val, str):
                            text_out.append(data_val)
                # Finished; build final response
                final_text = "".join(text_out)
                return JSONResponse(
                    {
                        "type": "result",
                        "content": final_text,
                        "stop_reason": "complete",
                    }
                )
            except Exception as e:  # pylint: disable=broad-except
                logger.error("invoke failed", error=str(e), exc_info=True)
                return JSONResponse(
                    {"error": str(e) or "Invoke failed"}, status_code=500
                )
            finally:
                try:
                    cleanup_mcp_clients(mcp_clients)
                except Exception as e:  # pylint: disable=broad-except
                    logger.warning("MCP client cleanup failed (invoke)", error=str(e))
        finally:
            clear_current_user_auth()
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("HTTP invoke handler failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)
