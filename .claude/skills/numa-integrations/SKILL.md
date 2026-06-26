---
name: numa-integrations
description: Pipedream Connect integrations system — cross-account proxy model, relay pattern, admin policies, workspace agent tools, frontend service. Use when working on integrations, Pipedream proxy/relay, MCP tool policies, integration prompts, admin settings, adding new SaaS integrations, or debugging integration flows.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Numa Integrations (Pipedream Connect)

Numa integrates with 35+ external SaaS tools through Pipedream Connect, using a secure cross-account proxy model. OAuth credentials are centralized in a dedicated Arcanum-owned AWS account (965745962688) and never deployed into client accounts.

## Architecture Overview

```
Browser (Frontend)
    │
    ├── [Connect/Disconnect] ──► Relay Lambda (client account) ──► Proxy Lambda (proxy account 965745962688)
    │                                  │                                    │
    │                                  │ STS proof URL                     │ Pipedream API
    │                                  │ (identity verification)           │ (OAuth tokens, actions, MCP)
    │                                  │                                    │
    │                                  ├── Policy Store (DynamoDB)          ├── Secrets Manager
    │                                  │   (per-user tool policies)         │   (Pipedream OAuth creds)
    │                                  │                                    │
    │                                  └── Global Settings (DynamoDB)       ├── Security Mapping Table
    │                                      (admin allow/deny)               │   (user→account binding)
    │                                                                       │
    │                                                                       └── Allowed Accounts Table
    │                                                                           (synced hourly from deployer)
    │
    ├── [Chat with integrations] ──► Workspace Agent (AgentCore MicroVM)
    │                                       │
    │                                       ├── MCP tools: run_action, configure_props, proxy_request
    │                                       │
    │                                       └── workspace-chat-tools Lambda ──► Relay Lambda ──► Proxy Lambda
    │                                               │
    │                                               ├── Human-in-the-loop approval (DynamoDB)
    │                                               └── File path resolution (/workdir/ → presigned S3 URLs)
```

### Request Flow Summary

1. **Frontend** invokes the relay Lambda (client account) via AWS SDK
2. **Relay Lambda** generates an STS presigned GetCallerIdentity URL as cryptographic proof of caller identity
3. **Relay Lambda** invokes the proxy Lambda (proxy account) cross-account, passing the STS proof
4. **Proxy Lambda** validates: STS URL freshness → caller identity → account in allowlist → role name matches regex → security mapping (user→account binding)
5. **Proxy Lambda** executes the Pipedream API operation using centralized OAuth credentials from Secrets Manager
6. Response flows back through the same chain

### Key Security Properties

- **OAuth credential isolation**: Pipedream client_id/client_secret live only in the proxy account's Secrets Manager
- **Account allowlisting**: Only accounts synced from the deployer's `numa-client-config` table are permitted
- **Identity verification**: STS presigned URL proves caller identity cryptographically (max 60s expiry, 2min max age)
- **Role regex validation**: Only roles matching `^[a-zA-Z0-9-]+_(?:pipedream-relay|ws[_-]agent|chat[_-]agent)$` are accepted
- **User-account binding**: First request creates a mapping; subsequent requests from a different account are rejected
- **Tool-level policies**: Admins can globally deny specific tools; users can further restrict per-integration

## Key Components

| Component                       | Location                                                                        | Purpose                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Proxy Lambda**                | `/lambdas/python/pipedream-proxy/`                                              | Cross-account proxy; validates callers; calls Pipedream API                           |
| **Relay Lambda**                | `/lambdas/python/pipedream-relay/`                                              | Client-side relay; generates STS proof; forwards to proxy; handles local policy ops   |
| **Account Sync Lambda**         | `/lambdas/python/pipedream-account-sync/`                                       | Hourly sync of allowed accounts from deployer DynamoDB                                |
| **Admin Settings Lambda**       | `/lambdas/node/admin-integration-settings/`                                     | CRUD for global integration enable/disable + deny tool lists                          |
| **Proxy Stack**                 | `/infra/stacks/pipedream-proxy-stack.ts`                                        | CDKTF stack for proxy account (Lambda, DynamoDB tables, Secrets Manager, EventBridge) |
| **Client Stack (relay wiring)** | `/infra/constructs/core-numa-infra-construct.ts`                                | Creates relay Lambda, policy tables, global settings table in client account          |
| **Workspace Agent MCP Tools**   | `/services/numa-workspace-agent/numa_workspace_agent/mcp_tools/integrations.py` | `run_action`, `configure_props`, `proxy_request` tools for the Claude agent           |
| **Workspace Chat Tools Lambda** | `/lambdas/python/workspace-chat-tools/tools/pipedream_integration.py`           | Bridges workspace agent → relay Lambda; handles approval, file paths, stash downloads |
| **Frontend Service**            | `/numa-frontend/src/Services/PipedreamProxyService.ts`                          | TypeScript service for all frontend→relay Lambda calls                                |
| **Integrations Page**           | `/numa-frontend/src/Pages/NumaIntegrations.tsx`                                 | User-facing connect/disconnect UI with admin policy settings                          |
| **Types**                       | `/numa-frontend/src/types/pipedream.ts`                                         | TypeScript type definitions for all Pipedream operations                              |
| **Config**                      | `/numa-frontend/src/config/integrationsConfig.ts`                               | UI metadata for all integrations (icons, names, descriptions)                         |
| **Tool Defaults**               | `/numa-frontend/src/config/integrationToolsDefault.ts`                          | Default deny lists per integration (applied on first connect)                         |
| **Integration Prompts**         | `/services/numa-workspace-agent/integration-prompts/`                           | Per-integration markdown files injected into the agent system prompt                  |
| **Integrations Registry**       | `/infra/config/integrations.ts`                                                 | Single source of truth for supported integration slugs                                |
| **Admin Service**               | `/numa-frontend/src/Services/AdminIntegrationsService.ts`                       | Frontend service for admin global integration settings                                |

## Supported Integrations

The canonical list lives in `/infra/config/integrations.ts` (`SUPPORTED_INTEGRATIONS` array) — **always check that file, this snapshot drifts.** As of the last skill update (63 integrations):

gmail, microsoft_outlook, microsoft_outlook_calendar, slack, google_calendar, xero_accounting_api, hubspot, notion, apollo_io, pipedrive, jira, linkedin, google_drive, google_analytics, sharepoint, salesforce_rest_api, asana, onenote, trello, whatsapp_business, mailchimp, freshdesk, rentman, podio, google_sheets, google_forms, google_docs, telegram_bot_api, microsoft_teams, zoom, microsoft_excel, smartsheet, box, zoho_books, odoo, jobber, canva, google_tag_manager, webflow, dropbox, survey_monkey, monday, procore, quickbooks, harvest, alchemer, microsoft_sql_server, microsoft_dynamics_365_sales, dynamics_365_business_central_api, clickup, google_ads, zoho_crm, microsofttodo, fathom, elevenlabs, heygen, gitlab, github, airtable_oauth, google_slides, todoist, google_my_business, streak

Slug naming note: the slug is the Pipedream app's `name_slug` exactly (e.g. `airtable_oauth` keeps its `_oauth` suffix). Verify against Pipedream's registry before adding — see Step 1.

## Supported Operations

The proxy Lambda supports these operations:

| Operation                | Description                                                 | Requires Approval |
| ------------------------ | ----------------------------------------------------------- | ----------------- |
| `generate_connect_token` | Get a Pipedream OAuth connect token for the user            | No                |
| `get_integration_status` | List user's connected integrations and health               | No                |
| `create_mcp_client`      | Get MCP server connection details for an app                | No                |
| `disconnect_integration` | Delete connected accounts (by app_name or account_id)       | No                |
| `list_mcp_tools`         | List tools exposed by an app's MCP server                   | No                |
| `list_actions`           | List all available Pipedream actions for an app             | No                |
| `run_action`             | Execute a Pipedream action (e.g., send email, create issue) | **Yes**           |
| `configure_props`        | Get dynamic dropdown options for action props               | No                |
| `proxy_request`          | Make a raw API call through Pipedream's OAuth proxy         | **Yes**           |

Local-only operations (handled by relay, never forwarded to proxy):

| Operation        | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `get_mcp_policy` | Read per-user tool policy for an integration                 |
| `set_mcp_policy` | Write per-user tool policy (validated against global denies) |

## DynamoDB Tables

### Proxy Account (965745962688)

| Table                        | Key                                      | Purpose                                         |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------- |
| `pipedream-user-mappings`    | `external_user_id` (GSI on `account_id`) | Security: binds user IDs to client accounts     |
| `pipedream-allowed-accounts` | `account_id`                             | Allowlist of client accounts (ACTIVE/SUSPENDED) |

### Client Account (per-client)

| Table                                  | Key           | Purpose                                                 |
| -------------------------------------- | ------------- | ------------------------------------------------------- |
| `{client}-mcp-tool-policies`           | `pk` + `sk`   | Per-user, per-integration tool deny lists               |
| `{client}-global-integration-settings` | `integration` | Admin-level enable/disable + global deny tool lists     |
| `{client}-integrations-approval`       | `approval_id` | Human-in-the-loop approval records for write operations |

### Policy Table Key Schema

The `mcp-tool-policies` table uses a composite key:

- **pk**: `CLIENT#{clientName}#USER#{cognitoSub}`
- **sk**: `INTEGRATION#{appName}`
- **mode**: `"deny"` (default) — tools in `denyTools` are blocked; all others allowed
- **denyTools**: `string[]` — list of tool names to block

## Feature Flags

The `PIPEDREAM_INTEGRATIONS` feature flag in the client's config controls the entire system:

- **Frontend**: `getFlag('PIPEDREAM_INTEGRATIONS')` gates the `/integrations` route, chat integration UI, agent builder integration options, and user profile connection status
- **Session Storage**: `PIPEDREAM_RELAY_LAMBDA_ARN` is set by `ConfigSetup.tsx` from `config.json` — if absent, the integrations page enters "preview mode" (shows available integrations but no connect buttons)
- **Infrastructure**: `props.pipedreamIntegrations` in the client stack controls whether the relay Lambda, policy tables, and global settings table are created

## Admin Policy Configuration

### Global Settings (Admin → All Users)

Admins configure integration availability via the Settings page (`/settings` → Integrations tab):

1. **Enable/Disable**: Toggle each integration on/off globally. Disabled integrations cannot be connected by any user.
2. **Tool Deny List**: Block specific tools within an enabled integration (e.g., block `slack-archive-channel` while allowing all other Slack tools).

Storage: `{client}-global-integration-settings` DynamoDB table.
API: `GET/PUT /api/settings/integrations/{integration}` via `admin-integration-settings` Lambda.

### Per-User Policies (User → Self)

Users can further restrict tools for their own connected integrations via the integration settings modal on the Integrations page:

1. View all available tools for a connected integration
2. Toggle individual tools on/off
3. Cannot override admin global denies (enforced server-side by relay)

Storage: `{client}-mcp-tool-policies` DynamoDB table.
Operations: `get_mcp_policy` / `set_mcp_policy` handled locally by the relay Lambda.

### Default Deny Lists

When a user first connects an integration, default deny lists from `/numa-frontend/src/config/integrationToolsDefault.ts` are applied. These block tools that are dangerous or rarely useful (e.g., `slack-archive-channel`, `hubspot-delete-a-workflow`).

## Human-in-the-Loop Approval

Write operations (`run_action`, `proxy_request`) go through approval:

1. **Workspace agent** calls `run_action` with a `description` parameter explaining what will happen
2. **workspace-chat-tools Lambda** creates an approval request in the `{client}-integrations-approval` DynamoDB table
3. **Frontend** receives the approval request via streaming and shows an approval card to the user
4. **User** approves or denies (90-second timeout)
5. **workspace-chat-tools Lambda** polls the approval table and proceeds or rejects

The approval ID is deterministic (passed from the SDK runner) to handle parallel tool calls. The `NUMA_REQUEST_ID_MAP` environment variable maps action keys to approval IDs.

Auto-approval mode (`NUMA_APPROVAL_MODE=auto`) can be set for agent-scheduled runs.

## Integration Prompts (Workspace Agent)

Per-integration prompt files in `/services/numa-workspace-agent/integration-prompts/` are injected into the workspace agent's system prompt when the corresponding integration is connected. These are **optional** — only a subset of supported integrations has one (run `ls services/numa-workspace-agent/integration-prompts/` for the current set; it covers the common ones like `gmail.md`, `slack.md`, `jira.md`, `notion.md`, the Google/Microsoft suites, `hubspot.md`, `pipedrive.md`, etc.). Add one only when the agent genuinely needs guidance — they're meant to capture real gotchas, which are hard to write well without a connected account to test against.

These files contain integration-specific tips, gotchas, and usage patterns. The build function is `_build_integrations_context()` in `prompts-with-sub-agents.py`.

Format: Standard markdown. The filename must match the integration slug exactly (e.g., `google_drive.md` for the `google_drive` integration).

## External User ID Format

The external user ID format used across the system is: `{clientName}_{cognitoSub}`

- Constructed by `PipedreamProxyService.deriveExternalUserId()` on the frontend
- Validated by the proxy Lambda (must contain at least one underscore)
- Used as the Pipedream Connect external_user_id and as the key in security mapping

## How to Add a New Integration

### Step 0: Verify the slug + grab metadata from Pipedream

Before touching code, confirm the slug exists and pull its real name/auth type/icon URL from Pipedream's registry. Creds + a working script live in `dev-notes/research/integrations/` (uses `PIPEDREAM_CLIENT_ID`/`PIPEDREAM_CLIENT_SECRET`/`PROJECT_ID` from the repo-root `.env`). The apps endpoint `GET https://api.pipedream.com/v1/apps?q={slug}` returns `name`, `name_slug`, `auth_type` (`oauth` vs `keys`), and `img_src` (a usable logo URL — no need to hunt for icons manually; download it straight into `src/assets/icons/`). Note: some `img_src` URLs serve a different format than the extension implies (e.g. a JPEG/SVG at a `.png` URL) — check with `file` and rename to match, since Vite resolves the asset loader by extension.

### Step 1: Add to the Supported Integrations Registry

File: `/infra/config/integrations.ts`

Add the Pipedream app slug (e.g., `'monday'`) to the `SUPPORTED_INTEGRATIONS` array. This is the single source of truth that propagates to the proxy Lambda's `SUPPORTED_INTEGRATIONS` env var.

> ⚠️ **Mirror the slug in Python — same commit.** The slug set is duplicated in `lambdas/python/workspace-chat-tools/tools/user_profile.py` (`_PIPEDREAM_INTEGRATION_SLUGS`) for memory-scope validation — that Lambda can't import the TS file. Add/rename a slug in `integrations.ts` → add it there too, or `integration:{slug}` memory scopes silently fail validation. The header comment in `integrations.ts` calls this out.

### Step 2: Add Frontend Config Entry

File: `/numa-frontend/src/config/integrationsConfig.ts`

Add an icon import at the top, then a `ConnectionConfigEntry` with:

- `id`: Must match the Pipedream app slug
- `name`, `description`, `example_query`: Use i18n keys via `connectionText(...)`
- `auth_type`: `'oauth'` for OAuth apps, `'api_key'` for Pipedream `keys`-auth apps (e.g. HeyGen, Streak, ElevenLabs)
- `img_src`: Import an icon (add SVG/PNG to `src/assets/icons/`)
- `fallback_icon`: Bootstrap icon class
- `fallback_color`: Bootstrap color variant
- `hq_only`: Set `true` if this should only be visible to Arcanum admins

### Step 3: Add i18n Translations

File: `/numa-frontend/src/locales/en/integrations.json`

Add under `connections.{slug}`:

```json
{
  "connections": {
    "monday": {
      "name": "Monday.com",
      "description": "Project management and work OS",
      "example_query": "Show me my Monday boards"
    }
  }
}
```

### Step 4: Add Default Deny List (Optional)

File: `/numa-frontend/src/config/integrationToolsDefault.ts`

Add a key for the new integration with an array of tool names to deny by default:

```typescript
monday: ['monday-delete-board', 'monday-archive-board'],
```

### Step 5: Add Integration Prompt (Optional but Recommended)

File: `/services/numa-workspace-agent/integration-prompts/{slug}.md`

Create a markdown file with tips, gotchas, and usage patterns for the workspace agent. The filename must match the slug exactly. This is injected into the system prompt when a user has this integration connected.

### Step 6: Add Icon Asset

Add an SVG or PNG icon to `/numa-frontend/src/assets/icons/{slug}.svg`.

### Step 7: Deploy

1. Package the proxy Lambda: `cd lambdas && bash package-python-lambda.sh python/pipedream-proxy`
2. Package the relay Lambda: `cd lambdas && bash package-python-lambda.sh python/pipedream-relay`
3. Deploy the proxy stack: `cdktf deploy pipedream-proxy-stack`
4. Deploy the client stack(s): `cdktf deploy <client-stack>`
5. If you added an integration prompt, rebuild the workspace agent Docker image: `cd services && ./package-service.sh numa-workspace-agent`

**Note**: The Pipedream app must be configured in the Pipedream Connect project. OAuth app credentials and scopes are managed in the Pipedream dashboard, not in Numa code.

## Key Implementation Details

### Auth Prop Auto-Injection

When the workspace agent calls `run_action`, it passes `{"authProvisionId": "auto"}` for the auth prop. The proxy Lambda's `_inject_auth_provision_id()` method:

1. Finds the prop with `authProvisionId: "auto"`
2. Looks up the action schema to find the correct auth key name (some actions use `"app"`, others use the slug like `"jira"`)
3. Matches the integration slug to the user's connected Pipedream accounts
4. Replaces `"auto"` with the actual Pipedream account ID

### File Stash Handling

For actions that return files (e.g., downloading an email attachment), `stash_id="NEW"` is passed in the `run_action` call. The workspace-chat-tools Lambda handles downloading the stashed file into `/workdir/outputs/integrations-results/`.

### Workspace File Path Resolution

When `run_action` props contain `/workdir/` paths (e.g., attaching a workspace file to an email), the workspace-chat-tools Lambda converts them to presigned S3 URLs or HMAC-signed redirect URLs before forwarding to Pipedream.

### MCP Tool List Caching

The proxy Lambda caches MCP tool lists per user+app for 10 minutes (`_TOOL_LIST_TTL_SECONDS`). Action schemas are also cached for 10 minutes.

### Frontend Status Caching

`PipedreamProxyService` uses a three-layer cache for integration status:

1. In-memory Map (fastest, 30s TTL)
2. sessionStorage (survives SPA navigation, 30s TTL)
3. localStorage via SWR cache (survives page refresh, stale-while-revalidate)

## Troubleshooting

### "Access denied" on proxy invocation

- Check that the client account is in the `pipedream-allowed-accounts` table with status `ACTIVE`
- Verify the relay Lambda's IAM role name matches the regex: `^[a-zA-Z0-9-]+_(?:pipedream-relay|ws[_-]agent|chat[_-]agent)$`
- Check the STS proof URL is fresh (max 60s expiry, 2min max age)

### Integration not appearing in the UI

- Verify the slug is in `SUPPORTED_INTEGRATIONS` in `/infra/config/integrations.ts`
- Verify the config entry exists in `integrationsConfig.ts`
- Check the `PIPEDREAM_INTEGRATIONS` feature flag is `true` in the client's config
- Check that `PIPEDREAM_RELAY_LAMBDA_ARN` is in sessionStorage (set by ConfigSetup)

### "Integration not enabled" error in chat

- The admin has not enabled the integration in Settings → Integrations
- The user has not connected the integration on the Integrations page
- The `NUMA_ENABLED_INTEGRATIONS` env var in the workspace agent does not include the slug

### Action fails with "No connected account found"

- The user's Pipedream account for this integration may have expired or been revoked
- The auth prop key name doesn't match (proxy auto-resolves via schema lookup, but edge cases exist)
- Check the Pipedream dashboard for account health

### Approval timeout (90s)

- The user didn't respond to the approval card in the chat UI
- Check if `NUMA_APPROVAL_MODE` should be set to `auto` for this use case (e.g., scheduled agent runs)

### Account sync not updating

- Check the `pipedream-account-sync` Lambda logs: `/aws/lambda/pipedream-account-sync`
- Verify the EventBridge rule `pipedream-account-sync-schedule` is enabled
- Verify the sync Lambda has cross-account DynamoDB access to `numa-client-config` table in the deployer account
- The sync Lambda uses DynamoDB resource policy for cross-account access (no role assumption)

### CloudWatch Log Groups

| Lambda               | Log Group                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Proxy                | `/aws/lambda/pipedream-proxy`                                                              |
| Account Sync         | `/aws/lambda/pipedream-account-sync`                                                       |
| Relay                | `/aws/lambda/{clientName}-pipedream-relay` (in client account, under the shared log group) |
| Admin Settings       | Part of client API Gateway Lambda                                                          |
| Workspace Chat Tools | `/aws/lambda/{clientName}-workspace-chat-tools`                                            |
