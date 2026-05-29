---
api_name: 'Xero Accounting API'
connector_id: 'xero'
auth_type: 'oauth2'
tier: 'standard'
category: 'accounting'
integration_path: 'direct-api'
---

# Xero -- Connector & Integration Setup

> Build/wiring reference for the Xero connector in Numa. **The connector already exists** in
> `connectorRegistry.ts` — this document reproduces and explains the real entry, describes the
> Direct-API (`connect_request`) integration path, and documents how the `ext-api-doc/xero/`
> files reach the workspace agent at runtime.
>
> **Prerequisites:** Read `00-api-investigation-questionnaire.md`, `02-api-spec-investigation.md`,
> and the [Numa Connectors documentation](../../documentation/connectors/README.md) first.

---

## Integration Type

**Selected path:** Direct API Only — interactions go through the connector's `connect_request`
proxy. Xero is an accounting **records-and-actions** API, not a file browser, so there is **no
`Data Connector (Files)` backend provider** (no `list_files`/`download_file`). The OAuth token
and the mandatory `Xero-tenant-id` header are injected per call by the connector layer.

| Component                                       | Required?                | Notes                                                                      |
| ----------------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| Connector Registry entry                        | Yes — **already exists** | `id: 'xero'` in `connectorRegistry.ts` (reproduced in §1)                  |
| Admin OAuth app setup                           | Yes                      | Per-client Xero app (Client ID/Secret) — see `04-connection-and-reauth.md` |
| Backend provider class (`lib/oauth-providers/`) | **No**                   | Files-connector providers only; Xero is Direct-API via `connect_request`   |
| Workspace agent prompt (`01-*.md`)              | Yes                      | Deployed to S3 by `numa-client-stack.ts` (see §3)                          |
| Feature flag                                    | Yes                      | `DATA_CONNECTORS_ENABLED` (gates connectors + the Secrets Vault)           |
| i18n keys                                       | No (table-driven)        | Display strings come from the registry entry itself                        |

---

## 1. Connector Registry Entry (the real, existing config)

> **File:** `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
> (entry `id: 'xero'`, under the "Tier 2: OAuth2 (Accounting)" section)

This is the **actual** entry in the repo — reproduced verbatim, not invented:

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

**Field-by-field notes:**

| Field             | Value                                               | Notes                                                                                     |
| ----------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `id`              | `xero`                                              | Connector slug; matches the `ext-api-doc/xero/` folder name.                              |
| `displayName`     | `Xero`                                              | Shown in the Integrations UI.                                                             |
| `icon`            | `bi-calculator`                                     | Bootstrap Icons class (not an SVG path) — consistent with other accounting connectors.    |
| `description`     | `Cloud accounting for small businesses`             | Card subtitle.                                                                            |
| `category`        | `Accounting`                                        | Groups it with MYOB AccountRight / MYOB Acumatica.                                        |
| `authType`        | `oauth2`                                            | Drives the OAuth connect wizard (no `credentialFields`, unlike token/api-key connectors). |
| `oauth.authUrl`   | `https://login.xero.com/identity/connect/authorize` | **Authoritative** — auth code endpoint. Do not substitute `identity.xero.com` here.       |
| `oauth.tokenUrl`  | `https://identity.xero.com/connect/token`           | **Authoritative** — token exchange + refresh endpoint.                                    |
| `oauth.scopes`    | (see above — space-delimited string)                | **Read-only.** See the scope-gap callout below.                                           |
| `oauthSetupSteps` | 4-step array                                        | Rendered as admin guidance in the OAuth setup wizard.                                     |

> **⚠ Scope-gap callout (carried from the investigation).** The `scopes` string is **read-only**
> and **omits `accounting.settings.read`**. As configured, `/Accounts` (chart of accounts),
> `/TaxRates`, `/Items`, and `/Organisation` will **403**. The task brief lists "accounts" as a
> target entity — to enable chart-of-accounts reads, append `accounting.settings.read` to the
> `scopes` string (and re-consent). For reports, add `accounting.reports.read`. Writes would need
> `accounting.transactions` / `accounting.contacts`. **This is a deliberate config decision, not a
> doc gap** — leave it read-only unless the product owner asks for more.

---

## 2. No Backend Provider Class (Direct API via `connect_request`)

Unlike file-browsing connectors (Google Drive, OneDrive, Box, Dropbox), Xero does **not** get a
`lib/oauth-providers/xero_provider.py` class and is **not** registered in
`lib/oauth-providers/__init__.py`. There is no `list_files`/`download_file` surface to implement.

Instead, the workspace agent reaches Xero through the connector's **`connect_request`** proxy:

- The proxy holds the OAuth token (refreshed via the registry `oauth.tokenUrl`) and forwards
  authenticated HTTP requests to `https://api.xero.com`.
- The agent issues plain REST calls (the same ones in `02-api-spec-investigation.md`) and the
  proxy attaches `Authorization: Bearer …`.
- **Xero-specific:** the `Xero-tenant-id` header is **not** derivable from the token. The agent's
  first call after connect must be `GET https://api.xero.com/connections` to obtain `tenantId`,
  which it then sends as the `Xero-tenant-id` header on every subsequent data call. This is
  spelled out for the agent in `01-llm-api-rules.md` ("Critical Gotchas"). If a user is connected
  to multiple orgs, the agent must pin or confirm which `tenantId` it used.

This mirrors how the other Direct-API accounting connectors (MYOB AccountRight, simPRO, Jobber)
are wired: registry entry + workspace-agent prompt, no Files provider.

---

## 3. Workspace Agent Prompt Deployment (how `ext-api-doc/xero/` reaches the agent)

The `ext-api-doc/xero/` markdown files are shipped to each client's S3 bucket at deploy time and
loaded by the workspace agent when the Xero connector is active.

**Mechanism (cite for reviewers):**

- **Bucket:** `numa-client-stack.ts` provisions a per-client `ext-api-doc` bucket via
  `core-numa-infra-construct.ts` (`extApiDocBucket`, name `${numaClient}-ext-api-doc`).
- **Sync:** at the **end** of `numa-client-stack.ts` (to avoid shifting Terraform resource
  addresses), the stack walks the repo's `ext-api-doc/` directory recursively and creates an
  `S3Object` for every `.md` file (skipping `_templates/`), keyed by its relative path
  (e.g. `xero/01-llm-api-rules.md`), with `contentType: 'text/markdown'` and a `filemd5`
  source hash so changed files re-upload on deploy.
- **Discovery:** `admin-data-connector-settings-get` lists this bucket
  (`EXT_API_DOC_BUCKET_NAME`) to report which connectors have docs available.
- **Agent load:** the workspace agent loads the **`01-*.md`** knowledge pack (the main rules file
  `01-llm-api-rules.md` plus companions `01a`–`01d`) into context when the Xero connector is
  active. The `00-`, `02-`, `03-`, `04-` files are developer/build reference and are **not** part
  of the agent's runtime context.

**Files in `ext-api-doc/xero/`:**

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

> Editing any `01-*.md` and redeploying (`make deploy` / the per-client CDKTF deploy) re-uploads
> the changed object via the `filemd5` source hash. No code change is needed — the sync is purely
> file-driven.

---

## 4. Admin & User Auth Flows

| Flow             | Who    | What happens                                                                                                                                                                     |
| ---------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin setup      | Admin  | Registers a Xero OAuth app (Client ID/Secret) per `oauthSetupSteps`; stores the **company** OAuth client secret in the vault. See `04-connection-and-reauth.md`.                 |
| User connect     | User   | OAuth authorization-code redirect to `oauth.authUrl`; on callback the proxy exchanges the code at `oauth.tokenUrl` and stores the **user** token (incl. rotating refresh token). |
| Token refresh    | System | On 401, refresh at `oauth.tokenUrl`; **persist the rotated refresh token** (one-time-use).                                                                                       |
| User disconnect  | User   | Deletes the **user** token only; the company OAuth client secret is untouched.                                                                                                   |
| Admin disconnect | Admin  | Deletes the company OAuth client secret (and revokes app access in Xero if required).                                                                                            |

Detailed app-registration, redirect-URI, scope, refresh, and reauth-trigger steps are in
`04-connection-and-reauth.md`.

---

## 5. Deployment Checklist

### Code / config

- [x] Registry entry present in `connectorRegistry.ts` (`id: 'xero'`)
- [x] Icon set (`bi-calculator` — Bootstrap Icons class)
- [x] `authType: 'oauth2'` with `oauth.authUrl` / `oauth.tokenUrl` / `oauth.scopes`
- [x] `oauthSetupSteps` present (admin guidance)
- [ ] **Decide scope gap:** add `accounting.settings.read` if chart-of-accounts reads are required (currently 403)
- [ ] No backend provider class needed (Direct-API path) — confirm not accidentally added to `__init__.py`
- [x] `01-*.md` knowledge pack authored (`01`, `01a`–`01d`)

### Auth flows

- [ ] Admin registers a Xero OAuth app; redirect URI matches the one shown in the wizard exactly
- [ ] Company OAuth client secret saved to vault
- [ ] User connect (OAuth redirect → token exchange) works
- [ ] Token refresh works **and persists the rotated refresh token**
- [ ] User disconnect deletes user token only; admin disconnect deletes company secret

### Workspace agent

- [ ] Deploy syncs `ext-api-doc/xero/*.md` to `${client}-ext-api-doc` (verify in S3 after deploy)
- [ ] Agent performs the `GET /connections` bootstrap and sends `Xero-tenant-id` on data calls
- [ ] Agent lists/filters invoices, contacts, payments, bank transactions
- [ ] Agent correctly reports the read-only / scope-gap limitations (no writes; `/Accounts` 403 until scope added)
- [ ] Agent honours 429 `Retry-After` and parses both `/Date()/` and ISO `*UTC` dates

### CI/CD

- [ ] No new Lambda required (Direct-API connector) — no `.gitlab-ci.yml` / `package-all.sh` change
- [ ] Frontend build picks up the registry entry

---

## 6. Testing Plan

### Manual testing sequence

1. **Admin setup:** register the Xero OAuth app, save the company secret.
2. **User connect:** complete the OAuth redirect; confirm a token is stored.
3. **Bootstrap:** ask the agent "which Xero organisations am I connected to?" → it calls
   `GET /connections` and lists tenant names/ids.
4. **Invoices:** "show me outstanding receivables" →
   `GET /Invoices?where=Type=="ACCREC"&&AmountDue>0&summaryOnly=true&order=Date DESC&page=1`.
5. **Contacts:** "find the contact named Acme" → `GET /Contacts?where=Name.Contains("Acme")`.
6. **Payments / bank txns:** "list payments in June" → `GET /Payments?where=Date>=DateTime(...)`.
7. **Scope gap:** "show me the chart of accounts" → expect a clean "read-only / scope not enabled"
   explanation (or a 403 surfaced gracefully), not a silent failure.
8. **Multi-org:** if connected to >1 org, confirm the agent states which `tenantId` it used.
9. **User disconnect:** disconnect; confirm subsequent calls fail / prompt reconnect.

### Edge cases

- [ ] Token expired mid-session (30-min lifetime) → silent refresh + retry
- [ ] Rotating refresh token persisted (no `invalid_grant` on the next refresh)
- [ ] 429 rate limit → `Retry-After` honoured
- [ ] Empty result sets (no invoices match the `where`)
- [ ] Large org → `page` walk to `Pagination.pageCount`; prefer `If-Modified-Since` over heavy `where`
- [ ] Mixed date formats (`/Date()/` vs ISO `*UTC`) parsed correctly

---

_Generated from `00-api-investigation-questionnaire.md` (Phase 9 + Phase 2). See also:_

- _[Connector Framework Documentation](../../documentation/connectors/README.md)_
- _`02-api-spec-investigation.md` — clean developer API reference_
- _`04-connection-and-reauth.md` — OAuth app registration, scopes, refresh, reauth triggers_
- _`01-llm-api-rules.md` (+ `01a`–`01d`) — the workspace-agent knowledge pack_
