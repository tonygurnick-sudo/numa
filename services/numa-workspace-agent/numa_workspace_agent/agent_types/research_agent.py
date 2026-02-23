"""
Research Agent — deep analysis with KB and web search.

Example agent type for research tasks. Has access to knowledge bases
and web search but no integrations or agent management. Can execute
code for data analysis.
"""

from .base import AgentTypeConfig
from .registry import register_agent_type

RESEARCH_AGENT = AgentTypeConfig(
    type_id="research-agent",
    display_name="Research Agent",
    response_mode="stream",
    # Full SDK tools (needs code execution for analysis)
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
    # Same allowed tools as chat but WITHOUT integration MCP tools
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
        # MCP tools — scripts only, no integrations
        "mcp__scripts__execute_script",
        # NOTE: No mcp__integrations__* tools
        # Bash commands — same as chat
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
    # Layer 2: Scripts MCP only, no integrations
    enable_scripts_mcp=True,
    enable_integrations_mcp=False,  # No integrations
    # Layer 3: KB + web search only, no agents tool
    enabled_numa_tools=["knowledge_search", "web_search"],
    tools_source_dirs=["numa"],
    # Full plugins
    plugins_path="/app/plugins/numa",
    # KBs allowed, integrations restricted
    restrict_kbs=False,
    restrict_integrations=True,  # No integrations
    max_turns=50,
    max_thinking_tokens=10000,
)

register_agent_type(RESEARCH_AGENT)
