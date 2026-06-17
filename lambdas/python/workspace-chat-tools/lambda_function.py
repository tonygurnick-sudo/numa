"""
workspace-chat-tools Lambda Function.

Provides tool implementations for the workspace-chat-agent.
Tools are dispatched based on the 'tool' field in the event.

Event format:
{
    "tool": "query_knowledgebase",
    "allowed_kbs": ["company", "kb-uuid-1"],  # Required for KB tools - fail closed
    "params": {
        "query": "...",
        "user_intent": "...",
        "kb_id": "company",
        ...
    }
}

Security (fail-closed):
- allowed_kbs missing/None: Deny all KB access
- allowed_kbs empty []: Deny all KB access
- allowed_kbs ["company", ...]: Only allow listed KBs

Response format:
{
    "status": "success" | "error",
    "result": {...} | None,
    "error": "..." | None
}
"""

import logging
import time
from typing import Any, Callable, Dict

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

from tools import (
    handle_add_memory,
    handle_add_to_kb,
    handle_approve_action,
    handle_batch_get_schemas,
    handle_configure_props,
    handle_convert_document,
    handle_convert_preview,
    handle_create_agent,
    handle_delete_agent,
    handle_delete_kb_file,
    handle_delete_memory,
    handle_duplicate_agent,
    handle_extract_content,
    handle_get_agent,
    handle_list_actions,
    handle_list_agents,
    handle_list_kb_files,
    handle_list_memories,
    handle_ops_operation,
    handle_patch_agent_prompt,
    handle_poll_connector_approval,
    handle_proxy_request,
    handle_query_knowledgebase,
    handle_retrieve_kb_file,
    handle_run_action,
    handle_transcribe,
    handle_update_agent,
    handle_update_memory,
    handle_view_image,
    handle_web_search,
)
from tools.enhanced_vault_connectors import (
    handle_oauth_create_connector,
    handle_oauth_list_connectors,
    handle_vault_create_custom_secret,
    handle_vault_delete_secret,
    handle_vault_list_consolidated_secrets,
    handle_vault_list_templates,
    handle_vault_request_consolidated_secret,
)
from tools.kb_permissions import verify_kb_access

# ── Simple Logging Configuration ───────────────────────────────────────────────
# Lambda's native logging captures stdout/stderr and sends to CloudWatch.
# We use structlog routed through stdlib logging for structured JSON output.


def _setup_logging() -> None:
    """Configure structlog with stdlib integration for Lambda's native CloudWatch logging."""
    log_level = logging.INFO

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Clear existing handlers (Lambda may add some)
    root_logger.handlers.clear()

    # Add console handler for Lambda's stdout capture
    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level)
    root_logger.addHandler(console_handler)

    # Configure structlog to route through stdlib logging
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.JSONRenderer(sort_keys=True),
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )


_setup_logging()

logger = structlog.get_logger()

# Tool handlers registry
TOOL_HANDLERS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    "add_to_kb": handle_add_to_kb,
    "delete_kb_file": handle_delete_kb_file,
    "convert_document": handle_convert_document,
    "convert_preview": handle_convert_preview,
    "create_agent": handle_create_agent,
    "delete_agent": handle_delete_agent,
    "duplicate_agent": handle_duplicate_agent,
    "extract_content": handle_extract_content,
    "get_agent": handle_get_agent,
    "list_agents": handle_list_agents,
    "list_kb_files": handle_list_kb_files,
    "patch_agent_prompt": handle_patch_agent_prompt,
    "query_knowledgebase": handle_query_knowledgebase,
    "retrieve_kb_file": handle_retrieve_kb_file,
    "update_agent": handle_update_agent,
    "transcribe": handle_transcribe,
    "view_image": handle_view_image,
    "web_search": handle_web_search,
    "pipedream_list_actions": handle_list_actions,
    "pipedream_batch_get_schemas": handle_batch_get_schemas,
    "pipedream_run_action": handle_run_action,
    "pipedream_configure_props": handle_configure_props,
    "pipedream_proxy_request": handle_proxy_request,
    "pipedream_approve_action": handle_approve_action,
    "poll_connector_approval": handle_poll_connector_approval,
    "user_profile_list_memories": handle_list_memories,
    "user_profile_add_memory": handle_add_memory,
    "user_profile_update_memory": handle_update_memory,
    "user_profile_delete_memory": handle_delete_memory,
    # Consolidated Vault Tools
    "vault_list_consolidated_secrets": handle_vault_list_consolidated_secrets,
    "vault_request_consolidated_secret": handle_vault_request_consolidated_secret,
    "oauth_list_connectors": handle_oauth_list_connectors,
    "oauth_create_connector": handle_oauth_create_connector,
    "vault_create_custom_secret": handle_vault_create_custom_secret,
    "vault_delete_secret": handle_vault_delete_secret,
    "vault_list_templates": handle_vault_list_templates,
}


def handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Main Lambda handler with tool-based dispatch.

    Args:
        event: Lambda event with 'tool', 'allowed_kbs', and 'params' fields
        context: Lambda context (unused)

    Returns:
        Response dict with status, result, and optional error
    """
    start_time = time.time()
    del context  # Unused

    tool_name = event.get("tool")
    allowed_kbs = event.get("allowed_kbs")  # Security: list of allowed KB IDs
    allowed_kbs_with_names = event.get(
        "allowed_kbs_with_names", []
    )  # Full objects for attribution
    user_sub = event.get("user_sub", "")  # For server-side KB permission verification
    conversation_id = event.get("conversation_id", "")  # For workspace file S3 paths
    id_token = event.get(
        "id_token", ""
    )  # Raw Cognito JWT for AssumeRoleWithWebIdentity
    params = event.get("params", {})

    # Auto-inject root KB (user_sub) into allowed_kbs so users can always
    # access their own root files. Server-side permission checks in the tool
    # handlers verify actual ownership (kb_id == user_sub).
    if user_sub and allowed_kbs and isinstance(allowed_kbs, list):
        if user_sub not in allowed_kbs:
            allowed_kbs = [*allowed_kbs, user_sub]

    # Log full request details for debugging
    logger.info(
        "Received tool request",
        tool=tool_name,
        allowed_kbs=allowed_kbs,
        params_keys=list(params.keys()),
        query_preview=params.get("query", "")[:100] if params.get("query") else None,
        user_intent_preview=(
            params.get("user_intent", "")[:100] if params.get("user_intent") else None
        ),
        kb_id=params.get("kb_id"),
        max_results=params.get("max_results"),
        summarise_results=params.get("summarise_results"),
    )

    if not tool_name:
        logger.warning("Missing tool field in event")
        return {
            "status": "error",
            "result": None,
            "error": "Missing 'tool' field in request",
        }

    handler_fn = TOOL_HANDLERS.get(tool_name)
    # Route ops_* tool names to the generic ops handler
    if not handler_fn and tool_name and tool_name.startswith("ops_"):
        handler_fn = handle_ops_operation
    if not handler_fn:
        logger.warning(
            "Unknown tool requested",
            tool=tool_name,
            available_tools=list(TOOL_HANDLERS.keys()),
        )
        return {
            "status": "error",
            "result": None,
            "error": f"Unknown tool: {tool_name}. Available tools: {list(TOOL_HANDLERS.keys())}",
        }

    # Security: Validate KB access before dispatch (fail-closed)
    if tool_name == "query_knowledgebase":
        all_kbs_mode = params.get("all_kbs", False)
        kb_id = (params.get("kb_id") or "company").strip() or "company"

        # Fail closed: allowed_kbs must be provided and non-empty
        if not allowed_kbs:
            logger.warning(
                "KB access denied - no KBs enabled",
                kb_id=kb_id,
                all_kbs_mode=all_kbs_mode,
                allowed_kbs=allowed_kbs,
            )
            return {
                "status": "error",
                "result": None,
                "error": "No Numa Files folders are enabled for this conversation",
            }

        # For all_kbs mode, we query all allowed KBs (no single kb_id validation needed)
        # For single KB mode, validate that the requested kb_id is in the allowed list
        if not all_kbs_mode and kb_id not in allowed_kbs:
            logger.warning(
                "KB access denied - not in allowed list",
                kb_id=kb_id,
                allowed_kbs=allowed_kbs,
            )
            return {
                "status": "error",
                "result": None,
                "error": f"Folder '{kb_id}' is not enabled. Enabled folders: {allowed_kbs}",
            }

        logger.info(
            "KB access validated (client-side list)",
            kb_id=kb_id,
            all_kbs_mode=all_kbs_mode,
            allowed_kbs=allowed_kbs,
        )

        # Server-side verification: Check DynamoDB for actual KB permissions
        # This provides defense-in-depth against manipulated allowed_kbs lists
        if user_sub:
            # For all_kbs mode, verify access to each KB in the allowed list
            # For single KB mode, verify access to the requested KB
            kbs_to_verify = allowed_kbs if all_kbs_mode else [kb_id]
            for verify_kb_id in kbs_to_verify:
                if not verify_kb_access(user_sub, verify_kb_id):
                    logger.warning(
                        "KB access denied - server-side verification failed",
                        user_sub=user_sub[:8] + "...",
                        kb_id=verify_kb_id,
                    )
                    return {
                        "status": "error",
                        "result": None,
                        "error": f"Access denied to folder '{verify_kb_id}'",
                    }
            logger.info(
                "KB access validated (server-side DynamoDB)",
                kb_id=kb_id if not all_kbs_mode else "all",
                user_sub=user_sub[:8] + "...",
            )

    # Security: Validate KB file access (fail-closed)
    if tool_name == "retrieve_kb_file":
        # Fail closed: allowed_kbs must be provided and non-empty
        if not allowed_kbs:
            logger.warning(
                "KB file access denied - no KBs enabled",
                allowed_kbs=allowed_kbs,
            )
            return {
                "status": "error",
                "result": None,
                "error": "No Numa Files folders are enabled for this conversation",
            }

        if not user_sub:
            logger.warning(
                "KB file access denied - no user identity provided",
            )
            return {
                "status": "error",
                "result": None,
                "error": "User authentication required for KB file operations",
            }

        logger.info(
            "KB file access permitted (client-side list)", allowed_kbs=allowed_kbs
        )

        # Server-side verification for file retrieval
        # For list mode: verify access to the specified kb_id
        # For download mode: the handler extracts kb_id from URI and validates
        mode = params.get("mode", "download")
        if mode == "list":
            kb_id = params.get("kb_id", "company")
            if not verify_kb_access(user_sub, kb_id):
                logger.warning(
                    "KB file access denied - server-side verification failed",
                    user_sub=user_sub[:8] + "...",
                    kb_id=kb_id,
                )
                return {
                    "status": "error",
                    "result": None,
                    "error": f"Access denied to folder '{kb_id}'",
                }
            logger.info(
                "KB file access validated (server-side DynamoDB)",
                kb_id=kb_id,
                user_sub=user_sub[:8] + "...",
            )
        # Pass user_sub to handler for server-side KB permission verification
        params["__user_sub"] = user_sub

    # Security: Validate web_search tool access (fail-closed)
    if tool_name == "web_search":
        allowed_tools = event.get(
            "allowed_tools", []
        )  # Security: list of allowed tools
        if "web_search" not in allowed_tools:
            logger.warning(
                "Web search access denied - not in allowed tools",
                allowed_tools=allowed_tools,
            )
            return {
                "status": "error",
                "result": None,
                "error": "Web search is not enabled for this conversation",
            }
        logger.info("Web search access validated", allowed_tools=allowed_tools)

    # Security: Validate add_to_kb tool access (fail-closed)
    if tool_name == "add_to_kb":
        kb_id = params.get("kb_id", "company")

        # Fail closed: allowed_kbs must be provided and non-empty
        if not allowed_kbs:
            logger.warning(
                "KB upload denied - no KBs enabled",
                kb_id=kb_id,
                allowed_kbs=allowed_kbs,
            )
            return {
                "status": "error",
                "result": None,
                "error": "No Numa Files folders are enabled for this conversation",
            }

        # Validate that the requested kb_id is in the allowed list
        if kb_id not in allowed_kbs:
            logger.warning(
                "KB upload denied - not in allowed list",
                kb_id=kb_id,
                allowed_kbs=allowed_kbs,
            )
            return {
                "status": "error",
                "result": None,
                "error": f"Folder '{kb_id}' is not enabled. Enabled folders: {allowed_kbs}",
            }

        logger.info(
            "KB upload access validated (client-side list)",
            kb_id=kb_id,
            allowed_kbs=allowed_kbs,
        )

        # Pass user_sub to handler for server-side write permission check
        # (admin check for company KB, editor/owner check for user KBs)
        params["__user_sub"] = user_sub

    # Security: Validate delete_kb_file tool access (fail-closed)
    if tool_name == "delete_kb_file":
        kb_id = params.get("kb_id", "company")

        if not allowed_kbs:
            logger.warning(
                "KB delete denied - no KBs enabled",
                kb_id=kb_id,
                allowed_kbs=allowed_kbs,
            )
            return {
                "status": "error",
                "result": None,
                "error": "No Numa Files folders are enabled for this conversation",
            }

        if kb_id not in allowed_kbs:
            logger.warning(
                "KB delete denied - not in allowed list",
                kb_id=kb_id,
                allowed_kbs=allowed_kbs,
            )
            return {
                "status": "error",
                "result": None,
                "error": f"Folder '{kb_id}' is not enabled. Enabled folders: {allowed_kbs}",
            }

        logger.info(
            "KB delete access validated (client-side list)",
            kb_id=kb_id,
            allowed_kbs=allowed_kbs,
        )

        params["__user_sub"] = user_sub
        params["__allowed_kbs"] = allowed_kbs

    # Security: Validate list_kb_files tool access (fail-closed)
    if tool_name == "list_kb_files":
        kb_ids = params.get("kb_ids", [])

        # Fail closed: allowed_kbs must be provided and non-empty
        if not allowed_kbs:
            logger.warning(
                "KB file listing denied - no KBs enabled",
                kb_ids=kb_ids,
                allowed_kbs=allowed_kbs,
            )
            return {
                "status": "error",
                "result": None,
                "error": "No Numa Files folders are enabled for this conversation",
            }

        if not user_sub:
            logger.warning(
                "KB file listing denied - no user identity provided",
                kb_ids=kb_ids,
            )
            return {
                "status": "error",
                "result": None,
                "error": "User authentication required for KB file operations",
            }

        # Filter requested kb_ids to only allowed ones
        filtered_kb_ids = [kb_id for kb_id in kb_ids if kb_id in allowed_kbs]
        if not filtered_kb_ids:
            logger.warning(
                "KB file listing denied - no requested KBs are allowed",
                kb_ids=kb_ids,
                allowed_kbs=allowed_kbs,
            )
            return {
                "status": "error",
                "result": None,
                "error": f"None of the requested KBs are enabled. Enabled KBs: {allowed_kbs}",
            }

        # Update params with filtered list
        params["kb_ids"] = filtered_kb_ids

        logger.info(
            "KB file listing access validated",
            requested_kb_ids=kb_ids,
            filtered_kb_ids=filtered_kb_ids,
            allowed_kbs=allowed_kbs,
        )

        # Pass user_sub for server-side permission verification
        params["__user_sub"] = user_sub

    # Handle extract_content tool - pass user context for S3 path construction
    if tool_name == "extract_content":
        # No KB validation needed - this tool accesses workspace files, not KBs
        # Pass user context for S3 path construction
        params["__user_sub"] = user_sub
        params["__conversation_id"] = conversation_id

        logger.info(
            "Extract content tool invoked",
            file_path=params.get("file_path"),
            user_sub=user_sub[:8] + "..." if user_sub else "",
            conversation_id=conversation_id[:8] + "..." if conversation_id else "",
        )

    # Handle transcribe tool - pass user context for S3 path construction
    if tool_name == "transcribe":
        params["__user_sub"] = user_sub
        params["__conversation_id"] = conversation_id

        logger.info(
            "Transcribe tool invoked",
            file_path=params.get("file_path"),
            user_sub=user_sub[:8] + "..." if user_sub else "",
            conversation_id=conversation_id[:8] + "..." if conversation_id else "",
        )

    # Handle view_image tool - pass user context for S3 path construction
    # (reads a workspace image, not a KB file, so no KB validation needed)
    if tool_name == "view_image":
        params["__user_sub"] = user_sub
        params["__conversation_id"] = conversation_id

        logger.info(
            "View image tool invoked",
            file_path=params.get("file_path"),
            user_sub=user_sub[:8] + "..." if user_sub else "",
            conversation_id=conversation_id[:8] + "..." if conversation_id else "",
        )

    # Handle convert_document tool - pass user context for S3 path construction
    if tool_name == "convert_document":
        # No KB validation needed - this tool accesses workspace files, not KBs
        # Pass user context for S3 path construction
        params["__user_sub"] = user_sub
        params["__conversation_id"] = conversation_id

        logger.info(
            "Convert document tool invoked",
            file_path=params.get("file_path"),
            format=params.get("format"),
            user_sub=user_sub[:8] + "..." if user_sub else "",
            conversation_id=conversation_id[:8] + "..." if conversation_id else "",
        )

    # Handle agent management tools - pass user context for permission checks
    agent_tools = {
        "list_agents",
        "get_agent",
        "create_agent",
        "update_agent",
        "patch_agent_prompt",
        "duplicate_agent",
        "delete_agent",
    }
    if tool_name in agent_tools:
        # Security: Validate create_agent_tool access (fail-closed)
        allowed_tools = event.get("allowed_tools", [])
        if "create_agent_tool" not in allowed_tools:
            logger.warning(
                "Agent tools access denied - not in allowed tools",
                tool=tool_name,
                allowed_tools=allowed_tools,
            )
            return {
                "status": "error",
                "result": None,
                "error": "Agents tools are not enabled for this conversation. "
                "Enable 'Agent Creation' in settings.",
            }
        logger.info("Agent tools access validated", allowed_tools=allowed_tools)

        if not user_sub:
            logger.warning(
                "Agent tool access denied - no user_sub provided",
                tool=tool_name,
            )
            return {
                "status": "error",
                "result": None,
                "error": "User authentication required for agent operations",
            }

        # Pass user context for permission checks
        params["__user_sub"] = user_sub
        params["__user_email"] = event.get("user_email", "")
        # Parse user groups from event for admin checks (passed from proxy)
        user_groups = event.get("user_groups", [])
        params["__user_groups"] = user_groups
        # Pass conversation_id for file attachment support (needed to resolve workspace paths)
        params["__conversation_id"] = conversation_id

        logger.info(
            "Agent tool invoked",
            tool=tool_name,
            user_sub=user_sub[:8] + "..." if user_sub else "",
            has_admin=("admin" in user_groups),
            has_conversation_id=bool(conversation_id),
        )

    # Security: Validate user profile memory tool access (require authentication)
    user_profile_tools = {
        "user_profile_list_memories",
        "user_profile_add_memory",
        "user_profile_update_memory",
        "user_profile_delete_memory",
    }
    if tool_name in user_profile_tools:
        # Check that memories_tool is in the allowed tools list
        allowed_tools = event.get("allowed_tools", [])
        if "memories_tool" not in allowed_tools:
            logger.warning(
                "Memory tool access denied - not in allowed tools",
                tool=tool_name,
                allowed_tools=allowed_tools,
            )
            return {
                "status": "error",
                "result": None,
                "error": "Memory management is not enabled for this conversation. "
                "Enable 'Update Memory' in settings.",
            }

        if not user_sub:
            logger.warning(
                "User profile tool access denied - no user_sub provided",
                tool=tool_name,
            )
            return {
                "status": "error",
                "result": None,
                "error": "User authentication required for memory operations",
            }

        params["__user_sub"] = user_sub

        logger.info(
            "User profile tool invoked",
            tool=tool_name,
            user_sub=user_sub[:8] + "..." if user_sub else "",
        )

    # Security: Validate pipedream integration tool access (fail-closed)
    pipedream_tools = {
        "pipedream_list_actions",
        "pipedream_run_action",
        "pipedream_configure_props",
        "pipedream_proxy_request",
    }
    if tool_name in pipedream_tools:
        allowed_tools = event.get("allowed_tools", [])

        # Determine which integration app slug this request targets.
        # For list_actions the slug is an explicit param; for run_action /
        # configure_props it's the prefix of the action_key (e.g.
        # "google_drive" from "google_drive-find-file").
        target_slug = None
        if tool_name == "pipedream_list_actions":
            target_slug = params.get("app_slug")
        elif tool_name in ("pipedream_run_action", "pipedream_configure_props"):
            action_key = params.get("action_key", "")
            # Custom tools are keyed "~/{slug}-{action}" (e.g.
            # "~/pipedrive-add-file"). Strip the private-registry prefix before
            # deriving the slug, otherwise it resolves to "~/pipedrive" and
            # never matches the enabled-integration name ("pipedrive") in
            # allowed_tools → the agent's call is falsely denied.
            slug_source = action_key[2:] if action_key.startswith("~/") else action_key
            if "-" in slug_source:
                target_slug = slug_source.split("-", 1)[0]

        # Validate: the specific integration slug must be in allowed_tools.
        # For proxy_request (no slug extractable), allow if any integration
        # slug is present — the approval flow gates actual execution.
        if target_slug:
            has_access = target_slug in allowed_tools
        else:
            # No slug (proxy_request) — check any non-standard tool is present
            standard_tools = {
                "web_search",
                "knowledge_base",
                "query_knowledge_base",  # Legacy V1 name
                "data_analysis",
                "create_agent_tool",
                "memories_tool",
            }
            has_access = any(t not in standard_tools for t in allowed_tools)

        if not has_access:
            logger.warning(
                "Pipedream integration access denied - integration not enabled",
                tool=tool_name,
                target_slug=target_slug,
                allowed_tools=allowed_tools,
            )
            return {
                "status": "error",
                "result": None,
                "error": (
                    f"The '{target_slug}' integration is not enabled for this conversation. "
                    "Ask the user to enable it in their chat settings."
                    if target_slug
                    else "No integrations are enabled for this chat session. "
                    "Ask the user to enable the integration in their chat settings "
                    "(integrations toggle in the chat sidebar) and try again."
                ),
            }
        # Pass user context for approval flow
        params["__user_sub"] = user_sub
        params["__conversation_id"] = conversation_id
        # Pass external_user_id from event (set by the MCP tool / caller)
        if not params.get("external_user_id"):
            params["external_user_id"] = event.get("external_user_id", "")
        logger.info(
            "Pipedream integration tool access validated",
            tool=tool_name,
            target_slug=target_slug,
            allowed_tools=allowed_tools,
        )

    # Handle approval endpoint (no special access control beyond Lambda invocation)
    if tool_name == "pipedream_approve_action":
        # This is called by the frontend API, not by the agent
        # Access control is handled at the API Gateway level
        pass

    # Connector approval polling — needs user_sub for DynamoDB approval records
    if tool_name == "poll_connector_approval":
        params["__user_sub"] = user_sub

    # Security: Validate consolidated vault tool access (require authentication)
    vault_tools = {
        "vault_list_consolidated_secrets",
        "vault_request_consolidated_secret",
        "oauth_list_connectors",
        "oauth_create_connector",
        "vault_create_custom_secret",
        "vault_delete_secret",
        "vault_list_templates",
    }
    if tool_name in vault_tools:
        if not user_sub:
            logger.warning(
                "Vault tool access denied - no user_sub provided",
                tool=tool_name,
            )
            return {
                "status": "error",
                "result": None,
                "error": "User authentication required for vault operations",
            }

        # Pass user context and conversation ID
        params["user_sub"] = user_sub
        params["conversation_id"] = conversation_id

        logger.info(
            "Vault tool invoked",
            tool=tool_name,
            user_sub=user_sub[:8] + "..." if user_sub else "",
            has_conversation_id=bool(conversation_id),
        )

    # Pass allowed_kbs to handler for defensive validation
    params["__allowed_kbs"] = allowed_kbs
    params["__allowed_kbs_with_names"] = allowed_kbs_with_names
    # Pass raw JWT for tools that need identity-aware AWS access (Q Business).
    params["__id_token"] = id_token
    # Pass caller identity for tools that apply per-document ACLs (e.g. the
    # Synergy cross-job KB filters retrieval by allowed_users == this sub).
    params["__user_sub"] = user_sub
    # Inject auth context for ops handlers (user_sub/email/name/groups from top-level event)
    if tool_name and tool_name.startswith("ops_"):
        params["user_sub"] = user_sub
        params["user_email"] = event.get("user_email", "")
        params["user_name"] = event.get("user_name", "")
        params["user_groups"] = event.get("user_groups", [])
    logger.info("Executing tool", tool=tool_name)

    try:
        result = handler_fn(params)
        elapsed_ms = (time.time() - start_time) * 1000

        # Log result summary for debugging
        logger.info(
            "Tool executed successfully",
            tool=tool_name,
            elapsed_ms=round(elapsed_ms, 2),
            results_count=result.get("results_count") if result else None,
            provider=result.get("provider") if result else None,
            has_summarised_content=(
                bool(result.get("summarised_content")) if result else None
            ),
            summary_length=(
                len(result.get("summarised_content", "")) if result else None
            ),
            references_count=len(result.get("references", [])) if result else None,
        )

        return {
            "status": "success",
            "result": result,
            "error": None,
        }
    except ValueError as e:
        elapsed_ms = (time.time() - start_time) * 1000
        # Validation errors - expected, don't log as error
        logger.warning(
            "Tool validation error",
            tool=tool_name,
            error=str(e),
            elapsed_ms=round(elapsed_ms, 2),
        )
        return {
            "status": "error",
            "result": None,
            "error": str(e),
        }
    except Exception as e:
        elapsed_ms = (time.time() - start_time) * 1000
        # Unexpected errors
        logger.error(
            "Tool execution failed",
            tool=tool_name,
            error=str(e),
            elapsed_ms=round(elapsed_ms, 2),
            exc_info=True,
        )
        return {
            "status": "error",
            "result": None,
            "error": f"Tool execution failed: {str(e)}",
        }
