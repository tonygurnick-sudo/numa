"""
Numa Chat Agent Package

A modular WebSocket-powered Lambda function for real-time streaming chat with AI capabilities.
Provides clean interfaces for agent creation, tool management, and WebSocket streaming.
"""

import os
import uuid

import structlog
from strands import Agent

from .auth import clear_current_user_auth, set_current_user_auth

# Import main components
from .config import MODEL_ID, get_bedrock_model, validate_config
from .tools import AVAILABLE_TOOLS, get_available_tool_names, get_tools_for_agent
from .websocket import build_websocket_endpoint, run_agent_stream

# ── OpenTelemetry Configuration ──────────────────────────────────────────────
os.environ.setdefault("OTEL_SERVICE_NAME", "numa-chat-agent")
os.environ.setdefault(
    "OTEL_RESOURCE_ATTRIBUTES", "service.name=numa-chat-agent,service.version=1.1.0"
)

logger = structlog.get_logger()


def create_fresh_agent(enabled_tools=None, system_prompt=None, model_id=None):
    """
    Create a fresh Agent instance for each request to avoid shared state.

    Args:
        enabled_tools (list, optional): List of tool names to enable.
            Defaults to all available tools.
        system_prompt (str, optional): Custom system prompt.
            Uses default if not provided.
        model_id (str, optional): Model ID to use for this request.
            Uses default from config if not provided.

    Returns:
        Agent: Fresh Agent instance with specified tools and configuration
    """
    agent_id = str(uuid.uuid4())[:8]  # Short ID for logging
    effective_model_id = model_id or MODEL_ID
    logger.debug(f"Creating fresh agent {agent_id} with MODEL_ID: {effective_model_id}")

    # Default to all tools if none specified
    if enabled_tools is None:
        enabled_tools = get_available_tool_names()

    # Default system prompt if none provided
    if not system_prompt:
        system_prompt = (
            "You are Numa, an AI assistant that intelligently uses available tools to provide accurate information. "
            "The user can enable or disable your access to tools - respect these preferences. "
            "When tools are available, use them strategically: query_knowledge_base for organizational information, "
            "web_search for current external information."
        )

    # Get tool instances based on enabled tools
    tools = get_tools_for_agent(enabled_tools)

    logger.info(
        f"Creating agent {agent_id} with enabled tools: {enabled_tools}, model: {effective_model_id}"
    )

    agent = Agent(
        model=get_bedrock_model(effective_model_id),
        tools=tools,
        system_prompt=system_prompt,
    )

    logger.info(f"Fresh agent {agent_id} created successfully with {len(tools)} tools")
    return agent


# Validate configuration on import
validate_config()

# Export main components
__all__ = [
    "create_fresh_agent",
    "set_current_user_auth",
    "clear_current_user_auth",
    "run_agent_stream",
    "build_websocket_endpoint",
    "get_available_tool_names",
    "AVAILABLE_TOOLS",
]
