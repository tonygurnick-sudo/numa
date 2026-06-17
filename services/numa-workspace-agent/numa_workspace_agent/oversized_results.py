"""
Lossless resolution of oversized tool-result spillover envelopes.

The workspace-chat-tools Lambda (and pipedream-proxy) cap synchronous response
payloads at ~5 MiB to stay under AWS's hard 6 MB invoke limit. When a structured
tool result exceeds the budget, the FULL result JSON is written to S3 and the
Lambda returns a fixed envelope instead:

    {"status": "success", "oversized": true,
     "result_url": "<presigned GET>", "result_sha256": "<hex>",
     "result_size": <int>, "note": "..."}

This module resolves that envelope back into the complete result: stream the
presigned URL to disk, verify sha256 (and size when supplied), parse, return.
Nothing is truncated or sampled; on any failure we raise rather than hand back
unverified or partial data.

History: this logic lived in mcp_tools/lambda_client.py, which was deleted with
the MCP layer in the numa-CLI migration. Any agent-side code that consumes a
workspace-chat-tools result directly (e.g. the KB listings fetch in main.py)
must route it through resolve_oversized_result(). The numa CLI has its own
TypeScript implementation of the same contract for results it receives.
"""

import json
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any

import structlog
from numa_workspace_agent.atomic_io import FileIntegrityError, atomic_download_url

logger = structlog.get_logger()


class OversizedResultIntegrityError(Exception):
    """Raised when a spilled oversized tool result fails sha256 verification.

    The destination MUST NOT use unverified bytes: a sha256 mismatch means the
    object behind ``result_url`` is not the result the producer hashed (truncated
    transfer, wrong object, corruption). We hard-fail rather than hand the model a
    silently-wrong result — that is the verification half of the 100% bar.
    """


def _fetch_and_verify_oversized(envelope: dict[str, Any]) -> Any:
    """Resolve a ``{"oversized": true, ...}`` spillover envelope losslessly.

    1. Download the exact bytes at ``result_url`` (streamed, hashed as we go).
    2. Verify the streamed sha256 == ``result_sha256`` — hard-fail on mismatch.
    3. Verify the byte count == ``result_size`` when the producer supplied one.
    4. Parse the verified bytes as JSON and return the COMPLETE result.
    """
    result_url = envelope.get("result_url")
    expected_sha = envelope.get("result_sha256")
    expected_size = envelope.get("result_size")

    if not result_url or not expected_sha:
        # Malformed envelope from a producer that set oversized=true but omitted
        # the pointer/hash. We cannot recover the result safely — fail loudly.
        raise OversizedResultIntegrityError(
            "Oversized tool result envelope missing result_url/result_sha256; "
            "cannot fetch or verify the full result."
        )

    # Only enforce the size check when the producer supplied a usable count
    # (int >= 0) — tolerate missing/negative sizes.
    size_check = (
        expected_size if isinstance(expected_size, int) and expected_size >= 0 else None
    )
    # Spill to the system temp dir (writable everywhere) rather than /workdir:
    # this blob is ephemeral scratch parsed and deleted immediately, and must not
    # appear in the user's workspace nor depend on /workdir being mounted.
    tmp_path = Path(tempfile.gettempdir()) / f"oversized-result-{uuid.uuid4().hex}.json"
    # Do NOT log result_url — it is a presigned bearer token.
    try:
        total = atomic_download_url(
            result_url,
            tmp_path,
            expected_sha256=expected_sha,
            expected_size=size_check,
        )
    except FileIntegrityError as e:
        # atomic_io already discarded the temp file on mismatch. Re-raise as
        # this module's stable exception name so callers/tests keep one type.
        raise OversizedResultIntegrityError(
            "Oversized tool result failed integrity verification: "
            f"{e} Refusing to use unverified or possibly-truncated bytes."
        ) from e

    try:
        with open(tmp_path, "rb") as f:
            body = f.read()
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    logger.info(
        "Resolved oversized tool result losslessly",
        _name="OVERSIZED_RESULT_VERIFIED",
        result_size=total,
        result_sha256=expected_sha,
    )

    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise OversizedResultIntegrityError(
            f"Oversized tool result passed sha256 but is not valid JSON: {e}"
        ) from e


def resolve_oversized_result(result: Any) -> Any:
    """Return *result* unchanged unless it is an oversized spillover envelope.

    Tolerant/backward-compatible: an older Lambda that never emits the envelope
    returns its result inline, and this is a no-op. A newer Lambda that spilled a
    large result to S3 returns ``{"status":"success","oversized":true,...}`` which
    we resolve into the COMPLETE, sha256-verified result here.
    """
    if (
        isinstance(result, dict)
        and result.get("oversized") is True
        and "result_url" in result
    ):
        return _fetch_and_verify_oversized(result)
    return result
