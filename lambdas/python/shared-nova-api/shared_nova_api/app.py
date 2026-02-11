"""
Shared Nova API - FastAPI application for public document Q&A.

Provides:
- POST /shared - Create a share (authenticated via Cognito JWT)
- GET /shared/{uuid} - Get share info (public)
- POST /shared/{uuid}/chat - Stream chat responses (public)
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict
from urllib.parse import parse_qs, unquote, urlparse
from uuid import uuid4

import jwt
import requests
import structlog
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from jwt import algorithms
from pydantic import BaseModel

from prm import client as prm_client
from prm import resource as prm_resource

logger = structlog.get_logger()

app = FastAPI()

# Environment variables
REGION = os.environ.get("AWS_REGION", "us-east-1")
SHARED_TABLE_NAME = os.environ.get("SHARED_TABLE_NAME", "")
MODEL_ID = os.environ.get("MODEL_ID", "global.amazon.nova-2-lite-v1:0")
USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "")
USER_POOL_CLIENT_ID = os.environ.get("COGNITO_USER_POOL_CLIENT_ID", "")
OUTPUTS_BUCKET_NAME = os.environ.get("OUTPUTS_BUCKET_NAME", "")

# Clients (lazily initialized)
_dynamodb_table = None
_bedrock_client = None
_s3_client = None
_jwks_cache: Dict[str, Any] = {"data": None}


def get_dynamodb_table():
    """Get DynamoDB table resource with PRM tracking."""
    global _dynamodb_table  # pylint: disable=global-statement
    if _dynamodb_table is None:
        dynamodb = prm_resource("dynamodb", region=REGION)
        _dynamodb_table = dynamodb.Table(SHARED_TABLE_NAME)
    return _dynamodb_table


def get_bedrock_client():
    """Get Bedrock runtime client with PRM tracking."""
    global _bedrock_client  # pylint: disable=global-statement
    if _bedrock_client is None:
        _bedrock_client = prm_client("bedrock-runtime", region=REGION)
    return _bedrock_client


def get_s3_client():
    """Get S3 client with PRM tracking for generating pre-signed URLs."""
    global _s3_client  # pylint: disable=global-statement
    if _s3_client is None:
        _s3_client = prm_client("s3", region=REGION)
    return _s3_client


def get_jwks() -> Dict[str, Any]:
    """Fetch and cache Cognito JWKS for JWT validation."""
    global _jwks_cache  # pylint: disable=global-statement
    if _jwks_cache["data"] is None:
        jwks_url = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"
        response = requests.get(jwks_url, timeout=10)
        response.raise_for_status()
        _jwks_cache["data"] = response.json()
    return _jwks_cache["data"]


def validate_jwt(authorization: str | None) -> str:
    """Validate Cognito JWT and return user ID (sub claim).

    Args:
        authorization: Authorization header value (Bearer token)

    Returns:
        User ID from the token's sub claim

    Raises:
        HTTPException: If token is missing, invalid, or expired
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization format")

    token = authorization[7:]  # Strip "Bearer "

    try:
        # Get JWKS and decode token header to find the key
        jwks = get_jwks()
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        # Find the matching key
        rsa_key = None
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                rsa_key = algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
                break

        if not rsa_key:
            raise HTTPException(status_code=401, detail="Unable to find matching key")

        # Verify and decode the token
        payload = jwt.decode(
            token,
            rsa_key,  # type: ignore[arg-type]  # pyright: ignore[reportArgumentType]
            algorithms=["RS256"],
            audience=USER_POOL_CLIENT_ID,
            issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}",
        )

        return payload.get("sub", "anonymous")

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        logger.warning("JWT validation failed", error=str(e))
        raise HTTPException(status_code=401, detail="Invalid token")


# ── Request/Response Models ─────────────────────────────────────────────────


class CreateShareRequest(BaseModel):
    """Request body for creating a share."""

    s3_signed_url: str
    system_prompt: str
    expiry_hours: int | None = None  # None = permanent (no auto-deletion)
    max_calls: int | None = None  # Optional call limit
    description: str | None = None  # Brief description shown on share page
    enable_chat: bool = True  # Whether AI chat is enabled on the share page
    allow_download: bool = True  # Whether document download is allowed


class CreateShareResponse(BaseModel):
    """Response body for create share."""

    uuid: str
    expires_at: str | None = None  # None = permanent share
    status: str = "ready"


class ShareInfoResponse(BaseModel):
    """Response body for get share info."""

    uuid: str
    s3_signed_url: str
    expires_at: str | None = None  # None = permanent share
    client_name: str | None = None  # For branding lookup
    status: str = "ready"
    description: str | None = None
    enable_chat: bool = True
    allow_download: bool = True


class ShareListItem(BaseModel):
    """A single share in the list response."""

    uuid: str
    name: str
    description: str = ""
    status: str = "ready"
    created_at: float | None = None
    expires_at: str | None = None  # None = permanent share
    call_count: int = 0
    view_count: int = 0
    enable_chat: bool = True
    allow_download: bool = True


class ShareListResponse(BaseModel):
    """Response body for listing shares."""

    shares: list[ShareListItem]


class ChatRequest(BaseModel):
    """Request body for chat."""

    query: str
    session_id: str | None = None  # Browser session ID for history grouping


# ── Helper Functions ────────────────────────────────────────────────────────


def parse_s3_url(signed_url: str) -> tuple[str, str]:
    """Parse bucket name and object key from an S3 pre-signed URL.

    URL format: https://bucket.s3.region.amazonaws.com/key?params

    Returns:
        Tuple of (bucket, key)
    """
    parsed = urlparse(signed_url)
    hostname = parsed.hostname or ""
    hostname_parts = hostname.split(".")
    bucket = hostname_parts[0]
    key = unquote(parsed.path.lstrip("/"))
    return bucket, key


def generate_fresh_signed_url(bucket: str, key: str, expires_in: int = 3600) -> str:
    """Generate a fresh S3 pre-signed URL using the Lambda's IAM role.

    Args:
        bucket: S3 bucket name
        key: S3 object key
        expires_in: URL validity in seconds (default: 1 hour)

    Returns:
        Fresh pre-signed URL string
    """
    s3 = get_s3_client()

    # Determine Content-Disposition from the key's filename
    filename = key.split("/")[-1]
    safe_filename = filename.encode("ascii", "replace").decode()

    return s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket,
            "Key": key,
            "ResponseContentDisposition": f'inline; filename="{safe_filename}"',
        },
        ExpiresIn=expires_in,
    )


def extract_s3_expiry(signed_url: str) -> int:
    """Extract expiry timestamp from S3 pre-signed URL.

    S3 signed URLs contain X-Amz-Date (start time) and X-Amz-Expires (duration in seconds).
    We parse these to compute the absolute expiry timestamp.
    """
    try:
        parsed = urlparse(signed_url)
        params = parse_qs(parsed.query)

        # Get X-Amz-Date (format: 20240215T120000Z) and X-Amz-Expires (seconds)
        amz_date = params.get("X-Amz-Date", [None])[0]
        amz_expires = int(params.get("X-Amz-Expires", ["3600"])[0])

        if amz_date:
            # Parse the AWS date format
            start = datetime.strptime(amz_date, "%Y%m%dT%H%M%SZ").replace(
                tzinfo=timezone.utc
            )
            expiry = int(start.timestamp()) + amz_expires
            return expiry

    except Exception as e:
        logger.warning("Failed to parse S3 URL expiry, using default", error=str(e))

    # Fallback: 1 hour from now
    return int(time.time()) + 3600


def fetch_document(s3_signed_url: str) -> str:
    """Fetch document content from S3 signed URL.

    For PDFs and other binary formats, invokes the extract-content-from-file Lambda.
    For text-based formats, fetches content directly.
    """
    # Check if this is a PDF or other format that needs extraction
    url_path = urlparse(s3_signed_url).path.lower()
    needs_extraction = any(
        url_path.endswith(ext) for ext in [".pdf", ".docx", ".xlsx", ".pptx"]
    )

    if needs_extraction:
        return _extract_document_content(s3_signed_url)

    # Direct fetch for text-based formats
    try:
        response = requests.get(s3_signed_url, timeout=60)
        response.raise_for_status()
        return response.text
    except Exception as e:
        logger.error("Failed to fetch document from S3", error=str(e))
        raise HTTPException(status_code=502, detail="Failed to fetch document")


def _extract_document_content(s3_signed_url: str) -> str:
    """Extract text content from a document using the extract-content-from-file Lambda."""
    # Parse S3 bucket and key from signed URL
    bucket, key = parse_s3_url(s3_signed_url)

    logger.info("Extracting content from document", bucket=bucket, key=key)

    # Invoke the extraction Lambda
    lambda_client = prm_client("lambda", region=REGION)
    extraction_lambda = os.environ.get("EXTRACTION_LAMBDA_NAME", "")

    if not extraction_lambda:
        # Derive Lambda name from client name pattern
        # Table name is numa-{client}-shared, Lambda is numa-{client}-extract-content
        client_name = SHARED_TABLE_NAME.replace("numa-", "").replace("-shared", "")
        extraction_lambda = f"numa-{client_name}-extract-content-from-file"

    payload = {
        "input_bucket": bucket,
        "input_key": key,
        "return_content": True,  # Return extracted text directly
    }

    try:
        response = lambda_client.invoke(
            FunctionName=extraction_lambda,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload),
        )

        response_payload = json.loads(response["Payload"].read())

        if "errorMessage" in response_payload:
            logger.error(
                "Extraction Lambda error", error=response_payload["errorMessage"]
            )
            raise HTTPException(
                status_code=502, detail="Failed to extract document content"
            )

        # The Lambda returns {"content": "extracted text..."} when return_content=True
        content = response_payload.get("content", "")
        if not content:
            logger.warning("No content extracted from document")
            raise HTTPException(
                status_code=502, detail="No content could be extracted from document"
            )

        logger.info("Document content extracted", content_length=len(content))
        return content

    except Exception as e:
        logger.error("Failed to invoke extraction Lambda", error=str(e))
        raise HTTPException(
            status_code=502, detail="Failed to extract document content"
        )


def _try_read_existing_extraction(
    s3_bucket: str, s3_key: str, share_uuid: str
) -> str | None:
    """Try to read extracted text from a previous extraction by the Files system.

    The extract-content-from-file Lambda stores its output at {input_key}.json.
    If that file exists, we can skip re-extraction entirely.

    Returns:
        Plain text content if extraction exists, None otherwise.
    """
    existing_key = f"{s3_key}.json"
    s3 = get_s3_client()

    try:
        obj = s3.get_object(Bucket=s3_bucket, Key=existing_key)
        document_data = json.loads(obj["Body"].read())
        pages = document_data.get("pages", [])
        if not pages:
            return None

        text = "\n".join(page.get("text", "") for page in pages) + "\n"
        logger.info(
            "Found existing extraction from Files system",
            uuid=share_uuid,
            key=existing_key,
            text_length=len(text),
        )
        return text
    except Exception:
        # No existing extraction found — fall through to async path
        logger.info(
            "No existing extraction found, will extract fresh",
            uuid=share_uuid,
            checked_key=existing_key,
        )
        return None


def _start_async_extraction(
    share_uuid: str,
    s3_bucket: str,
    s3_key: str,
    extraction_output_key: str,
) -> None:
    """Invoke the extraction Lambda asynchronously (fire-and-forget).

    The extraction Lambda writes its output to S3 at extraction_output_key
    and a status file at {extraction_output_key_stem}.status.json.
    """
    lambda_client = prm_client("lambda", region=REGION)
    extraction_lambda = os.environ.get("EXTRACTION_LAMBDA_NAME", "")

    if not extraction_lambda:
        client_name = SHARED_TABLE_NAME.replace("numa-", "").replace("-shared", "")
        extraction_lambda = f"numa-{client_name}-extract-content-from-file"

    payload = {
        "input_bucket": s3_bucket,
        "input_key": s3_key,
        "output_bucket": s3_bucket,
        "output_key": extraction_output_key,
        "return_content": False,
    }

    try:
        lambda_client.invoke(
            FunctionName=extraction_lambda,
            InvocationType="Event",
            Payload=json.dumps(payload),
        )
        logger.info(
            "Async extraction started",
            uuid=share_uuid,
            extraction_lambda=extraction_lambda,
            output_key=extraction_output_key,
        )
    except Exception as e:
        logger.error("Failed to start async extraction", uuid=share_uuid, error=str(e))
        table = get_dynamodb_table()
        table.update_item(
            Key={"uuid": share_uuid},
            UpdateExpression="SET #s = :status, error_message = :err",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":status": "error", ":err": str(e)},
        )


def _check_and_complete_extraction(share: dict[str, Any]) -> str | None:
    """Check if async extraction is complete and finalize the share.

    Reads the S3 status file written by the extraction Lambda.
    If SUCCEEDED, converts the Document JSON to plain text, stores it
    in S3 (not DynamoDB — large docs exceed the 400KB item limit),
    and updates the share status to "ready".

    Returns:
        document_text if extraction is complete, None if still processing.
    """
    extraction_output_key = share.get("extraction_output_key")
    s3_bucket = share.get("s3_bucket")
    share_uuid = share.get("uuid", "")

    if not extraction_output_key or not s3_bucket:
        return None

    # Derive status file key (same logic as extraction Lambda)
    if extraction_output_key.endswith(".json"):
        status_key = extraction_output_key[: -len(".json")] + ".status.json"
    else:
        status_key = f"{extraction_output_key}.status.json"

    s3 = get_s3_client()

    try:
        status_obj = s3.get_object(Bucket=s3_bucket, Key=status_key)
        status_data = json.loads(status_obj["Body"].read())
    except s3.exceptions.NoSuchKey:
        # Status file not written yet — still processing
        return None
    except Exception as e:
        # ClientError or other — status file not readable yet
        error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if error_code == "NoSuchKey":
            return None
        logger.debug("Status file not readable", key=status_key, error=str(e))
        return None

    extraction_status = status_data.get("status")

    if extraction_status == "SUCCEEDED":
        try:
            # Read the Document JSON from S3 and convert to plain text
            output_obj = s3.get_object(Bucket=s3_bucket, Key=extraction_output_key)
            document_data = json.loads(output_obj["Body"].read())
            document_text = (
                "\n".join(page["text"] for page in document_data.get("pages", []))
                + "\n"
            )

            # Store plain text in S3 (not DynamoDB — large docs exceed 400KB limit)
            text_key = f"shared/{share_uuid}/document_text.txt"
            s3.put_object(
                Bucket=s3_bucket,
                Key=text_key,
                Body=document_text.encode("utf-8"),
                ContentType="text/plain; charset=utf-8",
            )

            # Update DynamoDB with just status + pointer to text in S3
            table = get_dynamodb_table()
            table.update_item(
                Key={"uuid": share_uuid},
                UpdateExpression="SET #s = :status, document_text_key = :key",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={
                    ":status": "ready",
                    ":key": text_key,
                },
            )
            logger.info(
                "Extraction complete, document text stored in S3",
                uuid=share_uuid,
                text_key=text_key,
                text_length=len(document_text),
            )
            return document_text
        except Exception as e:
            logger.error(
                "Failed to read extraction output",
                uuid=share_uuid,
                error=str(e),
            )
            return None

    elif extraction_status == "FAILED":
        error_msg = status_data.get("error_message", "Document extraction failed")
        table = get_dynamodb_table()
        table.update_item(
            Key={"uuid": share_uuid},
            UpdateExpression="SET #s = :status, error_message = :err",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":status": "error", ":err": error_msg},
        )
        logger.error("Extraction failed", uuid=share_uuid, error=error_msg)
        return None

    # Still IN_PROGRESS
    return None


def _load_document_text(share: dict[str, Any]) -> str:
    """Load document text from S3 or DynamoDB.

    For large documents, text is stored in S3 at document_text_key.
    For small/legacy documents, text is stored directly in DynamoDB.
    """
    # Try S3 first (large docs from async extraction)
    text_key = share.get("document_text_key")
    s3_bucket = share.get("s3_bucket")

    if text_key and s3_bucket:
        try:
            s3 = get_s3_client()
            obj = s3.get_object(Bucket=s3_bucket, Key=text_key)
            text = obj["Body"].read().decode("utf-8")
            logger.info(
                "Loaded document text from S3",
                uuid=share.get("uuid"),
                text_length=len(text),
            )
            return text
        except Exception as e:
            logger.error(
                "Failed to load document text from S3",
                uuid=share.get("uuid"),
                key=text_key,
                error=str(e),
            )

    # Fall back to DynamoDB (small docs or legacy shares)
    return share.get("document_text", "")


def get_share(uuid: str) -> dict[str, Any] | None:
    """Get share record from DynamoDB."""
    table = get_dynamodb_table()
    response = table.get_item(Key={"uuid": uuid})
    return response.get("Item")


def increment_call_count(uuid: str) -> None:
    """Atomically increment call count for a share."""
    table = get_dynamodb_table()
    table.update_item(
        Key={"uuid": uuid},
        UpdateExpression="SET call_count = if_not_exists(call_count, :zero) + :inc",
        ExpressionAttributeValues={":zero": 0, ":inc": 1},
    )


def get_or_extract_document_text(share: dict[str, Any]) -> str:
    """Get cached document text or extract and cache it.

    This ensures extraction only happens once per share, not on every chat.
    """
    # Check if we already have extracted text cached
    if "document_text" in share and share["document_text"]:
        logger.info("Using cached document text", uuid=share["uuid"])
        return share["document_text"]

    # Extract the document content
    logger.info("Extracting document text (first time)", uuid=share["uuid"])
    document_text = fetch_document(share["s3_signed_url"])

    # Cache it in DynamoDB for future requests
    try:
        table = get_dynamodb_table()
        table.update_item(
            Key={"uuid": share["uuid"]},
            UpdateExpression="SET document_text = :text",
            ExpressionAttributeValues={":text": document_text},
        )
        logger.info(
            "Cached extracted document text",
            uuid=share["uuid"],
            text_length=len(document_text),
        )
    except Exception as e:
        # Log but don't fail - we can still use the extracted text
        logger.warning(
            "Failed to cache document text", uuid=share["uuid"], error=str(e)
        )

    return document_text


# ── API Endpoints ───────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


@app.post("/api/shared/create", response_model=CreateShareResponse)
async def create_share(
    body: CreateShareRequest,
    authorization: str | None = Header(None),
):
    """Create a new share (authenticated endpoint).

    Requires a valid Cognito JWT token in the Authorization header.
    For binary documents (PDF, DOCX, etc.), extraction runs asynchronously
    and the share is returned immediately with status="processing".
    For text files, extraction is synchronous and status="ready".
    """
    # Validate JWT and extract user ID
    user_id = validate_jwt(authorization)

    # Generate UUID
    share_uuid = str(uuid4())

    # Parse S3 coordinates from the signed URL for future URL regeneration
    s3_bucket, s3_key = parse_s3_url(body.s3_signed_url)
    logger.info("Parsed S3 coordinates", bucket=s3_bucket, key=s3_key)

    # Determine share expiry: None = permanent (no auto-deletion)
    expiry: int | None = None
    if body.expiry_hours is not None:
        url_expiry = extract_s3_expiry(body.s3_signed_url)
        fallback_expiry = int(time.time()) + (body.expiry_hours * 3600)

        if url_expiry > int(time.time()):
            expiry = url_expiry
            logger.info("Using pre-signed URL expiry", expiry=expiry)
        else:
            expiry = fallback_expiry
            logger.info("Using expiry_hours fallback", expiry=expiry)
    else:
        logger.info("Permanent share — no expiry set")

    # Check if file needs binary extraction (PDF, DOCX, etc.)
    url_path = urlparse(body.s3_signed_url).path.lower()
    needs_extraction = any(
        url_path.endswith(ext) for ext in [".pdf", ".docx", ".xlsx", ".pptx"]
    )

    client_name = get_client_name()

    # Build base item for DynamoDB
    item: Dict[str, Any] = {
        "uuid": share_uuid,
        "s3_signed_url": body.s3_signed_url,
        "s3_bucket": s3_bucket,
        "s3_key": s3_key,
        "system_prompt": body.system_prompt,
        "call_count": 0,
        "view_count": 0,
        "created_at": int(time.time()),
        "created_by": user_id,
        "client_name": client_name,
    }

    # Only set expiry if share is not permanent (prevents DynamoDB TTL auto-deletion)
    if expiry is not None:
        item["expiry"] = expiry

    if body.max_calls is not None:
        item["max_calls"] = body.max_calls
    if body.description:
        item["description"] = body.description
    item["enable_chat"] = body.enable_chat
    item["allow_download"] = body.allow_download

    if needs_extraction:
        # Check if the Files system already extracted this document.
        # The extraction Lambda stores output at {input_key}.json in the same bucket.
        existing_text = _try_read_existing_extraction(s3_bucket, s3_key, share_uuid)

        if existing_text:
            # Reuse existing extraction — store text in S3 and mark ready immediately
            text_key = f"shared/{share_uuid}/document_text.txt"
            s3 = get_s3_client()
            s3.put_object(
                Bucket=s3_bucket,
                Key=text_key,
                Body=existing_text.encode("utf-8"),
                ContentType="text/plain; charset=utf-8",
            )
            item["status"] = "ready"
            item["document_text_key"] = text_key

            table = get_dynamodb_table()
            table.put_item(Item=item)

            status = "ready"
            logger.info(
                "Share created (reused existing extraction)",
                uuid=share_uuid,
                text_length=len(existing_text),
            )
        else:
            # No existing extraction — async path: fire off extraction in background
            extraction_output_key = f"shared/{share_uuid}/extracted.json"
            item["status"] = "processing"
            item["extraction_output_key"] = extraction_output_key

            table = get_dynamodb_table()
            table.put_item(Item=item)

            _start_async_extraction(
                share_uuid=share_uuid,
                s3_bucket=s3_bucket,
                s3_key=s3_key,
                extraction_output_key=extraction_output_key,
            )

            status = "processing"
            logger.info(
                "Share created (extraction in progress)",
                uuid=share_uuid,
                extraction_output_key=extraction_output_key,
            )
    else:
        # Sync path: text files are fast to fetch directly
        logger.info("Fetching text document at share creation", uuid=share_uuid)
        document_text = fetch_document(body.s3_signed_url)
        item["document_text"] = document_text
        item["status"] = "ready"

        table = get_dynamodb_table()
        table.put_item(Item=item)

        status = "ready"
        logger.info(
            "Share created (text extracted)",
            uuid=share_uuid,
            text_length=len(document_text),
        )

    expires_at = (
        datetime.fromtimestamp(expiry, tz=timezone.utc).isoformat()
        if expiry is not None
        else None
    )

    logger.info(
        "Share created",
        uuid=share_uuid,
        expires_at=expires_at or "permanent",
        created_by=user_id,
        max_calls=body.max_calls,
        status=status,
    )

    return CreateShareResponse(uuid=share_uuid, expires_at=expires_at, status=status)


def get_client_name() -> str:
    """Extract client name from table name (numa-{client}-shared)."""
    if SHARED_TABLE_NAME:
        parts = SHARED_TABLE_NAME.replace("numa-", "").replace("-shared", "")
        return parts
    return ""


@app.get("/api/shared/list", response_model=ShareListResponse)
async def list_shares(authorization: str | None = Header(None)):
    """List all shares created by the authenticated user.

    Queries the created_by-created_at GSI to return shares owned by the caller,
    sorted newest first. Includes expired shares so the owner can see their full history.
    """
    user_id = validate_jwt(authorization)
    table = get_dynamodb_table()

    response = table.query(
        IndexName="created_by-created_at-index",
        KeyConditionExpression="created_by = :uid",
        ExpressionAttributeValues={":uid": user_id},
        ScanIndexForward=False,
    )

    shares = []
    for item in response.get("Items", []):
        raw_expiry = item.get("expiry")
        expiry = int(raw_expiry) if raw_expiry is not None else None

        s3_key = item.get("s3_key", "")
        name = s3_key.split("/")[-1] if "/" in s3_key else "Shared document"

        expires_at = (
            datetime.fromtimestamp(expiry, tz=timezone.utc).isoformat()
            if expiry is not None
            else None
        )

        shares.append(
            ShareListItem(
                uuid=item["uuid"],
                name=name,
                description=item.get("description", "") or "",
                status=item.get("status", "ready"),
                created_at=(
                    float(item["created_at"]) if item.get("created_at") else None
                ),
                expires_at=expires_at,
                call_count=int(item.get("call_count", 0)),
                view_count=int(item.get("view_count", 0)),
                enable_chat=item.get("enable_chat", True),
                allow_download=item.get("allow_download", True),
            )
        )

    return ShareListResponse(shares=shares)


@app.get("/api/shared/activity")
async def get_activity(authorization: str | None = Header(None), limit: int = 50):
    """Get recent visitor activity across all of the user's shares.

    Returns recent chat messages grouped by share, sorted newest first.
    This gives the share owner a live feed of how visitors are interacting
    with their shared documents.
    """
    from .chat_history import (  # pylint: disable=import-outside-toplevel
        SharedChatHistory,
    )

    user_id = validate_jwt(authorization)
    table = get_dynamodb_table()

    # Get all shares owned by this user
    response = table.query(
        IndexName="created_by-created_at-index",
        KeyConditionExpression="created_by = :uid",
        ExpressionAttributeValues={":uid": user_id},
        ScanIndexForward=False,
    )

    shares = response.get("Items", [])
    if not shares:
        return {"activity": []}

    # Build a uuid→name lookup from the shares
    share_names: Dict[str, str] = {}
    for item in shares:
        s3_key = item.get("s3_key", "")
        name = s3_key.split("/")[-1] if "/" in s3_key else "Shared document"
        share_names[item["uuid"]] = name

    # Query recent messages and view events from each share's chat history
    activity_items = []
    for item in shares:
        share_uuid = item["uuid"]
        expiry = int(item.get("expiry", 0))

        chat_history = SharedChatHistory(share_uuid=share_uuid, share_expiry=expiry)
        all_messages = chat_history.get_all_messages()

        # Include user messages (questions) and view events, skip summaries/assistant
        relevant = [
            m
            for m in all_messages
            if (m.get("role") == "user" or m.get("role") == "view")
            and not m.get("is_summary")
        ]

        for msg in relevant:
            content = msg.get("content", "")
            event_type = "view" if msg.get("role") == "view" else "message"
            activity_items.append(
                {
                    "share_uuid": share_uuid,
                    "share_name": share_names.get(share_uuid, "Shared document"),
                    "session_id": msg.get("session_id", "unknown"),
                    "event_type": event_type,
                    "message_preview": content[:200] if content else "",
                    "timestamp": msg.get("timestamp", 0),
                    "ip_address": msg.get("ip_address"),
                    "user_agent": msg.get("user_agent"),
                }
            )

    # Sort by timestamp descending (newest first) and limit
    activity_items.sort(key=lambda a: a.get("timestamp", 0), reverse=True)
    activity_items = activity_items[:limit]

    return {"activity": activity_items}


def increment_view_count(uuid: str) -> None:
    """Atomically increment view count for a share."""
    table = get_dynamodb_table()
    table.update_item(
        Key={"uuid": uuid},
        UpdateExpression="SET view_count = if_not_exists(view_count, :zero) + :inc",
        ExpressionAttributeValues={":zero": 0, ":inc": 1},
    )


def record_view_event(
    share_uuid: str,
    share_expiry: int | None,
    session_id: str | None,
    ip_address: str,
    user_agent: str,
) -> None:
    """Record a page view event in the chat history table.

    Stored with sk=VIEW#session_id#timestamp so it can be queried alongside
    chat messages for the activity feed and analytics.
    """
    from .chat_history import (  # pylint: disable=import-outside-toplevel
        SharedChatHistory,
    )

    chat_history = SharedChatHistory(share_uuid=share_uuid, share_expiry=share_expiry)
    ts = int(time.time() * 1000)
    sid = session_id or "anon"
    sk = f"VIEW#{sid}#{ts}"

    item: Dict[str, Any] = {
        "uuid": share_uuid,
        "sk": sk,
        "role": "view",
        "content": "Viewed document",
        "timestamp": ts,
        "session_id": sid,
        "ip_address": ip_address,
        "user_agent": user_agent,
    }

    # Only set expiry for TTL if share has an expiry
    if share_expiry is not None:
        item["expiry"] = share_expiry

    try:
        chat_history.table.put_item(Item=item)
    except Exception as e:
        logger.warning("Failed to record view event", uuid=share_uuid, error=str(e))


@app.get("/api/shared/{uuid}", response_model=ShareInfoResponse)
async def get_share_info(uuid: str, request: Request):
    """Get share information (public endpoint)."""
    share = get_share(uuid)

    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    # Check expiry only if set (permanent shares have no expiry field)
    raw_expiry = share.get("expiry")
    expiry = int(raw_expiry) if raw_expiry is not None else None

    if expiry is not None and time.time() > expiry:
        raise HTTPException(status_code=410, detail="Share expired")

    expires_at = (
        datetime.fromtimestamp(expiry, tz=timezone.utc).isoformat()
        if expiry is not None
        else None
    )

    # Track page view — increment counter and record view event
    ip_address = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    user_agent = request.headers.get("User-Agent", "")
    session_id = request.query_params.get("session_id")

    increment_view_count(uuid)
    record_view_event(uuid, expiry, session_id, ip_address, user_agent)

    # Get client name for branding (from share record or derive from table name)
    client_name = share.get("client_name") or get_client_name()

    # Determine status (default "ready" for backward compat with existing shares)
    status = share.get("status", "ready")

    # If still processing, check if extraction has completed in S3
    if status == "processing":
        result = _check_and_complete_extraction(share)
        if result:
            status = "ready"

    # Regenerate a fresh pre-signed URL if we have bucket/key stored
    s3_bucket = share.get("s3_bucket")
    s3_key = share.get("s3_key")

    if s3_bucket and s3_key:
        try:
            fresh_url = generate_fresh_signed_url(s3_bucket, s3_key, expires_in=3600)
            logger.info("Regenerated fresh pre-signed URL", uuid=uuid)
        except Exception as e:
            logger.warning(
                "Failed to regenerate URL, falling back to stored URL",
                uuid=uuid,
                error=str(e),
            )
            fresh_url = share["s3_signed_url"]
    else:
        # Legacy share without bucket/key — use stored URL (may be expired)
        logger.warning(
            "Legacy share without s3_bucket/s3_key, using stored URL", uuid=uuid
        )
        fresh_url = share["s3_signed_url"]

    # Read permission flags (default True for backward compat with existing shares)
    allow_download = share.get("allow_download", True)
    enable_chat = share.get("enable_chat", True)

    # Always return the signed URL for inline document viewing.
    # The allow_download flag controls whether the frontend shows a download button.
    return ShareInfoResponse(
        uuid=uuid,
        s3_signed_url=fresh_url,
        expires_at=expires_at,
        client_name=client_name,
        status=status,
        description=share.get("description"),
        enable_chat=enable_chat,
        allow_download=allow_download,
    )


@app.post("/api/shared/{uuid}/chat")
async def chat(uuid: str, body: ChatRequest, request: Request):
    """Stream chat response for a share (public endpoint)."""
    from .chat_history import (  # pylint: disable=import-outside-toplevel
        SharedChatHistory,
    )

    share = get_share(uuid)

    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    # Check if chat is enabled for this share
    if not share.get("enable_chat", True):
        raise HTTPException(status_code=403, detail="Chat is disabled for this share")

    # Check expiry only if set (permanent shares have no expiry field)
    raw_expiry = share.get("expiry")
    expiry = int(raw_expiry) if raw_expiry is not None else None

    if expiry is not None and time.time() > expiry:
        raise HTTPException(status_code=410, detail="Share expired")

    # Check extraction status before allowing chat
    status = share.get("status", "ready")
    if status == "processing":
        # Check if extraction just completed
        result = _check_and_complete_extraction(share)
        if not result:
            raise HTTPException(
                status_code=202, detail="Document is still being processed"
            )
        # Extraction just completed — use the returned text
        document_text = result
    elif status == "error":
        raise HTTPException(
            status_code=502,
            detail=share.get("error_message", "Document extraction failed"),
        )
    else:
        # Ready state — load document text (from S3 for large docs, DynamoDB for small)
        document_text = _load_document_text(share)

    # Check max_calls limit if set
    max_calls = share.get("max_calls")
    call_count = int(share.get("call_count", 0))
    if max_calls is not None and call_count >= int(max_calls):
        raise HTTPException(status_code=429, detail="Call limit reached")

    if not document_text:
        # Fallback: extract on first request for legacy shares without pre-extracted text
        logger.warning(
            "No pre-extracted document_text, falling back to lazy extraction",
            uuid=uuid,
        )
        # For shares with bucket/key, regenerate URL before extraction
        s3_bucket = share.get("s3_bucket")
        s3_key = share.get("s3_key")
        if s3_bucket and s3_key:
            fresh_url = generate_fresh_signed_url(s3_bucket, s3_key, expires_in=300)
            share["s3_signed_url"] = fresh_url
        document_text = get_or_extract_document_text(share)

    # Extract visitor info for analytics
    ip_address = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    user_agent = request.headers.get("User-Agent", "")
    session_id = body.session_id

    # Initialize chat history manager
    chat_history = SharedChatHistory(share_uuid=uuid, share_expiry=expiry)

    # Load existing chat history for this session
    history_messages = chat_history.load_history(session_id=session_id)

    logger.info(
        "Starting chat stream",
        uuid=uuid,
        query_length=len(body.query),
        session_id=session_id,
        history_count=len(history_messages),
    )

    async def generate() -> AsyncGenerator[str, None]:
        """Stream NDJSON response."""
        full_response = ""  # Accumulate response for storage
        try:
            # Send start event
            yield json.dumps({"type": "start"}) + "\n"

            # Build messages for Nova
            # Include chat history context (but NOT the document - we add that fresh each time)
            messages = []

            # Add history messages (summaries and recent conversation)
            for hist_msg in history_messages:
                role = hist_msg.get("role", "user")
                content = hist_msg.get("content", "")
                if hist_msg.get("is_summary"):
                    # Format summary as context
                    messages.append(
                        {
                            "role": "assistant",
                            "content": [
                                {"text": f"[Previous conversation summary]\n{content}"}
                            ],
                        }
                    )
                else:
                    messages.append(
                        {
                            "role": role,
                            "content": [{"text": content}],
                        }
                    )

            # Add current query with document context
            # Document is ALWAYS included fresh (never compressed)
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "text": f"Document:\n\n{document_text}\n\n---\n\nQuestion: {body.query}"
                        }
                    ],
                }
            )

            # Call Nova with streaming
            bedrock = get_bedrock_client()
            response = bedrock.converse_stream(
                modelId=MODEL_ID,
                system=[{"text": share["system_prompt"]}],
                messages=messages,
                inferenceConfig={"maxTokens": 4000, "temperature": 0.1},
            )

            input_tokens = 0
            output_tokens = 0

            # Stream response chunks
            for event in response.get("stream", []):
                if "contentBlockDelta" in event:
                    delta = event["contentBlockDelta"].get("delta", {})
                    text = delta.get("text", "")
                    if text:
                        full_response += text
                        yield json.dumps({"type": "chunk", "data": text}) + "\n"

                elif "metadata" in event:
                    usage = event["metadata"].get("usage", {})
                    input_tokens = usage.get("inputTokens", 0)
                    output_tokens = usage.get("outputTokens", 0)

            # Store messages in chat history (for future context)
            chat_history.add_message(
                role="user",
                content=body.query,
                session_id=session_id,
                ip_address=ip_address,
                user_agent=user_agent,
            )
            chat_history.add_message(
                role="assistant",
                content=full_response,
                session_id=session_id,
            )

            # Increment call count
            increment_call_count(uuid)

            # Send completion event with usage
            yield json.dumps(
                {
                    "type": "completion",
                    "usage": {
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                    },
                }
            ) + "\n"

            logger.info(
                "Chat stream completed",
                uuid=uuid,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                session_id=session_id,
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error("Chat stream error", uuid=uuid, error=str(e))
            yield json.dumps({"type": "error", "error": str(e)}) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/shared/{uuid}/analytics")
async def get_analytics(uuid: str, authorization: str | None = Header(None)):
    """Get analytics for a share (authenticated, owner-only endpoint).

    Provides sentiment analysis and conversation summaries for the share creator.
    """
    from .chat_history import (  # pylint: disable=import-outside-toplevel
        SharedChatHistory,
    )

    # Validate JWT and get user ID
    user_id = validate_jwt(authorization)

    # Get share and verify ownership
    share = get_share(uuid)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    if share.get("created_by") != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view analytics")

    # Get share expiry for chat history
    expiry = int(share.get("expiry", 0))

    # Load all chat history
    chat_history = SharedChatHistory(share_uuid=uuid, share_expiry=expiry)
    all_messages = chat_history.get_all_messages()

    # Filter to regular messages (not summaries)
    regular_messages = [m for m in all_messages if not m.get("is_summary")]

    # Group by session
    sessions: Dict[str, list] = {}
    for msg in regular_messages:
        session_id = msg.get("session_id", "unknown")
        if session_id not in sessions:
            sessions[session_id] = []
        sessions[session_id].append(msg)

    # Analyze each session
    session_analytics = []
    for session_id, session_messages in sessions.items():
        user_messages = [m for m in session_messages if m.get("role") == "user"]
        if not user_messages:
            continue

        # Get first message metadata for visitor info
        first_msg = min(session_messages, key=lambda m: m.get("timestamp", 0))
        last_msg = max(session_messages, key=lambda m: m.get("timestamp", 0))

        analysis = _analyze_session(session_messages)

        session_analytics.append(
            {
                "session_id": session_id,
                "ip_address": first_msg.get("ip_address"),
                "user_agent": first_msg.get("user_agent"),
                "message_count": len(user_messages),
                "first_message_at": first_msg.get("timestamp"),
                "last_message_at": last_msg.get("timestamp"),
                "sentiment": analysis.get("sentiment", "neutral"),
                "summary": analysis.get("summary", ""),
                "topics": analysis.get("topics", []),
            }
        )

    # Sort sessions by first message time
    session_analytics.sort(key=lambda s: s.get("first_message_at", 0), reverse=True)

    # Calculate overall analytics
    total_sessions = len(session_analytics)
    total_messages = sum(s.get("message_count", 0) for s in session_analytics)
    unique_ips = len(
        set(s.get("ip_address") for s in session_analytics if s.get("ip_address"))
    )

    # Calculate overall sentiment
    sentiments = [s.get("sentiment", "neutral") for s in session_analytics]
    positive_count = sentiments.count("positive")
    negative_count = sentiments.count("negative")

    if positive_count > negative_count:
        overall_sentiment = "positive"
    elif negative_count > positive_count:
        overall_sentiment = "negative"
    else:
        overall_sentiment = "neutral"

    # Generate overall summary if there are sessions
    overall_summary = ""
    if session_analytics:
        overall_summary = _generate_overall_summary(session_analytics)

    # Compute engagement metrics
    engagement = _compute_engagement(session_analytics)

    # Compute average session duration (minutes)
    durations = []
    for s in session_analytics:
        first = s.get("first_message_at", 0)
        last = s.get("last_message_at", 0)
        if first and last and last > first:
            durations.append((last - first) / 60_000)  # ms → minutes
    avg_session_duration = round(sum(durations) / len(durations)) if durations else 0

    # Get view_count from the share record
    view_count = int(share.get("view_count", 0))

    # Count unique viewers from view events + chat sessions
    all_messages = chat_history.get_all_messages()
    view_ips = set(
        m.get("ip_address")
        for m in all_messages
        if m.get("ip_address") and (m.get("role") == "view" or m.get("role") == "user")
    )
    unique_viewers = len(view_ips) if view_ips else unique_ips

    return {
        "uuid": uuid,
        "sessions": session_analytics,
        "overall": {
            "total_sessions": total_sessions,
            "total_messages": total_messages,
            "unique_visitors": unique_viewers,
            "overall_sentiment": overall_sentiment,
            "overall_summary": overall_summary,
            "view_count": view_count,
            "avg_session_duration": avg_session_duration,
        },
        "engagement": engagement,
    }


def _analyze_session(messages: list) -> Dict[str, Any]:
    """Analyze a single conversation session using Nova 2 Lite.

    Args:
        messages: List of messages in the session

    Returns:
        Dict with sentiment, summary, and topics
    """
    if not messages:
        return {"sentiment": "neutral", "summary": "", "topics": []}

    # Format conversation
    conversation_parts = []
    for msg in messages:
        role = msg.get("role", "unknown").upper()
        content = msg.get("content", "")
        conversation_parts.append(f"{role}: {content}")

    conversation_text = "\n".join(conversation_parts)

    if len(conversation_text) > 8000:
        conversation_text = conversation_text[:8000] + "..."

    try:
        bedrock = get_bedrock_client()

        prompt = f"""Analyze this conversation and provide:
1. Sentiment: Is the user satisfied, neutral, or frustrated? (one word: positive/neutral/negative)
2. Summary: Brief 1-2 sentence summary of what they discussed
3. Topics: List of key topics (max 5)

Conversation:
{conversation_text}

Respond ONLY in valid JSON format:
{{"sentiment": "...", "summary": "...", "topics": ["...", "..."]}}"""

        response = bedrock.converse(
            modelId=MODEL_ID,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 500, "temperature": 0.1},
        )

        output = response.get("output", {})
        message = output.get("message", {})
        content = message.get("content", [])

        if content and isinstance(content[0], dict):
            response_text = content[0].get("text", "{}")
            # Parse JSON response
            try:
                result = json.loads(response_text)
                return {
                    "sentiment": result.get("sentiment", "neutral"),
                    "summary": result.get("summary", ""),
                    "topics": result.get("topics", [])[:5],
                }
            except json.JSONDecodeError:
                logger.warning("Failed to parse analysis JSON", response=response_text)

    except Exception as e:
        logger.error("Session analysis failed", error=str(e))

    return {"sentiment": "neutral", "summary": "", "topics": []}


def _generate_overall_summary(session_analytics: list) -> str:
    """Generate overall summary of all conversations.

    Args:
        session_analytics: List of session analysis results

    Returns:
        Summary text
    """
    if not session_analytics:
        return ""

    # Combine all session summaries
    summaries = [s.get("summary", "") for s in session_analytics if s.get("summary")]
    all_topics = []
    for s in session_analytics:
        all_topics.extend(s.get("topics", []))

    if not summaries:
        return ""

    try:
        bedrock = get_bedrock_client()

        prompt = f"""Based on these conversation summaries, create a brief overall summary (2-3 sentences) of what users discussed with this shared document:

Session summaries:
{chr(10).join(f"- {s}" for s in summaries)}

Topics mentioned: {", ".join(set(all_topics))}

Overall summary:"""

        response = bedrock.converse(
            modelId=MODEL_ID,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 200, "temperature": 0.1},
        )

        output = response.get("output", {})
        message = output.get("message", {})
        content = message.get("content", [])

        if content and isinstance(content[0], dict):
            return content[0].get("text", "")

    except Exception as e:
        logger.error("Overall summary generation failed", error=str(e))

    return ""


def _compute_engagement(session_analytics: list) -> Dict[str, Any]:
    """Compute engagement metrics from session analytics.

    Scores engagement 0–100 based on visitor count, message depth, session
    duration, and return visits. Then calls Nova to extract interest signals
    and a recommended next action from the conversation data.
    """
    if not session_analytics:
        return {
            "engagement_score": 0,
            "interest_signals": [],
            "recommended_action": "",
        }

    total_sessions = len(session_analytics)
    total_messages = sum(s.get("message_count", 0) for s in session_analytics)
    unique_ips = len(
        set(s.get("ip_address") for s in session_analytics if s.get("ip_address"))
    )

    # Average messages per session (depth of engagement)
    avg_messages = total_messages / total_sessions if total_sessions else 0

    # Average session duration in minutes
    durations = []
    for s in session_analytics:
        first = s.get("first_message_at", 0)
        last = s.get("last_message_at", 0)
        if first and last and last > first:
            durations.append((last - first) / 60_000)  # ms → minutes
    avg_duration = sum(durations) / len(durations) if durations else 0

    # Score components (each 0–25, total 0–100)
    visitor_score = min(unique_ips * 5, 25)
    depth_score = min(avg_messages * 5, 25)
    duration_score = min(avg_duration * 2.5, 25)
    volume_score = min(total_sessions * 3, 25)

    engagement_score = round(
        visitor_score + depth_score + duration_score + volume_score
    )

    # Use Nova to extract interest signals and recommended action
    interest_signals = []
    recommended_action = ""

    all_topics = []
    all_summaries = []
    for s in session_analytics:
        all_topics.extend(s.get("topics", []))
        if s.get("summary"):
            all_summaries.append(s["summary"])

    if all_summaries:
        try:
            bedrock = get_bedrock_client()
            prompt = f"""Based on these visitor conversation summaries for a shared document, provide:
1. interest_signals: Up to 5 short phrases describing what visitors are most interested in
2. recommended_action: One actionable sentence the document owner should do next

Summaries:
{chr(10).join(f"- {s}" for s in all_summaries)}

Topics: {", ".join(set(all_topics))}
Engagement score: {engagement_score}/100
Sessions: {total_sessions}, Messages: {total_messages}

Respond ONLY in valid JSON:
{{"interest_signals": ["..."], "recommended_action": "..."}}"""

            response = bedrock.converse(
                modelId=MODEL_ID,
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig={"maxTokens": 300, "temperature": 0.2},
            )

            output = response.get("output", {})
            message = output.get("message", {})
            content = message.get("content", [])

            if content and isinstance(content[0], dict):
                result = json.loads(content[0].get("text", "{}"))
                interest_signals = result.get("interest_signals", [])[:5]
                recommended_action = result.get("recommended_action", "")

        except Exception as e:
            logger.error("Engagement analysis failed", error=str(e))

    return {
        "engagement_score": engagement_score,
        "interest_signals": interest_signals,
        "recommended_action": recommended_action,
    }


# Error handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions with JSON response."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )
