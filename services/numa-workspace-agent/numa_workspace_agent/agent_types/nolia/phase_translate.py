"""Phase 5: Translation agent type."""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import NOLIA_SPECIALIST_IDENTITY, build_nolia_system_prompt
from .prompts.translate import NOLIA_TRANSLATE_ADDENDUM


def build_nolia_translate_prompt(**kwargs) -> str:
    """Build system prompt for the Nolia Translation phase."""
    kwargs["identity_override"] = NOLIA_SPECIALIST_IDENTITY
    base = build_nolia_system_prompt(**kwargs)
    return base + NOLIA_TRANSLATE_ADDENDUM


NOLIA_TRANSLATE = AgentTypeConfig(
    type_id="nolia-translate",
    display_name="Nolia Translation (Phase 5)",
    response_mode="sync",
    system_prompt_builder=build_nolia_translate_prompt,
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
    enable_numa_mcp=False,
    enable_connect_mcp=False,
    enable_vault_mcp=False,
    enabled_numa_tools=[],
    tools_source_dirs=[],
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=75,
    max_thinking_tokens=10_000,
    effort="medium",
    enable_security_hooks=False,
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(NOLIA_TRANSLATE)
