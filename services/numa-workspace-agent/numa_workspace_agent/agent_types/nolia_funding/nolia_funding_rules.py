"""Parent orchestrator type for Nolia Funding rules generation.

Entry point invoked by the frontend when a new Funding KB needs its
``funding-rules.md`` file generated (or regenerated). Does NOT run Claude
directly — the ``pipeline_orchestrator`` callable
(``run_nolia_funding_rules_pipeline``) manages the multi-phase pipeline.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .rules_orchestrator import run_nolia_funding_rules_pipeline

NOLIA_FUNDING_RULES_GENERATOR = AgentTypeConfig(
    type_id="nolia-funding-rules-generator",
    display_name="Nolia Funding Rules Generator",
    response_mode="fire-and-forget",
    pipeline_orchestrator=run_nolia_funding_rules_pipeline,
    s3_prefix_template="v2-apps/nolia-funding/{user_sub}/{conversation_id}",
    pipeline_result_mode="last_step_text",
    # KBs are downloaded in the orchestrator's workspace setup, not from the request
    restrict_kbs=True,
    restrict_integrations=True,
    # Parent doesn't run Claude itself — phases do
    max_turns=1,
    max_thinking_tokens=1000,
)

register_agent_type(NOLIA_FUNDING_RULES_GENERATOR)
