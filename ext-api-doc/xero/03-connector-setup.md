---
api_name: Xero Accounting API
connector_id: xero
auth_type: oauth2
tier: standard
category: accounting
integration_path: direct-api (connect_request proxy; NOT Data Connector Files — no list_files/download_file)
prerequisites: read 00-api-investigation-questionnaire.md, 02-api-spec-investigation.md, and documentation/connectors/README.md first
---

# Xero — Connector & Integration Setup

Build/wiring reference. **The connector already exists** in `connectorRegistry.ts` — this doc reproduces and explains the real entry, the Direct-API (`connect_request`) path, and how `ext-api-doc/xero/` reaches the workspace agent at runtime.

## Integration Type

**Direct API Only** — interactions go through the connector's `connect_request` proxy. Xero is an accounting **records-and-actions** API, not a file browser, so **no `Data Connector (Files)` backend provider** (no `list_files`/`download_file`). The OAuth token + mandatory `Xero-tenant-id` header are injected per call by the connector layer.

| Component                                       | Required?                | Notes                                                                      |
| ----------------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| Connector Registry entry                        | Yes — **already exists** | `id: 'xero'` in `connectorRegistry.ts` (§1)                                |
| Admin OAuth app setup                           | Yes                      | per-client Xero app (Client ID/Secret) — see `04-connection-and-reauth.md` |
| Backend provider class (`lib/oauth-providers/`) | **No**                   | Files-connector providers only; Xero is Direct-API via `connect_request`   |
| Workspace agent prompt (`01-*.md`)              | Yes                      | deployed to S3 by `numa-client-stack.ts` (§3)                              |
| Feature flag                                    | Yes                      | `DATA_CONNECTORS_ENABLED` (gates connectors + the Secrets Vault)           |
| i18n keys                                       | No (table-driven)        | display strings come from the registry entry itself                        |

## 1. Connector Registry Entry (the real, existing config)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (entry `id: 'xero'`, "Tier 2: OAuth2 (Accounting)"). Reproduced verbatim:

```typescript
{
  id: 'xero',
  displayName: 'Xero',
  icon: 'bi-calculator',
  description: 'Cloud accounting for small businesses',
  category: 'Accounting',
  authType: 'oauth2',
  oauth: {
    authUrl: 'https://login.xero.com/identity/connect/authorize',
    tokenUrl: 'https://identity.xero.com/connect/token',
    scopes:
      'openid profile email accounting.transactions.read accounting.contacts.read offline_access',
  },
  oauthSetupSteps: [
    'Go to Xero Developer Portal (developer.xero.com) → My Apps',
    'Click "New app" and select "Web app" as the integration type',
    'Add the redirect URI below under "OAuth 2.0 redirect URIs"',
    'Copy the Client ID and generate a Client Secret',
  ],
},
```

Field notes:
| Field | Value | Notes |
| --- | --- | --- |
| `id` | `xero` | connector slug; matches the `ext-api-doc/xero/` folder name |
| `displayName` | `Xero` | shown in the Integrations UI |
| `icon` | `bi-calculator` | Bootstrap Icons class (not an SVG path) — consistent with other accounting connectors |
| `description` | `Cloud accounting for small businesses` | card subtitle |
| `category` | `Accounting` | groups with MYOB AccountRight / MYOB Acumatica |
| `authType` | `oauth2` | drives the OAuth connect wizard (no `credentialFields`, unlike token/api-key) |
| `oauth.authUrl` | `https://login.xero.com/identity/connect/authorize` | **authoritative** auth-code endpoint. Do NOT substitute `identity.xero.com` here |
| `oauth.tokenUrl` | `https://identity.xero.com/connect/token` | **authoritative** token exchange + refresh endpoint |
| `oauth.scopes` | (space-delimited string above) | **read-only** — see scope-gap callout |
| `oauthSetupSteps` | 4-step array | rendered as admin guidance in the OAuth setup wizard |

> **⚠ Scope-gap callout.** The `scopes` string is **read-only** and **omits `accounting.settings.read`**. As configured, `/Accounts`, `/TaxRates`, `/Items`, `/Organisation` **403**. To enable chart-of-accounts reads, append `accounting.settings.read` (and re-consent). Reports: add `accounting.reports.read`. Writes: `accounting.transactions`/`accounting.contacts`. Deliberate config decision, not a doc gap — leave read-only unless the product owner asks for more.

## 2. No Backend Provider Class (Direct API via `connect_request`)

Unlike file-browsing connectors (Google Drive, OneDrive, Box, Dropbox), Xero gets **no** `lib/oauth-providers/xero_provider.py` and is **not** registered in `lib/oauth-providers/__init__.py`. No `list_files`/`download_file` surface to implement.

The agent reaches Xero through the connector's **`connect_request`** proxy:

- Proxy holds the OAuth token (refreshed via `oauth.tokenUrl`) and forwards authenticated HTTP requests to `https://api.xero.com`, attaching `Authorization: Bearer …`.
- The agent issues plain REST calls (those in `02-api-spec-investigation.md`).
- **Xero-specific:** `Xero-tenant-id` is **not** derivable from the token. The agent's first call after connect must be `GET https://api.xero.com/connections` to obtain `tenantId`, then send it as `Xero-tenant-id` on every subsequent data call (spelled out in `01` "Critical Gotchas"). If connected to multiple orgs, the agent must pin or confirm which `tenantId` it used.

Mirrors the other Direct-API accounting connectors (MYOB AccountRight, simPRO, Jobber): registry entry + workspace-agent prompt, no Files provider.

## 3. Workspace Agent Prompt Deployment

The `ext-api-doc/xero/` markdown files ship to each client's S3 bucket at deploy time and load when the Xero connector is active.

- **Bucket:** `numa-client-stack.ts` provisions a per-client `ext-api-doc` bucket via `core-numa-infra-construct.ts` (`extApiDocBucket`, name `${numaClient}-ext-api-doc`).
- **Sync:** at the **end** of `numa-client-stack.ts` (to avoid shifting Terraform resource addresses), the stack walks the repo's `ext-api-doc/` dir recursively and creates an `S3Object` for every `.md` file (skipping `_templates/`), keyed by relative path (e.g. `xero/01-llm-api-rules.md`), `contentType: 'text/markdown'`, with a `filemd5` source hash so changed files re-upload on deploy.
- **Discovery:** `admin-data-connector-settings-get` lists this bucket (`EXT_API_DOC_BUCKET_NAME`) to report which connectors have docs available.
- **Agent load:** the agent loads the **`01-*.md`** knowledge pack (`01-llm-api-rules.md` + companions `01a`–`01d`) when the Xero connector is active. The `00-`, `02-`, `03-`, `04-` files are developer/build reference, **not** part of the agent's runtime context.

| File                                    | Audience            | Shipped to S3 | Loaded into agent context |
| --------------------------------------- | ------------------- | ------------- | ------------------------- |
| `00-api-investigation-questionnaire.md` | Developer           | Yes           | No                        |
| `01-llm-api-rules.md`                   | **Workspace agent** | Yes           | **Yes** (main rules)      |
| `01a-domain-model-reference.md`         | **Workspace agent** | Yes           | **Yes**                   |
| `01b-query-patterns.md`                 | **Workspace agent** | Yes           | **Yes**                   |
| `01c-mutation-patterns.md`              | **Workspace agent** | Yes           | **Yes** (future/write)    |
| `01d-event-and-error-handling.md`       | **Workspace agent** | Yes           | **Yes**                   |
| `02-api-spec-investigation.md`          | Developer           | Yes           | No                        |
| `03-connector-setup.md` (this file)     | Developer           | Yes           | No                        |
| `04-connection-and-reauth.md`           | Developer / ops     | Yes           | No                        |

> Editing any `01-*.md` and redeploying (`make deploy` / per-client CDKTF deploy) re-uploads the changed object via the `filemd5` source hash. No code change needed — the sync is file-driven.

## 4. Admin & User Auth Flows

| Flow             | Who    | What happens                                                                                                                                                                     |
| ---------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin setup      | Admin  | registers a Xero OAuth app (Client ID/Secret) per `oauthSetupSteps`; stores the **company** OAuth client secret in the vault. See `04-connection-and-reauth.md`.                 |
| User connect     | User   | OAuth authorization-code redirect to `oauth.authUrl`; on callback the proxy exchanges the code at `oauth.tokenUrl` and stores the **user** token (incl. rotating refresh token). |
| Token refresh    | System | on 401, refresh at `oauth.tokenUrl`; **persist the rotated refresh token** (one-time-use).                                                                                       |
| User disconnect  | User   | deletes the **user** token only; the company OAuth client secret is untouched.                                                                                                   |
| Admin disconnect | Admin  | deletes the company OAuth client secret (and revokes app access in Xero if required).                                                                                            |

Detailed app-registration, redirect-URI, scope, refresh, and reauth-trigger steps in `04-connection-and-reauth.md`.

## 5. Deployment Checklist

Code / config:

- [x] Registry entry present (`id: 'xero'`)
- [x] Icon set (`bi-calculator`)
- [x] `authType: 'oauth2'` with `oauth.authUrl`/`oauth.tokenUrl`/`oauth.scopes`
- [x] `oauthSetupSteps` present (admin guidance)
- [ ] **Decide scope gap:** add `accounting.settings.read` if chart-of-accounts reads required (currently 403)
- [ ] No backend provider class needed (Direct-API path) — confirm not accidentally added to `__init__.py`
- [x] `01-*.md` knowledge pack authored (`01`, `01a`–`01d`)

Auth flows:

- [ ] Admin registers a Xero OAuth app; redirect URI matches the wizard's exactly
- [ ] Company OAuth client secret saved to vault
- [ ] User connect (OAuth redirect → token exchange) works
- [ ] Token refresh works **and persists the rotated refresh token**
- [ ] User disconnect deletes user token only; admin disconnect deletes company secret

Workspace agent:

- [ ] Deploy syncs `ext-api-doc/xero/*.md` to `${client}-ext-api-doc` (verify in S3)
- [ ] Agent performs the `GET /connections` bootstrap and sends `Xero-tenant-id` on data calls
- [ ] Agent lists/filters invoices, contacts, payments, bank transactions
- [ ] Agent correctly reports read-only / scope-gap limitations (no writes; `/Accounts` 403 until scope added)
- [ ] Agent honours 429 `Retry-After` and parses both `/Date()/` and ISO `*UTC` dates

CI/CD:

- [ ] No new Lambda required (Direct-API connector) — no `.gitlab-ci.yml` / `package-all.sh` change
- [ ] Frontend build picks up the registry entry

## 6. Testing Plan

Manual sequence:

1. Admin setup: register the Xero OAuth app, save the company secret.
2. User connect: complete the OAuth redirect; confirm a token is stored.
3. Bootstrap: "which Xero organisations am I connected to?" → agent calls `GET /connections`, lists tenant names/ids.
4. Invoices: "show me outstanding receivables" → `GET /Invoices?where=Type=="ACCREC"&&AmountDue>0&summaryOnly=true&order=Date DESC&page=1`.
5. Contacts: "find the contact named Acme" → `GET /Contacts?where=Name.Contains("Acme")`.
6. Payments / bank txns: "list payments in June" → `GET /Payments?where=Date>=DateTime(...)`.
7. Scope gap: "show me the chart of accounts" → expect a clean "read-only / scope not enabled" explanation (or a gracefully surfaced 403), not a silent failure.
8. Multi-org: if connected to >1 org, confirm the agent states which `tenantId` it used.
9. User disconnect: disconnect; confirm subsequent calls fail / prompt reconnect.

Edge cases:

- [ ] Token expired mid-session (30-min lifetime) → silent refresh + retry
- [ ] Rotating refresh token persisted (no `invalid_grant` on the next refresh)
- [ ] 429 rate limit → `Retry-After` honoured
- [ ] Empty result sets (no invoices match the `where`)
- [ ] Large org → `page` walk to `Pagination.pageCount`; prefer `If-Modified-Since` over heavy `where`
- [ ] Mixed date formats (`/Date()/` vs ISO `*UTC`) parsed correctly

See also: `documentation/connectors/README.md`; `02-api-spec-investigation.md` (developer API reference); `04-connection-and-reauth.md` (OAuth app registration, scopes, refresh, reauth); `01-llm-api-rules.md` (+ `01a`–`01d`, the workspace-agent knowledge pack).
