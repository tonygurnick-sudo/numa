# pylint: disable=too-many-lines
"""
Workspace Chat Agent Proxy Lambda

Thin proxy bridging CloudFront HTTP requests to AgentCore SDK calls.
AgentCore requires AWS SigV4-signed SDK calls - no public HTTP endpoint exists.

This proxy forwards HTTP requests to the workspace chat agent running in AgentCore,
using the invoke_agent_runtime API.
"""

import base64
import hashlib
import hmac as hmac_mod
import json
import logging
import mimetypes
import os
import time as time_mod
from typing import Any, AsyncGenerator, Dict

import boto3
import jwt
import requests
from botocore.config import Config
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import (
    JSONResponse,
    RedirectResponse,
    Response,
    StreamingResponse,
)
from jwt import algorithms

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Route prefix - CloudFront forwards the full path, so we must match it
PREFIX = "/api/workspace-chat-agent"

# Environment configuration
AGENT_RUNTIME_ARN = os.environ.get("AGENT_RUNTIME_ARN", "")
CLOUDFRONT_SECRET = os.environ.get("CLOUDFRONT_SHARED_SECRET", "")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "unknown")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
# AgentCore region may differ from Lambda's own region for cross-region deployments
# (e.g., Lambda in Jakarta, AgentCore in Sydney)
AGENTCORE_REGION = os.environ.get("AGENTCORE_REGION", AWS_REGION)
COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "")
COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID", "")
FILE_REDIRECT_SECRET = os.environ.get("FILE_REDIRECT_SECRET", "")
OUTPUTS_BUCKET_NAME = os.environ.get("OUTPUTS_BUCKET_NAME", "")
SCHEDULE_RUNNER_SECRET = os.environ.get("SCHEDULE_RUNNER_SECRET", "")
WORKSPACE_TOOLS_LAMBDA_NAME = os.environ.get("WORKSPACE_TOOLS_LAMBDA_NAME", "")

# JWKS cache (persists across warm Lambda invocations)
_jwks_cache: Dict[str, Any] = {"data": None}

# Initialize boto3 client for AgentCore runtime
# See: https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/bedrock-agentcore.html
logger.info(
    "Initializing workspace-chat-agent-proxy: region=%s, agentcore_region=%s, client=%s, runtime_arn=%s",
    AWS_REGION,
    AGENTCORE_REGION,
    CLIENT_NAME,
    (
        AGENT_RUNTIME_ARN[:50] + "..."
        if len(AGENT_RUNTIME_ARN) > 50
        else AGENT_RUNTIME_ARN
    ),
)

# Configure client with extended timeout for long-running agent operations
# Default boto3 read timeout (~60s) is insufficient for complex tool executions
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

# S3 client for file redirect endpoint
s3_client = boto3.client("s3", region_name=AWS_REGION) if OUTPUTS_BUCKET_NAME else None

# Lambda client for invoking workspace-chat-tools (document conversion for preview)
lambda_client = (
    boto3.client("lambda", region_name=AWS_REGION)
    if WORKSPACE_TOOLS_LAMBDA_NAME
    else None
)

# Blocked path patterns for file redirect security
_BLOCKED_PATH_PATTERNS = [".system/", ".system", "secrets/", "secrets", ".env"]


def _validate_file_token(token: str) -> str:
    """Validate an HMAC-signed file redirect token and return the S3 key.

    Token format: {base64url(s3_key)}.{expiry_unix}.{base64url(hmac_sha256)}

    Raises HTTPException(403) on any validation failure.
    """
    if not FILE_REDIRECT_SECRET:
        raise HTTPException(status_code=403, detail="File redirect not configured")

    parts = token.split(".")
    if len(parts) != 3:
        raise HTTPException(status_code=403, detail="Invalid token format")

    b64_key, expiry, b64_mac = parts

    # Recompute HMAC and compare (timing-safe)
    message = f"{b64_key}.{expiry}"
    expected_mac = hmac_mod.new(
        FILE_REDIRECT_SECRET.encode(), message.encode(), hashlib.sha256
    ).digest()
    # Re-pad base64url
    b64_mac_padded = b64_mac + "=" * (-len(b64_mac) % 4)
    try:
        provided_mac = base64.urlsafe_b64decode(b64_mac_padded)
    except Exception:
        raise HTTPException(status_code=403, detail="Invalid token")

    if not hmac_mod.compare_digest(expected_mac, provided_mac):
        raise HTTPException(status_code=403, detail="Invalid token")

    # Check expiry
    try:
        if int(expiry) < int(time_mod.time()):
            raise HTTPException(status_code=403, detail="Token expired")
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid token")

    # Decode S3 key
    b64_key_padded = b64_key + "=" * (-len(b64_key) % 4)
    try:
        s3_key = base64.urlsafe_b64decode(b64_key_padded).decode("utf-8")
    except Exception:
        raise HTTPException(status_code=403, detail="Invalid token")

    # Path traversal check
    if ".." in s3_key:
        raise HTTPException(status_code=403, detail="Invalid path")
    for pattern in _BLOCKED_PATH_PATTERNS:
        if pattern in s3_key:
            raise HTTPException(status_code=403, detail="Invalid path")

    return s3_key


def validate_cloudfront_secret(
    secret: str | None, authorization: str | None = None
) -> None:
    """Validate the CloudFront shared secret header.

    When called via CloudFront, the secret header is required.
    When called directly (no secret header), we allow the request if Authorization is present.
    This enables direct Lambda Function URL calls for testing/bypassing CloudFront buffering.
    """
    if not CLOUDFRONT_SECRET:
        return  # Skip validation if not configured (dev mode)

    # If secret header is provided, validate it (CloudFront path)
    if secret:
        if secret != CLOUDFRONT_SECRET:
            raise HTTPException(status_code=403, detail="Invalid CloudFront secret")
        return

    # No secret header = direct call. Allow if Authorization is present.
    # The JWT provides authentication; CloudFront secret just prevents direct access.
    if authorization:
        logger.info(
            "Direct Lambda call (no CloudFront secret), Authorization present - allowing"
        )
        return

    # No secret and no auth = reject
    raise HTTPException(status_code=403, detail="Authentication required")


def _get_jwks() -> Dict[str, Any]:
    """Fetch and cache JWKS from Cognito."""
    if _jwks_cache["data"] is None:
        jwks_url = f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}/.well-known/jwks.json"
        resp = requests.get(jwks_url, timeout=10)
        resp.raise_for_status()
        _jwks_cache["data"] = resp.json()
    return _jwks_cache["data"]


def _verify_jwt_token(token: str) -> Dict[str, Any]:
    """Verify JWT token signature and claims against Cognito JWKS."""
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
        issuer=f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}",
        options={"verify_exp": True, "verify_aud": False},
    )

    token_use = payload_check.get("token_use")
    if token_use == "id":
        payload = jwt.decode(
            token,
            rsa_key,  # type: ignore[arg-type]
            algorithms=["RS256"],
            audience=COGNITO_CLIENT_ID,
            issuer=f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}",
            options={"verify_exp": True},
        )
    elif token_use == "access":
        if payload_check.get("client_id") != COGNITO_CLIENT_ID:
            raise ValueError("Invalid client_id")
        payload = payload_check
    else:
        raise ValueError(f"Unknown token_use: {token_use}")

    if not payload.get("sub"):
        raise ValueError("Token missing required 'sub' claim")
    return payload


def extract_user_sub(
    authorization: str | None, schedule_runner_sub: str | None = None
) -> str:
    """Extract and VERIFY user_sub from JWT token or schedule runner secret.

    Security: This function validates JWT signatures against Cognito JWKS.
    Previously, JWTs were decoded without verification, allowing token forgery.

    For scheduled agent runs, the schedule runner Lambda authenticates with the
    SCHEDULE_RUNNER_SECRET as a bearer token and passes the user's sub via the
    x-schedule-runner-sub header. This avoids needing a Cognito JWT for
    server-to-server calls.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")

    # Check for schedule runner authentication (server-to-server calls)
    token = (
        authorization.replace("Bearer ", "")
        if authorization.startswith("Bearer ")
        else authorization
    )
    if SCHEDULE_RUNNER_SECRET and hmac_mod.compare_digest(
        token, SCHEDULE_RUNNER_SECRET
    ):
        if not schedule_runner_sub:
            raise HTTPException(
                status_code=400,
                detail="x-schedule-runner-sub header required for schedule runner auth",
            )
        logger.info(
            "Schedule runner auth verified, sub=%s...",
            schedule_runner_sub[:8] if schedule_runner_sub else None,
        )
        return schedule_runner_sub

    if not COGNITO_USER_POOL_ID:
        # Dev mode: fall back to unverified (log warning)
        logger.warning("COGNITO_USER_POOL_ID not set - JWT verification DISABLED")
        try:
            decoded = jwt.decode(token, options={"verify_signature": False})
            return decoded.get("sub", "anonymous")
        except jwt.DecodeError:
            return "anonymous"

    try:
        payload = _verify_jwt_token(authorization)
        sub = payload.get("sub", "")
        logger.info("JWT verified successfully, sub=%s...", sub[:8] if sub else None)
        return sub if sub else "anonymous"
    except ValueError as e:
        logger.warning("JWT verification failed: %s", str(e))
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
    except Exception as e:
        logger.error("JWT verification error: %s", str(e))
        raise HTTPException(status_code=401, detail="Authentication failed")


def build_session_id(conversation_id: str) -> str:
    """Build AgentCore session ID from conversation ID.

    Each conversation gets its own MicroVM container, eliminating
    conversation-switching complexity and solving concurrency issues.
    """
    return f"conv-{conversation_id}"


@app.get(f"{PREFIX}/ping")
async def ping():
    """Health check endpoint for the proxy itself."""
    return {
        "status": "ok",
        "client": CLIENT_NAME,
        "proxy": "workspace-chat-agent-proxy",
    }


@app.get(f"{PREFIX}/types")
async def list_agent_types(
    authorization: str | None = Header(None),
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
):
    """List available agent types.

    Routes to the AgentCore container which has the agent type registry.
    Returns a list of type metadata (type_id, display_name, response_mode).
    """
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)
    user_sub = extract_user_sub(authorization)

    return await _invoke_agentcore(
        user_sub=user_sub,
        http_method="GET",
        http_path="/types",
        authorization=authorization,
        stream=False,
    )


@app.get(f"{PREFIX}/integration-file/{{token}}/{{filename}}")
async def integration_file_redirect(
    token: str,
    filename: str,
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
    authorization: str | None = Header(None),
):
    """Redirect to a presigned S3 URL for integration file uploads.

    Pipedream extracts filenames from URLs. Presigned S3 URLs have long query
    strings that cause Slack's upload API to fail (filename > 235 chars).
    This endpoint provides a clean URL with a short HMAC token.
    """
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)

    if not s3_client or not OUTPUTS_BUCKET_NAME:
        raise HTTPException(status_code=500, detail="File redirect not configured")

    s3_key = _validate_file_token(token)
    params: Dict[str, str] = {"Bucket": OUTPUTS_BUCKET_NAME, "Key": s3_key}
    content_type, _ = mimetypes.guess_type(filename)
    if content_type:
        params["ResponseContentType"] = content_type
    presigned_url = s3_client.generate_presigned_url(
        "get_object",
        Params=params,
        ExpiresIn=30,
    )
    return RedirectResponse(url=presigned_url, status_code=302)


@app.post(f"{PREFIX}/convert-preview")
async def convert_preview(
    request: Request,
    authorization: str | None = Header(None),
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
):
    """Convert a document for frontend preview (e.g. DOCX -> PDF).

    Invokes the workspace-chat-tools Lambda with the convert_preview tool,
    which calls the document-converter Lambda (LibreOffice) and returns a
    presigned download URL for the converted file.
    """
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)
    extract_user_sub(authorization)  # Validate auth

    if not lambda_client or not WORKSPACE_TOOLS_LAMBDA_NAME:
        raise HTTPException(
            status_code=500, detail="Document conversion not configured"
        )

    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    source_bucket = body.get("bucket")
    source_key = body.get("key")
    target_format = body.get("format", "pdf")

    if not source_bucket or not source_key:
        raise HTTPException(status_code=400, detail="bucket and key are required")

    # Invoke workspace-chat-tools with convert_preview tool
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


@app.get(f"{PREFIX}/runs/{{run_id}}/status")
async def run_status(
    run_id: str,
    authorization: str | None = Header(None),
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
):
    """Poll for fire-and-forget run result.

    Routes the request to the AgentCore container which checks S3 for
    a ``_result.json`` file. Returns ``{"status": "running"}`` while the
    agent is still working, or the full result when done.
    """
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)
    user_sub = extract_user_sub(authorization)

    return await _invoke_agentcore(
        user_sub=user_sub,
        http_method="GET",
        http_path=f"/runs/{run_id}/status",
        authorization=authorization,
        stream=False,
        conversation_id=run_id,
    )


@app.get(f"{PREFIX}/files")
async def list_files(
    authorization: str | None = Header(None),
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
):
    """List global workspace files (chat-workflows feature - currently disabled)."""
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)
    extract_user_sub(authorization)  # Validate auth
    return {"status": "success", "files": []}


@app.get(f"{PREFIX}/files/{{conversation_id}}")
async def list_conversation_files(
    conversation_id: str,
    authorization: str | None = Header(None),
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
):
    """Forward per-conversation files list request to AgentCore."""
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)
    user_sub = extract_user_sub(authorization)

    return await _invoke_agentcore(
        user_sub=user_sub,
        http_method="GET",
        http_path=f"/files/{conversation_id}",
        authorization=authorization,
        stream=False,
        conversation_id=conversation_id,
    )


@app.get(f"{PREFIX}/history/{{conversation_id}}")
async def get_history(
    conversation_id: str,
    authorization: str | None = Header(None),
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
):
    """Forward history request to AgentCore."""
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)
    user_sub = extract_user_sub(authorization)

    return await _invoke_agentcore(
        user_sub=user_sub,
        http_method="GET",
        http_path=f"/history/{conversation_id}",
        authorization=authorization,
        stream=False,
        conversation_id=conversation_id,
    )


@app.get(f"{PREFIX}/trace/{{conversation_id}}")
async def get_trace(
    conversation_id: str,
    authorization: str | None = Header(None),
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
):
    """Forward trace request to AgentCore.

    Returns filtered NDJSON with thinking blocks and assistant_advice stripped.
    """
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)
    user_sub = extract_user_sub(authorization)

    return await _invoke_agentcore(
        user_sub=user_sub,
        http_method="GET",
        http_path=f"/trace/{conversation_id}",
        authorization=authorization,
        stream=False,
        raw=True,
        conversation_id=conversation_id,
    )


@app.post(f"{PREFIX}/invocations")
async def invocations(
    request: Request,
    authorization: str | None = Header(None),
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
    x_schedule_runner_sub: str | None = Header(None, alias="x-schedule-runner-sub"),
):
    """
    Forward invocation to AgentCore runtime.

    This is the main entry point for chat and other actions.
    Supports streaming responses for chat actions.

    For scheduled agent runs, the schedule runner Lambda authenticates with the
    SCHEDULE_RUNNER_SECRET as bearer token and passes the user sub via
    x-schedule-runner-sub header.
    """
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)
    user_sub = extract_user_sub(
        authorization, schedule_runner_sub=x_schedule_runner_sub
    )

    # Parse request body
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    action = body.get("action", "chat")

    # Handle approve action directly in the proxy to avoid container deadlock.
    # The container's SDK stream blocks the event loop, so approve requests
    # would queue behind the active stream until the 90s approval timeout expires.
    if action == "approve":
        return await _handle_approve(body, user_sub)

    # Extract conversationId for per-conversation session routing
    conversation_id = body.get("conversationId")

    # Determine response mode:
    # 1. Request-level override ("responseMode" in body)
    # 2. Default: "stream" for chat, "collect" for everything else
    #
    # The container also reads response_mode from the agent type config,
    # but the proxy needs to know so it can decide whether to stream or
    # collect the response.
    response_mode = body.get("responseMode", "")

    if action == "chat":
        if response_mode in ("sync", "fire-and-forget"):
            # Non-streaming modes: collect the JSON response from the container
            return await _invoke_agentcore(
                user_sub=user_sub,
                http_method="POST",
                http_path="/invocations",
                http_body=body,
                authorization=authorization,
                stream=False,
                conversation_id=conversation_id,
            )
        else:
            # Default: stream SSE (covers "stream" and empty/unset)
            return await _invoke_agentcore(
                user_sub=user_sub,
                http_method="POST",
                http_path="/invocations",
                http_body=body,
                authorization=authorization,
                stream=True,
                conversation_id=conversation_id,
            )
    else:
        # Non-chat actions (upload, stop, etc.) always return JSON
        return await _invoke_agentcore(
            user_sub=user_sub,
            http_method="POST",
            http_path="/invocations",
            http_body=body,
            authorization=authorization,
            stream=False,
            conversation_id=conversation_id,
        )


async def _handle_approve(body: dict, user_sub: str) -> JSONResponse:
    """Handle integration tool approval directly in the proxy.

    Writes the approval decision to DynamoDB so the tools Lambda poll picks it up.
    This avoids routing through the AgentCore container which would deadlock
    (the container is blocked by the SDK stream waiting for this approval).
    """
    approval_id = body.get("approvalId")
    decision = body.get("decision")

    if not approval_id:
        raise HTTPException(status_code=400, detail="Missing approvalId")
    if decision not in ("approved", "denied"):
        raise HTTPException(
            status_code=400, detail="decision must be 'approved' or 'denied'"
        )

    table_name = os.environ.get("INTEGRATIONS_APPROVAL_TABLE_NAME", "")
    if not table_name:
        raise HTTPException(status_code=500, detail="Approval table not configured")

    dynamodb = boto3.client("dynamodb")
    dynamodb.update_item(
        TableName=table_name,
        Key={"approval_id": {"S": approval_id}},
        UpdateExpression="SET #s = :status, decided_at = :decided_at",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":status": {"S": decision},
            ":decided_at": {"N": str(int(time_mod.time()))},
        },
    )

    logger.info(
        "Integration tool approval recorded in proxy",
        extra={"approval_id": approval_id, "decision": decision, "user_sub": user_sub},
    )

    return JSONResponse(content={"status": decision, "approvalId": approval_id})


async def _invoke_agentcore(
    user_sub: str,
    http_method: str,
    http_path: str,
    authorization: str | None,
    stream: bool,
    http_body: dict | None = None,
    raw: bool = False,
    conversation_id: str | None = None,
):
    """
    Invoke AgentCore runtime with HTTP request details.

    Uses the invoke_agent_runtime API which accepts a payload and returns
    a streaming response. Routes to a per-conversation MicroVM container.

    Args:
        raw: If True, return filtered NDJSON response (for trace endpoint)
        conversation_id: Conversation ID for per-conversation session routing
    """
    if conversation_id:
        session_id = build_session_id(conversation_id)
    else:
        # Fallback for requests without a conversation_id
        session_id = f"user-{user_sub}"

    # Build the payload that the workspace agent will receive
    # The workspace agent's FastAPI app will parse this
    payload = {
        "httpMethod": http_method,
        "httpPath": http_path,
        "headers": {
            "authorization": authorization or "",
            "x-user-sub": user_sub,
        },
    }
    if http_body:
        payload["body"] = http_body

    payload_bytes = json.dumps(payload).encode("utf-8")

    try:
        # Call AgentCore invoke_agent_runtime
        # See: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-invoke-agent.html
        response = agentcore_client.invoke_agent_runtime(
            agentRuntimeArn=AGENT_RUNTIME_ARN,
            payload=payload_bytes,
            contentType="application/json",
            accept="application/json",
            runtimeSessionId=session_id,
        )

        if stream:
            return _stream_response(response)
        elif raw:
            return await _collect_filtered_raw_response(response)
        else:
            return await _collect_response(response)

    except agentcore_client.exceptions.ResourceNotFoundException:
        logger.exception("Agent runtime not found: %s", AGENT_RUNTIME_ARN)
        return JSONResponse(
            status_code=404,
            content={"error": "Agent runtime not found"},
        )
    except agentcore_client.exceptions.AccessDeniedException:
        logger.exception("Access denied to agent runtime: %s", AGENT_RUNTIME_ARN)
        return JSONResponse(
            status_code=403,
            content={"error": "Access denied to agent runtime"},
        )
    except Exception as e:
        logger.exception("Error invoking AgentCore runtime: %s", e)
        return JSONResponse(
            status_code=500,
            content={"error": str(e)},
        )


def _is_thinking_event(event: dict) -> bool:
    """Check if an SSE event contains thinking content that should be filtered.

    Filters out:
    - assistant_advice events (pre-analysis from fast model)
    - StreamEvent thinking/signature deltas (the actual thinking text)

    Allows through:
    - StreamEvent content_block_start with thinking type (so frontend can show
      a "thinking" spinner without seeing the actual thinking content)
    """
    event_type = event.get("type")

    # Filter assistant_advice (pre-analysis from Nova 2 Lite)
    if event_type == "assistant_advice":
        return True

    # Filter StreamEvent thinking text deltas (but NOT block start)
    if event_type == "StreamEvent":
        inner = event.get("event", {})
        if inner.get("type") == "content_block_delta":
            delta_type = inner.get("delta", {}).get("type")
            if delta_type in ("thinking_delta", "signature_delta"):
                return True

    return False


def _strip_thinking_from_event(event: dict) -> dict | None:
    """Strip thinking blocks from assistant message content.

    For 'assistant' type events, removes thinking blocks from message.content[].
    Returns None if content becomes empty after stripping.
    For all other events, returns as-is (unless filtered by _is_thinking_event).
    """
    if event.get("type") != "assistant":
        return event

    message = event.get("message", {})
    content = message.get("content")
    if not isinstance(content, list):
        return event

    filtered_content = [block for block in content if block.get("type") != "thinking"]

    if not filtered_content:
        return None

    if len(filtered_content) == len(content):
        return event  # Nothing was stripped

    # Return modified event with thinking blocks removed
    modified = {**event, "message": {**message, "content": filtered_content}}
    return modified


def _filter_sse_event(event_block: str) -> str | None:
    """Filter a single SSE event block. Returns None to drop, or the event string to keep."""
    # Fast path: if event doesn't contain any thinking-related keywords,
    # skip JSON parsing entirely. This covers ~95% of events (text deltas,
    # tool events, heartbeats) with near-zero overhead.
    if (
        "thinking" not in event_block
        and "assistant_advice" not in event_block
        and "signature_delta" not in event_block
    ):
        return event_block

    # Slow path: event may need filtering — parse and check
    lines = event_block.strip().split("\n")
    if not lines:
        return None

    # Pass through SSE comments (heartbeat/keepalive)
    if all(line.startswith(":") for line in lines):
        return event_block

    # Find and parse the data line
    data_line = None
    other_lines = []
    for line in lines:
        if line.startswith("data: "):
            data_line = line
        else:
            other_lines.append(line)

    if not data_line:
        return event_block

    try:
        event = json.loads(data_line[6:])  # Strip "data: " prefix
    except json.JSONDecodeError:
        return event_block

    # Drop thinking events; strip thinking blocks from assistant messages
    if _is_thinking_event(event):
        return None

    filtered = _strip_thinking_from_event(event)
    if filtered is None:
        return None
    if filtered is not event:
        new_data_line = f"data: {json.dumps(filtered)}"
        return "\n".join(other_lines + [new_data_line])

    return event_block


def _stream_response(response) -> StreamingResponse:
    """Stream AgentCore response as SSE, filtering out thinking tokens.

    Works with raw bytes throughout for minimal overhead. Events that don't
    contain thinking-related keywords (~95% of events) are passed through
    as raw bytes with no decoding or JSON parsing. Only events containing
    'thinking', 'assistant_advice', or 'signature_delta' are decoded and
    filtered via the slow path.
    """

    # Byte-level markers for the slow-path check
    _thinking = b"thinking"
    _advice = b"assistant_advice"
    _signature = b"signature_delta"
    _delim = b"\n\n"

    async def generate() -> AsyncGenerator[bytes, None]:
        try:
            logger.info(
                "AgentCore response: keys=%s, statusCode=%s",
                list(response.keys()),
                response.get("statusCode"),
            )

            streaming_body = response.get("response")

            if streaming_body is None:
                logger.error("No 'response' key in AgentCore response")
                yield f'data: {json.dumps({"type": "error", "message": "No response from AgentCore"})}\n\n'.encode()
                return

            # --- EXPERIMENT: raw passthrough (no filtering) ---
            for chunk in streaming_body.iter_chunks(chunk_size=128):
                yield chunk

            # --- ORIGINAL FILTERING CODE (commented out for experiment) ---
            # buffer = b""
            # filtered_count = 0
            #
            # for chunk in streaming_body.iter_chunks(chunk_size=128):
            #     buffer += chunk
            #
            #     # Process all complete SSE events in the buffer
            #     while _delim in buffer:
            #         event_bytes, buffer = buffer.split(_delim, 1)
            #
            #         # Fast path: no thinking keywords → pass raw bytes through
            #         if (
            #             _thinking not in event_bytes
            #             and _advice not in event_bytes
            #             and _signature not in event_bytes
            #         ):
            #             yield event_bytes + _delim
            #             continue
            #
            #         # Slow path: decode, parse JSON, filter
            #         event_str = event_bytes.decode("utf-8", errors="replace")
            #         filtered = _filter_sse_event(event_str)
            #         if filtered is not None:
            #             yield (filtered + "\n\n").encode("utf-8")
            #         else:
            #             filtered_count += 1
            #
            #     # Flush any remaining content in the buffer
            #     if buffer.strip():
            #         event_str = buffer.decode("utf-8", errors="replace")
            #         filtered = _filter_sse_event(event_str)
            #         if filtered is not None:
            #             yield (filtered + "\n\n").encode("utf-8")
            #         else:
            #             filtered_count += 1
            #
            #     if filtered_count:
            #         logger.info("Stream completed: %d events filtered", filtered_count)

        except Exception as e:
            logger.exception("Error streaming AgentCore response: %s", e)
            yield f'data: {json.dumps({"type": "error", "message": str(e)})}\n\n'.encode()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _strip_thinking_from_history(result: dict) -> dict:
    """Strip thinking and assistant_advice segments from conversation history responses.

    Ensures thinking tokens never reach the frontend, even when loading
    historical conversations.
    """
    conversation = result.get("conversation")
    if not isinstance(conversation, dict):
        return result

    messages = conversation.get("messages")
    if not isinstance(messages, list):
        return result

    for message in messages:
        segments = message.get("segments")
        if not isinstance(segments, list):
            continue
        message["segments"] = [
            seg
            for seg in segments
            if seg.get("kind") not in ("thinking", "assistant_advice")
        ]

    return result


async def _collect_response(response) -> JSONResponse:
    """Collect all response chunks and return as JSON.

    For history responses, strips thinking and assistant_advice segments
    so sensitive internal data never reaches the frontend.
    """
    try:
        logger.info(
            "AgentCore response (collect): keys=%s, statusCode=%s",
            list(response.keys()),
            response.get("statusCode"),
        )

        streaming_body = response.get("response")

        if streaming_body is None:
            logger.error("No 'response' key in AgentCore response")
            return JSONResponse(
                status_code=500,
                content={"error": "No response from AgentCore"},
            )

        result_bytes = streaming_body.read()
        result_text = result_bytes.decode("utf-8")

        try:
            result = json.loads(result_text)
            result = _strip_thinking_from_history(result)
            return JSONResponse(content=result)
        except json.JSONDecodeError:
            return JSONResponse(content={"response": result_text})

    except Exception as e:
        logger.exception("Error collecting AgentCore response: %s", e)
        return JSONResponse(
            status_code=500,
            content={"error": str(e)},
        )


def _filter_ndjson_line(line: str) -> str | None:
    """Filter a single NDJSON line. Returns None to drop, or the filtered line."""
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        return line

    if _is_thinking_event(event):
        return None

    filtered = _strip_thinking_from_event(event)
    if filtered is None:
        return None
    if filtered is not event:
        return json.dumps(filtered)
    return line


async def _collect_filtered_raw_response(response) -> Response:
    """Collect NDJSON response, filter out thinking/advice, return as raw text."""
    try:
        streaming_body = response.get("response")

        if streaming_body is None:
            logger.error("No 'response' key in AgentCore response")
            return Response(
                content="",
                media_type="application/x-ndjson",
                status_code=500,
            )

        result_bytes = streaming_body.read()
        result_text = result_bytes.decode("utf-8")

        filtered_lines = []
        for line in result_text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            filtered = _filter_ndjson_line(stripped)
            if filtered is not None:
                filtered_lines.append(filtered)

        return Response(
            content="\n".join(filtered_lines) + "\n" if filtered_lines else "",
            media_type="application/x-ndjson",
        )

    except Exception as e:
        logger.exception("Error collecting raw AgentCore response: %s", e)
        return Response(
            content="",
            media_type="application/x-ndjson",
            status_code=500,
        )
