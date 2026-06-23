"""
Numa Standard Model relay (deployer account).

This is the **only** place in the Numa codebase that knows the real upstream
behind the opaque ``numa-standard-model`` id. The strings ``xiaomi`` /
``mimo`` / ``novita`` and the OpenRouter API key exist nowhere else — the per-tenant
container, the trace, credits, and the frontend all see only
``numa-standard-model`` (contracts.md §1).

Flow (contracts.md §2):

    SDK → in-container proxy (Anthropic→OpenAI translate) → THIS relay → OpenRouter

The in-container proxy POSTs OpenAI Chat Completions JSON with
``"model": "numa-standard-model"``, ``"stream": true`` and
``"reasoning": {"enabled": true}``, plus a fresh STS-proof header. This relay:

  1. Validates the ``x-numa-sts-proof`` header **before** opening the upstream
     stream — SSRF allowlist → server-side fetch → parse Account+Arn → role
     regex ``numa-.*-workspace-chat-agentcore`` → account ∈ numa-client-config.
  2. Maps ``numa-standard-model`` → ``xiaomi/mimo-v2.5-pro``; attaches the
     provider pin ``{order:["novita"], allow_fallbacks:true, data_collection:
     "deny"}``; forces ``reasoning.enabled`` and ``usage.include``.
  3. Injects ``Authorization: Bearer <OPENROUTER_API_KEY>`` + attribution.
  4. Streams OpenRouter's SSE back verbatim, including the terminal usage event
     carrying ``usage{prompt_tokens, completion_tokens,
     prompt_tokens_details.cached_tokens, cost}``.

Every upstream failure is mapped to an **opaque** SSE error so no provider name
ever reaches the client. The real cause is logged here (deployer account) only.
"""

import asyncio
import json
import os
import queue as queue_mod
from typing import Any, AsyncGenerator, Dict, Optional

import httpx
import structlog
from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse

from prm import client as prm_client
from security_validator import RelaySecurityValidator, SecurityValidationError

structlog.contextvars.clear_contextvars()
logger = structlog.get_logger()

app = FastAPI()

# ── Configuration (deployer-account secrets live here only) ──────────────────
OPENROUTER_BASE_URL = os.environ.get(
    "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
)
OPENROUTER_CHAT_COMPLETIONS_URL = f"{OPENROUTER_BASE_URL}/chat/completions"

# The OpenRouter key lives only in this account's Secrets Manager. The relay
# construct passes its ARN; we fetch the value at RUNTIME (cached per container)
# so the plaintext is never baked into the Lambda env config and rotations need
# no re-deploy — mirrors the Pipedream proxy convention. ~one GetSecretValue per
# cold container, then served from memory. It must never leave this account.
OPENROUTER_SECRET_ARN = os.environ.get("OPENROUTER_SECRET_ARN", "")
_openrouter_key_cache: Optional[str] = None


def _get_openrouter_key() -> str:
    """Fetch + cache the OpenRouter key from Secrets Manager (once per container).

    Raised errors are caught by the request handler and surfaced as the opaque
    upstream error, so an unpopulated secret degrades gracefully rather than
    revealing which credential is missing.
    """
    global _openrouter_key_cache
    if _openrouter_key_cache:
        return _openrouter_key_cache
    if not OPENROUTER_SECRET_ARN:
        raise RuntimeError("OPENROUTER_SECRET_ARN not configured")
    resp = prm_client("secretsmanager").get_secret_value(SecretId=OPENROUTER_SECRET_ARN)
    key = (resp.get("SecretString") or "").strip()
    if not key:
        raise RuntimeError("OpenRouter secret has no value")
    _openrouter_key_cache = key
    return key


# Opaque public id → real upstream id. Both come from env so the literal model
# strings can be rotated without a code change, but they default to the values
# pinned in contracts.md §1.
NUMA_STANDARD_MODEL_ID = os.environ.get("NUMA_STANDARD_MODEL_ID", "numa-standard-model")
UPSTREAM_MODEL_ID = os.environ.get(
    "NUMA_STANDARD_MODEL_UPSTREAM", "xiaomi/mimo-v2.5-pro"
)

# Provider routing pin. Novita preferred; allow_fallbacks=true so OpenRouter can
# route to another provider only if Novita is fully down (availability decision,
# contracts.md §2). data_collection:deny keeps prompts out of provider training.
_provider_order_env = os.environ.get("NUMA_STANDARD_MODEL_PROVIDER_ORDER", "novita")
PROVIDER_ORDER = [p.strip() for p in _provider_order_env.split(",") if p.strip()]

# Optional defence-in-depth shared secret. STS proof is the real auth; this is an
# extra gate if set on both ends. Empty → not enforced.
RELAY_SHARED_SECRET = os.environ.get("NUMA_STANDARD_MODEL_RELAY_SECRET", "")

# OpenRouter attribution headers (recommended by OpenRouter; harmless if unset).
OPENROUTER_REFERER = os.environ.get(
    "OPENROUTER_HTTP_REFERER", "https://numa.arcanum.ai"
)
OPENROUTER_TITLE = os.environ.get("OPENROUTER_X_TITLE", "Numa")

# Upstream stream timeouts. connect/read are generous to cover a slow first
# token through the cross-account hop; the keepalive comment holds the
# downstream connection open in the meantime.
_UPSTREAM_CONNECT_TIMEOUT = 15.0
_UPSTREAM_READ_TIMEOUT = 300.0

# Keepalive cadence for the downstream SSE (matches the proxy template).
_KEEPALIVE_SECS = 30
_KEEPALIVE_COMMENT = b": keepalive\n\n"

# Generic opaque message — NEVER name OpenRouter / the upstream model / Novita.
_OPAQUE_UNAVAILABLE = (
    "The Standard model is temporarily unavailable — switch to Premium or try "
    "again shortly."
)

# Lazy-initialised validator (created on first invocation, like email-sender).
_validator: Optional[RelaySecurityValidator] = None


def _get_validator() -> RelaySecurityValidator:
    global _validator
    if _validator is None:
        _validator = RelaySecurityValidator()
    return _validator


def _opaque_error_sse(message: str = _OPAQUE_UNAVAILABLE) -> bytes:
    """An OpenAI-shaped error chunk + terminal [DONE], opaque to the client."""
    err = {
        "error": {
            "message": message,
            "type": "service_unavailable",
            "code": "standard_model_unavailable",
        }
    }
    return (f"data: {json.dumps(err)}\n\n" "data: [DONE]\n\n").encode("utf-8")


def _build_upstream_payload(body: Dict[str, Any]) -> Dict[str, Any]:
    """Rewrite the proxy's OpenAI body into the upstream OpenRouter body.

    The opaque model id is swapped for the real upstream id; the provider pin,
    reasoning, streaming, and usage accounting are forced on regardless of what
    the proxy sent. Everything else (messages, tools, sampling params) passes
    through untouched.
    """
    payload = dict(body)

    # Remap the opaque id → real upstream id. We force it even if the proxy sent
    # something unexpected, so this relay only ever drives the one model.
    payload["model"] = UPSTREAM_MODEL_ID

    # Always stream; always meter.
    payload["stream"] = True
    payload["usage"] = {"include": True}

    # Reasoning on (the bench config). Preserve any proxy-provided reasoning
    # options but guarantee it's enabled.
    reasoning = payload.get("reasoning")
    if isinstance(reasoning, dict):
        reasoning = {**reasoning, "enabled": True}
    else:
        reasoning = {"enabled": True}
    payload["reasoning"] = reasoning

    # Provider routing pin (Novita-preferred, fallback allowed, no data
    # collection). This is the secret routing policy — only known here.
    payload["provider"] = {
        "order": PROVIDER_ORDER,
        "allow_fallbacks": True,
        "data_collection": "deny",
    }

    return payload


def _upstream_headers(client_name: str | None = None) -> Dict[str, str]:
    # X-Title surfaces in OpenRouter's "App" column. Include the validated client
    # so usage is attributable per-client (e.g. "Numa - nd-labs"); fall back to
    # the base title when the client is unknown.
    # ASCII-ONLY: httpx encodes header VALUES as ascii, so any non-ASCII char (an
    # em-dash separator, or a unicode client name) raises UnicodeEncodeError and
    # kills the upstream stream *before it sends* — a blank turn. Use a plain
    # hyphen and strip any stray non-ASCII as belt-and-suspenders.
    title = f"{OPENROUTER_TITLE} - {client_name}" if client_name else OPENROUTER_TITLE
    title = title.encode("ascii", "ignore").decode("ascii") or OPENROUTER_TITLE
    return {
        "Authorization": f"Bearer {_get_openrouter_key()}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "HTTP-Referer": OPENROUTER_REFERER,
        "X-Title": title,
    }


async def _stream_upstream(
    payload: Dict[str, Any], client_name: str | None = None
) -> AsyncGenerator[bytes, None]:
    """Open the upstream stream and relay SSE bytes back verbatim.

    A keepalive SSE comment is emitted whenever no upstream chunk arrives within
    ``_KEEPALIVE_SECS`` so the cross-account / CloudFront connection stays open.
    Any upstream/transport failure is logged with its real cause and surfaced as
    an opaque SSE error — provider names never leak downstream.
    """
    timeout = httpx.Timeout(
        _UPSTREAM_READ_TIMEOUT,
        connect=_UPSTREAM_CONNECT_TIMEOUT,
        read=_UPSTREAM_READ_TIMEOUT,
    )

    # Bridge httpx's async byte iterator into a queue so we can apply an
    # idle-timeout keepalive without cancelling the upstream read (mirrors the
    # workspace-chat-agent-proxy queue+keepalive recipe, async-side).
    chunk_q: "queue_mod.Queue[Any]" = queue_mod.Queue()
    _sentinel = object()

    async def _reader() -> None:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST",
                    OPENROUTER_CHAT_COMPLETIONS_URL,
                    headers=_upstream_headers(client_name),
                    json=payload,
                ) as resp:
                    if resp.status_code >= 400:
                        # Read the upstream error body for our logs only.
                        raw = await resp.aread()
                        logger.error(
                            "Upstream returned error status",
                            status=resp.status_code,
                            body_snippet=raw[:500].decode("utf-8", "replace"),
                        )
                        chunk_q.put(
                            SecurityValidationError("upstream_error")
                            if resp.status_code in (401, 403)
                            else RuntimeError("upstream_error")
                        )
                        chunk_q.put(_sentinel)
                        return

                    async for chunk in resp.aiter_bytes():
                        if chunk:
                            chunk_q.put(chunk)
        except Exception as exc:  # noqa: BLE001 — log real cause, surface opaque
            logger.error("Upstream stream failed", error=str(exc), exc_info=True)
            chunk_q.put(exc)
        finally:
            chunk_q.put(_sentinel)

    reader_task = asyncio.create_task(_reader())

    try:
        while True:
            try:
                item = await asyncio.to_thread(chunk_q.get, True, _KEEPALIVE_SECS)
            except queue_mod.Empty:
                yield _KEEPALIVE_COMMENT
                continue

            if item is _sentinel:
                break
            if isinstance(item, BaseException):
                # Real cause already logged in the reader; emit opaque error.
                yield _opaque_error_sse()
                break
            yield item
    finally:
        if not reader_task.done():
            reader_task.cancel()


@app.get("/health")
async def health() -> JSONResponse:
    """Liveness probe — does not touch the upstream or any secret."""
    return JSONResponse({"status": "ok"})


@app.post("/")
async def relay(
    request: Request,
    x_numa_sts_proof: str = Header(default=""),
    x_numa_relay_secret: str = Header(default=""),
) -> Any:
    """Validate the caller, then stream the Standard model upstream.

    Validation happens BEFORE the upstream stream is opened (contracts.md §3).
    Any pre-stream failure returns a non-streamed opaque JSON error; failures
    that occur mid-stream are surfaced as an opaque SSE error chunk.
    """
    structlog.contextvars.bind_contextvars(_name="STANDARD_MODEL_RELAY")

    # Optional shared-secret gate (defence in depth; STS proof is the real auth).
    if RELAY_SHARED_SECRET and x_numa_relay_secret != RELAY_SHARED_SECRET:
        logger.warning("Relay shared-secret mismatch")
        return JSONResponse(
            status_code=403, content={"error": {"message": "Access denied"}}
        )

    # STS proof validation — BEFORE opening the upstream stream.
    try:
        validator = _get_validator()
        validation = validator.validate_request(x_numa_sts_proof)
        structlog.contextvars.bind_contextvars(
            caller_account=validation["caller_account_id"],
            role_name=validation["role_name"],
        )
        # Client name for upstream attribution (OpenRouter "App" column). Derive
        # from the STS-validated role (numa-{client}-workspace-chat-agentcore) —
        # we trust the proven identity, not a self-reported header.
        client_name = validation.get("client_name")
        if not client_name:
            _rn = validation["role_name"]
            if _rn.startswith("numa-") and _rn.endswith("-workspace-chat-agentcore"):
                client_name = _rn[len("numa-") : -len("-workspace-chat-agentcore")]
    except SecurityValidationError as e:
        logger.warning("Security validation failed", error=str(e))
        return JSONResponse(
            status_code=403, content={"error": {"message": "Access denied"}}
        )

    # Parse the proxy's OpenAI Chat Completions body.
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("body must be a JSON object")
    except Exception as e:  # noqa: BLE001
        logger.warning("Invalid request body", error=str(e))
        return JSONResponse(
            status_code=400, content={"error": {"message": "Invalid request body"}}
        )

    try:
        _get_openrouter_key()  # fetch + cache before opening the upstream
    except Exception as exc:
        # Misconfiguration (e.g. secret not yet populated) — never reveal which
        # credential is missing.
        logger.error("Upstream credential unavailable", error=str(exc))
        return StreamingResponse(
            iter([_opaque_error_sse()]),
            media_type="text/event-stream",
            status_code=200,
        )

    upstream_payload = _build_upstream_payload(body)
    logger.info(
        "Opening Standard model stream",
        upstream_model=UPSTREAM_MODEL_ID,
        provider_order=PROVIDER_ORDER,
        client_name=client_name
        or "(none)",  # surfaces what the X-Title attribution resolves to
    )

    return StreamingResponse(
        _stream_upstream(upstream_payload, client_name),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
