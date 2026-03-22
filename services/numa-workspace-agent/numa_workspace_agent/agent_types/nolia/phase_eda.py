"""Phase 1: EDA (Exploratory Document Analysis) agent type."""

from claude_agent_sdk import AgentDefinition

from ..base import AgentTypeConfig
from ..registry import register_agent_type
from .prompts.base import NOLIA_EDA_IDENTITY, build_nolia_system_prompt
from .prompts.eda import NOLIA_EDA_ADDENDUM


def build_nolia_eda_prompt(**kwargs) -> str:
    """Build system prompt for the Nolia EDA phase."""
    kwargs["identity_override"] = NOLIA_EDA_IDENTITY
    base = build_nolia_system_prompt(**kwargs)
    return base + NOLIA_EDA_ADDENDUM


# Pre-defined Haiku sub-agent for EDA page chunk analysis.
# The parent EDA agent pre-splits the document into chunk files and launches
# one Task per chunk using this agent. Haiku is ~10x cheaper than Sonnet
# and fast enough for structured data extraction from text.
EDA_PAGE_ANALYZER = AgentDefinition(
    description=(
        "Fast document chunk analyzer. Use this agent for ALL Task sub-agent "
        "calls when processing page chunks. It reads a single chunk JSON file "
        "and extracts structured data (bidders, forms, lots, dates, quality "
        "issues, page index)."
    ),
    prompt=(
        "You are a fast document data extractor for World Bank procurement "
        "documents. You will be given a chunk file containing a JSON "
        "array of page objects. Extract all requested data points in a single "
        "pass and write the result file. Be thorough but fast.\n\n"
        "Rules:\n"
        "- Read ONLY the chunk file specified in your task. Do NOT explore "
        "the filesystem or read other files.\n"
        "- Write your result JSON file and STOP immediately.\n"
        "- Use page_number from the JSON, NOT printed page numbers in text.\n"
        "- Do NOT make compliance judgments — just extract data.\n"
        "- Do NOT use TodoWrite or ask for user input.\n"
    ),
    model="haiku",
)


NOLIA_EDA = AgentTypeConfig(
    type_id="nolia-eda",
    display_name="Nolia EDA (Phase 1)",
    response_mode="sync",
    system_prompt_builder=build_nolia_eda_prompt,
    identity_override=NOLIA_EDA_IDENTITY,
    tools=[
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Bash",
        "KillShell",
        "Task",
        "TaskOutput",
    ],
    allowed_tools=[
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "BashOutput",
        "KillShell",
        "Task",
        "TaskOutput",
        "mcp__scripts__execute_script",
        "Bash(python:*)",
        "Bash(python3:*)",
        "Bash(python3.13:*)",
        "Bash(ls:*)",
        "Bash(head:*)",
        "Bash(tail:*)",
        "Bash(cat:*)",
        "Bash(wc:*)",
        "Bash(sort:*)",
        "Bash(cut:*)",
        "Bash(awk:*)",
        "Bash(sed:*)",
        "Bash(grep:*)",
        "Bash(find:*)",
        "Bash(jq:*)",
        "Bash(mkdir:*)",
        "Bash(cp:*)",
        "Bash(mv:*)",
        "Bash(rm:*)",
    ],
    enable_scripts_mcp=True,
    enable_integrations_mcp=False,
    enable_numa_mcp=False,
    enable_connect_mcp=False,
    enable_vault_mcp=False,
    enabled_numa_tools=[],
    tools_source_dirs=[],
    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=75,
    max_thinking_tokens=10_000,
    effort="medium",
    enable_security_hooks=False,
    default_model="anthropic.claude-opus-4-6-v1",
    # agents={"page-analyzer": EDA_PAGE_ANALYZER},  # TODO: re-enable with better model/prompt
)

register_agent_type(NOLIA_EDA)
