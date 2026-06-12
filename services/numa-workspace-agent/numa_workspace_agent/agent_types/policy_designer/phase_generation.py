"""Phase 1: Generation agent type for the Policy Designer pipeline."""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import POLICY_DESIGNER_IDENTITY, build_policy_designer_system_prompt
from .prompts.generation import GENERATION_ADDENDUM


def build_generation_prompt(**kwargs) -> str:
    """Build system prompt for the Policy Designer Generation phase."""
    kwargs["identity_override"] = POLICY_DESIGNER_IDENTITY
    base = build_policy_designer_system_prompt(**kwargs)
    return base + GENERATION_ADDENDUM


POLICY_DESIGNER_GENERATION = AgentTypeConfig(
    type_id="policy-designer-generation",
    display_name="Policy Designer Generation (Phase 1)",
    response_mode="sync",
    system_prompt_builder=build_generation_prompt,
    identity_override=POLICY_DESIGNER_IDENTITY,
    tools=["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    allowed_tools=[
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Bash(ls:*)",
        "Bash(head:*)",
        "Bash(tail:*)",
        "Bash(cat:*)",
        "Bash(wc:*)",
        "Bash(grep:*)",
        "Bash(mkdir:*)",
    ],
    enable_scripts_mcp=False,
    enable_integrations_mcp=False,
    enable_numa_mcp=False,
    enable_connect_mcp=False,
    enable_vault_mcp=False,
    enabled_numa_tools=[],
    tools_source_dirs=["numa"],
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=40,
    max_thinking_tokens=10_000,
    effort="medium",
    enable_security_hooks=False,
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(POLICY_DESIGNER_GENERATION)
