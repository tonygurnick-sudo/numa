"""Parent orchestrator type for Nolia Funding application assessment.

Entry point invoked by the frontend when a user uploads an application for
assessment against a Fund/Grant/Scholarship. Does NOT run Claude directly —
the ``pipeline_orchestrator`` callable (``run_nolia_funding_assess_pipeline``)
manages the multi-phase pipeline.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .assess_orchestrator import run_nolia_funding_assess_pipeline

NOLIA_FUNDING_ASSESS = AgentTypeConfig(
    type_id="nolia-funding-assess",
    display_name="Nolia Funding Assessment",
    response_mode="fire-and-forget",
    pipeline_orchestrator=run_nolia_funding_assess_pipeline,
    s3_prefix_template="v2-apps/nolia-funding/{user_sub}/{conversation_id}",
    pipeline_result_mode="last_step_text",
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=1,
    max_thinking_tokens=1000,
)

register_agent_type(NOLIA_FUNDING_ASSESS)
