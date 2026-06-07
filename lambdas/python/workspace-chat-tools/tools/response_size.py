"""Lossless response-size handling for KB tool handlers.

The workspace agent invokes these tools synchronously via Lambda
``RequestResponse`` (see ``main.py:390-396`` in the workspace agent). AWS caps
a synchronous Lambda response payload at 6 MB. When a tool returns a JSON
result larger than that, the payload is *silently truncated mid-stream* — the
agent then hits a ``JSONDecodeError`` that surfaces as an opaque generic error.

The fix is **lossless presigned spillover**, never truncation. When a tool's
serialized result fits the budget we return it inline (fast path). When it does
*not* fit, we write the **FULL** result JSON to S3, sha256 the exact bytes we
stored, presign a GET URL, and return a small fixed envelope pointing at it::

    {
        "status": "success",
        "oversized": true,
        "result_url": "<presigned GET>",
        "result_sha256": "<hex of the bytes at the url>",
        "result_size": <int byte count>,
        "note": "<one-line hint>",
    }

Nothing is ever dropped, trimmed, or summarised — "any size, lossless" holds.
The caller (agent) fetches ``result_url`` to get the complete result and can
verify integrity against ``result_sha256``.

These helpers are intentionally local to the ``tools`` package — they are not a
new shared library. Each KB handler imports the small primitive it needs and
passes in the S3 client + bucket it already owns (``knowledge_base.py`` and the
others already presign downloads against their own bucket); no new
infrastructure is introduced.
"""

import hashlib
import json
import uuid as uuid_mod
from typing import Any, Dict

# 5 MiB. AWS's synchronous (RequestResponse) Lambda response limit is 6 MB
# (decimal, 6_000_000). 5 MiB == 5_242_880 bytes leaves ~757 KB of headroom
# for the response envelope and JSON-encoding overhead. Results at or under this
# size are returned inline; anything larger spills losslessly to S3.
MAX_RESPONSE_BYTES = 5 * 1024 * 1024

# How long the presigned GET URL for a spilled result stays valid (seconds).
# Matches knowledge_base.PRESIGNED_URL_EXPIRY; kept local so this module has no
# import dependency on its callers.
SPILL_URL_EXPIRY = 300

# S3 key prefix for spilled tool results. Lives under the same temp namespace the
# folder-download path already uses, so existing lifecycle/IAM cover it.
SPILL_KEY_PREFIX = "tmp/oversized-tool-results"


def serialize_result(obj: Any) -> bytes:
    """Serialize ``obj`` to the exact UTF-8 JSON bytes used for measurement,
    S3 storage, and sha256.

    ``default=str`` ensures non-JSON-native values (e.g. datetimes) don't raise
    here — the real Lambda serializer is equally permissive. Using one function
    for the measurement, the stored bytes, and the hash guarantees
    ``result_sha256`` is over *exactly* the bytes at ``result_url`` and that
    ``result_size`` matches them.
    """
    return json.dumps(obj, default=str).encode("utf-8")


def response_byte_size(obj: Any) -> int:
    """Return the UTF-8 byte length of ``obj`` serialized as JSON.

    Mirrors how the result is actually marshalled onto the Lambda response
    payload, so the measurement matches what AWS counts against the 6 MB limit.
    """
    return len(serialize_result(obj))


def exceeds_budget(obj: Any, budget: int = MAX_RESPONSE_BYTES) -> bool:
    """True if ``obj`` serialized as JSON would exceed ``budget`` bytes."""
    return response_byte_size(obj) > budget


def spill_result_to_s3(
    result: Any,
    *,
    s3_client: Any,
    bucket: str,
    expiry: int = SPILL_URL_EXPIRY,
    note: str,
    key_prefix: str = SPILL_KEY_PREFIX,
) -> Dict[str, Any]:
    """Write the FULL ``result`` JSON to S3 losslessly and return the oversized
    envelope.

    No truncation, no dropping, no shape mutation of ``result`` — the entire
    serialized result is stored verbatim. The sha256 is computed over the exact
    bytes written to S3 (before presigning), so a caller can fetch
    ``result_url`` and verify integrity against ``result_sha256``.

    Args:
        result: The full tool result (any JSON-serializable structure).
        s3_client: A boto3 S3 client (the caller's PRM-wrapped client, already
            region-configured — the presign uses the client's own config).
        bucket: Bucket to store the spilled result in (the same bucket the
            caller's download path already presigns against).
        expiry: Presigned GET URL lifetime in seconds.
        note: One-line human-readable hint embedded in the envelope.
        key_prefix: S3 key prefix for the spilled object.

    Returns:
        The oversized envelope::

            {"status": "success", "oversized": True, "result_url": ...,
             "result_sha256": ..., "result_size": ..., "note": ...}
    """
    body = serialize_result(result)
    result_sha256 = hashlib.sha256(body).hexdigest()
    result_size = len(body)

    key = f"{key_prefix}/{uuid_mod.uuid4()}.json"
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json",
    )

    result_url = s3_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expiry,
    )

    return {
        "status": "success",
        "oversized": True,
        "result_url": result_url,
        "result_sha256": result_sha256,
        "result_size": result_size,
        "note": note,
    }


def inline_or_spill(
    result: Any,
    *,
    s3_client: Any,
    bucket: str,
    expiry: int = SPILL_URL_EXPIRY,
    note: str,
    budget: int = MAX_RESPONSE_BYTES,
    key_prefix: str = SPILL_KEY_PREFIX,
) -> Dict[str, Any]:
    """Return ``result`` inline when it fits ``budget``; otherwise spill it
    losslessly to S3 and return the oversized envelope.

    This is the single entry point KB handlers call instead of the old
    truncation helpers. The small-result fast path is unchanged (return inline,
    lossless). The over-budget path is lossless too — the full result is stored
    in S3 and pointed at by a presigned URL + sha256.
    """
    if not exceeds_budget(result, budget):
        return result

    return spill_result_to_s3(
        result,
        s3_client=s3_client,
        bucket=bucket,
        expiry=expiry,
        note=note,
        key_prefix=key_prefix,
    )


def sha256_hex(data: bytes) -> str:
    """Return the hex sha256 digest of ``data``.

    Used to stamp ``download_sha256`` onto binary file-download envelopes so the
    caller can verify the bytes behind ``download_url``/``s3_key``.
    """
    return hashlib.sha256(data).hexdigest()
