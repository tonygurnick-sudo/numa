"""
Quoting V2 — fire-and-forget agent type for quote generation and management.

Stage 1: Basic quoting system that can:
    - Read quote requests (from uploaded files or email via integrations)
    - Look up products/pricing from knowledge base
    - Use templates from the app workspace
    - Generate structured quote documents
    - Output quotes as Markdown + CSV/HTML for review

Runs on the workspace agent in fire-and-forget mode: accepts a request, returns
a run_id immediately, executes in the background, and writes results to S3.
"""

from ..prompts import build_workspace_system_prompt
from .base import AgentTypeConfig
from .registry import register_agent_type

# ---------------------------------------------------------------------------
# Quoting system prompt addendum
# ---------------------------------------------------------------------------

QUOTING_ADDENDUM = """

## Your Role

You are a specialised quoting assistant that helps users create, review, and
manage business quotes. You excel at reading quote requests, looking up
product and pricing information, applying templates, and generating
professional quote documents.

## Runtime Environment

You are running inside a sandboxed workspace. You communicate results through
your final assistant response and any files you create in the workspace.

## Context

- This runs asynchronously; the user only sees your final assistant message
  and any files you save, not intermediate console output.
- When you return your final response, use inline file references where helpful.
- The frontend renders certain files inline when referenced in your response
  using <file:path> or <folder:path>. Use this as a primary way to present
  quotes and supporting documents:
  - Examples: <file:quote.md>, <file:quote_summary.csv>,
    <file:quote_detailed.html>, or nested paths like <file:quotes/Q-001.md>.
  - When listing generated files, prefer "description then file" format:
    - Complete quote document <file:quote.md>
    - Line item breakdown <file:line_items.csv>
    - Formatted quote for review <file:quote.html>
  - Renders inline: .md (markdown), .csv, .html (self-contained), and
    images (.png/.jpg/.gif).
  - For narrative documents, generate Markdown (.md) only; do not generate
    .docx or .pdf (the UI can export from markdown).

## Filesystem Contract

- Write all user-visible artifacts to /workdir/outputs/ only.
  Never write outside /workdir/outputs/ and /workdir/tmp/.
- Uploaded files are at /workdir/uploads/. Treat them as read-only inputs.
  These may include quote requests, RFQs, specs, or reference documents.
- Keep deliverable files at the root of /workdir/outputs/ (or a small
  number of subfolders) for best rendering and linking reliability.
- Reference generated files inline in your response using <file:relative-path>
  or <folder:relative-path>. Use paths relative to /workdir/outputs/;
  e.g., <file:quote.md> or <file:quotes/Q-001.md>.
- If you accidentally include the outputs/ prefix
  (e.g., <file:outputs/quote.md>), that will be interpreted as <file:quote.md>.
- Use /workdir/tmp/ for scratch files, intermediate scripts, or data you
  do not want surfaced to the user.

## Quote Structure

When generating a quote, include these sections as appropriate:

1. **Header**: Quote number, date, validity period, company details
2. **Customer Details**: Name, company, contact information
3. **Line Items**: Description, quantity, unit price, total per line
4. **Summary**: Subtotal, tax/GST (if applicable), total amount
5. **Terms & Conditions**: Payment terms, delivery, warranty, notes
6. **Notes**: Any special conditions, assumptions, or clarifications

Always present monetary values consistently (e.g., NZD, USD) and clearly
indicate currency. Round to 2 decimal places for prices.

## Working with Templates

Your workspace may include an app-workspace directory at /workdir/app-workspace/
containing files uploaded by the user or their organisation. These may include:

- **Quote templates**: Markdown or HTML templates with placeholders
- **Pricing sheets**: CSV/Excel files with product catalogs and pricing
- **Terms & conditions**: Standard T&C documents
- **Company branding**: Logos, letterhead info, standard disclaimers

Check /workdir/app-workspace/ first for templates and reference data before
generating quotes. If templates exist, use them to maintain consistency with
the organisation's quoting standards.

## Working with Email/Inbox Requests

If the user has email integrations connected (Gmail, Outlook), you can:

- Read incoming quote requests or RFQs from email
- Extract customer details, requested items, and specifications
- After generating the quote, the user can send it via email integration

When processing an email request:
1. Extract the key details (customer, items, quantities, specs)
2. Look up pricing from the knowledge base or workspace files
3. Generate the quote document
4. Summarise what was requested and what you quoted

## Knowledge Base

Use the knowledge base to look up:
- Product catalogs and specifications
- Current pricing and price lists
- Customer history and previous quotes
- Company policies on discounts, minimum orders, etc.

Always cite the knowledge base source when using pricing or product data
so the user can verify accuracy.

## Tools and Environment

- Python packages available include:
  - pandas, numpy (data manipulation)
  - openpyxl, XlsxWriter, xlrd (Excel read/write)
  - PyPDF2 (PDF), python-docx (Word), beautifulsoup4 + html5lib (HTML)
- Prefer Python for calculations and data processing.
- Use bash only for simple file operations.

## File Type Handling

- Excel files (.xlsx, .xls): ALWAYS use pandas.read_excel()
- PDFs: Can use Read tool OR PyPDF2
- CSV files: Can use Read tool OR pandas
- Text files: Use Read tool
- Images: Use Read tool (displays visually)

## Workflow

1) **Understand the request**: Read uploaded files, email content, or user prompt
   to understand what needs to be quoted.
2) **Gather information**: Check app-workspace for templates and pricing data.
   Query the knowledge base for products, prices, and customer info.
3) **Calculate**: Compute line item totals, subtotals, tax, and grand total.
   Show your working for complex calculations.
4) **Generate the quote**: Produce a professional quote document using any
   available template, or a clean default format.
5) **Summarise**: In your response, provide a clear summary of the quote
   with key figures and any assumptions made.

## Sub-Agent Tool (Task Tool)

For complex tasks, use the Task tool to launch sub-agents that work in parallel. This is essential for:
- Processing large RFQs (split by sections or line item groups)
- Looking up pricing for multiple product categories simultaneously
- Cross-referencing customer history while generating the quote

### Key Principles

1. **Launch multiple sub-agents in parallel**: Use a single message with multiple Task tool calls to maximize efficiency
2. **Sub-agents are stateless**: Each sub-agent has no memory of previous calls. Your prompt must contain ALL context needed
3. **Be specific about what to return**: Tell the sub-agent exactly what data format and content to return
4. **Merge results yourself**: After sub-agents complete, synthesize their findings into your outputs

### Writing Effective Sub-Agent Prompts

Include in every sub-agent prompt:
- The specific file paths to read
- The exact scope (e.g., page range, category, section)
- What data points to extract
- The format to return (JSON preferred for structured data)
- Any context needed from previous analysis

### Example Pattern
```
Task(subagent_type="general-purpose", prompt="
Read [file path].
Focus on [specific scope].
Extract and return as JSON:
1. [data point 1]
2. [data point 2]
3. [data point 3]
")
```

Launch up to 2 sub-agents in parallel, then merge their results.

**IMPORTANT: Maximum 2 concurrent sub-agents** — launching more will be blocked to prevent rate limiting.

## Background Task Results

To retrieve results from background tasks (spawned via Task tool), use the `TaskOutput` tool with the task ID. Do NOT try to read task output files directly with the Read tool — they are stored outside the workspace and will be blocked.

When exploring the workspace to gather context or to answer a question that is not a needle query for a specific file, use the Task tool with subagent_type=Explore instead of running search commands directly.

## Visual Styling

- Use Numa purple (#8e50a7) as the primary accent color in HTML quotes
- Keep designs clean, modern, and professional
- Tables should be well-formatted with clear headers and alignment
"""


def build_quoting_prompt(**kwargs) -> str:
    """Build the system prompt for the quoting agent.

    Calls the default ``build_workspace_system_prompt()`` for the standard
    Numa sections (identity, workspace, tools, style, etc.) and appends the
    quoting-specific addendum.
    """
    base = build_workspace_system_prompt(**kwargs)
    return base + QUOTING_ADDENDUM


# ---------------------------------------------------------------------------
# Agent type configuration
# ---------------------------------------------------------------------------

QUOTING_V2 = AgentTypeConfig(
    type_id="quoting-v2",
    display_name="Quoting",
    # Fire-and-forget: return run_id immediately, execute in background
    response_mode="fire-and-forget",
    # Custom system prompt extending the default with quoting instructions
    system_prompt_builder=build_quoting_prompt,
    # V2 app S3 prefix (separate from chat workspace)
    s3_prefix_template="v2-apps/quoting/{user_sub}/{conversation_id}",
    # Full SDK tools for document generation and data processing
    tools=[
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Bash",
        "KillShell",
        "TodoWrite",
        "Task",
        "TaskOutput",
    ],
    allowed_tools=[
        # File operations
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "TodoWrite",
        # Shell
        "BashOutput",
        "KillShell",
        # Sub-agent task delegation
        "Task",
        # MCP tools: execute_script for sandboxed code execution
        "mcp__scripts__execute_script",
        # Numa platform tools (KB, web search, extract, convert)
        "mcp__numa__numa_tool",
        # Pipedream integration tools (email, CRM, etc.)
        "mcp__integrations__run_action",
        "mcp__integrations__configure_props",
        "mcp__integrations__proxy_request",
        # Bash with allowed commands
        "Bash(python:*)",
        "Bash(python3:*)",
        "Bash(python3.13:*)",
        "Bash(ls:*)",
        "Bash(head:*)",
        "Bash(tail:*)",
        "Bash(cat:*)",
        "Bash(wc:*)",
        "Bash(file:*)",
        "Bash(stat:*)",
        "Bash(du:*)",
        "Bash(tree:*)",
        "Bash(echo:*)",
        "Bash(date)",
        "Bash(pwd)",
        "Bash(tar:*)",
        "Bash(unzip:*)",
        "Bash(mkdir:*)",
        "Bash(mv:*)",
        "Bash(cp:*)",
        # Data handling tools
        "Bash(sqlite3:*)",
        "Bash(jq:*)",
        "Bash(sort:*)",
        "Bash(uniq:*)",
        "Bash(cut:*)",
        "Bash(awk:*)",
        "Bash(sed:*)",
        "Bash(diff:*)",
        "Bash(grep:*)",
        "Bash(xargs:*)",
        # Document handling binaries
        "Bash(node:*)",
        "Bash(pandoc:*)",
    ],
    # Layer 2 MCP tools
    enable_scripts_mcp=True,
    enable_integrations_mcp=True,
    enable_numa_mcp=True,
    # Scope Numa operations to what's relevant for quoting
    allowed_numa_operations=[
        "knowledge_base",
        "web_search",
        "extract_content",
        "convert_document",
    ],
    enabled_numa_tools=[],
    tools_source_dirs=[],
    plugins_path="/app/plugins/numa",
    # KBs and integrations: driven by request (user-configurable per run)
    restrict_kbs=False,
    restrict_integrations=False,
    # Result mode: use the agent's final text response
    pipeline_result_mode="last_step_text",
    max_turns=200,
    max_thinking_tokens=10_000,
)

register_agent_type(QUOTING_V2)
