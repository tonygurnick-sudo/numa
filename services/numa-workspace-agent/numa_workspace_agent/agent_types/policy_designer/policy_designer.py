"""Parent orchestrator type for the NZSBA Policy Designer V2 app (FEAT-174).

This is the entry point agent type invoked by the v2-apps API. It does NOT
run Claude directly — the ``pipeline_orchestrator`` callable
(``run_policy_designer_pipeline``) manages the three-phase pipeline
(generation → review & assemble → format rendering) and sends the
completion email.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .orchestrator import run_policy_designer_pipeline

POLICY_DESIGNER = AgentTypeConfig(
    type_id="policy-designer",
    display_name="NZSBA Policy Designer",
    response_mode="fire-and-forget",
    # Custom orchestrator replaces the default sequential pipeline
    pipeline_orchestrator=run_policy_designer_pipeline,
    # S3 path for runs (matches the v2-apps API prefix for appId=policy-designer)
    s3_prefix_template="v2-apps/policy-designer/{user_sub}/{conversation_id}",
    # Orchestrator returns the final text directly
    pipeline_result_mode="last_step_text",
    # No KBs or integrations anywhere in this pipeline
    restrict_kbs=True,
    restrict_integrations=True,
    # Parent doesn't run Claude itself
    max_turns=1,
    max_thinking_tokens=1000,
)

register_agent_type(POLICY_DESIGNER)
