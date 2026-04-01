# Extending Numa Chat with New Tools

This guide covers everything you need to know to add new capabilities to Numa's chat agent. Whether you're adding a simple read-only operation or a full integration with approval flows and custom rendering, this document walks through every layer of the system.

**Visual explainer:** Open `architecture-explainer.html` in a browser for an interactive visual walkthrough of this architecture.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [MCP Tool Groups](#2-mcp-tool-groups)
3. [Prompting & Skills](#3-prompting--skills)
4. [Lambda Delegation](#4-lambda-delegation)
5. [Human-in-the-Loop (HITL) Approvals](#5-human-in-the-loop-hitl-approvals)
6. [Frontend Tool Rendering](#6-frontend-tool-rendering)
7. [Agent Type Configurations](#7-agent-type-configurations)
8. [Step-by-Step: Adding a New Tool](#8-step-by-step-adding-a-new-tool)
9. [Future Direction: Unified CLI Approach](#9-future-direction-unified-cli-approach)

---

## 1. Architecture Overview

Numa chat uses a **layered tool architecture** where Claude (running on Bedrock AgentCore) gets capabilities through three distinct layers:

```
Layer 1: Claude SDK Tools
  Built-in tools (Read, Write, Edit, Bash, Glob, Grep, etc.)
  Controlled per agent type via allowed_tools / disallowed_tools

Layer 2: MCP Tool Groups
  Custom tool groups registered as MCP servers (numa, integrations, connectors, vault, scripts)
  Each group is independently toggleable per agent type and feature flag
  Tools within a group use a single-dispatcher pattern with multiple operations

Layer 3: Skill/Plugin Documentation
  Markdown files copied to /workdir/tools/ at runtime
  Teach Claude HOW to use the MCP tools (parameter formats, examples, best practices)
  Not executable -- just reference documentation
```

### Why This Matters

This layered approach gives us:

- **Feature flagging** -- Enable/disable entire tool groups (e.g., Ops, Integrations) without code changes
- **Agent specialization** -- Different agent types get different tool sets from the same engine
- **Security isolation** -- Tools delegate to Lambdas that hold credentials; the agent never sees them
- **Token efficiency** -- One tool with multiple operations is cheaper than many separate tools

### Key Files

| Component                | Path                                                               |
| ------------------------ | ------------------------------------------------------------------ |
| MCP tool implementations | `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/`    |
| Agent type configs       | `services/numa-workspace-agent/numa_workspace_agent/agent_types/`  |
| Skills/plugins           | `services/numa-workspace-agent/plugins/numa/skills/`               |
| Integration prompts      | `services/numa-workspace-agent/integration-prompts/`               |
| System prompt builder    | `services/numa-workspace-agent/numa_workspace_agent/prompts.py`    |
| SDK config builder       | `services/numa-workspace-agent/numa_workspace_agent/sdk_config.py` |
| Primary tools Lambda     | `lambdas/python/workspace-chat-tools/`                             |
| OAuth tools Lambda       | `lambdas/python/oauth-workspace-tools/`                            |
| Agents CRUD Lambda       | `lambdas/node/agents/`                                             |
| Frontend tool rendering  | `numa-frontend/src/Components/WorkspaceChat/`                      |
| Frontend tool config     | `numa-frontend/src/utils/ToolConfig.ts`                            |
| Frontend event handlers  | `numa-frontend/src/utils/workspaceChatEventHandlers.ts`            |

---

## 2. MCP Tool Groups

MCP tool groups are the core mechanism for giving Claude executable capabilities. Each group is a collection of Python functions registered as an MCP server.

### Current Groups

| Group        | MCP Server Name | Tools                                            | Enable Flag               | Description                                              |
| ------------ | --------------- | ------------------------------------------------ | ------------------------- | -------------------------------------------------------- |
| Numa         | `numa`          | `numa_tool`, `numa_ops_tool`                     | `enable_numa_mcp`         | Platform tools (KB, web search, agents, memories, files) |
| Integrations | `integrations`  | `run_action`, `configure_props`, `proxy_request` | `enable_integrations_mcp` | Pipedream SaaS integrations                              |
| Connectors   | `connectors`    | `connectors`                                     | `enable_connect_mcp`      | OAuth cloud storage (Google Drive, OneDrive, etc.)       |
| Vault        | `vault`         | `vault`                                          | `enable_vault_mcp`        | Secrets management with approval flow                    |
| Scripts      | `scripts`       | `execute_script`                                 | `enable_scripts_mcp`      | Sandboxed code execution                                 |

### Registration (sdk_config.py)

MCP servers are conditionally created based on agent type config + feature flags:

```python
# sdk_config.py, lines 516-562
mcp_servers: dict[str, Any] = {}

if type_config.enable_scripts_mcp:
    mcp_servers["scripts"] = create_sdk_mcp_server(
        name="scripts", version="1.0.0", tools=[execute_script]
    )

if type_config.enable_integrations_mcp:
    mcp_servers["integrations"] = create_sdk_mcp_server(
        name="integrations", version="1.0.0",
        tools=[run_action, configure_props, proxy_request]
    )

if type_config.enable_numa_mcp:
    numa_tools = [numa_tool]
    if os.environ.get("NUMA_OPS_ENABLED", "").lower() in ("1", "true", "yes"):
        from numa_workspace_agent.mcp_tools import numa_ops_tool
        numa_tools.append(numa_ops_tool)
    mcp_servers["numa"] = create_sdk_mcp_server(
        name="numa", version="1.0.0", tools=numa_tools
    )
```

### The Single-Dispatcher Pattern

All major tools use a **single dispatcher function** with an `operation` enum rather than many separate tools. This is more token-efficient because Claude only needs one tool schema instead of many.

```python
@tool(
    name="numa_tool",
    description="Numa platform tools for knowledge bases, web search, agents, and more",
    input_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "enum": ["knowledge_base", "web_search", "agents", "memories", "files", ...],
                "description": "The operation to execute"
            },
            "params": {
                "type": "object",
                "description": "Operation-specific parameters"
            },
            "description": {
                "type": "string",
                "description": "Human-readable description of what this tool call does (shown to the user)"
            }
        },
        "required": ["name", "params", "description"]
    }
)
async def numa_tool(args: dict[str, Any]) -> dict[str, Any]:
    name = args.get("name", "")
    handler = TOOL_HANDLERS.get(name)
    if not handler:
        return _err(f"Unknown operation: {name}")
    return await handler(args.get("params", {}))
```

**Key design decisions:**

- **`name` parameter** -- Enum of valid operations. Controls what Claude can call.
- **`params` parameter** -- Dict of operation-specific parameters. Each handler validates its own params.
- **`description` parameter** -- Required string shown to the user in the UI and approval flows. This is critical for HITL transparency.

### Two-Level Dispatch

Some operations have sub-operations, creating a two-level dispatch:

```python
# Top level: name="knowledge_base" routes to _handle_knowledge_base
# Second level: params.operation="query|upload|download|list" routes to specific handler

_KB_OPERATIONS = {
    "query": _handle_query_kb,
    "upload": _handle_kb_upload,
    "download": _handle_kb_download,
    "list": _handle_kb_list,
}

async def _handle_knowledge_base(params: dict[str, Any]) -> dict[str, Any]:
    operation = params.get("operation")
    handler = _KB_OPERATIONS.get(operation or "")
    if not handler:
        return _err(f"Invalid operation: '{operation}'. Valid: {', '.join(_KB_OPERATIONS)}")
    return await handler({k: v for k, v in params.items() if k != "operation"})
```

### Access Control (Three Layers)

Each tool call passes through three layers of access control:

1. **Agent Type Config** (developer hard limit) -- `allowed_numa_operations` restricts which operations this agent type can use
2. **Feature Flags** (deployment-level) -- Environment variables like `NUMA_OPS_ENABLED`, `OAUTH_INTEGRATIONS_ENABLED`
3. **Frontend Toggles** (user-level) -- `NUMA_ENABLED_TOOLS` allowlist from chat settings UI

```python
def _check_operation_allowed(operation: str) -> str | None:
    # Layer 1: Agent type
    allowed_ops = _get_allowed_operations()
    if allowed_ops is not None and operation not in allowed_ops:
        return f"'{operation}' is not available for this agent type"

    # Layer 2+3: Feature flags + user toggles
    toggle_keys = _OPERATION_TO_ENABLED_TOOL_KEYS.get(operation)
    if toggle_keys is not None:
        enabled_tools = _get_enabled_tools()
        if not any(key in enabled_tools for key in toggle_keys):
            return "This tool is not enabled. Enable in chat settings."
    return None
```

### Response Format

All handlers return a uniform response:

```python
def _ok(text: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}]}

def _err(text: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}], "isError": True}
```

---

## 3. Prompting & Skills

MCP tools give Claude the _ability_ to call a tool. Prompting teaches Claude _when and how_ to use it effectively.

### System Prompt Structure

The base system prompt is built from modular sections in `prompts.py`:

```python
SYSTEM_PROMPT = (
    IDENTITY_AND_ROLE              # "You are Numa, created by Arcanum AI"
    + WORKSPACE_ENVIRONMENT        # File structure, /workdir/uploads, /workdir/outputs
    + STYLE_AND_COMMUNICATION      # Tone, formatting, proactiveness
    + TASK_EXECUTION               # TodoWrite for task tracking
    + TOOL_USAGE                   # How to use MCP tools, skills
    + WORKSPACE_CAPABILITIES       # Available packages, file handling
    + ENVIRONMENT_AND_META         # Working dir, timezone, feature flags
)
```

`build_workspace_system_prompt()` layers on additional context:

1. Base sections (formatted with env vars)
2. Company profile (truncated to 3000 chars)
3. User profile (name, job title, goals, custom instructions, memories)
4. Agent context (if a specialized agent is active)
5. Integration context (enabled integrations + per-integration prompt files)
6. Feature flags (disabled feature hints)

### Skills System

Skills are markdown files in `plugins/numa/skills/` that Claude loads on-demand via the Skill tool:

```
plugins/numa/skills/
  knowledge-search/SKILL.md     # KB query parameters and examples
  agents/SKILL.md               # Agent CRUD operations
  memories/SKILL.md             # Memory management
  integrations/SKILL.md         # Pipedream action execution
  ops/SKILL.md                  # Numa Ops tickets/teams/CRM
  web-search/SKILL.md           # Web search parameters
  pdf-handling/SKILL.md         # PDF creation/extraction
  connect/SKILL.md              # File browsing (drives, S3)
  ...
```

Each skill follows this format:

```markdown
---
name: knowledge-search
description: Search, retrieve, and upload to company knowledge bases
---

# Knowledge Search Skill

## Operations

| Operation | Description | Required Params    |
| --------- | ----------- | ------------------ |
| query     | Search KBs  | query, user_intent |
| upload    | Add to KB   | file_path, kb_id   |

## Examples

mcp**numa**numa_tool(
name="knowledge_base",
description="Searching KB for leave policy",
params={"operation": "query", "query": "annual leave policy", "user_intent": "find leave entitlements"}
)
```

The skill metadata (`name`, `description`) tells Claude's skill system when to auto-load it. The examples show exact parameter formats for the MCP tool calls.

### Integration Prompt Files

Per-integration markdown files are loaded dynamically into the system prompt:

```
integration-prompts/
  gmail.md        # Gmail search syntax, threading, attachments
  jira.md         # Jira field formats, JQL patterns
  slack.md        # Slack channel/thread conventions
  google_drive.md # Drive-specific API guidance
  ...
```

These are injected when the integration is enabled:

```python
for slug in enabled_integrations:
    prompt_file = _INTEGRATION_PROMPTS_DIR / f"{slug}.md"
    if prompt_file.is_file():
        content = prompt_file.read_text().strip()
        context += f"\n\n### {slug} -- Integration Guide\n{content}\n"
```

### Documentation Written to Disk

Some tools write documentation directly to the workspace filesystem at `/workdir/tools/`. These are reference docs (not executable) that Claude can read with the Read tool. The `setup_agent_tools()` function in `main.py` copies only the tool docs relevant to the current agent type.

### Best Practice: Teaching Claude About Your New Tool

When adding a new tool, you need both:

1. **A skill file** (`plugins/numa/skills/<your-tool>/SKILL.md`) with parameter tables and examples
2. **Registration in the TOOL_USAGE prompt section** so Claude knows the skill exists

The skill should include:

- A clear description of when to use it
- Parameter tables with types and descriptions
- Complete MCP tool call examples
- Common pitfalls or edge cases

---

## 4. Lambda Delegation

Most tools delegate their actual work to Lambda functions. This provides:

- **Permission isolation** -- The Lambda has IAM permissions the agent doesn't
- **Credential separation** -- User OAuth tokens, API keys, etc. never reach the agent
- **Security boundaries** -- Fail-closed allowlists validated server-side

### Architecture

```
Agent Container (AgentCore MicroVM)
  |
  |-- MCP Tools (in-process Python)
  |     Uses NUMA_LOCAL_AWS_* credentials
  |
  |-- invoke_workspace_tool()
  |     |
  |     +-- workspace-chat-tools Lambda (primary)
  |     |     KB queries, web search, agents, memories, integrations, vault
  |     |
  |     +-- oauth-workspace-tools Lambda
  |           OAuth connectors (Google Drive, OneDrive, Dropbox)
  |
  +-- Cross-account (Pipedream integrations)
        workspace-chat-tools -> pipedream-relay -> pipedream-proxy
```

### Credential Injection Pattern

The agent never sees raw credentials. Two credential sets are managed:

**Local Account Credentials** (for tools Lambda calls):

```python
# sdk_config.py -- Captured BEFORE cross-account assume
def _get_local_credentials() -> dict[str, str]:
    session = boto3.Session()
    frozen = session.get_frozen_credentials()
    return {
        "NUMA_LOCAL_AWS_ACCESS_KEY_ID": frozen.access_key,
        "NUMA_LOCAL_AWS_SECRET_ACCESS_KEY": frozen.secret_key,
        "NUMA_LOCAL_AWS_SESSION_TOKEN": frozen.token,
    }
```

**Cross-Account Credentials** (for SDK/Bedrock reasoning):

```python
# Overwrites AWS_* vars for the SDK subprocess
cross_account_creds = sts.assume_role(
    RoleArn=f"arn:aws:iam::{BEDROCK_ACCOUNT}:role/bedrock-quota-sharing",
    RoleSessionName="numa-workspace-agent",
)
```

Result: MCP tools use `NUMA_LOCAL_AWS_*` for Lambda calls. The SDK subprocess uses `AWS_*` for Bedrock. The agent code sees neither.

### Lambda Invocation (lambda_client.py)

All MCP tools use `invoke_workspace_tool()`:

```python
def invoke_workspace_tool(tool_name, params, extra_event_fields=None):
    session = boto3.Session(
        aws_access_key_id=os.environ["NUMA_LOCAL_AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["NUMA_LOCAL_AWS_SECRET_ACCESS_KEY"],
        aws_session_token=os.environ["NUMA_LOCAL_AWS_SESSION_TOKEN"],
    )
    event = {
        "tool": tool_name,
        "allowed_tools": json.loads(os.environ.get("NUMA_ENABLED_TOOLS", "[]")),
        "user_sub": os.environ.get("NUMA_USER_SUB", ""),
        "conversation_id": os.environ.get("NUMA_CONVERSATION_ID", ""),
        "params": params,
    }
    if extra_event_fields:
        event.update(extra_event_fields)

    response = lambda_client.invoke(
        FunctionName=os.environ["WORKSPACE_TOOLS_LAMBDA_NAME"],
        Payload=json.dumps(event),
    )
    return json.loads(response["Payload"].read())
```

### Security Gates in workspace-chat-tools Lambda

The Lambda validates every request:

- **KB access gate** -- Fail-closed: empty `allowed_kbs` list means deny all
- **Tool access gate** -- `allowed_tools` list checked against target integration slug
- **Server-side verification** -- DynamoDB lookup for defense-in-depth
- **User context injection** -- `user_sub` and `conversation_id` attached for permission checks

### When to Use a Lambda vs. Running Directly

| Scenario                                       | Approach                | Example                     |
| ---------------------------------------------- | ----------------------- | --------------------------- |
| Needs IAM permissions the agent shouldn't have | Lambda                  | KB queries, DynamoDB access |
| Needs user credentials the agent shouldn't see | Lambda                  | OAuth tokens, API keys      |
| Pure computation in the workspace              | Direct (execute_script) | Python data analysis        |
| Cross-account access needed                    | Lambda chain            | Pipedream relay -> proxy    |
| Read-only workspace operation                  | Direct                  | File listing, search        |

---

## 5. Human-in-the-Loop (HITL) Approvals

HITL lets users approve or deny tool calls before they execute. This is critical for write operations (sending emails, creating tickets, accessing secrets).

### Approval Modes

Three modes, configurable per category:

| Mode              | Behavior                                                   |
| ----------------- | ---------------------------------------------------------- |
| `always`          | Every tool call requires manual approval                   |
| `non_destructive` | Read-only operations auto-approve; writes require approval |
| `never`           | All operations auto-approve (no approval UI shown)         |

### Approval Categories

| Category         | Tools                         | Write Operations               | Safe Operations           |
| ---------------- | ----------------------------- | ------------------------------ | ------------------------- |
| `integrations`   | `run_action`, `proxy_request` | All API calls                  | `configure_props`         |
| `agents`         | `numa_tool` (agents)          | create, update, duplicate      | list, get                 |
| `memories`       | `numa_tool` (memories)        | add, update                    | list                      |
| `knowledgeBases` | `numa_tool` (KB)              | upload                         | query, list, download     |
| `ops`            | `numa_ops_tool`               | create*\*, update*_, delete\__ | get*\*, list*_, search\__ |

### Data Flow

```
1. SDK Runner identifies tool call needing approval
2. Generates unique approval ID (UUID)
3. Stores in NUMA_REQUEST_ID_MAP env var: {"action_key": ["id1", "id2"]}
4. Emits SSE event: type="tool_approval" with description, props, request_id
5. Frontend shows approval card (90-second countdown)
6. User clicks Approve/Deny
7. Frontend POSTs decision to /api/workspace-chat-agent/invocations
8. Decision written to DynamoDB (integrations-approval table)
9. Lambda polls DynamoDB every 5 seconds for decision
10. Returns: approved -> execute, denied -> skip, timeout -> report
```

### Resolution Priority

1. **Agent-level override** (`toolsConfig.approvalModes` per category)
2. **User setting** (`numaToolApprovalMode` per category)
3. **Default** (`non_destructive` for integrations, `never` for Numa tools)

### Wiring Approval Into a New Tool

To add HITL support for a new tool:

1. **Classify operations** as safe (read-only) or write (side effects)
2. **Add category** to `numaToolApprovalMode` options (Settings.tsx, AgentCreateModal.tsx)
3. **Pop approval ID** in your MCP tool: `pop_approval_id(action_key)`
4. **Pass to Lambda**: Include `request_id` and `auto_approved` in the event
5. **Poll in Lambda**: Use `poll_approval(approval_id)` from `tools/approval.py`
6. **Handle results**: `approved`, `denied`, `timeout`
7. **Emit SSE event**: SDK runner emits `tool_approval` with your category

### The `description` Parameter

The `description` field in every tool's input schema is shown directly to the user in the approval card. For write operations, it should include the full content being changed:

```python
"description": {
    "type": "string",
    "description": (
        "Human-readable description of what this operation does. "
        "For write operations, include the full content being "
        "created/changed (shown to user for approval)."
    ),
}
```

Example: "Send email to alice@example.com with subject 'Q4 Report' and body 'Hi Alice, please find the report attached.'"

---

## 6. Frontend Tool Rendering

The frontend uses a segment-based architecture. Each message is decomposed into typed segments, with specialized components for each type.

### Segment Types

| Kind          | Component                   | Use Case                                                    |
| ------------- | --------------------------- | ----------------------------------------------------------- |
| `inline_tool` | `WorkspaceChatInlineTool`   | Single-line indicators (file reads, searches, integrations) |
| `tool_card`   | `UnifiedToolCard`           | Card-based results (KB, web search, data analysis)          |
| `subagent`    | `WorkspaceChatSubagentCard` | Task tool results                                           |
| `todo`        | `WorkspaceChatTodoCard`     | TodoWrite checklists                                        |
| `text`        | Markdown renderer           | Regular text content                                        |
| `thinking`    | Collapsible block           | Extended thinking                                           |

### Tool Identification

`getToolSegmentKind(toolName)` maps tool names to segment types:

- SDK tools (Read, Write, Bash, etc.) -> `inline_tool`
- MCP integration tools -> `inline_tool`
- Everything else -> `tool_card`

`getToolCategoryAndIcon(toolName, input)` categorizes for display:

- **Transient** (Glob, Grep, Read) -- Fade out when text starts streaming
- **Important** (WebSearch, Write, Edit, Ops) -- Always visible with icons
- **Default** -- Standard display

### Display Text Generation

`getInlineToolDisplay(toolName, input)` generates human-friendly text:

- Read -> "Reading config.json"
- WebSearch -> "Searching for 'Python async patterns'"
- Bash -> Uses `input.description` field (this is why the description param matters!)

### Adding Custom Rendering for a New Tool

1. **Route the tool name** in `getToolSegmentKind()` to `inline_tool` or `tool_card`
2. **Set display text** in `getInlineToolDisplay()` -- extract meaningful info from input
3. **Set icon** in `getToolCategoryAndIcon()` -- Bootstrap icon class or custom image URL
4. **For tool_card results** -- Add a renderer in `toolRenderers/` and register in `UnifiedToolCard.tsx`
5. **For inline_tool with approval** -- The approval panel renders automatically when approval data is attached

### Integration Branding

Integration tools get special treatment:

- Logo images loaded from `integrationsConfig`
- Tool name converted: `mcp__integrations__run_action` with `action_key="gmail-send-email"` becomes `gmail_integration`
- Display text: "Calling Send Email tool: Send message to alice@example.com"

---

## 7. Agent Type Configurations

Different agent types get different tool sets from the same engine. This is what makes the tool group splitting valuable.

### AgentTypeConfig (base.py)

Key fields controlling tool availability:

```python
@dataclass
class AgentTypeConfig:
    type_id: str                          # "numa-chat", "research-agent", etc.
    display_name: str

    # Layer 1: SDK Tools
    tools: list[str]                      # Base SDK tools to enable
    allowed_tools: list[str]              # Granular patterns like "Bash(python:*)"
    disallowed_tools: list[str]           # Explicit deny list

    # Layer 2: MCP Tool Groups
    enable_scripts_mcp: bool = True
    enable_integrations_mcp: bool = True
    enable_numa_mcp: bool = True
    enable_connect_mcp: bool = False
    enable_vault_mcp: bool = False
    allowed_numa_operations: list[str] | None = None  # None = all allowed

    # Layer 3: Skill Docs
    enabled_numa_tools: list[str]         # Which tool docs to copy
    tools_source_dirs: list[str]          # Source directories for scripts

    # Prompt
    system_prompt_builder: Callable | None = None  # Custom prompt builder
    identity_override: str | None = None           # Replace default identity

    # KBs and Integrations
    default_kbs: list | None = None
    restrict_kbs: bool = False
    default_integrations: list | None = None
    restrict_integrations: bool = False
```

### Examples

**Numa Chat (default)** -- Full access to everything:

```python
NUMA_CHAT = AgentTypeConfig(
    type_id="numa-chat",
    enable_scripts_mcp=True,
    enable_integrations_mcp=True,
    enable_numa_mcp=True,
    enabled_numa_tools=["agents", "memories", "numa-ops"],
    # No restrictions on KBs or integrations
)
```

**Research Agent** -- No integrations, focused on KB and web search:

```python
RESEARCH_AGENT = AgentTypeConfig(
    type_id="research-agent",
    enable_integrations_mcp=False,      # No Pipedream access
    enable_numa_mcp=True,
    allowed_numa_operations=["knowledge_base", "web_search"],
)
```

**Data Analysis** -- Limited operations, fire-and-forget:

```python
DATA_ANALYSIS = AgentTypeConfig(
    type_id="data-analysis-v2",
    response_mode="fire-and-forget",
    allowed_numa_operations=["knowledge_base", "web_search", "extract_content", "convert_document"],
    system_prompt_builder=build_data_analysis_prompt,  # Custom prompt
)
```

### Agent Instance Overrides

Individual agent instances (created by users in the Agent Builder) can further restrict:

```typescript
// DynamoDB agent record
{
  "toolsConfig": {
    "autoToolsEnabled": true,
    "webSearchEnabled": false,           // Disable web search for this agent
    "allowedKnowledgeBases": ["company"], // Only one KB
    "enabledConnections": ["slack"],      // Only Slack integration
    "approvalModes": {
      "integrations": "always",           // Override: always require approval
      "ops": "never"                      // Override: auto-approve ops
    }
  }
}
```

### Resolution Chain

```
Request arrives with { type, agentId, enabledConnections, availableKBs, enabledTools }
  |
  1. Load agent type config: get_agent_type_config(type)
  |   -> Baseline: which MCP groups enabled, which operations allowed
  |
  2. Load agent instance config: fetch_agent_config(agentId)
  |   -> Override: further restrict tools, KBs, integrations
  |
  3. Apply type-level restrictions (restrict_kbs, restrict_integrations)
  |
  4. Apply instance-level restrictions (allowedKnowledgeBases, enabledConnections)
  |
  5. Build SDK config with combined tool set
  |
  6. Run agent
```

---

## 8. Step-by-Step: Adding a New Tool

Here's a complete checklist for adding a new tool to Numa chat. Not all steps apply to every tool -- use judgment based on your tool's needs.

### Step 1: Define the MCP Tool

**File:** `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/`

**Option A: Add to an existing group** (preferred for related operations)

Add a new operation to `numa_tool.py`:

```python
# Add handler
async def _handle_my_new_operation(params: dict[str, Any]) -> dict[str, Any]:
    result = invoke_workspace_tool("my_operation", params)
    return _ok(json.dumps(result))

# Register in TOOL_HANDLERS
TOOL_HANDLERS["my_operation"] = _handle_my_new_operation

# Add to the enum in the tool's input_schema
"enum": [..., "my_operation"]
```

**Option B: Create a new tool group** (for independent, feature-flaggable capabilities)

Create `my_tool.py`:

```python
from claude_agent_sdk import tool

@tool(
    name="my_tool",
    description="Description shown in tool schema",
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string", "enum": ["op1", "op2"]},
            "params": {"type": "object"},
            "description": {"type": "string", "description": "Human-readable (shown to user)"},
        },
        "required": ["name", "params", "description"]
    }
)
async def my_tool(args: dict[str, Any]) -> dict[str, Any]:
    # Dispatch to handlers
    ...
```

Register in `sdk_config.py`:

```python
if type_config.enable_my_tool_mcp:
    mcp_servers["my_tool"] = create_sdk_mcp_server(
        name="my_tool", version="1.0.0", tools=[my_tool]
    )
```

### Step 2: Create the Lambda Handler (if needed)

**File:** `lambdas/python/workspace-chat-tools/`

Add handler function and register in `TOOL_HANDLERS`:

```python
def handle_my_operation(params):
    # Validate params
    # Do the work (DynamoDB, S3, external API, etc.)
    # Return result
    return {"status": "success", "data": {...}}

TOOL_HANDLERS["my_operation"] = handle_my_operation
```

Add security gates if needed (allowlist checks, user_sub validation).

### Step 3: Write the Skill

**File:** `services/numa-workspace-agent/plugins/numa/skills/my-tool/SKILL.md`

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
| op2       | Does Y      | param_c          |

## Examples

mcp**my_tool**my_tool(
name="op1",
description="Doing X with the data",
params={"param_a": "value", "param_b": 42}
)
```

Register in the TOOL_USAGE prompt section if needed.

### Step 4: Wire Up HITL (if needed)

1. Classify operations as safe/write
2. Add approval category to frontend Settings + Agent Builder
3. Use `pop_approval_id()` and `poll_approval()` in the execution path

### Step 5: Frontend Rendering

1. Add tool routing in `getToolSegmentKind()`
2. Set display text in `getInlineToolDisplay()`
3. Set icon in `getToolCategoryAndIcon()`
4. Optionally create a custom result renderer in `toolRenderers/`

### Step 6: Agent Type Configuration

1. Add enable flag to `AgentTypeConfig` if it's a new group
2. Update existing agent types to enable/disable as appropriate
3. Add to `enabled_numa_tools` for types that should get the skill docs

### Step 7: Infrastructure

1. Add Lambda to infra constructs if new
2. Wire environment variables (Lambda name, table names)
3. Add IAM permissions for the Lambda
4. Add feature flag if the tool should be toggleable per client

---

## 9. Future Direction: Unified CLI Approach

A longer-term consideration is whether to consolidate all tools into a single Numa CLI binary that Claude executes via Bash, with API documentation provided as reference. This would:

**Pros:**

- Simplify the MCP tool layer to a single entry point
- Make adding new operations as simple as adding a CLI subcommand
- Reduce prompt token usage (one tool schema instead of many)
- Leverage Claude's natural ability to use CLI tools

**Cons:**

- Loses granular MCP server grouping for agent type specialization
- Approval flows would need different wiring
- CLI binary distribution and versioning adds complexity
- Loses structured input/output (JSON schemas -> CLI args)

This is worth exploring but would be a significant architectural change. The current MCP-based approach works well and provides the flexibility needed for agent specialization.
