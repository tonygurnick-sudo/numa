# Pipedream Connect API Reference (the parts Numa uses)

Curated subset of the Pipedream Connect REST API, with Numa's wrapper layers documented. Use this as a quick reference; the canonical OpenAPI spec lives at https://pipedream.com/docs/connect.

For the full architectural picture see [`architecture.md`](./architecture.md). For trigger-specific deep-dive see [`triggers.md`](./triggers.md).

---

## Authentication

All Numa-side calls flow through our proxy → relay layer (see [`architecture.md`](./architecture.md#request-flow)). Direct browser-to-Pipedream calls don't happen — every API request goes via our wrapper.

Pipedream side: OAuth 2.0 client credentials. Single grant for the whole Numa Connect project, stored in the proxy account's Secrets Manager. The proxy fetches a fresh `access_token` via `POST /v1/oauth/token` and includes it as `Authorization: Bearer <token>` on every Pipedream API call.

All Pipedream calls also need `X-PD-Environment: production` (or `development` — we use `production` for the Numa project).

---

## Operations Numa uses

The proxy lambda exposes these as named operations. The relay forwards them after policy/identity checks. The frontend calls them via `PipedreamProxyService` (TypeScript) or the workspace-chat-tools Lambda (Python).

| Op                        | HITL?                          | Pipedream endpoint                                                    | When called                                                                        |
| ------------------------- | ------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `generate_connect_token`  | No                             | `POST /v1/connect/{project_id}/tokens`                                | User clicks Connect on `/integrations`                                             |
| `get_integration_status`  | No                             | `GET /v1/connect/{project_id}/accounts?external_user_id=...`          | Page load, status checks, source picker availability                               |
| `disconnect_integration`  | No                             | `DELETE /v1/connect/{project_id}/accounts/{account_id}`               | User disconnects, or admin force-disconnect                                        |
| `list_actions`            | No                             | `GET /v1/connect/{project_id}/actions?app=...`                        | Workspace agent action discovery                                                   |
| `list_mcp_tools`          | No                             | (Pipedream MCP server)                                                | Workspace agent tool discovery                                                     |
| `create_mcp_client`       | No                             | (Pipedream MCP server)                                                | Workspace agent connects to MCP server                                             |
| `run_action`              | **Yes**                        | `POST /v1/connect/{project_id}/actions/run`                           | Workspace agent fires an action (sends email, creates issue, etc.)                 |
| `configure_props`         | No                             | `POST /v1/connect/{project_id}/components/configure`                  | Wizard populates remote-options dropdowns. Same endpoint for actions and triggers. |
| `proxy_request`           | **Yes** when invoked from chat | Pipedream Connect Proxy — see [API_PROXY](#proxy_request)             | Custom upstream API calls (e.g. Slack `emoji.list` for icon enrichment)            |
| `list_triggers`           | No                             | `GET /v1/connect/{project_id}/triggers?app=...`                       | Wizard discovers trigger components for an app                                     |
| `deploy_trigger`          | No                             | `POST /v1/connect/{project_id}/triggers/deploy`                       | Wizard saves a new event-triggered automation                                      |
| `update_deployed_trigger` | No                             | `PUT /v1/connect/{project_id}/deployed-triggers/{trigger_id}`         | Wizard edits a trigger's props, or pause/resume                                    |
| `delete_deployed_trigger` | No                             | `DELETE /v1/connect/{project_id}/deployed-triggers/{trigger_id}`      | User deletes an automation                                                         |
| `list_deployed_triggers`  | No                             | `GET /v1/connect/{project_id}/deployed-triggers?external_user_id=...` | Diagnostic / reconciliation (not yet wired into UI)                                |

HITL = Human-in-the-loop approval, enforced at the workspace-chat-tools layer (NOT the relay). Wizard / admin UI calls bypass HITL since they're already in a UI session with explicit user intent.

---

## Endpoint quick reference

### `generate_connect_token`

Get a one-time token for the user to complete an OAuth flow.

```
POST /v1/connect/{project_id}/tokens
{
  "external_user_id": "<client>_<cognito_sub>",
  "allowed_origins": ["https://<client>.numa.arcanum.ai"]
}
```

Returns `{ token: 'ctok_xxx', expires_at: ISO }`. The frontend redirects the user to Pipedream's hosted Connect Link with this token.

### `get_integration_status`

List the user's connected accounts.

```
GET /v1/connect/{project_id}/accounts?external_user_id=<xuid>
```

Returns:

```jsonc
{
  "data": [
    {
      "id": "apn_xxx",
      "external_user_id": "<xuid>",
      "app": { "name_slug": "slack", "name": "Slack" },
      "healthy": true,
      "created_at": "...",
      // ...
    },
  ],
}
```

The frontend `PipedreamProxyService.getIntegrationStatus` normalises this into `{ connections, connected_apps }`. Three-layer cache (in-memory 30s + sessionStorage 30s + SWR-localStorage stale-while-revalidate). Don't bypass the service — you'll get rate-limited and stale-status bugs.

### `list_triggers`

```
GET /v1/connect/{project_id}/triggers?app=<slug>&limit=100
```

Returns the catalogue of trigger components for an app:

```jsonc
{
  "data": [
    {
      "key": "slack-new-keyword-mention",
      "version": "0.0.9",
      "name": "...",
      "description": "...",
      "configurable_props": [
        { "name": "slack", "type": "app", "app": "slack" },
        {
          "name": "conversations",
          "type": "string[]",
          "remoteOptions": true,
          "label": "Channels",
          "description": "...",
        },
        { "name": "keyword", "type": "string", "label": "Keyword" },
        { "name": "ignoreBot", "type": "boolean" },
      ],
    },
    // ...
  ],
}
```

The wizard joins this against the curated trigger entries in `lib/pipedream-trigger-apps.ts`. Only curated triggers are shown to users.

### `configure_props`

Same endpoint serves both action and trigger props. The proxy uses `/components/configure`; Pipedream resolves to the right component type from the `id`.

```
POST /v1/connect/{project_id}/components/configure
{
  "id": "slack-new-keyword-mention",
  "external_user_id": "<xuid>",
  "prop_name": "conversations",
  "configured_props": {
    "slack": { "authProvisionId": "apn_xxx" }
  }
}
```

Two response shapes:

```jsonc
// Most props (channels, users, etc.) — {label, value} pairs
{ "options": [{ "label": "general", "value": "C0AG75CUDRR" }, ...] }

// Slack iconEmoji, anywhere where value IS the label — flat strings
{ "stringOptions": ["fire", "thumbsup", "shipit", ...] }
```

`PipedreamProxyService.configureProp` normalises both into the unified `{label, value}` shape. If you call the endpoint directly without going through the service, handle both shapes.

### `deploy_trigger`

```
POST /v1/connect/{project_id}/triggers/deploy
{
  "id": "slack-new-keyword-mention",
  "external_user_id": "<xuid>",
  "configured_props": {
    "slack": { "authProvisionId": "apn_xxx" },
    "conversations": ["C0AG75CUDRR"],
    "keyword": "@Numa",
    "ignoreBot": true
  },
  "webhook_url": "https://<client>.numa.arcanum.ai/api/webhooks/pipedream-events/<secret>"
}
```

Response (the only call that returns the signing key):

```jsonc
{
  "data": {
    "id": "dc_xxx",
    "active": true,
    "configured_props": { ... },
    "webhook_signing_key": "<256-bit hex>",
    "name": "Arcanum Prod - exu_xxx",
    // ...
  }
}
```

**Persist `webhook_signing_key` immediately on the schedule record.** It's not returned by any other endpoint. If you lose it, the only recovery is delete + redeploy.

### `update_deployed_trigger`

```
PUT /v1/connect/{project_id}/deployed-triggers/{dc_xxx}
{
  "external_user_id": "<xuid>",
  "configured_props": { ... },     // for prop changes
  "active": false                  // for pause/resume — both can be in same request
}
```

Returns the updated component. Empirically verified to PRESERVE `dc_xxx` and the existing signing key — no need to re-deploy on edit.

### `delete_deployed_trigger`

```
DELETE /v1/connect/{project_id}/deployed-triggers/{dc_xxx}?external_user_id=<xuid>
```

Returns 204 on success or 404 if already deleted. The proxy treats both as success.

### `proxy_request`

Used to call any upstream API authenticated with a user's Pipedream-managed OAuth grant. Rare in the trigger flow; one notable use is Slack `emoji.list` for icon enrichment in the wizard.

```
GET /v1/connect/{project_id}/proxy/{base64url(upstream_url)}?external_user_id=<xuid>&account_id=<apn_xxx>
```

Pipedream injects the OAuth token into the upstream call automatically. The base64-url encoding of the URL is required for the REST API; the SDK handles it for you. Headers prefixed with `x-pd-proxy` are forwarded; everything else is consumed by Pipedream.

Frontend usage via `PipedreamProxyService.proxyRequest`:

```typescript
const response = await PipedreamProxyService.proxyRequest<SlackEmojiListResponse>(lambdaClient, externalUserId, {
  accountId: 'apn_xxx',
  method: 'GET',
  upstreamUrl: 'https://slack.com/api/emoji.list',
});
```

Workspace-agent usage (from the chat tools layer) goes through HITL approval since it's a write-capable surface.

---

## Webhook delivery format

Pipedream POSTs to our receiver URL with:

### Headers

| Header                  | Purpose                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `x-pd-signature`        | `t={ts},v1={hex}` HMAC-SHA256 over `{ts}.{rawBody}` using the per-trigger key.     |
| `x-pd-emitter-id`       | `dc_xxx` — the deployed trigger ID. Used to look up the schedule.                  |
| `x-pd-external-user-id` | The `external_user_id` we provided at deploy time. Cross-checked against schedule. |
| `Content-Type`          | `application/json`                                                                 |

### Body

The raw event payload from the upstream component. Shape varies per app:

```jsonc
// Example: slack-new-keyword-mention
{
  "type": "message",
  "channel": "C0AG75CUDRR",
  "channel_name": "codespace", // present when resolveNames: true
  "user": "U0123456",
  "user_name": "nathan", // present when resolveNames: true
  "text": "Hey @Numa what's up",
  "ts": "1733289123.456789",
}
```

### HMAC verification

The signing key is per-deployed-trigger (different for every `dc_xxx`). Stored on the schedule record at deploy time. Verification:

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

function verify(rawBody: string, signatureHeader: string, signingKey: string, maxAgeSeconds = 300): boolean {
  const match = signatureHeader.match(/^t=(\d+),v1=([0-9a-f]+)$/);
  if (!match) return false;
  const [, tsStr, providedHex] = match;
  const ts = parseInt(tsStr, 10);
  if (Math.abs(Date.now() / 1000 - ts) > maxAgeSeconds) return false; // replay protection
  const computed = createHmac('sha256', signingKey).update(`${ts}.${rawBody}`).digest('hex');
  return (
    computed.length === providedHex.length &&
    timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(providedHex, 'hex'))
  );
}
```

The receiver implements this. Don't roll your own; reuse `verifyPipedreamSignature` from `lambdas/node/pipedream-event-receiver/index.ts`. It's exported for reuse.

---

## Empirical findings

Verified via the probe scripts in `dev-notes/tasks/pipedream-triggers/` (Arcanum-internal credentials only). Documented here so future devs don't need to re-run.

| Behavior                                                  | Verdict                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `update_deployed_trigger` preserves `dc_xxx`              | ✅ Confirmed                                                                                                 |
| `update_deployed_trigger` preserves `webhook_signing_key` | ✅ Confirmed                                                                                                 |
| Active-toggle preserves both                              | ✅ Confirmed                                                                                                 |
| `webhook_signing_key` is retrievable after deploy         | ❌ NOT RETRIEVABLE. Only returned at deploy time. Lose it = redeploy.                                        |
| Pipedream retries failed webhook deliveries               | ❌ DOES NOT RETRY. Single delivery, no DLQ.                                                                  |
| Bad `apn_xxx` in deploy returns specific error            | ❌ Returns generic 500 — wrap with our own error.                                                            |
| `configure_props` returns same shape for actions/triggers | ✅ Both can return `options` or `stringOptions` (must handle both).                                          |
| `delete_deployed_trigger` of a missing trigger            | Returns 404 — proxy treats as success (idempotent delete).                                                   |
| Configure-props auth context required                     | Pipedream silently returns 0 options if no `app` prop with auth — must inject `{ authProvisionId: 'auto' }`. |
| `emoji.list` returns standard Slack emoji                 | ❌ Returns customs and aliases ONLY. Standard ones rendered client-side from unicode.                        |

---

## Where the wrapper layers live

| Layer                | Location                                                                       |
| -------------------- | ------------------------------------------------------------------------------ |
| Frontend service     | `numa-frontend/src/Services/PipedreamProxyService.ts`                          |
| Frontend types       | `numa-frontend/src/types/pipedream.ts`                                         |
| Relay (Python)       | `lambdas/python/pipedream-relay/lambda_function.py`                            |
| Proxy (Python)       | `lambdas/python/pipedream-proxy/lambda_function.py`                            |
| Proxy operations     | `lambdas/python/pipedream-proxy/pipedream_operations.py`                       |
| Trigger lifecycle    | `lambdas/node/agent-schedules/pipedream-trigger-lifecycle.ts`                  |
| Trigger receiver     | `lambdas/node/pipedream-event-receiver/index.ts`                               |
| Workspace-agent MCP  | `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/integrations.py` |
| Workspace-chat tools | `lambdas/python/workspace-chat-tools/tools/pipedream_integration.py`           |
