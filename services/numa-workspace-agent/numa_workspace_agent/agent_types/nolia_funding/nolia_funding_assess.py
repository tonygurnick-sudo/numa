"""Parent orchestrator type for Nolia Funding application assessment.

Entry point invoked by the frontend when a user uploads an application for
assessment against a Fund/Grant/Scholarship. Does NOT run Claude directly —
the ``pipeline_orchestrator`` callable manages the multi-phase pipeline.

# ── Pipeline toggle ──────────────────────────────────────────────────────────
# Two orchestrators are wired up. Swap which one ``pipeline_orchestrator``
# points at to change the assessment behaviour without re-deploying the
# frontend (the agent type ID stays ``nolia-funding-assess``):
#
#   run_nolia_funding_assess_pipeline         — production: 3-step
#                                               (Sonnet) Extract → Evaluate
#                                               → Render.
#   run_nolia_funding_assess_pipeline_single  — V2 test: 1-step (Opus),
#                                               combined prompt. See
#                                               ``assess_orchestrator_single.py``.
#
# Currently active: SINGLE-STEP (V2 test). Revert by swapping the
# ``pipeline_orchestrator=`` line below back to the three-phase function.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .assess_orchestrator import (  # noqa: F401  (kept importable for revert)
    run_nolia_funding_assess_pipeline,
)
from .assess_orchestrator_single import run_nolia_funding_assess_pipeline_single

NOLIA_FUNDING_ASSESS = AgentTypeConfig(
    type_id="nolia-funding-assess",
    display_name="Nolia Funding Assessment",
    response_mode="fire-and-forget",
    pipeline_orchestrator=run_nolia_funding_assess_pipeline_single,
    s3_prefix_template="v2-apps/nolia-funding/{user_sub}/{conversation_id}",
    pipeline_result_mode="last_step_text",
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=1,
    max_thinking_tokens=1000,
)

register_agent_type(NOLIA_FUNDING_ASSESS)
