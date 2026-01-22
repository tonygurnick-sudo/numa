"""
Workspace Chat Agent Proxy Lambda

Thin proxy bridging CloudFront HTTP requests to AgentCore SDK calls.
AgentCore requires AWS SigV4-signed SDK calls - no public HTTP endpoint exists.

This proxy forwards HTTP requests to the workspace chat agent running in AgentCore,
using the invoke_agent_runtime API.
"""

import json
import logging
import os
from typing import Any, AsyncGenerator, Dict

import boto3
import jwt
import requests
from botocore.config import Config
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
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
COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "")
COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID", "")

# JWKS cache (persists across warm Lambda invocations)
_jwks_cache: Dict[str, Any] = {"data": None}

# Initialize boto3 client for AgentCore runtime
# See: https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/bedrock-agentcore.html
logger.info(
    "Initializing workspace-chat-agent-proxy: region=%s, client=%s, runtime_arn=%s",
    AWS_REGION,
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
    region_name=AWS_REGION,
    config=agentcore_config,
)


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


def extract_user_sub(authorization: str | None) -> str:
    """Extract and VERIFY user_sub from JWT token.

    Security: This function validates JWT signatures against Cognito JWKS.
    Previously, JWTs were decoded without verification, allowing token forgery.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")

    if not COGNITO_USER_POOL_ID:
        # Dev mode: fall back to unverified (log warning)
        logger.warning("COGNITO_USER_POOL_ID not set - JWT verification DISABLED")
        token = authorization.replace("Bearer ", "")
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


def build_session_id(user_sub: str) -> str:
    """Build AgentCore session ID from user sub."""
    # AgentCore sessions are tied to users, not conversations
    return f"user-{user_sub}"


@app.get(f"{PREFIX}/ping")
async def ping():
    """Health check endpoint for the proxy itself."""
    return {
        "status": "ok",
        "client": CLIENT_NAME,
        "proxy": "workspace-chat-agent-proxy",
    }


@app.get(f"{PREFIX}/status")
async def get_status(
    authorization: str | None = Header(None),
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
):
    """Forward status request to AgentCore."""
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)
    user_sub = extract_user_sub(authorization)

    return await _invoke_agentcore(
        user_sub=user_sub,
        http_method="GET",
        http_path="/status",
        authorization=authorization,
        stream=False,
    )


@app.get(f"{PREFIX}/files")
async def list_files(
    authorization: str | None = Header(None),
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
):
    """Forward files list request to AgentCore (global workspace files)."""
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)
    user_sub = extract_user_sub(authorization)

    return await _invoke_agentcore(
        user_sub=user_sub,
        http_method="GET",
        http_path="/files",
        authorization=authorization,
        stream=False,
    )


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
    )


@app.get(f"{PREFIX}/trace/{{conversation_id}}")
async def get_trace(
    conversation_id: str,
    authorization: str | None = Header(None),
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
):
    """Forward trace request to AgentCore. Returns raw NDJSON without JSON wrapping."""
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)
    user_sub = extract_user_sub(authorization)

    return await _invoke_agentcore(
        user_sub=user_sub,
        http_method="GET",
        http_path=f"/trace/{conversation_id}",
        authorization=authorization,
        stream=False,
        raw=True,  # Return raw NDJSON, don't wrap in JSON
    )


@app.post(f"{PREFIX}/invocations")
async def invocations(
    request: Request,
    authorization: str | None = Header(None),
    x_arcanum_cloudfront_secret: str | None = Header(
        None, alias="x-arcanum-cloudfront-secret"
    ),
):
    """
    Forward invocation to AgentCore runtime.

    This is the main entry point for chat and other actions.
    Supports streaming responses for chat actions.
    """
    validate_cloudfront_secret(x_arcanum_cloudfront_secret, authorization)
    user_sub = extract_user_sub(authorization)

    # Parse request body
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    action = body.get("action", "chat")

    # Chat action streams, others return JSON
    return await _invoke_agentcore(
        user_sub=user_sub,
        http_method="POST",
        http_path="/invocations",
        http_body=body,
        authorization=authorization,
        stream=(action == "chat"),
    )


async def _invoke_agentcore(
    user_sub: str,
    http_method: str,
    http_path: str,
    authorization: str | None,
    stream: bool,
    http_body: dict | None = None,
    raw: bool = False,
):
    """
    Invoke AgentCore runtime with HTTP request details.

    Uses the invoke_agent_runtime API which accepts a payload and returns
    a streaming response.

    Args:
        raw: If True, return raw text response without JSON wrapping (for NDJSON endpoints)
    """
    session_id = build_session_id(user_sub)

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
            return await _collect_raw_response(response)
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


def _stream_response(response) -> StreamingResponse:
    """Stream AgentCore response as SSE (Server-Sent Events).

    Passes through SSE-formatted chunks directly from the workspace agent.
    """

    async def generate() -> AsyncGenerator[bytes, None]:
        try:
            # Log response structure for debugging
            logger.info(
                "AgentCore response: keys=%s, statusCode=%s",
                list(response.keys()),
                response.get("statusCode"),
            )

            # The 'response' key contains a StreamingBody object
            # See: https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/bedrock-agentcore/client/invoke_agent_runtime.html
            streaming_body = response.get("response")

            if streaming_body is None:
                logger.error("No 'response' key in AgentCore response")
                yield f'data: {json.dumps({"type": "error", "message": "No response from AgentCore"})}\n\n'.encode()
                return

            # Pass through SSE chunks directly - don't split on newlines!
            # SSE format uses \n\n to delimit events, and the workspace agent
            # already formats events correctly. We just need to forward them.
            total_bytes = 0
            chunk_count = 0
            for chunk in streaming_body.iter_chunks(chunk_size=256):
                chunk_count += 1
                total_bytes += len(chunk)
                yield chunk

            logger.info(
                "Stream completed: %d chunks, %d bytes", chunk_count, total_bytes
            )

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


async def _collect_response(response) -> JSONResponse:
    """Collect all response chunks and return as JSON."""
    try:
        # Log response structure for debugging
        logger.info(
            "AgentCore response (collect): keys=%s, statusCode=%s",
            list(response.keys()),
            response.get("statusCode"),
        )

        # The 'response' key contains a StreamingBody object
        streaming_body = response.get("response")

        if streaming_body is None:
            logger.error("No 'response' key in AgentCore response")
            return JSONResponse(
                status_code=500,
                content={"error": "No response from AgentCore"},
            )

        # Read entire response body
        result_bytes = streaming_body.read()
        result_text = result_bytes.decode("utf-8")

        # Try to parse as JSON
        try:
            result = json.loads(result_text)
            return JSONResponse(content=result)
        except json.JSONDecodeError:
            return JSONResponse(content={"response": result_text})

    except Exception as e:
        logger.exception("Error collecting AgentCore response: %s", e)
        return JSONResponse(
            status_code=500,
            content={"error": str(e)},
        )


async def _collect_raw_response(response) -> Response:
    """Collect response and return as raw text (for NDJSON endpoints like /trace)."""
    try:
        streaming_body = response.get("response")

        if streaming_body is None:
            logger.error("No 'response' key in AgentCore response")
            return Response(
                content="",
                media_type="application/x-ndjson",
                status_code=500,
            )

        # Read entire response body and return as-is
        result_bytes = streaming_body.read()
        result_text = result_bytes.decode("utf-8")

        return Response(
            content=result_text,
            media_type="application/x-ndjson",
        )

    except Exception as e:
        logger.exception("Error collecting raw AgentCore response: %s", e)
        return Response(
            content="",
            media_type="application/x-ndjson",
            status_code=500,
        )
