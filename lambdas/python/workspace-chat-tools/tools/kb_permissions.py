"""
KB Permissions verification helper.

Provides server-side verification of knowledge base access by checking
the user's permissions in DynamoDB.
"""

import os
from typing import Optional

import structlog

from prm import client as prm_client

logger = structlog.get_logger()

# Environment variables
REGION = os.getenv("AWS_REGION", "us-east-1")
CLIENT_NAME = os.getenv("CLIENT_NAME", "")

# System KBs that are accessible to all authenticated users (read path).
#
# "synergy" is a crawler-managed Bedrock KB shared tenant-wide: every user is
# allowed to *query* it, and real per-user isolation is enforced downstream by
# the per-document `listContains(allowed_users, user_sub)` ACL applied inside
# `_query_bedrock`. Without it here, the dispatch gate (verify_kb_access in
# lambda_function.py) falls through to a numa-{client}-knowledge-bases get_item
# for KB#synergy — which has no record — and fail-closes every Synergy query.
#
# This is read-only: verify_kb_write_access does NOT special-case "synergy", so
# uploads/deletes against it still fail closed (no KB#synergy record → denied).
#
# NOTE: tools/knowledge_base.py defines its own SYSTEM_KB_IDS (already includes
# "synergy") for the read/write paths there. The duplication is intentional to
# keep this module dependency-free; keep the two in sync, do not refactor here.
SYSTEM_KB_IDS = {"company", "numa-support", "synergy"}

# Cognito user sub pattern (UUID v4)
_UUID_PATTERN_LEN = 36  # e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

# DynamoDB client (lazy initialization)
_dynamodb_client = None


def _get_dynamodb_client():
    """Get or create DynamoDB client."""
    global _dynamodb_client
    if _dynamodb_client is None:
        _dynamodb_client = prm_client("dynamodb", region=REGION)
    return _dynamodb_client


def _extract_string_list(attr: dict) -> list:
    """Extract a list of strings from a DynamoDB attribute.

    Handles both SS (String Set) and L (List of Maps) types:
      {"SS": ["*"]}         -> ["*"]
      {"L": [{"S": "abc"}]} -> ["abc"]
    """
    if "SS" in attr:
        return list(attr["SS"])
    if "L" in attr:
        return [v["S"] for v in attr["L"] if isinstance(v, dict) and "S" in v]
    return []


def verify_kb_access(
    user_sub: str,
    kb_id: str,
    client_name: Optional[str] = None,
) -> bool:
    """
    Verify user has access to a knowledge base by checking DynamoDB.

    Access is granted if the user is:
    - In the KB's viewers list
    - In the KB's editors list
    - The KB's creator (created_by field)

    Special case: "company" KB is accessible to all authenticated users.

    Args:
        user_sub: User's Cognito sub (UUID)
        kb_id: Knowledge base ID (e.g., "company" or UUID)
        client_name: Client/tenant name (defaults to CLIENT_NAME env var)

    Returns:
        True if user has access, False otherwise
    """
    # Use environment variable if not provided
    if not client_name:
        client_name = CLIENT_NAME

    # Fail closed if we don't have required context
    if not user_sub or not client_name:
        logger.warning(
            "KB access check failed - missing context",
            has_user_sub=bool(user_sub),
            has_client_name=bool(client_name),
            kb_id=kb_id,
        )
        return False

    # System KBs (company, numa-support) are accessible to all authenticated users.
    if kb_id in SYSTEM_KB_IDS:
        logger.debug(
            "System KB access granted",
            kb_id=kb_id,
            user_sub=user_sub[:8] + "...",
        )
        return True

    # Root KB: user's own root files (kb_id == user_sub). Owner-only access.
    if is_root_kb(kb_id, user_sub):
        logger.debug(
            "Root KB access granted (owner)",
            kb_id=kb_id[:8] + "...",
            user_sub=user_sub[:8] + "...",
        )
        return True

    # Look up KB permissions in DynamoDB
    table_name = f"numa-{client_name}-knowledge-bases"

    try:
        dynamodb = _get_dynamodb_client()
        response = dynamodb.get_item(
            TableName=table_name,
            Key={
                "PK": {"S": f"TENANT#{client_name}"},
                "SK": {"S": f"KB#{kb_id}"},
            },
            ProjectionExpression="viewers, editors, created_by",
        )

        if "Item" not in response:
            logger.warning(
                "KB not found in DynamoDB",
                kb_id=kb_id,
                table_name=table_name,
            )
            return False

        item = response["Item"]

        # Extract permission lists.
        # Viewers/editors may be stored as SS (String Set) or L (List of Maps).
        # The seed-default-kb Lambda writes SS; user KBs may use L.
        viewers = _extract_string_list(item.get("viewers", {}))
        editors = _extract_string_list(item.get("editors", {}))
        created_by = item.get("created_by", {}).get("S", "")

        # Wildcard "*" means all authenticated users have access.
        has_access = (
            "*" in viewers
            or "*" in editors
            or user_sub in viewers
            or user_sub in editors
            or user_sub == created_by
        )

        logger.info(
            "KB access check completed",
            kb_id=kb_id,
            user_sub=user_sub[:8] + "...",
            has_access=has_access,
            is_viewer=("*" in viewers or user_sub in viewers),
            is_editor=("*" in editors or user_sub in editors),
            is_creator=user_sub == created_by,
        )

        return has_access

    except Exception as e:
        logger.error(
            "KB permission check failed",
            kb_id=kb_id,
            error=str(e),
            exc_info=True,
        )
        # Fail closed on errors
        return False


def is_root_kb(kb_id: str, user_sub: str) -> bool:
    """
    Check if a kb_id represents the user's root files KB.

    Root KBs use the user's Cognito sub as the kb_id, providing a
    deterministic, per-user root file storage without DynamoDB records.
    """
    if not kb_id or not user_sub:
        return False
    return kb_id == user_sub
