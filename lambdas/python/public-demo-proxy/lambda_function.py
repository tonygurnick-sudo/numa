"""
Public Demo Chat Proxy Lambda

Unauthenticated proxy for the public demo chat page. Bridges CloudFront HTTP
requests to AgentCore SDK calls, similar to the workspace-chat-agent-proxy but
with no JWT validation, forced Sonnet 4.6 model, and daily cost limits.

Key differences from the workspace proxy:
- No authentication (no Cognito, no CloudFront secret)
- Forced model: Sonnet 4.6 (overrides any frontend request)
- Daily cost limit enforced via DynamoDB counters
- Simple per-IP rate limiting
- Synthetic user identity (public-demo-user)
- Session prefix: public-{conversationId}
- Restricted tool set (no KB, no integrations, no Ops)
"""

import asyncio
import json
import logging
import os
import queue as queue_mod
import time as time_mod
from collections import defaultdict
from datetime import datetime, timezone
from typing import AsyncGenerator

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI()

# Route prefix - CloudFront forwards the full path
PREFIX = "/api/public-demo"

# ── Environment Configuration ─────────────────────────────────────────────────

AGENT_RUNTIME_ARN = os.environ.get("AGENT_RUNTIME_ARN", "")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "unknown")
OUTPUTS_BUCKET_NAME = os.environ.get("OUTPUTS_BUCKET_NAME", "")
COUNTERS_TABLE_NAME = os.environ.get("COUNTERS_TABLE_NAME", "")
DAILY_LIMIT_USD = float(os.environ.get("DAILY_LIMIT_USD", "10"))
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
AGENTCORE_REGION = os.environ.get("AGENTCORE_REGION", AWS_REGION)
DEMO_S3_ROLE_ARN = os.environ.get("DEMO_S3_ROLE_ARN", "")

# Fixed synthetic user identity for all public demo requests
PUBLIC_DEMO_USER_SUB = "public-demo-user"

# Forced model: Sonnet 4.6 (bare ID - workspace agent will regionalize)
FORCED_MODEL_ID = "anthropic.claude-sonnet-4-6"

# ── Request Constraints ───────────────────────────────────────────────────────

MAX_MESSAGE_LENGTH = 5000
MAX_ALLOWED_ACTIONS = {"chat", "upload", "stop"}

# ── Rate Limiting (in-memory, resets on Lambda cold start) ────────────────────

# Per-IP request tracking: {ip: [(timestamp, ...),]}
_rate_limit_window_seconds = 60
_rate_limit_max_requests = 10
_rate_limit_map: dict[str, list[float]] = defaultdict(list)

# ── AgentCore Client ──────────────────────────────────────────────────────────

logger.info(
    "Initializing public-demo-proxy: region=%s, agentcore_region=%s, client=%s",
    AWS_REGION,
    AGENTCORE_REGION,
    CLIENT_NAME,
)

agentcore_config = Config(
    read_timeout=900,  # Match Lambda timeout (15 minutes)
    connect_timeout=10,
    retries={"max_attempts": 0},  # Don't retry streaming calls
)

agentcore_client = boto3.client(
    "bedrock-agentcore",
    region_name=AGENTCORE_REGION,
    config=agentcore_config,
)

# DynamoDB client for cost tracking
dynamodb_client = boto3.client("dynamodb", region_name=AWS_REGION)

# STS client for vending scoped credentials to the browser
sts_client = boto3.client("sts", region_name=AWS_REGION) if DEMO_S3_ROLE_ARN else None

# Lambda client for invoking workspace-chat-tools (document conversion)
WORKSPACE_TOOLS_LAMBDA_NAME = os.environ.get("WORKSPACE_TOOLS_LAMBDA_NAME", "")
lambda_client = (
    boto3.client("lambda", region_name=AWS_REGION)
    if WORKSPACE_TOOLS_LAMBDA_NAME
    else None
)

# Retry config for AgentCore 502 errors (container cold-start)
AGENTCORE_502_MAX_RETRIES = 3
AGENTCORE_502_BASE_DELAY = 2.0


# ── Rate Limiting ─────────────────────────────────────────────────────────────


def _check_rate_limit(client_ip: str) -> bool:
    """Check if a client IP has exceeded the rate limit.

    Simple sliding window: track request timestamps per IP, prune old entries.
    Resets on Lambda cold start (acceptable for demo use).

    Returns True if request is allowed, False if rate limited.
    """
    now = time_mod.time()
    cutoff = now - _rate_limit_window_seconds

    # Prune old entries
    timestamps = _rate_limit_map[client_ip]
    _rate_limit_map[client_ip] = [t for t in timestamps if t > cutoff]

    if len(_rate_limit_map[client_ip]) >= _rate_limit_max_requests:
        return False

    _rate_limit_map[client_ip].append(now)
    return True


# ── Daily Cost Tracking ───────────────────────────────────────────────────────


def _get_today_key() -> str:
    """Get today's date string in UTC for DynamoDB key."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _check_daily_limit() -> tuple[bool, float]:
    """Check if the daily cost limit has been exceeded.

    Returns (allowed, current_cost_usd).
    """
    if not COUNTERS_TABLE_NAME:
        logger.warning("No counters table configured, allowing request")
        return True, 0.0

    try:
        today = _get_today_key()
        result = dynamodb_client.get_item(
            TableName=COUNTERS_TABLE_NAME,
            Key={
                "PK": {"S": "PUBLIC_DEMO"},
                "SK": {"S": f"COST#DATE#{today}"},
            },
            ProjectionExpression="accumulated_cost_usd",
        )
        item = result.get("Item", {})
        current = float(item.get("accumulated_cost_usd", {}).get("N", "0"))
        return current < DAILY_LIMIT_USD, current
    except Exception:
        logger.exception("Failed to check daily cost limit")
        # Fail open -- don't block demo if DynamoDB is unreachable
        return True, 0.0


def _record_cost(cost_usd: float) -> None:
    """Record a cost entry for today. Fire-and-forget (errors are logged, not raised)."""
    if not COUNTERS_TABLE_NAME or cost_usd <= 0:
        return

    try:
        today = _get_today_key()
        dynamodb_client.update_item(
            TableName=COUNTERS_TABLE_NAME,
            Key={
                "PK": {"S": "PUBLIC_DEMO"},
                "SK": {"S": f"COST#DATE#{today}"},
            },
            UpdateExpression="ADD accumulated_cost_usd :cost SET #ttl = :ttl",
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={
                # ADD is atomic -- safe for concurrent Lambda invocations
                ":cost": {"N": str(cost_usd)},
                # 90-day TTL for automatic cleanup
                ":ttl": {"N": str(int(time_mod.time()) + 86400 * 90)},
            },
        )
        logger.info(
            "Recorded public demo cost",
            extra={"cost_usd": cost_usd, "date": today},
        )
    except Exception:
        logger.exception("Failed to record cost (non-fatal)")


def _record_conversation(conversation_id: str) -> None:
    """Increment today's message count and track unique conversations. Fire-and-forget."""
    if not COUNTERS_TABLE_NAME:
        return

    today = _get_today_key()
    ttl_value = {"N": str(int(time_mod.time()) + 86400 * 90)}

    # Always increment the message counter
    try:
        dynamodb_client.update_item(
            TableName=COUNTERS_TABLE_NAME,
            Key={
                "PK": {"S": "PUBLIC_DEMO"},
                "SK": {"S": f"CONVERSATIONS#DATE#{today}"},
            },
            UpdateExpression="ADD conversation_count :inc SET #ttl = :ttl",
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={
                ":inc": {"N": "1"},
                ":ttl": ttl_value,
            },
        )
    except Exception:
        logger.exception("Failed to record message count (non-fatal)")

    # Track unique conversations: write a marker item, then conditionally increment
    try:
        dynamodb_client.put_item(
            TableName=COUNTERS_TABLE_NAME,
            Item={
                "PK": {"S": "PUBLIC_DEMO"},
                "SK": {"S": f"CONV_SEEN#DATE#{today}#{conversation_id}"},
                "ttl": ttl_value,
            },
            ConditionExpression="attribute_not_exists(PK)",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return  # Already seen this conversation today
        logger.exception("Failed to write conversation marker (non-fatal)")
        return
    except Exception:
        logger.exception("Failed to write conversation marker (non-fatal)")
        return

    # Put succeeded -- this is a new conversation today, increment the unique counter
    try:
        dynamodb_client.update_item(
            TableName=COUNTERS_TABLE_NAME,
            Key={
                "PK": {"S": "PUBLIC_DEMO"},
                "SK": {"S": f"UNIQUE_CONVERSATIONS#DATE#{today}"},
            },
            UpdateExpression="ADD unique_count :inc SET #ttl = :ttl",
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={
                ":inc": {"N": "1"},
                ":ttl": ttl_value,
            },
        )
        logger.info(
            "New unique conversation",
            extra={"date": today, "conversation_id": conversation_id},
        )
    except Exception:
        logger.exception("Failed to increment unique conversation count (non-fatal)")


# ── Cost Extraction from SSE Stream ──────────────────────────────────────────


def _extract_cost_from_event(event_bytes: bytes) -> float | None:
    """Try to extract total_cost_usd from an SSE event.

    Returns the cost if this is a result event with cost data, else None.
    Only parses events that look like they contain result data (fast check first).
    """
    # Fast check: skip events that can't contain cost data
    if b'"type": "result"' not in event_bytes and b'"type":"result"' not in event_bytes:
        return None

    # Slow path: parse the JSON
    try:
        # Find the data line in the SSE event
        for line in event_bytes.decode("utf-8", errors="replace").split("\n"):
            if line.startswith("data: "):
                event = json.loads(line[6:])
                if event.get("type") == "result":
                    cost = event.get("total_cost_usd")
                    if cost is not None:
                        return float(cost)
    except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
        pass
    return None


# ── Request Sanitization ─────────────────────────────────────────────────────


def _sanitize_request_body(body: dict) -> dict:
    """Sanitize and constrain the request body for the public demo.

    Forces Sonnet 4.6 model, restricts tools, strips enterprise features.
    Returns a new dict (does not mutate the input).
    """
    sanitized = {
        "action": body.get("action", "chat"),
        "prompt": body.get("prompt", ""),
        "conversationId": body.get("conversationId", ""),
        "timezone": body.get("timezone", "UTC"),
        "todayString": body.get("todayString", ""),
        # Force Sonnet 4.6 -- ignore any model the frontend sends
        "modelId": FORCED_MODEL_ID,
        # Use the demo-specific agent type (tailored identity + restricted tools)
        "type": "numa-chat-demo",
        # Disable enterprise features. (Native connectors are also gated on
        # OAUTH_INTEGRATIONS_ENABLED in the workspace agent, so leaving it
        # False here suppresses both Pipedream and native integrations.)
        "featureFlags": {
            "OAUTH_INTEGRATIONS_ENABLED": False,
        },
        # Allowed tools -- web search + read-only KB access
        "enabledTools": ["web_search", "knowledge_base"],
        # Read-only KB access (agent type restricts to query/list/download only)
        "availableKBs": [{"id": "company", "name": "Company KB"}],
        "enabledKBIds": ["company"],
        # New unified shape — public demo never has any integrations enabled.
        "enabledIntegrations": [],
        "availableIntegrations": [],
        # Synthetic user identity
        "userEmail": "demo@numa.arcanum.ai",
    }

    # Pass through attachments if present (for file upload)
    if "attachments" in body:
        sanitized["attachments"] = body["attachments"]

    # Pass through voice recordings if present
    if "voiceRecordings" in body:
        sanitized["voiceRecordings"] = body["voiceRecordings"]

    # Pass through requestId for deduplication
    if "requestId" in body:
        sanitized["requestId"] = body["requestId"]

    return sanitized


# ── AgentCore Invocation ──────────────────────────────────────────────────────


async def _invoke_agentcore_streaming(
    conversation_id: str,
    http_body: dict,
) -> StreamingResponse:
    """Invoke AgentCore and return a streaming SSE response.

    Extracts cost data from the result event and records it to DynamoDB
    after the stream completes.
    """
    session_id = f"public-{conversation_id}"

    payload = {
        "httpMethod": "POST",
        "httpPath": "/invocations",
        "headers": {
            "authorization": "",
            "x-user-sub": PUBLIC_DEMO_USER_SUB,
        },
        "body": http_body,
    }

    payload_bytes = json.dumps(payload).encode("utf-8")

    try:
        last_exception = None
        response = None

        for attempt in range(AGENTCORE_502_MAX_RETRIES + 1):
            try:
                response = agentcore_client.invoke_agent_runtime(
                    agentRuntimeArn=AGENT_RUNTIME_ARN,
                    payload=payload_bytes,
                    contentType="application/json",
                    accept="application/json",
                    runtimeSessionId=session_id,
                )
                break  # Success
            except agentcore_client.exceptions.RuntimeClientError as e:
                if "502" in str(e) and attempt < AGENTCORE_502_MAX_RETRIES:
                    delay = AGENTCORE_502_BASE_DELAY * (2**attempt)
                    logger.warning(
                        "AgentCore 502 on cold start, retrying in %.1fs (attempt %d/%d, session=%s)",
                        delay,
                        attempt + 1,
                        AGENTCORE_502_MAX_RETRIES,
                        session_id,
                    )
                    await asyncio.sleep(delay)
                    last_exception = e
                    continue
                raise

        if response is None:
            raise last_exception  # type: ignore[misc]

        return _stream_response(response)

    except agentcore_client.exceptions.ResourceNotFoundException:
        logger.exception("Agent runtime not found: %s", AGENT_RUNTIME_ARN)
        return JSONResponse(
            status_code=404, content={"error": "Agent runtime not found"}
        )
    except agentcore_client.exceptions.AccessDeniedException:
        logger.exception("Access denied to agent runtime: %s", AGENT_RUNTIME_ARN)
        return JSONResponse(
            status_code=403, content={"error": "Access denied to agent runtime"}
        )
    except Exception as e:
        logger.exception("Error invoking AgentCore runtime: %s", e)
        return JSONResponse(status_code=500, content={"error": str(e)})


async def _invoke_agentcore_json(
    conversation_id: str,
    http_body: dict,
) -> JSONResponse:
    """Invoke AgentCore and collect the full JSON response (for upload/stop actions)."""
    session_id = f"public-{conversation_id}"

    payload = {
        "httpMethod": "POST",
        "httpPath": "/invocations",
        "headers": {
            "authorization": "",
            "x-user-sub": PUBLIC_DEMO_USER_SUB,
        },
        "body": http_body,
    }

    payload_bytes = json.dumps(payload).encode("utf-8")

    try:
        response = agentcore_client.invoke_agent_runtime(
            agentRuntimeArn=AGENT_RUNTIME_ARN,
            payload=payload_bytes,
            contentType="application/json",
            accept="application/json",
            runtimeSessionId=session_id,
        )

        # Collect the full response
        streaming_body = response.get("response")
        if streaming_body is None:
            return JSONResponse(
                status_code=500, content={"error": "No response from AgentCore"}
            )

        chunks = []
        for chunk in streaming_body.iter_chunks(chunk_size=4096):
            chunks.append(chunk)

        body_bytes = b"".join(chunks)
        try:
            result = json.loads(body_bytes)
            return JSONResponse(content=result)
        except json.JSONDecodeError:
            return JSONResponse(
                content={"raw": body_bytes.decode("utf-8", errors="replace")}
            )

    except Exception as e:
        logger.exception("Error invoking AgentCore: %s", e)
        return JSONResponse(status_code=500, content={"error": str(e)})


# ── SSE Streaming ─────────────────────────────────────────────────────────────


def _stream_response(response) -> StreamingResponse:
    """Stream AgentCore response as SSE with cost extraction.

    Passes bytes through with minimal overhead. Simultaneously scans for the
    result event to extract total_cost_usd for daily cost tracking.
    """
    _delim = b"\n\n"
    _keepalive_secs = 30
    _keepalive = b": keepalive\n\n"
    _sentinel = object()

    async def generate() -> AsyncGenerator[bytes, None]:
        accumulated_cost: float = 0.0

        try:
            streaming_body = response.get("response")
            if streaming_body is None:
                logger.error("No 'response' key in AgentCore response")
                yield f'data: {json.dumps({"type": "error", "message": "No response from AgentCore"})}\n\n'.encode()
                return

            # Use a queue + background thread for non-blocking reads from boto3's
            # synchronous streaming_body, with keepalive pings on idle.
            chunk_q: queue_mod.Queue = queue_mod.Queue()

            def _reader() -> None:
                """Background thread: pushes chunks then sentinel."""
                try:
                    for chunk in streaming_body.iter_chunks(chunk_size=128):
                        chunk_q.put(chunk)
                except Exception as exc:
                    chunk_q.put(exc)
                chunk_q.put(_sentinel)

            loop = asyncio.get_event_loop()
            loop.run_in_executor(None, _reader)

            # Buffer for reassembling SSE events across chunk boundaries
            # (chunks from AgentCore don't always align with SSE event boundaries)
            event_buffer = b""

            while True:
                try:
                    item = await asyncio.to_thread(chunk_q.get, True, _keepalive_secs)
                except queue_mod.Empty:
                    yield _keepalive
                    continue

                if item is _sentinel:
                    # Flush any remaining buffer
                    if event_buffer.strip():
                        cost = _extract_cost_from_event(event_buffer)
                        if cost is not None:
                            accumulated_cost += cost
                        yield event_buffer
                    break

                if isinstance(item, BaseException):
                    raise item

                # Add chunk to buffer and process complete events
                event_buffer += item

                # Process all complete SSE events in the buffer
                while _delim in event_buffer:
                    event_bytes, event_buffer = event_buffer.split(_delim, 1)
                    full_event = event_bytes + _delim

                    # Check for cost data in result events
                    cost = _extract_cost_from_event(full_event)
                    if cost is not None:
                        accumulated_cost += cost

                    yield full_event

        except Exception as e:
            logger.exception("Error streaming AgentCore response: %s", e)
            yield f'data: {json.dumps({"type": "error", "message": str(e)})}\n\n'.encode()
        finally:
            # Record accumulated cost (fire-and-forget)
            if accumulated_cost > 0:
                _record_cost(accumulated_cost)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────


def _get_client_ip(request: Request) -> str:
    """Extract client IP from request, respecting CloudFront X-Forwarded-For."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        # X-Forwarded-For: client, proxy1, proxy2 -- take the first (client) IP
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@app.get(f"{PREFIX}/ping")
async def ping():
    """Health check endpoint."""
    return JSONResponse(content={"status": "ok", "service": "public-demo-proxy"})


@app.get(f"{PREFIX}/credentials")
async def get_credentials(request: Request):
    """Vend temporary, scoped AWS credentials for browser-side S3 file access.

    Returns short-lived STS credentials from a purpose-built IAM role that only
    allows S3 GetObject on the public demo workspace prefix. These credentials
    cannot access any other AWS service or any non-demo files.
    """
    client_ip = _get_client_ip(request)
    if not _check_rate_limit(client_ip):
        return JSONResponse(
            status_code=429,
            content={"error": "Too many requests. Please wait a moment and try again."},
        )

    if not sts_client or not DEMO_S3_ROLE_ARN:
        return JSONResponse(
            status_code=503,
            content={"error": "Credential vending not configured"},
        )

    try:
        # 15-minute session -- short-lived to minimize exposure window
        response = sts_client.assume_role(
            RoleArn=DEMO_S3_ROLE_ARN,
            RoleSessionName="public-demo-browser",
            DurationSeconds=900,
        )

        creds = response["Credentials"]
        return JSONResponse(
            content={
                "accessKeyId": creds["AccessKeyId"],
                "secretAccessKey": creds["SecretAccessKey"],
                "sessionToken": creds["SessionToken"],
                "expiration": creds["Expiration"].isoformat(),
                "region": AWS_REGION,
                "bucket": OUTPUTS_BUCKET_NAME,
            }
        )
    except Exception as e:
        logger.exception("Failed to assume demo S3 role: %s", e)
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to generate credentials"},
        )


@app.post(f"{PREFIX}/invocations")
async def invocations(request: Request):
    """Main chat/upload endpoint.

    No authentication required. Enforces:
    - Rate limiting per IP
    - Daily cost limit
    - Forced Sonnet 4.6 model
    - Restricted tool set
    - Message length limit
    """
    # Rate limiting
    client_ip = _get_client_ip(request)
    if not _check_rate_limit(client_ip):
        logger.warning("Rate limit exceeded for IP: %s", client_ip)
        return JSONResponse(
            status_code=429,
            content={"error": "Too many requests. Please wait a moment and try again."},
        )

    # Daily cost limit
    allowed, current_cost = _check_daily_limit()
    if not allowed:
        logger.info(
            "Daily cost limit reached: $%.2f / $%.2f",
            current_cost,
            DAILY_LIMIT_USD,
        )
        return JSONResponse(
            status_code=429,
            content={"error": "Daily demo limit reached. Please try again tomorrow."},
        )

    # Parse request body
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    # Validate action
    action = body.get("action", "chat")
    if action not in MAX_ALLOWED_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Action '{action}' is not allowed in demo mode",
        )

    # Validate message length
    prompt = body.get("prompt", "")
    if isinstance(prompt, str) and len(prompt) > MAX_MESSAGE_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Message too long (max {MAX_MESSAGE_LENGTH} characters)",
        )

    # Validate conversation ID is present
    conversation_id = body.get("conversationId", "")
    if not conversation_id:
        raise HTTPException(status_code=400, detail="Missing conversationId")

    # Sanitize and constrain the request
    sanitized_body = _sanitize_request_body(body)

    logger.info(
        "Public demo request",
        extra={
            "action": action,
            "conversation_id": conversation_id,
            "client_ip": client_ip,
            "prompt_length": len(prompt) if isinstance(prompt, str) else 0,
        },
    )

    if action == "chat":
        # Track message count + unique conversations (fire-and-forget)
        _record_conversation(conversation_id)
        # Stream SSE response
        return await _invoke_agentcore_streaming(conversation_id, sanitized_body)
    else:
        # Upload/stop actions return JSON
        return await _invoke_agentcore_json(conversation_id, sanitized_body)


@app.post(f"{PREFIX}/upload-complete")
async def upload_complete(request: Request):
    """Notify that a file was uploaded directly to S3.

    The MicroVM syncs from S3 on each invocation, so this is mostly a pass-through
    that returns the expected response shape for the upload modal.
    """
    client_ip = _get_client_ip(request)
    if not _check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests")

    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    filename = body.get("filename", "")
    s3_key = body.get("s3Key", "")
    size = body.get("size", 0)
    conversation_id = body.get("conversationId", "")

    if not filename or not s3_key or not conversation_id:
        raise HTTPException(status_code=400, detail="Missing required fields")

    # Only allow files in the public demo workspace prefix
    if PUBLIC_DEMO_USER_SUB not in s3_key:
        raise HTTPException(status_code=403, detail="Access denied")

    # Return the response shape the upload modal expects
    return JSONResponse(
        content={
            "status": "success",
            "filename": filename,
            "path": f"/workdir/uploads/{filename}",
            "s3Key": s3_key,
            "size": size,
        }
    )


@app.get(f"{PREFIX}/files/{{conversation_id}}")
async def list_files(conversation_id: str, request: Request):
    """List files in a public demo conversation's workspace.

    Forwards to the workspace agent's files endpoint.
    """
    client_ip = _get_client_ip(request)
    if not _check_rate_limit(client_ip):
        return JSONResponse(
            status_code=429,
            content={"error": "Too many requests. Please wait a moment and try again."},
        )

    session_id = f"public-{conversation_id}"

    payload = {
        "httpMethod": "GET",
        "httpPath": f"/files/{conversation_id}",
        "headers": {
            "authorization": "",
            "x-user-sub": PUBLIC_DEMO_USER_SUB,
        },
    }

    payload_bytes = json.dumps(payload).encode("utf-8")

    try:
        response = agentcore_client.invoke_agent_runtime(
            agentRuntimeArn=AGENT_RUNTIME_ARN,
            payload=payload_bytes,
            contentType="application/json",
            accept="application/json",
            runtimeSessionId=session_id,
        )

        streaming_body = response.get("response")
        if streaming_body is None:
            return JSONResponse(status_code=500, content={"error": "No response"})

        chunks = []
        for chunk in streaming_body.iter_chunks(chunk_size=4096):
            chunks.append(chunk)

        body_bytes = b"".join(chunks)
        try:
            result = json.loads(body_bytes)
            return JSONResponse(content=result)
        except json.JSONDecodeError:
            return JSONResponse(content={"files": []})

    except Exception as e:
        logger.exception("Error listing files: %s", e)
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post(f"{PREFIX}/convert-preview")
async def convert_preview(request: Request):
    """Convert a document for frontend preview (e.g. DOCX -> PDF).

    Invokes the workspace-chat-tools Lambda with the convert_preview tool,
    which calls the document-converter Lambda (LibreOffice) and returns a
    presigned download URL for the converted file.
    """
    if not lambda_client or not WORKSPACE_TOOLS_LAMBDA_NAME:
        raise HTTPException(
            status_code=500, detail="Document conversion not configured"
        )

    client_ip = _get_client_ip(request)
    if not _check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests")

    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    source_bucket = body.get("bucket")
    source_key = body.get("key")
    target_format = body.get("format", "pdf")

    if not source_bucket or not source_key:
        raise HTTPException(status_code=400, detail="bucket and key are required")

    # Only allow conversion of public demo files
    if "public-" not in source_key and PUBLIC_DEMO_USER_SUB not in source_key:
        raise HTTPException(status_code=403, detail="Access denied")

    tools_payload = {
        "tool": "convert_preview",
        "params": {
            "source_bucket": source_bucket,
            "source_key": source_key,
            "format": target_format,
        },
    }

    try:
        response = lambda_client.invoke(
            FunctionName=WORKSPACE_TOOLS_LAMBDA_NAME,
            InvocationType="RequestResponse",
            Payload=json.dumps(tools_payload).encode("utf-8"),
        )

        if "FunctionError" in response:
            error_payload = response["Payload"].read().decode("utf-8")
            logger.error("Workspace tools Lambda error: %s", error_payload)
            raise HTTPException(status_code=500, detail="Document conversion failed")

        result = json.loads(response["Payload"].read().decode("utf-8"))

        if result.get("status") != "success":
            error_msg = result.get("error", "Unknown error")
            logger.error("Convert preview failed: %s", error_msg)
            raise HTTPException(
                status_code=500, detail=f"Document conversion failed: {error_msg}"
            )

        return JSONResponse(content=result.get("result", {}))

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in convert-preview: %s", e)
        raise HTTPException(
            status_code=500, detail=f"Document conversion failed: {str(e)}"
        )
