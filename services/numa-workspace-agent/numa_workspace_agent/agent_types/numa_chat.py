"""
Numa Chat — default interactive chat agent type.

This is the standard Numa chat experience. It has full access to all tools,
knowledge bases, integrations, and code execution.
"""

from .base import AgentTypeConfig
from .registry import register_agent_type

NUMA_CHAT = AgentTypeConfig(
    type_id="numa-chat",
    display_name="Numa Chat",
    response_mode="stream",
    # Layer 1: All SDK tools enabled (matching current TOOLS in sdk_config.py)
    tools=[
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Bash",
        "KillShell",
        "Task",
        "TaskOutput",
        "TodoWrite",
        "Skill",
    ],
    # Layer 1: All allowed tools (matching current ALLOWED_TOOLS in sdk_config.py)
    allowed_tools=[
        # File operations
        "Read",
        "Write",
        "Glob",
        "Grep",
        "Edit",
        # Task management
        "TodoWrite",
        "Task",
        "Skill",
        # Shell
        "BashOutput",
        "KillShell",
        # MCP tools (our custom tools)
        "mcp__scripts__execute_script",  # Execute code without shell heredocs
        # Pipedream integration tools
        "mcp__integrations__run_action",  # Execute integration actions (with approval)
        "mcp__integrations__configure_props",  # Get dynamic prop options (no approval)
        "mcp__integrations__proxy_request",  # Raw API proxy calls (with approval)
        # Bash with allowed commands
        "Bash(python:*)",
        "Bash(python3:*)",
        "Bash(python3.13:*)",
        "Bash(ls:*)",
        "Bash(head:*)",
        "Bash(tail:*)",
        "Bash(cat:*)",
        "Bash(wc:*)",
        "Bash(file:*)",
        "Bash(stat:*)",
        "Bash(du:*)",
        "Bash(tree:*)",
        "Bash(echo:*)",
        "Bash(date)",
        "Bash(pwd)",
        "Bash(tar:*)",
        "Bash(unzip:*)",
        "Bash(mkdir:*)",
        "Bash(mv:*)",
        "Bash(cp:*)",
        # Common data analysis tools
        "Bash(sqlite3:*)",  # Database queries
        "Bash(jq:*)",  # JSON processing
        "Bash(sort:*)",  # Sorting
        "Bash(uniq:*)",  # Deduplication
        "Bash(cut:*)",  # Field extraction
        "Bash(awk:*)",  # Text processing
        "Bash(sed:*)",  # Text substitution
        "Bash(diff:*)",  # File comparison
        "Bash(grep:*)",  # Pattern matching (useful with pipes)
        "Bash(xargs:*)",  # Build command lines from input
    ],
    # Layer 2: All MCP tools enabled
    enable_scripts_mcp=True,
    enable_integrations_mcp=True,
    # Layer 3: All Numa CLI tools available
    enabled_numa_tools=[
        "knowledge_search",
        "web_search",
        "agents",
        "convert_document",
        "extract_content",
    ],
    tools_source_dirs=["numa"],
    # Full plugins
    plugins_path="/app/plugins/numa",
    # KBs and integrations: driven by request (no restrictions)
    restrict_kbs=False,
    restrict_integrations=False,
    max_turns=50,
    max_thinking_tokens=10000,
)

register_agent_type(NUMA_CHAT)
