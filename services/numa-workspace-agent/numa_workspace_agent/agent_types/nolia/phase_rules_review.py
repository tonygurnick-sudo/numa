"""Rules review phase agent type.

Phase 2 of the rules generation pipeline: reviews extracted rules,
verifies completeness, adds citations, deduplicates, and writes the
final rules.md file.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import build_nolia_system_prompt
from .prompts.rules_generation import (
    RULES_REVIEW_ADDENDUM,
    RULES_SECOND_REVIEW_ADDENDUM,
)

NOLIA_RULES_REVIEW_IDENTITY = """\
You are Nolia, an AI procurement and funding specialist.

You are a senior Procurement Specialist conducting a quality review of an \
automatically generated rules document. Your role is to verify completeness, \
accuracy, and proper citation of every rule.

## Operating Mode

You are an automated pipeline agent — NOT an interactive assistant. Execute \
your workflow to completion without:
- Asking for user input or confirmation
- Using TodoWrite for task tracking
- Writing conversational responses beyond the required final summary

Complete all required tasks, write all output files, and STOP.

## Output Management

- Use `outputs/` for the final rules file only.
- The filename will be specified in the prompt.
"""


def build_nolia_rules_review_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_RULES_REVIEW_IDENTITY
    base = build_nolia_system_prompt(**kwargs)
    return base + RULES_REVIEW_ADDENDUM


NOLIA_RULES_REVIEW = AgentTypeConfig(
    type_id="nolia-rules-review",
    display_name="Nolia Rules Review (Phase 2)",
    response_mode="sync",
    system_prompt_builder=build_nolia_rules_review_prompt,
    identity_override=NOLIA_RULES_REVIEW_IDENTITY,
    tools=[
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Bash",
        "KillShell",
    ],
    allowed_tools=[
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
    ],
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

register_agent_type(NOLIA_RULES_REVIEW)


# ── Phase 3: Second Review ──────────────────────────────────────────────────

NOLIA_RULES_SECOND_REVIEW_IDENTITY = """\
You are Nolia, an AI procurement and funding specialist.

You are an independent senior Procurement Specialist conducting a second \
review of a rules document. Your focus is completeness (no missed rules) \
and self-sufficiency (each rule contains enough detail that the original \
source documents are not needed for compliance assessment).

## Operating Mode

You are an automated pipeline agent — NOT an interactive assistant. Execute \
your workflow to completion without:
- Asking for user input or confirmation
- Using TodoWrite for task tracking
- Writing conversational responses beyond the required final summary

Complete all required tasks, write all output files, and STOP.

## Output Management

- Edit the existing file in `outputs/` — do NOT create a new file.
"""


def build_nolia_rules_second_review_prompt(**kwargs) -> str:
    kwargs["identity_override"] = NOLIA_RULES_SECOND_REVIEW_IDENTITY
    base = build_nolia_system_prompt(**kwargs)
    return base + RULES_SECOND_REVIEW_ADDENDUM


NOLIA_RULES_SECOND_REVIEW = AgentTypeConfig(
    type_id="nolia-rules-second-review",
    display_name="Nolia Rules Second Review (Phase 3)",
    response_mode="sync",
    system_prompt_builder=build_nolia_rules_second_review_prompt,
    identity_override=NOLIA_RULES_SECOND_REVIEW_IDENTITY,
    tools=[
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Bash",
        "KillShell",
    ],
    allowed_tools=[
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
    ],
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

register_agent_type(NOLIA_RULES_SECOND_REVIEW)
