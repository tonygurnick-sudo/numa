"""
Profile Creator — a two-step pipeline that researches and validates a person profile.

This is a test pipeline agent type that demonstrates:
    - pipeline_steps chaining two agent types sequentially
    - Shared /workdir filesystem between steps
    - result_file mode (reads /workdir/outputs/result.json from the final step)
    - Step 1 (profile-researcher) writes profile_draft.json
    - Step 2 (profile-validator) reads the draft, validates, writes result.json

Usage: Send a prompt like "Create a profile for Elon Musk" or
"Build a profile for our new hire Jane Smith, Senior Engineer at Acme Corp"
"""

from .base import AgentTypeConfig
from .registry import register_agent_type

PROFILE_CREATOR = AgentTypeConfig(
    type_id="profile-creator",
    display_name="Profile Creator",
    # Pipelines always run sync — the caller waits for the full result
    response_mode="sync",
    # Chain: researcher writes draft -> validator reviews and writes result.json
    pipeline_steps=["profile-researcher", "profile-validator"],
    # Read /workdir/outputs/result.json (written by the validator) as final output
    pipeline_result_mode="result_file",
    # Parent doesn't run Claude itself — the steps do
    max_turns=1,
    max_thinking_tokens=1000,
)

register_agent_type(PROFILE_CREATOR)
