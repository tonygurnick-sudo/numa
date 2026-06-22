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
from . import nolia_funding as _nolia_funding  # noqa: F401
from . import numa_chat as _numa_chat  # noqa: F401
from . import numa_chat_demo as _numa_chat_demo  # noqa: F401
from . import numa_support as _numa_support  # noqa: F401
from . import policy_designer as _policy_designer  # noqa: F401
from . import profile_creator as _profile_creator  # noqa: F401
from . import profile_researcher as _profile_researcher  # noqa: F401
from . import profile_validator as _profile_validator  # noqa: F401
from . import quoting as _quoting  # noqa: F401
from . import research_agent as _research_agent  # noqa: F401
from . import tony_comedian as _tony_comedian  # noqa: F401
from .base import AgentTypeConfig
from .registry import (
    all_agent_configs,
    get_agent_type_config,
    list_agent_types,
    register_agent_type,
)

# ── Phase 5: Nolia default CLI restriction ────────────────────────────────────
# Nolia (and nolia_funding) process UNTRUSTED documents — a prompt-injection in
# an uploaded tender/application must not be able to reach `numa ops`, `numa
# agents`, or `numa memory`. Restrict every Nolia agent type to the `docs` CLI
# category (extract/convert) unless its config sets allowed_cli_commands
# explicitly. Declared here in one place so new Nolia phases inherit it by
# default. This declares intent on the Python config; the authoritative control
# is server-side in numa-cli-api (keyed on NUMA_AGENT_TYPE) — keep the two in
# sync (see test_cli_allowlist parity test). type_ids: "nolia-*" + "nolia-funding-*".
for _cfg in all_agent_configs():
    if _cfg.type_id.startswith("nolia") and _cfg.allowed_cli_commands is None:
        _cfg.allowed_cli_commands = ["docs"]

__all__ = [
    "AgentTypeConfig",
    "get_agent_type_config",
    "list_agent_types",
    "register_agent_type",
    "all_agent_configs",
]
