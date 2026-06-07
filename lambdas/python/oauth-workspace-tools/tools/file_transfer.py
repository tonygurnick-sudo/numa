"""Shared connector-download transfer helpers.

Hex-encoded file content doubles in size and rides inside the Lambda
RequestResponse payload (hard 6 MB cap). Anything larger than the inline
threshold is staged to S3 and handed back as a presigned URL instead of inline
hex, so files up to the 50 MB download cap transfer without silent
truncation/corruption. Files at or below the threshold stay inline (fast path,
fully backward compatible with older workspace-agent readers).

Both download paths use these helpers so the inline-vs-S3 branch and the S3
staging logic live in exactly one place:
  - tools/oauth_tools.py            (Google Drive / OneDrive / Dropbox / ...)
  - tools/connect_tools.py          (Synergy and other native connectors)

The MicroVM reader (services/.../mcp_tools/connect.py) is tolerant of both
shapes: inline `file_content` (hex) or `file_content_url` (presigned GET), and
verifies `content_sha256` end-to-end when present.
"""

from __future__ import annotations

import hashlib
import os
import uuid
from typing import Any, Dict

from prm import client

s3_client = client("s3")

# Staging bucket — env + IAM already wired for the oauth-workspace-tools Lambda.
OUTPUTS_BUCKET = os.environ.get("OUTPUTS_BUCKET_NAME", "")

# 2 MB raw -> 4 MB hex -> safely under the 6 MB Lambda response limit. Larger
# files are staged to S3 and returned as a presigned URL instead of inline hex.
OAUTH_INLINE_MAX = 2 * 1024 * 1024

# Presigned GET lifetime for staged connector downloads (15 min — tolerates a
# slow agent-side fetch without leaving a long-lived bearer URL).
OAUTH_PRESIGNED_EXPIRY = 900


def stage_download_to_s3(
    file_content: bytes, safe_filename: str, user_sub: str, provider: str
) -> Dict[str, Any]:
    """Stage downloaded bytes to S3 and return a presigned GET URL + checksum.

    Avoids hex-encoding large files through the 6 MB Lambda response envelope.
    The object carries an x-amz-checksum-sha256 metadata value so the reader can
    verify end-to-end integrity. Raises if no staging bucket is configured.

    Returns a dict with `file_content_url`, `content_sha256`, `s3_key`.
    """
    if not OUTPUTS_BUCKET:
        raise RuntimeError(
            "File is too large for inline transfer and no staging bucket is "
            "configured (OUTPUTS_BUCKET_NAME). Cannot deliver file."
        )

    sha256 = hashlib.sha256(file_content).hexdigest()
    key = (
        f"numa-chat/connector-downloads/{user_sub}/{uuid.uuid4().hex}/"
        f"{safe_filename}"
    )
    s3_client.put_object(
        Bucket=OUTPUTS_BUCKET,
        Key=key,
        Body=file_content,
        Metadata={"sha256": sha256},
    )
    url = s3_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": OUTPUTS_BUCKET, "Key": key},
        ExpiresIn=OAUTH_PRESIGNED_EXPIRY,
    )
    return {"file_content_url": url, "content_sha256": sha256, "s3_key": key}


def build_download_payload(
    file_content: bytes, safe_filename: str, user_sub: str, provider: str
) -> Dict[str, Any]:
    """Return the transfer fields for a downloaded file (inline hex or S3 URL).

    Small files (<= OAUTH_INLINE_MAX) stay inline as hex with a sha256 checksum.
    Larger files are staged to S3 and returned as a presigned URL + checksum so
    they survive the 6 MB Lambda response cap without truncation/corruption.

    Callers merge the returned dict into their result payload. The emitted keys
    match what the MicroVM reader expects: `file_content` (hex) OR
    `file_content_url`, plus `content_sha256` (and `s3_key` on the S3 path).
    """
    if len(file_content) <= OAUTH_INLINE_MAX:
        return {
            "file_content": file_content.hex(),
            "content_sha256": hashlib.sha256(file_content).hexdigest(),
        }
    return stage_download_to_s3(file_content, safe_filename, user_sub, provider)
