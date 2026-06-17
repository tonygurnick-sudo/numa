"""
Tools module for numa-chat-workspace-tools Lambda.

Each tool is implemented as a separate module with a handle_* function.
"""

from .agents import (
    handle_create_agent,
    handle_delete_agent,
    handle_duplicate_agent,
    handle_get_agent,
    handle_list_agents,
    handle_patch_agent_prompt,
    handle_update_agent,
)
from .convert_document import handle_convert_document
from .convert_preview import handle_convert_preview
from .extract_content import handle_extract_content
from .knowledge_base import (
    handle_add_to_kb,
    handle_delete_kb_file,
    handle_query_knowledgebase,
    handle_retrieve_kb_file,
)
from .list_kb_files import handle_list_kb_files
from .ops import handle_ops_operation
from .pipedream_integration import (
    handle_approve_action,
    handle_batch_get_schemas,
    handle_configure_props,
    handle_list_actions,
    handle_poll_connector_approval,
    handle_proxy_request,
    handle_run_action,
)
from .transcribe import handle_transcribe
from .user_profile import (
    handle_add_memory,
    handle_delete_memory,
    handle_list_memories,
    handle_update_memory,
)
from .view_image import handle_view_image
from .web_search import handle_web_search

__all__ = [
    "handle_add_to_kb",
    "handle_delete_kb_file",
    "handle_convert_document",
    "handle_convert_preview",
    "handle_create_agent",
    "handle_delete_agent",
    "handle_duplicate_agent",
    "handle_extract_content",
    "handle_get_agent",
    "handle_list_agents",
    "handle_list_kb_files",
    "handle_patch_agent_prompt",
    "handle_query_knowledgebase",
    "handle_retrieve_kb_file",
    "handle_update_agent",
    "handle_web_search",
    "handle_approve_action",
    "handle_batch_get_schemas",
    "handle_configure_props",
    "handle_list_actions",
    "handle_proxy_request",
    "handle_run_action",
    "handle_poll_connector_approval",
    "handle_add_memory",
    "handle_delete_memory",
    "handle_list_memories",
    "handle_update_memory",
    "handle_ops_operation",
    "handle_transcribe",
    "handle_view_image",
]
