# Numa Workspace Agent

A containerized AI workspace service powered by the Claude Agent SDK, deployed on AWS Bedrock AgentCore. Provides users with a persistent workspace for file operations, data analysis, document generation, and reusable automation.

---

## Vision: From Chatbot to AI Operating System

Numa Workspace transforms Numa from a stateless AI assistant into a **persistent AI operating system**. Instead of conversations that start fresh every time, users get:

| Traditional Chatbot     | Numa Workspace                                |
| ----------------------- | --------------------------------------------- |
| Stateless conversations | Persistent workspace across all conversations |
| Limited to tool calls   | Full code execution (Python, Bash)            |
| Token limits on data    | Files stay on disk - process unlimited data   |
| Start fresh each time   | Skills and documents accumulate value         |
| Black box memory        | Transparent, editable file-based memory       |

### Why This Matters

**For Users:** An AI that remembers, learns, and gets better over time. Create a workflow once, reuse it forever.

**For Business:** Switching costs increase as customers build their automation library. Unlike ChatGPT (stateless), Numa becomes more valuable the longer you use it.

### Core Capabilities

- **Persistent Workspace**: Files in `/chat-workflows/` survive across all conversations (currently disabled in production — see Persistence Model)
- **Code Execution**: Write and run Python/Bash scripts, not just call predefined tools
- **Skills Library**: Save workflows as reusable scripts
- **Document Management**: Create, version, and maintain business documents
- **Integration Access**: Connected SaaS tools (Google Drive, Slack, Jira, etc.) via Pipedream, plus knowledge bases and web search

---

## Key Features

- **Claude Agent SDK**: Native Python SDK integration for AI-powered agentic operations
- **Python Security Hooks**: Async security and audit hooks for workspace protection
- **Persistent Workspace**: Files in `/chat-workflows/` persist across all conversations (currently disabled)
- **Per-Conversation Storage**: `/uploads/`, `/outputs/`, and root files are isolated per conversation
- **S3 Sync**: Automatic sync to S3 for workspace persistence across container restarts
- **Streaming Responses**: Real-time NDJSON streaming for chat responses
- **Skills & Agents**: Plugin system for extending Claude's capabilities
- **Pipedream Integrations**: Connected SaaS tools with human-in-the-loop approval

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentCore MicroVM                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Numa Workspace Agent                     │  │
│  │  ┌─────────────┐    ┌─────────────┐                   │  │
│  │  │  FastAPI    │───▶│ Claude SDK  │                   │  │
│  │  │  (uvicorn)  │    │  (query())  │                   │  │
│  │  └─────────────┘    └─────────────┘                   │  │
│  │         │                  │                          │  │
│  │         ▼                  ▼                          │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │              Workspace (/workdir)               │  │  │
│  │  │  .system/        - Internal (hidden from AI)   │  │  │
│  │  │  chat-workflows/ - Global persistent (disabled)│  │  │
│  │  │  uploads/        - Per-conversation            │  │  │
│  │  │  outputs/        - Per-conversation            │  │  │
│  │  │  tools/          - Workspace tools             │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                                    ▲
         ▼                                    │
    ┌─────────┐                          ┌─────────┐
    │   S3    │◀─────── sync ───────────▶│ DynamoDB│
    │ (files) │                          │ (meta)  │
    └─────────┘                          └─────────┘
```

### Request Flow

```
Browser → CloudFront → Lambda Proxy → AgentCore MicroVM
                                           │
                                           ▼
                                     FastAPI Handler
                                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                          S3 Sync    Claude SDK    DynamoDB
```

---

## Directory Structure

AWS AgentCore sets `LOCAL_WORKSPACE_ROOT=/workdir`, so the workspace is under `/workdir`. The AI uses absolute paths.

```
/workdir/                   # Root IS the workspace (Claude's CWD)
├── .system/                # Hidden from AI (blocked by security hooks)
│   ├── .claude/            # SDK session storage (symlinked as ~/.claude)
│   ├── current_conv.json   # Tracks active conversation ID
│   └── trace.jsonl         # Current conversation trace
├── chat-workflows/         # GLOBAL persistent (currently DISABLED — not synced to S3)
├── uploads/                # Per-conversation uploads
├── outputs/                # Per-conversation output files
├── agent-files/            # Downloaded agent reference files
├── tools/                  # Workspace tools (read-only)
│   ├── numa/               # Numa-specific tools (KB, web search, etc.)
│   └── integrations/       # Auto-synced integration schemas (per-app)
└── (root files)            # Per-conversation (cleared on switch)

/app/plugins/numa/          # Plugins (outside workspace, read-only)
├── .claude-plugin/
│   └── plugin.json         # Plugin manifest
├── skills/                 # Skills (auto-discovered)
│   ├── knowledge-search/
│   ├── web-search/
│   ├── pdf-handling/
│   ├── docx-handling/
│   ├── spreadsheet-handling/
│   ├── data-analysis/
│   ├── integrations/
│   └── agents/
└── agents/                 # Agents (auto-discovered)
    ├── knowledge-search.md
    └── integrations.md
```

### Persistence Model

> **Note:** The `chat-workflows/` global persistence feature is currently **disabled** in production while we evaluate cross-conversation data isolation requirements. The directory structure exists but files are not synced to S3.

| Directory                  | Persists Across Conversations?                | Synced to S3                             |
| -------------------------- | --------------------------------------------- | ---------------------------------------- |
| `/workdir/chat-workflows/` | DISABLED — intended to be globally persistent | `{user}/chat-workflows/` (sync disabled) |
| `/workdir/uploads/`        | NO - this conversation only                   | `{user}/conversations/{id}/uploads/`     |
| `/workdir/outputs/`        | NO - this conversation only                   | `{user}/conversations/{id}/outputs/`     |
| Root files                 | NO - this conversation only                   | `{user}/conversations/{id}/`             |
| `/workdir/.system/`        | NO - internal only                            | `{user}/conversations/{id}/_system/`     |

---

## Skills System

Skills are Claude-readable instructions that teach the AI how to accomplish specific tasks. Located in `/app/plugins/numa/skills/`.

### Available Skills

| Skill                    | Purpose                                | When to Use                                                |
| ------------------------ | -------------------------------------- | ---------------------------------------------------------- |
| **knowledge-search**     | Search company knowledge bases         | Finding policies, procedures, company documents            |
| **web-search**           | Search the internet                    | Current info, prices, news, external data                  |
| **pdf-handling**         | Create, read, manipulate PDFs          | Generating reports, extracting text, merging PDFs          |
| **docx-handling**        | Create, read, fill Word templates      | Filling forms, generating documents from templates         |
| **spreadsheet-handling** | Read, write, analyze Excel/CSV/TSV     | Data analysis, pivot tables, format conversion             |
| **data-analysis**        | Large dataset performance optimization | Large files (50MB+), SQLite conversion, data visualization |
| **integrations**         | Connected SaaS app operations          | Running integration actions, querying connected apps       |
| **agents**               | Numa agent management                  | Creating, listing, updating, configuring custom agents     |

### Knowledge Search Skill

Search and retrieve from enterprise knowledge bases via the `numa files` CLI (run through the Bash tool):

```bash
# Basic KB search
numa files search --query "annual leave policy" -m "Searching for annual leave policy"

# Query all KBs at once
numa files search --query "compliance requirements" --all-kbs -m "Searching all KBs for compliance requirements"
```

### Web Search Skill

Search the internet for current information via the `numa web` CLI:

```bash
numa web search --query "AWS Lambda pricing 2025" -m "Searching for AWS Lambda pricing"
```

### PDF Handling Skill

Create PDFs with `fpdf2`, read/manipulate with `PyPDF2`:

```python
from fpdf import FPDF

pdf = FPDF()
pdf.add_page()
pdf.set_font("Helvetica", size=16)
pdf.cell(0, 10, text="Report Title", align="C")
pdf.output("/workdir/outputs/report.pdf")
```

### DOCX Handling Skill

Create and fill Word documents with `python-docx`:

```python
from docx import Document

doc = Document('/workdir/uploads/template.docx')
# Fill template...
doc.save('/workdir/outputs/filled.docx')
```

### Spreadsheet Handling Skill

Read, write, and analyze spreadsheets with `pandas`, `openpyxl`, and `xlsxwriter`:

```python
import pandas as pd

# Read Excel file
df = pd.read_excel('/workdir/uploads/data.xlsx')

# Analyze data
summary = df.groupby('Department')['Amount'].sum()
print(summary)

# Create pivot table
pivot = pd.pivot_table(df, values='Amount', index='Department', columns='Quarter', aggfunc='sum')
pivot.to_excel('/workdir/outputs/pivot_report.xlsx')
```

---

## Workspace Tools

All Numa platform operations go through the unified **`numa` CLI** — the agent shells out via the Bash tool (`numa <category> <command> ... -m "caption"`). There are **no MCP servers** — the whole `numa`/`integrations`/`connectors`/`vault`/`scripts` MCP layer was deleted (Phase 6) and `sdk_config.py` builds `mcp_servers = {}`. The CLI POSTs `{tool, params, context}` to the `numa-cli-api` Lambda, which routes to the kept Python handlers in `lambdas/python/workspace-chat-tools/tools/`. The files at `/workdir/tools/numa/` are **documentation-only reference cards** for those CLI commands — direct bash execution of them is blocked by security hooks.

| CLI command                  | Purpose                      | Key flags                                  |
| ---------------------------- | ---------------------------- | ------------------------------------------ |
| `numa files search`          | Search knowledge bases       | `--query`, `--kb-id`, `--all-kbs`          |
| `numa files upload`          | Upload file to a KB          | local path, `--kb-id`, `--filename`        |
| `numa files download`        | Download file from KB        | `--uri`, or `--kb-id` + path               |
| `numa files list`            | List files in a KB           | `--kb-id`, `--pattern`                     |
| `numa files download-folder` | Download KB folder as zip    | `--kb-id`, `--folder`                      |
| `numa web search`            | Web search with AI synthesis | `--query`, `--max-results`                 |
| `numa web fetch`             | Fetch a URL                  | `--url`                                    |
| `numa docs extract`          | Extract text from docs (OCR) | file path                                  |
| `numa docs transcribe`       | Transcribe audio/video       | file path                                  |
| `numa docs convert`          | Document format conversion   | file path, `--format`, `--mode`, `--title` |
| `numa agents ...`            | Manage saved Numa agents     | `list`/`show`/`create`/`update`/`delete`   |
| `numa memory ...`            | Manage user memories         | `list`/`show`/`add`/`update`/`delete`      |
| `numa ops ...`               | Numa Ops (gated)             | see `numa ops --help`                      |
| `numa render ...`            | Render artifacts             | see `numa render --help`                   |

Every API-hitting command requires `-m/--user-message` — the user-visible caption shown on the tool card / approval prompt. Discover commands with `numa <category> --help`; compose with `--json | jq ...`.

### Tool Examples

```bash
# Search a knowledge base
numa files search --query "expense policy" -m "Searching KB for expense policy"

# Download a file from KB
numa files download --uri "s3://bucket/documents/company/policy.pdf" -m "Downloading policy document"

# Web search
numa web search --query "GDPR compliance requirements" -m "Researching GDPR compliance"

# Extract text from a scanned PDF
numa docs extract /workdir/uploads/scanned_invoice.pdf -m "Extracting text from scanned invoice"

# Convert DOCX to PDF
numa docs convert /workdir/uploads/document.docx --format pdf --mode file -m "Converting DOCX to PDF"
```

### Tool Access Control

Three enforcement gates govern what a `numa` command can do, all server-side in `numa-cli-api`:

| Gate                              | Source                                            | Scope                          | Controls                                                      |
| --------------------------------- | ------------------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| **`Bash(numa:*)` grant**          | `allowed_tools` on `AgentTypeConfig`              | Per agent type (developer-set) | Whether the type can run the CLI at all                       |
| **Per-agent-type CLI allow-list** | `allowed_cli_commands` + `numa-cli-api/policy.ts` | Per agent type (developer-set) | Which CLI _categories_ are permitted (`None` = all)           |
| **Ops entitlement + HITL**        | `NUMA_OPS_ENABLED` + approval polling             | Per client / per request       | `numa ops` requires the flag; write ops require user approval |

**`Bash(numa:*)` grant:** a type must have `Bash(numa:*)` in `allowed_tools` to reach the platform at all.

**Per-agent-type CLI allow-list:** set `allowed_cli_commands` on the `AgentTypeConfig`. `None` (default) = unrestricted; a list restricts to those categories. It drives the dynamic prompt (only permitted categories are described) AND is enforced server-side in `numa-cli-api` (keyed on `NUMA_AGENT_TYPE`, with a parity test against `policy.ts`):

```python
# Full access (default for numa-chat)
allowed_cli_commands=None

# Docs only (Nolia phases — never touch ops/agents/memory)
allowed_cli_commands=["docs"]
```

**Frontend toggles:** the frontend still sends `enabledTools` in the request body based on user settings; these scope which knowledge bases / capabilities are active for the conversation and are forwarded to `numa-cli-api` as narrowing hints (they can only narrow, never grant). KB operations share the knowledge-base toggle — if the user hasn't enabled a KB, the CLI can't query, upload, download, or list it.

**Ops gate:** `numa ops` commands are blocked unless `NUMA_OPS_ENABLED` is set, both in the system prompt (the `numa ops` subsection is only included when enabled) and as a hard server-side gate in `numa-cli-api`.

---

## numa CLI Identity Model

Inside a MicroVM, the LLM runs `numa <cmd>` (the `@numa/cli` binary) to reach the platform. Each call invokes the `<client>_numa-cli-api` Lambda directly, signed by the workspace IAM role. **That IAM signature proves a real MicroVM is calling — but NOT which user.** Because the LLM controls the workspace role (its credentials are ambient via IMDS), it could invoke `numa-cli-api` directly with any payload. So identity must be **unforgeable**, not asserted.

The rule: **`numa-cli-api` derives the user only from a cryptographically verified token, never from a plaintext `sub`.** The agent supplies that token in `NUMA_IDENTITY_TOKEN` (set per turn in [`main.py`](numa_workspace_agent/main.py) from the proxy's `x-numa-identity-token` header, propagated into the CLI subprocess by [`sdk_config.py`](numa_workspace_agent/sdk_config.py)). It holds one of two verifiable tokens:

| Run type                                               | `NUMA_IDENTITY_TOKEN` is…                                                                | Minted by                    | Verified against   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------- | ------------------ |
| **Interactive chat**                                   | the user's real Cognito **id token**                                                     | Cognito (via the frontend)   | Cognito JWKS       |
| **Non-interactive** (scheduled agents, V2 apps, Nolia) | a short-lived **HS256 service token** (`iss: numa-workspace-proxy`, `aud: numa-cli-api`) | `workspace-chat-agent-proxy` | shared HMAC secret |

Non-interactive runs authenticate to the proxy with `SCHEDULE_RUNNER_SECRET` and carry no user token — so the proxy mints a signed assertion vouching for the run's owner. **The signing secret (`NUMA_CLI_IDENTITY_SECRET`) is shared only between the proxy and `numa-cli-api` and is deliberately never injected into this container** — so the LLM has no path to it and cannot forge a service token. Verification (both paths) lives in [`lambdas/node/numa-cli-api/src/shared/auth.ts`](../../lambdas/node/numa-cli-api/src/shared/auth.ts); the full design note is at [`dev-notes/tasks/numa-cli/identity-model.md`](../../dev-notes/tasks/numa-cli/identity-model.md).

> `NUMA_USER_ID_TOKEN` is a separate variable — it stays the real Cognito id token (interactive only) for Q Business `AssumeRoleWithWebIdentity`, and is **not** the CLI's auth credential.

---

## Integrations (Pipedream Connect)

The workspace agent integrates with external SaaS tools through Pipedream Connect. Integrations are optional — they activate only when users connect apps in the frontend.

### How It Works

```
Frontend (enabledConnections: ["google_drive", "slack"])
    ↓
Workspace Agent (syncs action schemas to /workdir/tools/integrations/)
    ↓ (numa integrations <cmd> via Bash)
numa-cli-api Lambda  →  workspace-chat-tools Lambda (validates access, routes request)
    ↓ (cross-account)
Pipedream Relay Lambda → Pipedream Proxy Lambda
    ↓
Pipedream API (OAuth injected automatically)
```

1. Frontend sends `enabledConnections` array in the chat request
2. Agent builds `external_user_id = "{client_name}_{user_sub}"` for the Pipedream relay
3. Integration action schemas are auto-synced to `/workdir/tools/integrations/{app_slug}/`
4. The agent runs `numa integrations <command>`, which flows through `numa-cli-api` → `workspace-chat-tools` Lambda, which calls the Pipedream relay cross-account

### Integration Commands

Pipedream operations are exposed as `numa integrations` subcommands (the old MCP `run_action` / `configure_props` / `proxy_request` tools, now CLI commands routed through `numa-cli-api` to `workspace-chat-tools/tools/pipedream_integration.py`):

| Operation       | Description                                                                     | Requires Approval? |
| --------------- | ------------------------------------------------------------------------------- | ------------------ |
| run action      | Execute a Pipedream action (e.g., search Google Drive, send Slack message)      | YES                |
| configure props | Get dynamic dropdown options for action props (e.g., list drives, folders)      | NO (read-only)     |
| proxy request   | Make a raw API call through Pipedream's proxy (when no pre-built action exists) | YES                |

Write operations are gated through the CLI's `gateWriteOp()` (HITL) and the `numa-cli-api` approval poll. Run `numa integrations --help` for the exact subcommands and flags.

### Human-in-the-Loop Approval

Actions with side effects (`run_action`, `proxy_request`) require user approval before execution:

- An approval card is shown in the frontend UI with a description of the action
- The user has **3 minutes** to approve or deny
- Approval state is tracked in DynamoDB (`integrations-approval-{account}` table)
- **Auto-approval mode**: Custom agents can set `approval_mode: "auto"` to skip the approval step (`NUMA_APPROVAL_MODE=auto`)

### Schema Management

Integration schemas are managed via diff-based sync on every request:

- **Download**: New integrations get their action schemas downloaded to `/workdir/tools/integrations/{app_slug}/`
- **Remove**: Disabled integrations have their schemas removed from disk
- **Cache**: Already-synced integrations are skipped (just a directory listing — negligible overhead)
- Each app gets an `_index.json` file plus per-action schema JSON files

### Supported Integrations

The following integrations have custom system prompt overrides in `/integration-prompts/`:

| Integration                | Prompt File                     |
| -------------------------- | ------------------------------- |
| Gmail                      | `gmail.md`                      |
| Google Calendar            | `google_calendar.md`            |
| Google Drive               | `google_drive.md`               |
| Jira                       | `jira.md`                       |
| Microsoft Outlook          | `microsoft_outlook.md`          |
| Microsoft Outlook Calendar | `microsoft_outlook_calendar.md` |
| SharePoint                 | `sharepoint.md`                 |
| Slack                      | `slack.md`                      |
| Xero                       | `xero_accounting_api.md`        |

### Results Handling

Integration results are saved to files to avoid flooding the agent's context window:

- Results directory: `/workdir/tmp/integrations-results/` (scratch — synced to S3 for model continuity but hidden from the user's Files UI)
- Each result saved as `{action_key}-{timestamp}.json`
- Large results are truncated in the agent response with a pointer to the full file
- Pipedream file stash uploads (e.g., downloaded files) are automatically saved to the results directory
- Binary proxy responses (base64-encoded) are decoded and saved with appropriate extensions
- The model is instructed to `cp` or `mv` user-facing deliverables into `/workdir/outputs/` so they appear in the Files UI; raw API blobs and intermediate downloads stay in tmp

### Integrations Troubleshooting & Gotchas

> This section should be expanded over time as we discover more issues.

| Issue                     | Cause                                                       | Solution                                                |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| Approval times out (90s)  | User didn't respond to approval card                        | Offer to retry; user needs to be ready to click approve |
| "Integration not enabled" | User hasn't connected the app in frontend                   | User needs to connect via the integrations panel        |
| Schema download fails     | Lambda permissions or `WORKSPACE_TOOLS_LAMBDA_NAME` not set | Check IAM permissions and environment variables         |
| File stash download fails | Transient network issue                                     | Logged as warning; retry the action                     |
| Auto-approval not working | Agent config doesn't have `approval_mode: "auto"`           | Check agent config in DynamoDB agents table             |
| External user ID mismatch | Format must be `{client_name}_{user_sub}`                   | Verify `CLIENT_NAME` env var matches frontend config    |

---

## API Reference

### AgentCore Contract Endpoints

| Endpoint       | Method | Description                                    |
| -------------- | ------ | ---------------------------------------------- |
| `/ping`        | GET    | Health check (returns `{"status": "Healthy"}`) |
| `/invocations` | POST   | Main request handler (action dispatch)         |

### Read-Only Endpoints

| Endpoint                     | Method | Description                              |
| ---------------------------- | ------ | ---------------------------------------- |
| `/status`                    | GET    | Agent status and capabilities            |
| `/files`                     | GET    | List files in `/chat-workflows/` from S3 |
| `/history/{conversation_id}` | GET    | Get conversation history from S3         |
| `/trace/{conversation_id}`   | GET    | Get raw trace.jsonl content              |

### Invocation Actions

POST to `/invocations` with JSON body:

#### Chat Action

```json
{
  "action": "chat",
  "conversationId": "uuid",
  "prompt": "Analyze this data...",
  "requestId": "client-generated-or-server-generated",
  "timezone": "America/New_York",
  "userEmail": "user@example.com",
  "todayString": "Local date: Monday, 12/9/2024...",
  "availableKBs": [],
  "enabledConnections": ["google_drive", "slack"],
  "attachments": []
}
```

**Response**: NDJSON stream of SDK events:

```json
{"type": "session_init", "isNewSession": true, "status": "ready"}
{"type": "user", "message": {...}, "request_id": "..."}
{"type": "assistant", "message": {...}}
{"type": "stream_event", "event": {...}}
{"type": "result", "usage": {...}}
{"type": "completion", "reason": "user_cancelled", "stop_reason": "client_disconnect|user_requested"}
```

#### Stop Action

Interrupt an in-flight chat run while preserving partial output in `trace.jsonl`/S3.

```json
{
  "action": "stop",
  "conversationId": "uuid",
  "requestId": "same-request-id-from-chat"
}
```

**Behavior:**

- Calls Claude Agent SDK `interrupt()` on the active run keyed by `(user_sub, conversationId, requestId)`.
- Emits a terminal `completion` event with `reason: user_cancelled` and syncs workspace to S3.
- Also triggers on client disconnects (SSE closed by the frontend stop button).

#### Upload Action

```json
{
  "action": "upload",
  "conversationId": "uuid",
  "filename": "report.pdf",
  "fileContent": "<base64-encoded-content>"
}
```

#### Delete Uploads Action

```json
{
  "action": "delete_uploads",
  "conversationId": "uuid",
  "paths": ["folder/file.pdf", "doc.txt"]
}
```

#### Cleanup Session Action

```json
{
  "action": "cleanup_session",
  "conversationId": "uuid"
}
```

---

## Module Structure

```
numa_workspace_agent/
├── __init__.py           # Package init, logging setup (structlog + watchtower)
├── main.py               # FastAPI app, endpoints, request routing
├── sdk_config.py         # SDK options, environment vars, tool permissions
├── sdk_runner.py         # Claude Agent SDK execution via query()
├── workspace.py          # Local directory structure management
├── s3_workspace.py       # S3 sync logic (upload/download, session archiving)
├── prompts.py            # System prompts for the AI
├── session.py            # Session management
├── trace_parser.py       # Parse trace.jsonl for history (SDK event format)
├── dynamo.py             # DynamoDB conversation metadata
├── agent_config.py       # Agent config from DynamoDB (workspace + user agents)
├── assistant.py          # Pre-request assistant (Nova 2 Lite skill/tool routing)
├── stream_logger.py      # Stream logging for conversation flow capture
├── hooks/                # Python async security hooks
│   ├── __init__.py
│   └── security.py       # PreToolUse/PostToolUse security enforcement
├── agent_types/           # Agent type configuration system
│   ├── __init__.py
│   ├── base.py            # AgentTypeConfig dataclass, TOOL_FILE_MAP
│   ├── registry.py        # Agent type registration and lookup
│   ├── numa_chat.py       # Default chat agent type (full access)
│   ├── research_agent.py  # Research-focused agent type
│   └── document_summariser.py  # Restricted summariser agent type
└── mcp_tools/            # MCP layer REMOVED (Phase 6) — zero MCP servers
    ├── __init__.py            # Docstring only; the in-process MCP tools are gone
    └── integration_preferences.py  # Surviving pure-Python helper (per-service
                                    #   preferred_method lookup), imported by
                                    #   prompts.py — NOT an MCP tool
```

> Platform capabilities (KB, web, agents, memories, integrations, code execution, vault) are no longer MCP tools. They're reached via the `numa` CLI (Bash) → `numa-cli-api` Lambda → `lambdas/python/workspace-chat-tools/tools/` handlers. Code execution is just a script the agent writes to `/workdir/tmp/` and runs with Bash.

### Key Module Responsibilities

| Module                                   | Purpose                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **sdk_config.py**                        | Builds `ClaudeAgentOptions`, defines allowed/disallowed tools, configures Python hooks                                                                                                                                                                                       |
| **sdk_runner.py**                        | Uses `query()` for agentic loops, serializes events to NDJSON, streams to client                                                                                                                                                                                             |
| **hooks/security.py**                    | Blocks `.system/` access, validates paths, blocks dangerous commands, audit logging                                                                                                                                                                                          |
| **workspace.py**                         | Path helpers, directory management, file listing                                                                                                                                                                                                                             |
| **s3_workspace.py**                      | Sync to/from S3, session archiving, conversation switching                                                                                                                                                                                                                   |
| **agent_config.py**                      | Fetches agent configs from DynamoDB, resolves approval modes for integrations                                                                                                                                                                                                |
| **assistant.py**                         | Pre-request routing via Nova 2 Lite; detects skills needed from message content/file extensions                                                                                                                                                                              |
| **stream_logger.py**                     | Captures full conversation flow (text + tool calls) and logs summary at stream end                                                                                                                                                                                           |
| **mcp_tools/integration_preferences.py** | Surviving non-MCP helper — per-service `preferred_method` lookup, imported by `prompts.py` (the rest of `mcp_tools/` was deleted in Phase 6)                                                                                                                                 |
| **`numa` CLI → `numa-cli-api`**          | Platform tools (KB, web, agents, memories, integrations, ops, render) now run as `numa <category> <command>` Bash calls dispatched server-side to `workspace-chat-tools/tools/` — no in-process MCP. Code execution is a script written to `/workdir/tmp/` and run with Bash |

---

## Plugin System

Plugins provide skills and agents that extend Claude's capabilities:

```
/app/plugins/numa/
├── .claude-plugin/
│   └── plugin.json           # {"name": "numa-workspace", "version": "1.0.0"}
├── skills/
│   ├── knowledge-search/
│   │   └── SKILL.md          # Knowledge base query skill
│   ├── web-search/
│   │   └── SKILL.md          # Web search skill
│   ├── pdf-handling/
│   │   └── SKILL.md          # PDF creation and manipulation
│   ├── docx-handling/
│   │   └── SKILL.md          # Word document handling
│   ├── spreadsheet-handling/
│   │   └── SKILL.md          # Excel, CSV, TSV handling
│   ├── data-analysis/
│   │   └── SKILL.md          # Large dataset optimization
│   ├── integrations/
│   │   └── SKILL.md          # Connected SaaS app operations
│   └── agents/
│       └── SKILL.md          # Agent management
└── agents/
    ├── knowledge-search.md   # Custom knowledge search subagent
    └── integrations.md       # Integration helper subagent
```

**Sub-agents**: The workspace uses both custom agents (in `/agents/`) and SDK-provided agents:

- `knowledge-search` (custom) - Multi-document KB research
- `integrations` (custom) - Integration helper
- `Explore` (SDK-provided) - Discover what files/data exist in workspace
- `general-purpose` (SDK-provided) - Parallel processing of large documents

Plugins are:

- Located outside `/workdir/` so AI cannot modify them
- Auto-discovered by the SDK via `plugins` option in `ClaudeAgentOptions`
- Copied into the container at build time

---

## Frontend Integration

The React frontend connects via `numa-frontend/src/Services/workspaceChatAgentService.ts`.

### Key Methods

| Method                            | Purpose                         |
| --------------------------------- | ------------------------------- |
| `streamWorkspaceChatAgent()`      | Stream chat with NDJSON events  |
| `uploadWorkspaceChatFile()`       | Upload file to conversation     |
| `deleteWorkspaceChatUploads()`    | Delete uploaded files           |
| `listWorkspaceChatFiles()`        | List persistent workspace files |
| `getWorkspaceChatConversation()`  | Get conversation history        |
| `getWorkspaceChatRawTrace()`      | Get raw trace.jsonl             |
| `cleanupConversationSession()`    | Clean up output files           |
| `stopWorkspaceChatAgent()`        | Stop an in-flight request       |
| `isWorkspaceChatAgentAvailable()` | Ping health check               |

### Session Management

Session routing is handled by the **proxy Lambda**, not the frontend. The proxy extracts the `conversationId` from the request body and maps it to an AgentCore session ID (`conv-{conversationId}-{imageTag}`, see [Image versioning & session rotation](#image-versioning--session-rotation)). Each conversation gets its own MicroVM.

The frontend simply sends authenticated requests with a `conversationId` — no session headers needed.

### Event Handling

The frontend handles special session events:

- `session_init` - Cold start notification
- `conversation_switch` - Conversation changed
- `assistant_advice` - AI-generated suggestions

---

## S3 Structure

```
s3://{bucket}/numa-chat/workspace/{user_sub}/
├── chat-workflows/                    # GLOBAL persistent (sync currently DISABLED)
└── conversations/{conversation_id}/   # Per-conversation
    ├── uploads/
    │   └── data.xlsx
    ├── outputs/
    │   └── temp.csv
    ├── report.csv                     # Root-level file
    └── _system/
        ├── trace.jsonl                # Conversation trace
        └── claude-home.tar.gz         # SDK session archive
```

---

## Container Setup

### Dockerfile Highlights

The container:

1. Uses Python 3.13-slim on ARM64 (required for AgentCore Graviton)
2. Installs Claude CLI from official distribution (used by SDK internally)
3. Creates workspace directories under `/workdir`
4. Copies plugins to `/app/plugins/numa/` (outside workspace for security)
5. Runs as non-root `agent` user (UID 1000)
6. Sets `HOME=/workdir/.system` so `~/.claude` resolves correctly

### Environment Variables

| Variable                           | Default                          | Description                                       |
| ---------------------------------- | -------------------------------- | ------------------------------------------------- |
| `LOCAL_WORKSPACE_ROOT`             | `/workdir`                       | Workspace root directory (AgentCore sets this)    |
| `CLAUDE_BIN`                       | `/opt/bin/claude`                | Path to Claude CLI binary (used by SDK)           |
| `HOME`                             | `/workdir/.system`               | Home directory (for ~/.claude)                    |
| `OUTPUTS_BUCKET_NAME`              | -                                | S3 bucket for workspace sync                      |
| `DYNAMODB_TABLE_NAME`              | -                                | DynamoDB table for conversation metadata          |
| `CLIENT_NAME`                      | `unknown`                        | Client identifier                                 |
| `AWS_REGION`                       | `us-east-1`                      | AWS region for services                           |
| `ANTHROPIC_MODEL`                  | `us.anthropic.claude-sonnet-4-*` | Bedrock model ID                                  |
| `MAX_TURNS`                        | `50`                             | Maximum agentic turns per request                 |
| `MAX_THINKING_TOKENS`              | `10000`                          | Max tokens for extended thinking                  |
| `CLOUDWATCH_LOG_GROUP`             | -                                | CloudWatch log group for watchtower               |
| `WORKSPACE_TOOLS_LAMBDA_NAME`      | -                                | Lambda for KB queries, integrations, file ops     |
| `WORKSPACE_TOOLS_LAMBDA_ARN`       | -                                | ARN for IAM invoke permission                     |
| `IOT_TOPIC_PREFIX`                 | -                                | IoT topic prefix for real-time streaming          |
| `WORKSPACE_AGENTS_TABLE`           | -                                | DynamoDB table for workspace agents               |
| `USER_AGENTS_TABLE`                | -                                | DynamoDB table for user agents                    |
| `INTEGRATIONS_APPROVAL_TABLE_NAME` | -                                | DynamoDB table for integration approval flow      |
| `CHAT_SETTINGS_TABLE_NAME`         | -                                | DynamoDB table for user approval mode preferences |

### Entrypoint (run.sh)

```bash
#!/bin/bash
set -e
exec opentelemetry-instrument uvicorn numa_workspace_agent.main:app \
    --host 0.0.0.0 \
    --port 8080 \
    --log-level info
```

The entrypoint uses OpenTelemetry auto-instrumentation for AgentCore observability.

---

## Security

### Security Model

- **Path Isolation**: AI cannot access `/workdir/.system/` (blocked by Python security hooks)
- **Tool Validation**: All tool invocations validated by `security_hook` before execution
- **Sandboxed Execution**: Dangerous bash commands whitelisted only
- **Directory Traversal Prevention**: Path normalization prevents `../` attacks
- **Plugin Protection**: Plugins stored outside workspace (AI cannot modify its own capabilities)
- **Non-root Execution**: Container runs as UID 1000
- **User Isolation**: S3 paths isolated per user (`{user_sub}/...`)
- **Audit Trail**: All tool usage logged

### Security Hook Flow

```
Tool Request → PreToolUse Hook → security_hook() → Allow/Deny
                              → audit_hook() → Log

Tool Result → PostToolUse Hook → audit_hook() → Log
```

### Blocked Paths

- `/workdir/.system/` and all subdirectories
- `secrets/`, `.env`, `credentials` files
- Any path that normalizes outside `/workdir/`

---

## Development

### Prerequisites

- Python 3.13+
- Poetry
- Docker (for building container)
- AWS credentials (for S3/DynamoDB access)

### Local Development

```bash
# Navigate to the service
cd services/numa-workspace-agent

# Install dependencies
poetry install

# Run locally (requires AWS credentials)
poetry run uvicorn numa_workspace_agent.main:app --reload --port 8080
```

### Building the Container

```bash
# Build for ARM64 (required for AgentCore Graviton)
docker build --platform linux/arm64 -t numa-workspace-agent .

# Run locally
docker run -p 8080:8080 \
  -e OUTPUTS_BUCKET_NAME=your-bucket \
  -e DYNAMODB_TABLE_NAME=your-table \
  -e AWS_ACCESS_KEY_ID=... \
  -e AWS_SECRET_ACCESS_KEY=... \
  numa-workspace-agent
```

### Testing

```bash
# Health check
curl http://localhost:8080/ping

# Status check
curl http://localhost:8080/status

# Chat request
curl -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: test-user-id" \
  -d '{"action": "chat", "conversationId": "test-conv", "prompt": "Hello"}'
```

### Running Tests

```bash
cd services/numa-workspace-agent
poetry run pytest
```

---

## Packaging & Deployment

### Packaging the Container Image

**Prerequisites:**

- Docker Desktop must be **running** (the script uses `docker buildx` for ARM64 cross-compilation)
- Run from the `services/` directory

**Steps:**

```bash
cd services
./package-service.sh numa-workspace-agent
```

This script:

- Creates a `docker buildx` builder configured for **ARM64** (AgentCore runs on Graviton)
- Builds the Docker image with `--platform linux/arm64 --no-cache`
- Tags with git hash + `latest`
- **Output:** `infra/assets/artifacts/numa-workspace-agent/image.tar`

### Deploying via CDKTF

After packaging, deploy using the standard CDKTF flow:

```bash
cd infra
yarn cdktf deploy --auto-approve numa-{CLIENT_NAME}
```

The client stack handles:

- Pushing the image tar to ECR via `skopeo` (chain assume: deployer -> client role)
- Configuring the AgentCore runtime with the new image
- Setting up the proxy Lambda, IAM roles, and CloudWatch log groups
- Wiring all environment variables (bucket names, DynamoDB tables, model IDs)

### CI/CD (GitLab)

On pushes to `main`, the pipeline handles everything automatically:

1. **`workspace-agent-package`** stage: Builds ARM64 image via Docker-in-Docker + QEMU
2. **`deploy`** stage: Deploys via CDKTF to configured client stacks

No manual steps needed for production — just push to `main`.

### Infrastructure Constructs

See `/infra/constructs/`:

- `workspace-chat-agent-construct.ts` - ECR, AgentCore runtime, IAM, vendedlogs log group
- `workspace-chat-agent-proxy-construct.ts` - Proxy Lambda (HTTP-to-AgentCore SDK bridge)
- `workspace-chat-tools-construct.ts` - Support Lambda for KB queries, integrations, file ops

### Session Lifecycle

- **Idle timeout:** 30 min (Nolia clients: 3 hr — long fire-and-forget pipelines, see NUMA-1209)
- **Max lifetime:** 4 hours
- **Scoping:** Per-conversation (`conv-{conversationId}-{imageTag}`) — each conversation gets its own MicroVM
- **Deploy behavior:** the image tag in the session ID changes on every deploy, so every conversation rotates onto the new image on its next request (see below) — not just new conversations

#### Image versioning & session rotation

AgentCore **pins a session ID to the runtime image version that was DEFAULT when the session was first created.** That binding survives the MicroVM being idle-recycled — it lives until the session's _max lifetime_ (4 hr), not just the idle timeout. So without intervention, a conversation resumed within 4 hr of starting keeps running the **old** image even after a deploy and even after going cold (fresh MicroVM, old image). Warmth is irrelevant; the session→version binding is what governs which image you get.

To make a deploy take effect promptly, the proxy appends a **deploy-generation token** to the session ID:

```
conv-{conversationId}-{imageTag}
```

`imageTag` is the content hash of the deployed image (`WorkspaceChatAgentConstruct.imageTag`, the first 12 chars of the image tar's SHA256), injected into the proxy Lambda as the `WORKSPACE_IMAGE_GENERATION` env var. Because the tag changes on every image deploy:

- After a deploy, each conversation's **next request** produces a new session ID → binds to the new DEFAULT version → runs the new image. Cold or warm, it rotates.
- This is **deploy-triggered, not time-triggered** — with no deploy, nothing rotates and warm sessions stay cheap.
- It applies uniformly to **chat, scheduled agents, and V2 apps**, because all three build their session ID via the proxy's `build_session_id()`. (The separate `public-demo-proxy` uses its own `public-{conversationId}` format and is unaffected.)

Safe because the session ID is a pure routing/isolation token — nothing parses it back. `conversation_id` is recovered from the request body and `user_sub` from the `x-user-sub` header, never from the session ID. Persisted workspace state is keyed by `conversation_id` in S3, so a rotated session rehydrates the same `/workdir`; only ephemeral in-VM state is lost on the one-time cold start. **Backwards compatible:** if `WORKSPACE_IMAGE_GENERATION` is unset, the session ID falls back to the legacy `conv-{conversationId}`.

> One-time cost: the deploy that first introduces the env var (or any later image deploy) rotates every in-flight conversation once — a single cold-start blip on the next request, mid-conversation if the user is active. State rehydrates from S3, so nothing is lost. This is inherent to refreshing a running MicroVM's image.

---

## CloudWatch Logs & Debugging

### Log Groups

The workspace agent writes to three CloudWatch log groups:

| Log Group                                                            | Source                     | Contents                                             |
| -------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------- |
| `/aws/vendedlogs/bedrock-agentcore/numa-{clientName}-workspace-chat` | AgentCore APPLICATION_LOGS | AgentCore-captured stdout from the container         |
| `/numa/{clientName}/workspace-chat-agent`                            | watchtower (direct)        | Structured JSON logs from the Python application     |
| `/aws/lambda/{clientName}-workspace-chat-agent-proxy`                | Proxy Lambda               | Request routing, JWT validation, AgentCore SDK calls |

For most debugging, use the **container logs** (`/numa/{clientName}/workspace-chat-agent`) — they contain the richest structured data.

### Log Structure

All application logs are structured JSON with consistent fields:

| Field             | Description                           | Example                                                                              |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `_name`           | Log event identifier (primary filter) | `"CHAT_REQUEST"`, `"SDK_COMPLETE"`                                                   |
| `phase`           | Execution phase                       | `init`, `auth`, `request`, `sdk`, `assistant`, `migration`, `integrations`, `upload` |
| `conversation_id` | Conversation UUID                     | `"a1b2c3d4-..."`                                                                     |
| `user_sub`        | Cognito user sub                      | `"abc123-..."`                                                                       |
| `level`           | Log level                             | `info`, `warning`, `error`                                                           |

### Key Log Events

| `_name`                      | Phase        | Description                                                                    |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------ |
| `REQUEST_RECEIVED`           | request      | New request received (includes action, httpMethod, httpPath)                   |
| `CHAT_REQUEST`               | request      | Chat action started (includes prompt_length, model_id, is_cold_start)          |
| `SDK_START`                  | sdk          | Claude SDK invocation began                                                    |
| `SDK_RESULT`                 | sdk          | SDK result message received (includes usage/tokens)                            |
| `SDK_COMPLETE`               | sdk          | SDK execution finished (includes duration)                                     |
| `STREAM_COMPLETE`            | sdk          | Full stream summary with conversation_flow array, token counts, cost           |
| `COST`                       | sdk          | Dedicated cost/token log (total_cost_usd, input/output/cache tokens, duration) |
| `TOOL_USE_BLOCK_NAME`        | sdk          | Tool invocation tracked (tool_name field)                                      |
| `ASSISTANT_ADVICE`           | assistant    | Pre-request assistant generated skill/tool recommendations                     |
| `AGENT_CONFIG_APPLIED`       | request      | Custom agent loaded from DynamoDB                                              |
| `AUTH_FAILED`                | auth         | User identification failed from all sources                                    |
| `AUTH_JWT_ERROR`             | auth         | JWT token extraction/decode failed                                             |
| `S3_SYNC_UPLOAD`             | request      | Files synced to S3 after request (files_uploaded, total_bytes)                 |
| `S3_SYNC_DOWNLOAD`           | request      | Files downloaded from S3 on cold start (files_downloaded)                      |
| `SESSION_RESTORED`           | sdk          | Claude SDK session archive restored from S3                                    |
| `SESSION_ARCHIVED`           | sdk          | Claude SDK session archived to S3                                              |
| `INTEGRATION_TOOL_INVOKE`    | integrations | Integration tool call via Pipedream proxy (tool_name field)                    |
| `INTEGRATION_SCHEMAS_SYNCED` | integrations | Integration schemas downloaded/removed (added, removed, cached)                |
| `STOP_REQUEST`               | request      | User cancelled an in-flight request                                            |
| `UPLOAD_COMPLETE`            | upload       | File upload completed                                                          |
| `CONVERSATION_META_UPDATED`  | request      | DynamoDB conversation metadata saved                                           |
| `V1_MIGRATION_CHECK`         | migration    | Checked for V1 conversation history to migrate                                 |

### Running CloudWatch Queries

Use the AWS CLI with `AWS_PROFILE=q-demo` to query logs:

```bash
# Start a query (returns a query ID)
AWS_PROFILE=q-demo aws logs start-query \
  --log-group-name "/numa/{clientName}/workspace-chat-agent" \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, _name | filter _name = "COST" | sort @timestamp desc | limit 20'

# Get results (use the query ID from the previous command)
AWS_PROFILE=q-demo aws logs get-query-results --query-id "QUERY_ID_HERE"
```

> **Tip:** `date -v-1H +%s` gives Unix timestamp for 1 hour ago (macOS). Use `date -d '1 hour ago' +%s` on Linux. Adjust `-v-1H` to `-v-24H` for last 24 hours, `-v-7d` for last week, etc.

### CloudWatch Insights Queries

Copy these into the CloudWatch Insights console or use via CLI as shown above.

**Find all requests for a specific user:**

```
fields @timestamp, _name, conversation_id, @message
| filter user_sub = "USER_SUB_HERE"
| filter _name = "CHAT_REQUEST"
| sort @timestamp desc
| limit 50
```

**Track costs and token usage (recent):**

```
fields @timestamp, user_sub, conversation_id, total_cost_usd, input_tokens, output_tokens, cache_read_tokens, num_turns, duration_ms
| filter _name = "COST"
| sort @timestamp desc
| limit 100
```

**Aggregate cost by user:**

```
fields user_sub, total_cost_usd, input_tokens, output_tokens
| filter _name = "COST"
| stats sum(total_cost_usd) as total_cost, sum(input_tokens) as total_input, sum(output_tokens) as total_output, count() as request_count by user_sub
| sort total_cost desc
```

**Find errors:**

```
fields @timestamp, _name, phase, error, @message
| filter level = "error" or level = "ERROR"
| sort @timestamp desc
| limit 50
```

**View full conversation flow for a specific request:**

```
fields @timestamp, conversation_flow, total_cost_usd, num_turns, input_tokens, output_tokens, duration_ms
| filter _name = "STREAM_COMPLETE"
| filter conversation_id = "CONVERSATION_ID_HERE"
| sort @timestamp desc
| limit 10
```

**Track tool usage patterns:**

```
fields @timestamp, tool_name, conversation_id, user_sub
| filter _name = "TOOL_USE_BLOCK_NAME"
| stats count() as usage_count by tool_name
| sort usage_count desc
```

**Monitor cold starts and session lifecycle:**

```
fields @timestamp, _name, conversation_id, user_sub
| filter _name in ["SESSION_RESTORED", "SESSION_ARCHIVED", "S3_SYNC_DOWNLOAD"]
| sort @timestamp desc
| limit 50
```

**Debug authentication failures:**

```
fields @timestamp, _name, phase, error, @message
| filter _name in ["AUTH_FAILED", "AUTH_JWT_ERROR"]
| sort @timestamp desc
| limit 20
```

**Monitor S3 sync performance:**

```
fields @timestamp, _name, files_uploaded, files_downloaded, total_bytes, errors
| filter _name in ["S3_SYNC_UPLOAD", "S3_SYNC_DOWNLOAD"]
| sort @timestamp desc
| limit 50
```

**Integration tool invocations:**

```
fields @timestamp, tool_name, conversation_id, user_sub
| filter _name = "INTEGRATION_TOOL_INVOKE"
| sort @timestamp desc
| limit 50
```

**Integration schema sync events:**

```
fields @timestamp, added, removed, cached
| filter _name = "INTEGRATION_SCHEMAS_SYNCED"
| sort @timestamp desc
| limit 30
```

---

## Troubleshooting

### Common Issues

| Issue                      | Cause                      | Solution                                                       |
| -------------------------- | -------------------------- | -------------------------------------------------------------- |
| "S3 sync failed"           | Missing bucket permissions | Check IAM role has S3 read/write access                        |
| "SDK session not found"    | Corrupted session archive  | Delete `claude-home.tar.gz` in S3, restart                     |
| "Tool execution blocked"   | Security hook denied       | Check if accessing forbidden paths (`.system/`)                |
| "Container startup failed" | Missing env vars           | Ensure `OUTPUTS_BUCKET_NAME` and `DYNAMODB_TABLE_NAME` are set |
| "Cold start timeout"       | Large workspace sync       | Reduce files in workspace or increase timeout                  |
| "NDJSON parse error"       | Truncated response         | Check CloudFront/Lambda timeout settings                       |

### Debugging

**View container logs:**

```bash
# Use the container log group for richest data
AWS_PROFILE=q-demo aws logs tail "/numa/{clientName}/workspace-chat-agent" --follow

# Or the proxy Lambda logs
AWS_PROFILE=q-demo aws logs tail "/aws/lambda/{clientName}-workspace-chat-agent-proxy" --follow
```

**Check workspace state:**

```bash
# List files in S3
AWS_PROFILE=q-demo aws s3 ls s3://{bucket}/numa-chat/workspace/{user_sub}/

# Check conversation trace
AWS_PROFILE=q-demo aws s3 cp s3://{bucket}/numa-chat/workspace/{user_sub}/conversations/{id}/_system/trace.jsonl -
```

**Local debugging:**

```bash
# Run with debug logging
LOG_LEVEL=DEBUG poetry run uvicorn numa_workspace_agent.main:app --reload --port 8080
```

---

## SDK Event Types

The agent streams NDJSON events to the frontend. See `docs/tasks/numa-workspace/sdk-event-types.md` for detailed documentation.

Key event types:

- `session_init` - Session initialization info
- `user` - User message with prompt
- `assistant` - Claude response with text, thinking, tool use
- `system` - SDK initialization and session info
- `result` - Completion summary with usage and cost
- `error` - Error events

---

## Related Resources

- **Infrastructure**: `/infra/constructs/workspace-chat-agent-*.ts`
- **Frontend Service**: `/numa-frontend/src/Services/workspaceChatAgentService.ts`
- **Proxy Lambda**: `/lambdas/python/workspace-chat-agent-proxy/`
- **Tools Lambda**: `/lambdas/python/workspace-chat-tools/`
- **Strategic Vision**: `/docs/documentation/numa-workspace-chat/numa-workspace-pitch.md`
- **SDK Event Types**: `/docs/tasks/numa-workspace/sdk-event-types.md`
- **Skill Definitions**: `/services/numa-workspace-agent/plugins/numa/skills/`
- **Integration Prompts**: `/services/numa-workspace-agent/integration-prompts/`
