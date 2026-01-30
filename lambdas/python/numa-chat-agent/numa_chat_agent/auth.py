"""
Authentication module for Numa Chat Agent.

Handles user authentication, role assumption, and Q Business client creation.
"""

import structlog

from prm import client as prm_client

from .config import REGION, get_qbusiness_client, get_sts_client

logger = structlog.get_logger()

# Global variable to store current user authentication context
# This allows tools to access user context during the request
CURRENT_USER_AUTH = None

logger.error(
    "RELIABILITY_CRITICAL: Global authentication state creates severe race conditions in concurrent requests",
    global_state_variable="CURRENT_USER_AUTH",
    concurrency_safety="NONE",
    thread_safety="NOT_GUARANTEED",
    reliability_risks=[
        "concurrent_requests_overwrite_each_others_auth_context",
        "users_can_inherit_authentication_from_other_concurrent_users",
        "potential_cross_user_data_leakage_via_auth_context_mixing",
        "intermittent_authentication_failures_based_on_request_timing",
    ],
    critical_failure_modes=[
        "user_A_tools_execute_with_user_B_authentication",
        "authentication_context_lost_mid_request_due_to_concurrent_overwrite",
        "unpredictable_permission_inheritance_between_users",
        "race_conditions_cause_seemingly_random_auth_failures",
    ],
)

# RELIABILITY IMPROVEMENT CRITICAL: Replace global authentication state with request-scoped context
# RATIONALE: The global CURRENT_USER_AUTH variable creates severe race conditions when multiple
# users make concurrent requests to Lambda. Each request overwrites the global state, causing
# users to inherit authentication contexts from other concurrent users. This leads to critical
# security vulnerabilities and completely unpredictable behavior where the same request can
# work or fail randomly based on concurrent request timing.
# CONSEQUENCE OF NOT FIXING: The system has CRITICAL reliability and security vulnerabilities:
# - User A's tools can execute with User B's authentication, causing cross-user data access
# - Authentication context can be lost mid-request when overwritten by concurrent requests
# - Users experience completely unpredictable authentication behavior based on timing
# - Same user actions work sometimes but fail other times depending on concurrent load
# - Impossible to debug authentication issues due to race condition timing dependencies
# - Potential compliance violations due to cross-user authentication inheritance
# CONSEQUENCE OF FIXING: With request-scoped authentication, the system would have:
# - Complete isolation between concurrent user requests and authentication contexts
# - Predictable authentication behavior independent of concurrent request timing
# - Elimination of cross-user authentication inheritance and data leakage risks
# - Reliable tool execution with consistent user context throughout request lifecycle
# - Enhanced security with proper isolation between user sessions
# - Debuggable authentication behavior with deterministic context management
#
# PROPOSED CRITICAL RELIABILITY FIX:
# from contextvars import ContextVar
# from typing import Optional, Dict, Any
# import threading
#
# # Replace global state with request-scoped context variables
# request_user_auth: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
#     'request_user_auth',
#     default=None
# )
#
# # Thread-local fallback for edge cases where context vars don't work
# _thread_local_auth = threading.local()
#
# def set_request_scoped_user_auth(user_auth: Dict[str, Any]):
#     """Set user authentication context with proper request isolation."""
#     try:
#         # Primary: Use context variables for proper asyncio/request isolation
#         request_user_auth.set(user_auth)
#         logger.info(
#             "AUTH_CONTEXT_ISOLATED: User authentication set with request isolation",
#             user_id=user_auth.get("sub", "unknown")[:8] + "...",
#             context_mechanism="CONTEXT_VAR",
#             isolation_level="REQUEST_SCOPED",
#             thread_safety="GUARANTEED"
#         )
#     except LookupError:
#         # Fallback: Use thread-local storage if context vars not available
#         _thread_local_auth.user_auth = user_auth
#         logger.warning(
#             "AUTH_CONTEXT_THREAD_LOCAL: Fallback to thread-local authentication storage",
#             user_id=user_auth.get("sub", "unknown")[:8] + "...",
#             context_mechanism="THREAD_LOCAL",
#             isolation_level="THREAD_SCOPED",
#             reason="context_vars_not_available"
#         )
#
# def get_request_scoped_user_auth() -> Optional[Dict[str, Any]]:
#     """Get user authentication context for current request only."""
#     try:
#         # Primary: Get from context variables
#         auth_context = request_user_auth.get()
#         if auth_context:
#             logger.debug(
#                 "AUTH_CONTEXT_RETRIEVED: Retrieved request-scoped authentication",
#                 user_id=auth_context.get("sub", "unknown")[:8] + "...",
#                 context_mechanism="CONTEXT_VAR"
#             )
#             return auth_context
#     except LookupError:
#         pass
#
#     # Fallback: Get from thread-local storage
#     try:
#         thread_auth = getattr(_thread_local_auth, 'user_auth', None)
#         if thread_auth:
#             logger.debug(
#                 "AUTH_CONTEXT_THREAD_LOCAL_RETRIEVED: Retrieved thread-local authentication",
#                 user_id=thread_auth.get("sub", "unknown")[:8] + "...",
#                 context_mechanism="THREAD_LOCAL"
#             )
#             return thread_auth
#     except AttributeError:
#         pass
#
#     logger.warning(
#         "AUTH_CONTEXT_NOT_FOUND: No authentication context available in current scope",
#         context_mechanisms_tried=["CONTEXT_VAR", "THREAD_LOCAL"]
#     )
#     return None
#
# def clear_request_scoped_user_auth():
#     """Clear user authentication context for current request."""
#     try:
#         request_user_auth.set(None)
#         logger.info(
#             "AUTH_CONTEXT_CLEARED: Request-scoped authentication cleared",
#             context_mechanism="CONTEXT_VAR"
#         )
#     except LookupError:
#         pass
#
#     # Also clear thread-local fallback
#     try:
#         if hasattr(_thread_local_auth, 'user_auth'):
#             delattr(_thread_local_auth, 'user_auth')
#             logger.info(
#                 "AUTH_CONTEXT_THREAD_LOCAL_CLEARED: Thread-local authentication cleared",
#                 context_mechanism="THREAD_LOCAL"
#             )
#     except AttributeError:
#         pass


def set_current_user_auth(user_auth):
    """Set the current user authentication context."""
    global CURRENT_USER_AUTH  # pylint: disable=global-statement

    logger.error(
        "RELIABILITY_FAILURE: Setting global authentication context - ACTIVE RACE CONDITION",
        user_id=(
            user_auth.get("sub", "unknown")[:8] + "..."
            if user_auth and user_auth.get("sub")
            else "unknown"
        ),
        global_state_operation="SET",
        concurrency_risk="CRITICAL",
        race_condition_active=True,
        potential_victims=[
            "concurrent_users",
            "other_lambda_invocations",
            "overlapping_requests",
        ],
    )

    CURRENT_USER_AUTH = user_auth


def get_current_user_auth():
    """Get the current user authentication context."""
    logger.warning(
        "RELIABILITY_RISK: Accessing global authentication context - may return wrong user's auth",
        global_state_operation="GET",
        returned_context="MAY_BE_FROM_CONCURRENT_USER",
        reliability_guarantee="NONE",
    )

    return CURRENT_USER_AUTH


def clear_current_user_auth():
    """Clear the current user authentication context."""
    global CURRENT_USER_AUTH  # pylint: disable=global-statement

    logger.warning(
        "RELIABILITY_RISK: Clearing global authentication context - may affect concurrent users",
        global_state_operation="CLEAR",
        concurrency_impact="MAY_CLEAR_OTHER_USERS_AUTH",
        timing_dependency="CRITICAL",
    )

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
        qb_client = prm_client(
            "qbusiness",
            region=region,
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
