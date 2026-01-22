---
name: workspace-agent-local-test
description: Test numa-workspace-agent Docker container locally. Use when asked to test workspace agent, run workspace agent locally, debug workspace agent, or test SDK integration.
allowed-tools: Bash, Read, Write, Glob
---

# Workspace Agent Local Testing

## Purpose

Test the numa-workspace-agent container locally before deploying to AgentCore. This skill helps build, run, and test the container with proper AWS credentials.

## Prerequisites

- Docker installed and running
- AWS CLI configured with a profile that can access Bedrock (e.g., `q-demo`)
- The container image built via `./package-service.sh numa-workspace-agent`

## Instructions

### Step 1: Build the Container

```bash
cd /Users/nathandouglas/arcanum/numa/services/numa-workspace-agent
./package-service.sh numa-workspace-agent
```

This creates `image.tar` in `infra/assets/artifacts/numa-workspace-agent/`.

### Step 2: Load the Image

```bash
docker load -i /Users/nathandouglas/arcanum/numa/infra/assets/artifacts/numa-workspace-agent/image.tar
```

Note the image name from the output (e.g., `numa-workspace-agent:latest`).

### Step 3: Get AWS Credentials

The `q-demo` profile assumes into a dev account (905418183804) which has Bedrock access:

```bash
# Get credentials from the q-demo profile (dev account with Bedrock access)
CREDS=$(aws sts assume-role \
  --role-arn arn:aws:iam::905418183804:role/OrganizationAccountAccessRole \
  --role-session-name local-test \
  --query 'Credentials' \
  --output json)

export AWS_ACCESS_KEY_ID=$(echo $CREDS | jq -r .AccessKeyId)
export AWS_SECRET_ACCESS_KEY=$(echo $CREDS | jq -r .SecretAccessKey)
export AWS_SESSION_TOKEN=$(echo $CREDS | jq -r .SessionToken)
```

### Step 4: Run the Container

```bash
docker run -d --rm --name workspace-test \
  -p 8080:8080 \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_REGION=us-east-1 \
  -e CLIENT_NAME=nd-labs \
  -e CLAUDE_CODE_USE_BEDROCK=1 \
  numa-workspace-agent:latest
```

Wait a few seconds for startup, then check logs:
```bash
docker logs workspace-test 2>&1 | tail -20
```

### Step 5: Test the Endpoints

**Health check:**
```bash
curl -s http://localhost:8080/ping | jq .
```

Expected: `{"status":"Healthy","time_of_last_update":...}`

**Chat request:**
```bash
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: test-user-123" \
  -d '{"action":"chat","prompt":"Hello","conversationId":"test-123"}'
```

**IMPORTANT:** Avoid special characters like `!` in prompts - bash escapes them as `\!` causing JSON parse errors.

Expected output: NDJSON stream with events:
- `type: "user"` - Your prompt
- `type: "system"` with `subtype: "init"` - Session initialization
- `type: "StreamEvent"` - Thinking and text deltas
- `type: "assistant"` - Full response
- `type: "result"` - Cost and usage stats

### Step 6: Stop the Container

```bash
docker stop workspace-test
```

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

### JSON Parse Error: "Invalid \escape"
**Cause:** Bash escaped special characters in the prompt (e.g., `!` becomes `\!`)
**Fix:** Use simple prompts without `!`, `$`, backticks, or other shell metacharacters

### Exit Code 1 Errors
- Check `CLAUDE_CODE_USE_BEDROCK=1` is set
- Verify AWS credentials are valid: `aws sts get-caller-identity`
- Check container logs for `SDK CLI stderr` messages (shows actual error)
- Ensure the model is accessible in us-east-1

### S3/DynamoDB Warnings
These are expected during local testing without real AWS resources. Basic chat still works.

### Container Won't Start
```bash
# Check if port 8080 is in use
lsof -i :8080

# Check for existing containers
docker ps -a | grep workspace

# Remove old containers
docker rm -f workspace-test
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_ACCESS_KEY_ID` | Yes | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | Yes | AWS credentials |
| `AWS_SESSION_TOKEN` | Yes | For assumed role credentials |
| `AWS_REGION` | Yes | AWS region (e.g., `us-east-1`) |
| `CLIENT_NAME` | Yes | Client identifier |
| `CLAUDE_CODE_USE_BEDROCK` | Yes | Must be `1` for Bedrock |
| `OUTPUTS_BUCKET_NAME` | No | S3 bucket for persistence |
| `DYNAMODB_TABLE_NAME` | No | DynamoDB table for chat history |

## Quick One-Liner Test

After loading the image and getting credentials:

```bash
docker run -d --rm --name workspace-test -p 8080:8080 \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_REGION=us-east-1 -e CLIENT_NAME=nd-labs \
  -e CLAUDE_CODE_USE_BEDROCK=1 numa-workspace-agent:latest && \
sleep 3 && \
curl -s http://localhost:8080/ping | jq . && \
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: test-user-123" \
  -d '{"action":"chat","prompt":"Hello","conversationId":"test-123"}' && \
docker stop workspace-test
```
