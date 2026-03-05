---
name: numa-workspace-agent-skill
description: Context for the Numa Workspace Agent service (numa-workspace-agent). Use when working on workspace agent code, debugging issues, adding features, or understanding how the workspace chat streaming works. Covers architecture, tools, logging, trace parsing, and CloudWatch querying.
---

# Numa Workspace Agent Service

## Overview

The `numa-workspace-agent` is a FastAPI application that powers Numa's workspace chat experience. It runs on AWS Bedrock AgentCore and uses the Claude Agent SDK for AI capabilities. Unlike the Lambda-based `numa-chat-agent`, this agent has persistent file system access and runs in a MicroVM container.

**Location:** `services/numa-workspace-agent/`

## Architecture Flow

```
User Message
    ↓
Frontend (NumaWorkspaceChatAgents.tsx)
    ↓
workspace-agent-proxy Lambda (routes to AgentCore)
    ↓
AgentCore MicroVM Container
    ↓
FastAPI App (main.py)
    ↓
┌─────────────────────────────────────────┐
│  Pre-Request Assistant (Nova 2 Lite)    │
│  - Analyzes user message                │
│  - Provides hints via <numa-assistant>  │
│  - Fast regex pattern matching          │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  Claude SDK Runner (sdk_runner.py)      │
│  - Streams SDK message types            │
│  - Writes to trace.jsonl                │
│  - Handles tool calls via hooks         │
└─────────────────────────────────────────┘
    ↓
S3 Sync (workspace files + trace archive)
    ↓
SSE Stream back to Frontend
```

## Key Modules

### main.py - FastAPI Application

**Endpoints:**

| Endpoint                     | Method | Purpose                                 |
| ---------------------------- | ------ | --------------------------------------- |
| `/ping`                      | GET    | AgentCore health check                  |
| `/invocations`               | POST   | Main request handler (routes by action) |
| `/history/{conversation_id}` | GET    | Fetch conversation history from S3      |
| `/trace/{conversation_id}`   | GET    | Raw trace.jsonl content                 |
| `/files`                     | GET    | List workspace files                    |
| `/status`                    | GET    | Agent status and capabilities           |

**Actions (via /invocations):**

- `chat` - Main chat streaming
- `upload` - Upload file to workspace
- `delete_uploads` - Remove staged files
- `cleanup_session` - Clear output files

### assistant.py - Pre-Request Assistant

Fast pre-processing layer that runs before Claude:

1. **Regex Hints** - Pattern matching for common requests:
   - Document generation → Use inline streaming `<!--BEGIN_DOC-->`
   - PDF/DOCX handling → Activate appropriate skill
   - Knowledge base queries → Activate knowledge-search skill
   - Web search requests → Activate web-search skill

2. **Nova 2 Lite Model** - Fast LLM analysis:
   - Analyzes user intent and workspace context
   - Provides directive recommendations to Claude
   - Wrapped in `<numa-assistant>...</numa-assistant>` tags
   - Claude sees this but user does not

### sdk_runner.py - Claude SDK Execution

Handles Claude Agent SDK streaming:

1. **Session Management:**
   - Restores session from S3 on cold start/conversation switch
   - Captures and stores session_id for resumption
   - Archives session to S3 after each request

2. **Message Serialization:**
   - Converts SDK message types (AssistantMessage, UserMessage, SystemMessage, ResultMessage)
   - Writes to trace.jsonl in NDJSON format
   - Yields SSE events to frontend

3. **Hooks:**
   - Security hooks in `hooks/security.py` control tool access
   - Subagent limit (max 2 concurrent)
   - Path validation for file operations

### prompts.py - System Prompts

Two-part system prompt:

1. **NUMA_BASE_SYSTEM_PROMPT** - Core Numa personality and capabilities
2. **WORKSPACE_SYSTEM_PROMPT** - Workspace-specific instructions

Key prompt sections:

- Identity override (Numa, not Claude)
- Workspace directory structure (`/workdir/` paths)
- Document generation (inline streaming vs file creation)
- Available tools and skills
- Security restrictions

### trace_parser.py - Conversation History

Parses trace.jsonl for conversation display:

```python
# Parse trace file to messages for frontend
messages = parse_trace_to_messages(trace_path)
# Or from S3 content directly
messages = parse_trace_content_to_messages(trace_content)
```

Handles:

- User messages (type="user")
- Assistant messages with partial merging (type="assistant")
- Tool use and tool results
- Thinking blocks
- Session ID extraction

### s3_workspace.py - Workspace Persistence

S3 sync operations for workspace files:

**Key Functions:**

- `sync_from_s3()` - Download workspace on cold start
- `sync_to_s3()` - Upload changed files after request
- `sync_conversation_switch()` - Archive old + restore new conversation
- `restore_claude_session()` / `archive_claude_session()` - SDK session state

**S3 Paths:**

```
s3://{outputs_bucket}/workspaces/{user_sub}/{conversation_id}/
├── .system/          # Claude SDK session state
├── outputs/          # Per-conversation output files
├── uploads/          # User uploaded files
├── chat-workflows/   # Persistent scripts (user-level, not conversation)
└── trace.jsonl       # Conversation history
```

## Tools (via `mcp__numa__numa_tool` MCP)

All Numa tool operations go through the unified `mcp__numa__numa_tool` MCP tool.
The files at `/workdir/tools/numa/` are **documentation-only reference cards** — direct bash execution is blocked by security hooks.

| MCP Tool Name                                                  | Purpose                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `query_knowledge_base`                                         | Search knowledge bases                                   |
| `kb_upload` / `kb_download` / `kb_list` / `kb_download_folder` | KB file operations                                       |
| `web_search`                                                   | Internet search via Lambda proxy                         |
| `extract_content`                                              | AI-powered content extraction (OCR, transcription)       |
| `convert_document`                                             | Document format conversion (DOCX↔PDF, Markdown→PDF/DOCX) |
| `agents`                                                       | Manage saved Numa agents                                 |
| `memories`                                                     | Manage user memories                                     |

**Implementation:** `numa_workspace_agent/mcp_tools/numa_tool.py` (unified dispatcher)
and `numa_workspace_agent/mcp_tools/lambda_client.py` (shared Lambda invocation client).

## Credential Isolation (Cross-Account Bedrock)

When using cross-account Bedrock credentials, local services (Lambda, S3) need local credentials:

**Environment Variables:**

- `AWS_*` - Cross-account Bedrock credentials
- `NUMA_LOCAL_AWS_*` - Local account credentials for Lambda/S3 calls

**Implementation:** `numa_workspace_agent/mcp_tools/lambda_client.py` uses `NUMA_LOCAL_AWS_*` env vars to create boto3 clients that target the local account.

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

| `_name`                     | Description                                   |
| --------------------------- | --------------------------------------------- |
| `REQUEST_RECEIVED`          | Incoming request via proxy                    |
| `INVOCATION`                | Action dispatch (chat, upload, etc.)          |
| `CHAT_REQUEST`              | Chat action started                           |
| `KB_LISTINGS`               | KB file listings fetched (not cached)         |
| `ASSISTANT_ADVICE`          | Pre-Numa assistant hint generated             |
| `SDK_START`                 | Claude SDK execution starting                 |
| `SDK_RESULT`                | SDK completion summary                        |
| `SDK_COMPLETE`              | Full SDK stream finished                      |
| `STREAM_COMPLETE`           | Verbose stream summary with conversation flow |
| `COST`                      | Dedicated cost log for aggregation            |
| `S3_SYNC_DOWNLOAD`          | Files downloaded from S3                      |
| `S3_SYNC_UPLOAD`            | Files uploaded to S3                          |
| `CONVERSATION_META_UPDATED` | DynamoDB meta record updated                  |

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

# DEBUG for internal details
logger.debug(
    "Restored session_id from S3",
    phase="init",
    session_id=session_id,
)
```

---

## CloudWatch Logs Insights Queries

**Log Group:** `/numa/{client}/workspace-chat-agent`
**Log Stream:** `{client}/numa-chat-workspace-agent`

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

### Filter by Phase

```sql
fields @timestamp, _name, @message
| filter phase = "sdk"
| sort @timestamp desc
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

### Cost by User

```sql
stats sum(total_cost_usd) as total_cost by user_sub
| filter _name = "COST"
| sort total_cost desc
```

---

## Local Development

### Docker Test

Use the `workspace-agent-local-test` skill to test locally:

```
/workspace-agent-local-test
```

### Key Environment Variables

```bash
AWS_REGION=us-east-1
CLIENT_NAME=your-client
OUTPUTS_BUCKET_NAME=numa-your-client-outputs
DYNAMODB_TABLE_NAME=numa-your-client-chat-history
WORKSPACE_TOOLS_LAMBDA_ARN=arn:aws:lambda:...
BEDROCK_ACCOUNT_ID=  # Optional cross-account
```

### Running Tests

```bash
cd services/numa-workspace-agent
poetry install
poetry run pytest
```

---

## Common Tasks

### Adding a New Tool

1. Create tool in `tools/numa/your_tool.py`
2. Add to system prompt in `prompts.py` (WORKSPACE_SYSTEM_PROMPT)
3. If it needs Lambda access, use `helpers/credentials.py` for local creds

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

### Debugging Conversation Issues

1. Get conversation_id from frontend or logs
2. Query CloudWatch with conversation_id filter
3. Check `STREAM_COMPLETE` for full conversation flow
4. Check `S3_SYNC_*` for file sync issues
5. Read trace.jsonl from S3 for full history

### Understanding Session Persistence

1. **Cold Start:** Container starts fresh, `sync_from_s3()` downloads workspace
2. **Warm Container:** Same user's files already local, no sync needed
3. **Conversation Switch:** `sync_conversation_switch()` archives old, restores new
4. **Session Resumption:** `session_id` from trace enables Claude context continuation

---

## SDK Bash Tool Security

Two security layers validate bash commands:

| Layer        | Source              | Error Pattern                                 | Configurable? |
| ------------ | ------------------- | --------------------------------------------- | ------------- |
| SDK built-in | Claude Agent SDK    | "Command contains ${} parameter substitution" | No            |
| Custom hooks | `hooks/security.py` | "SECURITY_POLICY_VIOLATION: ..."              | Yes           |

**SDK layer blocks:** `${...}` and `$'...'` patterns (even in inline Python like `python3 -c "print(f'${x}')"`)

**Workaround:** Write Python scripts to files instead of inline execution:

```bash
# Instead of: python3 -c "print(f'${total:.2f}')"  # BLOCKED
# Do this:
python3 /workdir/outputs/analysis.py  # Write script first, then run
```

---

## File Structure

```
services/numa-workspace-agent/
├── numa_workspace_agent/
│   ├── __init__.py
│   ├── main.py              # FastAPI app, endpoints
│   ├── assistant.py         # Pre-request Nova assistant
│   ├── sdk_runner.py        # Claude SDK streaming
│   ├── sdk_config.py        # SDK options, credentials
│   ├── prompts.py           # System prompts
│   ├── trace_parser.py      # Conversation history parsing
│   ├── s3_workspace.py      # S3 sync operations
│   ├── workspace.py         # Local workspace management
│   ├── dynamo.py            # DynamoDB meta updates
│   ├── stream_logger.py     # Verbose stream logging
│   └── hooks/
│       └── security.py      # Security audit hooks
├── tools/
│   └── numa/
│       ├── knowledge_base.py
│       ├── web_search.py
│       ├── extract_content.py
│       ├── convert_document.py
│       └── helpers/
│           ├── __init__.py
│           └── credentials.py
├── plugins/                 # Skills and agents for Claude
│   └── numa/
│       ├── skills/
│       └── agents/
├── pyproject.toml
└── Dockerfile
```
