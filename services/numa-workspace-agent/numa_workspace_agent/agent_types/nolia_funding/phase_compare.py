"""Phase agent type — Nolia Funding comparison.

Registers ``nolia-funding-compare-step`` (the phase agent that does the
actual Claude work). The parent orchestrator type is
``nolia-funding-compare`` in ``nolia_funding_compare.py``; this file is
the SDK-invoked phase that runs inside it.

The naming differentiates parent (entry point, `max_turns=1`, no Claude)
from phase (this file, sync, runs Claude).
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import (
    NOLIA_FUNDING_SPECIALIST_IDENTITY,
    build_nolia_funding_system_prompt,
)
from .prompts.compare import COMPARE_ADDENDUM


def build_funding_compare_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_FUNDING_SPECIALIST_IDENTITY
    base = build_nolia_funding_system_prompt(**kwargs)
    return base + COMPARE_ADDENDUM


_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Bash",
    "KillShell",
]

_ALLOWED_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "BashOutput",
    "KillShell",
    "Bash(numa:*)",  # Numa platform CLI (replaces the numa/integrations/connectors MCP)
    "Bash(python:*)",
    "Bash(python3:*)",
    "Bash(python3.13:*)",
    "Bash(ls:*)",
    "Bash(cat:*)",
    "Bash(head:*)",
    "Bash(tail:*)",
    "Bash(grep:*)",
    "Bash(jq:*)",
    "Bash(find:*)",
    "Bash(mkdir:*)",
    "Bash(cp:*)",
]


NOLIA_FUNDING_COMPARE_STEP = AgentTypeConfig(
    type_id="nolia-funding-compare-step",
    display_name="Nolia Funding Compare (Phase)",
    response_mode="sync",
    system_prompt_builder=build_funding_compare_prompt,
    identity_override=NOLIA_FUNDING_SPECIALIST_IDENTITY,
    tools=_TOOLS,
    allowed_tools=_ALLOWED_TOOLS,
    enable_scripts_mcp=False,
    enable_integrations_mcp=False,
    enable_numa_mcp=False,
    enable_connect_mcp=False,
    enable_vault_mcp=False,
    enabled_numa_tools=["extract_content"],
    tools_source_dirs=["numa"],
    restrict_kbs=True,
    restrict_integrations=True,
    # Comparison reads ~3 prior assessments + writes 3 files (JSON, MD,
    # _summary_and_reasoning.md). 50 turns is ample.
    max_turns=50,
    max_thinking_tokens=10_000,
    effort="high",
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(NOLIA_FUNDING_COMPARE_STEP)
