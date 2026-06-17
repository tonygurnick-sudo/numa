"""
In-container proxy for the Numa Standard Model (opaque non-Anthropic model).

Runs a minimal FastAPI app on localhost:4100 that accepts Anthropic Messages
API requests from the Claude CLI/SDK and forwards them — translated to the
OpenAI Chat Completions schema — to the **deployer-account relay** Function URL
(``NUMA_STANDARD_MODEL_RELAY_URL``). The relay is the only place that knows the
real upstream model, the provider pin, and the upstream API key; this container
only knows there is an OpenAI-format model called ``numa-standard-model`` reached
via the relay.

Why an in-container proxy (vs a static ANTHROPIC_BASE_URL header): the relay is
authenticated with a **freshly minted STS GetCallerIdentity presigned URL** per
request (120–300 s expiry). A static base-URL header can't refresh that; the
localhost proxy mints a fresh proof on every upstream call. It is also where we
capture the relay's true per-request ``usage.cost`` so the runner can write it
into ``result.total_cost_usd`` for credit metering (Option A).

This is the trimmed sibling of the POC ``bedrock_mantle_proxy.py`` — the Mantle
(SigV4 Bedrock) and Bedrock-Converse (Nova) paths are dropped; only the
OpenAI-compatible relay path remains.

Hardening carried over / added for the Standard Model:
  * H1 — auto-retry once on the SDK-side "missing signature" API error class
    (recurred on long multi-turn). We surface it as a retryable upstream error.
  * H2 — reasoning-channel salvage: if a turn ends with thinking emitted but
    ZERO text, promote the reasoning tail into a text block so the user never
    sees a blank (billed) turn.
  * H3 — dynamic side-call redirect: the CLI fires internal Haiku-shaped calls
    (title-gen / fast classifier) when ANTHROPIC_BASE_URL points at us. Every
    inbound model — including those — is forwarded to the active standard model
    via the relay, so one conversation == one model and the side-call cost is
    attributed. (The POC hardcoded a specific model here; now it's intrinsic,
    since the proxy only ever has one upstream.)

Keep ``EMIT_THINKING_SIG`` OFF and drop thinking blocks on request translation
(the POC's working config) — synthesized signed thinking blocks flip the CLI
into extended-thinking-with-tool-use continuity mode, which empirically makes
the model blank on deliverable turns.
"""

import asyncio
import json
import os
import re
import threading
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import httpx
import structlog
from botocore.session import Session

logger = structlog.get_logger()

# Local proxy bound to loopback only — the Claude SDK subprocess hits this via
# ANTHROPIC_BASE_URL. The auth token is a placeholder (the Anthropic SDK requires
# *some* API key) and never leaves the host; the real cross-account auth is the
# per-request STS proof minted toward the relay.
PROXY_PORT = 4100
PROXY_HOST = "127.0.0.1"
PROXY_BASE_URL = f"http://{PROXY_HOST}:{PROXY_PORT}"
PROXY_AUTH_TOKEN = "sk-numa-standard-local"

# The opaque model id sent to the relay. The relay maps this to the real
# upstream; the container never names the real model.
NUMA_STANDARD_MODEL_ID = os.environ.get("NUMA_STANDARD_MODEL_ID", "numa-standard-model")

# Per-request output cap forwarded to the relay. The relay/provider may clamp
# further; this only bounds what the CLI is allowed to request.
_STANDARD_MAX_OUTPUT_TOKENS = int(
    os.environ.get("NUMA_STANDARD_MAX_OUTPUT_TOKENS", "32000")
)

# STS proof expiry window (seconds). 120–300 s per contract §2 — long enough to
# survive relay cold start + network latency, short enough to bound replay.
_STS_PROOF_EXPIRES = int(os.environ.get("NUMA_STS_PROOF_EXPIRES", "180"))

# Relay request timeout. Agentic turns with large tool outputs can run several
# minutes; the SDK's own timeout fires before this in practice.
_RELAY_TIMEOUT = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)

# Opaque, user-safe error message. Never leak the real upstream model or
# provider name to the client or the user-visible stream (contract §2). The
# real cause is logged only here (and, authoritatively, in the relay).
_OPAQUE_UPSTREAM_ERROR = (
    "The Standard model is temporarily unavailable — switch to Premium or "
    "try again shortly."
)

# ── Output guard ───────────────────────────────────────────────────────────
# The Standard model (a non-Anthropic upstream) has two bad-output failure
# modes we must intercept before they reach the user:
#
#  1. DSML tool-call leak — DeepSeek occasionally emits its native
#     ``<｜DSML｜tool_calls><｜DSML｜invoke name="...">`` markup INSIDE the
#     reasoning channel instead of as a parsed tool_call. The turn then has no
#     real text + no tool_use, so the H2 reasoning-salvage promotes the raw
#     markup to a visible answer (and the action never runs). We detect the
#     markup in the salvage buffer and emit a clean fallback instead.
#  2. CJK refusal — for politically-censored topics the model's CCP alignment
#     emits a canned Chinese refusal as its actual TEXT answer (prompt-steering
#     can't stop hard alignment). We hold the start of the text stream, detect
#     the refusal, and substitute a neutral English decline.
#
# Both also POISON the conversation (the model parrots its own prior bad turn).
# The live substitutions above stop new poison from ever being recorded; the
# history scrub in ``_anthropic_to_openai_messages`` is the backstop for
# conversations already poisoned before this guard shipped.

# Shown in place of a suppressed Chinese refusal. Numa is a business assistant —
# the right move on a censored topic is a clean English decline, not a Chinese
# refusal and not a contortion to answer it.
_CJK_DECLINE = "I can't help with that one — happy to keep going on your work, though."

# Shown in place of a suppressed DSML tool-call leak (the malformed call is lost
# either way; this keeps the user out of the raw markup until the Phase-2 retry
# / parse-to-tool_use lands).
_DSML_FALLBACK = (
    "Sorry — I hit a snag running that step. Could you ask me to try again?"
)

# DeepSeek's native special-token delimiter is the FULL-WIDTH vertical bar
# (U+FF5C), NOT the ASCII pipe. It has essentially zero legitimate reason to
# appear in English text, which makes it a high-precision leak signal.
_DSML_BAR = "｜"
# Open from the first ``<｜DSML｜`` (or a bare ``｜DSML｜`` / ``｜tool_calls``) run
# to end-of-text — the leak is always a trailing run.
_DSML_RE = re.compile(r"<?｜(?:DSML|tool_calls|invoke).*", re.S)

# DeepSeek's canonical censorship fingerprint ("...haven't yet learned how to
# answer this question"). Unambiguous — used as a high-confidence signal that
# bypasses the ratio check (and is the only signal the conservative history
# scrub trusts, so it never drops legitimate Chinese work).
_CENSORSHIP_FINGERPRINT = "我还没学习如何回答这个问题"

# CJK codepoint ranges: ideographs + kana + CJK/fullwidth punctuation. We count
# the punctuation too, else a Chinese sentence (heavy on 。，！？) reads as
# low-ratio.
_CJK_RANGES = (
    (0x4E00, 0x9FFF),  # CJK Unified Ideographs (the bulk of Chinese)
    (0x3400, 0x4DBF),  # CJK Ext A
    (0xF900, 0xFAFF),  # CJK Compatibility Ideographs
    (0x20000, 0x2FA1F),  # CJK Ext B–F
    (0x3040, 0x30FF),  # Hiragana / Katakana (same alignment family)
    (0x3000, 0x303F),  # CJK punctuation
    (0xFF00, 0xFFEF),  # Halfwidth/Fullwidth forms
)

# Hold this many non-whitespace chars of the text stream before deciding
# clean-vs-refusal. A canned refusal is 100% CJK from char 1 (caught even
# sooner via the ratio short-circuit); clean English waits ~a few words then
# flushes. Standard tier only — Premium/Expert never hit this path.
_TEXT_HOLD_CHARS = 24


def _looks_like_dsml(text: str) -> bool:
    """Detect DeepSeek's native DSML tool-call markup leaking into a channel.

    Keyed on the full-width bar U+FF5C (a tokenizer artifact, not ASCII ``|``)
    plus a DSML/invoke/tool_calls literal so a lone bar can't false-positive.
    """
    if _DSML_BAR not in text:
        return False
    return "DSML" in text or "invoke name" in text or "tool_calls" in text


def _scrub_dsml(text: str) -> str:
    """Strip a leaked DSML tool-call run from text before it re-enters history."""
    if _DSML_BAR not in text:
        return text
    return _DSML_RE.sub("", text).rstrip()


def _cjk_ratio(text: str) -> tuple[float, int]:
    """(fraction of non-whitespace chars that are CJK, absolute CJK count)."""
    cjk = 0
    nonspace = 0
    for ch in text:
        if ch.isspace():
            continue
        nonspace += 1
        o = ord(ch)
        if any(lo <= o <= hi for lo, hi in _CJK_RANGES):
            cjk += 1
    return (cjk / nonspace if nonspace else 0.0), cjk


def _is_cjk_refusal(text: str, user_is_cjk: bool) -> bool:
    """Flag an assistant text block as a Chinese refusal we should suppress.

    The censorship fingerprint always flags (it's never legitimate). The
    ratio path is gated on the user NOT writing CJK, so genuine Chinese
    conversations are never clobbered.
    """
    if _CENSORSHIP_FINGERPRINT in text:
        return True
    if user_is_cjk:
        return False
    ratio, count = _cjk_ratio(text)
    return count >= 8 and ratio >= 0.30


def _block_text(content: Any) -> str:
    """Pull plain text out of an OpenAI/Anthropic message content value."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            b.get("text", "")
            for b in content
            if isinstance(b, dict) and (b.get("type") == "text" or "text" in b)
        )
    return ""


def _user_writes_cjk(request_body: dict) -> bool:
    """True if the user's most recent turn is itself substantially CJK — then a
    CJK reply is legitimate work and must NOT be suppressed."""
    for msg in reversed(request_body.get("messages") or []):
        if msg.get("role") != "user":
            continue
        ratio, count = _cjk_ratio(_block_text(msg.get("content")))
        return count >= 4 and ratio >= 0.15
    return False


def _scrub_assistant_text(text: str) -> str:
    """Backstop: neutralize a poisoned assistant turn before re-sending it
    upstream, so a leak recorded before this guard shipped doesn't get parroted.
    Conservative — only the unambiguous censorship fingerprint and DSML markup
    are removed, so legitimate Chinese assistant turns are left intact."""
    cleaned = _scrub_dsml(text)
    if _CENSORSHIP_FINGERPRINT in cleaned:
        return ""
    return cleaned


# Singleton state. uvicorn runs in a dedicated daemon thread to decouple its
# event loop from the workspace agent's main event loop — running it as an
# asyncio task on the same loop hung AgentCore's microVM during
# uvicorn.Config(...) construction (worked fine in local Docker). `_ready` is
# set True by the FastAPI lifespan handler inside the uvicorn thread; the main
# thread polls for it.
_server_thread: threading.Thread | None = None
_lock = asyncio.Lock()
_ready = False
_REGION: str = ""
_RELAY_URL: str = ""

# ── Local-dev direct mode (NOT production) ──────────────────────────────────
# When NUMA_STANDARD_LOCAL_DIRECT=1 *and* a developer-provided OPEN_ROUTER_TEST_KEY are BOTH present,
# the proxy bypasses the deployer relay and calls OpenRouter directly (replicating the relay's
# model-map + provider pin + usage accounting). This lets the Numa Standard Model run locally —
# benchmarking, compaction / feature tests — without the AgentCore runtime role the relay requires.
# Triple-gated and absent in every deployed client account (no flag, no key, relay URL set instead),
# so production is unaffected. Resolved by _resolve_local_direct() in ensure_running().
_LOCAL_DIRECT: bool = False
_OPENROUTER_KEY: str = ""
_OPENROUTER_URL: str = "https://openrouter.ai/api/v1/chat/completions"
_UPSTREAM_MODEL: str = "deepseek/deepseek-v4-flash"
_PROVIDER_ORDER: list[str] = ["novita"]

# ── Cost accumulator (Option A, contract §4) ────────────────────────────────
# The upstream relay returns the exact charged cost per request in the terminal usage
# event (provider price + cache discount included). The relay forwards it. We
# sum it across every upstream call this proxy makes — including the CLI's
# internal side-calls — so the runner can write the conversation's true cost into
# `result.total_cost_usd`. One MicroVM == one conversation == one proxy process,
# so this module-level accumulator is already conversation-scoped.
#
# `None` until the first relay call reports a cost, so the runner can tell "this
# conversation used the standard model and here is its real cost" apart from
# "Anthropic turn, leave the SDK's cost alone".
_cost_lock = threading.Lock()
_accumulated_cost_usd: float | None = None


def _record_upstream_cost(cost: float | None) -> None:
    """Add a relay-reported per-request cost into the conversation accumulator."""
    global _accumulated_cost_usd
    if cost is None:
        return
    with _cost_lock:
        _accumulated_cost_usd = (_accumulated_cost_usd or 0.0) + float(cost)


def get_accumulated_cost() -> float | None:
    """Return the CURRENT chat request's accumulated true cost (USD), or None if
    the standard-model relay path hasn't run since the last reset.

    ``sdk_runner`` calls ``reset_accumulated_cost`` at the start of every chat
    request, so this sums only the upstream calls of the current request (one
    user message → an agentic loop that can make several upstream calls).
    ``override_result_cost`` reads it to set the result event's
    ``total_cost_usd`` — the PER-MESSAGE cost shown under each turn. The
    conversation total is summed separately by the frontend / credit ledger, so
    this must NOT be a running conversation total (that was the original bug —
    every badge showed the cumulative sum instead of the message's own cost).
    """
    with _cost_lock:
        return _accumulated_cost_usd


def reset_accumulated_cost() -> None:
    """Clear the cost accumulator at the start of a chat request so the next
    result event reflects only that request's upstream calls, not the running
    conversation total. The MicroVM serves one request at a time, so the module
    global is safe. No-op for Anthropic turns (nothing records into it)."""
    global _accumulated_cost_usd
    with _cost_lock:
        _accumulated_cost_usd = None


# --------------------------------------------------------------------------
# Relay transport (OpenAI-compatible, STS-proof auth)
# --------------------------------------------------------------------------


def _generate_sts_proof_url(region: str, expires: int) -> str:
    """Mint a fresh STS GetCallerIdentity presigned URL for cross-account proof.

    A fresh botocore Session is constructed per call so rotated container
    credentials are picked up automatically. The relay fetches this URL
    server-side (SSRF-allowlisted to sts.*.amazonaws.com), parses the real
    caller Account+Arn, and validates the role-name/account allowlist before
    opening the upstream stream. Mirrors
    ``numa-chat-agent/.../pipedream/proxy.py:generate_sts_proof_url``.
    """
    session = Session()
    sts_client: Any = session.create_client("sts", region_name=region)
    return sts_client.generate_presigned_url(
        "get_caller_identity",
        Params={},
        ExpiresIn=expires,
        HttpMethod="GET",
    )


def _relay_headers() -> dict[str, str]:
    """Headers for a relay request: a fresh STS proof + SSE accept + optional
    shared secret (defence-in-depth; STS proof is the real auth)."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "x-numa-sts-proof": _generate_sts_proof_url(_REGION, _STS_PROOF_EXPIRES),
    }
    relay_secret = os.environ.get("NUMA_STANDARD_MODEL_RELAY_SECRET")
    if relay_secret:
        headers["x-numa-relay-secret"] = relay_secret
    return headers


def _resolve_local_direct() -> None:
    """Resolve local-dev direct mode from env (see the _LOCAL_DIRECT block above). DEV ONLY —
    activates only with the explicit flag AND a developer-provided key, neither of which exists in a
    deployed client account."""
    global _LOCAL_DIRECT, _OPENROUTER_KEY, _OPENROUTER_URL, _UPSTREAM_MODEL, _PROVIDER_ORDER
    _OPENROUTER_KEY = os.environ.get("OPEN_ROUTER_TEST_KEY", "")
    flag = os.environ.get("NUMA_STANDARD_LOCAL_DIRECT", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    _LOCAL_DIRECT = flag and bool(_OPENROUTER_KEY)
    if flag and not _OPENROUTER_KEY:
        logger.error(
            "LOCAL DIRECT requested but OPEN_ROUTER_TEST_KEY is empty — using the relay instead",
            _name="STANDARD_PROXY_LOCAL_DIRECT",
        )
    if _LOCAL_DIRECT:
        _OPENROUTER_URL = os.environ.get(
            "NUMA_STANDARD_OPENROUTER_URL", _OPENROUTER_URL
        )
        _UPSTREAM_MODEL = os.environ.get(
            "NUMA_STANDARD_MODEL_UPSTREAM", _UPSTREAM_MODEL
        )
        _PROVIDER_ORDER = [
            p.strip()
            for p in os.environ.get(
                "NUMA_STANDARD_MODEL_PROVIDER_ORDER", "novita"
            ).split(",")
            if p.strip()
        ]
        logger.warning(
            "Numa Standard Model proxy in LOCAL DIRECT mode — bypassing the relay and calling "
            "OpenRouter directly with a local key. DEV ONLY; never enabled in production.",
            _name="STANDARD_PROXY_LOCAL_DIRECT",
            upstream_model=_UPSTREAM_MODEL,
            provider_order=_PROVIDER_ORDER,
        )


def _local_direct_payload(request_body: dict) -> dict:
    """Local-direct mode: replicate the relay's _build_upstream_payload — swap the opaque model id
    for the real upstream id and force streaming + usage accounting + reasoning + the provider pin.
    """
    payload = dict(request_body)
    payload["model"] = _UPSTREAM_MODEL
    payload["stream"] = True
    payload["usage"] = {"include": True}
    reasoning = payload.get("reasoning")
    payload["reasoning"] = (
        {**reasoning, "enabled": True}
        if isinstance(reasoning, dict)
        else {"enabled": True}
    )
    payload["provider"] = {
        "order": _PROVIDER_ORDER,
        "allow_fallbacks": True,
        "data_collection": "deny",
    }
    return payload


def _local_direct_headers() -> dict[str, str]:
    """Local-direct OpenRouter headers (mirrors the relay's _upstream_headers, with the local key).
    ASCII X-Title only — httpx encodes header values as ASCII (see the relay's em-dash note).
    """
    return {
        "Authorization": f"Bearer {_OPENROUTER_KEY}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "HTTP-Referer": os.environ.get("OPENROUTER_REFERER", "https://numa.arcanum.ai"),
        "X-Title": "Numa - local-direct",
    }


# --------------------------------------------------------------------------
# Anthropic -> OpenAI translation (inbound side of the proxy)
# --------------------------------------------------------------------------


def _summarize_content_types(messages: list[dict]) -> list[str]:
    """Summarize content block types for logging."""
    types: set[str] = set()
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    types.add(block.get("type", "unknown"))
        elif isinstance(content, str):
            types.add("string")
    return sorted(types)


def _anthropic_tools_to_openai(tools: list[dict]) -> list[dict]:
    """Convert Anthropic tool definitions to OpenAI function-tool format."""
    return [
        {
            "type": "function",
            "function": {
                "name": tool.get("name", ""),
                "description": tool.get("description", ""),
                "parameters": tool.get("input_schema", {}),
            },
        }
        for tool in tools
    ]


def _anthropic_to_openai_messages(
    messages: list[dict], system: list | str | None
) -> list[dict]:
    """Convert Anthropic message format to OpenAI Chat Completions format.

    Mapping:
    - Anthropic tool_use blocks -> OpenAI tool_calls on assistant message
    - Anthropic tool_result blocks -> OpenAI tool-role messages
    - Anthropic text content blocks -> OpenAI text content
    - Anthropic thinking blocks -> dropped (no OpenAI equivalent; redacted
      reasoning from prior turns has no place in a fresh OpenAI request, and
      forwarding it upstream is what triggers the signature-continuity issues)

    Consecutive same-role messages are merged: the Claude CLI occasionally
    splits thinking + tool_use into separate assistant messages, but the
    OpenAI schema expects strictly alternating turns.
    """
    result: list[dict] = []

    # System prompt
    if system:
        if isinstance(system, str):
            result.append({"role": "system", "content": system})
        elif isinstance(system, list):
            text_parts: list[str] = []
            for block in system:
                if isinstance(block, dict) and "text" in block:
                    text_parts.append(block["text"])
                elif isinstance(block, str):
                    text_parts.append(block)
            if text_parts:
                result.append({"role": "system", "content": "\n".join(text_parts)})

    # Merge consecutive same-role messages before translation.
    merged_messages: list[dict] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content")
        if merged_messages and merged_messages[-1].get("role") == role:
            prev = merged_messages[-1]
            prev_content = prev.get("content", [])
            if isinstance(prev_content, str):
                prev_content = [{"type": "text", "text": prev_content}]
            if isinstance(content, str):
                content = [{"type": "text", "text": content}]
            elif content is None:
                content = []
            prev["content"] = prev_content + (
                content if isinstance(content, list) else []
            )
        else:
            merged_messages.append(dict(msg))

    for msg in merged_messages:
        role = msg.get("role", "user")
        content = msg.get("content")

        if isinstance(content, str):
            result.append({"role": role, "content": content})
            continue

        if not isinstance(content, list):
            result.append({"role": role, "content": str(content) if content else ""})
            continue

        text_parts_blocks: list[dict] = []
        tool_calls: list[dict] = []
        tool_results: list[dict] = []
        other_blocks: list[dict] = []

        for block in content:
            if not isinstance(block, dict):
                text_parts_blocks.append({"type": "text", "text": str(block)})
                continue

            block_type = block.get("type", "")

            if block_type == "thinking":
                # Redacted reasoning from prior turns has no OpenAI equivalent.
                continue

            if block_type == "tool_use" or (
                "id" in block and "name" in block and "input" in block
            ):
                tool_calls.append(
                    {
                        "id": block.get("id", f"call_{uuid.uuid4().hex[:8]}"),
                        "type": "function",
                        "function": {
                            "name": block["name"],
                            "arguments": json.dumps(block.get("input", {})),
                        },
                    }
                )
            elif block_type == "tool_result" or "tool_use_id" in block:
                tool_content = block.get("content", "")
                if isinstance(tool_content, list):
                    parts: list[str] = []
                    for sub in tool_content:
                        if isinstance(sub, dict) and "text" in sub:
                            parts.append(sub["text"])
                        elif isinstance(sub, str):
                            parts.append(sub)
                    tool_content = "\n".join(parts) if parts else ""
                tool_results.append(
                    {
                        "role": "tool",
                        "content": str(tool_content),
                        "tool_call_id": block.get("tool_use_id", ""),
                    }
                )
            elif "text" in block:
                # Backstop against poisoning: strip leaked DSML markup / a canned
                # Chinese refusal from a PRIOR assistant turn before re-sending it
                # upstream, so one bad turn can't prime the model to repeat it.
                # Conservative + assistant-only — never touches user text or
                # legitimate Chinese work.
                text = block["text"]
                if role == "assistant":
                    text = _scrub_assistant_text(text)
                if text:
                    text_parts_blocks.append({"type": "text", "text": text})
            else:
                other_blocks.append(block)

        if role == "assistant" and tool_calls:
            msg_dict: dict = {"role": "assistant", "tool_calls": tool_calls}
            if text_parts_blocks:
                if len(text_parts_blocks) == 1:
                    msg_dict["content"] = text_parts_blocks[0]["text"]
                else:
                    msg_dict["content"] = "\n".join(
                        p["text"] for p in text_parts_blocks
                    )
            else:
                msg_dict["content"] = None
            result.append(msg_dict)
        elif text_parts_blocks or other_blocks:
            all_content = text_parts_blocks + other_blocks
            if len(all_content) == 1 and all_content[0].get("type") == "text":
                result.append({"role": role, "content": all_content[0]["text"]})
            else:
                result.append({"role": role, "content": all_content})

        # Tool results become separate messages with role "tool".
        result.extend(tool_results)

    return result


def _build_relay_request(body: dict) -> dict:
    """Build the OpenAI Chat Completions body the proxy POSTs to the relay.

    The model is always the opaque ``numa-standard-model`` (the relay maps it).
    Reasoning is enabled; usage cost accounting is requested. Provider routing,
    the real model id, and the key are the relay's concern — never set here.
    """
    cli_max = body.get("max_tokens") or _STANDARD_MAX_OUTPUT_TOKENS
    request_body: dict[str, Any] = {
        "model": NUMA_STANDARD_MODEL_ID,
        "messages": _anthropic_to_openai_messages(
            body.get("messages", []), body.get("system")
        ),
        "max_tokens": min(cli_max, _STANDARD_MAX_OUTPUT_TOKENS),
        "stream": True,
        # Native reasoning on (the upstream returns it in the `reasoning` field).
        "reasoning": {"enabled": True},
        # Ask the relay to include exact per-request cost in usage.
        "usage": {"include": True},
        "stream_options": {"include_usage": True},
    }
    if body.get("temperature") is not None:
        request_body["temperature"] = body["temperature"]
    if body.get("stop_sequences"):
        request_body["stop"] = body["stop_sequences"]
    if body.get("tools"):
        request_body["tools"] = _anthropic_tools_to_openai(body["tools"])
    return request_body


# --------------------------------------------------------------------------
# FastAPI app + request handler
# --------------------------------------------------------------------------


def _create_app() -> "FastAPI":  # noqa: F821 - FastAPI imported lazily below
    """Build the local FastAPI proxy that fronts the Claude SDK."""
    from fastapi import FastAPI, Request
    from fastapi.responses import StreamingResponse

    @asynccontextmanager
    async def lifespan(app: "FastAPI"):  # noqa: F821
        global _ready
        _ready = True
        logger.info(
            "Standard-model proxy ready",
            _name="STANDARD_PROXY_READY",
            port=PROXY_PORT,
        )
        yield
        _ready = False

    app = FastAPI(title="Numa Standard Model Proxy", lifespan=lifespan)

    @app.get("/health")
    async def health():
        return {"status": "healthy"}

    @app.post("/v1/messages")
    async def messages(request: Request):
        body = await request.json()
        model = body.get("model", "unknown")
        stream = body.get("stream", False)

        logger.info(
            "Received request",
            _name="STANDARD_PROXY_REQUEST",
            inbound_model=model,
            forwarded_model=NUMA_STANDARD_MODEL_ID,
            message_count=len(body.get("messages", [])),
            system_prompt_length=len(str(body.get("system", ""))),
            stream=stream,
            has_tools=bool(body.get("tools")),
            tool_count=len(body.get("tools", [])),
            max_tokens_from_cli=body.get("max_tokens"),
            content_block_types=_summarize_content_types(body.get("messages", [])),
        )

        # H3: every inbound model — including the CLI's internal Haiku side-calls
        # — is forwarded to the active standard model via the relay. There is no
        # per-model branch here; the proxy only ever has one upstream.
        request_body = _build_relay_request(body)

        # The proxy only emits streaming responses (the SDK always sets
        # stream=True for chat); a non-streaming request still gets an
        # Anthropic SSE response, which the SDK tolerates.
        return StreamingResponse(
            _stream_response(request_body, model),
            media_type="text/event-stream",
        )

    return app


# --------------------------------------------------------------------------
# Relay response handling -> Anthropic Messages SSE
# --------------------------------------------------------------------------


def _sse(event: str, data: dict) -> str:
    """Format a single SSE event for the outbound (Anthropic) stream."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _is_missing_signature_error(text: str) -> bool:
    """H1: detect the SDK-side "missing signature" API error class.

    The error recurs on long multi-turn conversations when a reasoning→thinking
    block lacks the signature the API wants on resume. We retry the upstream
    call once when the relay reports it (or a close variant).
    """
    lowered = text.lower()
    return "signature" in lowered and (
        "missing" in lowered or "required" in lowered or "invalid" in lowered
    )


async def _relay_stream_chunks(request_body: dict) -> AsyncIterator[dict]:
    """Yield parsed OpenAI chat-completion chunks from the relay's SSE stream.

    Raises ``_RelayError`` (carrying the raw upstream status/body for the H1
    retry decision) on a non-200; the body is never surfaced to the user.
    """
    # Local-dev direct mode swaps the deployer relay for a direct OpenRouter call (DEV ONLY); the SSE
    # parsing below is identical because OpenRouter's stream is exactly what the relay forwards.
    if _LOCAL_DIRECT:
        url, headers = _OPENROUTER_URL, _local_direct_headers()
        body_bytes = json.dumps(_local_direct_payload(request_body)).encode("utf-8")
    else:
        url, headers = _RELAY_URL, _relay_headers()
        body_bytes = json.dumps(request_body).encode("utf-8")

    async with httpx.AsyncClient(timeout=_RELAY_TIMEOUT) as client:
        async with client.stream(
            "POST",
            url,
            headers=headers,
            content=body_bytes,
        ) as response:
            if response.status_code != 200:
                error_text = (await response.aread()).decode("utf-8", errors="replace")
                logger.error(
                    "Relay stream failed",
                    _name="STANDARD_PROXY_RELAY_ERROR",
                    status=response.status_code,
                    body=error_text[:500],
                )
                raise _RelayError(response.status_code, error_text)

            async for line in response.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[len("data:") :].strip()
                if payload == "[DONE]":
                    return
                try:
                    yield json.loads(payload)
                except json.JSONDecodeError:
                    logger.warning(
                        "Skipping malformed SSE chunk",
                        _name="STANDARD_PROXY_BAD_CHUNK",
                        payload=payload[:200],
                    )


class _RelayError(Exception):
    """Upstream relay returned a non-200. Carries status + raw body so the
    caller can decide whether to retry (H1); the body is never user-visible."""

    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"relay returned {status}")
        self.status = status
        self.body = body


async def _stream_response(request_body: dict, model: str):
    """Stream the relay's OpenAI-format response back as Anthropic Messages SSE.

    Anthropic streaming structure: a single message_start, then one or more
    content blocks (each bounded by content_block_start/_stop) carrying text,
    thinking, or tool_use payloads, then a message_delta with stop_reason and
    usage, then message_stop.

    OpenAI streaming structure: message_start is implicit; each chunk carries a
    delta whose role/content/tool_calls fields incrementally describe the
    response. Tool calls stream as delta.tool_calls[].function.arguments
    fragments and are aggregated into Anthropic tool_use content blocks.

    H1 (signature retry): if the FIRST upstream attempt fails before we have
    emitted any Anthropic SSE with the "missing signature" error class, retry
    the relay call once. Once we have started emitting blocks we can't cleanly
    restart, so a mid-stream failure falls through to the opaque error event.

    H2 (reasoning salvage): if the turn ends with thinking emitted but zero
    text, promote the buffered reasoning tail into a text block so the user
    never sees a blank (billed) turn.
    """
    msg_id = f"msg_{uuid.uuid4().hex[:24]}"

    yield _sse(
        "message_start",
        {
            "type": "message_start",
            "message": {
                "id": msg_id,
                "type": "message",
                "role": "assistant",
                "content": [],
                # Always report the opaque id so the trace/credits key on it.
                "model": NUMA_STANDARD_MODEL_ID,
                "stop_reason": None,
                "usage": {"input_tokens": 0, "output_tokens": 0},
            },
        },
    )

    input_tokens = 0
    output_tokens = 0
    cache_read_tokens = 0
    cache_write_tokens = 0
    upstream_cost: float | None = None
    block_index = 0
    thinking_block_started = False
    thinking_chars = 0
    text_block_started = False
    text_chars = 0
    # H2: buffer the reasoning text so we can salvage it into a visible text
    # block if the turn produces no `content` at all.
    reasoning_buffer: list[str] = []
    # active tool_index -> {"id", "name", "block_index"}
    active_tools: dict[int, dict] = {}
    stop_reason = "end_turn"

    # ── Output guard: hold the start of the text stream until we can classify
    # it (clean vs CJK refusal), then either flush-and-stream-live or substitute
    # an English decline. `user_is_cjk` keeps legitimate Chinese work flowing.
    user_is_cjk = _user_writes_cjk(request_body)
    text_prefix: list[str] = []
    text_decided = False
    cjk_blocked = False
    # Set once DSML markup appears in the reasoning channel — we stop streaming
    # thinking from that point so the leaked markup doesn't show in the (collapsed)
    # thinking UI either; the salvage guard replaces the answer.
    reasoning_tainted = False

    async def _emit_decided_text(buffered: str) -> AsyncIterator[str]:
        """Classify the held text prefix and emit it. Clean → close any open
        thinking block, open a live text block, flush the prefix (the block stays
        open for subsequent live deltas). CJK refusal → emit a self-contained
        English-decline text block and swallow the rest of the turn's text."""
        nonlocal block_index, thinking_block_started, text_block_started
        nonlocal text_chars, cjk_blocked, text_decided, stop_reason
        text_decided = True
        if thinking_block_started:
            yield _sse(
                "content_block_stop",
                {"type": "content_block_stop", "index": block_index},
            )
            block_index += 1
            thinking_block_started = False
        text_chars += len(buffered)
        if _is_cjk_refusal(buffered, user_is_cjk):
            cjk_blocked = True
            stop_reason = "end_turn"
            logger.warning(
                "Suppressed CJK refusal — substituted English decline",
                _name="STANDARD_PROXY_CJK_BLOCKED",
                cjk_ratio=round(_cjk_ratio(buffered)[0], 3),
                sample=buffered[:80],
            )
            yield _sse(
                "content_block_start",
                {
                    "type": "content_block_start",
                    "index": block_index,
                    "content_block": {"type": "text", "text": ""},
                },
            )
            yield _sse(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": block_index,
                    "delta": {"type": "text_delta", "text": _CJK_DECLINE},
                },
            )
            yield _sse(
                "content_block_stop",
                {"type": "content_block_stop", "index": block_index},
            )
            block_index += 1
        else:
            text_block_started = True
            yield _sse(
                "content_block_start",
                {
                    "type": "content_block_start",
                    "index": block_index,
                    "content_block": {"type": "text", "text": ""},
                },
            )
            yield _sse(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": block_index,
                    "delta": {"type": "text_delta", "text": buffered},
                },
            )

    # ── H1: open the upstream stream with one retry on the signature error ──
    # We must resolve the FIRST chunk before emitting any content blocks so a
    # pre-stream failure is retryable. Buffer the first chunk, then iterate.
    async def _open_upstream() -> (
        "tuple[dict | None, AsyncIterator[dict] | None, _RelayError | None]"
    ):
        chunk_iter: AsyncIterator[dict] | None = None
        first_chunk: dict | None = None
        last_error: _RelayError | None = None
        for attempt in range(2):
            try:
                candidate = _relay_stream_chunks(request_body)
                first_chunk = await candidate.__anext__()
                chunk_iter = candidate
                break
            except StopAsyncIteration:
                # Empty stream (no chunks, clean close) — finished turn.
                chunk_iter = None
                first_chunk = None
                last_error = None
                break
            except _RelayError as e:
                last_error = e
                # P-05: retry the first attempt on the transient upstream classes
                # — H1 missing-signature, any 5xx, and an empty-body 400 (the
                # peer-closed / Cloudflare-disconnect signature). One retry only.
                is_sig = _is_missing_signature_error(e.body)
                empty_body = not (e.body or "").strip()
                transient = (
                    is_sig or e.status >= 500 or (e.status == 400 and empty_body)
                )
                if attempt == 0 and transient:
                    logger.warning(
                        "Retrying relay after transient upstream error",
                        _name=(
                            "STANDARD_PROXY_SIGNATURE_RETRY"
                            if is_sig
                            else "STANDARD_PROXY_TRANSIENT_RETRY"
                        ),
                        status=e.status,
                        empty_body=empty_body,
                    )
                    continue
                break
            except Exception as e:  # transport-level failure
                last_error = _RelayError(0, str(e))
                if attempt == 0:
                    logger.warning(
                        "Retrying relay after transport error",
                        _name="STANDARD_PROXY_TRANSIENT_RETRY",
                        error=str(e) or "<empty>",
                        error_type=type(e).__name__,
                    )
                    continue
                logger.error(
                    "Relay transport error (no retry left)",
                    _name="STANDARD_PROXY_RELAY_ERROR",
                    error=str(e) or "<empty>",
                    error_type=type(e).__name__,
                )
                break
        return first_chunk, chunk_iter, last_error

    async def _raw_chunks(
        first_chunk: dict | None, chunk_iter: AsyncIterator[dict] | None
    ) -> AsyncIterator[dict]:
        if first_chunk is not None:
            yield first_chunk
        if chunk_iter is not None:
            async for c in chunk_iter:
                yield c

    open_failed = False

    async def _classified_chunks() -> AsyncIterator[dict]:
        """Yield the turn's chunks, re-rolling the upstream ONCE if the first
        attempt is a CJK refusal. The refusal is stochastic for benign prompts
        (a retry returns the real answer) and deterministic for censored topics
        (the retry refuses again → the main loop substitutes the English
        decline). Turns with reasoning or a tool call are accepted immediately
        — they aren't the pure-text refusal we re-roll."""
        nonlocal open_failed
        for cjk_attempt in range(2):
            first_chunk, chunk_iter, last_error = await _open_upstream()
            if last_error is not None and first_chunk is None:
                open_failed = True
                return
            src = _raw_chunks(first_chunk, chunk_iter)
            buffered: list[dict] = []
            text_acc: list[str] = []
            verdict: str | None = None
            async for c in src:
                buffered.append(c)
                delta = (c.get("choices") or [{}])[0].get("delta") or {}
                if (
                    delta.get("tool_calls")
                    or delta.get("reasoning_content")
                    or delta.get("reasoning")
                ):
                    verdict = "accept"  # not a pure-text refusal
                    break
                piece = delta.get("content")
                if piece:
                    text_acc.append(piece)
                joined = "".join(text_acc)
                finish = (c.get("choices") or [{}])[0].get("finish_reason")
                refusal = _is_cjk_refusal(joined, user_is_cjk)
                nonspace = sum(1 for ch in joined if not ch.isspace())
                if refusal or nonspace >= _TEXT_HOLD_CHARS or finish:
                    verdict = "retry" if (refusal and cjk_attempt == 0) else "accept"
                    break
            if verdict == "retry":
                logger.warning(
                    "CJK refusal on first attempt — re-rolling the upstream once",
                    _name="STANDARD_PROXY_CJK_RETRY",
                    sample="".join(text_acc)[:80],
                )
                await src.aclose()
                continue
            # accept: replay what we buffered to classify, then stream the rest.
            for c in buffered:
                yield c
            async for c in src:
                yield c
            return

    try:
        async for chunk in _classified_chunks():
            usage = chunk.get("usage")
            if usage:
                input_tokens = usage.get("prompt_tokens", 0) or 0
                output_tokens = usage.get("completion_tokens", 0) or 0
                details = usage.get("prompt_tokens_details") or {}
                cache_read_tokens = (
                    details.get("cached_tokens")
                    or usage.get("cache_read_input_tokens")
                    or 0
                )
                cache_write_tokens = (
                    details.get("cache_write_tokens")
                    or usage.get("cache_creation_input_tokens")
                    or 0
                )
                if usage.get("cost") is not None:
                    upstream_cost = usage.get("cost")

            choices = chunk.get("choices") or []
            if not choices:
                continue
            choice = choices[0]
            delta = choice.get("delta") or {}

            finish_reason = choice.get("finish_reason")
            if finish_reason:
                if finish_reason == "tool_calls":
                    stop_reason = "tool_use"
                elif finish_reason == "length":
                    stop_reason = "max_tokens"
                else:
                    stop_reason = "end_turn"

            # Reasoning / thinking content. The upstream uses
            # `reasoning`; accept `reasoning_content` too for provider parity.
            reasoning = delta.get("reasoning_content") or delta.get("reasoning")
            if reasoning:
                thinking_chars += len(reasoning)
                reasoning_buffer.append(reasoning)
                # Once DSML markup appears, stop streaming thinking — cap the
                # visible leak to whatever preceded the marker. We keep buffering
                # into reasoning_buffer so the salvage guard still sees the whole
                # turn and replaces the answer with a clean fallback.
                if not reasoning_tainted and _DSML_BAR in reasoning:
                    reasoning_tainted = True
                if not reasoning_tainted:
                    if not thinking_block_started:
                        yield _sse(
                            "content_block_start",
                            {
                                "type": "content_block_start",
                                "index": block_index,
                                "content_block": {"type": "thinking", "thinking": ""},
                            },
                        )
                        thinking_block_started = True
                    yield _sse(
                        "content_block_delta",
                        {
                            "type": "content_block_delta",
                            "index": block_index,
                            "delta": {"type": "thinking_delta", "thinking": reasoning},
                        },
                    )

            text_delta = delta.get("content")
            if text_delta:
                if cjk_blocked:
                    # Refusal already substituted — swallow the model's remaining
                    # text (still count chars so the turn isn't seen as empty).
                    text_chars += len(text_delta)
                elif text_decided:
                    # Classified clean — stream live into the open text block.
                    text_chars += len(text_delta)
                    yield _sse(
                        "content_block_delta",
                        {
                            "type": "content_block_delta",
                            "index": block_index,
                            "delta": {"type": "text_delta", "text": text_delta},
                        },
                    )
                else:
                    # Buffering phase: hold the opening of the answer until we can
                    # classify it (clean vs CJK refusal). The ratio short-circuit
                    # decides a refusal almost immediately; clean English flushes
                    # after ~a few words.
                    text_prefix.append(text_delta)
                    buffered = "".join(text_prefix)
                    nonspace = sum(1 for c in buffered if not c.isspace())
                    if (
                        _is_cjk_refusal(buffered, user_is_cjk)
                        or nonspace >= _TEXT_HOLD_CHARS
                        or finish_reason
                    ):
                        async for ev in _emit_decided_text(buffered):
                            yield ev

            tool_calls = delta.get("tool_calls") or []
            if tool_calls:
                # Flush any held text preamble before the tool call so a short
                # "let me check…" sentence isn't stranded in the buffer.
                if text_prefix and not text_decided:
                    async for ev in _emit_decided_text("".join(text_prefix)):
                        yield ev
                if thinking_block_started:
                    yield _sse(
                        "content_block_stop",
                        {"type": "content_block_stop", "index": block_index},
                    )
                    block_index += 1
                    thinking_block_started = False
                if text_block_started:
                    yield _sse(
                        "content_block_stop",
                        {"type": "content_block_stop", "index": block_index},
                    )
                    block_index += 1
                    text_block_started = False

                for tc in tool_calls:
                    tc_index = tc.get("index", 0)
                    function = tc.get("function") or {}

                    if tc_index not in active_tools:
                        tool_id = tc.get("id") or f"toolu_{uuid.uuid4().hex[:12]}"
                        tool_name = function.get("name") or ""
                        active_tools[tc_index] = {
                            "id": tool_id,
                            "name": tool_name,
                            "block_index": block_index,
                        }
                        yield _sse(
                            "content_block_start",
                            {
                                "type": "content_block_start",
                                "index": block_index,
                                "content_block": {
                                    "type": "tool_use",
                                    "id": tool_id,
                                    "name": tool_name,
                                    "input": {},
                                },
                            },
                        )
                        block_index += 1

                    args_fragment = function.get("arguments")
                    if args_fragment:
                        yield _sse(
                            "content_block_delta",
                            {
                                "type": "content_block_delta",
                                "index": active_tools[tc_index]["block_index"],
                                "delta": {
                                    "type": "input_json_delta",
                                    "partial_json": args_fragment,
                                },
                            },
                        )

        if open_failed:
            # The upstream never produced a first chunk (transient failure, no
            # retry left) — surface an opaque, user-safe error.
            yield _sse(
                "error",
                {
                    "type": "error",
                    "error": {"type": "api_error", "message": _OPAQUE_UPSTREAM_ERROR},
                },
            )
            return

        # Flush any text still held in the buffer that never reached the decision
        # threshold (a short answer, or finish_reason arriving in a content-less
        # chunk). Classify and emit it the same way as the mid-stream path.
        if text_prefix and not text_decided:
            async for ev in _emit_decided_text("".join(text_prefix)):
                yield ev

        # ── H2: reasoning-channel salvage (+ DSML-leak guard) ──────────────
        # If the turn emitted thinking but ZERO text and made no tool call, the
        # answer is stranded in the reasoning channel — close the thinking block
        # and promote the buffered reasoning tail into a visible text block
        # (bench 14). EXCEPT when that buffer is a leaked DSML tool-call
        # (`<｜DSML｜…｜>`): surfacing it would show the user raw markup while the
        # action never ran — emit a clean fallback instead.
        salvaged = False
        dsml_suppressed = False
        salvage_candidate = "".join(reasoning_buffer).strip()
        if text_chars == 0 and not active_tools and reasoning_buffer:
            # Close the thinking block if one was opened (clean reasoning that
            # streamed before any taint). A turn tainted from the first delta
            # never opened one — still salvage so the user doesn't see a blank.
            if thinking_block_started:
                yield _sse(
                    "content_block_stop",
                    {"type": "content_block_stop", "index": block_index},
                )
                block_index += 1
                thinking_block_started = False
            if reasoning_tainted or _looks_like_dsml(salvage_candidate):
                dsml_suppressed = True
                stop_reason = "end_turn"
                logger.warning(
                    "Suppressed DSML tool-call leak in reasoning salvage",
                    _name="STANDARD_PROXY_DSML_LEAK",
                    sample=salvage_candidate[:160],
                )
                salvaged_text = _DSML_FALLBACK
            else:
                salvaged_text = salvage_candidate
                salvaged = True
            yield _sse(
                "content_block_start",
                {
                    "type": "content_block_start",
                    "index": block_index,
                    "content_block": {"type": "text", "text": ""},
                },
            )
            yield _sse(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": block_index,
                    "delta": {"type": "text_delta", "text": salvaged_text},
                },
            )
            yield _sse(
                "content_block_stop",
                {"type": "content_block_stop", "index": block_index},
            )
            block_index += 1

        # Close any still-open content blocks.
        if thinking_block_started:
            yield _sse(
                "content_block_stop",
                {"type": "content_block_stop", "index": block_index},
            )
            block_index += 1
        if text_block_started:
            yield _sse(
                "content_block_stop",
                {"type": "content_block_stop", "index": block_index},
            )
        for tool_info in active_tools.values():
            yield _sse(
                "content_block_stop",
                {"type": "content_block_stop", "index": tool_info["block_index"]},
            )

        # Record the relay's true cost for the runner (Option A).
        _record_upstream_cost(upstream_cost)

        # Anthropic convention: input_tokens EXCLUDES cache-read tokens.
        non_cached_input = max(0, input_tokens - cache_read_tokens)
        yield _sse(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": stop_reason},
                "usage": {
                    "input_tokens": non_cached_input,
                    "output_tokens": output_tokens,
                    "cache_read_input_tokens": cache_read_tokens,
                    "cache_creation_input_tokens": cache_write_tokens,
                },
            },
        )
        yield _sse("message_stop", {"type": "message_stop"})

        logger.info(
            "Standard-model stream complete",
            _name="STANDARD_PROXY_STREAM_DONE",
            inbound_model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read_tokens,
            cache_write_tokens=cache_write_tokens,
            upstream_cost_usd=upstream_cost,
            accumulated_cost_usd=get_accumulated_cost(),
            stop_reason=stop_reason,
            tool_calls=len(active_tools),
            has_thinking=thinking_chars > 0,
            thinking_chars=thinking_chars,
            text_chars=text_chars,
            reasoning_salvaged=salvaged,
            dsml_suppressed=dsml_suppressed,
            cjk_blocked=cjk_blocked,
        )

    except Exception as e:
        # Mid-stream failure after we've already emitted blocks — log the real
        # cause, surface only the opaque message.
        logger.error(
            "Standard-model streaming exception",
            _name="STANDARD_PROXY_STREAM_ERROR",
            error=str(e),
        )
        yield _sse(
            "error",
            {
                "type": "error",
                "error": {"type": "api_error", "message": _OPAQUE_UPSTREAM_ERROR},
            },
        )


# --------------------------------------------------------------------------
# Lifecycle
# --------------------------------------------------------------------------


def _run_uvicorn_in_thread(app) -> None:
    """Entrypoint for the uvicorn daemon thread.

    uvicorn manages its own asyncio loop inside this thread; the main thread
    polls the module-level ``_ready`` flag (set by the FastAPI lifespan handler
    once startup completes).

    ``log_config=None`` tells uvicorn to skip its default
    ``logging.config.dictConfig`` invocation — we rely on structlog, and
    uvicorn's default config interferes with the CloudWatch handler chain in
    AgentCore (the root cause of a previous startup hang).
    """
    import uvicorn

    try:
        logger.info(
            "thread: starting uvicorn",
            _name="STANDARD_PROXY_DEBUG",
            step="thread_uvicorn_start",
        )
        uvicorn.run(
            app,
            host=PROXY_HOST,
            port=PROXY_PORT,
            log_config=None,
            access_log=False,
        )
    except Exception as e:
        logger.error(
            "uvicorn thread exited with exception",
            _name="STANDARD_PROXY_DEBUG_ERR",
            step="thread_uvicorn_error",
            error=str(e),
            error_type=type(e).__name__,
        )


async def ensure_running(region: str | None = None) -> None:
    """Start the Numa Standard Model proxy if not already running.

    Spawns uvicorn in a dedicated daemon thread so its asyncio loop doesn't
    collide with the workspace agent's main event loop. Idempotent — safe to
    call from a FastAPI lifespan handler and again lazily per request.

    The relay URL is read from ``NUMA_STANDARD_MODEL_RELAY_URL``. If it is
    unset, the proxy still starts (so localhost binding/health works) but any
    upstream call will fail with the opaque error — the standard model simply
    isn't wired in that environment.
    """
    global _server_thread, _ready, _REGION, _RELAY_URL

    logger.info("entry", _name="STANDARD_PROXY_DEBUG", step="entry")

    # Fast path
    if _ready and _server_thread is not None and _server_thread.is_alive():
        logger.info("fast-path return", _name="STANDARD_PROXY_DEBUG", step="fast_path")
        return

    async with _lock:
        logger.info("lock acquired", _name="STANDARD_PROXY_DEBUG", step="lock_acquired")

        if _ready and _server_thread is not None and _server_thread.is_alive():
            logger.info(
                "ready after lock",
                _name="STANDARD_PROXY_DEBUG",
                step="ready_after_lock",
            )
            return

        _REGION = region or os.environ.get("AWS_REGION", "us-east-1")
        _RELAY_URL = os.environ.get("NUMA_STANDARD_MODEL_RELAY_URL", "")
        _resolve_local_direct()

        logger.info(
            "Starting Numa Standard Model proxy",
            _name="STANDARD_PROXY_START",
            port=PROXY_PORT,
            region=_REGION,
            relay_configured=bool(_RELAY_URL),
            local_direct=_LOCAL_DIRECT,
            forwarded_model=NUMA_STANDARD_MODEL_ID,
        )

        app = _create_app()

        _server_thread = threading.Thread(
            target=_run_uvicorn_in_thread,
            args=(app,),
            daemon=True,
            name="standard-model-proxy-uvicorn",
        )
        _server_thread.start()

        logger.info(
            "polling for ready (timeout=30s)",
            _name="STANDARD_PROXY_DEBUG",
            step="polling_start",
        )

        for i in range(300):
            if _ready:
                logger.info(
                    f"proxy ready after {i * 0.1:.1f}s",
                    _name="STANDARD_PROXY_DEBUG",
                    step="ready",
                    iterations=i,
                )
                return

            if not _server_thread.is_alive():
                logger.error(
                    "uvicorn thread died before becoming ready",
                    _name="STANDARD_PROXY_DEBUG_ERR",
                    step="thread_dead",
                )
                raise RuntimeError(
                    "Standard-model proxy uvicorn thread exited without becoming ready"
                )

            if i and i % 20 == 0:
                logger.info(
                    f"still waiting at {i * 0.1:.1f}s",
                    _name="STANDARD_PROXY_DEBUG",
                    step="still_waiting",
                    iterations=i,
                )

            await asyncio.sleep(0.1)

        logger.error(
            "startup timeout (30s)",
            _name="STANDARD_PROXY_DEBUG_ERR",
            step="timeout",
        )
        raise RuntimeError(
            "Numa Standard Model proxy failed to start within 30 seconds"
        )
