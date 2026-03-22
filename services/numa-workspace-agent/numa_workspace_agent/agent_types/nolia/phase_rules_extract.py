"""Rules extraction phase agent types — one per KB category.

Each variant has a tailored system prompt for extracting rules from
global, procurement, or project knowledge base documents.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import build_nolia_system_prompt
from .prompts.rules_generation import (
    RULES_EXTRACT_GLOBAL_ADDENDUM,
    RULES_EXTRACT_PROCUREMENT_ADDENDUM,
    RULES_EXTRACT_PROJECT_ADDENDUM,
)

# ── Shared identity for rules extraction ──────────────────────────────────────

NOLIA_RULES_EXTRACT_IDENTITY = """\
You are Numa, an AI assistant created by Arcanum AI in partnership with Nolia \
who specialises in procurement and funding applications.

You are a Procurement Specialist whose expertise is in understanding and \
interpreting procurement rules for large organisations and multilateral \
development banks (World Bank, ADB, IsDB, AIIB, etc.).

Your task is to read procurement-related documents and extract a definitive, \
prioritised set of compliance rules.

## Operating Mode

You are an automated pipeline agent — NOT an interactive assistant. Execute \
your workflow to completion without:
- Asking for user input or confirmation
- Using TodoWrite for task tracking
- Writing conversational responses beyond the required final summary

Complete all required tasks, write all output files, and STOP.

## Output Management

- Use `tmp/` for all outputs from this phase.
"""

# ── Shared tool config ────────────────────────────────────────────────────────

_RULES_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Bash",
    "KillShell",
]

_RULES_ALLOWED_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "BashOutput",
    "KillShell",
    "mcp__scripts__execute_script",
    "Bash(python:*)",
    "Bash(python3:*)",
    "Bash(python3.13:*)",
    "Bash(ls:*)",
    "Bash(head:*)",
    "Bash(tail:*)",
    "Bash(cat:*)",
    "Bash(wc:*)",
    "Bash(sort:*)",
    "Bash(cut:*)",
    "Bash(awk:*)",
    "Bash(sed:*)",
    "Bash(grep:*)",
    "Bash(find:*)",
    "Bash(jq:*)",
    "Bash(mkdir:*)",
    "Bash(cp:*)",
    "Bash(mv:*)",
]


# ── Global rules extraction ──────────────────────────────────────────────────


def build_nolia_rules_extract_global_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_RULES_EXTRACT_IDENTITY
    base = build_nolia_system_prompt(**kwargs)
    return base + RULES_EXTRACT_GLOBAL_ADDENDUM


NOLIA_RULES_EXTRACT_GLOBAL = AgentTypeConfig(
    type_id="nolia-rules-extract-global",
    display_name="Nolia Rules Extract (Global)",
    response_mode="sync",
    system_prompt_builder=build_nolia_rules_extract_global_prompt,
    identity_override=NOLIA_RULES_EXTRACT_IDENTITY,
    tools=_RULES_TOOLS,
    allowed_tools=_RULES_ALLOWED_TOOLS,
    enable_scripts_mcp=True,
    enable_integrations_mcp=False,
    enable_numa_mcp=False,
    enable_connect_mcp=False,
    enable_vault_mcp=False,
    enabled_numa_tools=[],
    tools_source_dirs=[],
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=75,
    max_thinking_tokens=10_000,
    effort="medium",
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(NOLIA_RULES_EXTRACT_GLOBAL)


# ── Procurement rules extraction ─────────────────────────────────────────────


def build_nolia_rules_extract_procurement_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_RULES_EXTRACT_IDENTITY
    base = build_nolia_system_prompt(**kwargs)
    return base + RULES_EXTRACT_PROCUREMENT_ADDENDUM


NOLIA_RULES_EXTRACT_PROCUREMENT = AgentTypeConfig(
    type_id="nolia-rules-extract-procurement",
    display_name="Nolia Rules Extract (Procurement)",
    response_mode="sync",
    system_prompt_builder=build_nolia_rules_extract_procurement_prompt,
    identity_override=NOLIA_RULES_EXTRACT_IDENTITY,
    tools=_RULES_TOOLS,
    allowed_tools=_RULES_ALLOWED_TOOLS,
    enable_scripts_mcp=True,
    enable_integrations_mcp=False,
    enable_numa_mcp=False,
    enable_connect_mcp=False,
    enable_vault_mcp=False,
    enabled_numa_tools=[],
    tools_source_dirs=[],
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=75,
    max_thinking_tokens=10_000,
    effort="medium",
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(NOLIA_RULES_EXTRACT_PROCUREMENT)


# ── Project rules extraction ─────────────────────────────────────────────────


def build_nolia_rules_extract_project_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_RULES_EXTRACT_IDENTITY
    base = build_nolia_system_prompt(**kwargs)
    return base + RULES_EXTRACT_PROJECT_ADDENDUM


NOLIA_RULES_EXTRACT_PROJECT = AgentTypeConfig(
    type_id="nolia-rules-extract-project",
    display_name="Nolia Rules Extract (Project)",
    response_mode="sync",
    system_prompt_builder=build_nolia_rules_extract_project_prompt,
    identity_override=NOLIA_RULES_EXTRACT_IDENTITY,
    tools=_RULES_TOOLS,
    allowed_tools=_RULES_ALLOWED_TOOLS,
    enable_scripts_mcp=True,
    enable_integrations_mcp=False,
    enable_numa_mcp=False,
    enable_connect_mcp=False,
    enable_vault_mcp=False,
    enabled_numa_tools=[],
    tools_source_dirs=[],
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=75,
    max_thinking_tokens=10_000,
    effort="medium",
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(NOLIA_RULES_EXTRACT_PROJECT)
