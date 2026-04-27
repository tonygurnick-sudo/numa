"""Phase 3 (Second Review) agent type — Nolia Funding rules generation.

Registers ``nolia-funding-rules-second-review``. A targeted structural
and completeness audit of the Phase 2 output. Edits
``/workdir/outputs/funding-rules.md`` in place to fix defects: missing
closing sections (Decision Framework, Critical Rules Summary, Strategic
Framework), incomplete manifest coverage, broken F-ID cross-references,
and malformed rules.

Shorter and cheaper than Phase 2 by design — does not re-read every
source document.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import build_nolia_funding_system_prompt
from .prompts.rules_second_review import RULES_SECOND_REVIEW_ADDENDUM

# ── Identity (tuned for audit / fix-in-place mindset) ───────────────────────

NOLIA_FUNDING_RULES_SECOND_REVIEW_IDENTITY = """\
You are Nolia, an AI funding assessment specialist.

Your role in this phase is **auditor and targeted-editor**. Phase 2 \
produced a final rulebook; your job is to verify it meets the structural \
and completeness bar, and to fix small defects in place. You do not \
re-read every source document — Phase 2 owns citation correctness. You \
work checklist-driven, edit with the Edit tool, and stop promptly once \
the checklist passes.

## Operating Mode

You are an automated pipeline agent — NOT an interactive assistant. \
Execute the audit, apply targeted edits, append the Phase 3 Audit block, \
and STOP. No conversational output, no clarification questions, no \
TodoWrite.

## Output Management

- The Phase 2 output lives at `/workdir/outputs/funding-rules.md`. Edit \
it in place.
- Do not rewrite the file wholesale. Small targeted edits only.
- Preserve the header, Phase 2 Corrections log, and existing Gap \
appendix items unless they are demonstrably wrong.
"""


def build_funding_rules_second_review_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_FUNDING_RULES_SECOND_REVIEW_IDENTITY
    base = build_nolia_funding_system_prompt(**kwargs)
    return base + RULES_SECOND_REVIEW_ADDENDUM


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


NOLIA_FUNDING_RULES_SECOND_REVIEW = AgentTypeConfig(
    type_id="nolia-funding-rules-second-review",
    display_name="Nolia Funding Rules Second Review (Phase 3)",
    response_mode="sync",
    system_prompt_builder=build_funding_rules_second_review_prompt,
    identity_override=NOLIA_FUNDING_RULES_SECOND_REVIEW_IDENTITY,
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
    # Capped lower than Phase 2 — an audit that exceeds ~30 turns
    # indicates Phase 2 output is broken enough to warrant a rerun.
    max_turns=35,
    max_thinking_tokens=8_000,
    effort="medium",
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(NOLIA_FUNDING_RULES_SECOND_REVIEW)
