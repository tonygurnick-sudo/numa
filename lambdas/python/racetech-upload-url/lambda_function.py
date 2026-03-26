"""Racetech external data upload — returns a presigned S3 PUT URL.

Security model:
  1. Source IP validated against ALLOWED_IP env var (Glenn's static IP).
     Checked first — costs nothing (no AWS calls).
  2. API key validated against SSM parameter (shared secret with Glenn).
  3. STS assume-role with an inline IP-condition session policy — the presigned
     URL is cryptographically bound to the allowed IP and is useless from any
     other address.

Glenn calls:
  POST /api/racetech/upload
  X-Api-Key: <key>
  {"filename": "server1_daily.sqlite"}

  → {"upload_url": "https://...", "s3_key": "documents/company/racetech-data/server1_daily.sqlite", "expires_in": 3600}

Then uploads:
  curl -X PUT "$upload_url" --upload-file server1_daily.sqlite
"""

from __future__ import annotations

import json
import os
import re

import boto3
import structlog
from botocore.exceptions import ClientError

from prm import client as prm_client

logger = structlog.get_logger()

# ── Environment ──────────────────────────────────────────────────────────────
DATA_BUCKET_NAME: str = os.environ["DATA_BUCKET_NAME"]
ALLOWED_IP: str = os.environ["ALLOWED_IP"]  # 101.100.128.241
UPLOAD_ROLE_ARN: str = os.environ["UPLOAD_ROLE_ARN"]
API_KEY_PARAM: str = os.environ["API_KEY_PARAM"]  # SSM parameter name

UPLOAD_PREFIX = "documents/company/racetech-data/"
PRESIGN_EXPIRES = 3600  # 1 hour

# SSM value cached at module level — survives warm Lambda invocations
_cached_api_key: str | None = None


def _get_api_key() -> str:
    global _cached_api_key
    if _cached_api_key is None:
        ssm = prm_client("ssm")
        _cached_api_key = ssm.get_parameter(Name=API_KEY_PARAM)["Parameter"]["Value"]
    return _cached_api_key


def _resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _valid_filename(name: str) -> bool:
    """Allow only safe filenames — no path separators or shell metacharacters."""
    return bool(re.fullmatch(r"[\w.\-]+", name)) and ".." not in name


def lambda_handler(event: dict, _ctx: object) -> dict:
    # ── 1. IP check (cheapest — no AWS calls) ────────────────────────────────
    source_ip = event.get("requestContext", {}).get("http", {}).get("sourceIp", "")
    if source_ip != ALLOWED_IP:
        logger.warning("Rejected — IP not allowed", source_ip=source_ip)
        return _resp(403, {"error": "Forbidden"})

    # ── 2. API key check ─────────────────────────────────────────────────────
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    try:
        expected = _get_api_key()
    except ClientError:
        logger.exception("SSM key fetch failed")
        return _resp(500, {"error": "Internal error"})

    if headers.get("x-api-key", "") != expected:
        logger.warning("Rejected — bad API key", source_ip=source_ip)
        return _resp(401, {"error": "Unauthorized"})

    # ── 3. Parse body ─────────────────────────────────────────────────────────
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _resp(400, {"error": "Invalid JSON body"})

    filename = body.get("filename", "")
    if not filename or not _valid_filename(filename):
        return _resp(400, {"error": "Invalid or missing 'filename'"})

    s3_key = f"{UPLOAD_PREFIX}{filename}"

    # ── 4. STS assume-role with IP-bound session policy ───────────────────────
    # The session policy is evaluated when S3 processes the presigned PUT request.
    # aws:SourceIp in the session policy means the URL only works from ALLOWED_IP —
    # any attempt from a different IP returns AccessDenied even with a valid URL.
    sts = prm_client("sts")
    session_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": "s3:PutObject",
                "Resource": f"arn:aws:s3:::{DATA_BUCKET_NAME}/{UPLOAD_PREFIX}*",
                "Condition": {"IpAddress": {"aws:SourceIp": f"{ALLOWED_IP}/32"}},
            }
        ],
    }
    try:
        creds = sts.assume_role(
            RoleArn=UPLOAD_ROLE_ARN,
            RoleSessionName="racetech-upload",
            Policy=json.dumps(session_policy),
            DurationSeconds=PRESIGN_EXPIRES + 300,
        )["Credentials"]
    except ClientError:
        logger.exception("STS assume_role failed")
        return _resp(500, {"error": "Internal error"})

    # ── 5. Generate presigned PUT URL ─────────────────────────────────────────
    # Must use the STS-returned credentials directly — prm_client cannot wrap
    # temporary credentials returned as a dict.
    s3 = boto3.client(
        "s3",
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
    )
    url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": DATA_BUCKET_NAME, "Key": s3_key},
        ExpiresIn=PRESIGN_EXPIRES,
    )

    logger.info("Presigned URL issued", s3_key=s3_key, source_ip=source_ip)
    return _resp(
        200,
        {
            "upload_url": url,
            "s3_key": s3_key,
            "expires_in": PRESIGN_EXPIRES,
        },
    )
