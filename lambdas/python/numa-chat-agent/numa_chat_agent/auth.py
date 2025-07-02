"""
Authentication module for Numa Chat Agent.

Handles user authentication, role assumption, and Q Business client creation.
"""

import boto3
import structlog

from .config import REGION, get_qbusiness_client, get_sts_client

logger = structlog.get_logger()

# Global variable to store current user authentication context
# This allows tools to access user context during the request
CURRENT_USER_AUTH = None


def set_current_user_auth(user_auth):
    """Set the current user authentication context."""
    global CURRENT_USER_AUTH  # pylint: disable=global-statement
    CURRENT_USER_AUTH = user_auth


def get_current_user_auth():
    """Get the current user authentication context."""
    return CURRENT_USER_AUTH


def clear_current_user_auth():
    """Clear the current user authentication context."""
    global CURRENT_USER_AUTH  # pylint: disable=global-statement
    CURRENT_USER_AUTH = None


def create_authenticated_qbusiness_client(user_auth):
    """
    Create a Q Business client with user authentication context.
    This assumes a role with web identity using the user's ID token.

    Args:
        user_auth: Dictionary containing user authentication info:
            - idToken: User's Cognito ID token
            - email: User's email
            - sub: User's Cognito sub
            - groups: User's Cognito groups
            - region: AWS region
            - userPoolId: Cognito User Pool ID
            - groups_config: Group configuration with role ARNs

    Returns:
        boto3 Q Business client with user credentials, or None if failed
    """
    try:
        if not user_auth or not user_auth.get("idToken"):
            logger.warning("No user authentication context provided")
            return None

        id_token = user_auth["idToken"]
        user_groups = user_auth.get("groups", [])
        groups_config = user_auth.get("groups_config", {})
        region = user_auth.get("region", REGION)

        # Determine user's role ARN from groups (default to 'standard' group)
        user_group = user_groups[0] if user_groups else "standard"
        role_arn = groups_config.get(user_group, {}).get("roleArn")

        if not role_arn:
            logger.error(
                "No role ARN found for user group",
                user_group=user_group,
                available_groups=list(groups_config.keys()),
            )
            return None

        logger.info(
            "Creating authenticated Q Business client",
            user_group=user_group,
            role_arn=role_arn,
            email=user_auth.get("email"),
        )

        # Create STS client for assuming role with web identity
        sts_client = get_sts_client()

        # Assume role with web identity token
        response = sts_client.assume_role_with_web_identity(
            RoleArn=role_arn,
            RoleSessionName="numa-chat-agent-qbusiness",
            WebIdentityToken=id_token,
            DurationSeconds=3600,
        )

        credentials = response["Credentials"]

        # Create Q Business client with assumed role credentials
        qb_client = boto3.client(
            "qbusiness",
            region_name=region,
            aws_access_key_id=credentials["AccessKeyId"],
            aws_secret_access_key=credentials["SecretAccessKey"],
            aws_session_token=credentials["SessionToken"],
        )

        logger.info("Successfully created authenticated Q Business client")
        return qb_client

    except Exception as exc:
        logger.error(
            "Failed to create authenticated Q Business client",
            error=str(exc),
            user_email=user_auth.get("email") if user_auth else None,
            exc_info=True,
        )
        return None


def get_qbusiness_client_for_user(user_auth=None):
    """
    Get Q Business client, preferring authenticated client if user auth is available.

    Args:
        user_auth: Optional user authentication context

    Returns:
        Q Business client (authenticated if possible, default otherwise)
    """
    if user_auth:
        authenticated_client = create_authenticated_qbusiness_client(user_auth)
        if authenticated_client:
            logger.info("Using authenticated Q Business client")
            return authenticated_client
        else:
            logger.warning(
                "Failed to create authenticated client, falling back to default"
            )

    # Fall back to default client
    return get_qbusiness_client()
