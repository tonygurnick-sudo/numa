"""
OAuth Workspace Tools Lambda Function.

Provides OAuth tool implementations for the workspace-chat-agent.
Tools are dispatched based on the 'tool' field in the event.

Event format:
{
    "tool": "oauth_list_files",
    "params": {
        "provider": "googledrive",
        "folder_id": "optional_folder_id",
        "query": "search_query",
        ...
    }
}

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
    handle_connect_netsuite_mcp,
    handle_connect_request,
    handle_connect_status,
    handle_connect_synergy_download,
    handle_connect_synergy_list,
    handle_connect_synergy_search,
    handle_oauth_connection_status,
    handle_oauth_download_file,
    handle_oauth_get_file_metadata,
    handle_oauth_list_files,
    handle_oauth_search_files,
)

# ── Simple Logging Configuration ───────────────────────────────────────────────


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
OAUTH_TOOL_HANDLERS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    # Existing OAuth handlers
    "oauth_list_files": handle_oauth_list_files,
    "oauth_download_file": handle_oauth_download_file,
    "oauth_search_files": handle_oauth_search_files,
    "oauth_get_file_metadata": handle_oauth_get_file_metadata,
    "oauth_connection_status": handle_oauth_connection_status,
    # Unified connect handlers
    "connect_status": handle_connect_status,
    "connect_synergy_list": handle_connect_synergy_list,
    "connect_synergy_search": handle_connect_synergy_search,
    "connect_synergy_download": handle_connect_synergy_download,
    "connect_request": handle_connect_request,
    "connect_netsuite_mcp": handle_connect_netsuite_mcp,
}


def handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Main Lambda handler with tool-based dispatch for OAuth operations.

    Args:
        event: Lambda event with 'tool', 'user_sub', 'conversation_id', and 'params' fields
        context: Lambda context (unused)

    Returns:
        Response dict with status, result, and optional error
    """
    start_time = time.time()
    del context  # Unused

    tool_name = event.get("tool")
    user_sub = event.get("user_sub", "")  # For OAuth token access
    conversation_id = event.get("conversation_id", "")  # For workspace file paths
    params = event.get("params", {})

    # Log full request details for debugging
    logger.info(
        "Received OAuth tool request",
        tool=tool_name,
        params_keys=list(params.keys()),
        provider=params.get("provider"),
        query_preview=params.get("query", "")[:100] if params.get("query") else None,
        folder_id=params.get("folder_id"),
        user_sub=user_sub,
        conversation_id=conversation_id,
    )

    if not tool_name:
        logger.warning("Missing tool field in event")
        return {
            "status": "error",
            "result": None,
            "error": "Missing 'tool' field in request",
        }

    if not user_sub:
        logger.warning("Missing user_sub field in event")
        return {
            "status": "error",
            "result": None,
            "error": "Missing 'user_sub' field in request",
        }

    handler_fn = OAUTH_TOOL_HANDLERS.get(tool_name)
    if not handler_fn:
        logger.warning(
            "Unknown OAuth tool requested",
            tool=tool_name,
            available_tools=list(OAUTH_TOOL_HANDLERS.keys()),
        )
        return {
            "status": "error",
            "result": None,
            "error": f"Unknown OAuth tool: {tool_name}. Available tools: {list(OAUTH_TOOL_HANDLERS.keys())}",
        }

    try:
        # Add context to params for handlers
        params_with_context = {
            **params,
            "user_sub": user_sub,
            "conversation_id": conversation_id,
        }

        result = handler_fn(params_with_context)

        execution_time = time.time() - start_time
        logger.info(
            "OAuth tool execution completed",
            tool=tool_name,
            execution_time_ms=round(execution_time * 1000, 2),
            status=result.get("status"),
        )

        return result

    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(
            "OAuth tool execution failed",
            tool=tool_name,
            execution_time_ms=round(execution_time * 1000, 2),
            error=str(e),
            exc_info=True,
        )
        return {
            "status": "error",
            "result": None,
            "error": f"Tool execution failed: {str(e)}",
        }
