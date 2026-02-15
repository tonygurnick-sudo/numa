"""
Pipedream integration tool handlers for workspace-chat-tools.

Handles integration operations by forwarding requests through the
pipedream-relay Lambda. Supports:
- list_actions: Download action schemas for an app
- run_action: Execute an action (with human-in-the-loop approval)
- configure_props: Get dynamic dropdown options
- proxy_request: Make raw API calls (with approval)
"""

import base64
import hashlib
import hmac as hmac_mod
import json
import os
import time
import uuid
from typing import Any, Dict, Optional

import structlog

from prm import client as prm_client

logger = structlog.get_logger()

# Approval polling configuration
APPROVAL_POLL_INTERVAL_SECONDS = 5
APPROVAL_TIMEOUT_SECONDS = 90

# DynamoDB table names from environment
INTEGRATIONS_APPROVAL_TABLE = os.environ.get("INTEGRATIONS_APPROVAL_TABLE_NAME", "")
PIPEDREAM_RELAY_LAMBDA_ARN = os.environ.get("PIPEDREAM_RELAY_LAMBDA_ARN", "")
OUTPUTS_BUCKET_NAME = os.environ.get("OUTPUTS_BUCKET_NAME", "")
FILE_REDIRECT_SECRET = os.environ.get("FILE_REDIRECT_SECRET", "")
FILE_REDIRECT_BASE_URL = os.environ.get("FILE_REDIRECT_BASE_URL", "")

# Workspace file path constants
WORKSPACE_ROOT = "/workdir"
S3_PREFIX = "numa-chat/workspace"
BLOCKED_PATH_PATTERNS = [".system/", ".system", "secrets/", "secrets", ".env"]


def _generate_file_token(s3_key: str) -> str:
    """Generate an HMAC-signed token for the file redirect endpoint.

    Token format: {base64url(s3_key)}.{expiry_unix}.{base64url(hmac_sha256)}
    TTL: 30 seconds.
    """
    expiry = str(int(time.time()) + 30)
    b64_key = base64.urlsafe_b64encode(s3_key.encode()).decode().rstrip("=")
    message = f"{b64_key}.{expiry}"
    mac = hmac_mod.new(
        FILE_REDIRECT_SECRET.encode(), message.encode(), hashlib.sha256
    ).digest()
    b64_mac = base64.urlsafe_b64encode(mac).decode().rstrip("=")
    return f"{b64_key}.{expiry}.{b64_mac}"


def _resolve_workdir_path(
    value: str,
    key: str,
    s3_client: Any,
    user_sub: str,
    conversation_id: str,
) -> Optional[str]:
    """Convert a single /workdir/ path to a presigned or redirect URL.

    Returns the URL string on success, or None if the path should be left
    unchanged (security block, missing file, etc.).
    """
    if not value.startswith(WORKSPACE_ROOT + "/"):
        return None

    # Security: block sensitive paths
    if ".." in value:
        logger.warning("Path traversal in integration prop, skipping", key=key)
        return None
    for pattern in BLOCKED_PATH_PATTERNS:
        if pattern in value:
            logger.warning(
                "Blocked path pattern in integration prop, skipping", key=key
            )
            return None

    # Convert workspace path to S3 key
    rel_path = value[len(WORKSPACE_ROOT) + 1 :]
    if rel_path.startswith("chat-workflows/"):
        s3_key = f"{S3_PREFIX}/{user_sub}/{rel_path}"
    else:
        s3_key = f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/{rel_path}"

    # Verify file exists and generate URL
    try:
        s3_client.head_object(Bucket=OUTPUTS_BUCKET_NAME, Key=s3_key)

        if FILE_REDIRECT_SECRET and FILE_REDIRECT_BASE_URL:
            token = _generate_file_token(s3_key)
            filename = os.path.basename(rel_path)
            url = f"{FILE_REDIRECT_BASE_URL}/integration-file/{token}/{filename}"
            logger.info(
                "Replaced workspace path with redirect URL",
                key=key,
                s3_key=s3_key,
            )
            return url
        else:
            presigned_url = s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": OUTPUTS_BUCKET_NAME, "Key": s3_key},
                ExpiresIn=300,
            )
            logger.info(
                "Replaced workspace path with presigned URL",
                key=key,
                s3_key=s3_key,
            )
            return presigned_url
    except Exception as exc:
        logger.warning(
            "File not found in S3 for integration upload",
            key=key,
            s3_key=s3_key,
            error=str(exc),
        )
        return None


def _preprocess_file_paths(
    configured_props: Dict[str, Any],
    user_sub: str,
    conversation_id: str,
) -> Dict[str, Any]:
    """Replace /workdir/ paths in configured_props with S3 presigned GET URLs.

    Handles both top-level string values and string arrays (e.g. Gmail's
    attachmentUrlsOrPaths). The workspace agent uses /workdir/ paths
    internally; this function converts them to short-lived URLs that
    Pipedream can fetch.
    """
    if not configured_props or not user_sub or not conversation_id:
        return configured_props

    if not OUTPUTS_BUCKET_NAME:
        logger.warning(
            "OUTPUTS_BUCKET_NAME not configured, skipping file path preprocessing"
        )
        return configured_props

    s3_client = prm_client("s3")
    result = dict(configured_props)

    for key, value in result.items():
        # Handle single string values
        if isinstance(value, str):
            resolved = _resolve_workdir_path(
                value, key, s3_client, user_sub, conversation_id
            )
            if resolved is not None:
                result[key] = resolved

        # Handle string array values (e.g. Gmail attachmentUrlsOrPaths,
        # Outlook files, Jira multi-attachments)
        elif isinstance(value, list):
            new_list = []
            for item in value:
                if isinstance(item, str):
                    resolved = _resolve_workdir_path(
                        item, key, s3_client, user_sub, conversation_id
                    )
                    new_list.append(resolved if resolved is not None else item)
                else:
                    new_list.append(item)
            result[key] = new_list

    return result


def _get_relay_lambda_arn() -> str:
    """Get the pipedream relay Lambda ARN from environment."""
    arn = PIPEDREAM_RELAY_LAMBDA_ARN
    if not arn:
        raise ValueError("PIPEDREAM_RELAY_LAMBDA_ARN is not configured")
    return arn


def _invoke_relay(
    operation: str,
    external_user_id: str,
    parameters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Invoke the pipedream relay Lambda.

    Args:
        operation: The relay operation to perform
        external_user_id: The external user ID for Pipedream
        parameters: Operation-specific parameters

    Returns:
        Parsed response from the relay
    """
    relay_arn = _get_relay_lambda_arn()
    lambda_client = prm_client(
        "lambda", region=os.environ.get("AWS_REGION", "us-east-1")
    )

    payload = {
        "operation": operation,
        "external_user_id": external_user_id,
        "parameters": parameters or {},
    }

    logger.info(
        "Invoking pipedream relay",
        operation=operation,
        external_user_id=external_user_id,
        relay_arn=relay_arn,
    )

    response = lambda_client.invoke(
        FunctionName=relay_arn,
        Payload=json.dumps(payload),
        InvocationType="RequestResponse",
    )

    response_payload = json.loads(response["Payload"].read())

    if response.get("FunctionError"):
        logger.error(
            "Relay Lambda execution failed",
            function_error=response["FunctionError"],
            response_payload=response_payload,
        )
        raise RuntimeError("Pipedream relay Lambda execution failed")

    status_code = response_payload.get("statusCode", 500)
    body = response_payload.get("body", {})

    # Body might be JSON string or dict
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except (json.JSONDecodeError, TypeError):
            pass

    if status_code != 200:
        error_msg = (
            body.get("error", "Unknown relay error")
            if isinstance(body, dict)
            else str(body)
        )
        raise RuntimeError(f"Relay returned error ({status_code}): {error_msg}")

    data = body.get("data", {}) if isinstance(body, dict) else {}
    return data


def _create_approval_request(
    user_sub: str,
    action_key: str,
    description: str,
    props_preview: Dict[str, Any],
    annotations: Optional[Dict[str, Any]] = None,
    approval_id: Optional[str] = None,
) -> str:
    """Create an approval request in DynamoDB and return the approval ID.

    Args:
        user_sub: The user's Cognito sub
        action_key: The action being executed
        description: Human-readable description of what the action does
        props_preview: Preview of the configured props
        annotations: Action annotations (readOnlyHint, destructiveHint, etc.)
        approval_id: Deterministic approval ID (typically request_id).
                     Falls back to UUID if not provided.

    Returns:
        The approval_id string
    """
    if not INTEGRATIONS_APPROVAL_TABLE:
        raise ValueError("INTEGRATIONS_APPROVAL_TABLE_NAME is not configured")

    approval_id = approval_id or str(uuid.uuid4())
    now = int(time.time())
    ttl = now + 86400  # 24 hours

    dynamodb = prm_client("dynamodb")
    try:
        # Use conditional write: only create the record if it doesn't exist yet.
        # The frontend may have already written an "approved"/"denied" decision
        # before the tools Lambda starts (e.g. for the second tool in a parallel
        # batch), so we must not overwrite an existing decision.
        dynamodb.put_item(
            TableName=INTEGRATIONS_APPROVAL_TABLE,
            Item={
                "approval_id": {"S": approval_id},
                "user_sub": {"S": user_sub},
                "action_key": {"S": action_key},
                "description": {"S": description},
                "props_preview": {"S": json.dumps(props_preview)},
                "annotations": {"S": json.dumps(annotations or {})},
                "status": {"S": "pending"},
                "created_at": {"N": str(now)},
                "ttl": {"N": str(ttl)},
            },
            ConditionExpression="attribute_not_exists(approval_id)",
        )
    except dynamodb.exceptions.ConditionalCheckFailedException:
        # Record already exists (frontend pre-created it with the approval
        # decision). This is expected for parallel tool calls — just proceed
        # to poll for the existing decision.
        logger.info(
            "Approval record already exists (likely pre-approved)",
            approval_id=approval_id,
            action_key=action_key,
        )

    logger.info(
        "Created approval request",
        approval_id=approval_id,
        action_key=action_key,
        user_sub=user_sub[:8] + "...",
    )

    return approval_id


def _poll_approval(approval_id: str) -> str:
    """Poll DynamoDB for approval decision.

    Blocks until approved, denied, or timeout.

    Args:
        approval_id: The approval request ID

    Returns:
        "approved", "denied", or "timeout"
    """
    if not INTEGRATIONS_APPROVAL_TABLE:
        raise ValueError("INTEGRATIONS_APPROVAL_TABLE_NAME is not configured")

    dynamodb = prm_client("dynamodb")
    deadline = time.time() + APPROVAL_TIMEOUT_SECONDS

    while time.time() < deadline:
        response = dynamodb.get_item(
            TableName=INTEGRATIONS_APPROVAL_TABLE,
            Key={"approval_id": {"S": approval_id}},
        )

        item = response.get("Item", {})
        status = item.get("status", {}).get("S", "pending")

        if status in ("approved", "denied"):
            logger.info(
                "Approval decision received",
                approval_id=approval_id,
                status=status,
            )
            return status

        time.sleep(APPROVAL_POLL_INTERVAL_SECONDS)

    logger.warning(
        "Approval timed out",
        approval_id=approval_id,
        timeout_seconds=APPROVAL_TIMEOUT_SECONDS,
    )
    return "timeout"


def handle_list_actions(params: Dict[str, Any]) -> Dict[str, Any]:
    """List available actions for an integration app.

    Args:
        params: Must contain 'app_slug' and 'external_user_id'

    Returns:
        Dict with 'actions' list
    """
    app_slug = params.get("app_slug")
    external_user_id = params.get("external_user_id")

    if not app_slug:
        raise ValueError("app_slug is required")
    if not external_user_id:
        raise ValueError("external_user_id is required")

    result = _invoke_relay(
        operation="list_actions",
        external_user_id=external_user_id,
        parameters={"app_slug": app_slug},
    )

    return result


def handle_run_action(params: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a Pipedream integration action with human-in-the-loop approval.

    Args:
        params: Must contain 'action_key', 'configured_props', 'description',
                'external_user_id', and '__user_sub'

    Returns:
        Action result or approval status
    """
    action_key = params.get("action_key")
    configured_props = params.get("configured_props", {})
    description = params.get("description", "")
    external_user_id = params.get("external_user_id")
    user_sub = params.get("__user_sub", "")
    stash_id = params.get("stash_id")
    annotations = params.get("annotations", {})
    request_id = params.get("request_id")

    if not action_key:
        raise ValueError("action_key is required")
    if not external_user_id:
        raise ValueError("external_user_id is required")

    # Check if this tool call was auto-approved by the sdk_runner
    # based on the user's/agent's approval mode setting.
    is_auto_approved = params.get("auto_approved", False)

    if not is_auto_approved:
        # Create approval request (use request_id as deterministic approval_id)
        approval_id = _create_approval_request(
            user_sub=user_sub,
            action_key=action_key,
            description=description,
            props_preview=configured_props,
            annotations=annotations,
            approval_id=request_id,
        )

        # Return approval event for SSE delivery to frontend
        # The caller (MCP tool) will emit this as an SSE event
        # Then poll for the decision
        decision = _poll_approval(approval_id)

        if decision == "denied":
            return {
                "status": "denied",
                "message": "User denied this action",
                "approval_id": approval_id,
            }

        if decision == "timeout":
            return {
                "status": "timeout",
                "message": "Approval timed out (2 minutes)",
                "approval_id": approval_id,
            }
    else:
        approval_id = request_id or str(uuid.uuid4())
        logger.info(
            "Auto-approved integration action",
            action_key=action_key,
            approval_id=approval_id,
        )

    # Approved — preprocess workspace file paths into presigned URLs
    configured_props = _preprocess_file_paths(
        configured_props,
        user_sub=user_sub,
        conversation_id=params.get("__conversation_id", ""),
    )

    # Execute the action
    relay_params: Dict[str, Any] = {
        "action_key": action_key,
        "configured_props": configured_props,
    }
    if stash_id:
        relay_params["stash_id"] = stash_id

    result = _invoke_relay(
        operation="run_action",
        external_user_id=external_user_id,
        parameters=relay_params,
    )

    return {
        "status": "success",
        "approval_id": approval_id,
        "result": result,
    }


def handle_configure_props(params: Dict[str, Any]) -> Dict[str, Any]:
    """Get dynamic dropdown options for an action prop.

    No approval needed — this is read-only metadata.

    Args:
        params: Must contain 'action_key', 'prop_name', 'configured_props',
                'external_user_id'

    Returns:
        Options for the prop
    """
    action_key = params.get("action_key")
    prop_name = params.get("prop_name")
    configured_props = params.get("configured_props", {})
    external_user_id = params.get("external_user_id")

    if not action_key:
        raise ValueError("action_key is required")
    if not prop_name:
        raise ValueError("prop_name is required")
    if not external_user_id:
        raise ValueError("external_user_id is required")

    result = _invoke_relay(
        operation="configure_props",
        external_user_id=external_user_id,
        parameters={
            "action_key": action_key,
            "prop_name": prop_name,
            "configured_props": configured_props,
        },
    )

    return result


def handle_proxy_request(params: Dict[str, Any]) -> Dict[str, Any]:
    """Make a raw API call through Pipedream's proxy with approval.

    Args:
        params: Must contain 'method', 'upstream_url', 'integration_slug',
                'description', 'external_user_id', '__user_sub'

    Returns:
        Raw API response or approval status
    """
    method = params.get("method", "GET")
    upstream_url = params.get("upstream_url")
    integration_slug = params.get("integration_slug")
    description = params.get("description", "")
    external_user_id = params.get("external_user_id")
    user_sub = params.get("__user_sub", "")
    request_id = params.get("request_id")
    body = params.get("body")
    headers = params.get("headers")

    if not upstream_url:
        raise ValueError("upstream_url is required")
    if not integration_slug:
        raise ValueError("integration_slug is required")
    if not external_user_id:
        raise ValueError("external_user_id is required")

    # Resolve Pipedream account ID from integration slug
    status_result = _invoke_relay(
        operation="get_integration_status",
        external_user_id=external_user_id,
    )
    connections = (
        status_result.get("connections", [])
        if isinstance(status_result, dict)
        else status_result if isinstance(status_result, list) else []
    )
    account_id = None
    for conn in connections:
        if (
            conn.get("app_name") == integration_slug
            and conn.get("status") == "connected"
        ):
            account_id = conn.get("pipedream_account_id")
            break
    if not account_id:
        raise ValueError(
            f"Integration '{integration_slug}' is not connected or account ID could not be resolved"
        )

    # Check if this tool call was auto-approved by the sdk_runner
    is_auto_approved = params.get("auto_approved", False)

    if not is_auto_approved:
        # Create approval request (use request_id as deterministic approval_id)
        approval_id = _create_approval_request(
            user_sub=user_sub,
            action_key=f"proxy_{method}",
            description=description,
            props_preview={"method": method, "upstream_url": upstream_url},
            approval_id=request_id,
        )

        decision = _poll_approval(approval_id)

        if decision == "denied":
            return {
                "status": "denied",
                "message": "User denied this action",
                "approval_id": approval_id,
            }

        if decision == "timeout":
            return {
                "status": "timeout",
                "message": "Approval timed out (2 minutes)",
                "approval_id": approval_id,
            }
    else:
        approval_id = request_id or str(uuid.uuid4())
        logger.info(
            "Auto-approved proxy request",
            method=method,
            integration_slug=integration_slug,
            approval_id=approval_id,
        )

    # Approved — execute
    relay_params = {
        "method": method,
        "upstream_url": upstream_url,
        "account_id": account_id,
        "body": body,
    }
    if headers:
        relay_params["headers"] = headers

    result = _invoke_relay(
        operation="proxy_request",
        external_user_id=external_user_id,
        parameters=relay_params,
    )

    return {
        "status": "success",
        "approval_id": approval_id,
        "result": result,
    }


def handle_approve_action(params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle approval/denial of an integration action.

    Called by the frontend approval API.

    Args:
        params: Must contain 'approval_id' and 'decision' ("approved" or "denied")

    Returns:
        Updated approval status
    """
    approval_id = params.get("approval_id")
    decision = params.get("decision")

    if not approval_id:
        raise ValueError("approval_id is required")
    if decision not in ("approved", "denied"):
        raise ValueError("decision must be 'approved' or 'denied'")

    if not INTEGRATIONS_APPROVAL_TABLE:
        raise ValueError("INTEGRATIONS_APPROVAL_TABLE_NAME is not configured")

    dynamodb = prm_client("dynamodb")
    dynamodb.update_item(
        TableName=INTEGRATIONS_APPROVAL_TABLE,
        Key={"approval_id": {"S": approval_id}},
        UpdateExpression="SET #s = :status, decided_at = :decided_at",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":status": {"S": decision},
            ":decided_at": {"N": str(int(time.time()))},
        },
    )

    logger.info(
        "Approval decision recorded",
        approval_id=approval_id,
        decision=decision,
    )

    return {
        "approval_id": approval_id,
        "status": decision,
    }
