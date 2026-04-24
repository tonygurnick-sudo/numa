"""Phase 3 (Second Review) agent type — Nolia Funding Global rules.

Registers ``nolia-funding-rules-second-review-global``. Global-KB
variant of the Phase 3 audit. Narrower than the Funding-KB variant
because Global rules have no Decision Framework and no manifest
coverage check.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import build_nolia_funding_system_prompt
from .prompts.rules_second_review_global import RULES_SECOND_REVIEW_GLOBAL_ADDENDUM

# ── Identity (auditor mindset, Global-scoped) ───────────────────────────────

NOLIA_FUNDING_RULES_SECOND_REVIEW_GLOBAL_IDENTITY = """\
You are Nolia, an AI funding assessment specialist.

Your role in this phase is **auditor and targeted-editor** of the \
organisation's **Global** assessment rulebook. Phase 2 produced the \
final Global rules file; your job is to verify it meets the structural \
and completeness bar, fix small defects in place, and remove any rules \
that are fund-specific and don't belong at Global level. You do not \
re-read every source document — Phase 2 owns citation correctness.

## Operating Mode

You are an automated pipeline agent — NOT an interactive assistant. \
Execute the audit, apply targeted edits, append the Phase 3 Audit block, \
and STOP. No conversational output, no clarification questions, no \
TodoWrite.

## Output Management

- The Phase 2 output lives at `/workdir/outputs/global-rules.md`. Edit \
it in place.
- Do not rewrite the file wholesale. Small targeted edits only.
- Preserve the header, Phase 2 Corrections log, and existing Gap \
appendix items unless they are demonstrably wrong.
"""


def build_funding_rules_second_review_global_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_FUNDING_RULES_SECOND_REVIEW_GLOBAL_IDENTITY
    base = build_nolia_funding_system_prompt(**kwargs)
    return base + RULES_SECOND_REVIEW_GLOBAL_ADDENDUM


# ── Tool configuration (same as Phase 2) ─────────────────────────────────────

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


NOLIA_FUNDING_RULES_SECOND_REVIEW_GLOBAL = AgentTypeConfig(
    type_id="nolia-funding-rules-second-review-global",
    display_name="Nolia Funding Rules Second Review — Global (Phase 3)",
    response_mode="sync",
    system_prompt_builder=build_funding_rules_second_review_global_prompt,
    identity_override=NOLIA_FUNDING_RULES_SECOND_REVIEW_GLOBAL_IDENTITY,
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
    max_turns=30,
    max_thinking_tokens=8_000,
    effort="medium",
    default_model="anthropic.claude-sonnet-4-6",
)

register_agent_type(NOLIA_FUNDING_RULES_SECOND_REVIEW_GLOBAL)
