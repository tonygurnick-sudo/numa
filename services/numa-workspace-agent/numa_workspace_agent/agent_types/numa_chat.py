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
        # Task tracking and skills
        "TodoWrite",
        "Skill",
        # Shell
        "BashOutput",
        "KillShell",
        # MCP tools (our custom tools)
        "mcp__scripts__execute_script",  # Execute code without shell heredocs
        # Numa platform tools (KB, web search, files, agents, memories)
        "mcp__numa__numa_tool",  # Unified Numa tool dispatcher
        # Pipedream integration tools
        "mcp__integrations__run_action",  # Execute integration actions (with approval)
        "mcp__integrations__configure_props",  # Get dynamic prop options (no approval)
        "mcp__integrations__proxy_request",  # Raw API proxy calls (with approval)
        # External connectors (OAuth cloud storage, Synergy, generic HTTP)
        "mcp__connectors__connectors",
        # Secrets vault (user credentials with approval flow)
        "mcp__vault__vault",
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
        # Document handling binaries (pre-installed in container)
        "Bash(node:*)",  # Node.js (PptxGenJS, sharp)
        "Bash(soffice:*)",  # LibreOffice headless (DOCX/PPTX → PDF)
        "Bash(pdftoppm:*)",  # PDF → images (visual QA)
        "Bash(pdftotext:*)",  # PDF text extraction
        "Bash(pdfimages:*)",  # PDF image extraction
        "Bash(pandoc:*)",  # Document format conversion
        "Bash(qpdf:*)",  # PDF manipulation (merge, split)
    ],
    # Layer 2: All MCP tools enabled
    enable_scripts_mcp=True,
    enable_integrations_mcp=True,
    enable_numa_mcp=True,
    enable_connect_mcp=True,
    # Layer 3: Numa tool reference docs (copied to /workdir/tools/ for Claude to read)
    enabled_numa_tools=[
        "agents",
        "memories",
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
