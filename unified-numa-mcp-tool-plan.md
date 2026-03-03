# Refactor: Unified `numa_tool` MCP Tool

## Context

Numa tools (KB search, web search, extract content, convert document) are currently invoked via **bash scripts** that Claude calls through the Bash tool. Integration tools (`run_action`, `configure_props`, `proxy_request`) are **MCP tools** (`@tool()` decorated). Only MCP tools can participate in the human-in-the-loop approval flow — `sdk_runner.py` intercepts MCP calls to generate approval IDs and emit SSE events, but it can't distinguish "Claude is calling a Numa tool" from "Claude is running `ls`" when everything goes through Bash.

**Goal:** Create a single `numa_tool` MCP tool that wraps all Numa tool calls, bringing them into the MCP layer. This enables HITL capability for any Numa tool, consistent observability, and a cleaner architecture — all with just one extra tool description in the prompt (token efficient).

## Architecture: Single Dispatcher MCP Tool

One `@tool()` function with three params — `name` (enum), `params` (dict), and `description` (string for the frontend) — that invokes the `workspace-chat-tools` Lambda directly (same pattern as integration tools). Skills continue to teach Claude what params each tool expects.

```
Before:  Claude → Bash → python3 /workdir/tools/numa/knowledge_base.py → boto3 → Lambda
After:   Claude → numa_tool MCP → invoke_workspace_tool() → Lambda
```

**Example call:**
```
numa_tool(
  name="query_knowledge_base",
  params={query: "annual leave policy", user_intent: "find how many days"},
  description="Searching knowledge base for annual leave policy"
)
```
User sees in the frontend: `Searching knowledge base for annual leave policy [spinner]`

**Tool params:**
| Param | Type | Purpose |
|-------|------|---------|
| `name` | string (enum) | Which Numa tool to call |
| `params` | object | Tool-specific parameters as a dict — maps directly to Lambda payload |
| `description` | string | Human-readable text shown in the frontend (same pattern as `execute_script`) |

**Why single tool, not individual tools:**
- **Token efficient** — 1 tool description (~300 tokens) vs 8 (~5000+ tokens) in every request
- **HITL in one place** — inspect `name`, decide per-tool whether to require approval
- **Cross-cutting concerns** — logging, rate-limiting, error handling all centralized
- **Proven pattern** — Claude already constructs tool params correctly (Skills teach it)
- **Easy to extend** — new tool = new enum value + Lambda handler + skill guidance
- **Frontend description** — `description` param gives rich user-facing text (same as `execute_script` and `Bash`)

## Implementation Steps

### Step 1: Extract shared Lambda client

Extract `_invoke_workspace_tool()` from `integrations.py` (lines 78-151) into a shared module. Both `integrations.py` and the new `numa_tool` will import from it.

- **Create:** `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/lambda_client.py`
- **Modify:** `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/integrations.py` — replace local function with import
- Also extract `_save_result()` (line 154) and `_extract_status()` (line 34) as shared helpers

**Important:** Add an `extra_event_fields` parameter so per-handler functions can add top-level fields to the Lambda event. The Lambda expects `allowed_kbs` and `allowed_kbs_with_names` at the **top level** (not inside `params`) for KB tools. Example:
```python
def invoke_workspace_tool(tool_name: str, params: dict, extra_event_fields: dict | None = None) -> dict:
    event = {
        "tool": tool_name,
        "allowed_tools": ...,
        "user_sub": ...,
        "conversation_id": ...,
        "external_user_id": ...,
        "params": params,
    }
    if extra_event_fields:
        event.update(extra_event_fields)
    # ... invoke Lambda
```

KB handler calls it as:
```python
invoke_workspace_tool("query_knowledgebase", params, extra_event_fields={
    "allowed_kbs": allowed_kb_ids,
    "allowed_kbs_with_names": allowed_kbs,
})
```

### Step 2: Create S3 helpers module

Extract the `ensure_file_in_s3()` + S3 download logic from `extract_content.py` and `convert_document.py` into a shared helper for the MCP tool to use.

- **Create:** `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/s3_helpers.py`
- Functions: `ensure_file_in_s3(file_path, user_sub, conversation_id)`, `download_from_s3(bucket, s3_key, local_path)`, `download_from_presigned_url(url, dest_path)`
- Uses `NUMA_LOCAL_AWS_*` credentials (same as existing scripts)

### Step 3: Create the `numa_tool` MCP tool

- **Create:** `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/numa_tool.py`

The tool definition:
```python
@tool(
    name="numa_tool",
    description="Execute a Numa platform tool. Use for knowledge base operations, web search, content extraction, and document conversion. Always load the relevant Skill first to learn each tool's expected params.",
    input_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "enum": [
                    "query_knowledge_base", "web_search",
                    "extract_content", "convert_document",
                    "kb_upload", "kb_download", "kb_list", "kb_download_folder"
                ],
                "description": "The Numa tool to execute"
            },
            "params": {
                "type": "object",
                "description": "Tool-specific parameters (see Skills for each tool's expected params)"
            },
            "description": {
                "type": "string",
                "description": "Human-readable description of what this tool call does (shown to the user)"
            }
        },
        "required": ["name", "params", "description"]
    }
)
async def numa_tool(args):
    name = args["name"]
    params = args["params"]
    # description is used by the frontend (extracted from tool input)
    handler = TOOL_HANDLERS[name]
    return await handler(params)
```

Per-tool handlers port the core logic from each bash script:

| Handler | Ports from | Key logic |
|---------|-----------|-----------|
| `_handle_query_kb` | `knowledge_base.py:cmd_query` (line 195) | Validate KB allowlist, build payload, invoke Lambda, return results |
| `_handle_web_search` | `web_search.py:main` (line 33) | Validate `NUMA_ENABLED_TOOLS`, build payload, invoke Lambda |
| `_handle_extract_content` | `extract_content.py:main` (line 122) | `ensure_file_in_s3()`, invoke Lambda, download result from S3 |
| `_handle_convert_document` | `convert_document.py:main` (line 138) | Validate format/mode, `ensure_file_in_s3()`, invoke Lambda, download from S3 |
| `_handle_kb_upload` | `knowledge_base.py:cmd_upload` | Validate KB permissions, build payload with file content |
| `_handle_kb_download` | `knowledge_base.py:cmd_download` | Build payload, handle presigned URL download |
| `_handle_kb_list` | `knowledge_base.py:cmd_list` | Build payload, invoke Lambda |
| `_handle_kb_download_folder` | `knowledge_base.py:cmd_download_folder` | Build payload, download zip |

Each handler: validates params → optional pre-processing (S3 upload) → `invoke_workspace_tool()` → optional post-processing (S3 download) → return MCP response.

### Step 4: Register the "numa" MCP server

- **Modify:** `services/numa-workspace-agent/numa_workspace_agent/sdk_config.py`
  - Add `enable_numa_mcp` flag check and `"numa"` MCP server registration (~line 476)
  - Add env var propagation for `NUMA_ALLOWED_KBS`, `NUMA_USER_SUB`, `NUMA_CONVERSATION_ID`, `OUTPUTS_BUCKET_NAME` (~line 446)
  - Import `numa_tool` from the new module

### Step 5: Add `enable_numa_mcp` to AgentTypeConfig

- **Modify:** `services/numa-workspace-agent/numa_workspace_agent/agent_types/base.py`
  - Add `enable_numa_mcp: bool = True` (Layer 2 section, ~line 111)

### Step 6: Update numa-chat agent type

- **Modify:** `services/numa-workspace-agent/numa_workspace_agent/agent_types/numa_chat.py`
  - Add `mcp__numa__numa_tool` to `allowed_tools`
  - Remove migrated tools from `enabled_numa_tools` (keep `agents`, `memories` — not migrated)
  - Add `enable_numa_mcp=True`

### Step 7: Update `__init__.py` exports

- **Modify:** `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/__init__.py`
  - Export `numa_tool`

### Step 8: Update Skills (SKILL.md files)

Rewrite to reference `numa_tool` instead of bash commands. Keep all domain guidance (when to summarise, citation format, etc.).

Before: `python3 /workdir/tools/numa/knowledge_base.py query --query "..." --user-intent "..."`
After: `Use the numa_tool with tool_name="query_knowledge_base" and params: {query: "...", user_intent: "..."}`

- **Modify:** `services/numa-workspace-agent/plugins/numa/skills/knowledge-search/SKILL.md`
- **Modify:** `services/numa-workspace-agent/plugins/numa/skills/web-search/SKILL.md`

### Step 9: Update system prompt

- **Modify:** `services/numa-workspace-agent/numa_workspace_agent/prompts.py`
  - Update TOOL_USAGE section to reference `numa_tool` MCP tool instead of bash commands

### Step 10: Update other agent types

Check all agent types that use `enabled_numa_tools`. Types with `enabled_numa_tools=[]` should also set `enable_numa_mcp=False`.

### Step 11: Write tests

- **Create:** `services/numa-workspace-agent/tests/test_numa_tool.py`
  - Test each handler (mock Lambda, validate payloads, test error cases, test S3 helpers)
- **Create:** `services/numa-workspace-agent/tests/test_lambda_client.py`
  - Test shared `invoke_workspace_tool()` helper

### Step 12 (Later): Clean up legacy scripts

After validation in staging:
- Delete bash scripts: `tools/numa/knowledge_base.py`, `web_search.py`, `extract_content.py`, `convert_document.py`
- Remove corresponding `TOOL_FILE_MAP` entries in `base.py`
- Remove `/workdir/tools/numa/` bypass in security hooks

### Step (Frontend): Full frontend updates

**A. Inline tool display** — `numa-frontend/src/utils/workspaceChatEventHandlers.ts`
- In `getInlineToolDisplay()`, add a case for `mcp__numa__numa_tool`:
  ```typescript
  case 'mcp__numa__numa_tool': {
    const numaInput = inputObj as { name?: string; description?: string };
    if (numaInput.description) {
      return { text: numaInput.description };
    }
    return { text: `Running Numa tool: ${numaInput.name || 'unknown'}` };
  }
  ```
- In `getToolCategoryAndIcon()`, add icon/category mapping for `mcp__numa__numa_tool`

**B. Tool card rendering** — `numa-frontend/src/Components/UnifiedToolCard.tsx`
- The card currently uses `toolName` to select renderers (e.g., `toolName === 'query_knowledge_base'` → `KnowledgeBaseRenderer`).
- Since `mcp__numa__numa_tool` wraps multiple tools, we need to extract the sub-tool name from the tool input's `name` field and route accordingly:
  ```typescript
  // When toolName is 'mcp__numa__numa_tool', check the input's name param
  const effectiveToolName = toolName === 'mcp__numa__numa_tool'
    ? (toolInput?.name || toolName)
    : toolName;
  // Then use effectiveToolName for renderer selection
  ```
- This way `query_knowledge_base` still routes to `KnowledgeBaseRenderer`, `web_search` to `WebSearchRenderer`, etc.

**C. Tool config** — `numa-frontend/src/utils/ToolConfig.ts`
- Add static entry for `mcp__numa__numa_tool` with appropriate icon and label

## What Stays the Same

- **workspace-chat-tools Lambda** — no changes. Same event format, same dispatch, same handlers. The MCP tool builds the same event shape the bash scripts do.
- **HITL infrastructure** — exists already (DynamoDB + SSE). To add HITL to any tool later: add tool name to `APPROVAL_REQUIRED_TOOLS` in `sdk_runner.py`.
- **KB/Web search tool card renderers** — `KnowledgeBaseRenderer` and `WebSearchRenderer` stay unchanged. We just update how `UnifiedToolCard` routes to them (by extracting the `name` field from the tool input).

## Files Summary

| Action | File |
|--------|------|
| Create | `numa_workspace_agent/mcp_tools/lambda_client.py` |
| Create | `numa_workspace_agent/mcp_tools/s3_helpers.py` |
| Create | `numa_workspace_agent/mcp_tools/numa_tool.py` |
| Create | `tests/test_numa_tool.py` |
| Create | `tests/test_lambda_client.py` |
| Modify | `numa_workspace_agent/mcp_tools/__init__.py` |
| Modify | `numa_workspace_agent/mcp_tools/integrations.py` (use shared client) |
| Modify | `numa_workspace_agent/sdk_config.py` (register MCP server + env vars) |
| Modify | `numa_workspace_agent/agent_types/base.py` (add flag) |
| Modify | `numa_workspace_agent/agent_types/numa_chat.py` (allowed_tools + flag) |
| Modify | `plugins/numa/skills/knowledge-search/SKILL.md` |
| Modify | `plugins/numa/skills/web-search/SKILL.md` |
| Modify | `numa_workspace_agent/prompts.py` |

All paths above relative to `services/numa-workspace-agent/`.

| Modify | `numa-frontend/src/utils/workspaceChatEventHandlers.ts` (inline display + icon mapping) |
| Modify | `numa-frontend/src/Components/UnifiedToolCard.tsx` (tool card renderer routing) |
| Modify | `numa-frontend/src/utils/ToolConfig.ts` (static tool config entry) |

## Verification

1. `cd services/numa-workspace-agent && poetry run pytest` — unit tests pass
2. Deploy to staging, test each tool via the MCP tool (KB query, web search, extract, convert, upload, download)
3. Compare results with bash script output for identical inputs
4. Verify KB allowlist enforcement
5. Verify S3 pre-upload works for files created during the same session
6. Verify agent types with `enable_numa_mcp=False` don't see the tool
7. Verify Skills load and Claude uses correct params
