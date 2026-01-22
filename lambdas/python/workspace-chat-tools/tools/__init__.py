"""
Tools module for numa-chat-workspace-tools Lambda.

Each tool is implemented as a separate module with a handle_* function.
"""

from .agents import (
    handle_create_agent,
    handle_duplicate_agent,
    handle_get_agent,
    handle_list_agents,
    handle_update_agent,
)
from .convert_document import handle_convert_document
from .extract_content import handle_extract_content
from .knowledge_base import (
    handle_add_to_kb,
    handle_query_knowledgebase,
    handle_retrieve_kb_file,
)
from .list_kb_files import handle_list_kb_files
from .web_search import handle_web_search

__all__ = [
    "handle_add_to_kb",
    "handle_convert_document",
    "handle_create_agent",
    "handle_duplicate_agent",
    "handle_extract_content",
    "handle_get_agent",
    "handle_list_agents",
    "handle_list_kb_files",
    "handle_query_knowledgebase",
    "handle_retrieve_kb_file",
    "handle_update_agent",
    "handle_web_search",
]
