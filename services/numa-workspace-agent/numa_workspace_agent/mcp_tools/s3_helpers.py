"""
Shared S3 helpers for workspace file operations.

Extracted from extract_content.py and convert_document.py so the unified
numa_tool MCP tool can reuse the same S3 upload/download logic.
"""

import os
import shutil
import urllib.error
import urllib.request
from pathlib import Path

import structlog

logger = structlog.get_logger()

# S3 path configuration (must match Lambda's expectations)
S3_PREFIX = "numa-chat/workspace"
WORKSPACE_ROOT = "/workdir"


def get_relative_path(file_path: str) -> str:
    """Extract relative path from absolute workspace path."""
    if file_path.startswith(WORKSPACE_ROOT + "/"):
        return file_path[len(WORKSPACE_ROOT) + 1 :]
    return file_path


def get_s3_key_for_file(rel_path: str, user_sub: str, conversation_id: str) -> str:
    """Determine the S3 key for a workspace file.

    chat-workflows/ is globally persistent (not scoped to conversation).
    Everything else is conversation-scoped.
    """
    if rel_path.startswith("chat-workflows/"):
        return f"{S3_PREFIX}/{user_sub}/{rel_path}"
    return f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/{rel_path}"


def _get_s3_client():
    """Create an S3 client using local account credentials."""
    import boto3

    session = boto3.Session(
        aws_access_key_id=os.environ.get("NUMA_LOCAL_AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("NUMA_LOCAL_AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("NUMA_LOCAL_AWS_SESSION_TOKEN"),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )
    return session.client("s3")


def ensure_file_in_s3(file_path: str, user_sub: str, conversation_id: str) -> None:
    """Upload local file to S3 if it doesn't exist there yet.

    This handles files created locally during the same chat session that haven't
    been synced to S3 yet (sync happens after chat completes, but tools need
    files in S3 during the chat).
    """
    if not os.path.exists(file_path):
        return  # Nothing to upload, let Lambda handle the error

    outputs_bucket = os.environ.get("OUTPUTS_BUCKET_NAME", "")
    if not outputs_bucket:
        return  # Can't upload without bucket

    rel_path = get_relative_path(file_path)
    s3_key = get_s3_key_for_file(rel_path, user_sub, conversation_id)

    s3_client = _get_s3_client()

    # Check if already exists in S3
    try:
        from botocore.exceptions import ClientError

        s3_client.head_object(Bucket=outputs_bucket, Key=s3_key)
        return  # Already exists
    except ClientError as e:
        if e.response["Error"]["Code"] != "404":
            raise  # Some other error, re-raise

    # Upload local file to S3
    with open(file_path, "rb") as f:
        s3_client.put_object(Bucket=outputs_bucket, Key=s3_key, Body=f.read())


def download_from_s3(bucket: str, s3_key: str, local_path: str) -> None:
    """Download a file from S3 to a local path.

    Args:
        bucket: S3 bucket name
        s3_key: S3 object key
        local_path: Local filesystem path to write to
    """
    path = Path(local_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    s3_client = _get_s3_client()
    s3_client.download_file(bucket, s3_key, str(path))


def download_from_presigned_url(
    url: str, dest_path: str, expected_size: int = 0
) -> int:
    """Download a file from a presigned S3 URL to a local path.

    Uses urllib.request (stdlib) to stream the download.

    Args:
        url: Presigned S3 GET URL
        dest_path: Local file path to write to
        expected_size: Expected file size in bytes (for logging; 0 = unknown)

    Returns:
        Number of bytes written
    """
    path = Path(dest_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with urllib.request.urlopen(url) as response:
            with open(path, "wb") as out_file:
                shutil.copyfileobj(response, out_file)

        return path.stat().st_size

    except urllib.error.HTTPError as e:
        raise ValueError(
            f"Failed to download from presigned URL: HTTP {e.code} {e.reason}. "
            "The URL may have expired (5 minute window). Try the download again."
        ) from e
    except urllib.error.URLError as e:
        raise ValueError(
            f"Failed to download from presigned URL: {e.reason}. "
            "Check network connectivity."
        ) from e
    except Exception as e:
        # Clean up partial download
        if path.exists():
            path.unlink()
        raise ValueError(f"Failed to download file: {str(e)}") from e
