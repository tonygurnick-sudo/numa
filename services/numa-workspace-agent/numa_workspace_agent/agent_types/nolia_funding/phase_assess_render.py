"""Phase 3 (Render) agent type — Nolia Funding assessment.

Registers ``nolia-funding-assess-render``. Reads the output template + the
structured findings from Phase 2 and produces the filled assessment
document as Markdown. Downstream (orchestrator) post-processing converts
to PDF + DOCX.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.assess_render import ASSESS_RENDER_ADDENDUM
from .prompts.base import (
    NOLIA_FUNDING_SPECIALIST_IDENTITY,
    build_nolia_funding_system_prompt,
)


def build_funding_assess_render_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_FUNDING_SPECIALIST_IDENTITY
    base = build_nolia_funding_system_prompt(**kwargs)
    return base + ASSESS_RENDER_ADDENDUM


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
    "Bash(mkdir:*)",
    "Bash(cp:*)",
    "Bash(mv:*)",
]


NOLIA_FUNDING_ASSESS_RENDER = AgentTypeConfig(
    type_id="nolia-funding-assess-render",
    display_name="Nolia Funding Assess Render (Phase 3)",
    response_mode="sync",
    system_prompt_builder=build_funding_assess_render_prompt,
    identity_override=NOLIA_FUNDING_SPECIALIST_IDENTITY,
    tools=_TOOLS,
    allowed_tools=_ALLOWED_TOOLS,
    enable_scripts_mcp=False,
    enable_integrations_mcp=False,
    enable_numa_mcp=False,
    enable_connect_mcp=False,
    enable_vault_mcp=False,
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=60,
    max_thinking_tokens=10_000,
    effort="medium",
    default_model="anthropic.claude-sonnet-4-6",
)

register_agent_type(NOLIA_FUNDING_ASSESS_RENDER)
