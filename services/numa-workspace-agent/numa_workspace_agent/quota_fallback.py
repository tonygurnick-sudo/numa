"""
Bedrock daily token quota fallback management.

When a model's daily token quota is exhausted (429 "per day" error),
caches the exhausted state in DynamoDB so subsequent requests skip
the exhausted model and use Sonnet 4.5 as fallback immediately.

Cache records use a synthetic partition key (SYSTEM#quota-exhausted)
in the chat-history table that cannot collide with real Cognito UUIDs.
"""

import time
from typing import Optional

import structlog
from numa_workspace_agent.sdk_config import (
    FALLBACK_MODEL,
    _regionalize,
    _strip_prefix,
)

logger = structlog.get_logger()

# Cache TTL: 24 hours
_QUOTA_CACHE_TTL_SECONDS = 24 * 60 * 60

# Synthetic partition key -- cannot collide with Cognito UUID user_ids
_QUOTA_PK = "SYSTEM#quota-exhausted"


def _get_table_name() -> str:
    """Get DynamoDB table name from environment (chat-history table)."""
    import os

    return os.environ.get("DYNAMODB_TABLE_NAME", "")


def _get_client():
    """Reuse the singleton DynamoDB client from dynamo module."""
    from numa_workspace_agent.dynamo import get_dynamodb_client

    return get_dynamodb_client()


_DAILY_QUOTA_PHRASES = ("per day", "tokens per day", "per-day", "daily")


def is_daily_quota_error(text: Optional[str]) -> bool:
    """Check if error text indicates daily token quota exhaustion.

    Matches 429 errors whose body mentions daily-quota wording --
    NOT transient RPM/TPM throttling, which the SDK's internal retry
    logic handles silently before anything reaches us.
    """
    if not text:
        return False
    lower = text.lower()
    if "429" not in lower:
        return False
    return any(phrase in lower for phrase in _DAILY_QUOTA_PHRASES)


def mark_quota_exhausted(model_id: str) -> bool:
    """Cache that a model's daily Bedrock quota is exhausted.

    Writes a record to the chat-history table with a synthetic key:
      PK (user_id): SYSTEM#quota-exhausted
      SK (sk):      {bare_model_id}
    """
    table_name = _get_table_name()
    if not table_name:
        return False

    bare = _strip_prefix(model_id)
    now = int(time.time())
    expires_at = now + _QUOTA_CACHE_TTL_SECONDS

    try:
        client = _get_client()
        client.put_item(
            TableName=table_name,
            Item={
                "user_id": {"S": _QUOTA_PK},
                "sk": {"S": bare},
                "exhausted_at": {"N": str(now)},
                "expires_at": {"N": str(expires_at)},
                "message_type": {"S": "quota_exhausted"},
            },
        )
        logger.warning(
            "Marked model quota exhausted -- subsequent requests will use fallback",
            _name="QUOTA_EXHAUSTED_CACHED",
            phase="fallback",
            model_id=model_id,
            bare_model=bare,
            expires_at=expires_at,
            ttl_hours=_QUOTA_CACHE_TTL_SECONDS / 3600,
        )
        return True
    except Exception as e:
        logger.error(
            "Failed to cache quota exhaustion",
            error=str(e),
            model_id=model_id,
        )
        return False


def check_quota_exhausted(model_id: str) -> bool:
    """Check if a model's daily quota is cached as exhausted.

    Uses application-level TTL check on expires_at (does not rely on
    DynamoDB TTL which can be delayed up to 48 hours).
    """
    table_name = _get_table_name()
    if not table_name:
        return False

    bare = _strip_prefix(model_id)

    try:
        client = _get_client()
        response = client.get_item(
            TableName=table_name,
            Key={
                "user_id": {"S": _QUOTA_PK},
                "sk": {"S": bare},
            },
            ConsistentRead=True,
        )
        item = response.get("Item")
        if not item:
            return False

        expires_at = int(item.get("expires_at", {}).get("N", "0"))
        now = int(time.time())

        if now >= expires_at:
            # Expired -- clean up stale record (best effort)
            try:
                client.delete_item(
                    TableName=table_name,
                    Key={
                        "user_id": {"S": _QUOTA_PK},
                        "sk": {"S": bare},
                    },
                )
                logger.info(
                    "Cleaned up expired quota cache record",
                    _name="QUOTA_CACHE_EXPIRED",
                    phase="fallback",
                    model_id=model_id,
                )
            except Exception:
                pass
            return False

        remaining = expires_at - now
        logger.info(
            "Model quota still exhausted (cached)",
            _name="QUOTA_EXHAUSTED_HIT",
            phase="fallback",
            model_id=model_id,
            bare_model=bare,
            remaining_seconds=remaining,
            remaining_hours=round(remaining / 3600, 1),
        )
        return True
    except Exception as e:
        # Fail-open: if DynamoDB is unreachable, use the primary model
        logger.error(
            "Failed to check quota cache -- using primary model",
            error=str(e),
            model_id=model_id,
        )
        return False


def resolve_model_with_fallback(model_id: str) -> tuple[str, bool]:
    """Resolve model ID, falling back to Sonnet 4.5 if quota is exhausted.

    Returns:
        (effective_model_id, is_fallback) tuple.
        is_fallback=True means the primary model was swapped to fallback.
    """
    # Don't fallback if already using the fallback model
    if _strip_prefix(model_id) == _strip_prefix(FALLBACK_MODEL):
        return model_id, False

    if check_quota_exhausted(model_id):
        # Check the fallback model isn't also exhausted
        if check_quota_exhausted(FALLBACK_MODEL):
            logger.error(
                "Both primary and fallback models have exhausted quotas",
                _name="FALLBACK_ALSO_EXHAUSTED",
                phase="fallback",
                primary=model_id,
                fallback=FALLBACK_MODEL,
            )
            return model_id, False

        fallback = _regionalize(_strip_prefix(FALLBACK_MODEL))
        logger.warning(
            "Swapping to fallback model due to cached quota exhaustion",
            _name="QUOTA_FALLBACK_PRECHECK",
            phase="fallback",
            original_model=model_id,
            fallback_model=fallback,
        )
        return fallback, True

    return model_id, False
