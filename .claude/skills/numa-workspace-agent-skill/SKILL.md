---
name: numa-workspace-agent-skill
description: Comprehensive guide for the Numa Workspace Agent service. Use when working on workspace agent code, debugging issues, adding features, configuring agent types, testing locally, or understanding how workspace chat streaming works. Covers architecture, agent types, tools, plugins, security hooks, local testing, infra constructs, logging, and deployment.
---

# Numa Workspace Agent Service — Comprehensive Guide

## Overview

The `numa-workspace-agent` is a FastAPI application that powers Numa's workspace chat experience. It runs on AWS Bedrock AgentCore MicroVMs and uses the Claude Agent SDK (pinned to `0.1.47`) for AI capabilities. Unlike the deprecated Lambda-based `numa-chat-agent`, this agent has persistent file system access, sandboxed code execution, and runs in isolated per-conversation containers.

**Location:** `services/numa-workspace-agent/`

---

## Architecture Flow

```
User Message
    |
Frontend (NumaWorkspaceChatAgents.tsx)
    |
workspace-chat-agent-proxy Lambda (routes to AgentCore by session ID)
    |
AgentCore MicroVM Container (ARM64 Graviton, Python 3.13-slim)
    |
FastAPI App (main.py)
    |
+---------------------------------------------+
|  Pre-Request Assistant (Nova 2 Lite)         |
|  - Analyzes user message                     |
|  - Provides hints via <numa-assistant> tags  |
|  - Fast regex pattern matching               |
+---------------------------------------------+
    |
+---------------------------------------------+
|  Claude SDK Runner (sdk_runner.py)           |
|  - Streams SDK message types                 |
|  - Writes to trace.jsonl                     |
|  - Handles tool calls via hooks              |
+---------------------------------------------+
    |
S3 Sync (workspace files + trace archive)
    |
SSE Stream back to Frontend
```

---

## Module Structure

```
services/numa-workspace-agent/
+-- numa_workspace_agent/
|   +-- __init__.py              # App version, startup logging
|   +-- main.py                  # FastAPI app, all endpoints, request routing
|   +-- agent_config.py          # AgentConfig fetching (saved agents, user profiles)
|   +-- assistant.py             # Pre-request Nova 2 Lite assistant
|   +-- sdk_runner.py            # Claude SDK streaming execution
|   +-- sdk_config.py            # ClaudeAgentOptions builder, model config
|   +-- prompts.py               # System prompt sections and builders
|   +-- trace_parser.py          # Conversation history from trace.jsonl
|   +-- s3_workspace.py          # S3 sync operations (upload/download workspace)
|   +-- workspace.py             # Local workspace management (dirs, files)
|   +-- pipeline.py              # Multi-step pipeline execution
|   +-- dynamo.py                # DynamoDB operations (conversation meta, V1 migration)
|   +-- session.py               # Session state management
|   +-- stream_logger.py         # Verbose stream logging for debugging
|   +-- hooks/
|   |   +-- __init__.py          # Exports: security_hook, audit_hook, compaction_hook, image_resize_hook, param_aliases_hook, workflow_guard_hook, numa_call_counter_reset_hook
|   |   +-- security.py          # PreToolUse/PostToolUse security validation (denylist)
|   |   +-- numa_call_counter.py # PreToolUse Bash: resets the per-command numa-call cap counter
|   |   +-- workflow_guard.py    # PreToolUse Write/Edit: validates saved-workflow writes
|   |   +-- image_resize.py      # PreToolUse Read: downsamples oversized images
|   |   +-- param_aliases.py     # PreToolUse Grep: normalises param-name slips
|   +-- saved_workflows.py       # Saved Workflows format (parse/validate/secret-scan)
|   +-- agent_types/
|   |   +-- __init__.py          # Side-effect imports that register all types
|   |   +-- base.py              # AgentTypeConfig dataclass, TOOL_FILE_MAP, ALWAYS_COPY
|   |   +-- registry.py          # register_agent_type(), get_agent_type_config(), list_agent_types()
|   |   +-- numa_chat.py         # Default interactive chat
|   |   +-- research_agent.py    # Research-focused, no integrations
|   |   +-- document_summariser.py  # Sync mode, structured JSON output
|   |   +-- tony_comedian.py     # Custom persona demo
|   |   +-- quoting.py           # Quoting agent with custom tools
|   |   +-- data_analysis.py     # Data analysis agent
|   |   +-- profile_creator.py   # Pipeline orchestrator (2-step)
|   |   +-- profile_researcher.py  # Pipeline step 1
|   |   +-- profile_validator.py   # Pipeline step 2
|   |   +-- nolia/               # Nolia compliance review (complex pipeline)
|   |       +-- __init__.py      # Registers nolia-compliance + phase types
|   |       +-- nolia_compliance.py  # Parent orchestrator
|   |       +-- nolia_rules_generator.py  # Rules generation type
|   |       +-- orchestrator.py  # Custom pipeline orchestrator
|   |       +-- rules_orchestrator.py  # Rules extraction orchestrator
|   |       +-- workspace_setup.py  # Nolia workspace pre-population
|   |       +-- phase_*.py       # Individual pipeline phases
|   |       +-- prompts/         # Phase-specific system prompts
|   |       +-- templates/       # Output templates
|   +-- mcp_tools/               # MCP layer REMOVED (Phase 6) — agent runs with ZERO MCP servers
|       +-- __init__.py          # Docstring only; the in-process MCP tools are gone
|       +-- integration_preferences.py  # Surviving pure-Python helper (per-service preferred_method lookup), imported by prompts.py — NOT an MCP tool
+-- tools/
|   +-- numa/                    # Reference docs copied to /workdir/tools/numa/ (parameter cheat-sheets for the numa CLI, not executable)
|       +-- numa_files.py        # Reference doc for `numa files` (KB/file ops)
|       +-- web_search.py        # Reference doc for `numa web`
|       +-- convert_document.py  # Reference doc for `numa docs convert`
|       +-- extract_content.py   # Reference doc for `numa docs extract`
|       +-- numa-agents.py       # Reference doc for `numa agents`
|       +-- numa-memories.py     # Reference doc for `numa memory`
|       +-- numa-ops.py          # Reference doc for `numa ops`
+-- plugins/
|   +-- numa/
|       +-- .claude-plugin/      # Plugin manifest
|       +-- skills/              # Claude skills (knowledge-search, web-search, pdf-handling, etc.)
|       +-- agents/              # Agent reference docs (integrations.md, knowledge-search.md)
+-- integration-prompts/         # SaaS-specific prompt extensions (14 files)
|   +-- gmail.md, slack.md, jira.md, notion.md, sharepoint.md, google_drive.md,
|   +-- hubspot.md, xero_accounting_api.md, microsoft_outlook.md,
|   +-- microsoft_outlook_calendar.md, google_calendar.md, asana.md,
|   +-- apollo_io.md, zoom.md
+-- tests/
|   +-- conftest.py
|   +-- test_agent_types.py
|   +-- test_type_resolution.py
|   +-- test_pipeline.py
|   +-- test_security_hooks.py
|   +-- test_registry.py
|   +-- test_deserialization_blocking.py
|   +-- test_integration_preferences_drift.py
|   +-- test_interrupt_reclassification.py
|   +-- test_quota_fallback.py
|   +-- test_background_watching_state.py
|   +-- test_image_resize_hook.py
+-- pyproject.toml               # Poetry deps (Python 3.13, claude-agent-sdk==0.1.47)
+-- Dockerfile                   # ARM64 production image
+-- run.sh                       # Entrypoint (opentelemetry-instrument uvicorn)
+-- poetry.lock
```

---

## Endpoints

| Endpoint                     | Method | Purpose                                        |
| ---------------------------- | ------ | ---------------------------------------------- |
| `/ping`                      | GET    | AgentCore health check                         |
| `/invocations`               | POST   | Main request handler (dispatches by action)    |
| `/history/{conversation_id}` | GET    | Fetch conversation history from S3             |
| `/trace/{conversation_id}`   | GET    | Raw trace.jsonl content                        |
| `/files`                     | GET    | List workspace files (current conversation)    |
| `/files/{conversation_id}`   | GET    | List workspace files for specific conversation |
| `/workspace/files`           | GET    | List workspace files (alternative path)        |
| `/workspace/file`            | GET    | Get specific workspace file                    |

**Actions (via POST /invocations):**

- `chat` — Main chat streaming (or sync/fire-and-forget depending on agent type)
- `stop` — Stop a running agent
- `upload` / `upload_complete` — Upload file to workspace
- `delete_uploads` — Remove staged files
- `cleanup_session` — Clear output files
- `status` — Agent status and capabilities
- `list_files` — List files in workspace

---

## Agent Type System

The agent type system is the core configuration mechanism. Each agent type is a different configuration of the same workspace agent engine — same engine, different knobs.

### Key Files

| File                            | Purpose                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `agent_types/base.py`           | `AgentTypeConfig` dataclass with all config fields                       |
| `agent_types/registry.py`       | `register_agent_type()`, `get_agent_type_config()`, `list_agent_types()` |
| `agent_types/__init__.py`       | Side-effect imports that register all built-in types                     |
| `sdk_config.py`                 | `create_agent_options()` — bridges config to `ClaudeAgentOptions`        |
| `tests/test_agent_types.py`     | Tests for agent type configs                                             |
| `tests/test_type_resolution.py` | Tests for config -> SDK options flow                                     |

### AgentTypeConfig Fields Reference

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
    allowed_tools: list[str]        # Granular allow-list. `Bash(numa:*)` here is
                                    #   what grants the type the numa CLI.
    disallowed_tools: list[str]     # Granular deny-list

    # Layer 2: numa CLI surface
    # The numa CLI (Bash) is the platform tool surface. The two knobs that
    # matter:
    #   - `Bash(numa:*)` in allowed_tools  → grants the CLI at all
    #   - allowed_cli_commands             → restricts which CLI *categories*
    allowed_cli_commands: Optional[list[str]] = None  # None = all categories;
        # e.g. ["docs"] for Nolia phases. Enforced server-side in numa-cli-api
        # (keyed on NUMA_AGENT_TYPE) AND drives the dynamic prompt.

    # Legacy MCP flags — VESTIGIAL. The MCP layer was deleted (Phase 6); the
    # agent runs with ZERO MCP servers (sdk_config builds `mcp_servers = {}`).
    # All default False and NOTHING opts back in. Kept only until they're
    # removed from the dataclass.
    enable_scripts_mcp: bool = False
    enable_integrations_mcp: bool = False
    enable_numa_mcp: bool = False
    enable_connect_mcp: bool = False
    enable_vault_mcp: bool = False
    allowed_numa_operations: Optional[list[str]] = None  # still read by some
        # configs; None = all, list = restrict (legacy numa-tool op names)

    # Layer 3: Numa CLI reference docs (copied to /workdir/tools/numa/)
    enabled_numa_tools: list[str]   # Tool names from TOOL_FILE_MAP
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
    pipeline_orchestrator: Optional[Callable[..., Any]] = None  # Custom orchestrator

    # Limits
    max_turns: int = 200
    max_thinking_tokens: int = 10_000

    # Thinking
    thinking: Optional[dict] = {"type": "adaptive"}  # or {"type": "enabled", "budget_tokens": N} or {"type": "disabled"}
    effort: Optional[str] = "medium"  # "low", "medium", "high", "max"

    # Security
    enable_security_hooks: bool = True

    # Model
    default_model: Optional[str] = None

    # Sub-agents (for Task tool cost optimisation — e.g. Haiku sub-agents)
    agents: Optional[dict[str, Any]] = None
```

### Response Modes

| Mode              | Behaviour                                                        | Use Case                           |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------- |
| `stream`          | SSE/NDJSON streaming to frontend                                 | Interactive chat                   |
| `sync`            | Caller waits for full response                                   | Structured output, pipeline steps  |
| `fire-and-forget` | Accept request, return immediately, write results to S3/DynamoDB | Background processing (e.g. Nolia) |

### Three Tool Layers

**Layer 1: Claude SDK Tools** — Built-in capabilities controlled by `tools` and `allowed_tools`:

- File ops: `Read`, `Write`, `Edit`, `Glob`, `Grep`
- Shell: `Bash`, `KillShell` (with granular command allow-list like `Bash(python:*)`)
- Tasks: `TodoWrite`, `Skill`

**Layer 2: The numa CLI** — the platform tool surface. There are **no MCP servers** — the whole `numa`/`integrations`/`connectors`/`vault`/`scripts` MCP layer was deleted (Phase 6) and `sdk_config.py` builds `mcp_servers = {}`. Instead, the agent invokes capabilities by shelling out to the unified `numa` CLI via the Bash tool:

```bash
numa <category> <command> ... -m "user-visible caption"
```

Categories: `files` (KB/file ops), `web` (search/fetch), `docs` (extract/convert/transcribe), `agents`, `memory`, `integrations`, `ops`, `render`. The CLI POSTs `{tool, params, context}` to the `numa-cli-api` Lambda, which routes to the kept Python handlers in `lambdas/python/workspace-chat-tools/tools/` and enforces the Ops gate, the per-agent-type CLI allow-list, and HITL approvals.

Two config knobs control Layer 2:

- **`Bash(numa:*)` in `allowed_tools`** grants the CLI at all. A type without it cannot reach the platform.
- **`allowed_cli_commands`** restricts which categories the type may use. `None` = all; a list restricts (e.g. Nolia phases = `["docs"]`). Enforced server-side in `numa-cli-api` keyed on `NUMA_AGENT_TYPE`, and it also shapes the dynamic prompt (only permitted categories are described).

The `enable_*_mcp` flags (`enable_scripts_mcp`, `enable_integrations_mcp`, `enable_numa_mcp`, `enable_connect_mcp`, `enable_vault_mcp`) are **vestigial** — all default `False`, nothing opts in. `allowed_numa_operations` still exists for legacy op-name restriction but the CLI/server gates are the live mechanism.

**Code execution** is NOT an MCP tool either: the agent writes a Python/Bash script into `/workdir/tmp/` and runs it with the SDK `Bash` tool.

**Layer 3: Numa Tool Reference Docs** — Documentation cheat-sheets copied to `/workdir/tools/numa/` at startup. Claude reads these for `numa` CLI parameter reference but cannot execute them directly. Controlled by `enabled_numa_tools` and `TOOL_FILE_MAP`:

| Tool Name           | File(s)               | CLI it documents            |
| ------------------- | --------------------- | --------------------------- |
| `numa_files_search` | `numa_files.py`       | `numa files`                |
| `knowledge_search`  | `numa_files.py`       | `numa files` (legacy alias) |
| `web_search`        | `web_search.py`       | `numa web`                  |
| `agents`            | `numa-agents.py`      | `numa agents`               |
| `memories`          | `numa-memories.py`    | `numa memory`               |
| `convert_document`  | `convert_document.py` | `numa docs convert`         |
| `extract_content`   | `extract_content.py`  | `numa docs extract`         |

**Note:** `numa-ops.py` exists in `tools/numa/` but is not in `TOOL_FILE_MAP` — it is referenced by name `"numa-ops"` in `enabled_numa_tools` in `numa_chat.py`.

### Registered Agent Types

| Type ID                 | Mode            | Custom Prompt           | Pipeline                  | Purpose                                 |
| ----------------------- | --------------- | ----------------------- | ------------------------- | --------------------------------------- |
| `numa-chat`             | stream          | No                      | No                        | Default Numa chat with full tool access |
| `research-agent`        | stream          | No                      | No                        | Research-focused, no integrations       |
| `document-summariser`   | sync            | Yes                     | No                        | Reads docs, writes structured JSON      |
| `tony-comedian`         | stream          | Yes (identity override) | No                        | Demo agent with custom persona          |
| `quoting`               | stream          | Yes                     | No                        | Quoting agent with custom tools dir     |
| `data-analysis`         | stream          | Yes                     | No                        | Data analysis agent                     |
| `profile-creator`       | sync            | No                      | Yes (2 steps)             | Orchestrates researcher + validator     |
| `profile-researcher`    | sync            | Yes                     | No                        | Pipeline step 1: research + draft       |
| `profile-validator`     | sync            | Yes                     | No                        | Pipeline step 2: validate + finalize    |
| `nolia-compliance`      | fire-and-forget | Yes                     | Yes (custom orchestrator) | Procurement compliance pipeline         |
| `nolia-rules-generator` | fire-and-forget | Yes                     | Yes (custom orchestrator) | Rules generation pipeline               |

### System Prompt Customisation

Two mechanisms, from simple to full control:

**identity_override (simple)** — Replaces just the IDENTITY_AND_ROLE section:

```python
AgentTypeConfig(
    type_id="my-agent",
    identity_override="You are a helpful quoting assistant created by Arcanum AI.",
)
```

**system_prompt_builder (full control)** — A callable that returns the complete system prompt. Import sections from `prompts.py`:

Available sections: `IDENTITY_AND_ROLE`, `WORKSPACE_ENVIRONMENT`, `STYLE_AND_COMMUNICATION`, `TASK_EXECUTION`, `TOOL_USAGE`, `WORKSPACE_CAPABILITIES`, `ENVIRONMENT_AND_META`

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

**Combining both** — Use `identity_override` to swap identity and `system_prompt_builder` to append extra instructions:

```python
def build_my_prompt(**kwargs):
    base = build_workspace_system_prompt(**kwargs)
    return base + MY_ADDENDUM

AgentTypeConfig(
    type_id="my-agent",
    identity_override=MY_CUSTOM_IDENTITY,
    system_prompt_builder=build_my_prompt,
)
```

### Creating a New Agent Type — Checklist

1. Create `services/numa-workspace-agent/numa_workspace_agent/agent_types/<my_agent>.py`
2. Define an `AgentTypeConfig` instance
3. Call `register_agent_type(config)` at module level
4. Add side-effect import in `agent_types/__init__.py`:
   ```python
   from . import my_agent as _my_agent  # noqa: F401
   ```
5. Add tests in `tests/test_agent_types.py`
6. Run tests: `cd services/numa-workspace-agent && poetry run pytest tests/test_agent_types.py tests/test_type_resolution.py -v`

### Example: Streaming Agent

```python
"""Quoting Agent — generates quotes from product catalogues."""
from .base import AgentTypeConfig
from .registry import register_agent_type
from ..prompts import build_workspace_system_prompt

QUOTING_IDENTITY = """You are a professional quoting assistant created by Arcanum AI."""

QUOTING_ADDENDUM = """
## Quoting Rules
- Always confirm items and quantities before generating a final quote
- Include GST calculations (15% for NZ)
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
    # `Bash(numa:*)` grants the numa CLI; allowed_cli_commands narrows it to
    # just KB/file ops (no web, agents, memory, ops, etc.).
    tools=["Read", "Glob", "Grep", "Write", "Edit", "TodoWrite", "Bash"],
    allowed_tools=["Read", "Glob", "Grep", "Write", "Edit", "TodoWrite", "Bash(numa:*)"],
    allowed_cli_commands=["files"],
    enabled_numa_tools=["numa_files_search"],
    tools_source_dirs=["numa"],
    restrict_kbs=False,
    restrict_integrations=True,
    max_turns=20,
)

register_agent_type(QUOTING_AGENT)
```

### Example: Pipeline Agent (Chained Steps)

```python
"""Report Generator — two-step pipeline: research then format."""
from .base import AgentTypeConfig
from .registry import register_agent_type

# Step 1: sync mode, writes /workdir/outputs/research.json
REPORT_RESEARCHER = AgentTypeConfig(
    type_id="report-researcher",
    display_name="Report Researcher (Step 1)",
    response_mode="sync",
    # ... tools config ...
)
register_agent_type(REPORT_RESEARCHER)

# Step 2: sync mode, reads research.json, writes /workdir/outputs/result.json
REPORT_FORMATTER = AgentTypeConfig(
    type_id="report-formatter",
    display_name="Report Formatter (Step 2)",
    response_mode="sync",
    # ... tools config ...
)
register_agent_type(REPORT_FORMATTER)

# Pipeline orchestrator: chains the steps sequentially
REPORT_GENERATOR = AgentTypeConfig(
    type_id="report-generator",
    display_name="Report Generator",
    response_mode="sync",
    pipeline_steps=["report-researcher", "report-formatter"],
    pipeline_result_mode="result_file",
    max_turns=1,
)
register_agent_type(REPORT_GENERATOR)
```

For complex pipelines (parallel execution, conditional steps), use `pipeline_orchestrator` — see Nolia's `orchestrator.py` for a real example.

---

## Hooks & permission model

**Permission mode is conditional** (set in `sdk_config.py`):

- **`bypassPermissions`** for interactive, unrestricted types (numa-chat, etc.) — so the agent isn't silently blocked by the `allowed_tools` allowlist on legitimate shell work (loops, scripts, uncommon tools). Numa surfaces no SDK-permission card (only HITL write-op cards), so a non-allowlisted command would otherwise just dead-end.
- **`acceptEdits` + the tight allowlist** for locked-down / hooks-off types — the Nolia / nolia-funding pipeline phases (untrusted documents; several run with `enable_security_hooks=False`).
- Gate: `bypassPermissions` only when `enable_security_hooks AND allowed_cli_commands is None`. In bypass mode the **security hook** is the guard (plus `disallowed_tools` + the MicroVM sandbox).

**PreToolUse / PostToolUse hooks** (`hooks/`, registered in `sdk_config.py`):

| Hook                                      | Event / target         | Purpose                                                                                                          |
| ----------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `security_hook`                           | PreToolUse, all        | Denylist (dangerous commands/paths/patterns). Gated by `enable_security_hooks`.                                  |
| `numa_call_counter_reset_hook`            | PreToolUse, Bash       | Resets the per-command `numa`-call counter (cost cap; a **side effect**, never modifies the command).            |
| `workflow_guard_hook`                     | PreToolUse, Write/Edit | Validates saved-workflow writes to `/workdir/chat-workflows/` (deny malformed header, warn on hardcoded secret). |
| `param_aliases_hook`, `image_resize_hook` | PreToolUse, Grep/Read  | Rewrite tool input (param slips, oversized images).                                                              |
| `audit_hook`                              | Pre + Post             | Logs tool invocations.                                                                                           |
| `compaction_hook`                         | PreCompact             | Conversation compaction events.                                                                                  |

**What `security_hook` blocks:** access to `/workdir/.system/`, `/workdir/secrets/`, `.env`; `rm -rf` of protected paths, `curl`/`wget`/`nc`, `sudo`/`su`; env-var / `/proc/*/environ` disclosure; privilege escalation. System-info commands (`whoami`/`uname`/…) are blocked at a **command boundary** (so `numa whoami` and quoted args are fine).

**SDK layer blocks:** `${...}` and `$'...'` patterns. Workaround: write Python scripts to files instead of inline execution.

> **The CLI features that wrap this — Phase-5 per-agent-type allow-list, the per-command rate limit, saved workflows, render-on-reload, the `numa-cli-api` gates, the identity model — are documented in [`documentation/numa-cli/README.md`](../../../documentation/numa-cli/README.md) (canonical) and the `numa-cli/CLAUDE.md` package guide.**

---

## S3 Workspace Persistence

**Key Functions in `s3_workspace.py`:**

- `sync_from_s3()` — Download workspace on cold start
- `sync_to_s3()` — Upload changed files after request
- `sync_conversation_switch()` — Archive old + restore new conversation
- `restore_claude_session()` / `archive_claude_session()` — SDK session state
- `sync_agent_reference_files()` — Download agent-attached files
- `sync_uploads_from_s3()` — Download user uploads
- `sync_workspace_prefixes()` — Download from multiple S3 prefixes (used by V2 apps)

**S3 Path Structure:**

```
s3://{outputs_bucket}/workspaces/{user_sub}/{conversation_id}/
+-- .system/          # Claude SDK session state
+-- outputs/          # Per-conversation output files
+-- uploads/          # User uploaded files
+-- chat-workflows/   # Persistent scripts (user-level, not conversation)
+-- trace.jsonl       # Conversation history
```

**Session Persistence Flow:**

1. **Cold Start:** Container starts fresh, `sync_from_s3()` downloads workspace
2. **Warm Container:** Same user's files already local, no sync needed
3. **Conversation Switch:** `sync_conversation_switch()` archives old, restores new
4. **Session Resumption:** `session_id` from trace enables Claude context continuation

---

## Cross-Account Bedrock Credentials

When using cross-account Bedrock (configured via `BEDROCK_ACCOUNT` env var), the SDK subprocess gets cross-account AWS credentials, but local-account services (the `numa-cli-api` Lambda, S3) still need local account credentials.

- `AWS_*` env vars — Cross-account Bedrock credentials (or local credentials if no cross-account)
- `NUMA_LOCAL_AWS_*` env vars — Local account credentials for Lambda/S3 calls

**Implementation:** `sdk_config.py` captures local credentials _before_ assuming the cross-account role and propagates them into the CLI subprocess env as `NUMA_LOCAL_AWS_*`. The `numa` CLI uses those to sign its invocation of the local-account `numa-cli-api` Lambda; in-process helpers that still touch the local account (e.g. `credit_metering.py`, `mcp_tools/integration_preferences.py`) read them too.

---

## Proxy Lambda

**Location:** `lambdas/python/workspace-chat-agent-proxy/`

The proxy Lambda bridges HTTP requests from CloudFront to AgentCore SDK invocations. It:

- Validates Cognito JWT tokens and CloudFront shared secret
- Routes to AgentCore by session ID (`conv-{conversationId}`)
- Handles the `approve` action directly (DynamoDB write, no AgentCore invocation)
- Supports file redirect for integration uploads
- Translates HTTP request/response to AgentCore's `invoke_agent_runtime` format

**Infra:** `infra/constructs/workspace-chat-agent-proxy-construct.ts`

```
Browser --> CloudFront --> Lambda Function URL --> AgentCore MicroVM
                                   |
                                   +-- Validates JWT + CloudFront secret
                                   +-- Routes by session ID
                                   +-- Proxies streaming response
```

## Tools Lambda

**Location:** `lambdas/python/workspace-chat-tools/`

The support Lambda that backs the `numa` CLI — the agent's `numa <category> <command>` calls flow through the `numa-cli-api` Lambda, which dispatches to this Lambda's `TOOL_HANDLERS` for operations that need direct AWS service access:

- Knowledge base queries (Bedrock KB or Q Business)
- Web search proxy
- Content extraction (OCR, transcription)
- Document conversion (DOCX/PDF, Markdown/PDF)
- Integration relay (Pipedream)
- Memory management (user profile memories)
- Ops operations (Numa Ops Lambda invocation)

**Infra:** `infra/constructs/workspace-chat-tools-construct.ts`

Contains helper modules: `consolidated_storage.py` (S3 storage abstraction), `enhanced_oauth_tools.py` (OAuth tools), `template_engine.py` (template processing), `tools/` (individual tool handlers).

---

## Infrastructure Constructs

### workspace-chat-agent-construct.ts

Creates the AgentCore runtime environment:

- ECR repository for Docker images
- `BedrockagentcoreAgentRuntime` resource
- IAM roles with Bedrock, S3, DynamoDB, Lambda, Secrets Manager permissions
- CloudWatch log groups and log delivery configuration
- NullResource for `skopeo` image push from local-exec

Key props: `clientName`, `region`, `outputsBucketArn`, `cognitoUserPoolId`, `workspaceToolsLambdaArn`, `bedrockAccount`, `containerLogGroup`

### workspace-chat-agent-proxy-construct.ts

Creates the proxy Lambda:

- Lambda with Function URL (for CloudFront routing)
- AgentCore `invoke_agent_runtime` permission
- Cognito JWT validation
- CloudFront shared secret validation

Key props: `agentRuntimeArn`, `cloudfrontSharedSecret`, `cognitoUserPoolId`, `scheduleRunnerSecret`

### workspace-chat-tools-construct.ts

Creates the tools support Lambda:

- KB query permissions (Bedrock or Q Business)
- S3 bucket access (data + outputs)
- Lambda invoke permissions for extract-content, document-converter
- Pipedream relay Lambda invocation
- DynamoDB access for chat settings and approval tables

Key props: `preferredKnowledgeBase`, `bedrockKnowledgeBaseId`, `dataBucketArn`, `extractContentLambdaArn`, `pipedreamRelayLambdaArn`

---

## Logging Conventions

All logs use structlog with consistent fields for CloudWatch Logs Insights querying.

### Required Fields

| Field   | Purpose                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------- |
| `_name` | Log identifier (sorts first alphabetically). Examples: `REQUEST_RECEIVED`, `SDK_START`, `COST` |
| `phase` | Request lifecycle phase for filtering                                                          |

### Phases

| Phase       | When                                        |
| ----------- | ------------------------------------------- |
| `init`      | Cold start, KB listings fetch               |
| `request`   | Request received, validation                |
| `auth`      | Authentication/authorization                |
| `assistant` | Pre-request assistant (Nova)                |
| `sdk`       | Claude SDK execution                        |
| `sync`      | S3 workspace sync                           |
| `cleanup`   | Post-request cleanup (DynamoDB meta update) |

### Key Log Names

| `_name`                     | Description                                           |
| --------------------------- | ----------------------------------------------------- |
| `REQUEST_RECEIVED`          | Incoming request via proxy                            |
| `INVOCATION`                | Action dispatch (chat, upload, etc.)                  |
| `CHAT_REQUEST`              | Chat action started                                   |
| `KB_LISTINGS`               | KB file listings fetched                              |
| `ASSISTANT_ADVICE`          | Pre-Numa assistant hint generated                     |
| `SDK_START`                 | Claude SDK execution starting                         |
| `SDK_RESULT`                | SDK completion summary                                |
| `SDK_COMPLETE`              | Full SDK stream finished                              |
| `STREAM_COMPLETE`           | Verbose stream summary with conversation flow         |
| `COST`                      | Dedicated cost log for aggregation                    |
| `S3_SYNC_DOWNLOAD`          | Files downloaded from S3                              |
| `S3_SYNC_UPLOAD`            | Files uploaded to S3                                  |
| `CONVERSATION_META_UPDATED` | DynamoDB meta record updated                          |
| `SDK_LIVE_TEXT`             | DEBUG: Live assistant text (requires LOG_LEVEL=DEBUG) |
| `SDK_LIVE_THINKING`         | DEBUG: Live thinking content                          |
| `SDK_LIVE_TOOL`             | DEBUG: Live tool invocations                          |

### Log Examples

```python
# Good - has _name and phase
logger.info(
    "Chat request",
    _name="CHAT_REQUEST",
    phase="request",
    conversation_id=conversation_id,
    user_sub=user_sub,
)
```

---

## CloudWatch Logs Insights Queries

**Log Group:** `/numa/{client}/workspace-chat-agent`
**Proxy Log Group:** `/aws/lambda/{clientName}-workspace-chat-agent-proxy`

### Find Request by Conversation ID

```sql
fields @timestamp, _name, @message
| filter conversation_id = "abc123-full-id-here"
| sort @timestamp asc
```

### Cost Analysis

```sql
fields @timestamp, total_cost_usd, input_tokens, output_tokens, conversation_id
| filter _name = "COST"
| sort @timestamp desc
| limit 100
```

### Cost by User

```sql
stats sum(total_cost_usd) as total_cost by user_sub
| filter _name = "COST"
| sort total_cost desc
```

### Find Errors

```sql
fields @timestamp, _name, error, @message
| filter level = "error" OR is_error = true
| sort @timestamp desc
```

### Request Flow (Single Request)

```sql
fields @timestamp, _name, phase, @message
| filter conversation_id = "your-conversation-id"
| filter _name in ["REQUEST_RECEIVED", "INVOCATION", "CHAT_REQUEST", "ASSISTANT_ADVICE", "SDK_START", "SDK_RESULT", "SDK_COMPLETE", "COST", "S3_SYNC_UPLOAD"]
| sort @timestamp asc
```

---

## Local Development

### Running Tests

```bash
cd services/numa-workspace-agent
poetry install
poetry run pytest
```

### Running Locally (without Docker)

```bash
cd services/numa-workspace-agent
poetry install
poetry run uvicorn numa_workspace_agent.main:app --reload --port 8080
```

Note: Requires AWS credentials and environment variables configured. See Docker method below for full-featured local testing.

### Docker Testing

#### Prerequisites

- Docker Desktop installed and running
- AWS CLI configured with `q-demo` profile
- Environment variables configured in `/Users/nathandouglas/arcanum/numa/.env`

#### Step 1: Build the Container

```bash
cd /Users/nathandouglas/arcanum/numa/services
./package-service.sh numa-workspace-agent
```

Creates `image.tar` in `infra/assets/artifacts/numa-workspace-agent/`.

Force full rebuild: `DOCKER_BUILD_OPTS="--no-cache" ./package-service.sh numa-workspace-agent`

#### Step 2: Load the Image

```bash
docker load -i /Users/nathandouglas/arcanum/numa/infra/assets/artifacts/numa-workspace-agent/image.tar
```

#### Step 3: Get AWS Credentials

```bash
eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)"
```

**Note:** Do NOT try to `sts assume-role` into the same role you're already in — it will fail with AccessDenied.

#### Step 4: Run the Container

```bash
docker rm -f workspace-test 2>/dev/null

source /Users/nathandouglas/arcanum/numa/.env

docker run -d --rm --name workspace-test \
  -p 8080:8080 \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_REGION="$AWS_REGION_WORKSPACE" \
  -e CLIENT_NAME="$CLIENT_NAME" \
  -e CLAUDE_CODE_USE_BEDROCK="$CLAUDE_CODE_USE_BEDROCK" \
  -e OUTPUTS_BUCKET_NAME="$OUTPUTS_BUCKET_NAME" \
  -e DATA_BUCKET_NAME="$DATA_BUCKET" \
  -e DYNAMODB_TABLE_NAME="$DYNAMODB_TABLE_NAME" \
  -e WORKSPACE_AGENTS_TABLE="$WORKSPACE_AGENTS_TABLE" \
  -e USER_AGENTS_TABLE="$USER_AGENTS_TABLE" \
  -e CHAT_SETTINGS_TABLE_NAME="$CHAT_SETTINGS_TABLE_NAME" \
  -e INTEGRATIONS_APPROVAL_TABLE_NAME="$INTEGRATIONS_APPROVAL_TABLE_NAME" \
  -e WORKSPACE_TOOLS_LAMBDA_NAME="$WORKSPACE_TOOLS_LAMBDA_NAME" \
  -e PIPEDREAM_RELAY_LAMBDA_ARN="$PIPEDREAM_RELAY_LAMBDA_ARN" \
  -e EXTRACT_CONTENT_LAMBDA_ARN="$EXTRACT_CONTENT_LAMBDA_ARN" \
  numa-workspace-agent:latest
```

Wait ~8 seconds for startup (OpenTelemetry detector timeouts), then verify:

```bash
sleep 8 && docker logs workspace-test 2>&1 | tail -15
```

**GOTCHA:** The `.env` uses `DATA_BUCKET`, but the container reads `DATA_BUCKET_NAME`. Map it: `-e DATA_BUCKET_NAME="$DATA_BUCKET"`.

#### Step 5: Test Endpoints

```bash
# Health check
curl -s http://localhost:8080/ping | jq .

# Chat (streaming)
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{"action":"chat","prompt":"Hello","conversationId":"nathan-local-test-001","type":"numa-chat"}'

# Sync agent (document-summariser)
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{"action":"chat","prompt":"Summarize: Testing is important.","conversationId":"nathan-local-test-002","type":"document-summariser"}'
```

#### Step 6: Stop

```bash
docker stop workspace-test
```

### Test UI (Browser-Based)

For interactive testing with a visual interface:

```bash
cd /Users/nathandouglas/arcanum/numa/services
./test-workspace-agent.sh
```

This single command loads the image, gets credentials, starts the container on `:8080` with `LOCAL_DEV=1`, starts a test UI on `:3000`, and opens your browser. Press `Ctrl+C` to stop everything.

### Environment Variables Reference

#### Required (minimum for basic chat)

| Variable                                           | Example Value |
| -------------------------------------------------- | ------------- |
| `AWS_REGION` (or `AWS_REGION_WORKSPACE` in `.env`) | `us-east-1`   |
| `CLIENT_NAME`                                      | `nd-labs`     |
| `CLAUDE_CODE_USE_BEDROCK`                          | `1`           |

#### Storage (workspace persistence)

| Variable              | Pattern                     | Example                |
| --------------------- | --------------------------- | ---------------------- |
| `OUTPUTS_BUCKET_NAME` | `numa-{clientName}-outputs` | `numa-nd-labs-outputs` |
| `DATA_BUCKET_NAME`    | `numa-{clientName}-data`    | `numa-nd-labs-data`    |

#### DynamoDB

| Variable                           | Pattern                                   |
| ---------------------------------- | ----------------------------------------- |
| `DYNAMODB_TABLE_NAME`              | `numa-{clientName}-chat-history`          |
| `WORKSPACE_AGENTS_TABLE`           | `numa-{clientName}-agents`                |
| `USER_AGENTS_TABLE`                | `numa-{clientName}-user-agents`           |
| `CHAT_SETTINGS_TABLE_NAME`         | `numa-{clientName}-chat-settings`         |
| `INTEGRATIONS_APPROVAL_TABLE_NAME` | `numa-{clientName}-integrations-approval` |

#### Lambdas

| Variable                      | Pattern                                  |
| ----------------------------- | ---------------------------------------- |
| `WORKSPACE_TOOLS_LAMBDA_NAME` | `numa-{clientName}_workspace-chat-tools` |
| `PIPEDREAM_RELAY_LAMBDA_ARN`  | Full ARN                                 |
| `EXTRACT_CONTENT_LAMBDA_ARN`  | Full ARN                                 |

#### Feature Flags (env vars)

| Variable           | Purpose                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NUMA_OPS_ENABLED` | Gates `numa ops` (`"1"` or `"true"`): server-side Ops entitlement gate in `numa-cli-api`, and includes the `numa ops` subsection in the system prompt (`build_numa_cli_section(ops_enabled=...)`) |
| `LOG_LEVEL`        | Set to `DEBUG` for live LLM messages                                                                                                                                                              |
| `LOCAL_DEV`        | Set to `1` for CORS and local dev mode                                                                                                                                                            |

#### What works WITHOUT optional variables

- Bedrock model calls (chat, thinking)
- Code execution — the agent writes a Python/Bash script to `/workdir/tmp/` and runs it with the `Bash` tool (no `numa-cli-api`/Lambda needed)
- File operations (Read, Write, Edit, Glob, Grep)
- All agent types and response modes

### Debug Logging

```bash
# Live LLM activity (add -e LOG_LEVEL=DEBUG to docker run)
docker logs -f workspace-test 2>&1 | grep "SDK_LIVE"

# With step context (for pipeline agents like Nolia)
docker logs -f workspace-test 2>&1 | grep "SDK_LIVE" | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line)
        step = d.get('conversation_id','').split('step-')[-1] if 'step-' in d.get('conversation_id','') else '?'
        name = d.get('_name','')
        if name == 'SDK_LIVE_TOOL':
            print(f'[{step}] TOOL: {d.get(\"tool_name\",\"\")}')
        elif name == 'SDK_LIVE_TEXT':
            print(f'[{step}] TEXT: {d.get(\"text\",\"\")[:120]}')
        elif name == 'SDK_LIVE_THINKING':
            print(f'[{step}] THINK: {d.get(\"thinking\",\"\")[:120]}')
    except: pass
"
```

### Expected Local Errors (Safe to Ignore)

```
Failed to get k8s token: No such file or directory
AwsEcsResourceDetector failed: Missing ECS_CONTAINER_METADATA_URI
AwsEksResourceDetector failed: No such file or directory
AwsEc2ResourceDetector failed: <urlopen error timed out>
Exception while exporting Span batch... Connection refused (localhost:4318)
```

These are OpenTelemetry/AWS resource detectors that only work in cloud environments.

### Troubleshooting

| Problem                            | Cause                                                | Fix                                                   |
| ---------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| JSON Parse Error: "Invalid escape" | Bash escaped special characters                      | Use simple prompts without shell metacharacters       |
| Exit Code 1                        | Missing `CLAUDE_CODE_USE_BEDROCK=1` or invalid creds | Check env vars and `aws sts get-caller-identity`      |
| AccessDenied on AssumeRole         | Already assumed into the target role                 | Use `export-credentials` instead of `sts assume-role` |
| S3/DynamoDB Warnings               | Optional env vars not set                            | Expected — basic chat works without them              |
| Container won't start              | Port 8080 in use                                     | `lsof -i :8080` then `docker rm -f workspace-test`    |

### Request Payload Reference

```json
{
  "action": "chat",
  "prompt": "Your message here",
  "conversationId": "nathan-local-test-xxx-001",
  "type": "numa-chat",
  "responseMode": "stream",
  "modelId": "anthropic.claude-sonnet-4-6",
  "attachments": [],
  "timezone": "Pacific/Auckland",
  "userEmail": "test@arcanum.ai",
  "metadata": {},
  "uploadPrefixes": []
}
```

| Field            | Required       | Default                | Description                                                                      |
| ---------------- | -------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `action`         | Yes            | -                      | `chat`, `stop`, `upload`, `upload_complete`, `delete_uploads`, `cleanup_session` |
| `prompt`         | Yes (for chat) | -                      | User message text                                                                |
| `conversationId` | Yes            | -                      | Conversation identifier                                                          |
| `type`           | No             | `numa-chat`            | Agent type ID                                                                    |
| `responseMode`   | No             | From agent type config | `stream`, `sync`, or `fire-and-forget`                                           |
| `modelId`        | No             | Sonnet 4.6             | Bedrock model ID override                                                        |
| `attachments`    | No             | `[]`                   | File attachment metadata                                                         |
| `timezone`       | No             | UTC                    | User timezone for date formatting                                                |
| `metadata`       | No             | `{}`                   | Custom metadata (e.g. Nolia assessment config)                                   |
| `uploadPrefixes` | No             | `[]`                   | S3 prefixes to sync into workspace                                               |

Headers: `x-user-sub` (required), `Content-Type: application/json` (required)

---

## Deployment

### Packaging

```bash
cd /Users/nathandouglas/arcanum/numa/services
./package-service.sh numa-workspace-agent
```

Output: `infra/assets/artifacts/numa-workspace-agent/image.tar`

The script builds with `--platform linux/arm64 --no-cache`, tags with git hash + `latest`, and saves as tar consumed by CDKTF (pushed to ECR via `skopeo`).

### Deploy

1. Build frontend: `cd numa-frontend && yarn build`
2. Package service: `cd services && ./package-service.sh numa-workspace-agent`
3. Package lambdas if changed: `cd lambdas && bash package-python-lambda.sh python/workspace-chat-agent-proxy` (and/or `python/workspace-chat-tools`)
4. Deploy via CDKTF: `cd infra && yarn cdktf deploy --auto-approve <stack-name>`

### Branching

Feature branches -> `dev` (default MR target) -> `main` (release). Full pipeline runs on push to `main`.

---

## Dockerfile Summary

The production image is built on `python:3.13-slim` for ARM64 (Graviton):

- **System packages:** poppler-utils, LibreOffice (writer/calc/impress nogui), WeasyPrint deps, qpdf, Node.js 20 LTS, Pandoc 3.6.1
- **Node packages:** pptxgenjs, sharp (for presentation creation)
- **Claude CLI:** ARM64 binary installed to `/opt/bin/claude`
- **Non-root user:** UID 1000 (`agent`)
- **Workspace:** `/workdir/` with subdirs `.system/.claude`, `chat-workflows`, `uploads`, `outputs`, `tools/numa`
- **Plugins:** `/app/plugins/numa/` (read-only, outside workspace)
- **Tools source:** `/app/tools/` (copied selectively to `/workdir/tools/` at startup)
- **Entrypoint:** `run.sh` which runs `opentelemetry-instrument uvicorn` on port 8080

---

## Common Tasks

### Adding a numa CLI command

The MCP layer is gone — new capabilities are CLI commands, not MCP tools. See the `extending-numa-chat` skill for the full flow. In short:

1. **CLI command** — add a Commander subcommand under `numa-cli/packages/cli/src/commands/actions/<category>.ts` that builds `{tool, params}` and calls `invokeTool()`. Require `-m/--user-message` (the approval/tool-card caption). Route writes through `gateWriteOp()` for HITL. Add typed metadata in `src/metadata/tool-types.ts` + `tool-display.ts`.
2. **Lambda handler** — add a `TOOL_HANDLERS["<tool>"]` entry in `lambdas/python/workspace-chat-tools/tools/` (the default dispatch target). Pure in-workspace computation needs no Lambda — the agent just writes a script to `/workdir/tmp/` and runs it with Bash.
3. **numa-cli-api registry** — only if the tool lives outside `workspace-chat-tools` (anything else defaults there). Add a `registry.ts` entry for `kb_manager` / `oauth_workspace_tools`, and update the gates in `src/tools/index.ts` / `policy.ts` for `ops_*` or per-agent-type restrictions.
4. **Prompt + skill** — teach the agent the command exists: add the category to `build_numa_cli_section()` in `prompts.py` (for a new top-level category) and/or a skill under `plugins/numa/skills/<name>/SKILL.md`. The CLI doesn't self-document schemas the way MCP did.
5. **Agent-type config** — ensure relevant types have `Bash(numa:*)` in `allowed_tools`, and set `allowed_cli_commands` if the category should be restricted per type. Add reference docs via `enabled_numa_tools` / `TOOL_FILE_MAP` if useful.

### Adding a New Skill/Plugin

1. Create a directory under `plugins/numa/skills/<skill-name>/`
2. Add the skill instruction markdown file
3. Skills are discovered automatically by the Claude SDK via the plugins path

### Debugging Conversation Issues

1. Get conversation_id from frontend or logs
2. Query CloudWatch with conversation_id filter
3. Check `STREAM_COMPLETE` for full conversation flow
4. Check `S3_SYNC_*` for file sync issues
5. Read trace.jsonl from S3 for full history

### Adding a New Log

```python
logger.info(
    "Descriptive message",
    _name="YOUR_LOG_NAME",  # SCREAMING_SNAKE_CASE
    phase="appropriate_phase",  # init, request, auth, assistant, sdk, sync, cleanup
    relevant_id=full_id,  # Never truncate IDs
    other_fields=value,
)
```
