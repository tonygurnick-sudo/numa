from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import jwt
import requests
import structlog
from boto3.dynamodb.conditions import Key
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from jwt import algorithms

from prm import client as prm_client
from prm import resource as prm_resource

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
from .kb_manager import KnowledgeBaseManager
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
_COGNITO_CLIENT = None


def _get_cognito_client():
    """Get cached Cognito client with PRM tracking."""
    global _COGNITO_CLIENT  # pylint: disable=global-statement
    if _COGNITO_CLIENT is None:
        _COGNITO_CLIENT = prm_client("cognito-idp", region=REGION)
    return _COGNITO_CLIENT


def _is_email(value: str) -> bool:
    """Check if a string looks like an email address."""
    return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", value))


def _resolve_email_to_sub(email: str, cognito_client) -> Optional[str]:
    """
    Resolve an email address to a Cognito sub ID.

    Args:
        email: Email address to resolve
        cognito_client: Boto3 Cognito client

    Returns:
        Cognito sub ID if found, None otherwise
    """
    try:
        response = cognito_client.list_users(
            UserPoolId=USER_POOL_ID, Filter=f'email = "{email}"', Limit=1
        )
        users = response.get("Users", [])
        if not users:
            logger.warning("Email not found in Cognito", email=email)
            return None

        for attr in users[0].get("Attributes", []):
            if attr.get("Name") == "sub":
                sub_id = attr.get("Value")
                if sub_id:
                    logger.info("Resolved email to sub", email=email, sub=sub_id)
                    return sub_id

        logger.warning("User found but no sub attribute", email=email)
        return None
    except Exception as e:
        logger.error("Error resolving email", email=email, error=str(e))
        return None


def _resolve_user_identifiers(identifiers: List[str]) -> tuple[List[str], List[str]]:
    """
    Resolve a mix of emails and Cognito sub IDs to Cognito sub IDs.

    Args:
        identifiers: List of email addresses or Cognito sub IDs

    Returns:
        Tuple of (resolved Cognito sub IDs, unresolved inputs)
    """
    if not identifiers:
        return [], []

    resolved = []
    unresolved = []
    cognito_client = _get_cognito_client()

    for identifier in identifiers:
        identifier = identifier.strip()
        if not identifier:
            continue

        # If it's a wildcard, pass through
        if identifier == "*":
            resolved.append(identifier)
            continue

        # If it looks like a UUID (Cognito sub), pass through
        if re.match(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            identifier.lower(),
        ):
            resolved.append(identifier)
            continue

        # If it looks like an email, resolve to sub ID
        if _is_email(identifier):
            sub_id = _resolve_email_to_sub(identifier, cognito_client)
            if sub_id:
                resolved.append(sub_id)
            else:
                unresolved.append(identifier)
        else:
            # Unknown format, mark unresolved
            unresolved.append(identifier)

    return resolved, unresolved


def _resolve_sub_to_email(sub_id: str, cognito_client) -> Optional[str]:
    """
    Resolve a Cognito sub ID to an email address.

    Args:
        sub_id: Cognito sub ID (UUID)
        cognito_client: Boto3 Cognito client

    Returns:
        Email address if found, None otherwise
    """
    try:
        response = cognito_client.admin_get_user(
            UserPoolId=USER_POOL_ID, Username=sub_id
        )

        for attr in response.get("UserAttributes", []):
            if attr.get("Name") == "email":
                email = attr.get("Value")
                if email:
                    logger.debug("Resolved sub to email", sub=sub_id, email=email)
                    return email

        logger.warning("User found but no email attribute", sub=sub_id)
        return None
    except cognito_client.exceptions.UserNotFoundException:
        logger.warning("User not found in Cognito", sub=sub_id)
        return None
    except Exception as e:
        logger.error("Error resolving sub to email", sub=sub_id, error=str(e))
        return None


def _resolve_subs_to_emails(sub_ids: List[str]) -> List[str]:
    """
    Resolve a list of Cognito sub IDs to email addresses.

    Args:
        sub_ids: List of Cognito sub IDs

    Returns:
        List of email addresses (skips any that can't be resolved)
    """
    if not sub_ids:
        return []

    emails = []
    cognito_client = _get_cognito_client()

    for sub_id in sub_ids:
        if not sub_id or sub_id == "*":
            continue

        email = _resolve_sub_to_email(sub_id, cognito_client)
        if email:
            emails.append(email)

    return emails


def _count_s3_documents(bucket_name: str, prefix: str) -> int:
    """
    Count the number of documents in an S3 bucket prefix.

    Args:
        bucket_name: S3 bucket name
        prefix: S3 prefix to search (e.g., "documents/kb-123/")

    Returns:
        Count of objects in the prefix (excluding metadata.json files)
    """
    try:
        s3_client = prm_client("s3", region=REGION)
        paginator = s3_client.get_paginator("list_objects_v2")

        count = 0
        for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            contents = page.get("Contents", [])
            # Filter out:
            # - Directories (keys ending with "/")
            # - metadata.json files
            for obj in contents:
                # Pyright: ObjectTypeDef["Key"] is not guaranteed; access safely
                key_val = obj.get("Key") if isinstance(obj, dict) else None
                if not isinstance(key_val, str):
                    continue
                if not key_val.endswith("/") and not key_val.endswith("metadata.json"):
                    count += 1

        logger.debug(
            "Counted S3 documents", bucket=bucket_name, prefix=prefix, count=count
        )
        return count
    except Exception as e:
        logger.error(
            "Error counting S3 documents",
            bucket=bucket_name,
            prefix=prefix,
            error=str(e),
        )
        # Return 0 on error rather than failing the whole request
        return 0


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


# Knowledge Base Management Endpoints


@app.post("/api/kb")
async def create_kb(request: Request) -> Response:
    """Create a new knowledge base.

    Body:
        {
            "name": "KB display name",
            "viewers": ["user_id1", "user_id2"] or ["*"] for all users,
            "editors": ["user_id1"]
        }
    """
    try:
        headers = {k.lower(): v for k, v in request.headers.items()}
        if CF_SHARED_SECRET:
            if headers.get("x-arcanum-cloudfront-secret") != CF_SHARED_SECRET:
                return JSONResponse({"error": "Forbidden"}, status_code=403)

        auth = headers.get("authorization")
        if not auth:
            return JSONResponse(
                {"error": "Missing Authorization header"}, status_code=401
            )

        user = _verify_jwt_token(auth)
        body = await request.json()

        name = body.get("name", "").strip()
        if not name:
            return JSONResponse({"error": "Missing name"}, status_code=400)

        viewers = body.get("viewers", [])
        editors = body.get("editors", [])

        # Resolve emails to Cognito sub IDs
        resolved_viewers, unresolved_viewers = _resolve_user_identifiers(viewers)
        resolved_editors, unresolved_editors = _resolve_user_identifiers(editors)

        unresolved_inputs = list(set(unresolved_viewers + unresolved_editors))
        if unresolved_inputs:
            return JSONResponse(
                {
                    "error": "Some users could not be resolved by email or ID",
                    "unresolved": unresolved_inputs,
                },
                status_code=400,
            )

        # Get user sub (required for KB creation)
        user_sub = user.get("sub")
        if not isinstance(user_sub, str) or not user_sub:
            return JSONResponse({"error": "Invalid user ID"}, status_code=401)

        # Initialize KB manager
        kb_manager = KnowledgeBaseManager()

        # Create KB
        kb = kb_manager.create_kb(
            name=name,
            created_by=user_sub,
            viewers=resolved_viewers,
            editors=resolved_editors,
        )

        logger.info("KB created", kb_id=kb["kb_id"], created_by=user.get("sub"))
        return JSONResponse({"status": "success", "kb": kb}, status_code=201)

    except ValueError as e:
        logger.warning("KB creation validation error", error=str(e))
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB creation failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.get("/api/kb")
async def list_user_kbs(request: Request) -> Response:
    """List all KBs accessible to the current user."""
    try:
        headers = {k.lower(): v for k, v in request.headers.items()}
        if CF_SHARED_SECRET:
            if headers.get("x-arcanum-cloudfront-secret") != CF_SHARED_SECRET:
                return JSONResponse({"error": "Forbidden"}, status_code=403)

        auth = headers.get("authorization")
        if not auth:
            return JSONResponse(
                {"error": "Missing Authorization header"}, status_code=401
            )

        user = _verify_jwt_token(auth)
        user_id = user.get("sub")
        if not isinstance(user_id, str) or not user_id:
            return JSONResponse({"error": "Invalid user ID"}, status_code=401)

        # Initialize KB manager
        kb_manager = KnowledgeBaseManager()

        # List user's KBs
        kbs = kb_manager.list_user_kbs(user_id)

        return JSONResponse({"status": "success", "kbs": kbs}, status_code=200)

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB list failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.get("/api/kb/{kb_id}")
async def get_kb(request: Request, kb_id: str) -> Response:
    """Get details of a specific KB (if user has permission)."""
    try:
        headers = {k.lower(): v for k, v in request.headers.items()}
        if CF_SHARED_SECRET:
            if headers.get("x-arcanum-cloudfront-secret") != CF_SHARED_SECRET:
                return JSONResponse({"error": "Forbidden"}, status_code=403)

        auth = headers.get("authorization")
        if not auth:
            return JSONResponse(
                {"error": "Missing Authorization header"}, status_code=401
            )

        user = _verify_jwt_token(auth)
        user_id = user.get("sub")
        if not isinstance(user_id, str) or not user_id:
            return JSONResponse({"error": "Invalid user ID"}, status_code=401)

        # Initialize KB manager
        kb_manager = KnowledgeBaseManager()

        # Check permission
        if not kb_manager.check_permission(kb_id, user_id, "VIEWER"):
            return JSONResponse({"error": "Access denied"}, status_code=403)

        # Get KB
        kb = kb_manager.get_kb(kb_id)
        if not kb:
            return JSONResponse({"error": "KB not found"}, status_code=404)

        # Note: document_count is returned from DynamoDB cache.
        # It's updated when the user views KB files via GET /api/kb/{kb_id}/files.
        # This avoids redundant S3 listings on every KB info request.

        # Enrich KB data with editor emails
        editors = kb.get("editors", [])
        if editors:
            editor_emails = _resolve_subs_to_emails(editors)
            kb["editor_emails"] = editor_emails
        else:
            kb["editor_emails"] = []

        # Also add viewer emails (excluding wildcard)
        viewers = kb.get("viewers", [])
        viewer_subs = [v for v in viewers if v != "*"]
        if viewer_subs:
            viewer_emails = _resolve_subs_to_emails(viewer_subs)
            kb["viewer_emails"] = viewer_emails
        else:
            kb["viewer_emails"] = []

        return JSONResponse({"status": "success", "kb": kb}, status_code=200)

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB get failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


# Environment variables for KB state
PREFERRED_KNOWLEDGE_BASE = os.environ.get("PREFERRED_KNOWLEDGE_BASE", "bedrock")
BEDROCK_KNOWLEDGE_BASE_ID = os.environ.get("BEDROCK_KNOWLEDGE_BASE_ID")
Q_APPLICATION_ID = os.environ.get("Q_APPLICATION_ID")
Q_INDEX_ID = os.environ.get("Q_INDEX_ID")
CRAWL_URLS_TABLE_NAME = os.environ.get("CRAWL_URLS_TABLE_NAME")


def _sanitize_failed_s3_uri(uri: str) -> Optional[str]:
    """Clean up S3 URI from failure reason messages."""
    if not uri:
        return None
    trimmed = uri.strip()
    if not trimmed:
        return None
    # Remove diagnostic suffix like " (error details)"
    without_suffix = re.sub(r"\s+\([^)]*\)$", "", trimmed)
    # Remove trailing punctuation
    cleaned = re.sub(r"[;.,]+$", "", without_suffix)
    return cleaned if cleaned.startswith("s3://") else None


def _extract_failed_doc_from_uri(
    uri: str, job_updated_at: Any
) -> Optional[Dict[str, Any]]:
    """Extract a failed document entry from an S3 URI."""
    sanitized = _sanitize_failed_s3_uri(uri)
    if not sanitized:
        return None

    # Extract filename from URI
    key_match = re.search(r"[^/]+$", sanitized)
    filename = key_match.group(0) if key_match else sanitized

    return {
        "documentId": sanitized,
        "status": "FAILED",
        "updatedAt": (
            job_updated_at.isoformat()
            if hasattr(job_updated_at, "isoformat")
            else str(job_updated_at)
        ),
        "error": {
            "errorMessage": "File format not supported or processing failed during ingestion"
        },
        "fileName": filename,
    }


def _collect_failed_docs_from_job(
    bedrock_agent: Any,
    kb_id: str,
    data_source_id: str,
    job: Dict[str, Any],
    s3_uri_pattern: re.Pattern,
) -> List[Dict[str, Any]]:
    """Collect failed documents from a single ingestion job."""
    try:
        job_details = bedrock_agent.get_ingestion_job(
            knowledgeBaseId=kb_id,
            dataSourceId=data_source_id,
            ingestionJobId=job.get("ingestionJobId"),
        )
        failure_reasons = (
            job_details.get("ingestionJob", {}).get("failureReasons") or []
        )
        job_updated = job.get("updatedAt", "")
        failed_docs: List[Dict[str, Any]] = []

        for reason in failure_reasons:
            for uri in s3_uri_pattern.findall(reason):
                failed_doc = _extract_failed_doc_from_uri(uri, job_updated)
                if failed_doc:
                    failed_docs.append(failed_doc)
        return failed_docs
    except Exception as job_err:
        logger.debug(
            "Error fetching ingestion job details",
            job_id=job.get("ingestionJobId"),
            error=str(job_err),
        )
        return []


def _filter_documents_by_prefix(
    documents: List[Dict[str, Any]], s3_prefix_filter: str, kb_type: str
) -> List[Dict[str, Any]]:
    """Filter documents based on KB type and S3 prefix."""
    if not documents:
        return []
    if not s3_prefix_filter or not kb_type:
        return documents

    filtered = []
    for doc in documents:
        s3_uri = doc.get("documentId", "")
        if kb_type == "user":
            # For user KBs: only include documents in the specific user KB prefix
            if s3_prefix_filter in s3_uri:
                filtered.append(doc)
        elif kb_type == "company":
            # For company KB: include documents/company/ prefix
            if s3_prefix_filter in s3_uri or (
                "documents/company/" in s3_uri and "documents/kb-" not in s3_uri
            ):
                filtered.append(doc)
        else:
            filtered.append(doc)
    return filtered


def _compute_kb_metrics(
    filtered_docs: List[Dict[str, Any]], failed_docs: List[Dict[str, Any]]
) -> Dict[str, int]:
    """
    Compute sync metrics specific to a KB's filtered documents.

    Instead of using global job statistics (which are shared across all KBs),
    compute metrics from the already-filtered document list for accurate per-KB stats.
    """
    # Count documents by status - Bedrock uses 'status' field directly
    indexed = sum(1 for d in filtered_docs if d.get("status") == "INDEXED")
    failed = len(failed_docs)
    # Pending = total docs minus indexed (failed docs are tracked separately)
    pending = len(filtered_docs) - indexed

    return {
        "documentsIndexed": indexed,
        "documentsFailed": failed,
        "documentsPending": pending,
        "totalDocuments": len(filtered_docs),
    }


def _serialize_datetime(obj: Any) -> Any:
    """Recursively convert datetime objects to ISO format strings."""
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _serialize_datetime(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize_datetime(item) for item in obj]
    return obj


def _serialize_data_sources(sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Serialize datetime fields in data source objects for JSON response."""
    return [_serialize_datetime(source) for source in sources]


def _check_web_crawler_content_exists(domain: str, kb_id: str) -> bool:
    """
    Check if any web crawler content exists in S3 for the given domain.

    This validates that DynamoDB crawl entries have corresponding S3 content,
    filtering out orphaned metadata entries where crawls failed or content
    was never uploaded.

    Args:
        domain: The domain to check (e.g., "www.example.com")
        kb_id: The knowledge base ID ("company" or a specific KB ID)

    Returns:
        True if content exists in S3, False otherwise
    """
    if not CLIENT_NAME or not domain:
        return False

    try:
        s3_client = prm_client("s3", region=REGION)
        bucket_name = f"numa-{CLIENT_NAME}-data"

        if kb_id == "company":
            prefix = f"documents/company/web-crawler/{domain}/"
        else:
            prefix = f"documents/kb-{kb_id}/web-crawler/{domain}/"

        response = s3_client.list_objects_v2(
            Bucket=bucket_name,
            Prefix=prefix,
            MaxKeys=1,
        )
        return response.get("KeyCount", 0) > 0
    except Exception as e:
        logger.warning(
            "Error checking web crawler content",
            domain=domain,
            kb_id=kb_id,
            error=str(e),
        )
        return False


def _get_web_crawler_stats(kb_id: str) -> List[Dict[str, Any]]:
    """
    Fetch web crawler stats from DynamoDB crawl URLs table.

    Returns seed URLs (the actual URLs users submitted) with page counts.
    Falls back to domain aggregation for older crawls without isSeedUrl field.
    """
    if not CRAWL_URLS_TABLE_NAME:
        return []

    try:
        dynamodb = prm_resource("dynamodb")
        table = dynamodb.Table(CRAWL_URLS_TABLE_NAME)

        # Query completed URLs for this KB using the kbId-status-index GSI
        response = table.query(
            IndexName="kbId-status-index",
            KeyConditionExpression=Key("kbId").eq(kb_id)
            & Key("status").eq("completed"),
            Limit=2000,
        )

        items = response.get("Items", [])
        if not items:
            return []

        # Separate seed URLs from regular URLs
        seed_urls: List[Dict[str, Any]] = []
        urls_by_session: Dict[str, List[Dict[str, Any]]] = {}

        for item in items:
            session_id = item.get("crawlSessionId", "unknown")
            urls_by_session.setdefault(session_id, []).append(item)

            # Check if this is a seed URL
            if item.get("isSeedUrl"):
                seed_urls.append(item)

        # If we have seed URLs, use them as data sources
        if seed_urls:
            data_sources = []
            for seed in seed_urls:
                url = seed.get("url", "")
                session_id = seed.get("crawlSessionId", "unknown")
                domain = urlparse(url).netloc

                # Count pages in this crawl session
                session_pages = urls_by_session.get(session_id, [])
                page_count = len(session_pages)

                # Find the most recent update time in the session
                last_crawled = None
                for page in session_pages:
                    updated = page.get("updatedAt") or page.get("createdAt")
                    if updated and (last_crawled is None or updated > last_crawled):
                        last_crawled = updated

                # Convert datetime to ISO string
                if last_crawled and hasattr(last_crawled, "isoformat"):
                    last_crawled = last_crawled.isoformat()

                data_sources.append(
                    {
                        "dataSourceId": f"web-crawler-{session_id}",
                        "name": url,
                        "displayName": url,
                        "type": "Numa Web Crawler",
                        "status": "ACTIVE",
                        "pageCount": page_count,
                        "lastCrawled": last_crawled,
                        "isWebCrawler": True,
                        "domain": domain,
                        "sourceUrl": url,
                        "isSeedUrl": True,
                    }
                )

            # Filter to only include domains with actual S3 content
            # This handles cases where DynamoDB has entries but crawl content
            # was never uploaded to S3 (e.g., crawl failures, timeouts)
            data_sources = [
                ds
                for ds in data_sources
                if _check_web_crawler_content_exists(ds.get("domain", ""), kb_id)
            ]

            # Sort by last crawled desc
            data_sources.sort(
                key=lambda d: (d.get("lastCrawled") or "", d.get("name") or ""),
                reverse=True,
            )
            return data_sources

        # Fallback: aggregate by domain for older crawls without isSeedUrl
        domains: Dict[str, Dict[str, Any]] = {}
        for item in items:
            url = item.get("url")
            if not url:
                continue
            domain = urlparse(url).netloc
            if not domain:
                continue

            entry = domains.setdefault(
                domain, {"domain": domain, "pageCount": 0, "lastCrawled": None}
            )
            entry["pageCount"] += 1

            updated = item.get("updatedAt") or item.get("createdAt")
            if updated and (
                entry["lastCrawled"] is None or updated > entry["lastCrawled"]
            ):
                entry["lastCrawled"] = updated

        # Convert to data source format
        data_sources = []
        for entry in domains.values():
            domain_url = f"https://{entry['domain']}"
            # Convert lastCrawled datetime to ISO string
            last_crawled = entry["lastCrawled"]
            if last_crawled and hasattr(last_crawled, "isoformat"):
                last_crawled = last_crawled.isoformat()
            data_sources.append(
                {
                    "dataSourceId": f"web-crawler-{entry['domain']}",
                    "name": domain_url,
                    "displayName": domain_url,
                    "type": "Numa Web Crawler",
                    "status": "ACTIVE",
                    "pageCount": entry["pageCount"],
                    "lastCrawled": last_crawled,
                    "isWebCrawler": True,
                    "domain": entry["domain"],
                    "sourceUrl": domain_url,
                }
            )

        # Filter to only include domains with actual S3 content
        # This handles cases where DynamoDB has entries but crawl content
        # was never uploaded to S3 (e.g., crawl failures, timeouts)
        data_sources = [
            ds
            for ds in data_sources
            if _check_web_crawler_content_exists(ds.get("domain", ""), kb_id)
        ]

        # Sort by last crawled desc
        data_sources.sort(
            key=lambda d: (d.get("lastCrawled") or "", d.get("domain") or ""),
            reverse=True,
        )
        return data_sources

    except Exception as e:
        logger.warning("Failed to fetch web crawler stats", kb_id=kb_id, error=str(e))
        return []


def _get_bedrock_kb_state(
    kb_id: str, s3_prefix_filter: str, kb_type: str
) -> Dict[str, Any]:
    """
    Get KB state from Bedrock Knowledge Base.

    Returns data sources, ingestion jobs, documents, and failed documents.
    """
    if not BEDROCK_KNOWLEDGE_BASE_ID:
        return {"error": "Bedrock Knowledge Base ID not configured"}

    try:
        bedrock_agent = prm_client("bedrock-agent", region=REGION)
        client_display_name = f"numa-{CLIENT_NAME}".lower()

        # List data sources
        ds_resp = bedrock_agent.list_data_sources(
            knowledgeBaseId=BEDROCK_KNOWLEDGE_BASE_ID
        )
        summaries = ds_resp.get("dataSourceSummaries", [])

        if not summaries:
            return {
                "error": "no-data-source",
                "message": "No Bedrock data source found",
                "dataSources": [],
                "source": "bedrock",
            }

        # Find matching data source
        ds = None
        for s in summaries:
            name = (s.get("name") or "").lower()
            display = (s.get("displayName") or "").lower()
            if (
                name == client_display_name
                or display == client_display_name
                or name.startswith(client_display_name)
            ):
                ds = s
                break
        if not ds:
            ds = summaries[0]

        data_source_id = ds.get("dataSourceId")

        # List ingestion jobs (sorted by most recent)
        job_resp = bedrock_agent.list_ingestion_jobs(
            knowledgeBaseId=BEDROCK_KNOWLEDGE_BASE_ID,
            dataSourceId=data_source_id,
            maxResults=10,
            sortBy={"attribute": "STARTED_AT", "order": "DESCENDING"},
        )
        ingestion_jobs = job_resp.get("ingestionJobSummaries", [])
        latest_job = ingestion_jobs[0] if ingestion_jobs else None
        last_success = next(
            (j for j in ingestion_jobs if j.get("status") == "COMPLETE"), None
        )

        # Get failed documents from recent ingestion jobs
        failed_documents_map: Dict[str, Dict[str, Any]] = {}
        recent_jobs = ingestion_jobs[:3]
        s3_uri_pattern = re.compile(r"s3://[^,;\]]+")

        for job in recent_jobs:
            job_failed_docs = _collect_failed_docs_from_job(
                bedrock_agent,
                BEDROCK_KNOWLEDGE_BASE_ID,
                data_source_id,
                job,
                s3_uri_pattern,
            )
            for doc in job_failed_docs:
                if doc["documentId"] not in failed_documents_map:
                    failed_documents_map[doc["documentId"]] = doc

        failed_documents = list(failed_documents_map.values())

        # List all KB documents (paginated)
        docs: List[Dict[str, Any]] = []
        next_token = None
        while True:
            list_params: Dict[str, Any] = {
                "knowledgeBaseId": BEDROCK_KNOWLEDGE_BASE_ID,
                "dataSourceId": data_source_id,
            }
            if next_token:
                list_params["nextToken"] = next_token

            doc_resp = bedrock_agent.list_knowledge_base_documents(**list_params)
            raw_docs = doc_resp.get("documentDetails", [])

            # Normalize document format
            for doc in raw_docs:
                identifier = doc.get("identifier", {})
                s3_info = identifier.get("s3", {})
                if s3_info.get("uri"):
                    doc["documentId"] = s3_info["uri"]
                docs.append(doc)

            next_token = doc_resp.get("nextToken")
            if not next_token:
                break

        # Map Bedrock status to expected UI status
        def map_status(status: Optional[str]) -> Optional[str]:
            if status == "IN_PROGRESS":
                return "SYNCING"
            if status == "COMPLETE":
                return "SUCCEEDED"
            return status

        # Filter documents by S3 prefix
        filtered_docs = _filter_documents_by_prefix(docs, s3_prefix_filter, kb_type)
        filtered_failed = _filter_documents_by_prefix(
            failed_documents, s3_prefix_filter, kb_type
        )

        return {
            "dataSourceId": data_source_id,
            "syncStatus": ds.get("status"),
            "syncJobStatus": map_status(
                latest_job.get("status") if latest_job else None
            ),
            "lastSuccessfulSync": (
                last_success.get("updatedAt").isoformat()
                if last_success and hasattr(last_success.get("updatedAt"), "isoformat")
                else str(last_success.get("updatedAt", "")) if last_success else None
            ),
            "lastUpdated": (
                (latest_job.get("updatedAt") or latest_job.get("startedAt")).isoformat()
                if latest_job
                and hasattr(
                    latest_job.get("updatedAt") or latest_job.get("startedAt"),
                    "isoformat",
                )
                else str(latest_job.get("updatedAt", "")) if latest_job else None
            ),
            "syncMetrics": _compute_kb_metrics(filtered_docs, filtered_failed),
            "documents": _serialize_datetime(filtered_docs),
            "dataSources": _serialize_data_sources(summaries)
            + _get_web_crawler_stats(kb_id),
            "failedDocuments": _serialize_datetime(filtered_failed),
            "source": "bedrock",
        }

    except Exception as e:
        logger.error("Error getting Bedrock KB state", error=str(e), exc_info=True)
        return {"error": str(e), "source": "bedrock"}


def _get_qbusiness_kb_state(
    kb_id: str, s3_prefix_filter: str, kb_type: str
) -> Dict[str, Any]:
    """
    Get KB state from Q Business.

    Returns data sources, sync jobs, and documents.
    """
    if not Q_APPLICATION_ID or not Q_INDEX_ID:
        return {"error": "Q Business Application or Index ID not configured"}

    try:
        qbusiness = prm_client("qbusiness", region=REGION)
        client_display_name = f"numa-{CLIENT_NAME}"

        # List data sources
        ds_resp = qbusiness.list_data_sources(
            applicationId=Q_APPLICATION_ID, indexId=Q_INDEX_ID
        )
        all_data_sources = ds_resp.get("dataSources", [])

        if not all_data_sources:
            return {
                "error": "no-data-source",
                "message": "No Q Business data source found",
                "dataSources": [],
                "source": "q-business",
            }

        # Find matching data source
        ds = next(
            (
                d
                for d in all_data_sources
                if d.get("displayName") == client_display_name
            ),
            all_data_sources[0],
        )

        data_source_id = ds.get("dataSourceId")

        # List sync jobs
        job_resp = qbusiness.list_data_source_sync_jobs(
            applicationId=Q_APPLICATION_ID,
            indexId=Q_INDEX_ID,
            dataSourceId=data_source_id,
            maxResults=10,
        )
        job_history = job_resp.get("history", [])
        latest_job = job_history[0] if job_history else None
        last_success = next(
            (j for j in job_history if j.get("status") in ("SUCCEEDED", "INCOMPLETE")),
            None,
        )

        # List all documents (paginated)
        docs: List[Dict[str, Any]] = []
        next_token = None
        while True:
            list_params: Dict[str, Any] = {
                "applicationId": Q_APPLICATION_ID,
                "indexId": Q_INDEX_ID,
                "dataSourceIds": [data_source_id],
            }
            if next_token:
                list_params["nextToken"] = next_token

            doc_resp = qbusiness.list_documents(**list_params)
            docs.extend(doc_resp.get("documentDetailList", []))

            next_token = doc_resp.get("nextToken")
            if not next_token:
                break

        # Filter documents by S3 prefix
        filtered_docs = _filter_documents_by_prefix(docs, s3_prefix_filter, kb_type)

        return {
            "dataSourceId": data_source_id,
            "syncStatus": ds.get("status"),
            "syncJobStatus": latest_job.get("status") if latest_job else None,
            "lastSuccessfulSync": (
                last_success.get("endTime").isoformat()
                if last_success and hasattr(last_success.get("endTime"), "isoformat")
                else str(last_success.get("endTime", "")) if last_success else None
            ),
            "lastUpdated": (
                (latest_job.get("endTime") or latest_job.get("startTime")).isoformat()
                if latest_job
                and hasattr(
                    latest_job.get("endTime") or latest_job.get("startTime"),
                    "isoformat",
                )
                else str(latest_job.get("endTime", "")) if latest_job else None
            ),
            "syncMetrics": _compute_kb_metrics(filtered_docs, []),
            "documents": _serialize_datetime(filtered_docs),
            "dataSources": _serialize_data_sources(all_data_sources)
            + _get_web_crawler_stats(kb_id),
            "failedDocuments": [],  # Q Business doesn't have this feature yet
            "source": "q-business",
        }

    except Exception as e:
        logger.error("Error getting Q Business KB state", error=str(e), exc_info=True)
        return {"error": str(e), "source": "q-business"}


def _get_s3_url_tag(s3_client: Any, bucket_name: str, key: str) -> Optional[str]:
    """Fetch URL metadata tag from an S3 object."""
    try:
        head_resp = s3_client.head_object(Bucket=bucket_name, Key=key)
        return head_resp.get("Metadata", {}).get("url", "") or None
    except Exception as head_err:
        logger.debug(
            "Could not fetch URL tag for scraped file",
            key=key,
            error=str(head_err),
        )
        return None


def _get_file_metadata(s3_client, bucket: str, key: str) -> Optional[Dict[str, Any]]:
    """Read metadata sidecar for a file if it exists.

    Args:
        s3_client: S3 client instance
        bucket: S3 bucket name
        key: S3 key of the original file

    Returns:
        Parsed metadata attributes dict, or None if no sidecar exists
    """
    metadata_key = f"{key}.metadata.json"
    try:
        response = s3_client.get_object(Bucket=bucket, Key=metadata_key)
        content = response["Body"].read().decode("utf-8")
        data = json.loads(content)
        # Return the metadataAttributes dict if present
        return data.get("metadataAttributes", data)
    except s3_client.exceptions.NoSuchKey:
        return None
    except Exception as e:
        logger.debug(
            "Failed to read metadata sidecar",
            bucket=bucket,
            key=metadata_key,
            error=str(e),
        )
        return None


def _enrich_file_info_with_metadata(
    s3_client: Any, bucket_name: str, key: str, file_info: Dict[str, Any]
) -> None:
    """
    Fetch metadata sidecar and add uploader info to file_info in place.

    Args:
        s3_client: Boto3 S3 client
        bucket_name: S3 bucket name
        key: S3 object key
        file_info: Dict to enrich with uploadedBy and uploadedAt fields
    """
    metadata = _get_file_metadata(s3_client, bucket_name, key)
    if not metadata:
        return
    # Only use email – if not captured, leave blank
    uploader = metadata.get("uploader_email")
    if uploader:
        file_info["uploadedBy"] = uploader
    uploaded_at = metadata.get("uploaded_at")
    if uploaded_at:
        file_info["uploadedAt"] = uploaded_at


def _list_kb_files(bucket_name: str, prefix: str) -> Tuple[List[Dict[str, Any]], int]:
    """
    List all files in an S3 bucket prefix with metadata.
    Includes folder marker objects (keys ending with "/") so empty folders are visible.

    Args:
        bucket_name: S3 bucket name
        prefix: S3 prefix to search (e.g., "documents/kb-123/")

    Returns:
        Tuple of:
            - List of objects with key, lastModified, size, and optionally urlTag,
              uploadedBy, uploadedAt
            - Document count (excludes folder markers)
    """
    try:
        s3_client = prm_client("s3", region=REGION)
        paginator = s3_client.get_paginator("list_objects_v2")

        files: List[Dict[str, Any]] = []
        doc_count = 0
        for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            contents = page.get("Contents", [])
            for obj in contents:
                key_val = obj.get("Key") if isinstance(obj, dict) else None
                if not isinstance(key_val, str):
                    continue
                # Skip metadata sidecar files
                if key_val.endswith(".metadata.json"):
                    continue

                last_modified = obj.get("LastModified")
                is_folder = key_val.endswith("/")
                file_info: Dict[str, Any] = {
                    "key": key_val,
                    "lastModified": (
                        last_modified.isoformat() if last_modified else None
                    ),
                    "size": obj.get("Size", 0),
                }

                # Fetch URL tag for web crawler files
                if not is_folder and (
                    "web-crawler/" in key_val or "scraped-content/" in key_val
                ):
                    url_tag = _get_s3_url_tag(s3_client, bucket_name, key_val)
                    if url_tag:
                        file_info["urlTag"] = url_tag

                # Fetch uploader info from metadata sidecar
                if not is_folder:
                    _enrich_file_info_with_metadata(
                        s3_client, bucket_name, key_val, file_info
                    )

                files.append(file_info)
                if not is_folder:
                    doc_count += 1

        logger.debug(
            "Listed S3 files",
            bucket=bucket_name,
            prefix=prefix,
            count=len(files),
            doc_count=doc_count,
        )
        return files, doc_count
    except Exception as e:
        logger.error(
            "Error listing S3 files",
            bucket=bucket_name,
            prefix=prefix,
            error=str(e),
        )
        return [], 0


@app.get("/api/kb/{kb_id}/files")
async def list_kb_files(request: Request, kb_id: str) -> Response:
    """List files in a KB's S3 prefix and update document count."""
    try:
        logger.info(
            "list_kb_files called",
            kb_id=kb_id,
            client_name=CLIENT_NAME,
        )

        headers = {k.lower(): v for k, v in request.headers.items()}

        cf_header = headers.get("x-arcanum-cloudfront-secret")

        if CF_SHARED_SECRET:
            if cf_header != CF_SHARED_SECRET:
                logger.warning(
                    "CloudFront secret mismatch - returning 403 Forbidden",
                    kb_id=kb_id,
                )
                return JSONResponse({"error": "Forbidden"}, status_code=403)

        auth = headers.get("authorization")
        if not auth:
            logger.warning("Missing Authorization header", kb_id=kb_id)
            return JSONResponse(
                {"error": "Missing Authorization header"}, status_code=401
            )

        user = _verify_jwt_token(auth)
        user_id = user.get("sub")
        logger.info("JWT verified", user_id=user_id, kb_id=kb_id)

        if not isinstance(user_id, str) or not user_id:
            logger.warning("Invalid user ID from JWT", kb_id=kb_id)
            return JSONResponse({"error": "Invalid user ID"}, status_code=401)

        # Initialize KB manager
        kb_manager = KnowledgeBaseManager()

        # Fetch KB first to log its state before permission check
        kb_for_debug = kb_manager.get_kb(kb_id)
        logger.info(
            "KB lookup for permission check",
            kb_id=kb_id,
            kb_exists=kb_for_debug is not None,
            kb_viewers=kb_for_debug.get("viewers") if kb_for_debug else None,
            kb_editors=kb_for_debug.get("editors") if kb_for_debug else None,
            kb_status=kb_for_debug.get("status") if kb_for_debug else None,
            user_id=user_id,
            user_in_viewers=(
                user_id in kb_for_debug.get("viewers", []) if kb_for_debug else False
            ),
            wildcard_in_viewers=(
                "*" in kb_for_debug.get("viewers", []) if kb_for_debug else False
            ),
        )

        # Check permission (VIEWER or higher)
        has_permission = kb_manager.check_permission(kb_id, user_id, "VIEWER")
        logger.info(
            "Permission check result",
            kb_id=kb_id,
            user_id=user_id,
            has_permission=has_permission,
        )

        if not has_permission:
            logger.warning(
                "Access denied - user lacks VIEWER permission",
                kb_id=kb_id,
                user_id=user_id,
            )
            return JSONResponse({"error": "Access denied"}, status_code=403)

        # Get KB to find S3 prefix
        kb = kb_manager.get_kb(kb_id)
        if not kb:
            return JSONResponse({"error": "KB not found"}, status_code=404)

        if not CLIENT_NAME or not kb.get("s3_prefix"):
            return JSONResponse(
                {"error": "KB configuration incomplete"}, status_code=500
            )

        data_bucket = f"numa-{CLIENT_NAME}-data"
        s3_prefix = kb["s3_prefix"]

        # List files from S3
        files, doc_count = _list_kb_files(data_bucket, s3_prefix)

        # Update cached document count in DynamoDB
        kb_manager.update_document_count(kb_id, doc_count)

        logger.info(
            "Listed KB files",
            kb_id=kb_id,
            user_id=user_id,
            file_count=doc_count,
        )

        return JSONResponse(
            {"files": files, "document_count": doc_count}, status_code=200
        )

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB files list failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.get("/api/kb/{kb_id}/state")
async def get_kb_state(request: Request, kb_id: str) -> Response:
    """Get KB state including documents, sync status, and ingestion jobs.

    Returns:
        {
            "dataSourceId": "...",
            "syncStatus": "ACTIVE|AVAILABLE|...",
            "syncJobStatus": "SYNCING|SUCCEEDED|FAILED",
            "lastSuccessfulSync": "2024-01-01T00:00:00Z",
            "lastUpdated": "2024-01-01T00:00:00Z",
            "syncMetrics": {...},
            "documents": [...],
            "dataSources": [...],
            "failedDocuments": [...],
            "source": "bedrock|q-business"
        }
    """
    try:
        headers = {k.lower(): v for k, v in request.headers.items()}
        if CF_SHARED_SECRET:
            if headers.get("x-arcanum-cloudfront-secret") != CF_SHARED_SECRET:
                return JSONResponse({"error": "Forbidden"}, status_code=403)

        auth = headers.get("authorization")
        if not auth:
            return JSONResponse(
                {"error": "Missing Authorization header"}, status_code=401
            )

        user = _verify_jwt_token(auth)
        user_id = user.get("sub")
        if not isinstance(user_id, str) or not user_id:
            return JSONResponse({"error": "Invalid user ID"}, status_code=401)

        # Initialize KB manager
        kb_manager = KnowledgeBaseManager()

        # Check permission (VIEWER or higher)
        if not kb_manager.check_permission(kb_id, user_id, "VIEWER"):
            return JSONResponse({"error": "Access denied"}, status_code=403)

        # Get KB to determine S3 prefix filter
        kb = kb_manager.get_kb(kb_id)
        if not kb:
            return JSONResponse({"error": "KB not found"}, status_code=404)

        # Determine KB type and S3 prefix filter
        s3_prefix = kb.get("s3_prefix", "")
        kb_type = "company" if kb_id == "company" else "user"
        s3_prefix_filter = (
            s3_prefix  # e.g., "documents/kb-123/" or "documents/company/"
        )

        # Get KB state based on preferred knowledge base type
        # For User KBs, always use Bedrock even if Q is preferred
        # (Q Business doesn't support per-KB isolation, User KBs are indexed in Bedrock)
        if kb_type == "user" and PREFERRED_KNOWLEDGE_BASE == "q":
            state = _get_bedrock_kb_state(kb_id, s3_prefix_filter, kb_type)
        elif PREFERRED_KNOWLEDGE_BASE == "q":
            state = _get_qbusiness_kb_state(kb_id, s3_prefix_filter, kb_type)
        else:
            state = _get_bedrock_kb_state(kb_id, s3_prefix_filter, kb_type)

        logger.info(
            "Got KB state",
            kb_id=kb_id,
            user_id=user_id,
            source=state.get("source"),
            doc_count=len(state.get("documents", [])),
        )

        return JSONResponse(state, status_code=200)

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB state fetch failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.patch("/api/kb/{kb_id}")
async def update_kb(request: Request, kb_id: str) -> Response:
    """Update KB properties.

    Body (all fields optional):
        {
            "name": "New name",
            "viewers": ["user_id1", "user_id2"],
            "editors": ["user_id1"]
        }
    """
    try:
        headers = {k.lower(): v for k, v in request.headers.items()}
        if CF_SHARED_SECRET:
            if headers.get("x-arcanum-cloudfront-secret") != CF_SHARED_SECRET:
                return JSONResponse({"error": "Forbidden"}, status_code=403)

        auth = headers.get("authorization")
        if not auth:
            return JSONResponse(
                {"error": "Missing Authorization header"}, status_code=401
            )

        user = _verify_jwt_token(auth)
        user_id = user.get("sub")
        if not isinstance(user_id, str) or not user_id:
            return JSONResponse({"error": "Invalid user ID"}, status_code=401)

        # Initialize KB manager
        kb_manager = KnowledgeBaseManager()

        # Only the owner can update KB settings
        if not kb_manager.check_owner(kb_id, user_id):
            return JSONResponse({"error": "Access denied"}, status_code=403)

        body = await request.json()
        name = body.get("name")
        viewers = body.get("viewers")
        editors = body.get("editors")

        # Resolve emails to Cognito sub IDs if provided
        resolved_viewers = None
        resolved_editors = None

        if viewers is not None:
            resolved_viewers, unresolved_viewers = _resolve_user_identifiers(viewers)
            if unresolved_viewers:
                return JSONResponse(
                    {
                        "error": "Some viewers could not be resolved by email or ID",
                        "unresolved": unresolved_viewers,
                    },
                    status_code=400,
                )

        if editors is not None:
            resolved_editors, unresolved_editors = _resolve_user_identifiers(editors)
            if unresolved_editors:
                return JSONResponse(
                    {
                        "error": "Some editors could not be resolved by email or ID",
                        "unresolved": unresolved_editors,
                    },
                    status_code=400,
                )

        # Update KB
        success = kb_manager.update_kb(
            kb_id=kb_id, name=name, viewers=resolved_viewers, editors=resolved_editors
        )

        if not success:
            return JSONResponse({"error": "Update failed"}, status_code=400)

        logger.info("KB updated", kb_id=kb_id, updated_by=user_id)
        return JSONResponse({"status": "success"}, status_code=200)

    except ValueError as e:
        logger.warning("KB update validation error", error=str(e))
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB update failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.delete("/api/kb/{kb_id}")
async def delete_kb(request: Request, kb_id: str) -> Response:
    """Soft-delete (archive) a KB."""
    try:
        headers = {k.lower(): v for k, v in request.headers.items()}
        if CF_SHARED_SECRET:
            if headers.get("x-arcanum-cloudfront-secret") != CF_SHARED_SECRET:
                return JSONResponse({"error": "Forbidden"}, status_code=403)

        auth = headers.get("authorization")
        if not auth:
            return JSONResponse(
                {"error": "Missing Authorization header"}, status_code=401
            )

        user = _verify_jwt_token(auth)
        user_id = user.get("sub")
        if not isinstance(user_id, str) or not user_id:
            return JSONResponse({"error": "Invalid user ID"}, status_code=401)

        # Initialize KB manager
        kb_manager = KnowledgeBaseManager()

        # Only the owner can delete KBs
        if not kb_manager.check_owner(kb_id, user_id):
            return JSONResponse({"error": "Access denied"}, status_code=403)

        # Delete KB
        success = kb_manager.delete_kb(kb_id)
        if not success:
            return JSONResponse({"error": "Delete failed"}, status_code=400)

        logger.info("KB deleted", kb_id=kb_id, deleted_by=user_id)
        return JSONResponse({"status": "success"}, status_code=200)

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB delete failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)
