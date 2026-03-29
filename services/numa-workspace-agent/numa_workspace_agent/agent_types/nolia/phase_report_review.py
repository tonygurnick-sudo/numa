"""Phase 4b: Report Review agent type."""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import NOLIA_SPECIALIST_IDENTITY, build_nolia_system_prompt
from .prompts.report import (
    NOLIA_REPORT_FIDELITY_AUDIT_ADDENDUM,
    NOLIA_REPORT_REVIEW_ADDENDUM,
)


def build_nolia_report_review_prompt(**kwargs) -> str:
    """Build system prompt for the Nolia Report Review phase."""
    kwargs["identity_override"] = NOLIA_SPECIALIST_IDENTITY
    base = build_nolia_system_prompt(**kwargs)
    return base + NOLIA_REPORT_REVIEW_ADDENDUM


NOLIA_REPORT_REVIEW = AgentTypeConfig(
    type_id="nolia-report-review",
    display_name="Nolia Report Review (Phase 4b)",
    response_mode="sync",
    system_prompt_builder=build_nolia_report_review_prompt,
    identity_override=NOLIA_SPECIALIST_IDENTITY,
    tools=[
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Bash",
        "KillShell",
        "Task",
        "TaskOutput",
    ],
    allowed_tools=[
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
        "Bash(rm:*)",
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
    enable_security_hooks=False,
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(NOLIA_REPORT_REVIEW)


# ── Phase 4c: Report Fidelity Audit ─────────────────────────────────────────


def build_nolia_report_fidelity_audit_prompt(**kwargs) -> str:
    """Build system prompt for the Nolia Report Fidelity Audit phase."""
    kwargs["identity_override"] = NOLIA_SPECIALIST_IDENTITY
    base = build_nolia_system_prompt(**kwargs)
    return base + NOLIA_REPORT_FIDELITY_AUDIT_ADDENDUM


NOLIA_REPORT_FIDELITY_AUDIT = AgentTypeConfig(
    type_id="nolia-report-fidelity-audit",
    display_name="Nolia Report Fidelity Audit (Phase 4c)",
    response_mode="sync",
    system_prompt_builder=build_nolia_report_fidelity_audit_prompt,
    identity_override=NOLIA_SPECIALIST_IDENTITY,
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
        "Bash(rm:*)",
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
    enable_security_hooks=False,
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(NOLIA_REPORT_FIDELITY_AUDIT)
