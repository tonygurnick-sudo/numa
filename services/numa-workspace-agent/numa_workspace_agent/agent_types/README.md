# Agent Types Registry

Agent types are different configurations of the same workspace agent engine. Each type controls which tools are available, what system prompt is used, how responses are delivered, and which capabilities are enabled.

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

## Key Concepts

### Response Modes

- **stream** — Interactive SSE/NDJSON streaming for chat conversations
- **sync** — Caller waits for full response (used by pipelines and structured output agents)
- **fire-and-forget** — Accept request, return immediately, write results to S3/DynamoDB

### Three Tool Layers

1. **Claude SDK Tools** — Built-in capabilities (Read, Write, Bash, etc.) controlled by `tools`, `allowed_tools`, `disallowed_tools`
2. **MCP Tools** — Server-side endpoints (execute_script, integration actions) controlled by `enable_scripts_mcp`, `enable_integrations_mcp`
3. **Numa Tool Reference Docs** — Documentation files copied to `/workdir/tools/` (knowledge_search, web_search, etc.) controlled by `enabled_numa_tools`. These are read-only references — all operations go through the `numa_tool` MCP tool.

### MCP Server Architecture

The workspace agent registers MCP servers conditionally based on agent type config. Each server groups related tools under a namespace:

| MCP Server | Flag | Tools | Purpose |
|------------|------|-------|---------|
| `numa` | `enable_numa_mcp` | `numa_tool` | General platform tools — KB, web search, content extraction, document conversion, agents, memories |
| `scripts` | `enable_scripts_mcp` | `execute_script` | Sandboxed Python/Bash/Node code execution |
| `integrations` | `enable_integrations_mcp` | `run_action`, `configure_props`, `proxy_request` | Pipedream SaaS integration tools |

#### When to add a new MCP server vs a new operation in `numa_tool`

**Add a new operation to `numa_tool`** when the capability is:
- A general platform utility (content extraction, document conversion, etc.)
- Always available to all customers (no feature flag gating)
- Handled by the same `workspace-chat-tools` Lambda

**Create a separate MCP server** when the capability:
- Belongs to a distinct product domain (e.g., Numa Ops, a future analytics module)
- Is feature-flagged — not all customers should have it, and you want the LLM to not even see the tool when it's disabled
- Has its own backend service or Lambda
- Has enough operations to warrant its own tool description and skill docs

#### Adding a new MCP server

1. Create the tool module in `mcp_tools/` (e.g., `numa_ops_tool.py`) following the dispatcher pattern in `numa_tool.py`
2. Add an `enable_<name>_mcp: bool` flag to `AgentTypeConfig` in `base.py` (default `False` for feature-flagged tools)
3. Register it conditionally in `sdk_config.py` → `create_agent_options()`:
   ```python
   if type_config.enable_my_new_mcp:
       mcp_servers["my_new"] = create_sdk_mcp_server(
           name="my_new", version="1.0.0", tools=[my_new_tool],
       )
   ```
4. Create a corresponding skill in `plugins/numa/skills/` so the LLM knows the tool's parameters
5. Add a toggle mapping in the frontend if users should be able to enable/disable it

### System Prompt Customization

Two mechanisms for customizing the system prompt, from simple to full control:

**`identity_override`** — Replaces just the `IDENTITY_AND_ROLE` section (the "You are Numa" identity block) while keeping all other sections (workspace, tools, style, etc.). Use this when you only need a different persona.

**`system_prompt_builder`** — Full override. A callable that returns the complete system prompt string. You can import individual sections from `prompts.py` (`WORKSPACE_ENVIRONMENT`, `TOOL_USAGE`, etc.) and compose your own prompt, skipping sections that don't apply.

Example using both:
```python
# Simple: just swap identity, keep everything else
AgentTypeConfig(
    type_id="my-agent",
    identity_override="You are a helpful quoting assistant.",
)

# Full control: cherry-pick sections
from ..prompts import WORKSPACE_ENVIRONMENT, TOOL_USAGE, ENVIRONMENT_AND_META

def build_my_prompt(**kwargs):
    composed = MY_IDENTITY + WORKSPACE_ENVIRONMENT + MY_STYLE + TOOL_USAGE + ENVIRONMENT_AND_META
    return composed.format(
        working_directory=kwargs.get("working_dir", "."),
        platform=kwargs.get("platform", "Numa Workspace"),
        today_date="today",
    )

AgentTypeConfig(
    type_id="my-agent",
    system_prompt_builder=build_my_prompt,
)
```

### Pipelines

Agent types can chain multiple steps using `pipeline_steps`. Each step is another registered agent type that runs to completion before the next starts. Steps share the same `/workdir/` workspace and coordinate via files (e.g., step 1 writes `profile_draft.json`, step 2 reads it).

```python
AgentTypeConfig(
    type_id="profile-creator",
    pipeline_steps=["profile-researcher", "profile-validator"],
    pipeline_result_mode="result_file",  # reads /workdir/outputs/result.json
)
```

## Adding a New Agent Type

1. Create a new file in this directory (e.g., `my_agent.py`)
2. Define an `AgentTypeConfig` instance with your settings
3. Call `register_agent_type(config)` at module level
4. Import the module in `__init__.py` (side-effect registration pattern)
5. Add tests in `tests/test_agent_types.py`

See `tony_comedian.py` for a simple example with identity override, or `document_summariser.py` for a sync agent with custom prompt builder.
