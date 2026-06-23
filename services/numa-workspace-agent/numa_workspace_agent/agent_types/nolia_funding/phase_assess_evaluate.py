"""Phase 2 (Evaluate) agent type — Nolia Funding assessment.

Registers ``nolia-funding-assess-evaluate``. The core of the assessment
pipeline. Reads the rulebook + supporting data + applicant info, produces
per-rule structured findings at /workdir/tmp/findings.md.

Needs strong tool access for querying supporting data files via Bash /
scripts. Does NOT render output — that's Phase 3.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.assess_evaluate import ASSESS_EVALUATE_ADDENDUM
from .prompts.base import (
    NOLIA_FUNDING_SPECIALIST_IDENTITY,
    build_nolia_funding_system_prompt,
)


def build_funding_assess_evaluate_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_FUNDING_SPECIALIST_IDENTITY
    base = build_nolia_funding_system_prompt(**kwargs)
    return base + ASSESS_EVALUATE_ADDENDUM


# Stronger tool set — evaluate phase does heavy supporting-data querying
# via grep / awk / python3 + openpyxl / pandas scripts.
_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Bash",
    "KillShell",
    "Task",
    "TaskOutput",
]

_ALLOWED_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "BashOutput",
    "KillShell",
    "Task",
    "TaskOutput",
    "Bash(numa:*)",  # Numa platform CLI (replaces the numa/integrations/connectors MCP)
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


NOLIA_FUNDING_ASSESS_EVALUATE = AgentTypeConfig(
    type_id="nolia-funding-assess-evaluate",
    display_name="Nolia Funding Assess Evaluate (Phase 2)",
    response_mode="sync",
    system_prompt_builder=build_funding_assess_evaluate_prompt,
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
    # Evaluate phase iterates over every rule + queries supporting data;
    # needs headroom.
    max_turns=100,
    max_thinking_tokens=10_000,
    effort="medium",
    default_model="anthropic.claude-sonnet-4-6",
)

register_agent_type(NOLIA_FUNDING_ASSESS_EVALUATE)
