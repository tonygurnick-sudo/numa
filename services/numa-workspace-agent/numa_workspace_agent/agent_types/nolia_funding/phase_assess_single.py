"""Single-step assessment agent type — Nolia Funding (V2 test).

Registers ``nolia-funding-assess-single``. Experimental alternate to the
three-phase Extract → Evaluate → Render pipeline: everything happens in a
single Opus run.

Activated by pointing the ``nolia-funding-assess`` parent
``pipeline_orchestrator`` at ``run_nolia_funding_assess_pipeline_single``.
The three-phase pipeline still works — see ``nolia_funding_assess.py`` for
the toggle.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.assess_single import ASSESS_SINGLE_ADDENDUM
from .prompts.base import (
    NOLIA_FUNDING_SPECIALIST_IDENTITY,
    build_nolia_funding_system_prompt,
)


def build_funding_assess_single_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_FUNDING_SPECIALIST_IDENTITY
    base = build_nolia_funding_system_prompt(**kwargs)
    return base + ASSESS_SINGLE_ADDENDUM


# Mirrors the evaluate phase's tool surface — this single step does
# everything evaluate + render do, plus the lightweight extract.
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
    "mcp__scripts__execute_script",
    "mcp__numa__numa_tool",
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


NOLIA_FUNDING_ASSESS_SINGLE = AgentTypeConfig(
    type_id="nolia-funding-assess-single",
    display_name="Nolia Funding Assess (Single-step Opus test)",
    response_mode="sync",
    system_prompt_builder=build_funding_assess_single_prompt,
    identity_override=NOLIA_FUNDING_SPECIALIST_IDENTITY,
    tools=_TOOLS,
    allowed_tools=_ALLOWED_TOOLS,
    enable_scripts_mcp=True,
    enable_integrations_mcp=False,
    enable_numa_mcp=True,
    enable_connect_mcp=False,
    enable_vault_mcp=False,
    enabled_numa_tools=["extract_content"],
    tools_source_dirs=["numa"],
    restrict_kbs=True,
    restrict_integrations=True,
    # One run does extract + evaluate + render. Generous budget — Opus on a
    # full assessment can easily push past 100 turns when the rulebook is
    # large and supporting-data lookups are heavy.
    max_turns=200,
    max_thinking_tokens=10_000,
    effort="high",
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(NOLIA_FUNDING_ASSESS_SINGLE)
