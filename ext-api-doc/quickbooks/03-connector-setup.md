---
api_name: QuickBooks Online Accounting API
connector_id: quickbooks
auth_type: oauth2
tier: standard
category: accounting
integration_path: direct-api (HTTP via connect_request / relay — NOT a Files connector, NOT MCP)
call_surface: agent calls `connectors(name="request", …)` → relay injects Authorization: Bearer → forwards to https://quickbooks.api.intuit.com/v3/company/{realmId}/…
status: connector ALREADY EXISTS in the registry — this documents the actual entry + deploy/load mechanism
---

# QuickBooks Online — Connector & Integration Setup

QBO is an accounting data API, not a file system → it does NOT use the Data Connector (Files) interface (`list_files`/`download_file`/`search_files`/`get_file_metadata`). There is NO Python provider class in `lib/oauth-providers/`. The agent reaches QBO through the relay's `connectors(name="request", …)` (`connect_request`) operation; the relay injects the stored OAuth bearer token and forwards to the base URL.

## Integration components

| Component                        | Required? | Notes                                                                            |
| -------------------------------- | --------- | -------------------------------------------------------------------------------- |
| Connector Registry entry         | Yes ✅    | already present — §1                                                             |
| OAuth setup steps                | Yes ✅    | `oauthSetupSteps[]` in the entry — admin guidance for the Intuit app             |
| Backend provider class           | **No**    | not a Files connector — no `lib/oauth-providers/quickbooks_provider.py`          |
| Files Remote surface             | **No**    | no file tree; chat-only via the `request` operation                              |
| API reference docs (this folder) | Yes ✅    | `ext-api-doc/quickbooks/*.md` — synced to S3 at deploy, loaded by the agent (§3) |
| Workspace agent prompt           | Yes ✅    | agent told to read `01-llm-api-rules.md` before any `request` call (§3)          |
| Feature flag                     | Inherited | gated by the connectors/integrations surface (`DATA_CONNECTORS_ENABLED`)         |
| i18n keys                        | As needed | `displayName`/`description` live on the entry, not i18n                          |

## 1. Connector Registry Entry (actual)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id: 'quickbooks'`). Verbatim:

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

| Field             | Value                                                       | Notes                                                                                                           |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`              | `quickbooks`                                                | slug; also the `ext-api-doc/quickbooks/` folder name + the `/workdir/api-docs/quickbooks/` path the agent reads |
| `displayName`     | `QuickBooks Online`                                         | integration card title                                                                                          |
| `icon`            | `bi-receipt`                                                | Bootstrap icon class                                                                                            |
| `description`     | `Cloud accounting and bookkeeping`                          | card subtitle                                                                                                   |
| `category`        | `Accounting`                                                | groups with MYOB / Xero                                                                                         |
| `authType`        | `oauth2`                                                    | OAuth 2.0 Authorization Code — the only QBO auth method                                                         |
| `oauth.authUrl`   | `https://appcenter.intuit.com/connect/oauth2`               | Intuit's documented authorize endpoint                                                                          |
| `oauth.tokenUrl`  | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` | Intuit's documented token endpoint (code exchange + refresh)                                                    |
| `oauth.scopes`    | `com.intuit.quickbooks.accounting`                          | single scope — full Accounting read/write. NOT the Payments scope                                               |
| `oauthSetupSteps` | 4-step admin guide (above)                                  | rendered in the connect wizard so the admin creates the Intuit app + copies Client ID/Secret                    |

**Deliberately absent (and why):**

- No `credentialFields` — no extra admin-entered field needed; host is fixed; the only per-company value (`realmId`) is captured automatically from the OAuth callback, not typed.
- No `extraAuthParams` — QBO's authorize flow needs no extra params (cf. Zoho's `access_type=offline&prompt=consent`); QBO already returns a rotating refresh token without an `access_type` hint.
- No `surfaces`/`cachingPolicy` — defaults apply. Financial reads shouldn't be aggressively cached; a short-TTL cache for static name-lists (Item, Account) could be added later but isn't configured today.
- No `authHeaderScheme` — QBO uses standard `Authorization: Bearer {token}` (cf. Zoho's `Zoho-oauthtoken`), so the default Bearer scheme is correct.

**`realmId` is the one connector-specific subtlety.** No static instance/base-URL field exists because the base host is fixed; the per-company `{realmId}` path segment is returned in the OAuth callback (`?...&realmId=…`), persisted alongside the tokens, and templated into every request path. One authorisation = one company; multiple companies = multiple connections. The relay must capture and store it. See 04.

## 2. Backend Provider — Not Applicable

NO `lib/oauth-providers/quickbooks_provider.py`; NOT in `PROVIDER_REGISTRY` (`lib/oauth-providers/__init__.py`). Those are only for Data Connector (Files) providers implementing `list_files`/`download_file`/`search_files`/`get_file_metadata`. QBO is Direct API — reached via the relay's authenticated `request` operation:

```
connectors(name="request", params={"connector":"quickbooks","method":"GET","url":"/v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE Balance > '0' MAXRESULTS 100&minorversion=75"}, description="List unpaid QuickBooks invoices")
```

The relay attaches `Authorization: Bearer {access_token}` (from the stored credential), forwards to the QBO host, refreshes on 401, returns the response. The agent owns path, body, `Accept: application/json`, `minorversion`. Write operations through `request` require human approval (HITL).

## 3. API Reference Docs — Deploy & Load

### 3a. Deploy: synced to S3 by `numa-client-stack`

File: `infra/stacks/numa-client-stack.ts` (`Sync ext-api-doc files to S3` block, ~line 1135). At deploy the client stack walks the whole `ext-api-doc/` tree, skips `_templates/`, and uploads EVERY `.md` as an `S3Object` into the per-client ext-api-doc bucket (`{clientName}-ext-api-doc`, from `core-numa-infra-construct.ts`). Each object keeps its relative path as the S3 key (`quickbooks/01-llm-api-rules.md`, …), content-typed `text/markdown`. Bucket name exposed to the agent via `EXT_API_DOC_BUCKET_NAME`. Add/edit a file here, redeploy, content lands in S3 — no code change (filesystem-driven sync).

### 3b. Load: agent stages docs into `/workdir/api-docs/{slug}/`

Reference: `services/numa-workspace-agent/numa_workspace_agent/prompts.py` (`_build_connectors_context`, ~line 1220). For every enabled native connector the agent stages its docs from the bucket into the conversation MicroVM at `/workdir/api-docs/{slug}/` (QBO → `/workdir/api-docs/quickbooks/`). When ≥1 such folder exists, the system prompt instructs: "You MUST read `01-llm-api-rules.md` before making any authenticated API request via the `request` operation for these connectors." Companions pulled on demand: `01a` (domain model), `01b` (query patterns), `01c` (mutation patterns), `01d` (errors/retry/webhooks), `02` (full spec/edge cases), `03` (this file), `04` (reauth). So `01-llm-api-rules.md` is the always-read entry point; keep it under ~300 lines, push detail into companions.

### 3c. Files to ship (all in `ext-api-doc/quickbooks/`, auto-shipped)

`01-llm-api-rules.md` (always read first); `01a`/`01b`/`01c`/`01d` (companions); `02-api-spec-investigation.md` (dev reference); `03-connector-setup.md` (this); `04-connection-and-reauth.md` (auth); `00-api-investigation-questionnaire.md` (research trail — shipped but not in the agent's read list).

## 4. Vault — What Gets Stored

OAuth 2.0 two-secret model:
| Key | Scope | Holds |
| --- | --- | --- |
| Company/OAuth-client secret | Company-wide | Intuit Client ID + Client Secret (admin enters via the connect wizard, guided by `oauthSetupSteps`) |
| User connection secret | Per user | the user's `access_token`, **rotating** `refresh_token`, captured **`realmId`** (company id) |

Admin supplies OAuth client credentials once; each user runs the OAuth redirect to mint their own per-user tokens + realmId. On refresh the relay must PERSIST the new `refresh_token` (QBO rotates it) and keep the same `realmId`. See 04.

## 5. Verification Checklist (verify, not build — connector already exists)

- [x] Registry entry present (`id: 'quickbooks'`)
- [x] `authType: 'oauth2'` with `oauth.authUrl`/`tokenUrl`/`scopes` matching Intuit's endpoints
- [x] `oauthSetupSteps[]` guide admin to create the Intuit app + copy Client ID/Secret
- [ ] Redirect URI from the wizard added to Intuit app's Keys & credentials → Redirect URIs (per environment)
- [ ] `ext-api-doc/quickbooks/*.md` synced to `{clientName}-ext-api-doc` after a client-stack deploy
- [ ] Agent stages docs to `/workdir/api-docs/quickbooks/` and reads `01-llm-api-rules.md` before a `request` call (container logs)
- [ ] User connect flow completes + persists `access_token` + rotating `refresh_token` + `realmId`
- [ ] Smoke-test `request` returns 200 (`GET /v3/company/{realmId}/companyinfo/{realmId}?minorversion=75`)
- [ ] Token refresh works (401 → relay refreshes + stores the rotated `refresh_token`)
- [ ] Destructive ops (delete/void) gated behind HITL approval

## 6. Testing Plan

**Manual sequence:**

1. Admin setup: open the QBO connect wizard, follow `oauthSetupSteps`, paste Client ID + Secret, copy the shown redirect URI into the Intuit app.
2. User connect: click Connect, complete Intuit consent, confirm the callback captured `realmId`.
3. Smoke (chat): "what's my QuickBooks company name?" → `request GET /companyinfo/{realmId}` → returns the name.
4. Read: "list my unpaid invoices" → `query SELECT * FROM Invoice WHERE Balance > '0'`.
5. Write (HITL): "create an invoice for customer X for $150" → approval → `POST /invoice`.
6. Sparse update (HITL): "change customer X's email" → `POST /customer` with `"sparse":true` + current `SyncToken`.
7. Refresh: wait past 1h access-token expiry, repeat a read → relay refreshes silently.
8. Disconnect: user disconnect removes the per-user secret only; admin disconnect removes the company OAuth-client secret.

**Edge cases:** empty query result (`QueryResponse:{}`, entity key absent); stale `SyncToken` on update (error 5010 → GET-then-retry); duplicate name on create (error 6240); 429 throttle → backoff w/ jitter; refresh-token rotation persisted (no `invalid_grant` on next refresh); multiple QuickBooks companies (one connection per realm).

See 04 (auth flow detail) and `documentation/connectors/README.md`.
