"""
Common MCP client helpers.
"""

import os
from typing import Optional

import structlog

from ..auth import get_request_scoped_user_auth

logger = structlog.get_logger(__name__)


def get_external_user_id() -> Optional[str]:
    """
    Build the external user identifier used by MCP providers.

    Format matches the frontend: ``{client_id}_{cognito_user_id}``.
    """
    user_auth = get_request_scoped_user_auth()
    if not user_auth:
        logger.warning(
            "No user auth context available for MCP integration - using request-scoped authentication"
        )
        return None

    client_id = os.environ.get("CLIENT_NAME")

    cognito_user_id = user_auth.get("sub") or user_auth.get("user_id")
    if not cognito_user_id:
        logger.warning(
            "Could not extract Cognito user ID from auth context",
            user_auth_keys=list(user_auth.keys()),
        )
        return None

    external_user_id = f"{client_id}_{cognito_user_id}"
    logger.debug(
        "Generated external user ID for MCP",
        client_id=client_id,
        cognito_user_id=(
            cognito_user_id[:8] + "..." if len(cognito_user_id) > 8 else cognito_user_id
        ),
        external_user_id=(
            external_user_id[:20] + "..."
            if len(external_user_id) > 20
            else external_user_id
        ),
    )
    return external_user_id
