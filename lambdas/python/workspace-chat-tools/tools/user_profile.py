"""
User profile memory management tool handlers.

Provides list, add, and update operations for user memories stored in the
chat-settings DynamoDB table under the `userProfile.memories` attribute.

All memories created or updated through these handlers are tagged with
`source: 'ai'` to distinguish them from user-created memories.
"""

import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import structlog

from prm import resource

from .approval import check_approval, create_approval_request, poll_approval

logger = structlog.get_logger()

# Environment variables
CHAT_SETTINGS_TABLE_NAME = os.environ.get("CHAT_SETTINGS_TABLE_NAME")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Validation constants (must match lambdas/node/chat-settings/index.ts)
MAX_MEMORY_CONTENT = 300
MAX_MEMORIES = 50
VALID_SCOPE_PATTERN = re.compile(r"^(general|integration:.+|agent:.+)$")

# Canonical set of slugs a memory may be scoped to via `integration:{slug}`.
# Mirrors infra/config/integrations.ts (SUPPORTED_INTEGRATIONS) and
# infra/config/connectors.ts (NATIVE_CONNECTORS). This Lambda can't import the
# TypeScript registries, so the lists are duplicated here.
#
# ⚠️ When you add or rename an integration slug in either of those TS files,
# MIRROR THE CHANGE here in the same commit — otherwise a memory the model
# legitimately scopes to the new integration silently falls back to "general".
_PIPEDREAM_INTEGRATION_SLUGS = {
    "gmail",
    "microsoft_outlook",
    "microsoft_outlook_calendar",
    "slack",
    "google_calendar",
    "xero_accounting_api",
    "hubspot",
    "notion",
    "apollo_io",
    "pipedrive",
    "jira",
    "linkedin",
    "google_drive",
    "google_analytics",
    "sharepoint",
    "salesforce_rest_api",
    "asana",
    "onenote",
    "trello",
    "whatsapp_business",
    "mailchimp",
    "freshdesk",
    "rentman",
    "podio",
    "google_sheets",
    "google_forms",
    "google_docs",
    "telegram_bot_api",
    "microsoft_teams",
    "zoom",
    "microsoft_excel",
    "smartsheet",
    "box",
    "zoho_books",
    "odoo",
    "jobber",
    "canva",
    "google_tag_manager",
    "webflow",
    "dropbox",
    "survey_monkey",
    "monday",
    "procore",
    "quickbooks",
    "harvest",
    "alchemer",
    "microsoft_sql_server",
    "microsoft_dynamics_365_sales",
    "dynamics_365_business_central_api",
    "clickup",
    "google_ads",
    "zoho_crm",
    "microsofttodo",
    "fathom",
    "elevenlabs",
}
_NATIVE_CONNECTOR_SLUGS = {
    "googledrive",
    "gmail",
    "onedrive",
    "dropbox",
    "workflowmax",
    "podio",
    "simpro",
    "getjobber",
    "wrike",
    "connecteam-oauth",
    "totalsynergy-oauth",
    "xero",
    "myob-account-right",
    "myob-acumatica",
    "netsuite",
    "zoho-crm",
    "quickbooks",
    "actionstep",
    "jobadder",
    "hirehop",
    "connecteam-api",
    "totalsynergy-api",
    "synergy",
    "workbench",
    "fergus",
    "jiwa",
    "cin7-omni",
    "cin7-core",
    "gohighlevel",
    "rentman",
    "proworkflow",
    "betterimpact",
    "greentree",
}
VALID_INTEGRATION_SLUGS = _PIPEDREAM_INTEGRATION_SLUGS | _NATIVE_CONNECTOR_SLUGS


def _validate_integration_scope(scope: str) -> None:
    """Reject an ``integration:{slug}`` scope whose slug isn't a real integration.

    The model chooses the scope string freely and sometimes scopes a memory to
    a tool group or feature name (e.g. ``integration:numa-ops``) that is not a
    real SaaS integration. We reject it outright (rather than silently saving it
    as a general memory) so the model gets clear feedback and can re-scope —
    either to a valid integration or explicitly to ``general``.
    """
    if not scope.startswith("integration:"):
        return
    slug = scope[len("integration:") :]
    if slug not in VALID_INTEGRATION_SLUGS:
        raise ValueError(
            f"'{slug}' is not a recognised integration, so it can't be used as a "
            "memory scope. Use a real integration slug (e.g. 'jira', 'slack', "
            "'gmail', 'google_drive', 'sharepoint') or scope the memory as "
            "'general'. Tool groups and feature names (e.g. 'numa-ops', 'numa', "
            "'web-search') are not integrations."
        )


def _get_dynamo_resource():
    """Get DynamoDB resource with PRM tracking."""
    return resource("dynamodb", region=AWS_REGION)


def _load_user_profile(user_sub: str) -> Dict[str, Any]:
    """Load the user's profile from DynamoDB, returning a default if not found."""
    table = _get_dynamo_resource().Table(CHAT_SETTINGS_TABLE_NAME)
    response = table.get_item(Key={"user_id": user_sub}, ConsistentRead=True)
    item = response.get("Item", {})
    return item.get("userProfile", {})


def _save_user_profile(user_sub: str, profile: Dict[str, Any]) -> None:
    """Write the user profile back to DynamoDB (SET userProfile + updatedAt)."""
    table = _get_dynamo_resource().Table(CHAT_SETTINGS_TABLE_NAME)
    now = datetime.now(timezone.utc).isoformat()
    table.update_item(
        Key={"user_id": user_sub},
        UpdateExpression="SET userProfile = :p, updatedAt = :u",
        ExpressionAttributeValues={":p": profile, ":u": now},
    )


def _validate_memory(mem: Dict[str, Any]) -> bool:
    """Check if a memory dict has valid id, content, and scope."""
    mem_id = mem.get("id", "")
    content = mem.get("content", "")
    scope = mem.get("scope", "")
    return bool(mem_id and content and VALID_SCOPE_PATTERN.match(scope))


def _filter_memories(
    memories: List[Dict[str, Any]], scope: Optional[str]
) -> List[Dict[str, Any]]:
    """Filter memories by scope if provided."""
    if not scope:
        return memories
    return [m for m in memories if m.get("scope") == scope]


# =============================================================================
# HANDLERS
# =============================================================================


def handle_list_memories(params: Dict[str, Any]) -> Dict[str, Any]:
    """List the user's memories, optionally filtered by scope."""
    # HITL approval gate
    denial = check_approval(
        params,
        action_key="numa_memories_list",
        description="List memories",
    )
    if denial:
        return denial

    if not CHAT_SETTINGS_TABLE_NAME:
        raise ValueError("CHAT_SETTINGS_TABLE_NAME not configured")

    user_sub = params.get("__user_sub", "")
    scope = params.get("scope")

    logger.info("Listing memories", user_sub=user_sub[:8] + "...", scope=scope)

    profile = _load_user_profile(user_sub)
    memories = profile.get("memories", [])

    # Validate each memory before returning
    valid_memories = [m for m in memories if _validate_memory(m)]
    filtered = _filter_memories(valid_memories, scope)

    logger.info(
        "Memories listed",
        total=len(valid_memories),
        filtered=len(filtered),
        scope=scope,
    )

    return {
        "memories": filtered,
        "total_count": len(valid_memories),
        "filtered_count": len(filtered),
    }


def _check_memory_approval(
    params: Dict[str, Any],
    action_key: str,
    description: str,
    props_preview: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Check approval for memory operations. Returns denial dict or None."""
    request_id = params.get("request_id")
    if not request_id:
        return None

    is_auto_approved = params.get("auto_approved", False)
    if is_auto_approved:
        return None

    user_sub = params.get("__user_sub", "")
    approval_id = create_approval_request(
        user_sub=user_sub,
        action_key=action_key,
        description=description,
        props_preview=props_preview,
        approval_id=request_id,
    )

    decision, deny_reason = poll_approval(approval_id)

    if decision == "denied":
        msg = "The user denied this action."
        if deny_reason:
            msg += f' The user said: "{deny_reason}"'
        return {"status": "denied", "message": msg, "deny_reason": deny_reason}

    if decision == "timeout":
        return {"status": "timeout", "message": "Approval timed out"}

    return None


def handle_add_memory(params: Dict[str, Any]) -> Dict[str, Any]:
    """Add a new memory for the user."""
    if not CHAT_SETTINGS_TABLE_NAME:
        raise ValueError("CHAT_SETTINGS_TABLE_NAME not configured")

    user_sub = params.get("__user_sub", "")
    content = params.get("content", "").strip()
    scope = params.get("scope", "general").strip()

    # HITL approval gate
    denial = _check_memory_approval(
        params,
        action_key="numa_memories_add",
        description=f"Add memory: {content[:80]}{'...' if len(content) > 80 else ''}",
        props_preview={"content": content[:200], "scope": scope},
    )
    if denial:
        return denial

    # Validate content
    if not content:
        raise ValueError("Memory content is required")
    if len(content) > MAX_MEMORY_CONTENT:
        raise ValueError(
            f"Memory content exceeds {MAX_MEMORY_CONTENT} characters "
            f"(got {len(content)})"
        )

    # Validate scope
    if not VALID_SCOPE_PATTERN.match(scope):
        raise ValueError(
            f"Invalid scope '{scope}'. Must be 'general', "
            "'integration:{{slug}}', or 'agent:{{agentId}}'"
        )

    # Reject integration scopes that don't name a real integration (e.g. a tool
    # group like "numa-ops") so the model re-scopes instead of saving junk.
    _validate_integration_scope(scope)

    logger.info(
        "Adding memory",
        user_sub=user_sub[:8] + "...",
        scope=scope,
        content_length=len(content),
    )

    # Load current profile
    profile = _load_user_profile(user_sub)
    memories = profile.get("memories", [])

    # Validate existing memories and check limit
    valid_memories = [m for m in memories if _validate_memory(m)]
    if len(valid_memories) >= MAX_MEMORIES:
        raise ValueError(
            f"Maximum of {MAX_MEMORIES} memories reached. "
            "Update or delete existing memories to make room."
        )

    # Create new memory
    memory_id = f"mem_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    new_memory = {
        "id": memory_id,
        "content": content,
        "scope": scope,
        "createdAt": now,
        "source": "ai",
    }

    # Append and save
    valid_memories.append(new_memory)
    profile["memories"] = valid_memories
    _save_user_profile(user_sub, profile)

    logger.info(
        "Memory added",
        memory_id=memory_id,
        scope=scope,
        total_memories=len(valid_memories),
    )

    return {"memory": new_memory, "total_count": len(valid_memories)}


def handle_update_memory(params: Dict[str, Any]) -> Dict[str, Any]:
    """Update an existing memory's content."""
    if not CHAT_SETTINGS_TABLE_NAME:
        raise ValueError("CHAT_SETTINGS_TABLE_NAME not configured")

    user_sub = params.get("__user_sub", "")
    memory_id = params.get("memory_id", "").strip()
    content = params.get("content", "").strip()

    # HITL approval gate
    denial = _check_memory_approval(
        params,
        action_key="numa_memories_update",
        description=f"Update memory: {content[:80]}{'...' if len(content) > 80 else ''}",
        props_preview={"memory_id": memory_id, "content": content[:200]},
    )
    if denial:
        return denial

    # Validate inputs
    if not memory_id:
        raise ValueError("memory_id is required")
    if not content:
        raise ValueError("Memory content is required")
    if len(content) > MAX_MEMORY_CONTENT:
        raise ValueError(
            f"Memory content exceeds {MAX_MEMORY_CONTENT} characters "
            f"(got {len(content)})"
        )

    logger.info(
        "Updating memory",
        user_sub=user_sub[:8] + "...",
        memory_id=memory_id,
        content_length=len(content),
    )

    # Load current profile
    profile = _load_user_profile(user_sub)
    memories = profile.get("memories", [])

    # Find the memory to update
    found = False
    for mem in memories:
        if mem.get("id") == memory_id:
            mem["content"] = content
            mem["source"] = "ai"
            found = True
            break

    if not found:
        raise ValueError(f"Memory '{memory_id}' not found")

    # Save back
    profile["memories"] = memories
    _save_user_profile(user_sub, profile)

    # Return the updated memory
    updated = next(m for m in memories if m.get("id") == memory_id)

    logger.info("Memory updated", memory_id=memory_id)

    return {"memory": updated}
