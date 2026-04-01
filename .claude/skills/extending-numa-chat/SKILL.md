---
name: extending-numa-chat
description: Extend Numa chat with new tools and capabilities. Use when adding a new MCP tool, creating a tool group, wiring HITL approvals, adding frontend tool rendering, writing tool skills/prompts, configuring agent types for tools, or building Lambda tool handlers.
---

# Extending Numa Chat with New Tools

This skill covers everything needed to add new capabilities to Numa's chat agent. Read `documentation/extending-numa-chat/README.md` for the full guide with code examples. Open `documentation/extending-numa-chat/architecture-explainer.html` for interactive visual diagrams.

## Architecture: Three-Layer Tool System

```
Layer 1: Claude SDK Tools (Read, Write, Bash, etc.) -- built-in, per agent type
Layer 2: MCP Tool Groups (numa, integrations, connectors, vault, scripts) -- custom, feature-flaggable
Layer 3: Skill Documentation (plugins/numa/skills/) -- teaches Claude how to use tools
```

## Six Systems to Consider

When adding a new tool, you touch up to six systems. Not all apply to every tool.

### 1. MCP Tool Group (Backend - Service)

**Files:** `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/`

**Decision:** Add to an existing group (preferred for related operations) or create a new group (for independently feature-flaggable capabilities).

**The Single-Dispatcher Pattern (preferred):**

All major tools use one `@tool()` decorated function with a `name` enum to dispatch to operation handlers. This is more token-efficient than many separate tools.

```python
@tool(
    name="my_tool",
    input_schema={
        "properties": {
            "name": {"type": "string", "enum": ["op1", "op2"], "description": "Operation"},
            "params": {"type": "object", "description": "Operation-specific params"},
            "description": {"type": "string", "description": "Human-readable (shown to user)"}
        },
        "required": ["name", "params", "description"]
    }
)
async def my_tool(args):
    handler = HANDLERS.get(args["name"])
    return await handler(args["params"])
```

**Key rules:**

- Always include a `description` param -- shown to the user in the UI and approval cards
- Use `_ok(text)` and `_err(text)` helpers for uniform response format
- Two-level dispatch is fine (e.g., `name="knowledge_base"` + `params.operation="query"`)
- Register in `sdk_config.py` with a `type_config.enable_*_mcp` flag

**Adding to an existing group (e.g., numa_tool):**

1. Write async handler function: `async def _handle_my_op(params) -> dict`
2. Add to `TOOL_HANDLERS` dict
3. Add operation name to the `enum` in the tool's `input_schema`

**Creating a new group:**

1. Create `mcp_tools/my_tool.py` with the `@tool()` decorator
2. Add `enable_my_tool_mcp` field to `AgentTypeConfig` in `agent_types/base.py`
3. Register MCP server in `sdk_config.py`:
   ```python
   if type_config.enable_my_tool_mcp:
       mcp_servers["my_tool"] = create_sdk_mcp_server(name="my_tool", tools=[my_tool])
   ```

**Three-layer access control:**

1. Agent type config: `allowed_numa_operations` (developer hard limit)
2. Feature flags: environment variables like `NUMA_OPS_ENABLED` (deployment-level)
3. Frontend toggles: `NUMA_ENABLED_TOOLS` allowlist (user-level)

### 2. Prompting & Skills (Backend - Service)

**Files:**

- `services/numa-workspace-agent/plugins/numa/skills/<tool-name>/SKILL.md`
- `services/numa-workspace-agent/numa_workspace_agent/prompts.py`
- `services/numa-workspace-agent/integration-prompts/<slug>.md`

**Create a skill file** teaching Claude how to use your tool:

```markdown
---
name: my-tool
description: Description of when to use this tool
---

# My Tool Skill

## Operations

| Operation | Description | Required Params  |
| --------- | ----------- | ---------------- |
| op1       | Does X      | param_a, param_b |

## Examples

mcp**my_tool**my_tool(
name="op1",
description="Doing X with the data",
params={"param_a": "value", "param_b": 42}
)
```

**Register in prompts.py** TOOL_USAGE section so Claude knows the skill exists.

**For integrations:** Add per-integration prompt files (`integration-prompts/<slug>.md`) with platform-specific guidance (search syntax, field formats, etc.). These are injected when the integration is enabled.

### 3. Lambda Delegation (Backend - Lambda)

**Files:**

- `lambdas/python/workspace-chat-tools/` (primary tools Lambda)
- `lambdas/python/oauth-workspace-tools/` (OAuth connectors)
- `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/lambda_client.py`

**When to use a Lambda:** When your tool needs IAM permissions or user credentials the agent shouldn't have. When the tool is pure computation in the workspace, run it directly (like `execute_script`).

**Lambda invocation pattern:**

```python
from numa_workspace_agent.mcp_tools.lambda_client import invoke_workspace_tool

result = invoke_workspace_tool(
    "my_operation",
    {"param_a": "value"},
    extra_event_fields={"user_sub": user_sub, "allowed_kbs": kb_ids}
)
```

**In the Lambda**, add handler + register in `TOOL_HANDLERS`:

```python
def handle_my_operation(params):
    # Validate, execute, return result
    return {"status": "success", "data": {...}}

TOOL_HANDLERS["my_operation"] = handle_my_operation
```

**Security gates (fail-closed):**

- Validate `allowed_tools` / `allowed_kbs` allowlists
- Check `user_sub` for ownership/permission
- Server-side DynamoDB verification as defense-in-depth

**Credential isolation:** MCP tools use `NUMA_LOCAL_AWS_*` env vars (local account session tokens) for Lambda invocation. The agent never sees raw credentials. User OAuth tokens are looked up by the Lambda from Secrets Manager using identifiers (user_sub, external_user_id).

### 4. HITL Approvals (Backend + Frontend)

**Files:**

- `services/numa-workspace-agent/numa_workspace_agent/sdk_runner.py` (approval emission)
- `lambdas/python/workspace-chat-tools/tools/approval.py` (polling)
- `numa-frontend/src/Pages/Settings.tsx` (user settings)
- `numa-frontend/src/Components/Agents/AgentCreateModal.tsx` (agent builder)
- `numa-frontend/src/Components/WorkspaceChat/WorkspaceChatToolApproval.tsx` (approval UI)

**Three approval modes:** `always` (manual for everything), `non_destructive` (auto-approve reads, manual for writes), `never` (auto-approve all).

**Five categories:** `integrations`, `agents`, `memories`, `knowledgeBases`, `ops`.

**To add HITL for a new tool:**

1. Classify operations as safe (read-only) or write (side effects)
2. Add category to `numaToolApprovalMode` options in Settings.tsx
3. Add category to approval modes grid in AgentCreateModal.tsx
4. In your MCP tool, pop approval ID: `pop_approval_id(action_key)`
5. Pass `request_id` and `auto_approved` in Lambda event
6. In Lambda, use `poll_approval(approval_id)` -- polls DynamoDB every 5s, 90s timeout
7. Handle results: `approved` (execute), `denied` (skip), `timeout` (report)

**Approval flow:** SDK runner emits SSE `tool_approval` event -> frontend shows card with countdown -> user decides -> decision written to DynamoDB -> Lambda polls and picks up decision.

**Resolution priority:** Agent override > User setting > Default.

### 5. Frontend Rendering (Frontend)

**Files:**

- `numa-frontend/src/utils/workspaceChatEventHandlers.ts` (tool routing, display text)
- `numa-frontend/src/utils/ToolConfig.ts` (tool metadata, icons)
- `numa-frontend/src/Components/WorkspaceChat/WorkspaceChatInlineTool.tsx` (inline rendering)
- `numa-frontend/src/Components/UnifiedToolCard.tsx` (card rendering)
- `numa-frontend/src/toolRenderers/` (specialized result renderers)

**Segment types:**

- `inline_tool` -- Single-line indicator (file reads, searches, integrations)
- `tool_card` -- Card with structured results (KB, web search, data analysis)

**To add frontend rendering:**

1. Route tool name in `getToolSegmentKind()` to `inline_tool` or `tool_card`
2. Set display text in `getInlineToolDisplay()` -- extract meaningful info from input
3. Set icon in `getToolCategoryAndIcon()` -- Bootstrap icon class or custom image URL
4. For card results: create renderer in `toolRenderers/` and register in `UnifiedToolCard.tsx`
5. Approval panel renders automatically when approval data is attached

**Tool categories:** `transient` (fades out), `important` (always visible with icon), `default`.

**The description param matters here** -- it's what the user sees in the inline tool indicator and the approval card.

### 6. Agent Type Configuration (Backend - Service)

**Files:**

- `services/numa-workspace-agent/numa_workspace_agent/agent_types/base.py` (AgentTypeConfig)
- `services/numa-workspace-agent/numa_workspace_agent/agent_types/registry.py`
- `services/numa-workspace-agent/numa_workspace_agent/agent_types/*.py` (specific types)

**AgentTypeConfig controls:**

- `enable_*_mcp` -- Boolean flags to enable/disable MCP tool groups
- `allowed_numa_operations` -- List to restrict which Numa operations are allowed (None = all)
- `enabled_numa_tools` -- Which tool docs to copy to workspace
- `tools` / `allowed_tools` / `disallowed_tools` -- SDK tool control

**When adding a new tool group:**

1. Add `enable_my_tool_mcp` to AgentTypeConfig dataclass
2. Enable for `numa-chat` (default agent)
3. Decide per specialized agent type: research agent probably doesn't need CRM tools
4. Add to `enabled_numa_tools` for types that should get skill docs
5. Update `_OPERATION_TO_ENABLED_TOOL_KEYS` if the tool has frontend toggles

**Resolution chain:** Agent type config (baseline) -> Agent instance config (DynamoDB overrides) -> Request-level toggles (runtime) -> SDK config build.

## Quick Reference: Key Files

| Component                  | Path                                                                            |
| -------------------------- | ------------------------------------------------------------------------------- |
| MCP tool implementations   | `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/`                 |
| Lambda client (invocation) | `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/lambda_client.py` |
| Agent type configs         | `services/numa-workspace-agent/numa_workspace_agent/agent_types/`               |
| SDK config builder         | `services/numa-workspace-agent/numa_workspace_agent/sdk_config.py`              |
| System prompt builder      | `services/numa-workspace-agent/numa_workspace_agent/prompts.py`                 |
| SDK runner (approvals)     | `services/numa-workspace-agent/numa_workspace_agent/sdk_runner.py`              |
| Skills/plugins             | `services/numa-workspace-agent/plugins/numa/skills/`                            |
| Integration prompts        | `services/numa-workspace-agent/integration-prompts/`                            |
| Primary tools Lambda       | `lambdas/python/workspace-chat-tools/`                                          |
| OAuth tools Lambda         | `lambdas/python/oauth-workspace-tools/`                                         |
| Approval polling           | `lambdas/python/workspace-chat-tools/tools/approval.py`                         |
| Frontend tool routing      | `numa-frontend/src/utils/workspaceChatEventHandlers.ts`                         |
| Frontend tool config       | `numa-frontend/src/utils/ToolConfig.ts`                                         |
| Inline tool component      | `numa-frontend/src/Components/WorkspaceChat/WorkspaceChatInlineTool.tsx`        |
| Tool card component        | `numa-frontend/src/Components/UnifiedToolCard.tsx`                              |
| Tool result renderers      | `numa-frontend/src/toolRenderers/`                                              |
| Approval UI component      | `numa-frontend/src/Components/WorkspaceChat/WorkspaceChatToolApproval.tsx`      |
| Settings (HITL config)     | `numa-frontend/src/Pages/Settings.tsx`                                          |
| Agent builder (HITL)       | `numa-frontend/src/Components/Agents/AgentCreateModal.tsx`                      |
| Full documentation         | `documentation/extending-numa-chat/README.md`                                   |
| Visual explainer           | `documentation/extending-numa-chat/architecture-explainer.html`                 |
