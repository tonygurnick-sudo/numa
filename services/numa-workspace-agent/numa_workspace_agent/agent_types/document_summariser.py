"""
Document Summariser — reads uploaded documents and produces structured summaries.

This is the first real (non-chat) agent type. It demonstrates:
    - Custom system prompt builder (extends the default with summariser instructions)
    - Sync response mode (caller waits for the JSON result)
    - Restricted tools (read/write only — no Bash, no MCP, no integrations)
    - result_file convention (agent writes /workdir/outputs/result.json)

Typical callers: Step Functions, APIs, or other backend systems that need a
structured document summary as JSON.
"""

from ..prompts import build_workspace_system_prompt
from .base import AgentTypeConfig
from .registry import register_agent_type

# ---------------------------------------------------------------------------
# Summariser-specific system prompt addendum
# ---------------------------------------------------------------------------

SUMMARISER_ADDENDUM = """

## Your Role

You are a document summariser. Your job is to read uploaded documents and
produce clear, structured summaries.

## Instructions

1. Read the uploaded file(s) in /workdir/uploads/
2. Analyse the content thoroughly
3. Write your summary to /workdir/outputs/result.json with this schema:

```json
{
    "title": "Brief title of the document",
    "type": "contract | report | policy | letter | other",
    "bullets": [
        "Key point 1",
        "Key point 2",
        "..."
    ],
    "word_count_original": 1234,
    "summary_text": "A 2-3 paragraph narrative summary..."
}
```

4. Also respond conversationally with the summary text so the user sees it.

## Rules

- Be concise and factual
- Preserve key numbers, dates, names, and terms exactly as they appear
- If the document has multiple sections, summarise each
- Do NOT invent information not in the document
- If you cannot read the file (unsupported format, corrupted, etc.), explain
  what went wrong in your response and write an error result.json:
  `{"error": "reason", "title": "", "type": "other", "bullets": [], "summary_text": ""}`
"""


def build_summariser_prompt(**kwargs) -> str:
    """Build the system prompt for the document summariser.

    Calls the default ``build_workspace_system_prompt()`` for all the
    standard Numa sections (identity, workspace, tools, etc.) and then
    appends the summariser-specific addendum with instructions and the
    result.json schema.
    """
    base = build_workspace_system_prompt(**kwargs)
    return base + SUMMARISER_ADDENDUM


# ---------------------------------------------------------------------------
# Agent type configuration
# ---------------------------------------------------------------------------

DOCUMENT_SUMMARISER = AgentTypeConfig(
    type_id="document-summariser",
    display_name="Document Summariser",
    # Sync — caller waits for the structured result
    response_mode="sync",
    # Custom system prompt extending the default with summariser instructions
    system_prompt_builder=build_summariser_prompt,
    # Minimal SDK tools — file reading + Write (for result.json)
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
    # No MCP tools at all
    enable_scripts_mcp=False,  # No code execution
    enable_integrations_mcp=False,  # No integrations
    enable_numa_mcp=False,  # No Numa tools
    # Use default plugins for basic skills
    plugins_path="/app/plugins/numa",
    # No KB or integrations
    restrict_kbs=True,
    restrict_integrations=True,
    # Agent writes /workdir/outputs/result.json — the handler reads it
    pipeline_result_mode="result_file",
    max_turns=10,  # Simple task, few turns needed
    max_thinking_tokens=5000,
)

register_agent_type(DOCUMENT_SUMMARISER)
