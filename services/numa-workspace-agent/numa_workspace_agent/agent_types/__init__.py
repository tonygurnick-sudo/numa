"""
Agent type system for Numa Workspace Agent.

Each agent type is a configuration of the same workspace agent engine -- different
tools, prompts, response modes, and Numa CLI tools. The engine stays the same.

Importing this module registers all built-in agent types via side-effect imports.
"""

# Import type modules to trigger registration (side-effect imports)
from . import data_analysis as _data_analysis  # noqa: F401
from . import document_summariser as _document_summariser  # noqa: F401
from . import nolia as _nolia  # noqa: F401
from . import numa_chat as _numa_chat  # noqa: F401
from . import numa_chat_demo as _numa_chat_demo  # noqa: F401
from . import profile_creator as _profile_creator  # noqa: F401
from . import profile_researcher as _profile_researcher  # noqa: F401
from . import profile_validator as _profile_validator  # noqa: F401
from . import quoting as _quoting  # noqa: F401
from . import research_agent as _research_agent  # noqa: F401
from . import tony_comedian as _tony_comedian  # noqa: F401
from .base import ALWAYS_COPY, TOOL_FILE_MAP, AgentTypeConfig
from .registry import get_agent_type_config, list_agent_types, register_agent_type

__all__ = [
    "AgentTypeConfig",
    "TOOL_FILE_MAP",
    "ALWAYS_COPY",
    "get_agent_type_config",
    "list_agent_types",
    "register_agent_type",
]
