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

# System KBs that are accessible to all authenticated users.
SYSTEM_KB_IDS = {"company", "numa-support"}

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
            or user_sub in viewers
            or user_sub in editors
            or user_sub == created_by
        )

        logger.info(
            "KB access check completed",
            kb_id=kb_id,
            user_sub=user_sub[:8] + "...",
            has_access=has_access,
            is_viewer=user_sub in viewers,
            is_editor=user_sub in editors,
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
