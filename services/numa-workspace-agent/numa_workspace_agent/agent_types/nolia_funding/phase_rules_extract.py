"""Phase 1 (Extract) agent type — Nolia Funding rules generation.

Registers ``nolia-funding-rules-extract``. Reads selection-criteria +
application-form + templates + (optional) good-examples from the Funding KB
workspace, plus the supporting-data-manifest.json at the KB root, and
produces ``/workdir/tmp/extracted_rules.md``.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import build_nolia_funding_system_prompt
from .prompts.rules_extract import RULES_EXTRACT_ADDENDUM

# ── Identity (tuned for policy-extraction mindset) ───────────────────────────

NOLIA_FUNDING_RULES_EXTRACT_IDENTITY = """\
You are Nolia, an AI funding assessment specialist.

Your expertise is reading funding policies, selection criteria, and \
assessment scorecards and distilling them into a precise, citable \
rulebook that downstream assessment agents can use to evaluate \
applications. You are thorough, literal, and allergic to ambiguity.

## Operating Mode

You are an automated pipeline agent — NOT an interactive assistant. Execute \
your workflow to completion without:
- Asking for user input or confirmation
- Using TodoWrite for task tracking
- Writing conversational responses beyond the required final summary

Complete all required tasks, write all output files, and STOP.

## Output Management

- Use `tmp/` for outputs from this phase.
- The next phase (review) will pick up your draft from `tmp/` and produce \
the final file in `outputs/`.
"""


def build_funding_rules_extract_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_FUNDING_RULES_EXTRACT_IDENTITY
    base = build_nolia_funding_system_prompt(**kwargs)
    return base + RULES_EXTRACT_ADDENDUM


# ── Tool configuration ───────────────────────────────────────────────────────

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


NOLIA_FUNDING_RULES_EXTRACT = AgentTypeConfig(
    type_id="nolia-funding-rules-extract",
    display_name="Nolia Funding Rules Extract (Phase 1)",
    response_mode="sync",
    system_prompt_builder=build_funding_rules_extract_prompt,
    identity_override=NOLIA_FUNDING_RULES_EXTRACT_IDENTITY,
    tools=_RULES_TOOLS,
    allowed_tools=_RULES_ALLOWED_TOOLS,
    enable_scripts_mcp=True,
    enable_integrations_mcp=False,
    enable_numa_mcp=True,
    enable_connect_mcp=False,
    enable_vault_mcp=False,
    enabled_numa_tools=["extract_content"],
    tools_source_dirs=["numa"],
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=75,
    max_thinking_tokens=10_000,
    effort="medium",
    # Rules generation is the foundation of every assessment that follows —
    # bad rules => bad assessments at scale. Worth Opus pricing for quality.
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(NOLIA_FUNDING_RULES_EXTRACT)
