"""Phase 2: Review & Assemble agent type for the Policy Designer pipeline."""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import POLICY_DESIGNER_IDENTITY, build_policy_designer_system_prompt
from .prompts.review import REVIEW_ADDENDUM


def build_review_prompt(**kwargs) -> str:
    """Build system prompt for the Policy Designer Review & Assemble phase."""
    kwargs["identity_override"] = POLICY_DESIGNER_IDENTITY
    base = build_policy_designer_system_prompt(**kwargs)
    return base + REVIEW_ADDENDUM


POLICY_DESIGNER_REVIEW = AgentTypeConfig(
    type_id="policy-designer-review",
    display_name="Policy Designer Review & Assemble (Phase 2)",
    response_mode="sync",
    system_prompt_builder=build_review_prompt,
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
        "Bash(cp:*)",
        "Bash(mv:*)",
        "Bash(python3:*)",
    ],
    enable_scripts_mcp=False,
    enable_integrations_mcp=False,
    enable_numa_mcp=False,
    enable_connect_mcp=False,
    enable_vault_mcp=False,
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=40,
    max_thinking_tokens=10_000,
    effort="medium",
    enable_security_hooks=False,
    default_model="anthropic.claude-opus-4-6-v1",
)

register_agent_type(POLICY_DESIGNER_REVIEW)
