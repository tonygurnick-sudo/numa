"""
Agent tools module for Numa Chat Agent.

Contains the @tool decorated functions that the Agent can use, along with
the dynamic tool registry for flexible tool selection.
"""

import structlog
from strands import tool

from .knowledge_base import query_knowledge_base_impl
from .web_search import web_search_impl


@tool
def query_knowledge_base(query: str, user_intent: str, max_results: int = 6):
    """
    Search your organization's semantic knowledge base for relevant documents and information.

    Use this tool to find information from:
    - Company documents, policies, and procedures
    - Internal knowledge base content
    - Previously uploaded files and data sources

    Use natural language queries that describe what you're looking for.
    Example: "employee benefits policy" rather than specific file names.

    Args:
        query (str): Natural language description of what you're searching for
        user_intent (str): Description of what the user is trying to accomplish
            (e.g., "User wants to understand employee benefits policy")
        max_results (int): Maximum number of results to return (default: 6, max: 15)

    Returns:
        ToolResult: Structured JSON content containing knowledge base results
    """
    return query_knowledge_base_impl(query, user_intent, max_results)


@tool
def web_search(query: str, user_intent: str, max_results: int = 2):
    """
    Search the internet for current information and general knowledge.

    Use this tool for:
    - Current events and recent information
    - General knowledge not in the knowledge base
    - Public information and research

    Decision rubric:
    - Use web_search when the user explicitly asks you to look online or check a website,
      or when the information is time-sensitive, likely to change, or you are uncertain.
    - Prefer query_knowledge_base for organisational content.
    - When web_search is enabled, do not apologise about browsing limitations; when it is disabled but would help,
      explain briefly and offer to proceed without it.

    Use natural language queries focused on finding informational content.
    Avoid searching for API documentation or technical implementation details.
    Example: "latest trends in renewable energy" rather than "renewable energy API docs"

    Args:
        query (str): Natural language search query for general information (required)
        user_intent (str): Description of what the user is trying to accomplish
            (e.g., "User is researching latest AI trends") (required)
        max_results (int): Maximum number of results to return (default: 2, max: 10)

    Returns:
        ToolResult: Structured JSON content containing search results
    """
    return web_search_impl(query, user_intent, max_results)


# Tool registry for dynamic construction
AVAILABLE_TOOLS = {
    "query_knowledge_base": query_knowledge_base,
    "web_search": web_search,
}


def get_available_tool_names():
    """
    Get list of available tool names.

    Returns:
        list: List of available tool name strings
    """
    return list(AVAILABLE_TOOLS.keys())


def validate_enabled_tools(enabled_tools):
    """
    Validate that enabled tools are available in the registry.

    Args:
        enabled_tools (list): List of tool names to validate

    Returns:
        list: List of invalid tool names (empty if all valid)
    """
    invalid = [t for t in enabled_tools if t not in AVAILABLE_TOOLS]
    return invalid


def get_tools_for_agent(enabled_tools=None):
    """
    Get tool instances for agent creation based on enabled tools.

    Args:
        enabled_tools (list, optional): List of tool names to enable.
            Defaults to all available tools.

    Returns:
        list: List of tool instances for Agent constructor
    """
    if enabled_tools is None:
        enabled_tools = get_available_tool_names()

    # Validate tools
    invalid_tools = validate_enabled_tools(enabled_tools)
    if invalid_tools:
        logger = structlog.get_logger()
        logger.warning(
            "Invalid tools requested",
            invalid_tools=invalid_tools,
            available_tools=get_available_tool_names(),
        )
        # Filter out invalid tools
        enabled_tools = [t for t in enabled_tools if t in AVAILABLE_TOOLS]

    # Return tool instances
    return [AVAILABLE_TOOLS[tool_name] for tool_name in enabled_tools]
