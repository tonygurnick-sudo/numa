---
name: workspace-agent-configuration
description: Create and configure workspace agent types for the numa-workspace-agent service. Use when creating new agent types, configuring agent tools, setting up agent pipelines, customising agent system prompts, or modifying agent type configurations.
---

# Workspace Agent Configuration

## Purpose

Create and configure agent types for the `numa-workspace-agent` service. Agent types are different configurations of the same workspace agent engine — same engine, different knobs. This skill covers creating new types, configuring tools, customising prompts, and setting up pipelines.

## Key Files

| File | Purpose |
|------|---------|
| `services/numa-workspace-agent/numa_workspace_agent/agent_types/base.py` | `AgentTypeConfig` dataclass — all config fields |
| `services/numa-workspace-agent/numa_workspace_agent/agent_types/registry.py` | Registration and lookup functions |
| `services/numa-workspace-agent/numa_workspace_agent/agent_types/__init__.py` | Side-effect imports that register all types |
| `services/numa-workspace-agent/numa_workspace_agent/prompts.py` | System prompt sections and builders |
| `services/numa-workspace-agent/numa_workspace_agent/sdk_config.py` | Bridges config to Claude SDK invocation |
| `services/numa-workspace-agent/tests/test_agent_types.py` | Tests for agent type configs |
| `services/numa-workspace-agent/tests/test_type_resolution.py` | Tests for config -> SDK options flow |

## AgentTypeConfig Fields Reference

```python
@dataclass
class AgentTypeConfig:
    # Identity
    type_id: str                    # Unique lookup key (e.g., "quoting-agent")
    display_name: str               # Human-readable name

    # Response mode: "stream", "sync", or "fire-and-forget"
    response_mode: str = "stream"

    # Layer 1: Claude SDK Tools
    tools: list[str]                # Tools to enable
    allowed_tools: list[str]        # Granular allow-list
    disallowed_tools: list[str]     # Granular deny-list

    # Layer 2: MCP Tools
    enable_scripts_mcp: bool = True         # Sandboxed Python/Bash execution
    enable_integrations_mcp: bool = True    # SaaS integration tools

    # Layer 3: Numa CLI Tools
    enabled_numa_tools: list[str]   # Tool scripts to copy to /workdir/tools/
    tools_source_dirs: list[str]    # Directories to copy from (default: ["numa"])

    # Skills / Plugins
    plugins_path: str = "/app/plugins/numa"

    # Knowledge Base
    default_kbs: Optional[list[dict]] = None
    restrict_kbs: bool = False      # Ignore request KBs if True

    # Integrations
    default_integrations: Optional[list[str]] = None
    restrict_integrations: bool = False

    # System Prompt
    system_prompt_builder: Optional[Callable[..., str]] = None
    identity_override: Optional[str] = None

    # Workspace
    s3_prefix_template: str = "numa-chat/workspace/{user_sub}/conversations/{conversation_id}"
    workspace_setup: Optional[Callable[[str, str], None]] = None

    # Pipeline (multi-step agent chains)
    pipeline_steps: Optional[list[str]] = None
    pipeline_result_mode: str = "last_step_text"  # or "result_file"

    # Limits
    max_turns: int = 50
    max_thinking_tokens: int = 10_000

    # Model
    default_model: Optional[str] = None
```

## Response Modes

| Mode | Behaviour | Use Case |
|------|-----------|----------|
| `stream` | SSE/NDJSON streaming to frontend | Interactive chat |
| `sync` | Caller waits for full response | Structured output, pipeline steps |
| `fire-and-forget` | Accept request, return immediately, write results to S3/DynamoDB | Background processing |

## Three Tool Layers

### Layer 1: Claude SDK Tools
Built-in capabilities controlled by `tools` and `allowed_tools`:
- File ops: `Read`, `Write`, `Edit`, `Glob`, `Grep`
- Shell: `Bash`, `KillShell` (with granular command allow-list like `Bash(python:*)`)
- Tasks: `Task`, `TaskOutput`, `TodoWrite`, `Skill`

### Layer 2: MCP Tools
Server-side endpoints:
- `enable_scripts_mcp=True` enables `mcp__scripts__execute_script` (sandboxed code execution)
- `enable_integrations_mcp=True` enables `mcp__integrations__run_action`, `configure_props`, `proxy_request`

### Layer 3: Numa CLI Tools
Python scripts copied to `/workdir/tools/` at startup. Available tool names:
- `knowledge_search` -> `knowledge_base.py`
- `web_search` -> `web_search.py`
- `agents` -> `numa-agents.py`
- `convert_document` -> `convert_document.py`
- `extract_content` -> `extract_content.py`

## System Prompt Customisation

Two mechanisms, from simple to full control:

### identity_override (simple)
Replaces just the `IDENTITY_AND_ROLE` section while keeping all other sections (workspace, tools, style, etc.):

```python
AgentTypeConfig(
    type_id="my-agent",
    identity_override="You are a helpful quoting assistant created by Arcanum AI.",
)
```

### system_prompt_builder (full control)
A callable that returns the complete system prompt. Import individual sections from `prompts.py` and compose your own:

Available sections to import from `prompts.py`:
- `IDENTITY_AND_ROLE` — "You are Numa" identity block
- `WORKSPACE_ENVIRONMENT` — /workdir structure, security restrictions
- `STYLE_AND_COMMUNICATION` — Tone, emojis, markdown, document generation
- `TASK_EXECUTION` — TodoWrite, verification, error handling
- `TOOL_USAGE` — Tool policies, Bash best practices
- `WORKSPACE_CAPABILITIES` — Numa tools (KB, web search, etc.)
- `ENVIRONMENT_AND_META` — Env vars, dates, knowledge cutoff (contains `{working_directory}`, `{platform}`, `{today_date}` format placeholders)

```python
from ..prompts import WORKSPACE_ENVIRONMENT, TOOL_USAGE, ENVIRONMENT_AND_META

def build_my_prompt(**kwargs):
    composed = MY_IDENTITY + WORKSPACE_ENVIRONMENT + MY_STYLE + TOOL_USAGE + ENVIRONMENT_AND_META
    return composed.format(
        working_directory=kwargs.get("working_dir", "."),
        platform=kwargs.get("platform", "Numa Workspace"),
        today_date="today",
    )
```

**Note:** `ENVIRONMENT_AND_META` contains `{working_directory}`, `{platform}`, and `{today_date}` format placeholders. If you compose sections manually, you must call `.format()` on the result. Custom identity text should NOT contain `{curly_braces}` unless intended as format variables.

### Combining both
Use `identity_override` to swap the identity, and `system_prompt_builder` to append extra instructions:

```python
def build_my_prompt(**kwargs):
    # identity_override arrives via **kwargs automatically from sdk_config.py
    base = build_workspace_system_prompt(**kwargs)
    return base + MY_ADDENDUM

AgentTypeConfig(
    type_id="my-agent",
    identity_override=MY_CUSTOM_IDENTITY,
    system_prompt_builder=build_my_prompt,
)
```

## Creating a New Agent Type — Checklist

1. Create `services/numa-workspace-agent/numa_workspace_agent/agent_types/<my_agent>.py`
2. Define an `AgentTypeConfig` instance
3. Call `register_agent_type(config)` at module level
4. Add side-effect import in `__init__.py`:
   ```python
   from . import my_agent as _my_agent  # noqa: F401
   ```
5. Add tests in `tests/test_agent_types.py`
6. Run tests: `cd services/numa-workspace-agent && poetry run pytest tests/test_agent_types.py tests/test_type_resolution.py -v`

## Examples

### Example 1: Streaming Agent (Interactive Chat)

Like `numa-chat` or `tony-comedian` — interactive, multi-turn conversations streamed to the frontend.

```python
"""
Quoting Agent — generates quotes and invoices from product catalogues.
"""
from .base import AgentTypeConfig
from .registry import register_agent_type
from ..prompts import build_workspace_system_prompt

QUOTING_IDENTITY = """You are a professional quoting assistant created by Arcanum AI.
You help users generate accurate quotes and invoices based on product catalogues and pricing rules.
Always present quotes in clean tables with line items, quantities, unit prices, and totals.
"""

QUOTING_ADDENDUM = """
## Quoting Rules
- Always confirm items and quantities before generating a final quote
- Include GST calculations (15% for NZ)
- Output quotes as markdown tables
"""

def build_quoting_prompt(**kwargs):
    base = build_workspace_system_prompt(**kwargs)
    return base + QUOTING_ADDENDUM

QUOTING_AGENT = AgentTypeConfig(
    type_id="quoting-agent",
    display_name="Quoting Agent",
    response_mode="stream",

    system_prompt_builder=build_quoting_prompt,
    identity_override=QUOTING_IDENTITY,

    # File reading + writing, no code execution
    tools=["Read", "Glob", "Grep", "Write", "Edit", "TodoWrite"],
    allowed_tools=["Read", "Glob", "Grep", "Write", "Edit", "TodoWrite"],

    enable_scripts_mcp=False,
    enable_integrations_mcp=False,

    # KB for product catalogue lookups
    enabled_numa_tools=["knowledge_search"],
    tools_source_dirs=["numa"],

    restrict_kbs=False,
    restrict_integrations=True,

    max_turns=20,
    max_thinking_tokens=5000,
)

register_agent_type(QUOTING_AGENT)
```

### Example 2: Sync Agent (Structured Output)

Like `document-summariser` — caller waits for a structured JSON result. No streaming.

```python
"""
Invoice Parser — extracts structured data from uploaded invoices.
"""
from .base import AgentTypeConfig
from .registry import register_agent_type
from ..prompts import build_workspace_system_prompt

PARSER_ADDENDUM = """
## Your Role
You are an invoice parser. Read uploaded invoice files and extract structured data.

## Instructions
1. Read files in /workdir/uploads/
2. Extract invoice details
3. Write to /workdir/outputs/result.json:
```json
{
    "vendor": "Company Name",
    "invoice_number": "INV-001",
    "date": "2025-01-15",
    "line_items": [{"description": "...", "qty": 1, "unit_price": 100.00}],
    "subtotal": 100.00,
    "tax": 15.00,
    "total": 115.00,
    "currency": "NZD"
}
```
"""

def build_parser_prompt(**kwargs):
    base = build_workspace_system_prompt(**kwargs)
    return base + PARSER_ADDENDUM

INVOICE_PARSER = AgentTypeConfig(
    type_id="invoice-parser",
    display_name="Invoice Parser",
    response_mode="sync",

    system_prompt_builder=build_parser_prompt,

    # Read-only + Write for result.json
    tools=["Read", "Glob", "Grep", "Write", "TodoWrite"],
    allowed_tools=["Read", "Glob", "Grep", "Write", "TodoWrite"],

    enable_scripts_mcp=False,
    enable_integrations_mcp=False,

    enabled_numa_tools=[],
    tools_source_dirs=[],

    restrict_kbs=True,
    restrict_integrations=True,

    # Writes /workdir/outputs/result.json
    pipeline_result_mode="result_file",

    max_turns=10,
    max_thinking_tokens=5000,
)

register_agent_type(INVOICE_PARSER)
```

### Example 3: Pipeline Agent (Chained Steps)

Like `profile-creator` — orchestrates multiple agent types sequentially. Steps share the same `/workdir/` workspace and coordinate via files.

```python
"""
Report Generator — two-step pipeline: research then format.

Step 1 (report-researcher): Gathers data, writes /workdir/outputs/research.json
Step 2 (report-formatter): Reads research, writes /workdir/outputs/result.json
"""
from .base import AgentTypeConfig
from .registry import register_agent_type
from ..prompts import build_workspace_system_prompt

# --- Step 1: Researcher ---

RESEARCHER_ADDENDUM = """
## Your Role
Research the topic thoroughly and write findings to /workdir/outputs/research.json.
Use web search and any uploaded reference files.
"""

def build_researcher_prompt(**kwargs):
    base = build_workspace_system_prompt(**kwargs)
    return base + RESEARCHER_ADDENDUM

REPORT_RESEARCHER = AgentTypeConfig(
    type_id="report-researcher",
    display_name="Report Researcher (Step 1)",
    response_mode="sync",
    system_prompt_builder=build_researcher_prompt,

    tools=["Read", "Glob", "Grep", "Write", "Bash", "TodoWrite", "Skill"],
    allowed_tools=["Read", "Glob", "Grep", "Write", "Bash", "TodoWrite", "Skill"],

    enable_scripts_mcp=True,
    enable_integrations_mcp=False,
    enabled_numa_tools=["web_search"],
    tools_source_dirs=["numa"],

    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=15,
    max_thinking_tokens=5000,
)
register_agent_type(REPORT_RESEARCHER)


# --- Step 2: Formatter ---

FORMATTER_ADDENDUM = """
## Your Role
Read /workdir/outputs/research.json from the previous step.
Format it into a polished report and write to /workdir/outputs/result.json.
"""

def build_formatter_prompt(**kwargs):
    base = build_workspace_system_prompt(**kwargs)
    return base + FORMATTER_ADDENDUM

REPORT_FORMATTER = AgentTypeConfig(
    type_id="report-formatter",
    display_name="Report Formatter (Step 2)",
    response_mode="sync",
    system_prompt_builder=build_formatter_prompt,

    tools=["Read", "Glob", "Grep", "Write", "TodoWrite"],
    allowed_tools=["Read", "Glob", "Grep", "Write", "TodoWrite"],

    enable_scripts_mcp=False,
    enable_integrations_mcp=False,
    enabled_numa_tools=[],
    tools_source_dirs=[],

    restrict_kbs=True,
    restrict_integrations=True,
    max_turns=10,
    max_thinking_tokens=5000,
)
register_agent_type(REPORT_FORMATTER)


# --- Pipeline orchestrator ---

REPORT_GENERATOR = AgentTypeConfig(
    type_id="report-generator",
    display_name="Report Generator",
    response_mode="sync",

    # Chain: researcher writes research.json -> formatter writes result.json
    pipeline_steps=["report-researcher", "report-formatter"],
    pipeline_result_mode="result_file",

    # Parent doesn't run Claude itself -- the steps do
    max_turns=1,
    max_thinking_tokens=1000,
)
register_agent_type(REPORT_GENERATOR)
```

### Example 4: Fire-and-Forget Agent (Background Processing)

Accepts the request and returns immediately. Results are written to S3/DynamoDB asynchronously.

```python
"""
Batch Analyser — processes large datasets in the background.
"""
from .base import AgentTypeConfig
from .registry import register_agent_type

BATCH_ANALYSER = AgentTypeConfig(
    type_id="batch-analyser",
    display_name="Batch Analyser",
    response_mode="fire-and-forget",

    tools=["Read", "Glob", "Grep", "Write", "Bash", "TodoWrite"],
    allowed_tools=["Read", "Glob", "Grep", "Write", "Bash", "TodoWrite",
                   "mcp__scripts__execute_script",
                   "Bash(python:*)", "Bash(python3:*)"],

    enable_scripts_mcp=True,
    enable_integrations_mcp=False,

    enabled_numa_tools=[],
    tools_source_dirs=[],

    restrict_kbs=True,
    restrict_integrations=True,

    # Results written to S3, no streaming needed
    pipeline_result_mode="result_file",

    max_turns=30,
    max_thinking_tokens=10000,
)

register_agent_type(BATCH_ANALYSER)
```

### Example 5: Full Prompt Override (Cherry-Pick Sections)

For agents that need completely custom prompt composition — skip irrelevant sections entirely.

```python
"""
Minimal Bot — only needs workspace access and tool policies, nothing else.
"""
from .base import AgentTypeConfig
from .registry import register_agent_type
from ..prompts import WORKSPACE_ENVIRONMENT, TOOL_USAGE, ENVIRONMENT_AND_META

MY_IDENTITY = """You are a minimal task bot. You follow instructions precisely.
"""

MY_STYLE = """## Style
- Be extremely concise
- No small talk
- Output structured data only
"""

def build_minimal_prompt(**kwargs):
    """Cherry-pick only the sections this agent needs."""
    composed = (
        MY_IDENTITY
        + WORKSPACE_ENVIRONMENT
        + MY_STYLE
        + TOOL_USAGE
        + ENVIRONMENT_AND_META
    )
    return composed.format(
        working_directory=kwargs.get("working_dir", "."),
        platform=kwargs.get("platform", "Numa Workspace"),
        today_date="today",
    )

MINIMAL_BOT = AgentTypeConfig(
    type_id="minimal-bot",
    display_name="Minimal Bot",
    response_mode="sync",
    system_prompt_builder=build_minimal_prompt,
    # ... tools config ...
)

register_agent_type(MINIMAL_BOT)
```

## Test Patterns

### Agent type config tests (`test_agent_types.py`)

```python
class TestMyAgentType:
    """Tests for the my-agent built-in type."""

    def test_registered(self):
        config = get_agent_type_config("my-agent")
        assert config.type_id == "my-agent"

    def test_response_mode(self):
        config = get_agent_type_config("my-agent")
        assert config.response_mode == "sync"  # or "stream" or "fire-and-forget"

    def test_restricted_tools(self):
        config = get_agent_type_config("my-agent")
        assert "Read" in config.tools
        assert "Bash" not in config.tools  # if restricted

    def test_no_mcp(self):
        config = get_agent_type_config("my-agent")
        assert config.enable_scripts_mcp is False

    def test_has_custom_prompt_builder(self):
        config = get_agent_type_config("my-agent")
        assert config.system_prompt_builder is not None
        prompt = config.system_prompt_builder(working_dir="/workdir")
        assert "expected content" in prompt
```

### Type resolution tests (`test_type_resolution.py`)

```python
def test_identity_override_applied(self):
    config = AgentTypeConfig(
        type_id="test-identity",
        display_name="Test",
        identity_override="You are a test bot.",
    )
    register_agent_type(config)
    options = create_agent_options(agent_type_config=config)
    assert "You are a test bot." in options.system_prompt
    assert "You are Numa" not in options.system_prompt
```

## Registered Agent Types

| Type ID | Mode | Identity Override | Custom Prompt | Pipeline | Purpose |
|---------|------|-------------------|---------------|----------|---------|
| `numa-chat` | stream | No | No | No | Default Numa chat with full tool access |
| `research-agent` | stream | No | No | No | Research-focused, no integrations |
| `document-summariser` | sync | No | Yes | No | Reads docs, writes structured JSON |
| `tony-comedian` | stream | Yes | Yes | No | Test/demo agent with custom persona |
| `profile-creator` | sync | No | No | Yes (2 steps) | Orchestrates researcher + validator |
| `profile-researcher` | sync | No | Yes | No | Pipeline step 1: research + draft |
| `profile-validator` | sync | No | Yes | No | Pipeline step 2: validate + finalize |
