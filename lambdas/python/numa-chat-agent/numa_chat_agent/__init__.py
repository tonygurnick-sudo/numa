"""
Numa Chat Agent Package

A modular WebSocket-powered Lambda function for real-time streaming chat with AI capabilities.
Provides clean interfaces for agent creation, tool management, and WebSocket streaming.
"""

import logging
import os
import uuid
from typing import Any

import structlog
from strands import Agent

from bedrock.language import get_language_system_prompt

from .auth import (
    clear_current_user_auth,
    clear_request_scoped_user_auth,
    get_request_scoped_user_auth,
    set_current_user_auth,
    set_request_scoped_user_auth,
)

# Import main components
from .config import MODEL_ID, get_bedrock_model, validate_config
from .mcp.manager import get_mcp_tools_and_clients_for_agent, get_supported_mcp_apps
from .tools import AVAILABLE_TOOLS, get_available_tool_names, get_tools_for_agent
from .utils import cleanup_mcp_clients

# ── Logging Configuration (JSON in Lambda by default) ───────────────────────


def _setup_structlog() -> None:
    # Ensure stdlib logs from dependencies don't pollute formatting
    logging.basicConfig(format="%(message)s", level=logging.ERROR)

    # Default to JSON in Lambda; allow console pretty logs locally via env
    renderer: Any = structlog.processors.JSONRenderer(sort_keys=True)
    if os.environ.get("LOG_TO_CONSOLE", "false").lower() == "true":
        renderer = structlog.dev.ConsoleRenderer()

    log_level = logging.getLevelName(os.environ.get("LOG_LEVEL", "INFO").upper())

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.format_exc_info,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        logger_factory=structlog.WriteLoggerFactory(),
        cache_logger_on_first_use=True,
    )


_setup_structlog()

# ── OpenTelemetry Configuration ──────────────────────────────────────────────
os.environ.setdefault("OTEL_SERVICE_NAME", "numa-chat-agent")
os.environ.setdefault(
    "OTEL_RESOURCE_ATTRIBUTES", "service.name=numa-chat-agent,service.version=1.1.0"
)

logger = structlog.get_logger()

SUPPORTED_MCP_APPS = get_supported_mcp_apps()


def _build_comprehensive_date_context() -> str:
    """Build comprehensive date/time context from user auth for system prompts.

    Returns formatted date context that helps AI understand temporal references
    like "today", "this week", "next month", etc.
    """
    try:
        ua = get_request_scoped_user_auth() or {}
        ti = (ua.get("timeInfo") or {}) if isinstance(ua, dict) else {}
        if not isinstance(ti, dict):
            return ""

        # Use pre-formatted summary if available (most comprehensive)
        summary = str(ti.get("summary") or "").strip()
        if summary:
            context_parts = [summary]

            # Add precise timestamp information for temporal calculations
            iso = str(ti.get("iso") or "").strip()
            local = ti.get("local") or {}

            if iso:
                context_parts.append(f"ISO timestamp: {iso}")

            if isinstance(local, dict) and local.get("year"):
                year = local.get("year")
                month = local.get("month")
                day = local.get("day")
                weekday = local.get("weekday", 0)  # 0=Sunday

                # Add structured date for temporal reasoning
                weekday_names = [
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                ]
                weekday_name = (
                    weekday_names[weekday] if 0 <= weekday <= 6 else "Unknown"
                )

                context_parts.append(
                    f"Structured date: Year {year}, Month {month}, Day {day}, Weekday {weekday} ({weekday_name})"
                )

            return "\n".join(context_parts)

        # Fallback to basic context if no summary
        date = str(ti.get("date") or "").strip()
        time_str = str(ti.get("time") or "").strip()
        tz = str(ti.get("timezone") or "").strip()
        day_of_week = str(ti.get("dayOfWeek") or "").strip()

        if date and time_str and tz:
            return (
                f"Current date: {day_of_week}, {date}\nCurrent time: {time_str} ({tz})"
            )

        return ""
    except Exception:
        return ""


def create_fresh_agent(
    enabled_tools=None,
    system_prompt=None,
    model_id=None,
    messages=None,
    enabled_connections=None,
    conversation_manager=None,
    locale=None,
):
    """
    Create a fresh Agent instance for each request to avoid shared state.

    Args:
        enabled_tools (list, optional): List of tool names to enable.
            Defaults to all available tools.
        system_prompt (str, optional): Custom system prompt.
            Uses default if not provided.
        model_id (str, optional): Model ID to use for this request.
            Uses default from config if not provided.
        messages (list, optional): Conversation history to initialize the agent with.
            Defaults to an empty list.
        enabled_connections (list, optional): List of connection IDs to enable for MCP tools.
            Defaults to an empty list.
        conversation_manager (ConversationManager, optional): Strands conversation manager
            for runtime context management. If not provided, agent uses default behavior.
        locale (dict, optional): Client locale information with keys:
            - language: Effective language code (e.g., "en", "fr")
            - browserLanguage: Browser's navigator.language
            - userChoice: User's explicit preference (null if browser default)

    Returns:
        tuple: (Agent, mcp_clients_list) - Agent instance and list of MCP clients to keep alive
               If no MCP clients, returns (Agent, [])
    """
    agent_id = str(uuid.uuid4())[:8]  # Short ID for logging
    effective_model_id = model_id or MODEL_ID
    logger.debug(f"Creating fresh agent {agent_id} with MODEL_ID: {effective_model_id}")

    # Initialize default values
    if messages is None:
        messages = []
    if enabled_connections is None:
        enabled_connections = []

    # Debug logging for enabled_connections parameter
    logger.info(
        "create_fresh_agent called with enabled_connections",
        agent_id=agent_id,
        enabled_connections=enabled_connections,
        enabled_connections_type=type(enabled_connections),
        enabled_connections_length=len(enabled_connections),
    )

    # Default to all tools if none specified
    if enabled_tools is None:
        enabled_tools = get_available_tool_names()

    # Default system prompt if none provided
    if not system_prompt:
        base_prompt = (
            "You are Numa, an AI assistant that intelligently uses available tools to provide accurate information. "
            "The user can enable or disable your access to tools - respect these preferences. "
            "When tools are available, use them strategically: query_knowledge_base for organisational information, "
            "web_search for current external information. "
            "Use web_search when the user explicitly asks you to look online or check a website, or when the information is time-sensitive, likely to change, or you are uncertain. "
            "Prefer query_knowledge_base for organisational content. When web_search is enabled, do not apologise about browsing limitations; when it is disabled but would help, explain briefly and offer to proceed without it. "
            "Additionally, use connected service tools (e.g., Slack, Notion, Google Calendar) when appropriate to interact with the user's integrated applications."
        )

        # Add current date/time context for temporal awareness
        date_context = _build_comprehensive_date_context()
        if date_context:
            system_prompt = f"{base_prompt}\n\nCURRENT DATE & TIME CONTEXT:\n{date_context}\n\nUse this date/time information when the user refers to temporal concepts like 'today', 'this week', 'next month', 'yesterday', etc."
        else:
            system_prompt = base_prompt

    # Append language instruction based on user's locale preference
    if locale and isinstance(locale, dict):
        lang_code = locale.get("language")
        language_prompt = get_language_system_prompt(lang_code)
        if language_prompt:
            system_prompt += f"\n\n{language_prompt}"

    # Get standard tool instances based on enabled tools
    tools = get_tools_for_agent(enabled_tools)
    mcp_clients = []

    # Add MCP tools for Pipedream integrations based on enabled connections
    try:
        logger.debug("Attempting to add MCP tools for Pipedream integrations")

        # Only add MCP tools for enabled connections
        if enabled_connections:
            # Get both tools and clients (clients must stay alive)
            mcp_tools, mcp_clients = get_mcp_tools_and_clients_for_agent(
                enabled_connections
            )

            if mcp_tools:
                tools.extend(mcp_tools)
                logger.info(
                    f"Successfully added {len(mcp_tools)} MCP tools from Pipedream",
                    enabled_connections=enabled_connections,
                    active_clients=len(mcp_clients),
                )
            else:
                logger.warning("No MCP tools were loaded for enabled connections")
        else:
            logger.debug("No connections enabled, skipping MCP tool setup")

    except Exception as e:
        logger.warning(
            "Failed to add MCP tools, continuing with standard tools only", error=str(e)
        )

    logger.info(
        f"Creating agent {agent_id} with enabled tools: {enabled_tools}, model: {effective_model_id}",
        has_conversation_manager=conversation_manager is not None,
    )

    # Create agent with optional conversation manager
    agent_kwargs = {
        "model": get_bedrock_model(effective_model_id),
        "tools": tools,
        "system_prompt": system_prompt,
        "messages": messages,
    }

    if conversation_manager is not None:
        agent_kwargs["conversation_manager"] = conversation_manager

    agent = Agent(**agent_kwargs)

    logger.info(
        f"Fresh agent {agent_id} created successfully with {len(tools)} tools",
        has_conversation_manager=conversation_manager is not None,
    )

    # Return both agent and MCP clients that need to stay alive
    return agent, mcp_clients


# Validate configuration on import
validate_config()

# Export main components
__all__ = [
    "create_fresh_agent",
    "cleanup_mcp_clients",
    "set_current_user_auth",
    "clear_current_user_auth",
    "set_request_scoped_user_auth",
    "get_request_scoped_user_auth",
    "clear_request_scoped_user_auth",
    "get_available_tool_names",
    "AVAILABLE_TOOLS",
    "SUPPORTED_MCP_APPS",
    "_build_comprehensive_date_context",
]
