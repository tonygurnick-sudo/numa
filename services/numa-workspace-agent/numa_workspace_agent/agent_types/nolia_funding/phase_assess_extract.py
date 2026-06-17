"""Phase 1 (Extract applicant info) agent type — Nolia Funding assessment.

Registers ``nolia-funding-assess-extract``. Reads extracted applicant
documents in /workdir/uploads/ and produces the unified applicant record at
/workdir/tmp/applicant.json.

Lightweight — no rule checking, no supporting-data queries. The purpose is
to hand the evaluate phase a clean structured identity record.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.assess_extract import ASSESS_EXTRACT_ADDENDUM
from .prompts.base import (
    NOLIA_FUNDING_EXTRACT_IDENTITY,
    build_nolia_funding_system_prompt,
)


def build_funding_assess_extract_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_FUNDING_EXTRACT_IDENTITY
    base = build_nolia_funding_system_prompt(**kwargs)
    return base + ASSESS_EXTRACT_ADDENDUM


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
    "Bash(python3:*)",
    "Bash(python:*)",
    "Bash(ls:*)",
    "Bash(cat:*)",
    "Bash(head:*)",
    "Bash(tail:*)",
    "Bash(wc:*)",
    "Bash(sort:*)",
    "Bash(cut:*)",
    "Bash(awk:*)",
    "Bash(sed:*)",
    "Bash(grep:*)",
    "Bash(find:*)",
    "Bash(jq:*)",
]


NOLIA_FUNDING_ASSESS_EXTRACT = AgentTypeConfig(
    type_id="nolia-funding-assess-extract",
    display_name="Nolia Funding Assess Extract (Phase 1)",
    response_mode="sync",
    system_prompt_builder=build_funding_assess_extract_prompt,
    identity_override=NOLIA_FUNDING_EXTRACT_IDENTITY,
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
    # Extraction is fast structured-data work; 40 turns is ample.
    max_turns=40,
    max_thinking_tokens=5_000,
    effort="medium",
    default_model="anthropic.claude-sonnet-4-6",
)

register_agent_type(NOLIA_FUNDING_ASSESS_EXTRACT)
