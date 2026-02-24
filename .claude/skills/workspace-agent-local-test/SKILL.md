---
name: workspace-agent-local-test
description: Test numa-workspace-agent Docker container locally. Use when asked to test workspace agent, run workspace agent locally, debug workspace agent, or test SDK integration.
allowed-tools: Bash, Read, Write, Glob
---

# Workspace Agent Local Testing

## Purpose

Test the numa-workspace-agent container locally before deploying to AgentCore. This skill helps build, run, and test the container with proper AWS credentials. Supports testing all agent types (numa-chat, research-agent, document-summariser, and any custom types).

## Prerequisites

- Docker installed and running
- AWS CLI configured with `q-demo` profile (assumes into dev account 905418183804)
- The container image built via `./package-service.sh numa-workspace-agent`
- Environment variables configured in `/Users/nathandouglas/arcanum/numa/.env`

## Environment Variables

The `.env` file at the project root (`/Users/nathandouglas/arcanum/numa/.env`) should contain these variables. Find actual resource names from infra constructs or deployed resources in the target client account.

### Required (minimum for basic chat)

| Variable | Example Value | How to Find |
|----------|---------------|-------------|
| `AWS_REGION_WORKSPACE` | `us-east-1` | Region where Bedrock and client resources live |
| `CLIENT_NAME` | `nd-labs` | Client identifier from `clientConfigProd.json` or infra |
| `CLAUDE_CODE_USE_BEDROCK` | `1` | Always `1` for Bedrock |

### Storage (for workspace file persistence)

| Variable | Naming Pattern | Example |
|----------|---------------|---------|
| `OUTPUTS_BUCKET_NAME` | `numa-{clientName}-outputs` | `numa-nd-labs-outputs` |
| `DATA_BUCKET` | `numa-{clientName}-data` | `numa-nd-labs-data` |

### DynamoDB (for conversation history, agents, settings)

| Variable | Naming Pattern | Example |
|----------|---------------|---------|
| `DYNAMODB_TABLE_NAME` | `numa-{clientName}-chat-history` | `numa-nd-labs-chat-history` |
| `WORKSPACE_AGENTS_TABLE` | `numa-{clientName}-agents` | `numa-nd-labs-agents` |
| `USER_AGENTS_TABLE` | `numa-{clientName}-user-agents` | `numa-nd-labs-user-agents` |
| `CHAT_SETTINGS_TABLE_NAME` | `numa-{clientName}-chat-settings` | `numa-nd-labs-chat-settings` |
| `INTEGRATIONS_APPROVAL_TABLE_NAME` | `numa-{clientName}-integrations-approval` | `numa-nd-labs-integrations-approval` |

### Lambdas (for KB queries, web search, integrations)

| Variable | Naming Pattern | Example |
|----------|---------------|---------|
| `WORKSPACE_TOOLS_LAMBDA_NAME` | `numa-{clientName}_workspace-chat-tools` | `numa-nd-labs_workspace-chat-tools` |
| `PIPEDREAM_RELAY_LAMBDA_ARN` | Full ARN | `arn:aws:lambda:us-east-1:905418183804:function:numa-nd-labs_pipedream-relay` |

### What works WITHOUT optional variables

Even without DynamoDB/S3/Lambda vars, these features work:
- Bedrock model calls (chat, thinking)
- Code execution via `execute_script` MCP tool
- File operations (Read, Write, Edit, Glob, Grep)
- All agent types and response modes (stream, sync)

### What needs the optional variables

- `knowledge_search` tool requires `WORKSPACE_TOOLS_LAMBDA_NAME`
- `web_search` tool requires `WORKSPACE_TOOLS_LAMBDA_NAME`
- Integration tools require `PIPEDREAM_RELAY_LAMBDA_ARN`
- Conversation persistence requires `DYNAMODB_TABLE_NAME`
- Workspace file sync requires `OUTPUTS_BUCKET_NAME`

## Instructions

### Step 1: Build the Container

```bash
cd /Users/nathandouglas/arcanum/numa/services
./package-service.sh numa-workspace-agent
```

This creates `image.tar` in `infra/assets/artifacts/numa-workspace-agent/`.

### Step 2: Load the Image

```bash
docker load -i /Users/nathandouglas/arcanum/numa/infra/assets/artifacts/numa-workspace-agent/image.tar
```

### Step 3: Get AWS Credentials

The `q-demo` profile already has access to the dev account. Export credentials for Docker:

```bash
eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)"
```

**Note:** Do NOT try to `sts assume-role` into the same role you're already in — it will fail with AccessDenied. The `export-credentials` command handles this correctly.

### Step 4: Run the Container

Read env vars from `.env` and start the container. Note: the `.env` uses `AWS_REGION_WORKSPACE` to avoid conflicting with the deployment region, but the container needs `AWS_REGION`:

```bash
docker rm -f workspace-test 2>/dev/null

# Source the .env file (reading AWS_REGION_WORKSPACE)
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
  -e DATA_BUCKET="$DATA_BUCKET" \
  -e DYNAMODB_TABLE_NAME="$DYNAMODB_TABLE_NAME" \
  -e WORKSPACE_AGENTS_TABLE="$WORKSPACE_AGENTS_TABLE" \
  -e USER_AGENTS_TABLE="$USER_AGENTS_TABLE" \
  -e CHAT_SETTINGS_TABLE_NAME="$CHAT_SETTINGS_TABLE_NAME" \
  -e INTEGRATIONS_APPROVAL_TABLE_NAME="$INTEGRATIONS_APPROVAL_TABLE_NAME" \
  -e WORKSPACE_TOOLS_LAMBDA_NAME="$WORKSPACE_TOOLS_LAMBDA_NAME" \
  -e PIPEDREAM_RELAY_LAMBDA_ARN="$PIPEDREAM_RELAY_LAMBDA_ARN" \
  numa-workspace-agent:latest
```

Wait for startup (~8 seconds due to OpenTelemetry detector timeouts), then verify:

```bash
sleep 8 && docker logs workspace-test 2>&1 | tail -15
```

You should see all agent types registered and `Uvicorn running on http://0.0.0.0:8080`.

### Step 5: Test the Endpoints

Use `nathan-local-test` as the user sub and conversation ID prefix to clearly identify local test data.

**Health check:**
```bash
curl -s http://localhost:8080/ping | jq .
```

Expected: `{"status":"Healthy","time_of_last_update":...}`

---

## Testing Agent Types

The workspace agent supports multiple agent types, each with different tools, response modes, and capabilities. Pass the `type` field in the request body to select one.

### Agent Type Overview

| Type ID | Response Mode | Tools | Use Case |
|---------|--------------|-------|----------|
| `numa-chat` | stream | Full (SDK + scripts MCP + integrations MCP) | Interactive chat |
| `research-agent` | stream | SDK + scripts MCP (no integrations) | Research & analysis |
| `document-summariser` | sync | Minimal (Read, Write, Glob, Grep only) | Structured JSON output |

### Test: numa-chat (streaming)

```bash
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{"action":"chat","prompt":"Say hello and list your tools briefly.","conversationId":"nathan-local-test-chat-001","type":"numa-chat"}'
```

**What to verify:**
- `session_init` event with `isNewSession: true`
- `system` init event shows tools including `mcp__integrations__run_action` and `mcp__scripts__execute_script`
- MCP servers: `scripts` AND `integrations` both connected
- Streaming `StreamEvent` deltas arrive
- `result` event with `subtype: "success"`

### Test: research-agent (streaming)

```bash
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{"action":"chat","prompt":"What tools do you have available?","conversationId":"nathan-local-test-research-001","type":"research-agent"}'
```

**What to verify:**
- `system` init shows `mcp__scripts__execute_script` but NO `mcp__integrations__*` tools
- MCP servers: only `scripts` (no `integrations`)
- Response streams successfully

### Test: document-summariser (sync)

```bash
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{"action":"chat","prompt":"Summarize this: Arcanum AI is a New Zealand tech company founded in 2016. They build Numa, a multi-tenant serverless enterprise AI platform on AWS.","conversationId":"nathan-local-test-summarise-001","type":"document-summariser"}'
```

**What to verify:**
- `system` init shows only `Glob, Grep, Read, Write, TodoWrite` (no Bash, no MCP tools)
- MCP servers: empty `[]`
- Agent writes `/workdir/session/result.json` with structured output
- `result` event contains the summary text

### Test: Tool Comparison (quick validation)

Extract and compare tool sets across all types in one go:

```bash
for TYPE in numa-chat research-agent document-summariser; do
  echo "=== $TYPE ==="
  curl -s -X POST http://localhost:8080/invocations \
    -H "Content-Type: application/json" \
    -H "x-user-sub: nathan-local-test" \
    -d "{\"action\":\"chat\",\"prompt\":\"hi\",\"conversationId\":\"nathan-local-test-tools-$TYPE\",\"type\":\"$TYPE\"}" 2>&1 \
    | grep '"subtype": "init"' \
    | python3 -c "
import sys, json
for line in sys.stdin:
    data = json.loads(line.replace('data: ', ''))
    print(f'  Tools: {data[\"data\"][\"tools\"]}')
    print(f'  MCP: {[s[\"name\"] for s in data[\"data\"][\"mcp_servers\"]]}')
"
done
```

**Expected output:**

```
=== numa-chat ===
  Tools: ['Task', 'TaskOutput', 'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'TodoWrite', 'KillShell', 'Skill', 'mcp__scripts__execute_script', 'mcp__integrations__run_action', 'mcp__integrations__configure_props', 'mcp__integrations__proxy_request']
  MCP: ['scripts', 'integrations']
=== research-agent ===
  Tools: ['Task', 'TaskOutput', 'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'TodoWrite', 'KillShell', 'Skill', 'mcp__scripts__execute_script']
  MCP: ['scripts']
=== document-summariser ===
  Tools: ['Glob', 'Grep', 'Read', 'Write', 'TodoWrite']
  MCP: []
```

### Test: Code Execution (numa-chat or research-agent)

Verify the scripts MCP server works:

```bash
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{"action":"chat","prompt":"Run a Python script that prints the current date and time.","conversationId":"nathan-local-test-code-001","type":"numa-chat"}'
```

**What to verify:**
- Agent uses `mcp__scripts__execute_script` tool
- Python executes successfully inside the container
- Output includes the current datetime

### Step 6: Stop the Container

```bash
docker stop workspace-test
```

## Request Payload Reference

The `/invocations` endpoint accepts these fields (mimicking what the proxy Lambda sends):

```json
{
  "action": "chat",
  "prompt": "Your message here",
  "conversationId": "nathan-local-test-xxx-001",
  "type": "numa-chat",
  "responseMode": "stream",
  "modelId": "anthropic.claude-sonnet-4-5-20250929-v1:0",
  "attachments": [],
  "timezone": "Pacific/Auckland",
  "userEmail": "test@arcanum.ai"
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `action` | Yes | - | `chat`, `stop`, `upload`, `upload_complete`, `delete_uploads`, `cleanup_session` |
| `prompt` | Yes (for chat) | - | User message text |
| `conversationId` | Yes | - | Use `nathan-local-test-{type}-NNN` pattern |
| `type` | No | `numa-chat` | Agent type ID |
| `responseMode` | No | From agent type config | `stream`, `sync`, or `fire-and-forget` |
| `modelId` | No | Sonnet 4.5 | Bedrock model ID override |
| `attachments` | No | `[]` | File attachment metadata |
| `timezone` | No | UTC | User timezone for date formatting |

Headers:
- `x-user-sub: nathan-local-test` (required, identifies the user)
- `Content-Type: application/json` (required)

## Expected Local Errors (Safe to Ignore)

These errors appear during local testing and are **normal**:

```
Failed to get k8s token: No such file or directory
AwsEcsResourceDetector failed: Missing ECS_CONTAINER_METADATA_URI
AwsEksResourceDetector failed: No such file or directory
AwsEc2ResourceDetector failed: <urlopen error timed out>
Exception while exporting Span batch... Connection refused (localhost:4318)
```

These are OpenTelemetry/AWS resource detectors that only work in cloud environments.

## Troubleshooting

### JSON Parse Error: "Invalid escape"
**Cause:** Bash escaped special characters in the prompt
**Fix:** Use simple prompts without shell metacharacters (no quotes, apostrophes, backslashes)

### Exit Code 1 Errors
- Check `CLAUDE_CODE_USE_BEDROCK=1` is set
- Verify AWS credentials are valid: `AWS_PROFILE=q-demo aws sts get-caller-identity`
- Check container logs for `SDK CLI stderr` messages (shows actual error)
- Ensure the model is accessible in us-east-1

### AccessDenied on AssumeRole
**Cause:** The `q-demo` profile is already assumed into the target role
**Fix:** Use `eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)"` instead of `sts assume-role`

### S3/DynamoDB Warnings
These are expected if the optional storage env vars are not set. Basic chat still works without them.

### Container Won't Start
```bash
# Check if port 8080 is in use
lsof -i :8080

# Check for existing containers
docker ps -a | grep workspace

# Remove old containers
docker rm -f workspace-test
```

## Test UI (Browser-Based)

For interactive testing with a visual interface instead of curl commands:

```bash
cd /Users/nathandouglas/arcanum/numa/services
./test-workspace-agent.sh
```

This single command:
1. Loads the Docker image
2. Exports AWS credentials from q-demo profile
3. Sources `.env` for workspace vars
4. Starts the workspace agent container on `:8080` with `LOCAL_DEV=1`
5. Starts a test UI server on `:3000`
6. Opens your browser to `http://localhost:3000`

The test UI provides:
- Agent type selector (numa-chat, research-agent, document-summariser)
- Auto-set response mode per agent type
- Streaming response rendering with collapsible thinking blocks and tool calls
- Raw SSE event log in the right sidebar
- Health check status indicator
- Stop button to interrupt running agents
- Sync result panel for document-summariser output

Press `Ctrl+C` to stop everything and clean up.

**Prerequisites:** Same as manual testing (Docker running, image built, `.env` configured).

---

## Quick One-Liner Test

Load image, get credentials, start container, test all types, stop:

```bash
docker load -i /Users/nathandouglas/arcanum/numa/infra/assets/artifacts/numa-workspace-agent/image.tar && \
eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)" && \
source /Users/nathandouglas/arcanum/numa/.env && \
docker rm -f workspace-test 2>/dev/null; \
docker run -d --rm --name workspace-test -p 8080:8080 \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_REGION="$AWS_REGION_WORKSPACE" \
  -e CLIENT_NAME="$CLIENT_NAME" \
  -e CLAUDE_CODE_USE_BEDROCK="$CLAUDE_CODE_USE_BEDROCK" \
  -e OUTPUTS_BUCKET_NAME="$OUTPUTS_BUCKET_NAME" \
  -e DYNAMODB_TABLE_NAME="$DYNAMODB_TABLE_NAME" \
  -e WORKSPACE_TOOLS_LAMBDA_NAME="$WORKSPACE_TOOLS_LAMBDA_NAME" \
  numa-workspace-agent:latest && \
sleep 8 && \
echo "--- Health ---" && curl -s http://localhost:8080/ping | jq . && \
echo "--- numa-chat ---" && curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" -H "x-user-sub: nathan-local-test" \
  -d '{"action":"chat","prompt":"Hello","conversationId":"nathan-local-test-quick-001","type":"numa-chat"}' | grep '"type": "result"' && \
echo "--- research-agent ---" && curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" -H "x-user-sub: nathan-local-test" \
  -d '{"action":"chat","prompt":"Hello","conversationId":"nathan-local-test-quick-002","type":"research-agent"}' | grep '"type": "result"' && \
echo "--- document-summariser ---" && curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" -H "x-user-sub: nathan-local-test" \
  -d '{"action":"chat","prompt":"Summarize: Testing is important for software quality.","conversationId":"nathan-local-test-quick-003","type":"document-summariser"}' | grep '"type": "result"' && \
docker stop workspace-test
```
