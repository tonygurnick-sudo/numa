"""Parent orchestrator type for Nolia rules generation.

This is the entry point agent type invoked when a KB needs rules generated.
It does NOT run Claude directly — instead, the ``pipeline_orchestrator``
callable (``run_nolia_rules_pipeline``) manages the two-phase pipeline.
"""

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .rules_orchestrator import run_nolia_rules_pipeline

NOLIA_RULES_GENERATOR = AgentTypeConfig(
    type_id="nolia-rules-generator",
    display_name="Nolia Rules Generator",
    response_mode="fire-and-forget",
    # Custom orchestrator for the two-phase rules pipeline
    pipeline_orchestrator=run_nolia_rules_pipeline,
    # S3 path for rules generation runs (under v2-apps)
    s3_prefix_template="v2-apps/nolia/{user_sub}/{conversation_id}",
    pipeline_result_mode="last_step_text",
    # KBs are downloaded in the orchestrator, not from the request
    restrict_kbs=True,
    restrict_integrations=True,
    # Parent doesn't run Claude itself
    max_turns=1,
    max_thinking_tokens=1000,
)

register_agent_type(NOLIA_RULES_GENERATOR)
