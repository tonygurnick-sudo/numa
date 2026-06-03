"""
Shared Nova API - FastAPI application for public document Q&A and Drop Zones.

Provides:
- POST /shared - Create a share or drop zone (authenticated via Cognito JWT)
- GET /shared/{uuid} - Get share/drop zone info (public)
- POST /shared/{uuid}/chat - Stream chat responses (public)
- POST /shared/{uuid}/auth - Authenticate to a drop zone (passcode)
- POST /shared/{uuid}/upload - Get presigned upload URL for drop zone
- POST /shared/{uuid}/upload/confirm - Confirm upload completed
- GET /shared/{uuid}/files - List uploaded files in a drop zone
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import time
from datetime import datetime, timezone
from decimal import Decimal
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
DATA_BUCKET_NAME = os.environ.get("DATA_BUCKET_NAME", "")
BEDROCK_KNOWLEDGE_BASE_ID = os.environ.get("BEDROCK_KNOWLEDGE_BASE_ID", "")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "")

# Secret key for signing drop zone auth tokens (generated per Lambda instance)
_DROPZONE_TOKEN_SECRET = secrets.token_hex(32)

# Clients (lazily initialized)
_dynamodb_table = None
_bedrock_client = None
_bedrock_kb_client = None
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
    kb_id: str | None = None  # Optional Knowledge Base ID for enhanced chat
    allowed_ips: list[str] | None = None  # List of allowed IPs or CIDR blocks


class CreateShareResponse(BaseModel):
    """Response body for create share."""

    uuid: str
    expires_at: str | None = None  # None = permanent share
    status: str = "ready"
    chat_status: str = "ready"  # "ready" | "pending" | "error"


class ShareInfoResponse(BaseModel):
    """Response body for get share info."""

    uuid: str
    s3_signed_url: str
    expires_at: str | None = None  # None = permanent share
    client_name: str | None = None  # For branding lookup
    status: str = "ready"
    chat_status: str = "ready"  # "ready" | "pending" | "error"
    description: str | None = None
    enable_chat: bool = True
    allow_download: bool = True
    max_calls: int | None = None  # None = unlimited
    call_count: int = 0
    allowed_ips: list[str] | None = None
    error_message: str | None = None  # populated when status/chat_status == "error"


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
    # Drop zone fields (optional — only present for dropzone shares)
    share_type: str = "document"
    upload_count: int | None = None
    total_quota_mb: int | None = None
    used_quota_mb: float | None = None
    folder_path: str | None = None
    auth_mode: str | None = None
    passcode: str | None = None  # Plain passcode for owner display
    max_calls: int | None = None
    allowed_ips: list[str] | None = None


class ShareListResponse(BaseModel):
    """Response body for listing shares."""

    shares: list[ShareListItem]


class CreateDropZoneRequest(BaseModel):
    """Request body for creating a drop zone."""

    folder_path: str  # User-facing folder path (e.g., "/reports/")
    s3_folder_prefix: str  # S3 prefix where uploads land
    instructions: str = ""  # Markdown instructions for uploaders
    auth_mode: str = "passcode"  # 'none' | 'passcode' | 'email'
    passcode: str | None = None  # Plain text passcode (hashed before storing)
    expiry_hours: int | None = None
    max_file_size_mb: int | None = None
    total_quota_mb: int | None = None
    allowed_extensions: list[str] | None = None
    enable_api: bool = True
    enable_chat: bool = True
    description: str | None = None
    max_calls: int | None = None  # Max chat questions (None = unlimited)
    kb_id: str | None = None  # Optional Knowledge Base ID for chat
    allowed_ips: list[str] | None = None


class DropZoneAuthRequest(BaseModel):
    """Request body for authenticating to a drop zone."""

    passcode: str


class DropZoneUploadRequest(BaseModel):
    """Request body for requesting a presigned upload URL."""

    filename: str
    content_type: str = "application/octet-stream"
    size_bytes: int


class DropZoneUploadConfirmRequest(BaseModel):
    """Request body for confirming a completed upload."""

    file_id: str
    filename: str
    size_bytes: int


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
    # Check if this is a binary format that needs extraction
    url_path = urlparse(s3_signed_url).path.lower()
    _BINARY_EXTENSIONS = [
        ".pdf",
        ".docx",
        ".xlsx",
        ".pptx",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".bmp",
        ".msg",
        ".mp3",
        ".mp4",
        ".wav",
        ".flac",
        ".ogg",
        ".amr",
        ".webm",
        ".m4a",
    ]
    needs_extraction = any(url_path.endswith(ext) for ext in _BINARY_EXTENSIONS)

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
            _name="SHARE_EXTRACTION_QUEUED",
            uuid=share_uuid,
            extraction_lambda=extraction_lambda,
            output_key=extraction_output_key,
        )
    except Exception as e:
        logger.error(
            "Failed to start async extraction",
            _name="SHARE_EXTRACTION_INVOKE_FAILED",
            uuid=share_uuid,
            error=str(e),
        )
        # Surface the failure on BOTH fields: chat_status is what the share page
        # gates on (a stranded "pending" would spin forever); status mirrors it.
        table = get_dynamodb_table()
        table.update_item(
            Key={"uuid": share_uuid},
            UpdateExpression="SET #s = :status, chat_status = :cs, error_message = :err",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":status": "error",
                ":cs": "error",
                ":err": str(e),
            },
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
                "\n".join(
                    page.get("text", "") for page in document_data.get("pages", [])
                )
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


# Hard upper bound on extraction wall-clock: the extract-content Lambda can run at
# most ~15 min (900s). A status file still IN_PROGRESS well past that means the
# Lambda died mid-run (hard timeout / OOM) without writing FAILED — treat as failed.
_EXTRACTION_STALE_SECONDS = 1200


def _flip_share_to_error(uuid: str, error_msg: str, share: dict[str, Any]) -> None:
    """Persist + mirror an extraction error onto the share (both status fields)."""
    get_dynamodb_table().update_item(
        Key={"uuid": uuid},
        UpdateExpression="SET chat_status = :cs, #s = :st, error_message = :err",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":cs": "error", ":st": "error", ":err": error_msg},
    )
    share["chat_status"] = "error"
    share["status"] = "error"
    share["error_message"] = error_msg


def _resolve_pending_extraction(share: dict[str, Any]) -> tuple[str, str | None]:
    """Resolve a chat_status=="pending" share by polling the extraction output.

    create_share fires _start_async_extraction, which writes the Document JSON to
    {s3_key}.json and a {s3_key}.status.json sidecar. This is the read-side poll
    invoked from get_share_info and the chat endpoint on every request.

    Mutates ``share`` in place (chat_status / status / document_text_key /
    error_message) and persists the same change to DynamoDB, so callers can read
    the updated values straight off ``share``.

    Returns (chat_status, document_text):
      - ("ready", text)   extraction output is available; document_text.txt written.
      - ("error", None)   the status sidecar reports FAILED; share flipped to error.
      - ("pending", None) extraction still in progress / no output yet.
    """
    uuid = str(share.get("uuid", ""))
    s3_bucket = str(share.get("s3_bucket", ""))
    doc_key = str(share.get("transcription_file_key") or share.get("s3_key") or "")
    if not s3_bucket or not doc_key:
        return "pending", None

    # 1. Succeeded? _try_read_existing_extraction reads {doc_key}.json
    existing_text = _try_read_existing_extraction(s3_bucket, doc_key, uuid)
    if existing_text:
        text_key = f"shared/{uuid}/document_text.txt"
        get_s3_client().put_object(
            Bucket=s3_bucket,
            Key=text_key,
            Body=existing_text.encode("utf-8"),
            ContentType="text/plain; charset=utf-8",
        )
        get_dynamodb_table().update_item(
            Key={"uuid": uuid},
            UpdateExpression="SET chat_status = :cs, document_text_key = :tk",
            ExpressionAttributeValues={":cs": "ready", ":tk": text_key},
        )
        share["chat_status"] = "ready"
        share["document_text_key"] = text_key
        logger.info(
            "Chat status updated to ready (extraction output found)",
            _name="SHARE_EXTRACTION_READY",
            uuid=uuid,
        )
        return "ready", existing_text

    # 2. Otherwise consult the {doc_key}.status.json sidecar the extractor writes
    #    (status_key derivation mirrors extract-content lambda_function.py output_key
    #    -> status_key). Without it, a FAILED or dead extraction is indistinguishable
    #    from "still processing" and the share spins forever (the original bug class).
    status_key = f"{doc_key}.status.json"
    status_data: dict[str, Any] = {}
    try:
        status_obj = get_s3_client().get_object(Bucket=s3_bucket, Key=status_key)
        status_data = json.loads(status_obj["Body"].read())
    except Exception as e:  # noqa: BLE001
        code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if code and code not in ("NoSuchKey", "404", "NoSuchBucket"):
            # A persistent AccessDenied/KMS error would otherwise masquerade as
            # perpetual "pending"; surface it instead of swallowing silently.
            logger.warning(
                "Pending status file unreadable",
                _name="SHARE_STATUS_READ_ERROR",
                uuid=uuid,
                key=status_key,
                error=str(e),
            )
        status_data = {}

    extraction_status = status_data.get("status")

    if extraction_status == "FAILED":
        error_msg = str(status_data.get("error_message", "Document extraction failed"))
        _flip_share_to_error(uuid, error_msg, share)
        logger.error(
            "Share extraction failed",
            _name="SHARE_EXTRACTION_FAILED",
            uuid=uuid,
            error=error_msg,
        )
        return "error", None

    # Stale IN_PROGRESS → the Lambda died (hard timeout / OOM) without writing
    # FAILED. Surface it as an error so the client stops polling forever.
    started_at = status_data.get("started_at")
    if (
        extraction_status == "IN_PROGRESS"
        and isinstance(started_at, (int, float))
        and time.time() - float(started_at) > _EXTRACTION_STALE_SECONDS
    ):
        _flip_share_to_error(uuid, "Document extraction timed out", share)
        logger.error(
            "Share extraction timed out (stale IN_PROGRESS)",
            _name="SHARE_EXTRACTION_TIMEOUT",
            uuid=uuid,
            age_seconds=int(time.time() - float(started_at)),
        )
        return "error", None

    # 3. Still in progress / no output yet
    return "pending", None


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


# ── Drop Zone Helpers ──────────────────────────────────────────────────────


def _hash_passcode(passcode: str) -> str:
    """Hash a passcode using PBKDF2-HMAC-SHA256 with a random salt.

    Returns a string in the format "salt:hash" (both hex-encoded).
    """
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", passcode.encode(), salt.encode(), 100_000)
    return f"{salt}:{dk.hex()}"


def _verify_passcode(passcode: str, stored_hash: str) -> bool:
    """Verify a passcode against a stored PBKDF2-HMAC-SHA256 hash."""
    try:
        salt, expected_hash = stored_hash.split(":", 1)
        dk = hashlib.pbkdf2_hmac("sha256", passcode.encode(), salt.encode(), 100_000)
        return hmac.compare_digest(dk.hex(), expected_hash)
    except (ValueError, AttributeError):
        return False


def _create_dropzone_token(uuid: str, expires_in: int = 3600) -> str:
    """Create a simple HMAC-signed token for drop zone authentication.

    Returns a token string: "uuid:expiry:signature" (hex-encoded signature).
    """
    expiry = int(time.time()) + expires_in
    payload = f"{uuid}:{expiry}"
    sig = hmac.new(
        _DROPZONE_TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    return f"{payload}:{sig}"


def _verify_dropzone_token(token: str, expected_uuid: str) -> bool:
    """Verify a drop zone auth token."""
    try:
        parts = token.split(":")
        if len(parts) != 3:
            return False
        uuid_part, expiry_str, signature = parts
        if uuid_part != expected_uuid:
            return False
        expiry = int(expiry_str)
        if time.time() > expiry:
            return False
        payload = f"{uuid_part}:{expiry_str}"
        expected_sig = hmac.new(
            _DROPZONE_TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(signature, expected_sig)
    except (ValueError, AttributeError):
        return False


def _check_dropzone_auth(share: dict[str, Any], authorization: str | None) -> None:
    """Check if the request is authorized to access a drop zone.

    Raises HTTPException if auth is required and the token is invalid/missing.
    For auth_mode='none', this is a no-op.
    """
    auth_mode = share.get("auth_mode", "none")
    if auth_mode == "none":
        return

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")

    token = authorization[7:]
    if not _verify_dropzone_token(token, share["uuid"]):
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def _check_ip_allowlist(share: dict[str, Any], request: Request) -> None:
    """Validate client IP against the share's allowlist."""
    allowed_ips = share.get("allowed_ips")
    if not allowed_ips:
        return

    # Get client IP from X-Forwarded-For header (first IP in the list)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if not forwarded_for:
        # Fallback to direct client host (useful for local testing)
        client_ip_str = request.client.host if request.client else None
    else:
        client_ip_str = forwarded_for.split(",")[0].strip()

    if not client_ip_str:
        raise HTTPException(status_code=403, detail="IP address not authorized")

    try:
        client_ip = ipaddress.ip_address(client_ip_str)
        for allowed in allowed_ips:
            # Handle exact IP or CIDR notation
            if "/" in allowed:
                network = ipaddress.ip_network(allowed.strip(), strict=False)
                if client_ip in network:
                    return
            else:
                allowed_ip = ipaddress.ip_address(allowed.strip())
                if client_ip == allowed_ip:
                    return
    except ValueError:
        # Invalid IP format
        pass

    raise HTTPException(status_code=403, detail="IP address not authorized")


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

    # A malformed signed URL yields empty coordinates; fail fast rather than
    # persist a share that can never extract (it would hang at "pending" forever).
    if not s3_bucket or not s3_key:
        raise HTTPException(
            status_code=400,
            detail="Could not parse S3 bucket/key from s3_signed_url",
        )

    # Determine share expiry: None = permanent (no auto-deletion)
    # Always use the user's explicit expiry_hours selection — the presigned URL
    # expiry (~1 hour) is unrelated to the share's intended lifetime.
    expiry: int | None = None
    if body.expiry_hours is not None:
        expiry = int(time.time()) + (body.expiry_hours * 3600)
        logger.info(
            "Share expiry set from expiry_hours", expiry=expiry, hours=body.expiry_hours
        )
    else:
        logger.info("Permanent share — no expiry set")

    # Check if file needs binary extraction (PDF, images, Office docs, audio/video, etc.)
    url_path = urlparse(body.s3_signed_url).path.lower()
    _BINARY_EXTENSIONS = [
        ".pdf",
        ".docx",
        ".xlsx",
        ".pptx",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".bmp",
        ".msg",
        ".mp3",
        ".mp4",
        ".wav",
        ".flac",
        ".ogg",
        ".amr",
        ".webm",
        ".m4a",
    ]
    needs_extraction = any(url_path.endswith(ext) for ext in _BINARY_EXTENSIONS)

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
    if body.kb_id:
        item["kb_id"] = body.kb_id
    if body.allowed_ips:
        item["allowed_ips"] = body.allowed_ips

    # Determine chat_status: content readiness for AI chat
    chat_status = "ready"
    start_extraction = False  # fire extract-content after the share row is persisted

    if needs_extraction:
        # Check if the Files system already extracted this document.
        # The extraction Lambda stores output at {input_key}.json in the same bucket.
        existing_text = _try_read_existing_extraction(s3_bucket, s3_key, share_uuid)

        if existing_text:
            # Reuse existing extraction — store text in S3 and mark chat ready
            text_key = f"shared/{share_uuid}/document_text.txt"
            s3 = get_s3_client()
            s3.put_object(
                Bucket=s3_bucket,
                Key=text_key,
                Body=existing_text.encode("utf-8"),
                ContentType="text/plain; charset=utf-8",
            )
            item["document_text_key"] = text_key
            chat_status = "ready"
            logger.info(
                "Share created (reused existing extraction)",
                uuid=share_uuid,
                text_length=len(existing_text),
            )
        else:
            # No existing extraction — fire extract-content ourselves (below,
            # once the row is persisted). It writes {s3_key}.json (Document JSON)
            # plus a .status.json beside it; get_share_info / chat poll for that
            # output via _try_read_existing_extraction and flip chat_status to
            # "ready" the moment it lands.
            item["transcription_file_key"] = s3_key
            chat_status = "pending"
            start_extraction = True
            logger.info(
                "Share created (extraction queued, chat pending)",
                _name="SHARE_EXTRACTION_QUEUED",
                uuid=share_uuid,
                transcription_file_key=s3_key,
            )
    else:
        # Non-binary files (text/html/etc.): extract the same way so chat
        # becomes available once the {s3_key}.json output is written.
        item["transcription_file_key"] = s3_key
        chat_status = "pending"
        start_extraction = True
        logger.info(
            "Share created (extraction queued, chat pending)",
            _name="SHARE_EXTRACTION_QUEUED",
            uuid=share_uuid,
            transcription_file_key=s3_key,
        )

    # Record where extraction output / its FAILED status sidecar will land, so the
    # pending read paths (get_share_info, chat) can detect both SUCCEEDED and FAILED.
    if start_extraction:
        item["extraction_output_key"] = f"{s3_key}.json"

    # Share is always viewable immediately
    item["status"] = "ready"
    item["chat_status"] = chat_status

    table = get_dynamodb_table()
    table.put_item(Item=item)

    # Fire extraction now that the share row exists, so any error-status update
    # from _start_async_extraction targets a persisted item. The extract-content
    # Lambda writes {s3_key}.json + .status.json; get_share_info / chat poll for
    # {s3_key}.json and flip chat_status to "ready" once it lands. Previously this
    # call was missing entirely, so non-pre-extracted docs hung at "pending".
    if start_extraction:
        _start_async_extraction(share_uuid, s3_bucket, s3_key, f"{s3_key}.json")

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
        chat_status=chat_status,
    )

    return CreateShareResponse(
        uuid=share_uuid,
        expires_at=expires_at,
        status="ready",
        chat_status=chat_status,
    )


def get_client_name() -> str:
    """Extract client name from table name (numa-{client}-shared)."""
    if SHARED_TABLE_NAME:
        parts = SHARED_TABLE_NAME.replace("numa-", "").replace("-shared", "")
        return parts
    return ""


@app.post("/api/shared/create-dropzone")
async def create_dropzone(
    body: CreateDropZoneRequest,
    authorization: str | None = Header(None),
):
    """Create a new drop zone (authenticated endpoint).

    A drop zone is a shared folder that external users can upload files to.
    Unlike document shares, drop zones don't require file extraction.
    """
    user_id = validate_jwt(authorization)
    share_uuid = str(uuid4())

    expiry: int | None = None
    if body.expiry_hours is not None:
        expiry = int(time.time()) + (body.expiry_hours * 3600)

    client_name = get_client_name()

    item: Dict[str, Any] = {
        "uuid": share_uuid,
        "share_type": "dropzone",
        "status": "ready",
        "folder_path": body.folder_path,
        "s3_folder_prefix": body.s3_folder_prefix,
        "instructions": body.instructions,
        "auth_mode": body.auth_mode,
        "enable_api": body.enable_api,
        "enable_chat": body.enable_chat,
        "upload_count": 0,
        "used_quota_mb": Decimal("0"),
        "uploaded_files": [],
        "call_count": 0,
        "view_count": 0,
        "created_at": int(time.time()),
        "created_by": user_id,
        "client_name": client_name,
        # Store bucket/key info for consistency with document shares
        "s3_bucket": (
            DATA_BUCKET_NAME.split(":")[-1]
            if DATA_BUCKET_NAME.startswith("arn:")
            else DATA_BUCKET_NAME
        ),
        "s3_key": body.s3_folder_prefix,
    }

    if expiry is not None:
        item["expiry"] = expiry
    if body.description:
        item["description"] = body.description
    if body.max_file_size_mb is not None:
        item["max_file_size_mb"] = body.max_file_size_mb
    if body.total_quota_mb is not None:
        item["total_quota_mb"] = body.total_quota_mb
    if body.allowed_extensions:
        item["allowed_extensions"] = body.allowed_extensions

    if body.max_calls is not None:
        item["max_calls"] = body.max_calls
    if body.kb_id:
        item["kb_id"] = body.kb_id
    if body.allowed_ips:
        item["allowed_ips"] = body.allowed_ips

    # Hash and store passcode (keep plain copy for owner display)
    if body.auth_mode == "passcode" and body.passcode:
        item["passcode_hash"] = _hash_passcode(body.passcode)
        item["passcode_plain"] = body.passcode

    table = get_dynamodb_table()
    table.put_item(Item=item)

    expires_at = (
        datetime.fromtimestamp(expiry, tz=timezone.utc).isoformat()
        if expiry is not None
        else None
    )

    logger.info(
        "Drop zone created",
        uuid=share_uuid,
        folder_path=body.folder_path,
        auth_mode=body.auth_mode,
        expires_at=expires_at or "permanent",
        created_by=user_id,
    )

    return {
        "uuid": share_uuid,
        "expires_at": expires_at,
        "status": "ready",
        "share_type": "dropzone",
    }


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

        share_type = item.get("share_type", "document")

        if share_type == "dropzone":
            name = item.get("description") or item.get("folder_path", "/")
            if name == "/":
                name = "Drop Zone"
        else:
            s3_key = item.get("s3_key", "")
            name = s3_key.split("/")[-1] if "/" in s3_key else "Shared document"

        expires_at = (
            datetime.fromtimestamp(expiry, tz=timezone.utc).isoformat()
            if expiry is not None
            else None
        )

        # Build dropzone-specific fields
        dropzone_fields: dict = {}
        if share_type == "dropzone":
            dropzone_fields = {
                "upload_count": int(item.get("upload_count", 0)),
                "total_quota_mb": (
                    int(item["total_quota_mb"])
                    if item.get("total_quota_mb") is not None
                    else None
                ),
                "used_quota_mb": float(item.get("used_quota_mb", 0)),
                "folder_path": item.get("folder_path", "/"),
                "auth_mode": item.get("auth_mode", "none"),
                "passcode": item.get("passcode_plain"),
                "max_calls": (
                    int(item["max_calls"])
                    if item.get("max_calls") is not None
                    else None
                ),
            }

        share_item = ShareListItem(
            uuid=item["uuid"],
            name=name,
            description=item.get("description", "") or "",
            status=item.get("status", "ready"),
            created_at=(float(item["created_at"]) if item.get("created_at") else None),
            expires_at=expires_at,
            call_count=int(item.get("call_count", 0)),
            view_count=int(item.get("view_count", 0)),
            enable_chat=item.get("enable_chat", True),
            allow_download=item.get("allow_download", True),
            share_type=share_type,
            **dropzone_fields,
        )
        shares.append(share_item)

    return {"shares": shares}


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


@app.get("/api/shared/{uuid}")
async def get_share_info(uuid: str, request: Request):
    """Get share information (public endpoint)."""
    share = get_share(uuid)

    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    _check_ip_allowlist(share, request)

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

    # Check if this is a drop zone — return early before document-specific logic
    share_type = share.get("share_type", "document")

    if share_type == "dropzone":
        # Return dropzone-specific response (no document URL needed)
        return {
            "uuid": uuid,
            "share_type": "dropzone",
            "status": status,
            "expires_at": expires_at,
            "client_name": client_name,
            "description": share.get("description"),
            "instructions": share.get("instructions", ""),
            "auth_mode": share.get("auth_mode", "none"),
            "enable_chat": share.get("enable_chat", False),
            "enable_api": share.get("enable_api", True),
            "folder_path": share.get("folder_path", "/"),
            "upload_count": int(share.get("upload_count", 0)),
            "max_file_size_mb": (
                int(share["max_file_size_mb"])
                if share.get("max_file_size_mb") is not None
                else None
            ),
            "total_quota_mb": (
                int(share["total_quota_mb"])
                if share.get("total_quota_mb") is not None
                else None
            ),
            "used_quota_mb": float(share.get("used_quota_mb", 0)),
            "allowed_extensions": share.get("allowed_extensions"),
            "view_count": int(share.get("view_count", 0)),
            "max_calls": (
                int(share["max_calls"]) if share.get("max_calls") is not None else None
            ),
            "call_count": int(share.get("call_count", 0)),
        }

    # ── Document share logic (extraction check + URL generation) ──

    # Determine chat_status (default "ready" for backward compat)
    chat_status = share.get("chat_status", "ready")

    # Legacy shares: if status is "processing" (old extraction path), check completion
    if status == "processing":
        result = _check_and_complete_extraction(share)
        if result:
            status = "ready"
            chat_status = "ready"

    # New shares: if chat_status is "pending", poll the extraction output. This
    # flips to "ready" on success and "error" on a FAILED extraction (otherwise
    # stays "pending"); _resolve_pending_extraction mutates `share` accordingly.
    if chat_status == "pending":
        chat_status, _ = _resolve_pending_extraction(share)
        status = str(share.get("status", status))

    # Regenerate a fresh pre-signed URL if we have bucket/key stored
    s3_bucket = share.get("s3_bucket")
    s3_key = share.get("s3_key")

    if s3_bucket and s3_key:
        try:
            # Cap URL TTL at share's remaining time so URLs don't outlive the share
            url_ttl = 3600
            if expiry is not None:
                remaining = int(expiry - time.time())
                url_ttl = max(min(remaining, 3600), 60)
            fresh_url = generate_fresh_signed_url(s3_bucket, s3_key, expires_in=url_ttl)
            logger.info("Regenerated fresh pre-signed URL", uuid=uuid, url_ttl=url_ttl)
        except Exception as e:
            logger.warning(
                "Failed to regenerate URL, falling back to stored URL",
                uuid=uuid,
                error=str(e),
            )
            fresh_url = share.get("s3_signed_url", "")
    else:
        # Legacy share without bucket/key — use stored URL (may be expired)
        logger.warning(
            "Legacy share without s3_bucket/s3_key, using stored URL", uuid=uuid
        )
        fresh_url = share.get("s3_signed_url", "")

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
        chat_status=chat_status,
        description=share.get("description"),
        enable_chat=enable_chat,
        allow_download=allow_download,
        max_calls=(
            int(share["max_calls"]) if share.get("max_calls") is not None else None
        ),
        call_count=int(share.get("call_count", 0)),
        error_message=(
            share.get("error_message")
            if status == "error" or chat_status == "error"
            else None
        ),
    )


def get_bedrock_kb_client():
    """Get Bedrock Agent Runtime client for KB retrieval with PRM tracking."""
    global _bedrock_kb_client  # pylint: disable=global-statement
    if _bedrock_kb_client is None:
        _bedrock_kb_client = prm_client("bedrock-agent-runtime", region=REGION)
    return _bedrock_kb_client


def query_knowledge_base(query: str, kb_id: str, max_results: int = 5) -> str:
    """Query Bedrock KB with tenant+kb_id filter.

    Returns combined text from retrieval results, or empty string on failure.
    Falls back silently so chat can continue with document-only context.
    """
    if not BEDROCK_KNOWLEDGE_BASE_ID or not CLIENT_NAME:
        return ""
    try:
        kb_client = get_bedrock_kb_client()
        resp = kb_client.retrieve(
            knowledgeBaseId=BEDROCK_KNOWLEDGE_BASE_ID,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": max_results,
                    "filter": {
                        "andAll": [
                            {"equals": {"key": "tenant_id", "value": CLIENT_NAME}},
                            {"equals": {"key": "kb_id", "value": kb_id}},
                        ]
                    },
                }
            },
        )
        pieces = [
            item["content"]["text"]
            for item in resp.get("retrievalResults", [])
            if item.get("content", {}).get("text")
        ]
        return "\n\n".join(pieces)
    except Exception as e:
        logger.error(
            "KB retrieval failed, falling back to doc-only", error=str(e), kb_id=kb_id
        )
        return ""


@app.post("/api/shared/{uuid}/generate-description")
async def generate_description(uuid: str, request: Request):
    """Generate an AI description for a shared document (public endpoint).

    Requires chat_status="ready" so that document text is available.
    Uses Bedrock Nova Lite to produce a brief 1-2 sentence description.
    """
    share = get_share(uuid)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    _check_ip_allowlist(share, request)

    # Check expiry
    raw_expiry = share.get("expiry")
    expiry = int(raw_expiry) if raw_expiry is not None else None
    if expiry is not None and time.time() > expiry:
        raise HTTPException(status_code=410, detail="Share expired")

    # Document text must be available
    chat_status = share.get("chat_status", "ready")
    status = share.get("status", "ready")
    if chat_status == "pending" or status == "processing":
        raise HTTPException(
            status_code=202,
            detail="Document is still being processed. Description cannot be generated yet.",
        )

    # Load document text
    try:
        document_text = _load_document_text(share)
    except Exception as e:
        logger.error(
            "Failed to load document text for description", uuid=uuid, error=str(e)
        )
        raise HTTPException(
            status_code=500, detail="Could not load document text"
        ) from e

    if not document_text:
        raise HTTPException(status_code=400, detail="No document text available")

    # Generate description via Bedrock
    prompt = (
        "Write a brief 1-2 sentence description of the following document content, "
        "suitable for sharing with someone. Be concise and descriptive. "
        "Only output the description text, nothing else.\n\n"
        f"Document content:\n{document_text[:8000]}"
    )

    try:
        bedrock = get_bedrock_client()
        response = bedrock.converse(
            modelId=MODEL_ID,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 200, "temperature": 0.3},
        )

        output = response.get("output", {})
        message = output.get("message", {})
        content = message.get("content", [])
        description = content[0].get("text", "").strip() if content else ""

        if not description:
            raise HTTPException(status_code=500, detail="Empty description generated")

        # Update the share record with the generated description
        table = get_dynamodb_table()
        table.update_item(
            Key={"uuid": uuid},
            UpdateExpression="SET description = :d",
            ExpressionAttributeValues={":d": description},
        )

        logger.info("Description generated", uuid=uuid, length=len(description))
        return {"description": description}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Description generation failed", uuid=uuid, error=str(e))
        raise HTTPException(
            status_code=500, detail="Failed to generate description"
        ) from e


@app.post("/api/shared/{uuid}/chat")
async def chat(uuid: str, body: ChatRequest, request: Request):
    """Stream chat response for a share (public endpoint)."""
    from .chat_history import (  # pylint: disable=import-outside-toplevel
        SharedChatHistory,
    )

    document_text = ""
    share = get_share(uuid)

    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    _check_ip_allowlist(share, request)

    # Check if chat is enabled for this share
    if not share.get("enable_chat", True):
        raise HTTPException(status_code=403, detail="Chat is disabled for this share")

    # Check expiry only if set (permanent shares have no expiry field)
    raw_expiry = share.get("expiry")
    expiry = int(raw_expiry) if raw_expiry is not None else None

    if expiry is not None and time.time() > expiry:
        raise HTTPException(status_code=410, detail="Share expired")

    # For drop zones, use instructions as the document context
    share_type = share.get("share_type", "document")
    is_dropzone = share_type == "dropzone"

    if is_dropzone:
        # Drop zones use instructions + description as the "document"
        instructions = share.get("instructions", "")
        description = share.get("description", "")
        if description and instructions:
            document_text = (
                f"Description: {description}\n\nUpload Instructions:\n{instructions}"
            )
        elif description:
            document_text = f"Description: {description}"
        else:
            document_text = instructions
        if not document_text:
            raise HTTPException(
                status_code=400, detail="No instructions configured for this drop zone"
            )
        # Use a specialized system prompt for drop zone instruction chat
        system_prompt = (
            "You are a helpful assistant answering questions about upload instructions "
            "for a file drop zone. Help the user understand what files they need to "
            "upload, any requirements or formatting guidelines, and answer any questions "
            "about the process. Be concise and friendly."
        )
    else:
        system_prompt = share.get(
            "system_prompt",
            "You are a helpful assistant that answers questions about the shared document.",
        )

    # Check extraction/chat status before allowing chat (document shares only)
    if not is_dropzone:
        status = share.get("status", "ready")
        chat_status = share.get("chat_status", "ready")

        # Legacy shares: check old extraction path
        if status == "processing":
            result = _check_and_complete_extraction(share)
            if not result:
                raise HTTPException(
                    status_code=202, detail="Document is still being processed"
                )
            document_text = result
        elif status == "error":
            raise HTTPException(
                status_code=502,
                detail=share.get("error_message", "Document extraction failed"),
            )
        # New shares: poll the extraction output (ready / failed / still pending)
        elif chat_status == "pending":
            resolved, resolved_text = _resolve_pending_extraction(share)
            if resolved == "ready":
                document_text = resolved_text or ""
            elif resolved == "error":
                raise HTTPException(
                    status_code=502,
                    detail=share.get("error_message", "Document extraction failed"),
                )
            else:
                raise HTTPException(
                    status_code=202,
                    detail="Document is still being processed for chat",
                )
        elif chat_status == "error":
            raise HTTPException(
                status_code=502,
                detail=share.get("error_message", "Document processing failed"),
            )
        else:
            # Ready state — load document text (from S3 for large docs, DynamoDB for small)
            document_text = _load_document_text(share)

    # Check max_calls limit if set
    max_calls = share.get("max_calls")
    call_count = int(share.get("call_count", 0))
    if max_calls is not None and call_count >= int(max_calls):
        raise HTTPException(status_code=429, detail="Call limit reached")

    if not document_text and not is_dropzone:
        # Fallback: extract on first request for legacy shares without pre-extracted text
        logger.warning(
            "No pre-extracted document_text, falling back to lazy extraction",
            uuid=uuid,
        )
        # For shares with bucket/key, regenerate URL before extraction
        s3_bucket = str(share.get("s3_bucket", ""))
        s3_key = str(share.get("s3_key", ""))
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

            # Add current query with document/instructions context
            if is_dropzone:
                context_label = "Upload Instructions"
            else:
                context_label = "Document"

            # Optionally augment with KB context
            kb_id = share.get("kb_id")
            kb_context = ""
            if kb_id:
                kb_context = query_knowledge_base(body.query, kb_id)

            if kb_context:
                user_text = (
                    f"{context_label}:\n\n{document_text}\n\n---\n\n"
                    f"Additional Knowledge Base Context:\n\n{kb_context}\n\n---\n\n"
                    f"Question: {body.query}"
                )
            else:
                user_text = f"{context_label}:\n\n{document_text}\n\n---\n\nQuestion: {body.query}"

            messages.append(
                {
                    "role": "user",
                    "content": [{"text": user_text}],
                }
            )

            # Call Nova with streaming
            bedrock = get_bedrock_client()
            response = bedrock.converse_stream(
                modelId=MODEL_ID,
                system=[{"text": system_prompt}],
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


@app.post("/api/shared/{uuid}/auth")
async def dropzone_auth(uuid: str, body: DropZoneAuthRequest, request: Request):
    """Authenticate to a drop zone (public endpoint).

    Verifies the passcode and returns a short-lived token.
    """
    share = get_share(uuid)
    if not share:
        raise HTTPException(status_code=404, detail="Drop zone not found")

    _check_ip_allowlist(share, request)

    if share.get("share_type") != "dropzone":
        raise HTTPException(status_code=400, detail="Not a drop zone")

    # Check expiry
    raw_expiry = share.get("expiry")
    expiry = int(raw_expiry) if raw_expiry is not None else None
    if expiry is not None and time.time() > expiry:
        raise HTTPException(status_code=410, detail="Drop zone expired")

    auth_mode = share.get("auth_mode", "none")
    if auth_mode == "none":
        # No auth needed, return token immediately
        token = _create_dropzone_token(uuid)
        return {"token": token, "expires_in": 3600}

    if auth_mode == "passcode":
        stored_hash = share.get("passcode_hash", "")
        if not stored_hash or not _verify_passcode(body.passcode, stored_hash):
            raise HTTPException(status_code=401, detail="Invalid passcode")

        token = _create_dropzone_token(uuid)
        logger.info("Drop zone passcode auth successful", uuid=uuid)
        return {"token": token, "expires_in": 3600}

    raise HTTPException(status_code=400, detail=f"Unsupported auth mode: {auth_mode}")


@app.post("/api/shared/{uuid}/upload")
async def dropzone_upload(
    uuid: str,
    body: DropZoneUploadRequest,
    request: Request,
    authorization: str | None = Header(None),
):
    """Request a presigned upload URL for a drop zone (public with optional auth).

    Validates quotas, file size limits, and allowed extensions before
    generating a presigned PUT URL.
    """
    share = get_share(uuid)
    if not share:
        raise HTTPException(status_code=404, detail="Drop zone not found")

    _check_ip_allowlist(share, request)

    if share.get("share_type") != "dropzone":
        raise HTTPException(status_code=400, detail="Not a drop zone")

    # Check expiry
    raw_expiry = share.get("expiry")
    expiry = int(raw_expiry) if raw_expiry is not None else None
    if expiry is not None and time.time() > expiry:
        raise HTTPException(status_code=410, detail="Drop zone expired")

    # Check authentication
    _check_dropzone_auth(share, authorization)

    # Validate file size
    max_file_size_mb = share.get("max_file_size_mb")
    if max_file_size_mb is not None:
        max_bytes = int(max_file_size_mb) * 1024 * 1024
        if body.size_bytes > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds {max_file_size_mb} MB limit",
            )

    # Validate quota
    total_quota_mb = share.get("total_quota_mb")
    if total_quota_mb is not None:
        used_mb = float(share.get("used_quota_mb", 0))
        new_mb = body.size_bytes / (1024 * 1024)
        if used_mb + new_mb > float(total_quota_mb):
            raise HTTPException(status_code=413, detail="Upload quota exceeded")

    # Validate file extension
    allowed_extensions = share.get("allowed_extensions")
    if allowed_extensions:
        ext = (
            "." + body.filename.rsplit(".", 1)[-1].lower()
            if "." in body.filename
            else ""
        )
        if ext and ext not in [e.lower().strip() for e in allowed_extensions]:
            raise HTTPException(
                status_code=400,
                detail=f"File type not allowed. Accepted: {', '.join(allowed_extensions)}",
            )

    # Generate presigned upload URL
    s3_folder_prefix = share.get("s3_folder_prefix", "")
    file_id = str(uuid4())

    # Sanitize filename — strip path components to prevent traversal
    safe_filename = (
        body.filename.replace("/", "").replace("\\", "").replace("..", "").strip()
    )
    if not safe_filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    s3_key = f"{s3_folder_prefix.rstrip('/')}/{safe_filename}"
    bucket = share.get("s3_bucket") or DATA_BUCKET_NAME
    # Strip ARN prefix if present — bucket name must be plain name, not arn:aws:s3:::name
    if bucket and bucket.startswith("arn:"):
        bucket = bucket.split(":")[-1]

    if not bucket:
        logger.error(
            "Storage not configured",
            uuid=uuid,
            s3_bucket=share.get("s3_bucket"),
            data_bucket=DATA_BUCKET_NAME,
        )
        raise HTTPException(status_code=500, detail="Storage not configured")

    try:
        s3 = get_s3_client()
        presigned_url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": bucket,
                "Key": s3_key,
                "ContentType": body.content_type,
            },
            ExpiresIn=3600,
        )
    except Exception as e:
        logger.error(
            "Failed to generate presigned upload URL",
            uuid=uuid,
            bucket=bucket,
            s3_key=s3_key,
            error=str(e),
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to generate upload URL: {e}"
        ) from e

    logger.info(
        "Drop zone upload URL generated",
        uuid=uuid,
        file_id=file_id,
        filename=safe_filename,
        s3_key=s3_key,
        bucket=bucket,
    )

    return {
        "upload_url": presigned_url,
        "file_id": file_id,
        "s3_key": s3_key,
        "expires_in": 3600,
    }


@app.post("/api/shared/{uuid}/upload/confirm")
async def dropzone_upload_confirm(
    uuid: str,
    body: DropZoneUploadConfirmRequest,
    request: Request,
    authorization: str | None = Header(None),
):
    """Confirm a completed upload to a drop zone (public with optional auth).

    Updates the upload counter, quota usage, and uploaded files list.
    """
    share = get_share(uuid)
    if not share:
        raise HTTPException(status_code=404, detail="Drop zone not found")

    _check_ip_allowlist(share, request)

    if share.get("share_type") != "dropzone":
        raise HTTPException(status_code=400, detail="Not a drop zone")

    # Check authentication
    _check_dropzone_auth(share, authorization)

    size_mb = Decimal(str(body.size_bytes / (1024 * 1024)))

    table = get_dynamodb_table()
    try:
        table.update_item(
            Key={"uuid": uuid},
            UpdateExpression=(
                "SET upload_count = if_not_exists(upload_count, :zero) + :inc, "
                "used_quota_mb = if_not_exists(used_quota_mb, :zero_d) + :size_mb, "
                "uploaded_files = list_append(if_not_exists(uploaded_files, :empty_list), :new_file)"
            ),
            ExpressionAttributeValues={
                ":zero": 0,
                ":inc": 1,
                ":zero_d": Decimal("0"),
                ":size_mb": size_mb,
                ":empty_list": [],
                ":new_file": [
                    {
                        "file_id": body.file_id,
                        "name": body.filename,
                        "size_bytes": body.size_bytes,
                        "uploaded_at": int(time.time()),
                    }
                ],
            },
        )
    except Exception as e:
        logger.error("Failed to confirm upload", uuid=uuid, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to register upload")

    # Get updated quota
    updated_share = get_share(uuid) or share
    used_quota_mb = float(updated_share.get("used_quota_mb", 0))
    total_quota_mb = (
        int(updated_share["total_quota_mb"])
        if updated_share.get("total_quota_mb") is not None
        else None
    )

    logger.info(
        "Drop zone upload confirmed",
        uuid=uuid,
        filename=body.filename,
        size_mb=float(size_mb),
        used_quota_mb=used_quota_mb,
    )

    return {
        "status": "confirmed",
        "used_quota_mb": used_quota_mb,
        "total_quota_mb": total_quota_mb,
    }


@app.get("/api/shared/{uuid}/files")
async def dropzone_files(
    uuid: str,
    request: Request,
    authorization: str | None = Header(None),
):
    """List uploaded files in a drop zone (public with optional auth)."""
    share = get_share(uuid)
    if not share:
        raise HTTPException(status_code=404, detail="Drop zone not found")

    _check_ip_allowlist(share, request)

    if share.get("share_type") != "dropzone":
        raise HTTPException(status_code=400, detail="Not a drop zone")

    # Check expiry
    raw_expiry = share.get("expiry")
    expiry = int(raw_expiry) if raw_expiry is not None else None
    if expiry is not None and time.time() > expiry:
        raise HTTPException(status_code=410, detail="Drop zone expired")

    # Check authentication
    _check_dropzone_auth(share, authorization)

    uploaded_files = share.get("uploaded_files", [])

    # Convert DynamoDB types
    files = []
    for f in uploaded_files:
        files.append(
            {
                "file_id": f.get("file_id", ""),
                "name": f.get("name", ""),
                "size_bytes": int(f.get("size_bytes", 0)),
                "uploaded_at": int(f.get("uploaded_at", 0)),
            }
        )

    return {
        "files": files,
        "quota": {
            "used_mb": float(share.get("used_quota_mb", 0)),
            "total_mb": (
                int(share["total_quota_mb"])
                if share.get("total_quota_mb") is not None
                else None
            ),
        },
    }


@app.delete("/api/shared/{uuid}")
async def delete_share(uuid: str, authorization: str | None = Header(None)):
    """Delete a share or drop zone (authenticated, owner-only)."""
    user_id = validate_jwt(authorization)

    share = get_share(uuid)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    # Only the creator can delete
    if share.get("created_by") != user_id:
        raise HTTPException(
            status_code=403, detail="Not authorized to delete this share"
        )

    table = get_dynamodb_table()
    table.delete_item(Key={"uuid": uuid})

    # Also clean up chat history
    try:
        from .chat_history import (  # pylint: disable=import-outside-toplevel
            get_chat_history_table,
        )

        history_table = get_chat_history_table()
        # Query all items for this share
        response = history_table.query(
            KeyConditionExpression="uuid = :uuid",
            ExpressionAttributeValues={":uuid": uuid},
            ProjectionExpression="uuid, sk",
        )
        # Batch delete chat history items
        with history_table.batch_writer() as batch:
            for item in response.get("Items", []):
                batch.delete_item(Key={"uuid": item["uuid"], "sk": item["sk"]})
    except Exception as e:
        # Non-fatal — share is already deleted
        logger.warning("Failed to clean up chat history", uuid=uuid, error=str(e))

    logger.info(
        "Share deleted",
        uuid=uuid,
        share_type=share.get("share_type", "document"),
        deleted_by=user_id,
    )

    return {"status": "deleted", "uuid": uuid}


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
