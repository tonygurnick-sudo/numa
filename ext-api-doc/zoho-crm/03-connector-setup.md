---
api_name: 'Zoho CRM'
connector_id: 'zoho-crm'
auth_type: 'oauth2'
tier: 'standard'
category: 'crm'
integration_path: 'direct-api' # [INFERRED] — 02-api-spec § "Integration Path Assessment" recommends "Direct API Only"; the live registry entry sets surfaces: ['chat'] (no Files provider), which is the direct-api path
---

# Zoho CRM -- Connector & Integration Setup

> Build/wiring reference for the Zoho CRM connector in Numa. **The connector already exists** in
> `connectorRegistry.ts` — this document reproduces and explains the real entry, describes the
> Direct-API (`connect_request`) integration path, and documents how the `ext-api-doc/zoho-crm/`
> files reach the workspace agent at runtime.
>
> **Prerequisites:** Read `00-api-investigation-questionnaire.md`, `02-api-spec-investigation.md`,
> `04-connection-and-reauth.md`, and the
> [Numa Connectors documentation](../../documentation/connectors/README.md) first.

---

## Integration Type

**Selected path:** Direct API Only — interactions go through the connector's `connect_request`
proxy. Zoho CRM is a structured-**records** CRM (Leads, Contacts, Accounts, Deals, Tasks), not a
file browser, so there is **no `Data Connector (Files)` backend provider** (no
`list_files`/`download_file`). The live registry entry pins `surfaces: ['chat']`, which keeps Zoho
CRM out of Files > Remote and surfaces it only to the workspace agent.
[VERIFIED 2026-05-29 against `connectorRegistry.ts` `id: 'zoho-crm'`]

The OAuth access token is injected per call by the connector layer as
`Authorization: Zoho-oauthtoken {access_token}` (driven by the registry's `authHeaderScheme`
field — **NOT `Bearer`**). [VERIFIED 2026-05-29 — `01-llm-api-rules.md` § Auth Structure;
`connectorRegistry.ts` `authHeaderScheme: 'Zoho-oauthtoken'`]

| Component                                       | Required?                | Notes                                                                                             |
| ----------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| Connector Registry entry                        | Yes — **already exists** | `id: 'zoho-crm'` in `connectorRegistry.ts` (reproduced in §1)                                     |
| Admin OAuth app setup                           | Yes                      | Per-client Zoho "Server-based Application" (Client ID/Secret) — see `04-connection-and-reauth.md` |
| Backend provider class (`lib/oauth-providers/`) | **No**                   | Files-connector providers only; Zoho CRM is Direct-API via `connect_request`                      |
| Workspace agent prompt (`01-*.md`)              | Yes                      | Deployed to S3 by `numa-client-stack.ts` (see §3)                                                 |
| Feature flag                                    | Yes                      | `DATA_CONNECTORS_ENABLED` (gates connectors + the Secrets Vault) [INFERRED — same gate as xero]   |
| i18n keys                                       | No (table-driven)        | Display strings come from the registry entry itself (no `connectors.zoho-crm.*` keys needed)      |

---

## 1. Connector Registry Entry (the real, existing config)

> **File:** `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
> (entry `id: 'zoho-crm'`, under the "Tier 2: OAuth2 (CRM)" grouping)

This is the **actual** entry in the repo — reproduced verbatim, not invented:

```typescript
{
  id: 'zoho-crm',
  displayName: 'Zoho CRM',
  icon: 'bi-person-rolodex',
  description: 'Zoho CRM — leads, contacts, accounts, deals, tasks',
  category: 'CRM',
  authType: 'oauth2',
  surfaces: ['chat'],
  cachingPolicy: CACHING_PRESETS.projectManagement,
  // Zoho uses its own Authorization scheme — NOT Bearer.
  authHeaderScheme: 'Zoho-oauthtoken',
  oauth: {
    // Defaults to AU region. Admins serving customers in other Zoho data
    // centres (US / EU / IN / JP / CN) edit the authUrl and tokenUrl in the
    // wizard's Advanced section — see the setup steps below for the mapping.
    authUrl: 'https://accounts.zoho.com.au/oauth/v2/auth',
    tokenUrl: 'https://accounts.zoho.com.au/oauth/v2/token',
    scopes: 'ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ',
    extraAuthParams: '{"access_type":"offline","prompt":"consent"}',
  },
  oauthSetupSteps: [
    'Log in to the Zoho API Console for your data centre — AU: https://api-console.zoho.com.au/, US: https://api-console.zoho.com/, EU: https://api-console.zoho.eu/, IN: https://api-console.zoho.in/, JP: https://api-console.zoho.jp/, CN: https://api-console.zoho.com.cn/',
    'Choose "Server-based Applications" as the client type and click Create Now',
    'Enter a Client Name, set Homepage URL to your Numa URL, and paste the redirect URI shown below under "Authorized Redirect URIs"',
    'Zoho returns a Client ID and Client Secret — copy both into this wizard',
    'Non-AU customers: open Advanced below and replace `accounts.zoho.com.au` with your region host (e.g. `accounts.zoho.eu`). The API host changes in the same way — `www.zohoapis.{region}`.',
  ],
},
```

**Field-by-field notes:**

| Field                   | Value                                                     | Notes                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | `zoho-crm`                                                | Connector slug; matches the `ext-api-doc/zoho-crm/` folder name. (Note: the **Pipedream** catalog uses `zoho_crm` with an underscore — a different surface.)                     |
| `displayName`           | `Zoho CRM`                                                | Shown in the Integrations UI.                                                                                                                                                    |
| `icon`                  | `bi-person-rolodex`                                       | Bootstrap Icons class (not an SVG path) — consistent with other connectors in the registry.                                                                                      |
| `description`           | `Zoho CRM — leads, contacts, accounts, deals, tasks`      | Card subtitle.                                                                                                                                                                   |
| `category`              | `CRM`                                                     | Groups it under the CRM tier.                                                                                                                                                    |
| `authType`              | `oauth2`                                                  | Drives the OAuth connect wizard (no `credentialFields`, unlike token/api-key connectors).                                                                                        |
| `surfaces`              | `['chat']`                                                | Direct-API only — keeps Zoho CRM out of Files > Remote; the workspace agent is the only consumer.                                                                                |
| `authHeaderScheme`      | `Zoho-oauthtoken`                                         | **Critical.** Tells the proxy to emit `Authorization: Zoho-oauthtoken {token}` instead of `Bearer`. Wrong scheme → `INVALID_TOKEN` 401. [VERIFIED 2026-05-29]                    |
| `oauth.authUrl`         | `https://accounts.zoho.com.au/oauth/v2/auth`              | **AU default.** Authorization-code endpoint. Region-pinned — see §4 region table.                                                                                                |
| `oauth.tokenUrl`        | `https://accounts.zoho.com.au/oauth/v2/token`             | **AU default.** Token exchange + refresh endpoint. Region-pinned.                                                                                                                |
| `oauth.scopes`          | `ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ` | **Comma-delimited** (Zoho/Xero quirk — most providers use spaces). See the scope-gap callout below.                                                                              |
| `oauth.extraAuthParams` | `{"access_type":"offline","prompt":"consent"}`            | `access_type=offline` is **MANDATORY** to receive a refresh_token; `prompt=consent` forces fresh consent on reconnect. [VERIFIED 2026-05-29 — `04-connection-and-reauth.md` § 2] |
| `oauthSetupSteps`       | 5-step array                                              | Rendered as admin guidance in the OAuth setup wizard.                                                                                                                            |

> **Comma-delimited scopes.** Zoho's authorize endpoint expects a **comma-separated** scope string,
> not the OAuth-standard space-delimited list. The frontend's
> `COMMA_SEPARATED_PROVIDERS` set in `wizards/oauthScopeDefinitions.ts` includes `'zoho-crm'`
> (alongside `'xero'`) so the wizard joins selected scopes with `,`. Do **not** "normalise" this to
> spaces. [VERIFIED 2026-05-29 — `oauthScopeDefinitions.ts:422`]

> **⚠ Scope-gap callout (carried from the investigation).** The live registry `scopes` string ships
> **three** scopes: `ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ`. The investigation's
> "default bundle" (`02-api-spec-investigation.md` § Required Scopes) recommends **six**, also adding
> `ZohoCRM.settings.modules.READ`, `ZohoCRM.settings.fields.READ`, and `ZohoCRM.coql.READ`.
> **Consequence:** without `settings.*.READ` and `coql.READ`, the agent's metadata-discovery calls
> (`GET /settings/modules`, `GET /settings/fields`) and COQL queries (`POST /crm/v8/coql`) will
> **403 `OAUTH_SCOPE_MISMATCH`**, even though `01-llm-api-rules.md` instructs the agent to use them
> (e.g. "use `GET /settings/fields?module=Leads` first when you don't know what to ask for", and the
> webhook-polling workaround is a COQL query). The wizard's `oauthScopeDefinitions.ts` exposes a
> selectable `ZohoCRM.settings.READ` toggle (default **off**) but does **not** expose a `coql.READ`
> toggle. **Decision for the product owner:** to make the agent's documented metadata + COQL flows
> work, either (a) flip the `settings` toggle on at connect time **and** add `ZohoCRM.coql.READ` to
> the registry `scopes` string / scope definitions, or (b) accept that those flows 403 and rely on
> the agent's fallback behaviour. This is a deliberate config decision, not a doc gap — adding scopes
> requires re-consent (Zoho re-consents app-level on scope change). [VERIFIED 2026-05-29 —
> > `connectorRegistry.ts` vs `02-api-spec § Required Scopes` and `oauthScopeDefinitions.ts:298-326`]

---

## 2. No Backend Provider Class (Direct API via `connect_request`)

Unlike file-browsing connectors (Google Drive, OneDrive, Box, Dropbox), Zoho CRM does **not** get a
`lib/oauth-providers/zoho_crm_provider.py` class and is **not** registered in
`lib/oauth-providers/__init__.py`. There is no `list_files`/`download_file` surface to implement —
the integration-path assessment in `02-api-spec-investigation.md` scores all four file methods as
"none" feasibility.

Instead, the workspace agent reaches Zoho CRM through the connector's **`connect_request`** proxy:

- The proxy holds the OAuth token (refreshed via the admin-configured `oauth.tokenUrl`) and forwards
  authenticated HTTP requests to the region-correct API host.
- The agent issues plain REST calls (the same ones in `01-llm-api-rules.md` / `02-api-spec`) and the
  proxy attaches `Authorization: Zoho-oauthtoken {access_token}` (driven by `authHeaderScheme`).
- **Zoho-specific region pinning.** The API host is **not** `Bearer`-style global — it is
  `https://www.zohoapis.{region}/crm/v8/`, and it **must match the data centre** that minted the
  token. The token response includes an **`api_domain`** field (e.g.
  `"https://www.zohoapis.com.au"`); the connector must **save and use that exact value** rather than
  computing one from the admin-configured region, because a user may belong to a Zoho org in a
  different data centre. A mismatched accounts/API host returns a **misleading 401 `INVALID_TOKEN`**
  (not an obvious "wrong region" error). [VERIFIED 2026-05-29 — `04-connection-and-reauth.md` § 2,
  § 5; `02-api-spec § Multi-DC`]
- **JSON-only.** The proxy sends JSON; file/attachment upload/download from chat is not supported in
  this iteration (`01-llm-api-rules.md` § CANNOT).

This mirrors how the other Direct-API records connectors (Xero, MYOB AccountRight, simPRO, Jobber)
are wired: registry entry + workspace-agent prompt, no Files provider.

> **Template note:** the generic template's §2 (Backend Provider Class), §3 (Registration in
> `__init__.py`), and §7 (file Browse/Download Testing Plan) are **N/A** for this connector and are
> intentionally omitted — Zoho CRM is records-and-actions, not a file browser.

---

## 3. Workspace Agent Prompt Deployment (how `ext-api-doc/zoho-crm/` reaches the agent)

The `ext-api-doc/zoho-crm/` markdown files are shipped to each client's S3 bucket at deploy time and
loaded by the workspace agent when the Zoho CRM connector is active.

**Mechanism (cite for reviewers — same machinery as all `ext-api-doc/` connectors):**

- **Bucket:** `numa-client-stack.ts` provisions a per-client `ext-api-doc` bucket via
  `core-numa-infra-construct.ts` (`extApiDocBucket`, name `${numaClient}-ext-api-doc`).
- **Sync:** at the **end** of `numa-client-stack.ts` (to avoid shifting Terraform resource
  addresses), the stack walks the repo's `ext-api-doc/` directory recursively and creates an
  `S3Object` for every `.md` file (skipping `_templates/`), keyed by its relative path
  (e.g. `zoho-crm/01-llm-api-rules.md`), with `contentType: 'text/markdown'` and a `filemd5`
  source hash so changed files re-upload on deploy.
- **Discovery:** `admin-data-connector-settings-get` lists this bucket
  (`EXT_API_DOC_BUCKET_NAME`) to report which connectors have docs available.
- **Agent load:** the workspace agent loads the **`01-*.md`** knowledge pack (the main rules file
  `01-llm-api-rules.md` plus companions `01a`–`01d`) into context when the Zoho CRM connector is
  active. The `00-`, `02-`, `03-`, `04-` files are developer/build reference and are **not** part
  of the agent's runtime context.

**Files in `ext-api-doc/zoho-crm/`:**

| File                                    | Audience            | Shipped to S3 | Loaded into agent context |
| --------------------------------------- | ------------------- | ------------- | ------------------------- |
| `00-api-investigation-questionnaire.md` | Developer           | Yes           | No                        |
| `01-llm-api-rules.md`                   | **Workspace agent** | Yes           | **Yes** (main rules)      |
| `01a-domain-model-reference.md`         | **Workspace agent** | Yes           | **Yes**                   |
| `01b-query-patterns.md`                 | **Workspace agent** | Yes           | **Yes**                   |
| `01c-mutation-patterns.md`              | **Workspace agent** | Yes           | **Yes** (writes)          |
| `01d-event-and-error-handling.md`       | **Workspace agent** | Yes           | **Yes**                   |
| `02-api-spec-investigation.md`          | Developer           | Yes           | No                        |
| `03-connector-setup.md` (this file)     | Developer           | Yes           | No                        |
| `04-connection-and-reauth.md`           | Developer / ops     | Yes           | No                        |

> Editing any `01-*.md` and redeploying (`make deploy` / the per-client CDKTF deploy) re-uploads
> the changed object via the `filemd5` source hash. No code change is needed — the sync is purely
> file-driven.

---

## 4. Admin & User Auth Flows

### Region matrix (the gotcha that breaks naive automation)

The accounts host **and** the API host must match the user's Zoho data centre. A token minted at
`accounts.zoho.com.au` only works against `www.zohoapis.com.au`; a mismatch returns
`INVALID_TOKEN` 401. The admin sets the region at wizard time (defaults to AU) by editing the
`authUrl`/`tokenUrl` in the wizard's Advanced section.
[VERIFIED 2026-05-29 — `04-connection-and-reauth.md` § 1]

| Region | Developer console          | Accounts host (auth/token)     | API host              |
| ------ | -------------------------- | ------------------------------ | --------------------- |
| AU     | `api-console.zoho.com.au`  | `accounts.zoho.com.au`         | `www.zohoapis.com.au` |
| US     | `api-console.zoho.com`     | `accounts.zoho.com`            | `www.zohoapis.com`    |
| EU     | `api-console.zoho.eu`      | `accounts.zoho.eu`             | `www.zohoapis.eu`     |
| IN     | `api-console.zoho.in`      | `accounts.zoho.in`             | `www.zohoapis.in`     |
| JP     | `api-console.zoho.jp`      | `accounts.zoho.jp`             | `www.zohoapis.jp`     |
| CN     | `api-console.zoho.com.cn`  | `accounts.zoho.com.cn`         | `www.zohoapis.com.cn` |
| **CA** | `api-console.zohocloud.ca` | **`accounts.zohocloud.ca`** ⚠️ | `www.zohoapis.ca`     |

> **⚠ Canada is a special case.** The CA accounts host is **`accounts.zohocloud.ca`** (NOT
> `accounts.zoho.ca`). Naive `accounts.zoho.{region}` substitution routes CA customers to a
> non-existent host and OAuth fails at DNS resolution before any error UI. Special-case CA
> explicitly. [VERIFIED 2026-05-19 against https://www.zoho.com/crm/developer/docs/api/v8/multi-dc.html]
> (The live registry's `oauthSetupSteps` list AU/US/EU/IN/JP/CN consoles but **omit CA** — if a CA
> customer is onboarded, the wizard text must be extended. [VERIFIED 2026-05-29 — `connectorRegistry.ts`])

### OAuth endpoints & parameters

| Property          | Value                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grant types       | `authorization_code` (initial), `refresh_token` (renewal)                                                                                                  |
| Authorization URL | `https://accounts.zoho.{region}/oauth/v2/auth` — **except CA: `https://accounts.zohocloud.ca/oauth/v2/auth`**                                              |
| Token URL         | `https://accounts.zoho.{region}/oauth/v2/token` — **except CA: `https://accounts.zohocloud.ca/oauth/v2/token`**                                            |
| Revocation URL    | `https://accounts.zoho.{region}/oauth/v2/token/revoke` (CA: `accounts.zohocloud.ca`) — `POST` form `token={refresh_token}`, returns `{"status":"success"}` |
| Redirect URI      | `https://{client-name}.numa.arcanum.ai/oauth/callback/zoho-crm` — copy byte-for-byte from the wizard (Zoho does exact matching)                            |
| Header scheme     | `Authorization: Zoho-oauthtoken {access_token}` — **NOT `Bearer`** (response `token_type` says `"Bearer"` but Zoho ignores it)                             |
| Scopes (registry) | `ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ` (comma-delimited; see scope-gap callout in §1)                                                   |
| `access_type`     | `offline` — **MANDATORY** to receive a refresh_token                                                                                                       |
| `prompt`          | `consent` — recommended; forces fresh scope grant on reconnect                                                                                             |
| PKCE              | **No**                                                                                                                                                     |
| Access token TTL  | 1 hour (3600s)                                                                                                                                             |
| Refresh token TTL | Unlimited until revoked. **Not rotated** — the refresh response does NOT return a new refresh token                                                        |
| Refresh-token cap | Zoho caps **20 active refresh tokens per user per app**; issuing a 21st invalidates the oldest                                                             |

[All values VERIFIED 2026-05-29 — `04-connection-and-reauth.md` §§ 2–4; `02-api-spec § Authentication`]

### Credentials to store

| Credential             | Scope (vault)             | Source                                                                 |
| ---------------------- | ------------------------- | ---------------------------------------------------------------------- |
| Client ID              | **Company** (admin-owned) | Zoho API Console — `1000.` + 32 chars                                  |
| Client Secret          | **Company** (admin-owned) | Zoho API Console — 64-char hex, **shown once**                         |
| Region / accounts host | **Company** (admin-owned) | Admin selection at wizard time (drives `authUrl`/`tokenUrl`)           |
| Access token           | **User** (per-user)       | Token exchange response — short-lived (1h)                             |
| Refresh token          | **User** (per-user)       | Token exchange response — long-lived, **not rotated**, store carefully |
| `api_domain`           | **User** (per-user)       | Token response field — the exact API host to call; do not recompute    |

[VERIFIED 2026-05-29 — `04-connection-and-reauth.md` §§ 1–3. The PAT/api-key admin path from the
generic template is **N/A** — Zoho CRM offers **no PAT** for the CRM API; OAuth is the only path.]

### Flow summary

| Flow             | Who    | What happens                                                                                                                                                                                                                     |
| ---------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin setup      | Admin  | Registers a Zoho "Server-based Application" per `oauthSetupSteps`; selects region; stores the **company** Client ID + Secret in the vault. See `04-connection-and-reauth.md`.                                                    |
| User connect     | User   | OAuth authorization-code redirect to `oauth.authUrl` with `access_type=offline&prompt=consent`; on callback the proxy exchanges the code at `oauth.tokenUrl`, storing the **user** access + refresh tokens **and `api_domain`**. |
| Token refresh    | System | Before/on 401 `INVALID_TOKEN`: `POST oauth.tokenUrl` `grant_type=refresh_token`; reuse the **same** refresh token (no rotation); retry the original call once.                                                                   |
| User disconnect  | User   | Deletes the **user** tokens only; the company Client ID/Secret are untouched.                                                                                                                                                    |
| Admin disconnect | Admin  | Deletes the company Client ID/Secret; optionally `POST .../token/revoke` and/or revoke app access in Zoho.                                                                                                                       |

### Reauthorization triggers

| Trigger                              | Detection                                             | Action                                                                                 |
| ------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Access token expired                 | HTTP 401 `INVALID_TOKEN` on an API call               | Refresh via refresh_token; retry once                                                  |
| Refresh token revoked / >20 issued   | Refresh call returns 4xx (`invalid_code` / 401 / 400) | Mark user disconnected; prompt full re-consent                                         |
| Scopes changed at app level          | API call returns 403 `OAUTH_SCOPE_MISMATCH`           | Admin updates scopes in `api-console.zoho.{region}`; user reconnects                   |
| User revoked via Zoho UI             | 401 on **both** refresh and API calls                 | Disconnect; full re-consent                                                            |
| Token used against wrong region host | 401 `INVALID_TOKEN` (misleading — not expiry)         | Verify admin `authUrl`/`tokenUrl` and stored `api_domain` match the user's data centre |

[VERIFIED 2026-05-29 — `04-connection-and-reauth.md` § 5]

Detailed app-registration, redirect-URI, scope, refresh, revocation, and reauth-trigger steps are in
`04-connection-and-reauth.md`.

---

## 5. i18n Keys

The native Zoho CRM connector is **table-driven**: its display strings come directly from the
`connectorRegistry.ts` entry (`displayName`, `description`), so **no `connectors.zoho-crm.*` i18n
keys are required** — same as the Xero connector.

> **Do not confuse** the native connector (`id: 'zoho-crm'`, hyphen) with the **Pipedream**
> integration catalog entry (`id: 'zoho_crm'`, underscore) in
> `numa-frontend/src/config/integrationsConfig.ts` + `locales/en/integrations.json`
> (`connections.zoho_crm.*`). Those are a **different surface** (Pipedream Connect) and already have
> their own `name` / `description` / `example_query` strings. This document concerns only the native
> Direct-API data connector. [VERIFIED 2026-05-29 — `integrations.json:295`, `integrationsConfig.ts:584`]

---

## 6. Deployment Checklist

> Reference: [Connector Checklist](../../documentation/connectors/README.md)

### Code / config

- [x] Registry entry present in `connectorRegistry.ts` (`id: 'zoho-crm'`)
- [x] Icon set (`bi-person-rolodex` — Bootstrap Icons class)
- [x] `authType: 'oauth2'` with `oauth.authUrl` / `oauth.tokenUrl` / `oauth.scopes`
- [x] `authHeaderScheme: 'Zoho-oauthtoken'` set (NOT `Bearer`)
- [x] `surfaces: ['chat']` (Direct-API; not in Files > Remote)
- [x] `extraAuthParams` includes `access_type=offline` (refresh token) + `prompt=consent`
- [x] `oauthSetupSteps` present (admin guidance)
- [x] `'zoho-crm'` registered in `COMMA_SEPARATED_PROVIDERS` (comma-delimited scope string)
- [ ] **Decide scope gap:** add `ZohoCRM.settings.modules.READ` / `ZohoCRM.settings.fields.READ` / `ZohoCRM.coql.READ` if the agent's metadata-discovery + COQL flows must work (currently 403). Re-consent required.
- [ ] **Add CA** to `oauthSetupSteps` console list if a Canada customer is onboarded (`accounts.zohocloud.ca`)
- [ ] No backend provider class needed (Direct-API path) — confirm not accidentally added to `lib/oauth-providers/__init__.py`
- [x] `01-*.md` knowledge pack authored (`01`, `01a`–`01d`)

### Auth flows

- [ ] Admin registers a Zoho "Server-based Application"; redirect URI matches the wizard string exactly
- [ ] Admin selects the correct region (Advanced section) — accounts host AND API host match the org's data centre
- [ ] Company Client ID + Secret saved to vault
- [ ] User connect (OAuth redirect → token exchange) works; refresh token + `api_domain` persisted
- [ ] Token refresh works using the **same** refresh token (no rotation)
- [ ] User disconnect deletes user tokens only; admin disconnect deletes company secret
- [ ] (Optional) Revocation via `POST .../token/revoke` returns `{"status":"success"}`

### Workspace agent

- [ ] Deploy syncs `ext-api-doc/zoho-crm/*.md` to `${client}-ext-api-doc` (verify in S3 after deploy)
- [ ] Agent's first liveness call `GET /crm/v8/org` returns 200 against the stored `api_domain`
- [ ] Agent lists/searches/gets records with required `fields` param; honours module case-sensitivity
- [ ] Agent correctly reports scope-gap limitations (no `/settings/*` or COQL if those scopes absent → 403)
- [ ] Agent honours 429 credit-based limits (`Retry-After` + exponential backoff) and handles 207 partial-batch

### CI/CD

- [ ] No new Lambda required (Direct-API connector) — no `.gitlab-ci.yml` / `package-all.sh` change
- [ ] Frontend build picks up the registry entry

---

## 7. Testing Plan

### Manual testing sequence (vendor + agent)

1. **Admin setup:** register the Zoho Server-based Application, select region, save the company Client ID/Secret.
2. **User connect:** complete the OAuth redirect (`access_type=offline&prompt=consent`); confirm access + refresh tokens **and `api_domain`** are stored.
3. **Liveness:** ask the agent "what Zoho org am I connected to?" → `GET https://{api_domain}/crm/v8/org` returns 200 with the org name.
4. **Header scheme:** confirm the proxy sends `Authorization: Zoho-oauthtoken …` (a `Bearer` header would return `INVALID_TOKEN` 401).
5. **List records:** "list my newest leads" → `GET /crm/v8/Leads?fields=Last_Name,First_Name,Email,Phone,Company,Lead_Status,Owner&per_page=200&sort_by=Modified_Time&sort_order=desc` (confirm `fields` is supplied — missing it returns 400 `REQUIRED_PARAM_MISSING`).
6. **Search:** "find the contact with email jane@acme.example" → `GET /crm/v8/Contacts/search?email=jane@acme.example` (one of criteria/email/phone/word only).
7. **Create:** "add a lead Jane Smith at Acme" → `POST /crm/v8/Leads` with `{"data":[{…}],"trigger":["workflow"]}`; verify SUCCESS + returned id (string).
8. **Scope gap:** "show me the field metadata for Leads" → if `settings.fields.READ` is absent, expect a clean 403 `OAUTH_SCOPE_MISMATCH` explanation, not a silent failure.
9. **Token refresh:** after >1h idle, confirm a 401 triggers a silent refresh + single retry, reusing the same refresh token.
10. **User disconnect:** disconnect; confirm subsequent calls fail / prompt reconnect.

### Edge cases

- [ ] Access token expired mid-session (1h) → refresh + retry once
- [ ] Refresh token revoked or >20 issued → 4xx on refresh → mark disconnected, full re-consent
- [ ] Wrong-region host → misleading 401 `INVALID_TOKEN` surfaced as a region mismatch, not "expired"
- [ ] **CA customer** → accounts host `accounts.zohocloud.ca` resolves (not `accounts.zoho.ca`)
- [ ] 429 credit-based limit → `Retry-After` honoured, exponential backoff (base 2s, max 60s), surface after 3 retries
- [ ] 207 partial batch → iterate `data[i].status`, report successes AND failures
- [ ] Custom/tenant-specific module → query `/settings/modules` first (never hardcode), respecting case-sensitivity
- [ ] IDs treated as opaque 18–19 digit strings (no integer parsing/truncation)

---

_Generated from `00-api-investigation-questionnaire.md` (Phase 2 + Phase 9) and verified against the
live `connectorRegistry.ts` entry. See also:_

- _[Connector Framework Documentation](../../documentation/connectors/README.md)_
- _`02-api-spec-investigation.md` — clean developer API reference_
- _`04-connection-and-reauth.md` — OAuth app registration, region matrix, scopes, refresh, revocation, reauth triggers_
- _`01-llm-api-rules.md` (+ `01a`–`01d`) — the workspace-agent knowledge pack_
