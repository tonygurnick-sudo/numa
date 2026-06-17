"""
Enhanced vault secrets tool handlers for workspace-chat-tools with consolidated vault support.

Handles consolidated vault secret operations for the workspace agent:
- vault_list_consolidated_secrets: List secrets from consolidated vault
- vault_request_consolidated_secret: Request a secret with approval flow
- oauth_list_connectors: List OAuth connectors for a provider
- oauth_create_connector: Create new OAuth connector using templates
- vault_create_custom_secret: Create custom free-form secret
- vault_delete_secret: Delete a secret with approval
- vault_list_templates: List available templates

Secrets are stored in consolidated AWS Secrets Manager per user with templates.
User isolation is enforced via user_sub from JWT.
"""

import json
import os
import sys
import time
import uuid
from typing import Any, Dict, Optional

import structlog

from prm import client as prm_client

from .approval import (
    APPROVAL_POLL_INTERVAL_SECONDS,
    APPROVAL_TIMEOUT_SECONDS,
    approval_is_unattended,
)

# Import consolidated vault functions from same Lambda
try:
    # Add parent directory to path to import modules from Lambda root
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from consolidated_storage import (
        add_secret_to_vault,
        create_freeform_secret,
        get_consolidated_vault,
        get_template,
        get_vault_secret,
        list_vault_secrets,
        remove_secret_from_vault,
    )
    from enhanced_oauth_tools import (
        get_user_oauth_connectors,
    )
    from template_engine import FreeFormValidator, TemplateManager

    CONSOLIDATED_VAULT_AVAILABLE = True
except ImportError as e:
    logger = structlog.get_logger()
    logger.warning("Consolidated vault modules not available", error=str(e))
    CONSOLIDATED_VAULT_AVAILABLE = False

logger = structlog.get_logger()

# Table names from environment
VAULT_AUDIT_LOG_TABLE = os.environ.get("VAULT_AUDIT_LOG_TABLE_NAME", "")
INTEGRATIONS_APPROVAL_TABLE = os.environ.get("INTEGRATIONS_APPROVAL_TABLE_NAME", "")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "")


def _write_audit_log(
    user_id: str,
    secret_name: str,
    action: str,
    accessor: str = "workspace_agent",
    purpose: str = "",
    conversation_id: str = "",
    approved_by: str = "",
) -> None:
    """Write an entry to the vault audit log table."""
    if not VAULT_AUDIT_LOG_TABLE:
        logger.warning("VAULT_AUDIT_LOG_TABLE_NAME not configured, skipping audit log")
        return

    try:
        dynamodb = prm_client("dynamodb")
        now = time.time()
        audit_id = str(uuid.uuid4())
        ttl = int(now) + (90 * 86400)  # 90 days

        item = {
            "user_id": user_id,
            "timestamp_audit_id": f"{time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(now))}#{audit_id}",
            "secret_id": secret_name,  # Using secret name as ID for consolidated system
            "secret_name": secret_name,
            "action": action,
            "accessor": accessor,
            "purpose": purpose,
            "conversation_id": conversation_id,
            "approved_by": approved_by,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)),
            "ttl": ttl,
        }

        dynamodb.put_item(
            TableName=VAULT_AUDIT_LOG_TABLE,
            Item={
                k: {"S": str(v)} if not isinstance(v, int) else {"N": str(v)}
                for k, v in item.items()
            },
        )
    except Exception as e:
        logger.error("Failed to write audit log", error=str(e))


def _create_approval_request(
    user_sub: str,
    action_type: str,
    action_data: Dict[str, Any],
    request_id: str = "",
) -> str:
    """Create an approval request and return the approval ID."""
    if not INTEGRATIONS_APPROVAL_TABLE:
        logger.warning("INTEGRATIONS_APPROVAL_TABLE_NAME not configured")
        return ""

    try:
        dynamodb = prm_client("dynamodb")
        approval_id = request_id or str(uuid.uuid4())
        now = int(time.time())
        ttl = now + APPROVAL_TIMEOUT_SECONDS

        item = {
            "approval_id": approval_id,
            "user_sub": user_sub,
            "action_type": action_type,
            "action_data": json.dumps(action_data),
            "status": "pending",
            "created_at": now,
            "ttl": ttl,
        }

        dynamodb.put_item(
            TableName=INTEGRATIONS_APPROVAL_TABLE,
            Item={
                k: {"S": str(v)} if not isinstance(v, int) else {"N": str(v)}
                for k, v in item.items()
            },
        )

        return approval_id
    except Exception as e:
        logger.error("Failed to create approval request", error=str(e))
        return ""


def _poll_approval_status(
    approval_id: str, poll_started_at: Optional[float] = None
) -> Optional[str]:
    """Poll for approval status.

    Returns 'approved', 'denied', 'unattended' (only when ``poll_started_at``
    is supplied), or None if still pending.
    """
    if not INTEGRATIONS_APPROVAL_TABLE or not approval_id:
        return None

    try:
        dynamodb = prm_client("dynamodb")
        response = dynamodb.get_item(
            TableName=INTEGRATIONS_APPROVAL_TABLE,
            Key={"approval_id": {"S": approval_id}},
        )

        if "Item" not in response:
            return None

        item = response["Item"]
        status = item.get("status", {}).get("S", "pending")
        if status in ("approved", "denied"):
            return status
        if poll_started_at is not None and approval_is_unattended(
            item, poll_started_at
        ):
            return "unattended"
        return None
    except Exception as e:
        logger.error(
            "Failed to poll approval status", approval_id=approval_id, error=str(e)
        )
        return None


def _wait_for_approval(approval_id: str) -> bool:
    """Wait for user approval. Returns True if approved, False if denied or timeout."""
    if not approval_id:
        return False

    logger.info("Waiting for approval", approval_id=approval_id)

    # Anchor the deadline to the DDB record's created_at (matches
    # tools.approval.poll_approval; see comment there for the rationale).
    deadline = time.time() + APPROVAL_TIMEOUT_SECONDS  # fallback
    if INTEGRATIONS_APPROVAL_TABLE:
        try:
            dynamodb = prm_client("dynamodb")
            initial = dynamodb.get_item(
                TableName=INTEGRATIONS_APPROVAL_TABLE,
                Key={"approval_id": {"S": approval_id}},
            )
            created_at_str = initial.get("Item", {}).get("created_at", {}).get("N")
            if created_at_str:
                deadline = max(
                    int(created_at_str) + APPROVAL_TIMEOUT_SECONDS,
                    time.time() + 30,
                )
        except Exception as e:
            logger.warning(
                "Could not read created_at for approval deadline anchor; "
                "falling back to wall-clock deadline",
                approval_id=approval_id,
                error=str(e),
            )

    poll_started_at = time.time()

    while time.time() < deadline:
        status = _poll_approval_status(approval_id, poll_started_at)

        if status == "approved":
            logger.info("Approval granted", approval_id=approval_id)
            return True
        elif status == "denied":
            logger.info("Approval denied", approval_id=approval_id)
            return False
        elif status == "unattended":
            logger.warning(
                "Approval unattended — card never acknowledged",
                _name="APPROVAL_UNATTENDED",
                approval_id=approval_id,
            )
            return False

        time.sleep(APPROVAL_POLL_INTERVAL_SECONDS)

    logger.warning("Approval timeout", approval_id=approval_id)
    return False


# ---------------------------------------------------------------------------
# Consolidated Vault Tool Handlers
# ---------------------------------------------------------------------------


def handle_vault_list_consolidated_secrets(params: Dict[str, Any]) -> Dict[str, Any]:
    """List secrets from user's consolidated vault."""
    if not CONSOLIDATED_VAULT_AVAILABLE:
        return {"error": "Consolidated vault system not available"}

    try:
        user_sub = params.get("user_sub", "")
        provider = params.get("provider")
        category = params.get("category")

        if not user_sub:
            return {"error": "user_sub is required"}

        # Get all secrets from consolidated vault
        all_secrets = list_vault_secrets(user_sub, CLIENT_NAME)

        # Apply filters
        filtered_secrets = []
        for secret in all_secrets:
            # Provider filter
            if provider:
                secret_type = secret.get("type", "")
                template = secret.get("template", "")

                matches_provider = (
                    secret_type == provider
                    or template == f"{provider}-oauth"
                    or (
                        template is None
                        and provider.lower() in secret.get("name", "").lower()
                    )
                )

                if not matches_provider:
                    continue

            # Category filter
            if category and secret.get("category") != category:
                continue

            filtered_secrets.append(secret)

        # Get vault metadata
        vault_info = get_consolidated_vault(user_sub, CLIENT_NAME)

        return {
            "secrets": filtered_secrets,
            "vault_info": {
                "vault_metadata": vault_info.get("metadata", {}),
                "secret_count": len(all_secrets),
                "filtered_count": len(filtered_secrets),
            },
        }

    except Exception as e:
        logger.error(
            "Failed to list consolidated secrets", user_sub=user_sub, error=str(e)
        )
        return {"error": f"Failed to list secrets: {str(e)}"}


def handle_vault_request_consolidated_secret(params: Dict[str, Any]) -> Dict[str, Any]:
    """Request a specific secret from consolidated vault with approval flow."""
    if not CONSOLIDATED_VAULT_AVAILABLE:
        return {"error": "Consolidated vault system not available"}

    try:
        user_sub = params.get("user_sub", "")
        secret_name = params.get("secret_name", "")
        purpose = params.get("purpose", "AI assistant usage")
        request_id = params.get("request_id", "")
        conversation_id = params.get("conversation_id", "")

        if not user_sub or not secret_name:
            return {"error": "user_sub and secret_name are required"}

        # Get secret metadata to check danger_mode
        secret = get_vault_secret(user_sub, secret_name, CLIENT_NAME)
        if not secret:
            return {"error": f"Secret '{secret_name}' not found"}

        danger_mode = secret.get("danger_mode", False)

        # If danger_mode is enabled, skip approval
        if danger_mode:
            _write_audit_log(
                user_sub,
                secret_name,
                "ai_access",
                purpose=purpose,
                conversation_id=conversation_id,
                approved_by="danger_mode",
            )

            return {"secret": secret}

        # Create approval request
        approval_id = _create_approval_request(
            user_sub,
            "vault_access",
            {
                "secret_name": secret_name,
                "purpose": purpose,
                "conversation_id": conversation_id,
            },
            request_id,
        )

        if not approval_id:
            return {"error": "Failed to create approval request"}

        # If request_id was provided, it might be pre-approved
        if request_id:
            approval_status = _poll_approval_status(approval_id)
            if approval_status == "approved":
                _write_audit_log(
                    user_sub,
                    secret_name,
                    "ai_access",
                    purpose=purpose,
                    conversation_id=conversation_id,
                    approved_by="user",
                )
                return {"secret": secret}

        # Return approval required response
        return {
            "approval_required": True,
            "approval_id": approval_id,
            "secret_name": secret_name,
            "purpose": purpose,
        }

    except Exception as e:
        logger.error(
            "Failed to request consolidated secret",
            user_sub=user_sub,
            secret_name=secret_name,
            error=str(e),
        )
        return {"error": f"Failed to request secret: {str(e)}"}


def handle_oauth_list_connectors(params: Dict[str, Any]) -> Dict[str, Any]:
    """List OAuth connectors for a specific provider."""
    if not CONSOLIDATED_VAULT_AVAILABLE:
        return {"error": "Consolidated vault system not available"}

    try:
        user_sub = params.get("user_sub", "")
        provider = params.get("provider", "")

        if not user_sub or not provider:
            return {"error": "user_sub and provider are required"}

        connectors = get_user_oauth_connectors(provider, user_sub)

        return {"connectors": connectors}

    except Exception as e:
        logger.error(
            "Failed to list OAuth connectors",
            user_sub=user_sub,
            provider=provider,
            error=str(e),
        )
        return {"error": f"Failed to list OAuth connectors: {str(e)}"}


def handle_oauth_create_connector(params: Dict[str, Any]) -> Dict[str, Any]:
    """Create new OAuth connector using templates."""
    if not CONSOLIDATED_VAULT_AVAILABLE:
        return {"error": "Consolidated vault system not available"}

    try:
        user_sub = params.get("user_sub", "")
        provider = params.get("provider", "")
        connector_name = params.get("connector_name", "")
        _display_name = params.get("display_name", "")
        _description = params.get("description", "")

        if not user_sub or not provider or not connector_name:
            return {"error": "user_sub, provider, and connector_name are required"}

        # Check if template exists for this provider
        template_name = f"{provider}-oauth"
        template = get_template(template_name, CLIENT_NAME)

        if not template:
            return {"error": f"No OAuth template found for provider '{provider}'"}

        # For now, return instructions for OAuth flow
        # In a full implementation, this would integrate with oauth-auth-handler
        auth_url = f"https://oauth-provider.com/authorize?provider={provider}&connector={connector_name}"

        return {
            "auth_url": auth_url,
            "connector_name": connector_name,
            "provider": provider,
            "template": template_name,
            "status": "auth_required",
        }

    except Exception as e:
        logger.error(
            "Failed to create OAuth connector",
            user_sub=user_sub,
            provider=provider,
            error=str(e),
        )
        return {"error": f"Failed to create OAuth connector: {str(e)}"}


def handle_vault_create_custom_secret(params: Dict[str, Any]) -> Dict[str, Any]:
    """Create a custom free-form secret."""
    if not CONSOLIDATED_VAULT_AVAILABLE:
        return {"error": "Consolidated vault system not available"}

    try:
        user_sub = params.get("user_sub", "")
        secret_name = params.get("secret_name", "")
        display_name = params.get("display_name", secret_name)
        secret_type = params.get("secret_type", "custom")
        category = params.get("category", "Custom")
        description = params.get("description", "")
        fields = params.get("fields", {})

        if not user_sub or not secret_name or not fields:
            return {"error": "user_sub, secret_name, and fields are required"}

        # Validate free-form secret
        validator = FreeFormValidator()
        is_valid, errors = validator.validate_complete_freeform({"fields": fields})
        if not is_valid:
            return {"error": f"Validation failed: {', '.join(errors)}"}

        # Create free-form secret
        secret_data = create_freeform_secret(
            {
                "display_name": display_name,
                "type": secret_type,
                "category": category,
                "description": description,
                "fields": fields,
            }
        )

        # Add to user vault
        created_secret = add_secret_to_vault(
            user_sub, secret_name, secret_data, None, CLIENT_NAME
        )

        # Write audit log
        _write_audit_log(
            user_sub, secret_name, "user_create", accessor="workspace_agent"
        )

        return {
            "secret": {
                "name": secret_name,
                "display_name": created_secret.get("display_name"),
                "type": secret_type,
                "category": category,
                "created": True,
            }
        }

    except Exception as e:
        logger.error(
            "Failed to create custom secret",
            user_sub=user_sub,
            secret_name=secret_name,
            error=str(e),
        )
        return {"error": f"Failed to create custom secret: {str(e)}"}


def handle_vault_delete_secret(params: Dict[str, Any]) -> Dict[str, Any]:
    """Delete a secret with approval."""
    if not CONSOLIDATED_VAULT_AVAILABLE:
        return {"error": "Consolidated vault system not available"}

    try:
        user_sub = params.get("user_sub", "")
        secret_name = params.get("secret_name", "")
        request_id = params.get("request_id", "")
        conversation_id = params.get("conversation_id", "")

        if not user_sub or not secret_name:
            return {"error": "user_sub and secret_name are required"}

        # Check if secret exists
        secret = get_vault_secret(user_sub, secret_name, CLIENT_NAME)
        if not secret:
            return {"error": f"Secret '{secret_name}' not found"}

        # Create approval request for deletion
        approval_id = _create_approval_request(
            user_sub,
            "vault_delete",
            {"secret_name": secret_name, "conversation_id": conversation_id},
            request_id,
        )

        if not approval_id:
            return {"error": "Failed to create approval request"}

        # Check if pre-approved
        if request_id:
            approval_status = _poll_approval_status(approval_id)
            if approval_status == "approved":
                success = remove_secret_from_vault(user_sub, secret_name, CLIENT_NAME)
                if success:
                    _write_audit_log(
                        user_sub,
                        secret_name,
                        "user_delete",
                        accessor="workspace_agent",
                        conversation_id=conversation_id,
                        approved_by="user",
                    )
                    return {"success": True, "deleted": secret_name}
                else:
                    return {"error": "Failed to delete secret"}

        # Return approval required response
        return {
            "approval_required": True,
            "approval_id": approval_id,
            "secret_name": secret_name,
            "action": "delete",
        }

    except Exception as e:
        logger.error(
            "Failed to delete secret",
            user_sub=user_sub,
            secret_name=secret_name,
            error=str(e),
        )
        return {"error": f"Failed to delete secret: {str(e)}"}


def handle_vault_list_templates(params: Dict[str, Any]) -> Dict[str, Any]:
    """List available templates."""
    if not CONSOLIDATED_VAULT_AVAILABLE:
        return {"error": "Consolidated vault system not available"}

    try:
        category = params.get("category")

        template_manager = TemplateManager(CLIENT_NAME)
        templates = template_manager.list_templates()

        # Apply category filter if specified
        if category:
            templates = [t for t in templates if t.get("category") == category]

        return {"templates": templates}

    except Exception as e:
        logger.error("Failed to list templates", error=str(e))
        return {"error": f"Failed to list templates: {str(e)}"}


# ---------------------------------------------------------------------------
# Tool Handler Registry
# ---------------------------------------------------------------------------

# Map tool names to their handlers
CONSOLIDATED_TOOL_HANDLERS = {
    "vault_list_consolidated_secrets": handle_vault_list_consolidated_secrets,
    "vault_request_consolidated_secret": handle_vault_request_consolidated_secret,
    "oauth_list_connectors": handle_oauth_list_connectors,
    "oauth_create_connector": handle_oauth_create_connector,
    "vault_create_custom_secret": handle_vault_create_custom_secret,
    "vault_delete_secret": handle_vault_delete_secret,
    "vault_list_templates": handle_vault_list_templates,
}


def get_consolidated_tool_handler(tool_name: str):
    """Get the handler function for a consolidated vault tool."""
    return CONSOLIDATED_TOOL_HANDLERS.get(tool_name)
