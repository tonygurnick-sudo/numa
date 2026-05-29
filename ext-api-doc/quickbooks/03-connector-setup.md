---
api_name: 'QuickBooks Online Accounting API'
connector_id: 'quickbooks'
auth_type: 'oauth2'
tier: 'standard'
category: 'accounting'
integration_path: 'direct-api' # Direct API via connect_request — NOT a Files connector
---

# QuickBooks Online — Connector & Integration Setup

> How the `quickbooks` connector is wired into Numa. The connector **already exists** in the registry — this document describes the **actual** entry and the deploy/load mechanism, so an engineer can find, verify, and reason about it.
>
> **Integration type: Direct API via `connect_request`.** QuickBooks Online is an accounting data API, not a file system, so it does **not** use the Data Connector (Files) interface (`list_files`/`download_file`/`search_files`). There is **no Python provider class** in `lib/oauth-providers/`. The workspace agent calls QBO through the relay using the `connectors(name="request", ...)` operation (the `connect_request` path), which injects the stored OAuth bearer token and forwards to `https://quickbooks.api.intuit.com/v3/company/{realmId}/...`.

---

## Integration Type

**Selected path:** Direct API via `connect_request` (Direct API Only).

| Component                        | Required? | Notes                                                                                |
| -------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| Connector Registry entry         | Yes ✅    | Already present — see §1                                                             |
| OAuth setup steps                | Yes ✅    | `oauthSetupSteps[]` in the registry entry — admin guidance for the Intuit app        |
| Backend provider class           | **No**    | Not a Files connector — no `lib/oauth-providers/quickbooks_provider.py`              |
| Files Remote surface             | **No**    | No browsable file tree; the connector is chat-only via the `request` operation       |
| API reference docs (this folder) | Yes ✅    | `ext-api-doc/quickbooks/*.md` — synced to S3 at deploy, loaded by the agent (see §3) |
| Workspace agent prompt           | Yes ✅    | The agent is told to read `01-llm-api-rules.md` before any `request` call (see §3)   |
| Feature flag                     | Inherited | Gated by the connectors/integrations surface (`DATA_CONNECTORS_ENABLED`)             |
| i18n keys                        | As needed | `displayName`/`description` live on the registry entry, not i18n                     |

---

## 1. Connector Registry Entry (actual)

> **File:** `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (search for `id: 'quickbooks'`).

This is the **verbatim** entry as it exists in the codebase today:

```typescript
{
  id: 'quickbooks',
  displayName: 'QuickBooks Online',
  icon: 'bi-receipt',
  description: 'Cloud accounting and bookkeeping',
  category: 'Accounting',
  authType: 'oauth2',
  oauth: {
    authUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    scopes: 'com.intuit.quickbooks.accounting',
  },
  oauthSetupSteps: [
    'Go to Intuit Developer Portal (developer.intuit.com) → Dashboard',
    'Click "Create an app" and select "QuickBooks Online and Payments"',
    'Under Keys & credentials → Redirect URIs, add the URI below',
    'Copy the Client ID and Client Secret from the app dashboard',
  ],
}
```

**Field-by-field:**

| Field             | Value                                                       | Notes                                                                                                                       |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `quickbooks`                                                | Connector slug; also the `ext-api-doc/quickbooks/` folder name and the `/workdir/api-docs/quickbooks/` path the agent reads |
| `displayName`     | `QuickBooks Online`                                         | Shown on the integration card                                                                                               |
| `icon`            | `bi-receipt`                                                | Bootstrap icon class                                                                                                        |
| `description`     | `Cloud accounting and bookkeeping`                          | Card subtitle                                                                                                               |
| `category`        | `Accounting`                                                | Groups with MYOB / Xero                                                                                                     |
| `authType`        | `oauth2`                                                    | OAuth 2.0 Authorization Code — the only QBO auth method                                                                     |
| `oauth.authUrl`   | `https://appcenter.intuit.com/connect/oauth2`               | Matches Intuit's documented authorize endpoint                                                                              |
| `oauth.tokenUrl`  | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` | Matches Intuit's documented token endpoint (used for both code exchange and refresh)                                        |
| `oauth.scopes`    | `com.intuit.quickbooks.accounting`                          | Single scope — full Accounting API read/write. **Not** the Payments scope                                                   |
| `oauthSetupSteps` | 4-step admin guide (above)                                  | Rendered in the connect wizard so the admin can create the Intuit app and copy Client ID/Secret                             |

**What the entry deliberately does NOT have (and why):**

- **No `credentialFields`** — unlike token/api-key connectors (or OAuth connectors with a per-instance host like Actionstep's `api_endpoint`), QBO needs no extra admin-entered field. The host is fixed; the only per-company value (`realmId`) is captured automatically from the OAuth callback, not typed by an admin.
- **No `extraAuthParams`** — QBO's authorize flow needs no extra query params beyond the standard set (compare Zoho, which sends `access_type=offline&prompt=consent`). QBO already returns a rotating refresh token without an `access_type` hint.
- **No `surfaces` / `cachingPolicy`** — defaults apply. Financial reads should not be aggressively cached (data must be fresh); a short-TTL cache for static name-lists (Item, Account) could be added later but is not configured today.
- **No `authHeaderScheme`** — QBO uses the standard `Authorization: Bearer {token}` scheme (unlike Zoho's `Zoho-oauthtoken`), so the default Bearer scheme is correct.

> **`realmId` is the one connector-specific subtlety.** QBO has no static instance/base URL field in the registry because the base host is fixed; the per-company `{realmId}` path segment is returned in the OAuth callback (`?...&realmId=...`), persisted alongside the tokens, and templated into every request path. One authorisation = one company; multiple companies = multiple connections. The relay must capture and store it. See `04-connection-and-reauth.md`.

---

## 2. Backend Provider — Not Applicable

This connector has **no** `lib/oauth-providers/quickbooks_provider.py` and is **not** registered in `lib/oauth-providers/__init__.py`'s `PROVIDER_REGISTRY`. Those are only for **Data Connector (Files)** providers that implement `list_files` / `download_file` / `search_files` / `get_file_metadata`.

QuickBooks is a Direct API connector. The agent reaches it through the relay's authenticated `request` operation:

```
connectors(
  name="request",
  params={
    "connector": "quickbooks",
    "method": "GET",
    "url": "/v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE Balance > '0' MAXRESULTS 100&minorversion=75",
  },
  description="List unpaid QuickBooks invoices"
)
```

The relay attaches `Authorization: Bearer {access_token}` (from the stored OAuth credential), forwards to the QBO host, refreshes the token on 401, and returns the response. The agent is responsible for the path, body, `Accept: application/json`, and `minorversion`. Write operations through `request` require human approval (HITL) in chat.

---

## 3. API Reference Docs — Deploy & Load Mechanism

The files in this folder (`ext-api-doc/quickbooks/`) are how the workspace agent learns the QBO rules. This is the part engineers most often need to understand.

### 3a. Deploy: synced to S3 by `numa-client-stack`

> **File:** `infra/stacks/numa-client-stack.ts` (the `Sync ext-api-doc files to S3` block, ~line 1135).

At deploy time the client stack walks the entire `ext-api-doc/` tree, skips the `_templates/` folder, and uploads **every** `.md` file as an `S3Object` into the per-client **ext-api-doc bucket** (`{clientName}-ext-api-doc`, created in `core-numa-infra-construct.ts`). Each object keeps its relative path as the S3 key (`quickbooks/01-llm-api-rules.md`, `quickbooks/02-api-spec-investigation.md`, etc.) and is content-typed `text/markdown`. The bucket name is exposed to the workspace agent as the `EXT_API_DOC_BUCKET_NAME` env var.

Practically: **add or edit a file here, redeploy the client stack, and the new content lands in S3.** No code change is needed — the sync is filesystem-driven.

### 3b. Load: the agent stages docs into `/workdir/api-docs/{slug}/`

> **Reference:** `services/numa-workspace-agent/numa_workspace_agent/prompts.py` (`_build_connectors_context`, ~line 1220).

For every **enabled native connector**, the agent stages its docs from the ext-api-doc bucket into the conversation's MicroVM at `/workdir/api-docs/{slug}/` (so QBO docs appear at `/workdir/api-docs/quickbooks/`). When at least one such folder exists, the system prompt instructs the agent:

> "You **MUST** read `01-llm-api-rules.md` before making any authenticated API request via the `request` operation for these connectors."

and lists the companion files it can read on demand:

- `01a-domain-model-reference.md` — entity definitions, field types, relationships
- `01b-query-patterns.md` — read operations: list, search, filter, pagination
- `01c-mutation-patterns.md` — write operations: create, update, delete, batch
- `01d-event-and-error-handling.md` — error codes, retry logic, webhooks
- `02-api-spec-investigation.md` — full API spec, edge cases, field-level behaviour
- `03-connector-setup.md` — this file (admin-side config + what the vault holds)
- `04-connection-and-reauth.md` — connect / reconnect / revoke flow, token lifetime, reauth triggers

So `01-llm-api-rules.md` is the **always-read** entry point; the rest are pulled in as the task demands. Keep `01-llm-api-rules.md` under ~300 lines and push detail into the companions.

### 3c. Files to ship

All of these live in `ext-api-doc/quickbooks/` and ship automatically:

- `01-llm-api-rules.md` (main rules — always read first)
- `01a-domain-model-reference.md`, `01b-query-patterns.md`, `01c-mutation-patterns.md`, `01d-event-and-error-handling.md` (companions)
- `02-api-spec-investigation.md` (this folder's clean dev reference)
- `03-connector-setup.md` (this file)
- `04-connection-and-reauth.md` (auth setup)
- `00-api-investigation-questionnaire.md` (research trail — shipped too, but not part of the agent's read list)

---

## 4. Vault — What Gets Stored

OAuth 2.0 connectors use the standard two-secret model. For QuickBooks:

| Key                         | Scope        | Holds                                                                                                             |
| --------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Company/OAuth-client secret | Company-wide | Intuit **Client ID** + **Client Secret** (admin enters these via the connect wizard, guided by `oauthSetupSteps`) |
| User connection secret      | Per user     | The user's `access_token`, **rotating** `refresh_token`, and the captured **`realmId`** (company id)              |

- The admin supplies the OAuth client credentials **once**; each user then runs the OAuth redirect to mint their own per-user tokens + realmId.
- On refresh, the relay must **persist the new `refresh_token`** (QBO rotates it) and keep the same `realmId`. See `04-connection-and-reauth.md`.

---

## 5. Verification Checklist

> The connector already exists — this is what to verify, not build.

- [x] Registry entry present in `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id: 'quickbooks'`)
- [x] `authType: 'oauth2'` with `oauth.authUrl` / `oauth.tokenUrl` / `oauth.scopes` matching Intuit's documented endpoints
- [x] `oauthSetupSteps[]` guide the admin to create the Intuit app and copy Client ID/Secret
- [ ] Redirect URI from the connect wizard added to the Intuit app's **Keys & credentials → Redirect URIs** (per environment)
- [ ] `ext-api-doc/quickbooks/*.md` synced to the `{clientName}-ext-api-doc` bucket after a client-stack deploy
- [ ] Agent stages docs to `/workdir/api-docs/quickbooks/` and reads `01-llm-api-rules.md` before a `request` call (check container logs)
- [ ] User connect flow completes and persists `access_token` + rotating `refresh_token` + `realmId`
- [ ] A smoke-test `request` returns 200 (e.g. `GET /v3/company/{realmId}/companyinfo/{realmId}?minorversion=75`)
- [ ] Token refresh works (401 → relay refreshes and stores the rotated `refresh_token`)
- [ ] Destructive operations (delete/void) are gated behind HITL approval

---

## 6. Testing Plan

### Manual sequence

1. **Admin setup:** open the connect wizard for QuickBooks Online, follow `oauthSetupSteps`, paste Client ID + Secret, copy the shown redirect URI into the Intuit app.
2. **User connect:** click Connect, complete the Intuit consent screen, confirm the callback captured `realmId`.
3. **Smoke test (chat):** ask the agent "what's my QuickBooks company name?" → it should `request` `GET /companyinfo/{realmId}` and return the name.
4. **Read:** "list my unpaid invoices" → `query SELECT * FROM Invoice WHERE Balance > '0'`.
5. **Write (HITL):** "create an invoice for customer X for $150" → approval prompt → `POST /invoice`.
6. **Sparse update (HITL):** "change customer X's email" → `POST /customer` with `"sparse": true` + current `SyncToken`.
7. **Refresh:** wait past 1h access-token expiry, repeat a read → relay refreshes silently.
8. **Disconnect:** user disconnect removes the per-user secret only; admin disconnect removes the company OAuth-client secret.

### Edge cases

- [ ] Empty query result (`QueryResponse: {}` — entity key absent)
- [ ] Stale `SyncToken` on update (error 5010) → GET-then-retry
- [ ] Duplicate name on create (error 6240)
- [ ] 429 throttle → backoff with jitter
- [ ] Refresh-token rotation persisted correctly (no `invalid_grant` on next refresh)
- [ ] Multiple QuickBooks companies (one connection per realm)

---

_Generated from `00-api-investigation-questionnaire.md`. See also `04-connection-and-reauth.md` (auth flow detail) and the [Numa Connectors documentation](../../documentation/connectors/README.md)._
