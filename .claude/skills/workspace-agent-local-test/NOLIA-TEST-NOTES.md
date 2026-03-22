# Nolia V2 App — Local Testing Notes

Learnings and example requests for testing the Nolia compliance review pipeline locally via the workspace agent container.

---

## Environment Variable Gotchas

### DATA_BUCKET_NAME (not DATA_BUCKET)

The `.env` file uses `DATA_BUCKET=numa-nd-labs-data`, but `workspace_setup.py` reads `DATA_BUCKET_NAME`. The infra construct (`workspace-chat-agent-construct.ts:622`) sets `DATA_BUCKET_NAME`. When running the container locally, map it correctly:

```bash
-e DATA_BUCKET_NAME="$DATA_BUCKET"
```

If this is wrong, you'll see this warning in logs and KBs won't download:

```
NOLIA_NO_DATA_BUCKET: "DATA_BUCKET_NAME not set — skipping KB download"
```

### Circular Import Fix

The nolia orchestrator originally imported `run_claude_sdk` at module level, which caused a circular import chain:

```
nolia/__init__.py → nolia_compliance.py → orchestrator.py → sdk_runner.py → s3_workspace.py → sdk_config.py → agent_types/__init__.py
```

Fix: Lazy imports inside `_run_step()` in `orchestrator.py` (not at module level).

### EXTRACT_CONTENT_LAMBDA_ARN

Required for PDF extraction. Without it, you get:

```
NOLIA_EXTRACT_NO_LAMBDA: "EXTRACT_CONTENT_LAMBDA_ARN not set — cannot extract PDF"
```

The Lambda exists in the nd-labs account:

```bash
-e EXTRACT_CONTENT_LAMBDA_ARN="$EXTRACT_CONTENT_LAMBDA_ARN"
```

This is wired in prod via `workspace-chat-agent-construct.ts:625-626` from `numa-client-stack.ts:316`.

### KB S3 Prefix Pattern

KBs use `documents/kb-{kb_id}/` prefix in S3, NOT `documents/{kb_name}/`. The frontend passes KB IDs (UUIDs), not human-friendly names.

---

## nd-labs Test KBs

| Name                 | KB ID                                  | S3 Prefix                                            |
| -------------------- | -------------------------------------- | ---------------------------------------------------- |
| `global-test-1`      | `9df246a7-925f-4cfc-a964-a6da9788ce68` | `documents/kb-9df246a7-925f-4cfc-a964-a6da9788ce68/` |
| `procurement-test-1` | `d3788c3d-7e85-4de3-805a-b8c73f6ddaf3` | `documents/kb-d3788c3d-7e85-4de3-805a-b8c73f6ddaf3/` |
| `project-test-1`     | `5a8fc87f-6c8d-45d3-896e-82ffd2ba367b` | `documents/kb-5a8fc87f-6c8d-45d3-896e-82ffd2ba367b/` |

Look up KBs with:

```bash
AWS_PROFILE=q-demo aws dynamodb scan --table-name numa-nd-labs-knowledge-bases --region us-east-1
```

Key fields: `kb_id`, `kb_name`, `s3_prefix`.

---

## Full Docker Run Command (with all correct env vars)

**IMPORTANT:** Always get fresh credentials immediately before starting the container. STS session tokens expire after ~15 minutes, and the Nolia pipeline can take 30-60 minutes with real documents. Expired tokens cause `ExpiredToken` errors on all AWS calls mid-pipeline.

```bash
eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)" && \
source /Users/nathandouglas/arcanum/numa/.env 2>/dev/null; \
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
  numa-workspace-agent:latest
```

Wait ~10s for startup (OpenTelemetry detector timeouts), then verify:

```bash
sleep 10 && docker logs workspace-test 2>&1 | tail -5
```

---

## Test 1: No Document (KB + Rules + Template Verification)

Verifies the workspace setup downloads KBs, rules files, and output template from S3. No document is uploaded so all phases will ask for a file — that's expected.

```bash
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{
    "action": "chat",
    "prompt": "Review this evaluation report for compliance with World Bank procurement rules.",
    "conversationId": "nathan-local-test-nolia-004",
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

**Expected log output (check with `docker logs workspace-test 2>&1 | grep NOLIA`):**

```
NOLIA_WORKSPACE_SETUP      — assessment_type: evaluation-report, global_kb + procurement_kb set
NOLIA_KB_DOWNLOAD           — Downloaded 4 KB files (global-knowledge-base)
NOLIA_RULES_DOWNLOAD        — global-rules.md
NOLIA_KB_DOWNLOAD           — Downloaded 33 KB files (procurement-knowledge-base)
NOLIA_RULES_DOWNLOAD        — procurement-rules.md
NOLIA_CUSTOM_TEMPLATE       — Using custom output template from procurement KB
NOLIA_WORKSPACE_SETUP_COMPLETE
NOLIA_PHASE_START           — Phase 1: EDA
NOLIA_STEP_COMPLETE         — nolia-eda (3 turns)
NOLIA_PARALLEL_START        — Phases 2+3 (nolia-global + nolia-procurement)
NOLIA_STEP_COMPLETE         — nolia-global (5 turns)
NOLIA_STEP_COMPLETE         — nolia-procurement (5 turns)
NOLIA_PHASE_START           — Phase 4a: Report generation
NOLIA_STEP_COMPLETE         — nolia-report-generate (1 turn)
NOLIA_PHASE_START           — Phase 4b: Report review
NOLIA_STEP_COMPLETE         — nolia-report-review (5 turns)
NOLIA_PIPELINE_COMPLETE     — 5 steps, 19 turns, ~$0.39, ~132s
```

**Expected result:** Each phase says "no document uploaded" but the workspace has KBs and rules. Phases 2 (Global) and 3 (Procurement) specifically mention they can see the knowledge base files.

**Result location:** `s3://numa-nd-labs-outputs/v2-apps/nolia/nathan-local-test/{conversationId}/_result.json`

---

## Debug Logging (Live LLM Activity)

Add `-e LOG_LEVEL=DEBUG` to the docker run command to see live LLM messages as they happen. This shows assistant text, thinking, and tool calls in real time. **Only visible locally** — production runs at INFO level so these never appear in CloudWatch.

```bash
# Add to docker run:
-e LOG_LEVEL=DEBUG

# Then watch live activity (filtered to just LLM events):
docker logs -f workspace-test 2>&1 | grep "SDK_LIVE"

# Or with step context:
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

Log events:

- `SDK_LIVE_TEXT` — assistant text output (truncated to 300 chars)
- `SDK_LIVE_THINKING` — thinking blocks (truncated to 200 chars)
- `SDK_LIVE_TOOL` — tool calls (tool name only)

---

## Useful Log Queries

```bash
# All Nolia events
docker logs workspace-test 2>&1 | grep "NOLIA_"

# Pipeline progress only
docker logs workspace-test 2>&1 | grep -i "NOLIA_STEP\|NOLIA_PHASE\|NOLIA_PIPELINE\|NOLIA_PARALLEL"

# Workspace setup (KB downloads, template, extraction)
docker logs workspace-test 2>&1 | grep -i "NOLIA_KB\|NOLIA_RULES\|NOLIA_TEMPLATE\|NOLIA_CUSTOM\|NOLIA_WORKSPACE_SETUP\|NOLIA_EXTRACT"

# Cost per step
docker logs workspace-test 2>&1 | grep '"_name": "COST"'

# Step prompts (what user prompt each step received)
docker logs workspace-test 2>&1 | grep "NOLIA_STEP_PROMPTS"

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

# Tools used per step
docker logs workspace-test 2>&1 | grep "STREAM_COMPLETE" | python3 -c "
import sys, json, re
for line in sys.stdin:
    try:
        data = json.loads(line)
        conv = data.get('conversation_id', '')
        label = conv.split('step-')[-1] if 'step-' in conv else conv
        tool_refs = re.findall(r'\"name\": \"(Task|TaskOutput|mcp__scripts__execute_script|TodoWrite)\"', line)
        task_count = sum(1 for t in tool_refs if t in ('Task', 'TaskOutput'))
        script_count = sum(1 for t in tool_refs if t == 'mcp__scripts__execute_script')
        print(f'{label:20s} | Task/TaskOutput: {task_count:>2} | execute_script: {script_count:>2}')
    except: pass
"

# Security blocks
docker logs workspace-test 2>&1 | grep -c "permissionDecision.*deny"
```

---

## Quick Nolia Test (with PDF + debug logging)

One-liner to upload PDF, start container with debug logging, and fire the test:

```bash
# 1. Upload test PDF (only needed once per conversation ID)
AWS_PROFILE=q-demo aws s3 cp \
  "docs/tasks/numa-apps-v2/Nolia Test Document.pdf" \
  "s3://numa-nd-labs-outputs/v2-apps/nolia/nathan-local-test/nathan-local-test-nolia-NNN/uploads/Nolia Test Document.pdf" \
  --region us-east-1

# 2. Start container (with debug logging)
eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)" && \
source /Users/nathandouglas/arcanum/numa/.env 2>/dev/null; \
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

# 3. Wait for startup, health check, then fire
sleep 10 && curl -s http://localhost:8080/ping | jq . && \
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{
    "action": "chat",
    "prompt": "Review this evaluation report for compliance with World Bank procurement rules.",
    "conversationId": "nathan-local-test-nolia-NNN",
    "type": "nolia-compliance",
    "uploadPrefixes": ["v2-apps/nolia/nathan-local-test/nathan-local-test-nolia-NNN/uploads/"],
    "metadata": {
      "assessment_type": "evaluation-report",
      "global_kb": "9df246a7-925f-4cfc-a964-a6da9788ce68",
      "procurement_kb": "d3788c3d-7e85-4de3-805a-b8c73f6ddaf3",
      "project_kb": "",
      "output_language": "english"
    }
  }' &

# 4. Watch live progress in another terminal
docker logs -f workspace-test 2>&1 | grep "SDK_LIVE\|NOLIA_STEP\|NOLIA_PHASE\|NOLIA_PIPELINE"
```

Replace `NNN` with the round number (e.g., `010` for Round 5).
