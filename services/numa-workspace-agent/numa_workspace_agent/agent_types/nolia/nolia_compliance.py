"""Parent orchestrator type for Nolia compliance reviews.

This is the entry point agent type invoked by the frontend. It does NOT
run Claude directly — instead, the ``pipeline_orchestrator`` callable
(``run_nolia_pipeline``) manages the multi-phase pipeline with parallel
execution and conditional branching.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .orchestrator import run_nolia_pipeline
from .workspace_setup import setup_nolia_workspace

NOLIA_COMPLIANCE = AgentTypeConfig(
    type_id="nolia-compliance",
    display_name="Nolia Compliance Review",
    response_mode="fire-and-forget",
    # Custom orchestrator replaces the default sequential pipeline
    pipeline_orchestrator=run_nolia_pipeline,
    # S3 path for Nolia runs (under v2-apps)
    s3_prefix_template="v2-apps/nolia/{user_sub}/{conversation_id}",
    # Orchestrator returns the final text directly
    pipeline_result_mode="last_step_text",
    # KBs are downloaded in workspace_setup, not from the request
    restrict_kbs=True,
    restrict_integrations=True,
    # Parent doesn't run Claude itself
    max_turns=1,
    max_thinking_tokens=1000,
)

register_agent_type(NOLIA_COMPLIANCE)
