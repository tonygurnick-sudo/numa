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

| Variable                  | Example Value | How to Find                                             |
| ------------------------- | ------------- | ------------------------------------------------------- |
| `AWS_REGION_WORKSPACE`    | `us-east-1`   | Region where Bedrock and client resources live          |
| `CLIENT_NAME`             | `nd-labs`     | Client identifier from `clientConfigProd.json` or infra |
| `CLAUDE_CODE_USE_BEDROCK` | `1`           | Always `1` for Bedrock                                  |

### Storage (for workspace file persistence)

| Variable              | Naming Pattern              | Example                |
| --------------------- | --------------------------- | ---------------------- |
| `OUTPUTS_BUCKET_NAME` | `numa-{clientName}-outputs` | `numa-nd-labs-outputs` |
| `DATA_BUCKET`         | `numa-{clientName}-data`    | `numa-nd-labs-data`    |

**GOTCHA:** The `.env` uses `DATA_BUCKET`, but `workspace_setup.py` reads `DATA_BUCKET_NAME` (matching the infra construct). When running the container, map it: `-e DATA_BUCKET_NAME="$DATA_BUCKET"`. If wrong, you'll see `NOLIA_NO_DATA_BUCKET: "DATA_BUCKET_NAME not set — skipping KB download"` in logs.

### DynamoDB (for conversation history, agents, settings)

| Variable                           | Naming Pattern                            | Example                              |
| ---------------------------------- | ----------------------------------------- | ------------------------------------ |
| `DYNAMODB_TABLE_NAME`              | `numa-{clientName}-chat-history`          | `numa-nd-labs-chat-history`          |
| `WORKSPACE_AGENTS_TABLE`           | `numa-{clientName}-agents`                | `numa-nd-labs-agents`                |
| `USER_AGENTS_TABLE`                | `numa-{clientName}-user-agents`           | `numa-nd-labs-user-agents`           |
| `CHAT_SETTINGS_TABLE_NAME`         | `numa-{clientName}-chat-settings`         | `numa-nd-labs-chat-settings`         |
| `INTEGRATIONS_APPROVAL_TABLE_NAME` | `numa-{clientName}-integrations-approval` | `numa-nd-labs-integrations-approval` |

### Lambdas (for KB queries, web search, integrations)

| Variable                      | Naming Pattern                           | Example                                                                       |
| ----------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| `WORKSPACE_TOOLS_LAMBDA_NAME` | `numa-{clientName}_workspace-chat-tools` | `numa-nd-labs_workspace-chat-tools`                                           |
| `PIPEDREAM_RELAY_LAMBDA_ARN`  | Full ARN                                 | `arn:aws:lambda:us-east-1:905418183804:function:numa-nd-labs_pipedream-relay` |
| `EXTRACT_CONTENT_LAMBDA_ARN`  | Full ARN                                 | Set in `.env` — required for Nolia PDF extraction                             |

### What works WITHOUT optional variables

Even without DynamoDB/S3/Lambda vars, these features work:

- Bedrock model calls (chat, thinking)
- Code execution via Bash (write a Python script to `/workdir/tmp/` and run it)
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

**GOTCHA — credential order matters.** The `.env` file currently hardcodes a long-term IAM access key (`AWS_ACCESS_KEY_ID=AKIA...`, plus its secret), which means **`source .env` will silently overwrite SSO temp creds** even if you exported them first. Symptoms: container starts fine, then every AWS call fails with `InvalidToken` / `UnrecognizedClientException`, and `boto3.client("sts").get_caller_identity()` inside the container resolves to a totally different IAM identity (e.g. `arn:aws:iam::442483608950:user/nathan`) instead of the q-demo SSO role. The correct order is `source` first, then unset the AKIA creds, then `eval` the SSO export last:

```bash
source /Users/nathandouglas/arcanum/numa/.env
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)"
# Verify: $AWS_ACCESS_KEY_ID should now start with ASIA (SSO temp creds), not AKIA
```

Eventually the hardcoded AKIA creds in `.env` should be moved into a named profile in `~/.aws/credentials` (or removed if unused) so this ordering dance isn't needed.

### Step 4: Run the Container

Read env vars from `.env` and start the container. Note: the `.env` uses `AWS_REGION_WORKSPACE` to avoid conflicting with the deployment region, but the container needs `AWS_REGION`:

```bash
docker rm -f workspace-test 2>/dev/null

# Source the .env file (reading AWS_REGION_WORKSPACE), then re-export SSO creds
# so the AKIA values in .env don't override them (see GOTCHA above).
source /Users/nathandouglas/arcanum/numa/.env
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)"

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

| Type ID               | Response Mode | Tools                                  | Use Case               |
| --------------------- | ------------- | -------------------------------------- | ---------------------- |
| `numa-chat`           | stream        | Full (SDK tools + numa CLI via Bash)   | Interactive chat       |
| `research-agent`      | stream        | SDK tools + numa CLI (no integrations) | Research & analysis    |
| `document-summariser` | sync          | Minimal (Read, Write, Glob, Grep only) | Structured JSON output |

### Test: numa-chat (streaming)

```bash
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{"action":"chat","prompt":"Say hello and list your tools briefly.","conversationId":"nathan-local-test-chat-001","type":"numa-chat"}'
```

**What to verify:**

- `session_init` event with `isNewSession: true`
- `system` init event shows the SDK tools (Bash, Read, Write, Edit, Glob, Grep, etc.) — the agent calls the `numa` CLI through Bash
- MCP servers: empty `[]` (the agent runs with zero MCP servers)
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

- `system` init shows the SDK tools (Bash, Read, Write, etc.) — code runs via Bash, integrations are unavailable for this type
- MCP servers: empty `[]` (the agent runs with zero MCP servers)
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
- Agent writes `/workdir/outputs/result.json` with structured output
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
  Tools: ['Task', 'TaskOutput', 'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'TodoWrite', 'KillShell', 'Skill']
  MCP: []
=== research-agent ===
  Tools: ['Task', 'TaskOutput', 'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'TodoWrite', 'KillShell', 'Skill']
  MCP: []
=== document-summariser ===
  Tools: ['Glob', 'Grep', 'Read', 'Write', 'TodoWrite']
  MCP: []
```

All agent types run with zero MCP servers. `numa-chat` and `research-agent` get the full SDK toolset (including Bash) and invoke the `numa` CLI through Bash; `document-summariser` gets a minimal read/write toolset with no Bash.

### Test: Code Execution (numa-chat or research-agent)

Verify code execution via Bash works:

```bash
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{"action":"chat","prompt":"Run a Python script that prints the current date and time.","conversationId":"nathan-local-test-code-001","type":"numa-chat"}'
```

**What to verify:**

- Agent writes a Python script to `/workdir/tmp/` and runs it via the Bash tool
- Python executes successfully inside the container
- Output includes the current datetime

### Step 6: Stop the Container

```bash
docker stop workspace-test
```

## Testing Integrations (numa CLI path)

Driving Pipedream integrations (Gmail, Xero, Outlook, …) through the agent locally needs three things the default test sub doesn't have: **(1) a real Cognito sub that actually has Pipedream connections, (2) a valid Cognito id_token, and (3) the integration's approval set to auto-approve so writes don't stall.** (First made to work 2026-06-16 — pre-CLI benches drove integrations via the old MCP layer, so this path was untested locally.)

### How integration auth works (and why it breaks without a token)

A `numa integrations …` call inside the container runs in **workspace-IAM mode**: the CLI invokes `{client}_numa-cli-api` via `lambda:Invoke` and authenticates with `NUMA_IDENTITY_TOKEN`. The agent sets that from the chat request's **`Authorization: Bearer <id_token>`** header (`main.py` → `os.environ["NUMA_IDENTITY_TOKEN"]`; `NUMA_ACCOUNT` = `CLIENT_NAME`, set automatically). With no token, every integration call fails: `NUMA_AUTH_MODE=workspace-iam but NUMA_IDENTITY_TOKEN is unset` (`numa-cli .../api/client.ts:186`).

`bench_drive.py` sends it when you pass `--id-token-file=<path>` (or set the `BENCH_ID_TOKEN` env var).

### Step 1 — get a fresh id_token

The numa CLI caches tokens at `~/.config/numa/tokens-<client>.json` (from `numa login`). The `idToken` expires hourly; the `refreshToken` lasts ~30 days. The nd-labs app client has a **secret**, so refreshing needs a `SECRET_HASH`:

```bash
python3 <<'PY'
import json, base64, hmac, hashlib, boto3
d=json.load(open('/Users/nathandouglas/.config/numa/tokens-nd-labs.json'))
pool='us-east-1_3tm2uaPJx'; cid='22n77de22vjrct7tma3hdij5u6'   # nd-labs pool + app client
idp=boto3.Session(profile_name='q-demo').client('cognito-idp', region_name='us-east-1')
secret=idp.describe_user_pool_client(UserPoolId=pool, ClientId=cid)['UserPoolClient']['ClientSecret']
sh=base64.b64encode(hmac.new(secret.encode(), (d['sub']+cid).encode(), hashlib.sha256).digest()).decode()
r=idp.initiate_auth(ClientId=cid, AuthFlow='REFRESH_TOKEN_AUTH',
      AuthParameters={'REFRESH_TOKEN': d['refreshToken'], 'SECRET_HASH': sh})
open('/tmp/_idt.txt','w').write(r['AuthenticationResult']['IdToken']); print('saved /tmp/_idt.txt')
PY
```

`SECRET_HASH` keys on the **sub** for nd-labs (try `d['sub']`/`d['username']`/`d['email']` if one fails). If the refresh token is also dead, do a fresh `numa login nd-labs` (needs the password).

### Step 2 — pick a sub with connections, and the CORRECT slug

Integrations connect per **`external_user_id` = `{client}_{sub}`**. Nathan's real nd-labs sub (Xero, Outlook, Drive, Notion, Asana, Pipedrive connected): **`f4088468-1051-7091-5229-8f49cc9cf34a`** (`nathan@arcanum.ai`).

⚠️ **`--enable=` takes the Pipedream app `name_slug`, NOT a friendly alias.** `xero` does NOT resolve — the slug is **`xero_accounting_api`** ("Integration X is not connected" = wrong slug). List what's actually connected + the exact slugs:

```bash
python3 <<'PY'
import json, urllib.request, urllib.parse, re
env={}
for line in open('/Users/nathandouglas/arcanum/numa/.env'):
    m=re.match(r'\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*)"?', line)
    if m: env[m.group(1)]=m.group(2).strip()
data=urllib.parse.urlencode({'grant_type':'client_credentials','client_id':env['PIPEDREAM_CLIENT_ID'],'client_secret':env['PIPEDREAM_CLIENT_SECRET']}).encode()
tok=json.load(urllib.request.urlopen(urllib.request.Request('https://api.pipedream.com/v1/oauth/token', data=data)))['access_token']
ext='nd-labs_f4088468-1051-7091-5229-8f49cc9cf34a'
url=f"https://api.pipedream.com/v1/connect/{env['PROJECT_ID']}/accounts?external_user_id={urllib.parse.quote(ext)}"
for a in json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization':f"Bearer {tok}",'X-PD-Environment':'production'}))).get('data',[]):
    print(a['app']['name_slug'], '| healthy:', a.get('healthy'))
PY
```

### Step 3 — auto-approve writes (or they stall ~180s)

Integration **writes** hit the HITL approval gate; `bench_drive` has no approver, so a write under `non_destructive`/`always` times out at ~180s with `is_error: true`. Set the user's approval to `never` for the test and **restore after** (Nathan's default is `non_destructive`):

```bash
SUB=f4088468-1051-7091-5229-8f49cc9cf34a
aws --profile q-demo dynamodb update-item --table-name numa-nd-labs-chat-settings --region us-east-1 \
  --key "{\"user_id\":{\"S\":\"$SUB\"}}" --update-expression "SET approvalMode = :n" \
  --expression-attribute-values '{":n":{"S":"never"}}'      # ... run test ... then restore to non_destructive
```

The container **must** carry `CHAT_SETTINGS_TABLE_NAME` or it silently ignores DDB and behaves as `non_destructive` (writes time out regardless — see the ⚠️ in the env section). Verify: `docker exec workspace-test python3 -c "from numa_workspace_agent.agent_config import fetch_user_approval_mode, clear_user_settings_cache; clear_user_settings_cache(); print(fetch_user_approval_mode('$SUB'))"` → should print `never`.

### Step 4 — drive it, and read the raw result

```bash
cd dev-notes/research/model-benchmarks/_tools
python3 bench_drive.py turn t-test anthropic.claude-haiku-4-5-20251001-v1:0 "<prompt>" \
  --user-sub=f4088468-1051-7091-5229-8f49cc9cf34a --user-email=nathan@arcanum.ai \
  --enable=xero_accounting_api --id-token-file=/tmp/_idt.txt
```

The CLI spills each integration result to a file — inspect the **exact Pipedream envelope** (`os[]` observations, `ret`, `Warnings`, errors):

```bash
docker exec workspace-test bash -lc 'cat /workdir/tmp/numa-cli/numa-pipedream_run_action-*.json' | python3 -m json.tool | head -80
```

A failed upstream call (e.g. Xero `400 ValidationException`) lands in `result.os[]` as a `{"k":"error","err":{...}}` observation — which the T-14 scan in `pipedream_integration.py` turns into `status: "action_error"`.

### Gotchas

| Symptom                                         | Cause / fix                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NUMA_IDENTITY_TOKEN is unset` / CLI auth fails | No id_token sent — pass `--id-token-file=` (Step 1).                                                                                                                                 |
| `Integration 'X' is not connected` (but it is)  | Wrong slug — use the Pipedream `name_slug` (`xero_accounting_api`, not `xero`). List accounts (Step 2).                                                                              |
| Write times out ~180s, `is_error: true`         | Approval not `never`, or `CHAT_SETTINGS_TABLE_NAME` missing from the container env.                                                                                                  |
| id_token rejected                               | Expired (1h TTL) — refresh (Step 1).                                                                                                                                                 |
| Real-account safety                             | Writes are real — use a sandbox org. A bad value may still create a DRAFT (Xero strips a bad account code with a `Warning`; the hard `ValidationException` only fires on AUTHORISE). |

---

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

| Field            | Required       | Default                | Description                                                                      |
| ---------------- | -------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `action`         | Yes            | -                      | `chat`, `stop`, `upload`, `upload_complete`, `delete_uploads`, `cleanup_session` |
| `prompt`         | Yes (for chat) | -                      | User message text                                                                |
| `conversationId` | Yes            | -                      | Use `nathan-local-test-{type}-NNN` pattern                                       |
| `type`           | No             | `numa-chat`            | Agent type ID                                                                    |
| `responseMode`   | No             | From agent type config | `stream`, `sync`, or `fire-and-forget`                                           |
| `modelId`        | No             | Sonnet 4.5             | Bedrock model ID override                                                        |
| `attachments`    | No             | `[]`                   | File attachment metadata                                                         |
| `timezone`       | No             | UTC                    | User timezone for date formatting                                                |

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

### InvalidToken / UnrecognizedClientException everywhere (S3, DynamoDB, Bedrock)

**Symptom:** Container starts cleanly, but every AWS call inside fails with `InvalidToken` / `UnrecognizedClientException` / `InvalidClientTokenId`. `boto3.client("sts").get_caller_identity()` inside the container resolves to an unexpected IAM identity (often `arn:aws:iam::442483608950:user/nathan`).

**Cause:** The `.env` file hardcodes a long-term IAM access key (`AKIA...`). Sourcing `.env` after exporting SSO temp creds silently overwrites them. The container then runs as the wrong identity.

**Fix:** Source `.env` first, unset the AKIA values, then export SSO creds last (see Step 3 GOTCHA):

```bash
source /Users/nathandouglas/arcanum/numa/.env
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)"
# Sanity check: $AWS_ACCESS_KEY_ID should start with ASIA, not AKIA
```

To verify inside a running container:

```bash
docker exec workspace-test bash -c 'python3 -c "import boto3; print(boto3.client(\"sts\").get_caller_identity()[\"Arn\"])"'
# Should print: arn:aws:sts::905418183804:assumed-role/AWSReservedSSO_AdministratorAccess_.../nathan@arcanum.ai
```

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

## Debug Logging

Add `-e LOG_LEVEL=DEBUG` to the docker run command to see live LLM messages. Shows assistant text, thinking, and tool calls in real time. Only for local dev — production runs at INFO.

```bash
# Watch live LLM activity:
docker logs -f workspace-test 2>&1 | grep "SDK_LIVE"

# With step context (useful for Nolia multi-phase pipelines):
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

---

## Testing Nolia (nolia-compliance)

Nolia uses **fire-and-forget** response mode — the request returns immediately with a `run_id`, and the pipeline runs as a background task. Poll `/runs/{run_id}/status` or check S3 for `_result.json`.

### Extra Required Env Vars

Beyond the standard vars, Nolia needs:

- `-e DATA_BUCKET_NAME="$DATA_BUCKET"` (NOT `DATA_BUCKET` — see gotcha above)
- `-e EXTRACT_CONTENT_LAMBDA_ARN="$EXTRACT_CONTENT_LAMBDA_ARN"` (for PDF extraction)

Without `EXTRACT_CONTENT_LAMBDA_ARN`, you'll see: `NOLIA_EXTRACT_NO_LAMBDA: "EXTRACT_CONTENT_LAMBDA_ARN not set — cannot extract PDF"`

### nd-labs Test Knowledge Bases

| Name                 | KB ID                                  | S3 Prefix                                            |
| -------------------- | -------------------------------------- | ---------------------------------------------------- |
| `global-test-1`      | `9df246a7-925f-4cfc-a964-a6da9788ce68` | `documents/kb-9df246a7-925f-4cfc-a964-a6da9788ce68/` |
| `procurement-test-1` | `d3788c3d-7e85-4de3-805a-b8c73f6ddaf3` | `documents/kb-d3788c3d-7e85-4de3-805a-b8c73f6ddaf3/` |
| `project-test-1`     | `5a8fc87f-6c8d-45d3-896e-82ffd2ba367b` | `documents/kb-5a8fc87f-6c8d-45d3-896e-82ffd2ba367b/` |

Look up KBs: `AWS_PROFILE=q-demo aws dynamodb scan --table-name numa-nd-labs-knowledge-bases --region us-east-1`

KBs use `documents/kb-{kb_id}/` prefix in S3, NOT `documents/{kb_name}/`. The frontend passes KB IDs (UUIDs).

### STS Token Expiry Warning

STS session tokens expire after ~15 minutes, but Nolia pipelines take 30-60 minutes. Expired tokens cause `ExpiredToken` errors mid-pipeline. Always get fresh credentials immediately before starting.

### Test: No Document (KB + Rules + Template Verification)

Verifies workspace setup downloads KBs, rules files, and output template from S3. No document uploaded so phases will complain about missing file — that's expected.

```bash
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{
    "action": "chat",
    "prompt": "Review this evaluation report for compliance with World Bank procurement rules.",
    "conversationId": "nathan-local-test-nolia-001",
    "type": "nolia-compliance",
    "metadata": {
      "assessment_type": "evaluation-report",
      "global_kb": "9df246a7-925f-4cfc-a964-a6da9788ce68",
      "procurement_kb": "d3788c3d-7e85-4de3-805a-b8c73f6ddaf3",
      "project_kb": "",
      "output_language": "english"
    }
  }'
```

### Test: With PDF Document

```bash
# 1. Upload test PDF (once per conversation ID)
AWS_PROFILE=q-demo aws s3 cp \
  "docs/tasks/numa-apps-v2/Nolia Test Document.pdf" \
  "s3://numa-nd-labs-outputs/v2-apps/nolia/nathan-local-test/nathan-local-test-nolia-002/uploads/Nolia Test Document.pdf" \
  --region us-east-1

# 2. Start container with debug logging
# Source .env BEFORE the SSO export so the AKIA creds in .env don't override
# the q-demo temp creds (see GOTCHA in Step 3).
source /Users/nathandouglas/arcanum/numa/.env 2>/dev/null
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)" && \
docker rm -f workspace-test 2>/dev/null; \
docker run -d --rm --name workspace-test -p 8080:8080 \
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
  -e LOG_LEVEL=DEBUG \
  numa-workspace-agent:latest

# 3. Wait for startup, then fire
sleep 10 && curl -s http://localhost:8080/ping | jq . && \
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{
    "action": "chat",
    "prompt": "Review this evaluation report for compliance with World Bank procurement rules.",
    "conversationId": "nathan-local-test-nolia-002",
    "uploadPrefixes": ["v2-apps/nolia/nathan-local-test/nathan-local-test-nolia-002/uploads/"],
    "metadata": {
      "assessment_type": "evaluation-report",
      "global_kb": "9df246a7-925f-4cfc-a964-a6da9788ce68",
      "procurement_kb": "d3788c3d-7e85-4de3-805a-b8c73f6ddaf3",
      "project_kb": "",
      "output_language": "english"
    }
  }'
```

### Nolia Log Queries

```bash
# Clean filtered log (LLM thinking/text/tools + NOLIA events only — save to file)
docker logs workspace-test 2>&1 | grep -E "NOLIA_|SDK_LIVE|STREAM_COMPLETE" | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line)
        name = d.get('_name','')
        step = d.get('conversation_id','').split('step-')[-1] if 'step-' in d.get('conversation_id','') else ''
        if name == 'SDK_LIVE_THINKING':
            print(f'[{step}] THINK: {d.get(\"thinking\",\"\")}')
        elif name == 'SDK_LIVE_TEXT':
            print(f'[{step}] TEXT: {d.get(\"text\",\"\")}')
        elif name == 'SDK_LIVE_TOOL':
            print(f'[{step}] TOOL: {d.get(\"tool_name\",\"\")}')
        elif name.startswith('NOLIA_'):
            print(f'--- {name}: {d.get(\"event\",\"\")} {\" | \".join(f\"{k}={v}\" for k,v in d.items() if k not in (\"_name\",\"event\",\"level\",\"timestamp\",\"phase\"))}')
    except: pass
" > nolia-test-clean.txt

# All Nolia events
docker logs workspace-test 2>&1 | grep "NOLIA_"

# Pipeline progress + memory tracking
docker logs workspace-test 2>&1 | grep -E "NOLIA_STEP|NOLIA_PHASE|NOLIA_PIPELINE|NOLIA_SEQUENTIAL|NOLIA_MEMORY"

# Workspace setup (KB downloads, template, extraction)
docker logs workspace-test 2>&1 | grep -E "NOLIA_KB|NOLIA_RULES|NOLIA_TEMPLATE|NOLIA_CUSTOM|NOLIA_WORKSPACE_SETUP|NOLIA_EXTRACT"

# Cost per step
docker logs workspace-test 2>&1 | grep '"_name": "COST"'

# Full results summary
docker logs workspace-test 2>&1 | grep "STREAM_COMPLETE" | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        data = json.loads(line)
        conv = data.get('conversation_id', '')
        label = conv.split('step-')[-1] if 'step-' in conv else conv
        cost = data.get('total_cost_usd', 0)
        out_tok = data.get('output_tokens', '')
        turns = data.get('num_turns', '')
        dur = data.get('total_duration_ms', 0)
        print(f'{label:20s} | \${cost:.2f} | out={out_tok:>6} | turns={turns:>3} | {dur/1000:.0f}s')
    except: pass
"
```

**Result location:** `s3://numa-nd-labs-outputs/v2-apps/nolia/nathan-local-test/{conversationId}/_result.json`

---

## Quick One-Liner Test

Load image, get credentials, start container, test all types, stop:

```bash
docker load -i /Users/nathandouglas/arcanum/numa/infra/assets/artifacts/numa-workspace-agent/image.tar && \
source /Users/nathandouglas/arcanum/numa/.env && \
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN && \
eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)" && \
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
