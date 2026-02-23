"""
Profile Validator — Step 2 of the profile-creator pipeline.

Reads the draft profile from /workdir/session/profile_draft.json (written by
the profile-researcher step), validates it, fixes any issues, and writes the
final validated profile to /workdir/session/result.json.
"""

from ..prompts import build_workspace_system_prompt
from .base import AgentTypeConfig
from .registry import register_agent_type

VALIDATOR_ADDENDUM = """

## Your Role

You are a profile validator and quality checker. A previous researcher has
written a draft profile to /workdir/session/profile_draft.json. Your job is
to review it, fix any issues, and produce the final version.

## Instructions

1. Read /workdir/session/profile_draft.json
2. Validate the profile against these quality checks:
   - All required fields are present and non-empty
   - "background" is well-written and factual-sounding (no speculation)
   - "skills" list is reasonable (not too vague, not fabricated)
   - "confidence" level is appropriate given the content
   - No obvious contradictions or red flags
3. Fix any issues you find (improve wording, remove speculation, etc.)
4. Add a "validation" field to the output with your assessment
5. Write the final validated profile to /workdir/session/result.json:

```json
{
    "name": "...",
    "role": "...",
    "organisation": "...",
    "background": "...",
    "skills": ["..."],
    "experience_highlights": ["..."],
    "contact_info": {"email": "...", "linkedin": "..."},
    "notes": "...",
    "confidence": "high | medium | low",
    "validation": {
        "status": "approved | approved_with_changes | flagged",
        "changes_made": ["List of changes you made"],
        "warnings": ["Any remaining concerns"]
    }
}
```

6. Respond conversationally with a summary of your validation.

## Rules

- Do NOT add information that wasn't in the draft — only fix/improve
- If the draft is clearly fabricated or empty, set status to "flagged"
- Be strict — better to flag concerns than to let bad data through
"""


def build_validator_prompt(**kwargs) -> str:
    base = build_workspace_system_prompt(**kwargs)
    return base + VALIDATOR_ADDENDUM


PROFILE_VALIDATOR = AgentTypeConfig(
    type_id="profile-validator",
    display_name="Profile Validator (Step 2)",
    response_mode="sync",
    system_prompt_builder=build_validator_prompt,
    # Minimal tools — just read the draft and write the result
    tools=[
        "Read",
        "Glob",
        "Grep",
        "Write",
        "TodoWrite",
    ],
    allowed_tools=[
        "Read",
        "Glob",
        "Grep",
        "Write",
        "TodoWrite",
    ],
    enable_scripts_mcp=False,
    enable_integrations_mcp=False,
    enabled_numa_tools=[],
    tools_source_dirs=[],
    plugins_path="/app/plugins/numa",
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=5,
    max_thinking_tokens=3000,
)

register_agent_type(PROFILE_VALIDATOR)
