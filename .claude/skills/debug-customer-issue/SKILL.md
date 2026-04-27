---
name: debug-customer-issue
description: Debug customer-reported issues in Numa. Use when investigating a customer bug, integration error, chat failure, workspace agent issue, or any production incident. Covers log gathering, user lookup, timeline reconstruction, and root cause analysis.
---

# Debug Customer Issue

## Purpose

Structured process for investigating customer-reported issues in Numa. Covers the full chain from identifying the customer and user, through log gathering, to root cause analysis and fix.

## Prerequisites

Before starting, gather from the reporter:

- **Customer/client name** (e.g., "mexted", "av-media")
- **User email or name** (to look up their Cognito sub)
- **Approximate time** of the issue (and timezone -- NZ customers are NZDT/NZST)
- **What they were doing** (chat, app, integration, etc.)
- **Error message or screenshot** if available

## Step 1: Set Up Access

### AWS Profile

Check if a profile exists for the client account in `~/.aws/config`. If not, create one:

```
[profile {client-name}]
role_arn = arn:aws:iam::{account-id}:role/ArcanumAIAccess
source_profile = arcanum-q-deployer-prod
region = {region}
```

To find the account ID and region, use:

```bash
cd tools && AWS_PROFILE=arcanum-q-deployer-prod yarn retrieve-config {client-name}
```

Common regions: `us-east-1` (most clients), `ap-southeast-2` (Sydney/NZ clients), `ap-southeast-3` (Nolia/Jakarta).

### Task Folder

Create a working folder for notes and artifacts:

```bash
mkdir -p dev-notes/tasks/{client}-{issue-slug}
```

## Step 2: Identify the User

Look up the user's Cognito sub:

```bash
# Find the user pool
AWS_PROFILE={client} aws cognito-idp list-user-pools --max-results 10 --region {region} \
  --query "UserPools[].{Id:Id,Name:Name}" --output table

# Look up user by email
AWS_PROFILE={client} aws cognito-idp list-users \
  --user-pool-id {pool-id} --region {region} \
  --filter "email = \"{user-email}\"" \
  --query "Users[0].{Username:Username,Sub:Attributes[?Name=='sub'].Value|[0],Email:Attributes[?Name=='email'].Value|[0],Status:UserStatus}"
```

The `sub` is the key identifier used across all logs and data.

## Step 3: Convert Timezone

NZ customers report times in NZDT (UTC+13) or NZST (UTC+12). Convert to UTC for log queries:

- 2 PM NZDT = 1 AM UTC (same day)
- 2 PM NZST = 2 AM UTC (same day)

Search a window of +/- 1 hour around the reported time to account for imprecise reporting.

## Step 4: Gather Logs

### Key Log Groups (per client)

| Log Group                                             | What It Contains                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/numa/{clientName}/workspace-chat-agent`             | Container logs -- richest data. Chat requests, tool calls, errors, costs, conversation flow |
| `/aws/lambda/{clientName}-workspace-chat-agent-proxy` | Proxy Lambda -- request routing, auth validation                                            |
| `/aws/lambda/{clientName}_workspace-chat-tools`       | Tools Lambda -- KB queries, integration calls, content extraction                           |

### Useful Filter Patterns

```bash
# Set time window (epoch ms) -- ALWAYS use python3 for date->epoch conversion.
# macOS `date -j -f` is unreliable and silently produces wrong values.
START_TIME=$(python3 -c "from datetime import datetime,timezone; print(int(datetime(2026,4,24,0,0,tzinfo=timezone.utc).timestamp()*1000))")
END_TIME=$(python3 -c "from datetime import datetime,timezone; print(int(datetime(2026,4,25,0,0,tzinfo=timezone.utc).timestamp()*1000))")
# Or if you already have an epoch ms value (e.g. from DynamoDB), use it directly:
# START_TIME=1776950000000

# Filter by user sub
AWS_PROFILE={client} aws logs filter-log-events \
  --log-group-name "/numa/{clientName}/workspace-chat-agent" \
  --region {region} \
  --start-time $START_TIME --end-time $END_TIME \
  --filter-pattern "{user-sub}" \
  --max-items 50 --query "events[].message" --output json

# Filter by error/specific terms
--filter-pattern "?error ?ERROR ?exception ?timeout"

# Filter by log name (structured logs use _name field)
--filter-pattern "STREAM_COMPLETE"
--filter-pattern "COST"
--filter-pattern "external_user_id"

# Combine: user + errors
--filter-pattern "{user-sub-prefix} ?error ?ERROR"
```

### What to Look For

**In workspace agent logs (`/numa/{client}/workspace-chat-agent`):**

- `INTEGRATION_TOOLS_CONFIGURED` -- what integrations/tools were enabled for the session
- `SDK_ENV_TOOLS` -- env vars passed to the SDK subprocess
- `WORKSPACE_TOOL_INVOKE` -- tool Lambda invocations
- `APPROVAL_DECISION` -- approval mode and auto_approved status
- `STREAM_COMPLETE` -- full conversation flow including thinking, tool calls, and text responses
- `Tool validation error` -- validation failures in tool handlers
- `COST` -- token usage and cost per request

**In tools Lambda logs (`/aws/lambda/{client}_workspace-chat-tools`):**

- `Received tool request` -- incoming tool calls with params
- `Pipedream integration tool access validated/denied` -- integration access checks
- `Executing tool` -- tool execution start
- Error responses with status codes

**In proxy Lambda logs (`/aws/lambda/{client}-workspace-chat-agent-proxy`):**

- Auth failures
- Routing errors
- AgentCore session issues

### Integration-Specific Logs

For Pipedream integration issues, also check the proxy account:

```bash
# Pipedream proxy Lambda (cross-account, profile: pipedream-proxy)
AWS_PROFILE=pipedream-proxy aws logs filter-log-events \
  --log-group-name "/aws/lambda/pipedream-proxy" \
  --region us-east-1 \
  --start-time $START_TIME --end-time $END_TIME \
  --filter-pattern "{external_user_id}" \
  --max-items 50 --query "events[].message" --output json
```

The external*user_id format is `{clientName}*{user-sub}`.

## Step 5: Trace the Call Chain

For integration issues, the full call chain is:

```
workspace-agent (container)
  -> workspace-chat-tools Lambda (approval polling, tool dispatch)
    -> pipedream-relay Lambda (client account, STS proof)
      -> pipedream-proxy Lambda (proxy account 965745962688, security validation)
        -> Pipedream Connect API (30s HTTP timeout)
          -> Upstream API (e.g., Xero, Gmail, Slack)
```

Identify which layer the error originates from. Work from the inside out -- if the workspace agent logs show the error, check if the call even reached the tools Lambda. If the tools Lambda shows it, check if it reached the relay/proxy.

## Step 6: Reproduce (If Needed)

Write test scripts in the task folder to reproduce independently:

- Direct API calls to the upstream service (bypass all Numa layers)
- Pipedream proxy calls (bypass the workspace agent)
- Compare results to isolate which layer introduces the failure

## Step 7: Document Findings

Write `notes.md` in the task folder with:

- Summary of the issue
- Key data (customer, account ID, user sub, timestamps)
- Root cause analysis
- Endpoint/call test results if applicable
- Actions checklist (what's fixed, what's pending)
- Files changed

If customer communication is needed, draft messages in the task folder:

- `draft-client-message.md` -- message to the customer
- `draft-support-ticket.md` -- if the issue is upstream (e.g., third-party API bug)

## Common Patterns

### "Integration connected but not working"

Check `INTEGRATION_TOOLS_CONFIGURED` log -- `enabled_integrations` may be empty. User likely didn't toggle the integration on in chat settings. Not a platform bug.

### "Timeout" reports

Could be:

1. Approval card timeout (90s polling) -- user didn't click approve
2. Pipedream proxy timeout (30s HTTP) -- upstream API slow
3. Lambda timeout -- check Lambda duration in logs

### "Permission denied" / 403 errors

Check:

1. Is the integration actually connected? (Pipedream account status)
2. Is the upstream API rejecting the credentials? (Check proxy logs for HTTP status)
3. Is it an AWS IAM issue? (Check STS proof validation in proxy logs)

## AWS Profiles Reference

| Profile                   | Account      | Purpose                                   |
| ------------------------- | ------------ | ----------------------------------------- |
| `q-demo`                  | 905418183804 | Dev/demo stacks, most dev client accounts |
| `arcanum-q-deployer-prod` | 207567759910 | Deployer account, client config table     |
| `pipedream-proxy`         | 965745962688 | Pipedream integration proxy               |
| Client profiles           | Varies       | Created per-client as needed              |
