"""Parent orchestrator type for Nolia Funding application comparison.

Entry point invoked by the frontend when a user selects 2–3 prior assessments
for side-by-side comparison. Does NOT run Claude directly — the
``pipeline_orchestrator`` callable (``run_nolia_funding_compare_pipeline``)
manages the single-phase pipeline.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .compare_orchestrator import run_nolia_funding_compare_pipeline

NOLIA_FUNDING_COMPARE = AgentTypeConfig(
    type_id="nolia-funding-compare",
    display_name="Nolia Funding Comparison",
    response_mode="fire-and-forget",
    pipeline_orchestrator=run_nolia_funding_compare_pipeline,
    s3_prefix_template="v2-apps/nolia-funding/{user_sub}/{conversation_id}",
    pipeline_result_mode="last_step_text",
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=1,
    max_thinking_tokens=1000,
)

register_agent_type(NOLIA_FUNDING_COMPARE)
