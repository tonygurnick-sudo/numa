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
3. **Numa CLI Tools** — Python scripts copied to `/workdir/tools/` (knowledge_search, web_search, etc.) controlled by `enabled_numa_tools`

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
    pipeline_result_mode="result_file",  # reads /workdir/session/result.json
)
```

## Adding a New Agent Type

1. Create a new file in this directory (e.g., `my_agent.py`)
2. Define an `AgentTypeConfig` instance with your settings
3. Call `register_agent_type(config)` at module level
4. Import the module in `__init__.py` (side-effect registration pattern)
5. Add tests in `tests/test_agent_types.py`

See `tony_comedian.py` for a simple example with identity override, or `document_summariser.py` for a sync agent with custom prompt builder.
