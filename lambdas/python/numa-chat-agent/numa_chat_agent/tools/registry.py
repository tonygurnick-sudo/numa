"""
Agent tool registry for the Numa chat agent.

Provides @tool-decorated functions and helpers to construct the tool list that
the agent exposes at runtime.
"""

import json
import os
from importlib import import_module
from typing import Optional

import structlog
from strands import tool

from ..auth import get_request_scoped_user_auth

logger = structlog.get_logger(__name__)


# Read supported integrations from environment (injected by infra)
def _load_supported_integrations() -> list[str]:
    raw = os.environ.get("SUPPORTED_INTEGRATIONS", "[]")
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            # Coerce all items to strings
            return [str(x) for x in data if x is not None]
    except Exception:  # defensive
        pass
    return []


SUPPORTED_INTEGRATIONS_ENUM: list[str] = _load_supported_integrations()


def _get_query_impl():
    # Lazy import so unit tests can patch numa_chat_agent.tools.* symbols.
    module = import_module("numa_chat_agent.tools")
    impl = getattr(module, "query_knowledge_base_impl")
    logger.debug(
        "Resolved query_knowledge_base_impl", resolved_type=type(impl).__name__
    )
    return impl


def _get_web_search_impl():
    module = import_module("numa_chat_agent.tools")
    impl = getattr(module, "web_search_impl")
    logger.debug("Resolved web_search_impl", resolved_type=type(impl).__name__)
    return impl


def _get_create_agent_impl():
    # Resolve via tools package to allow test patching of package-level symbol
    module = import_module("numa_chat_agent.tools")
    impl = getattr(module, "create_agent_tool_impl")
    logger.debug("Resolved create_agent_tool_impl", resolved_type=type(impl).__name__)
    return impl


def _get_data_analysis_impl():
    module = import_module("numa_chat_agent.tools")
    impl = getattr(module, "data_analysis_impl")
    logger.debug("Resolved data_analysis_impl", resolved_type=type(impl).__name__)
    return impl


@tool
def query_knowledge_base(
    query: str, user_intent: str, max_results: int = 6, kb_id: Optional[str] = None
):
    """
    Search approved internal knowledge bases with semantic retrieval.

    Always include kb_id and choose one of the KBs enabled for this turn. If none are enabled,
    do not call this tool. When multiple KBs are enabled and relevant, call the tool multiple
    times (once per kb_id) and synthesise the final answer.

    Examples:
      {"query": "latest PTO policy", "user_intent": "User needs PTO details", "kb_id": "company", "max_results": 5}

    Args:
        query (str): Natural language description of what you're searching for
        user_intent (str): What the user is trying to accomplish
        max_results (int): Maximum number of results to return (default: 6, max: 15)
        kb_id (str | None): Knowledge base ID to search (required when multiple KBs are enabled)

    Returns:
        ToolResult: Structured JSON content containing knowledge base results
    """
    # Enforce per‑turn KB allowlist
    current_auth = get_request_scoped_user_auth()
    enabled_list = []
    if isinstance(current_auth, dict):
        val = current_auth.get("enabled_kb_ids")
        if isinstance(val, list):
            enabled_list = [
                str(x).strip() for x in val if isinstance(x, str) and x.strip()
            ]

    allowed_set = set(enabled_list)

    requested = kb_id.strip() if isinstance(kb_id, str) and kb_id.strip() else None

    # Resolve final kb_id according to rules
    resolved_kb_id: Optional[str] = None
    if not allowed_set:
        # No per-turn gating provided; default to historical behavior
        resolved_kb_id = requested or "company"
    else:
        if requested:
            if requested not in allowed_set:
                # Access denied for this turn
                # Return error tool result with guidance
                return {
                    "status": "error",
                    "content": [
                        {
                            "text": (
                                f"Knowledge base '{requested}' is not enabled for this turn. "
                                + (
                                    f"Enabled: {', '.join(sorted(allowed_set))}. "
                                    if allowed_set
                                    else ""
                                )
                                + "Ask the user to enable it if needed."
                            )
                        }
                    ],
                }
            resolved_kb_id = requested
        else:
            if len(allowed_set) == 1:
                resolved_kb_id = next(iter(allowed_set))
            else:
                return {
                    "status": "error",
                    "content": [
                        {
                            "text": (
                                "Multiple knowledge bases are enabled. Please specify kb_id explicitly. "
                                + f"Enabled: {', '.join(sorted(allowed_set))}."
                            )
                        }
                    ],
                }

    return _get_query_impl()(query, user_intent, max_results, resolved_kb_id)


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
    return _get_web_search_impl()(query, user_intent, max_results)


@tool(
    name="create_agent_tool",
    description=(
        "Create a saved Agent (personal or workspace). Provide the agent's title, system_prompt, "
        "and optional metadata like visibility, tools_config, required_integrations, and reference_files. "
        "The tool verifies user intent before writing to DynamoDB."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Agent display name (e.g., 'Google Drive Change Monitor').",
            },
            "system_prompt": {
                "type": "string",
                "description": "Core instructions the Agent will follow in future chats.",
            },
            "visibility": {
                "type": "string",
                "enum": ["personal", "public"],
                "description": "Scope for the Agent: 'personal' (user only) or 'public' (workspace).",
                "default": "personal",
            },
            "description": {
                "type": "string",
                "description": "One‑line description shown in the Agents list (optional).",
            },
            "user_welcome_message": {
                "type": "string",
                "description": "Optional greeting or usage guidance shown when starting a chat with this Agent.",
            },
            "estimated_time_saved_minutes": {
                "type": "integer",
                "minimum": 0,
                "description": "Optional estimate of minutes saved per use.",
            },
            "agent_type": {
                "type": "string",
                "description": "Agent type label (e.g., 'task').",
                "default": "task",
            },
            "required_integrations": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Integration IDs this Agent depends on (e.g., 'google_drive_integration').",
            },
            "tools_config": {
                "type": "object",
                "description": "Tool availability defaults for chats started with this Agent.",
                "properties": {
                    "autoToolsEnabled": {
                        "type": "boolean",
                        "description": "Enable all tools automatically.",
                    },
                    "queryDataSources": {
                        "type": "boolean",
                        "description": "Enable knowledge base queries (deprecated, use allowedKnowledgeBases).",
                    },
                    "webSearchEnabled": {
                        "type": "boolean",
                        "description": "Enable web search.",
                    },
                    "dataAnalysisEnabled": {
                        "type": "boolean",
                        "description": "Enable data analysis for uploaded CSV/Excel/JSON files.",
                    },
                    "createAgentEnabled": {
                        "type": "boolean",
                        "description": "Allow creating Agents from this Agent's chats.",
                    },
                    "enabledConnections": {
                        "type": "array",
                        "items": (
                            {"type": "string", "enum": SUPPORTED_INTEGRATIONS_ENUM}
                            if SUPPORTED_INTEGRATIONS_ENUM
                            else {"type": "string"}
                        ),
                        "description": (
                            "Pre‑enabled integration connection IDs (MCP tools). "
                            + (
                                f"Supported: {', '.join(SUPPORTED_INTEGRATIONS_ENUM)}"
                                if SUPPORTED_INTEGRATIONS_ENUM
                                else ""
                            )
                        ).strip(),
                    },
                    "allowedKnowledgeBases": {
                        "type": ["array", "null"],
                        "items": {"type": "string"},
                        "description": (
                            "Which knowledge bases the agent can access. "
                            "null = all KBs (default), [] = no KB access, "
                            "['company', 'kb-id'] = specific KBs only."
                        ),
                    },
                },
                "additionalProperties": False,
            },
            "reference_files": {
                "type": "array",
                "description": "Files from recent chat history to attach to the Agent (by fileName or s3Key).",
                "items": {
                    "type": "object",
                    "properties": {
                        "fileName": {"type": "string"},
                        "s3Key": {"type": "string"},
                    },
                },
            },
            "created_by_name": {
                "type": "string",
                "description": "Who created the agent, typically just the users email address is sufficient (Available to you in your system prompt)",
            },
        },
        "required": ["title", "system_prompt"],
        "additionalProperties": False,
    },
)
def create_agent_tool(
    title: str,
    system_prompt: str,
    visibility: str = "personal",
    description: str | None = None,
    user_welcome_message: str | None = None,
    estimated_time_saved_minutes: int | None = None,
    agent_type: str = "task",
    required_integrations: list[str] | None = None,
    tools_config: dict | None = None,
    reference_files: list[dict] | None = None,
    created_by_name: str | None = None,
):
    """
    Create a saved agent configuration (personal or workspace-scoped).

    Returns:
        dict: Result with status/message and agent metadata.
    """
    payload = {
        "title": title,
        "system_prompt": system_prompt,
        # Only forward non-defaults to the impl to match test expectations
        **({"visibility": visibility} if visibility != "personal" else {}),
        "description": description,
        "user_welcome_message": user_welcome_message,
        "estimated_time_saved_minutes": estimated_time_saved_minutes,
        **({"agent_type": agent_type} if agent_type != "task" else {}),
        "required_integrations": required_integrations,
        "tools_config": tools_config,
        "reference_files": reference_files,
        "created_by_name": created_by_name,
    }
    clean_payload = {k: v for k, v in payload.items() if v is not None}
    return _get_create_agent_impl()(**clean_payload)


@tool
def data_analysis(
    prompt: Optional[str] = None,
    file_names: Optional[list[str]] = None,
    file_keys: Optional[list[str]] = None,
    file_uris: Optional[list[str]] = None,
    job_id: Optional[str] = None,
):
    """
    Run the Data Analysis app on uploaded CSV/Excel/JSON files.

    Use this tool when the user asks to analyze uploaded data files. If specific
    files are mentioned, pass their names or S3 keys. If none are provided,
    the most recent uploaded data file is used. Include job_id (UUID) to enable
    progress tracking in the chat UI.
    """
    return _get_data_analysis_impl()(prompt, file_names, file_keys, file_uris, job_id)


# Tool registry for dynamic construction
AVAILABLE_TOOLS = {
    "query_knowledge_base": query_knowledge_base,
    "web_search": web_search,
    "create_agent_tool": create_agent_tool,
    "data_analysis": data_analysis,
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
        log = structlog.get_logger()
        log.warning(
            "Invalid tools requested",
            invalid_tools=invalid_tools,
            available_tools=get_available_tool_names(),
        )
        # Filter out invalid tools
        enabled_tools = [t for t in enabled_tools if t in AVAILABLE_TOOLS]

    # Return tool instances
    return [AVAILABLE_TOOLS[tool_name] for tool_name in enabled_tools]
