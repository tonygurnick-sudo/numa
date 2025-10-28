from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, AsyncGenerator, Dict, Optional

import jwt
import requests
import structlog
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from jwt import algorithms

from . import clear_current_user_auth, create_fresh_agent, set_current_user_auth
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
        if not auth:
            return JSONResponse(
                {"error": "Missing Authorization header"}, status_code=401
            )

        user = _verify_jwt_token(auth)
        body = await request.json()

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
        # Capture optional client-local time info for downstream tools/prompts
        client_time_info = body.get("timeInfo") or {}

        user_auth = {
            **(
                {
                    "sub": user.get("sub"),
                    "email": user.get("email"),
                    "groups": user.get("cognito:groups", []),
                }
            ),
            **(body.get("userAuth") or {}),
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
        set_current_user_auth(user_auth)
        try:
            # Progressive summarization already handled in LAYER 1 (DynamoDB loading)
            # Agent will use default context management during execution
            agent, mcp_clients = create_fresh_agent(
                enabled_tools,
                system_prompt,
                model_id,
                messages,
                enabled_connections,
            )

            async def generator() -> AsyncGenerator[bytes, None]:
                try:
                    # Do not include the prompt inside messages; provide it here only
                    async for chunk in _stream_agent_events(agent, prompt):
                        yield chunk.encode("utf-8")
                finally:
                    try:
                        cleanup_mcp_clients(mcp_clients)
                    except Exception as e:  # pylint: disable=broad-except
                        logger.warning("MCP client cleanup failed", error=str(e))
                    # Clear per-request user auth context after streaming completes
                    try:
                        clear_current_user_auth()
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
        if not auth:
            return JSONResponse(
                {"error": "Missing Authorization header"}, status_code=401
            )

        user = _verify_jwt_token(auth)
        body = await request.json()

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
        # Capture optional client-local time info for downstream tools/prompts
        client_time_info = body.get("timeInfo") or {}

        user_auth = {
            **(
                {
                    "sub": user.get("sub"),
                    "email": user.get("email"),
                    "groups": user.get("cognito:groups", []),
                }
            ),
            **(body.get("userAuth") or {}),
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
        set_current_user_auth(user_auth)

        try:
            # Progressive summarization already handled in LAYER 1 (DynamoDB loading)
            # Agent will use default context management during execution
            agent, mcp_clients = create_fresh_agent(
                enabled_tools,
                system_prompt,
                model_id,
                messages,
                enabled_connections,
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
