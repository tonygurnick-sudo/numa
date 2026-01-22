# Numa Workspace Agent

A containerized AI workspace service powered by the Claude Agent SDK, deployed on AWS Bedrock AgentCore. Provides users with a persistent workspace for file operations, data analysis, document generation, and reusable automation.

---

## Vision: From Chatbot to AI Operating System

Numa Workspace transforms Numa from a stateless AI assistant into a **persistent AI operating system**. Instead of conversations that start fresh every time, users get:

| Traditional Chatbot | Numa Workspace |
|---------------------|----------------|
| Stateless conversations | Persistent workspace across all conversations |
| Limited to tool calls | Full code execution (Python, Bash) |
| Token limits on data | Files stay on disk - process unlimited data |
| Start fresh each time | Skills and documents accumulate value |
| Black box memory | Transparent, editable file-based memory |

### Why This Matters

**For Users:** An AI that remembers, learns, and gets better over time. Create a workflow once, reuse it forever.

**For Business:** Switching costs increase as customers build their automation library. Unlike ChatGPT (stateless), Numa becomes more valuable the longer you use it.

### Core Capabilities

- **Persistent Workspace**: Files in `/chat-workflows/` survive across all conversations
- **Code Execution**: Write and run Python/Bash scripts, not just call predefined tools
- **Skills Library**: Save workflows as reusable scripts
- **Document Management**: Create, version, and maintain business documents
- **Integration Access**: Query knowledge bases, search the web, process files

---

## Key Features

- **Claude Agent SDK**: Native Python SDK integration for AI-powered agentic operations
- **Python Security Hooks**: Async security and audit hooks for workspace protection
- **Persistent Workspace**: Files in `/chat-workflows/` persist across all conversations
- **Per-Conversation Storage**: `/uploads/`, `/session/`, and root files are isolated per conversation
- **S3 Sync**: Automatic sync to S3 for workspace persistence across container restarts
- **Streaming Responses**: Real-time NDJSON streaming for chat responses
- **Skills & Agents**: Plugin system for extending Claude's capabilities

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
│  │  │  chat-workflows/ - Global persistent           │  │  │
│  │  │  uploads/        - Per-conversation            │  │  │
│  │  │  session/        - Per-conversation            │  │  │
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
├── chat-workflows/         # GLOBAL persistent (across all conversations)
├── uploads/                # Per-conversation uploads
├── session/                # Per-conversation session files
├── agent-files/            # Downloaded agent reference files
├── tools/                  # Workspace tools (read-only)
│   └── numa/               # Numa-specific tools
└── (root files)            # Per-conversation (cleared on switch)

/app/plugins/numa/          # Plugins (outside workspace, read-only)
├── .claude-plugin/
│   └── plugin.json         # Plugin manifest
├── skills/                 # Skills (auto-discovered)
│   ├── knowledge-search/
│   ├── web-search/
│   ├── pdf-handling/
│   ├── docx-handling/
│   └── spreadsheet-handling/
└── agents/                 # Agents (auto-discovered)
    └── knowledge-search.md
```

### Persistence Model

| Directory | Persists Across Conversations? | Synced to S3 |
|-----------|-------------------------------|--------------|
| `/workdir/chat-workflows/` | YES - globally persistent | `{user}/chat-workflows/` |
| `/workdir/uploads/` | NO - this conversation only | `{user}/conversations/{id}/uploads/` |
| `/workdir/session/` | NO - this conversation only | `{user}/conversations/{id}/session/` |
| Root files | NO - this conversation only | `{user}/conversations/{id}/` |
| `/workdir/.system/` | NO - internal only | `{user}/conversations/{id}/_system/` |

---

## Skills System

Skills are Claude-readable instructions that teach the AI how to accomplish specific tasks. Located in `/app/plugins/numa/skills/`.

### Available Skills

| Skill | Purpose | When to Use |
|-------|---------|-------------|
| **knowledge-search** | Search company knowledge bases | Finding policies, procedures, company documents |
| **web-search** | Search the internet | Current info, prices, news, external data |
| **pdf-handling** | Create, read, manipulate PDFs | Generating reports, extracting text, merging PDFs |
| **docx-handling** | Create, read, fill Word templates | Filling forms, generating documents from templates |
| **spreadsheet-handling** | Read, write, analyze Excel/CSV/TSV | Data analysis, pivot tables, format conversion |

### Knowledge Search Skill

Search and retrieve from enterprise knowledge bases:

```bash
# Basic KB search
python3 /workdir/tools/numa/knowledge_base.py query \
    --query "annual leave policy" \
    --user-intent "find how many days of leave employees get"

# Query all KBs at once
python3 /workdir/tools/numa/knowledge_base.py query \
    --query "compliance requirements" \
    --user-intent "find all compliance info" \
    --all-kbs

# Detailed research (raw content, not summarized)
python3 /workdir/tools/numa/knowledge_base.py query \
    --query "IT security policies" \
    --user-intent "compile complete security documentation" \
    --no-summarise \
    --max-results 15 \
    --output-file /workdir/session/security_docs.json
```

### Web Search Skill

Search the internet for current information:

```bash
python3 /workdir/tools/numa/web_search.py \
    --query "AWS Lambda pricing 2025" \
    --user-intent "Find current Lambda pricing information"
```

### PDF Handling Skill

Create PDFs with `fpdf2`, read/manipulate with `PyPDF2`:

```python
from fpdf import FPDF

pdf = FPDF()
pdf.add_page()
pdf.set_font("Helvetica", size=16)
pdf.cell(0, 10, text="Report Title", align="C")
pdf.output("/workdir/session/report.pdf")
```

### DOCX Handling Skill

Create and fill Word documents with `python-docx`:

```python
from docx import Document

doc = Document('/workdir/uploads/template.docx')
# Fill template...
doc.save('/workdir/session/filled.docx')
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
pivot.to_excel('/workdir/session/pivot_report.xlsx')
```

---

## Workspace Tools

Python tools available at `/workdir/tools/numa/` for the AI to use:

| Tool | Purpose | Subcommands/Key Parameters |
|------|---------|----------------------------|
| `knowledge_base.py` | Unified KB operations | `query`, `upload`, `download`, `list`, `download-folder` |
| `web_search.py` | Web search with AI synthesis | `--query`, `--user-intent`, `--max-results` |
| `extract_content.py` | Extract text from documents (OCR) | `--file-path` |
| `convert_document.py` | Document format conversion | `--file-path`, `--format`, `--mode`, `--title` |

### Tool Examples

```bash
# Query knowledge base
python3 /workdir/tools/numa/knowledge_base.py query \
    --query "expense policy" \
    --user-intent "find expense limits"

# Download a file from KB
python3 /workdir/tools/numa/knowledge_base.py download \
    --uri "s3://bucket/documents/company/policy.pdf"

# List files in KB
python3 /workdir/tools/numa/knowledge_base.py list \
    --kb-id company --pattern "*.pdf"

# Upload to KB (admin: company, user: their KBs)
python3 /workdir/tools/numa/knowledge_base.py upload \
    --file /workdir/session/report.pdf \
    --kb-id company

# Download folder as zip
python3 /workdir/tools/numa/knowledge_base.py download-folder \
    --kb-id company --folder-path "reports/2024/"

# Web search
python3 /workdir/tools/numa/web_search.py \
    --query "GDPR compliance requirements" \
    --user-intent "understand data protection obligations"

# Extract text from scanned PDF
python3 /workdir/tools/numa/extract_content.py \
    --file-path "/workdir/uploads/scanned_invoice.pdf"

# Convert DOCX to PDF (direct file conversion)
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/uploads/document.docx" \
    --format pdf \
    --mode file

# Convert PDF to DOCX (direct file conversion)
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/uploads/document.pdf" \
    --format docx \
    --mode file

# Convert Markdown to PDF
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/session/report.md" \
    --format pdf

# Convert Markdown to DOCX with title
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/session/report.md" \
    --format docx \
    --title "Quarterly Report"
```

---

## API Reference

### AgentCore Contract Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ping` | GET | Health check (returns `{"status": "Healthy"}`) |
| `/invocations` | POST | Main request handler (action dispatch) |

### Read-Only Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Agent status and capabilities |
| `/files` | GET | List files in `/chat-workflows/` from S3 |
| `/history/{conversation_id}` | GET | Get conversation history from S3 |
| `/trace/{conversation_id}` | GET | Get raw trace.jsonl content |

### Invocation Actions

POST to `/invocations` with JSON body:

#### Chat Action

```json
{
  "action": "chat",
  "conversationId": "uuid",
  "prompt": "Analyze this data...",
  "requestId": "client-generated-or-server-generated", // optional; server will generate if absent
  "timezone": "America/New_York",
  "userEmail": "user@example.com",
  "todayString": "Local date: Monday, 12/9/2024...",
  "availableKBs": [...],
  "attachments": [...]
}
```

**Response**: NDJSON stream of SDK events:

```json
{"type": "session_init", "isNewSession": true, "status": "ready"}
{"type": "user", "message": {...}, "request_id": "..."}
{"type": "assistant", "message": {...}}
{"type": "stream_event", "event": {...}}
{"type": "result", "usage": {...}}
{"type": "completion", "reason": "user_cancelled", "stop_reason": "client_disconnect|user_requested"} // emitted when a stop occurs
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
├── __init__.py
├── main.py           # FastAPI app, endpoints, request routing
├── sdk_config.py     # SDK options, environment vars, tool permissions
├── sdk_runner.py     # Claude Agent SDK execution via query()
├── workspace.py      # Local directory structure management
├── s3_workspace.py   # S3 sync logic (upload/download, session archiving)
├── prompts.py        # System prompts for the AI
├── session.py        # Session management
├── trace_parser.py   # Parse trace.jsonl for history (SDK event format)
├── dynamo.py         # DynamoDB conversation metadata
└── hooks/            # Python async security hooks
    ├── __init__.py
    └── security.py   # PreToolUse/PostToolUse security enforcement
```

### Key Module Responsibilities

| Module | Purpose |
|--------|---------|
| **sdk_config.py** | Builds `ClaudeAgentOptions`, defines allowed/disallowed tools, configures Python hooks |
| **sdk_runner.py** | Uses `query()` for agentic loops, serializes events to NDJSON, streams to client |
| **hooks/security.py** | Blocks `.system/` access, validates paths, blocks dangerous commands, audit logging |
| **workspace.py** | Path helpers, directory management, file listing |
| **s3_workspace.py** | Sync to/from S3, session archiving, conversation switching |

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
│   └── spreadsheet-handling/
│       └── SKILL.md          # Excel, CSV, TSV handling
└── agents/
    └── knowledge-search.md   # Custom knowledge search subagent
```

**Sub-agents**: The workspace uses both custom agents (in `/agents/`) and SDK-provided agents:
- `knowledge-search` (custom) - Multi-document KB research
- `Explore` (SDK-provided) - Discover what files/data exist in workspace
- `general-purpose` (SDK-provided) - Parallel processing of large documents

Plugins are:
- Located outside `/workdir/` so AI cannot modify them
- Auto-discovered by the SDK via `plugins` option in `ClaudeAgentOptions`
- Copied into the container at build time

---

## Frontend Integration

The React frontend connects via `numa-frontend/src/Services/workspaceAgentService.ts`.

### Key Methods

| Method | Purpose |
|--------|---------|
| `streamWorkspaceChat()` | Stream chat with NDJSON events |
| `uploadWorkspaceFile()` | Upload file to conversation |
| `deleteWorkspaceUploads()` | Delete uploaded files |
| `listWorkspaceFiles()` | List persistent workspace files |
| `getWorkspaceConversation()` | Get conversation history |
| `getWorkspaceRawTrace()` | Get raw trace.jsonl |
| `cleanupConversationSession()` | Clean up session files |
| `getWorkspaceAgentStatus()` | Check agent status |
| `isWorkspaceAgentAvailable()` | Ping health check |

### Session Management

The frontend passes the AgentCore session ID header:

```typescript
headers['X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'] = userSub;
```

This ensures the same MicroVM session is reused for a user, providing:
- Session persistence across requests
- Faster response times (no cold start)
- Consistent workspace state

### Event Handling

The frontend handles special session events:
- `session_init` - Cold start notification
- `conversation_switch` - Conversation changed
- `assistant_advice` - AI-generated suggestions

---

## S3 Structure

```
s3://{bucket}/numa-chat/workspace/{user_sub}/
├── chat-workflows/                    # GLOBAL persistent
│   └── analysis.py
└── conversations/{conversation_id}/   # Per-conversation
    ├── uploads/
    │   └── data.xlsx
    ├── session/
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

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_WORKSPACE_ROOT` | `/workdir` | Workspace root directory (AgentCore sets this) |
| `CLAUDE_BIN` | `/opt/bin/claude` | Path to Claude CLI binary (used by SDK) |
| `HOME` | `/workdir/.system` | Home directory (for ~/.claude) |
| `OUTPUTS_BUCKET_NAME` | - | S3 bucket for workspace sync |
| `DYNAMODB_TABLE_NAME` | - | DynamoDB table for conversation metadata |
| `CLIENT_NAME` | `unknown` | Client identifier |
| `AWS_REGION` | `us-east-1` | AWS region for services |
| `ANTHROPIC_MODEL` | `us.anthropic.claude-sonnet-4-*` | Bedrock model ID |
| `MAX_TURNS` | `50` | Maximum agentic turns per request |
| `MAX_THINKING_TOKENS` | `10000` | Max tokens for extended thinking |

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

# Or use the Makefile
make dev
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

## Deployment

The service is deployed via AWS Bedrock AgentCore:

1. Container image pushed to ECR (`numa-{client}-workspace-agent`)
2. AgentCore runtime configured with the image
3. Proxy Lambda routes requests to AgentCore
4. CloudFront distributes the proxy endpoint

### Infrastructure

See these CDKTF constructs in `/infra/constructs/`:
- `workspace-agent-construct.ts` - ECR, AgentCore runtime, IAM roles, log groups
- `workspace-agent-proxy-construct.ts` - Proxy Lambda for HTTP-to-SDK bridge

### Session Lifecycle

- **Idle timeout**: 4 hours
- **Max lifetime**: 8 hours
- Sessions persist across conversations (tied to user_sub)

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "S3 sync failed" | Missing bucket permissions | Check IAM role has S3 read/write access |
| "SDK session not found" | Corrupted session archive | Delete `claude-home.tar.gz` in S3, restart |
| "Tool execution blocked" | Security hook denied | Check if accessing forbidden paths (`.system/`) |
| "Container startup failed" | Missing env vars | Ensure `OUTPUTS_BUCKET_NAME` and `DYNAMODB_TABLE_NAME` are set |
| "Cold start timeout" | Large workspace sync | Reduce files in `chat-workflows/` or increase timeout |
| "NDJSON parse error" | Truncated response | Check CloudFront/Lambda timeout settings |

### Debugging

**View container logs:**
```bash
# CloudWatch log groups
/aws/vendedlogs/bedrock-agentcore/...
```

**Check workspace state:**
```bash
# List files in S3
aws s3 ls s3://{bucket}/numa-chat/workspace/{user_sub}/

# Check conversation trace
aws s3 cp s3://{bucket}/numa-chat/workspace/{user_sub}/conversations/{id}/_system/trace.jsonl -
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

- **Infrastructure**: `/infra/constructs/workspace-agent-*.ts`
- **Frontend Service**: `/numa-frontend/src/Services/workspaceAgentService.ts`
- **Strategic Vision**: `/docs/documentation/numa-workspace-chat/numa-workspace-pitch.md`
- **SDK Event Types**: `/docs/tasks/numa-workspace/sdk-event-types.md`
- **Skill Definitions**: `/services/numa-workspace-agent/plugins/numa/skills/`
