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
from typing import Any, Callable, Dict, Optional

import structlog

from prm import client as prm_client

from .approval import create_approval_request, poll_approval

logger = structlog.get_logger()

# DynamoDB table names from environment
INTEGRATIONS_APPROVAL_TABLE = os.environ.get("INTEGRATIONS_APPROVAL_TABLE_NAME", "")
PIPEDREAM_RELAY_LAMBDA_ARN = os.environ.get("PIPEDREAM_RELAY_LAMBDA_ARN", "")
OUTPUTS_BUCKET_NAME = os.environ.get("OUTPUTS_BUCKET_NAME", "")
FILE_REDIRECT_SECRET = os.environ.get("FILE_REDIRECT_SECRET", "")
FILE_REDIRECT_BASE_URL = os.environ.get("FILE_REDIRECT_BASE_URL", "")
VAULT_AUDIT_LOG_TABLE_NAME = os.environ.get("VAULT_AUDIT_LOG_TABLE_NAME", "")

# Audit dedup for chat-driven Pipedream calls. Module-level so it survives
# across calls within a warm Lambda container. Tied to (user, app_slug) so
# repeated use of the same integration in one conversation logs once per
# minute, not once per tool call.
_LAST_PIPEDREAM_AUDIT_TS: Dict[tuple, float] = {}
_PIPEDREAM_AUDIT_DEDUP_SECONDS = 60

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

    def _resolve_or_fail(val: str, k: str) -> str:
        # A literal /workdir/ path is never valid to forward to Pipedream — it
        # must resolve to a fetchable URL. If it can't (missing/unsynced file,
        # path traversal, blocked pattern), fail CLOSED rather than forwarding
        # the raw string: an unresolved reference forwarded as a content prop
        # risks the upstream storing that string as the file's contents (this
        # corrupted a customer .docx).
        resolved = _resolve_workdir_path(val, k, s3_client, user_sub, conversation_id)
        if resolved is None:
            raise ValueError(
                f"Could not resolve workspace file '{val}' for prop '{k}'. "
                "The file may be missing, still syncing, or blocked. Refusing "
                "to forward the raw path so it cannot be uploaded as file "
                "content. Verify the file exists in /workdir and retry."
            )
        return resolved

    for key, value in result.items():
        # Handle single string values. Only /workdir/ paths are rewritten;
        # anything else (URLs, IDs, plain text) is passed through untouched.
        if isinstance(value, str):
            if value.startswith(WORKSPACE_ROOT + "/"):
                result[key] = _resolve_or_fail(value, key)

        # Handle string array values (e.g. Gmail attachmentUrlsOrPaths,
        # Outlook files, Jira multi-attachments)
        elif isinstance(value, list):
            new_list = []
            for item in value:
                if isinstance(item, str) and item.startswith(WORKSPACE_ROOT + "/"):
                    new_list.append(_resolve_or_fail(item, key))
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


def _execute_with_idempotency(
    approval_id: str,
    execute_fn: Callable[[], Dict[str, Any]],
) -> Dict[str, Any]:
    """Execute a function with idempotency guard using DynamoDB conditional updates.

    Prevents duplicate execution of the same approved action by tracking
    execution_status in the approval record. Uses a conditional update to
    atomically transition from pending/unknown to "executing".

    Args:
        approval_id: The approval request ID (used as the idempotency key)
        execute_fn: Zero-arg callable that performs the actual relay invocation

    Returns:
        The result from execute_fn, or an already_executed/execution_failed response
    """
    if not INTEGRATIONS_APPROVAL_TABLE:
        # No table configured — skip idempotency and just execute
        return execute_fn()

    dynamodb = prm_client("dynamodb")

    # Atomically claim execution: only proceed if no other invocation is running
    try:
        dynamodb.update_item(
            TableName=INTEGRATIONS_APPROVAL_TABLE,
            Key={"approval_id": {"S": approval_id}},
            UpdateExpression="SET execution_status = :executing",
            ConditionExpression=(
                "attribute_not_exists(execution_status) "
                "OR execution_status IN (:pending, :unknown)"
            ),
            ExpressionAttributeValues={
                ":executing": {"S": "executing"},
                ":pending": {"S": "pending"},
                ":unknown": {"S": "unknown"},
            },
        )
    except dynamodb.exceptions.ConditionalCheckFailedException:
        logger.warning(
            "Idempotency guard: action already executed",
            approval_id=approval_id,
        )
        return {
            "status": "already_executed",
            "message": "This action has already been executed.",
        }

    # Execute the relay call
    try:
        result = execute_fn()
        # Mark as completed
        dynamodb.update_item(
            TableName=INTEGRATIONS_APPROVAL_TABLE,
            Key={"approval_id": {"S": approval_id}},
            UpdateExpression="SET execution_status = :completed",
            ExpressionAttributeValues={
                ":completed": {"S": "completed"},
            },
        )
        return result
    except Exception as exc:
        # Relay failed — mark as unknown so a retry can attempt again
        error_msg = str(exc)
        logger.warning(
            "Relay execution failed after approval",
            approval_id=approval_id,
            error=error_msg,
        )
        dynamodb.update_item(
            TableName=INTEGRATIONS_APPROVAL_TABLE,
            Key={"approval_id": {"S": approval_id}},
            UpdateExpression="SET execution_status = :unknown",
            ExpressionAttributeValues={
                ":unknown": {"S": "unknown"},
            },
        )
        return {
            "status": "execution_failed",
            "message": error_msg,
        }


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
        raise ValueError(
            "No integrations are enabled for this chat session. "
            "Ask the user to enable the integration in their chat settings "
            "(integrations toggle in the chat sidebar) and try again."
        )

    result = _invoke_relay(
        operation="list_actions",
        external_user_id=external_user_id,
        parameters={"app_slug": app_slug},
    )

    return result


def handle_batch_get_schemas(params: Dict[str, Any]) -> Dict[str, Any]:
    """Batch-fetch cached integration schemas from the proxy account.

    Returns all schemas in a single call instead of per-slug list_actions calls.
    Falls back gracefully if the schema cache is not populated.

    Args:
        params: Must contain 'app_slugs' (list of str) and 'external_user_id'

    Returns:
        Dict with 'schemas' mapping slug -> {actions: [...], index: [...]}
    """
    app_slugs = params.get("app_slugs", [])
    external_user_id = params.get("external_user_id")

    if not app_slugs:
        raise ValueError("app_slugs is required")
    if not external_user_id:
        raise ValueError("external_user_id is required")

    result = _invoke_relay(
        operation="batch_get_schemas",
        external_user_id=external_user_id,
        parameters={"app_slugs": app_slugs},
    )

    return result


def _audit_pipedream_action(
    user_sub: str,
    action_key: str,
    description: str,
    auto_approved: bool,
) -> None:
    """Log a chat-driven Pipedream integration call to the vault audit table.

    Pipedream credentials live in Pipedream Connect, not the user's vault, so
    they wouldn't normally surface in "My Secrets > Activity". But users
    reasonably expect "what credentials did chat use" to include integration
    accounts — this row makes that visible. Deduped per (user, app_slug) to
    avoid spamming when the agent calls the same integration repeatedly.

    Secret name is the app slug (e.g. "google_drive", "gmail") so audit rows
    sort alongside any vault entries for the same provider.
    """
    if not VAULT_AUDIT_LOG_TABLE_NAME or not user_sub or not action_key:
        return

    dash_index = action_key.find("-")
    app_slug = action_key[:dash_index] if dash_index > 0 else action_key

    key = (user_sub, app_slug)
    now = time.time()
    last = _LAST_PIPEDREAM_AUDIT_TS.get(key, 0.0)
    if now - last < _PIPEDREAM_AUDIT_DEDUP_SECONDS:
        return
    _LAST_PIPEDREAM_AUDIT_TS[key] = now

    try:
        dynamodb = prm_client("dynamodb")
        audit_id = str(uuid.uuid4())
        ttl = int(now) + (90 * 86400)
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now))
        purpose = description or action_key
        item: Dict[str, Any] = {
            "user_id": user_sub,
            "timestamp_audit_id": f"{timestamp}#{audit_id}",
            "secret_id": f"integration-{app_slug}",
            "secret_name": f"integration-{app_slug}",
            "action": "ai_access",
            "accessor": "workspace_agent",
            "actor_email": "",
            "purpose": f"Pipedream {action_key}: {purpose}"[:200],
            "conversation_id": "",
            "approved_by": "auto" if auto_approved else "user",
            "created_at": timestamp,
            "ttl": ttl,
        }
        dynamodb.put_item(
            TableName=VAULT_AUDIT_LOG_TABLE_NAME,
            Item={
                k: {"S": str(v)} if not isinstance(v, int) else {"N": str(v)}
                for k, v in item.items()
            },
        )
    except Exception as e:
        logger.warning(
            "Failed to write Pipedream audit log",
            user_sub=user_sub,
            action_key=action_key,
            error=str(e),
        )


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
    # FEAT-019: optional per-conversation account scope. When non-empty, the
    # proxy narrows the candidate account list to this subset before resolving
    # authProvisionId:"auto". Forwarded as-is — the proxy is the authority on
    # which accounts the user actually has connected.
    allowed_account_ids = params.get("allowed_account_ids") or []
    if not isinstance(allowed_account_ids, list):
        allowed_account_ids = []
    allowed_account_ids = [x for x in allowed_account_ids if isinstance(x, str) and x]

    if not action_key:
        raise ValueError("action_key is required")
    if not external_user_id:
        raise ValueError(
            "No integrations are enabled for this chat session. "
            "Ask the user to enable the integration in their chat settings "
            "(integrations toggle in the chat sidebar) and try again."
        )

    # Check if this tool call was auto-approved by the sdk_runner
    # based on the user's/agent's approval mode setting.
    is_auto_approved = params.get("auto_approved", False)

    if not is_auto_approved:
        # Create approval request (use request_id as deterministic approval_id)
        approval_id = create_approval_request(
            user_sub=user_sub,
            action_key=action_key,
            description=description,
            props_preview=configured_props,
            annotations=annotations,
            approval_id=request_id,
        )

        # Poll for the decision
        decision, deny_reason = poll_approval(approval_id)

        if decision == "denied":
            msg = "The user denied this action."
            if deny_reason:
                msg += f' The user said: "{deny_reason}"'
            return {
                "status": "denied",
                "message": msg,
                "deny_reason": deny_reason,
                "approval_id": approval_id,
            }

        if decision == "timeout":
            return {
                "status": "timeout",
                "message": "Approval timed out",
                "approval_id": approval_id,
            }
    else:
        approval_id = request_id or str(uuid.uuid4())
        logger.info(
            "Auto-approved integration action",
            action_key=action_key,
            approval_id=approval_id,
        )

    # Approved — preprocess workspace file paths into presigned URLs.
    # Fail closed: an unresolvable /workdir reference must not be forwarded
    # (it could be stored as the file's contents by the upstream).
    try:
        configured_props = _preprocess_file_paths(
            configured_props,
            user_sub=user_sub,
            conversation_id=params.get("__conversation_id", ""),
        )
    except ValueError as exc:
        logger.warning(
            "Refused to forward unresolved workspace file path",
            action_key=action_key,
            error=str(exc),
        )
        return {
            "status": "execution_failed",
            "message": str(exc),
            "approval_id": approval_id,
        }

    # Execute the action with idempotency guard to prevent duplicate execution
    relay_params: Dict[str, Any] = {
        "action_key": action_key,
        "configured_props": configured_props,
    }
    if stash_id:
        relay_params["stash_id"] = stash_id
    if allowed_account_ids:
        relay_params["allowed_account_ids"] = allowed_account_ids

    def _do_run_action() -> Dict[str, Any]:
        result = _invoke_relay(
            operation="run_action",
            external_user_id=external_user_id,
            parameters=relay_params,
        )
        _audit_pipedream_action(user_sub, action_key, description, is_auto_approved)
        return {
            "status": "success",
            "approval_id": approval_id,
            "result": result,
        }

    return _execute_with_idempotency(approval_id, _do_run_action)


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
    # FEAT-019: optional per-conversation account scope (mirrors run_action).
    raw_allowed = params.get("allowed_account_ids") or []
    allowed_account_ids = (
        [x for x in raw_allowed if isinstance(x, str) and x]
        if isinstance(raw_allowed, list)
        else []
    )

    if not action_key:
        raise ValueError("action_key is required")
    if not prop_name:
        raise ValueError("prop_name is required")
    if not external_user_id:
        raise ValueError(
            "No integrations are enabled for this chat session. "
            "Ask the user to enable the integration in their chat settings "
            "(integrations toggle in the chat sidebar) and try again."
        )

    relay_params: Dict[str, Any] = {
        "action_key": action_key,
        "prop_name": prop_name,
        "configured_props": configured_props,
    }
    if allowed_account_ids:
        relay_params["allowed_account_ids"] = allowed_account_ids

    result = _invoke_relay(
        operation="configure_props",
        external_user_id=external_user_id,
        parameters=relay_params,
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
        raise ValueError(
            "No integrations are enabled for this chat session. "
            "Ask the user to enable the integration in their chat settings "
            "(integrations toggle in the chat sidebar) and try again."
        )

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
        approval_id = create_approval_request(
            user_sub=user_sub,
            action_key=f"proxy_{method}",
            description=description,
            props_preview={"method": method, "upstream_url": upstream_url},
            approval_id=request_id,
        )

        decision, deny_reason = poll_approval(approval_id)

        if decision == "denied":
            msg = "The user denied this action."
            if deny_reason:
                msg += f' The user said: "{deny_reason}"'
            return {
                "status": "denied",
                "message": msg,
                "deny_reason": deny_reason,
                "approval_id": approval_id,
            }

        if decision == "timeout":
            return {
                "status": "timeout",
                "message": "Approval timed out",
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

    # Approved — execute with idempotency guard
    relay_params = {
        "method": method,
        "upstream_url": upstream_url,
        "account_id": account_id,
        "body": body,
    }
    if headers:
        relay_params["headers"] = headers

    def _do_proxy_request() -> Dict[str, Any]:
        result = _invoke_relay(
            operation="proxy_request",
            external_user_id=external_user_id,
            parameters=relay_params,
        )
        _audit_pipedream_action(
            user_sub,
            f"{integration_slug}-proxy-{method.lower()}",
            description,
            is_auto_approved,
        )
        return {
            "status": "success",
            "approval_id": approval_id,
            "result": result,
        }

    return _execute_with_idempotency(approval_id, _do_proxy_request)


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


def handle_poll_connector_approval(params: Dict[str, Any]) -> Dict[str, Any]:
    """Create an approval request and poll for the user's decision.

    Generic approval gate used by the connectors MCP tool for unsafe
    operations (e.g. sending email, arbitrary HTTP requests). Reuses
    the same DynamoDB table and polling logic as integration approvals.

    Args:
        params: Must contain 'action_key', 'description', 'request_id'.
                Optional: 'auto_approved' (bool).

    Returns:
        Dict with 'status': 'approved' | 'denied' | 'timeout'
    """
    action_key = params.get("action_key", "")
    description = params.get("description", "")
    request_id = params.get("request_id")
    user_sub = params.get("__user_sub", "")
    is_auto_approved = params.get("auto_approved", False)

    if is_auto_approved:
        return {"status": "approved", "approval_id": request_id or "auto"}

    approval_id = create_approval_request(
        user_sub=user_sub,
        action_key=action_key,
        description=description,
        props_preview={},
        approval_id=request_id,
    )

    decision, _ = poll_approval(approval_id)

    return {
        "status": decision,
        "approval_id": approval_id,
    }
