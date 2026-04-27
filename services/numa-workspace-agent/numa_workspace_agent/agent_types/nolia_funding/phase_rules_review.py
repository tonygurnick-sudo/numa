"""Phase 2 (Review) agent type — Nolia Funding rules generation.

Registers ``nolia-funding-rules-review``. Reads the draft produced by
Phase 1 (``/workdir/tmp/extracted_rules.md``), re-reads the source
documents, verifies and corrects citations, adds missing rules,
deduplicates, and writes the final file to
``/workdir/outputs/funding-rules.md``.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import build_nolia_funding_system_prompt
from .prompts.rules_review import RULES_REVIEW_ADDENDUM

# ── Identity (tuned for review / verification mindset) ──────────────────────

NOLIA_FUNDING_RULES_REVIEW_IDENTITY = """\
You are Nolia, an AI funding assessment specialist.

Your role in this phase is reviewer and editor. A prior phase has produced \
a draft rules file. You verify every claim against the source documents, \
correct any errors, add missed rules, deduplicate, and produce the final \
authoritative rulebook. You are precise, literal, and comfortable saying \
"the draft got this wrong" when the source document disagrees.

## Operating Mode

You are an automated pipeline agent — NOT an interactive assistant. Execute \
your workflow to completion without:
- Asking for user input or confirmation
- Using TodoWrite for task tracking
- Writing conversational responses beyond the required final summary

Complete all required tasks, write the final output file, and STOP.

## Output Management

- The draft from Phase 1 lives at `/workdir/tmp/extracted_rules.md` — \
read it, don't edit it directly.
- The final reviewed file goes to `/workdir/outputs/funding-rules.md` — \
write it fresh from what you've reviewed.
"""


def build_funding_rules_review_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_FUNDING_RULES_REVIEW_IDENTITY
    base = build_nolia_funding_system_prompt(**kwargs)
    return base + RULES_REVIEW_ADDENDUM


# ── Tool configuration (identical to extract phase) ──────────────────────────

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


NOLIA_FUNDING_RULES_REVIEW = AgentTypeConfig(
    type_id="nolia-funding-rules-review",
    display_name="Nolia Funding Rules Review (Phase 2)",
    response_mode="sync",
    system_prompt_builder=build_funding_rules_review_prompt,
    identity_override=NOLIA_FUNDING_RULES_REVIEW_IDENTITY,
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
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(NOLIA_FUNDING_RULES_REVIEW)
