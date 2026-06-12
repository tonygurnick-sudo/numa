"""Phase 1 (Extract) agent type — Nolia Funding Global rules generation.

Registers ``nolia-funding-rules-extract-global``. Reads a Global KB's
``documents/`` folder (policies, values, disqualification rules, etc.)
and produces ``/workdir/tmp/extracted_global_rules.md``.

Paired with ``nolia-funding-rules-review-global``. Invoked by
``rules_orchestrator`` when metadata's ``kb_category`` is ``"global"``.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import build_nolia_funding_system_prompt
from .prompts.rules_extract_global import RULES_EXTRACT_GLOBAL_ADDENDUM

# ── Identity (tuned for Global-scope policy extraction) ─────────────────────

NOLIA_FUNDING_RULES_EXTRACT_GLOBAL_IDENTITY = """\
You are Nolia, an AI funding assessment specialist.

Your expertise is reading **organisation-wide** funding policies and \
distilling them into a precise, citable rulebook that applies across \
every Fund, Grant, and Scholarship the organisation administers. You \
are thorough, literal, and allergic to ambiguity.

Global rules are the universal baseline — values alignment, \
disqualifying factors, identity verification standards, conflict of \
interest — not fund-specific criteria.

## Operating Mode

You are an automated pipeline agent — NOT an interactive assistant. \
Execute your workflow to completion without:
- Asking for user input or confirmation
- Using TodoWrite for task tracking
- Writing conversational responses beyond the required final summary

Complete all required tasks, write all output files, and STOP.

## Output Management

- Use `tmp/` for outputs from this phase.
- The next phase (review) will pick up your draft from `tmp/` and \
produce the final file in `outputs/`.
"""


def build_funding_rules_extract_global_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_FUNDING_RULES_EXTRACT_GLOBAL_IDENTITY
    base = build_nolia_funding_system_prompt(**kwargs)
    return base + RULES_EXTRACT_GLOBAL_ADDENDUM


# ── Tool configuration (same as funding-variant extract) ────────────────────

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


NOLIA_FUNDING_RULES_EXTRACT_GLOBAL = AgentTypeConfig(
    type_id="nolia-funding-rules-extract-global",
    display_name="Nolia Funding Rules Extract — Global (Phase 1)",
    response_mode="sync",
    system_prompt_builder=build_funding_rules_extract_global_prompt,
    identity_override=NOLIA_FUNDING_RULES_EXTRACT_GLOBAL_IDENTITY,
    tools=_RULES_TOOLS,
    allowed_tools=_RULES_ALLOWED_TOOLS,
    enable_scripts_mcp=False,
    enable_integrations_mcp=False,
    enable_numa_mcp=False,
    enable_connect_mcp=False,
    enable_vault_mcp=False,
    enabled_numa_tools=["extract_content"],
    tools_source_dirs=["numa"],
    restrict_kbs=True,
    restrict_integrations=True,
    # Global KBs are typically smaller than Funding KBs, but keep the same
    # headroom so we're not trimming budgets unnecessarily.
    max_turns=75,
    max_thinking_tokens=10_000,
    effort="medium",
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(NOLIA_FUNDING_RULES_EXTRACT_GLOBAL)
