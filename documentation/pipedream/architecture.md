# Pipedream in Numa: Architecture

How Pipedream Connect is wired into Numa: AWS account topology, request flow, account binding, security boundaries, and the proxy/relay model.

This document is reference-style. For the task-oriented "I want to add X" guides, see the `numa-integrations` and `numa-triggers` skills.

---

## AWS account topology

Numa runs across several AWS accounts:

| Account                        | ID           | Purpose                                                                                                                             |
| ------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Pipedream proxy**            | 965745962688 | Owned by Arcanum. Hosts the Pipedream OAuth credentials in Secrets Manager and the proxy Lambda. NEVER deploys to client accounts.  |
| **Numa deployer (Q Deployer)** | 207567759910 | Holds the central `numa-client-config` table and the Customer Success Portal. Assumes roles into client accounts to deploy.         |
| **Per-client accounts**        | (one each)   | One AWS account per Numa client. Hosts the relay Lambda that forwards Pipedream calls and the per-client integration policy tables. |

The Pipedream proxy account is the **only** place Pipedream OAuth credentials exist. Client accounts can't talk to Pipedream directly — they talk to the relay, which talks to the proxy.

---

## Request flow

### Outbound (Numa → Pipedream)

This is the path used by the workspace agent (run an action), the admin UI (connect/disconnect, list tools), and the Automations builder (list triggers, configure props, deploy/update/delete triggers).

```
Browser  →  Relay Lambda          →  Proxy Lambda            →  Pipedream API
           (client account)          (proxy account)
              │                         │                       │
              │ STS proof URL           │ Validates STS proof    │ Returns OAuth tokens / actions / MCP / triggers
              │ (cryptographic          │ Looks up OAuth secret  │
              │  identity)              │ Calls Pipedream        │
              │                         │                       │
              ↓                         ↓                       ↓
           Local policy /            Per-user / per-account
           settings tables          binding tables
```

Step-by-step:

1. **Browser** invokes the relay Lambda (in the client account) via the AWS SDK.
2. **Relay Lambda** generates an STS presigned `GetCallerIdentity` URL — cryptographic proof of the caller's identity. Forwards the call cross-account to the proxy Lambda, including the proof.
3. **Proxy Lambda** validates:
   - STS URL is fresh (≤60s expiry, ≤2min total age)
   - Caller identity matches expected Numa role pattern (`^[a-zA-Z0-9-]+_(?:pipedream-relay|ws[_-]agent|chat[_-]agent)$`)
   - Caller's AWS account is in the allowlist (`pipedream-allowed-accounts` table, synced hourly from the deployer's `numa-client-config`)
   - User-account binding (first request creates the binding; subsequent requests from a different account are rejected)
4. **Proxy Lambda** executes the Pipedream API operation using OAuth credentials from Secrets Manager.
5. Response flows back through relay → browser unchanged.

### Inbound (Pipedream → Numa)

This is the path used for triggers — Pipedream pushes events at us when external apps fire.

```
External app (e.g. Slack)  →  Pipedream  →  CloudFront  →  API Gateway  →  pipedream-event-receiver
                                              │
                                              │ x-pd-* headers preserved via
                                              │ AllViewerExceptHostHeader
                                              │ origin request policy
                                              │
                                              ↓
                                          /api/webhooks/pipedream-events/{secret}
```

Step-by-step:

1. The user mentions `@Numa` in Slack (or whatever event triggers the deployed Pipedream component).
2. Pipedream's component fires, signs the payload with HMAC-SHA256, and POSTs to the receiver URL with these headers:
   - `x-pd-signature`: Stripe-style `t={timestamp},v1={hex}` over `{ts}.{rawBody}`
   - `x-pd-emitter-id`: `dc_xxx` — the deployed trigger ID (used to look up the schedule)
   - `x-pd-external-user-id`: `<client>_<cognito_sub>` — used for cross-checking
3. CloudFront routes `/api/webhooks/pipedream-events/*` through the dedicated origin request policy (`AllViewerExceptHostHeader`, ID `b689b0a8-53d0-40ab-baf2-68738e2966ac`) so the `x-pd-*` headers are forwarded to API Gateway intact. **The default `/api/*` catch-all whitelists only `[authorization, x-analytics-api-key, x-api-key]` and would strip them.**
4. API Gateway invokes the receiver Lambda.
5. Receiver verifies HMAC, looks up the schedule by `dc_xxx` via the GSI, persists the raw payload to S3, invokes the dispatcher.
6. Dispatcher → runner → agent run. See [`triggers.md`](./triggers.md) for the full trigger pipeline.

Pipedream does NOT retry failed webhooks (verified empirically). The receiver's "never 5xx if avoidable" rule is real — persist to S3 BEFORE invoking the dispatcher so a transient dispatcher failure doesn't lose the event.

---

## Why the cross-account proxy?

We could call Pipedream directly from each client's relay Lambda. We don't, for three reasons:

1. **OAuth credentials are centralized.** Pipedream's `client_id` and `client_secret` live in one place (proxy account Secrets Manager). Rotating them is a single-account ops task. If a client account is compromised, OAuth credentials aren't exposed.
2. **Account allowlist is enforced server-side.** The proxy validates that the caller's AWS account ID is in `pipedream-allowed-accounts`. A rogue Lambda in some random account can't impersonate a Numa client.
3. **User-account binding prevents cross-tenant impersonation.** First time a user (`external_user_id`) is seen, the proxy records which AWS account they came from. Subsequent requests from a different account for the same user fail. This stops a compromised relay in one client account from acting on behalf of another client's user.

The cost is one extra hop on every Pipedream call. In practice this is ~100ms p99 — fine for human-driven flows; we don't put it on the chat hot path (chat tools go through workspace-chat-tools Lambda → relay → proxy with HITL approval, so the latency is dominated by the LLM, not the relay).

---

## OAuth flow (managed auth)

Pipedream's "managed auth" — Pipedream stores and refreshes OAuth tokens on our behalf. We never see the tokens.

User-side flow:

1. User on `/integrations` clicks Connect for an app.
2. Frontend calls `generate_connect_token` → relay → proxy → Pipedream returns a one-time `connect_token` (`ctok_xxx`).
3. Frontend redirects user to Pipedream's hosted Connect Link with the token. User completes OAuth on the upstream provider's site (Slack, Google, etc.).
4. Pipedream stores the OAuth grant under an account ID (`apn_xxx`) keyed by the `external_user_id` we provided.
5. Frontend polls / refreshes `get_integration_status` to see the new account appear.

Numa-side flow when calling an action or deploying a trigger:

1. Frontend / agent sends the call with `authProvisionId: "auto"` for the auth prop.
2. Proxy Lambda's `_inject_auth_provision_id()` resolves `"auto"` to the user's actual `apn_xxx` by:
   - Calling Pipedream's `list_accounts` for the `external_user_id`
   - Matching against the integration's app slug (via the action schema)
   - Replacing `"auto"` with the resolved `apn_xxx`
3. Pipedream uses the bound OAuth grant, makes the upstream API call, returns the result.

Token refresh, revocation handling, and re-auth flows are all Pipedream's problem. If a user's grant goes unhealthy (refresh failed, scopes changed, user revoked), `get_integration_status` returns `healthy: false` and the relevant UI shows a "Reconnect needed" banner.

---

## Security model

| Boundary                           | What's enforced                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Browser → relay**                | Cognito JWT auth (API Gateway custom authorizer). User-scoped IAM (relay can only read/write that user's policy + scheduling DDB items).                          |
| **Relay → proxy**                  | STS GetCallerIdentity proof URL (cryptographic identity, ≤60s freshness). Account allowlist. Role-name regex. User-account binding.                               |
| **Proxy → Pipedream**              | Single OAuth grant for the entire Numa Pipedream Connect project. Stored in proxy-account Secrets Manager.                                                        |
| **Pipedream → receiver (webhook)** | HMAC-SHA256 signature over `{timestamp}.{rawBody}` using a per-deployed-trigger signing key. Verified in the receiver before any dispatch. Constant-time compare. |
| **Receiver → schedule lookup**     | GSI key match on `dc_xxx`. Cross-checks `x-pd-external-user-id` header against the schedule's user_id (`WEBHOOK_USER_MISMATCH` if not).                           |

The receiver's HMAC verification uses the `webhook_signing_key` stored on the schedule record. **This key is only returned by Pipedream at deploy time** — `get-deployed-trigger` does NOT include it in the response. If we lose it (e.g. an update path that overwrites the trigger map without preserving lifecycle fields), the only recovery is delete + redeploy the trigger.

---

## DynamoDB tables

### Proxy account

| Table                        | Key                                      | Purpose                                                                                                  |
| ---------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pipedream-user-mappings`    | `external_user_id` (GSI on `account_id`) | Security: binds user IDs to client AWS accounts.                                                         |
| `pipedream-allowed-accounts` | `account_id`                             | Allowlist of client accounts (`ACTIVE`/`SUSPENDED`). Synced hourly from deployer's `numa-client-config`. |

### Per client account

| Table                                  | Key                                                        | Purpose                                                                                                          |
| -------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `{client}-mcp-tool-policies`           | `pk` + `sk`                                                | Per-user, per-integration tool deny lists.                                                                       |
| `{client}-global-integration-settings` | `integration`                                              | Admin-level enable/disable + global deny tool lists.                                                             |
| `{client}-integrations-approval`       | `approval_id`                                              | Human-in-the-loop approval records for write operations from chat.                                               |
| `numa-{client}-agent-schedules`        | `user_id` + `schedule_id`, GSI `deployed-trigger-id-index` | Holds both cron schedules AND event-trigger schedules. The GSI lets the receiver look up a schedule by `dc_xxx`. |

The schedules table is a single source of truth for both delivery mechanisms (cron-based and event-based). See [`triggers.md`](./triggers.md) for the GSI projection and lookup mechanics.

---

## Feature flags

Three flags compose to control where Pipedream and the Automations surface
appear. They're independent so we can roll Scheduling out without releasing
event Triggers, and Triggers without releasing the full Pipedream system.

| Flag                     | What it controls                                                                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCHEDULING`             | Master switch for the entire `/automations` route + the scheduling/triggers wizard. When off: no Automations page at all.                                                                                                              |
| `EVENT_TRIGGERS`         | The "When something happens" path of the wizard. When off: only cron schedules are offerable; the event tile is shown disabled with an admin-contact hint. Existing event automations keep firing — this gates creation, not delivery. |
| `PIPEDREAM_INTEGRATIONS` | Master switch for the Pipedream system as a whole. When off: no `/integrations` page, no Pipedream-backed triggers in the source picker (rendered disabled with reason), no Pipedream integration tools (`numa integrations`) in chat. |

Composition:

- `SCHEDULING=true, EVENT_TRIGGERS=false, PIPEDREAM_INTEGRATIONS=*` — only cron schedules.
- `SCHEDULING=true, EVENT_TRIGGERS=true, PIPEDREAM_INTEGRATIONS=false` — cron + native (Gmail) triggers. Pipedream-backed sources visible-but-disabled in the picker.
- `SCHEDULING=true, EVENT_TRIGGERS=true, PIPEDREAM_INTEGRATIONS=true` — full surface.

The relay Lambda, policy tables, and global settings table are only created when `props.pipedreamIntegrations` is true on the per-client stack. Avoid referencing them unconditionally — non-integrations clients (e.g. some Nolia stacks) will fail at deploy time. There's a follow-up to move these tables out of the conditional and into their own construct; tracked in dev notes.

Note on backend enforcement: the flag gating is frontend-only today, matching the existing pattern (`PIPEDREAM_INTEGRATIONS` isn't enforced by the relay). The agent-schedules lambda accepts any well-formed event-trigger payload regardless of the flag. For internal-only rollout this is fine because the wizard is the only way to create an event trigger; revisit if/when we expose schedule creation via API.

---

## Cost shape

Pipedream charges per "credit". 1 credit = 30 seconds of compute at 256MB. Our internal-only Numa Connect project is on the 10,000-credit plan today. Triggered-run cost shape:

- A Pipedream-side trigger sitting idle: 0 credits
- An event firing through Pipedream's emit pipeline: ~1 credit
- Deploy / update / delete a trigger: ~1 credit each
- Action call (run_action): ~1 credit, occasionally more if the upstream API is slow

In practice this is well within budget at internal-rollout scale. The reconciliation worker (sweep orphaned `dc_xxx` triggers from Pipedream) is a planned mitigation against runaway credit usage from undeleted triggers; not yet implemented.

---

## What lives where (file map)

| Component                          | Location                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| Proxy Lambda                       | `lambdas/python/pipedream-proxy/`                                              |
| Relay Lambda                       | `lambdas/python/pipedream-relay/`                                              |
| Account-sync Lambda                | `lambdas/python/pipedream-account-sync/`                                       |
| Receiver Lambda (triggers)         | `lambdas/node/pipedream-event-receiver/`                                       |
| Dispatcher Lambda (triggers)       | `lambdas/node/connector-event-dispatcher/`                                     |
| Runner Lambda (schedules+triggers) | `lambdas/node/agent-schedule-runner/`                                          |
| Schedule CRUD Lambda               | `lambdas/node/agent-schedules/`                                                |
| Admin policy CRUD Lambda           | `lambdas/node/admin-integration-settings/`                                     |
| Frontend service                   | `numa-frontend/src/Services/PipedreamProxyService.ts`                          |
| Frontend types                     | `numa-frontend/src/types/pipedream.ts`                                         |
| Integrations page                  | `numa-frontend/src/Pages/NumaIntegrations.tsx`                                 |
| Source-side registry               | `lib/event-sources.ts`                                                         |
| Pipedream-app trigger registry     | `lib/pipedream-trigger-apps.ts`                                                |
| Supported-integrations registry    | `infra/config/integrations.ts`                                                 |
| Per-integration agent prompts      | `services/numa-workspace-agent/integration-prompts/`                           |
| Workspace agent integration tool   | `numa integrations` CLI (server-side handler in workspace-chat-tools, below)   |
| Workspace-chat tools (HITL)        | `lambdas/python/workspace-chat-tools/tools/pipedream_integration.py`           |
| Proxy infra stack                  | `infra/stacks/pipedream-proxy-stack.ts`                                        |
| Per-client relay wiring            | `infra/constructs/core-numa-infra-construct.ts` (relay Lambda + policy tables) |
