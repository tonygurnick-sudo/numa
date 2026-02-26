"""
Profile Researcher — Step 1 of the profile-creator pipeline.

Researches a person based on the user's prompt and writes a structured
draft profile to /workdir/outputs/profile_draft.json. The next step
(profile-validator) reads and validates this file.
"""

from ..prompts import build_workspace_system_prompt
from .base import AgentTypeConfig
from .registry import register_agent_type

RESEARCHER_ADDENDUM = """

## Your Role

You are a profile researcher. Given a person's name and any context provided,
research them thoroughly and produce a structured profile.

## Instructions

1. Use the information provided in the user's prompt (and any uploaded files
   in /workdir/uploads/ if present) to build a comprehensive profile.
2. If web search is available, use it to find additional public information.
3. Write your research to /workdir/outputs/profile_draft.json with this schema:

```json
{
    "name": "Full Name",
    "role": "Current role / title",
    "organisation": "Company or affiliation",
    "background": "2-3 paragraph background summary",
    "skills": ["skill1", "skill2", "..."],
    "experience_highlights": [
        "Notable achievement or role 1",
        "Notable achievement or role 2"
    ],
    "contact_info": {
        "email": "if known",
        "linkedin": "if known"
    },
    "notes": "Any caveats, uncertainties, or areas needing verification",
    "confidence": "high | medium | low"
}
```

4. Also respond conversationally with a summary of what you found.

## Rules

- Be factual — do NOT invent information
- Clearly flag anything you're uncertain about in the "notes" field
- Set "confidence" based on how much verifiable information you found
- If you can't find meaningful information, say so honestly
"""


def build_researcher_prompt(**kwargs) -> str:
    base = build_workspace_system_prompt(**kwargs)
    return base + RESEARCHER_ADDENDUM


PROFILE_RESEARCHER = AgentTypeConfig(
    type_id="profile-researcher",
    display_name="Profile Researcher (Step 1)",
    response_mode="sync",
    system_prompt_builder=build_researcher_prompt,
    # Can use code execution and web search for research
    tools=[
        "Task",
        "TaskOutput",
        "Bash",
        "Glob",
        "Grep",
        "Read",
        "Edit",
        "Write",
        "TodoWrite",
        "KillShell",
        "Skill",
    ],
    allowed_tools=[
        "Task",
        "TaskOutput",
        "Bash",
        "Glob",
        "Grep",
        "Read",
        "Edit",
        "Write",
        "TodoWrite",
        "KillShell",
        "Skill",
    ],
    enable_scripts_mcp=True,
    enable_integrations_mcp=False,
    # Web search available for research
    enabled_numa_tools=["web_search"],
    tools_source_dirs=["numa"],
    plugins_path="/app/plugins/numa",
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=15,
    max_thinking_tokens=5000,
)

register_agent_type(PROFILE_RESEARCHER)
