"""
Tool registry for the Numa chat agent.

Re-exports the public toolbox along with the legacy module-level symbols used by
existing tests (e.g. ``query_knowledge_base_impl``).
"""

import structlog  # noqa: F401 re-exported for backward compatibility

from .knowledge_base import query_knowledge_base_impl
from .registry import (
    AVAILABLE_TOOLS,
    get_available_tool_names,
    get_tools_for_agent,
)
from .registry import query_knowledge_base as _query_knowledge_base_tool
from .registry import (
    validate_enabled_tools,
)
from .registry import web_search as _web_search_tool
from .web_search import web_search_impl

# Ensure package-level attributes point to the Strands tool functions rather
# than the similarly named modules (e.g. numa_chat_agent.tools.web_search).
query_knowledge_base = _query_knowledge_base_tool
web_search = _web_search_tool

__all__ = [
    "AVAILABLE_TOOLS",
    "get_available_tool_names",
    "get_tools_for_agent",
    "query_knowledge_base",
    "query_knowledge_base_impl",
    "validate_enabled_tools",
    "web_search",
    "web_search_impl",
    "structlog",
]
