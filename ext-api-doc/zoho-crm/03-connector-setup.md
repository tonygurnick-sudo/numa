---
api_name: Zoho CRM
connector_id: zoho-crm
doc: connector & integration setup (developer/build reference — NOT loaded into agent context)
auth_type: oauth2
auth_header_scheme: Zoho-oauthtoken (NOT Bearer)
tier: standard
category: crm
integration_path: direct-api (connect_request HTTP proxy; surfaces:['chat']; NO Files provider, no list_files/download_file)
registry_status: connector ALREADY EXISTS in connectorRegistry.ts (id:'zoho-crm')
backend_provider_class: none (Direct-API; do NOT add to lib/oauth-providers/__init__.py)
confidence: every fact VERIFIED 2026-05-29 against connectorRegistry.ts unless tagged otherwise
prereqs: 00-questionnaire, 02-api-spec, 04-connection-and-reauth, documentation/connectors/README.md
---

# Zoho CRM — Connector & Integration Setup

> The connector already exists in `connectorRegistry.ts`. This doc reproduces/explains the real entry, the Direct-API (`connect_request`) path, and how `ext-api-doc/zoho-crm/` reaches the agent.

## Integration Type

Direct API Only via `connect_request` proxy. Records CRM, not a file browser → no `lib/oauth-providers/` provider class, not in `lib/oauth-providers/__init__.py` (`02-api-spec` scores all four file methods "none"). `surfaces:['chat']` keeps it out of Files > Remote — the agent is the only consumer. Token injected per call as `Authorization: Zoho-oauthtoken {access_token}` (via `authHeaderScheme`, NOT `Bearer`). Same wiring as the other Direct-API records connectors (Xero, MYOB AccountRight, simPRO, Jobber): registry entry + agent prompt, no Files provider.

| Component                          | Required?                | Notes                                                                                       |
| ---------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| Connector Registry entry           | Yes — **already exists** | `id:'zoho-crm'` in `connectorRegistry.ts` (§1)                                              |
| Admin OAuth app setup              | Yes                      | per-client Zoho "Server-based Application" (Client ID/Secret) — see `04`                    |
| Backend provider class             | **No**                   | Files-connector providers only; Zoho CRM is Direct-API                                      |
| Workspace agent prompt (`01-*.md`) | Yes                      | deployed to S3 by `numa-client-stack.ts` (§3)                                               |
| Feature flag                       | Yes                      | `DATA_CONNECTORS_ENABLED` (gates connectors + Secrets Vault) [INFERRED — same gate as xero] |
| i18n keys                          | No (table-driven)        | display strings come from the registry entry                                                |

> Generic-template §2 (Backend Provider Class), §3 (`__init__.py` registration), §7 (file Browse/Download test plan) are N/A and intentionally omitted — Zoho CRM is records-and-actions, not a file browser.

## 1. Connector Registry Entry (real, existing)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (entry `id:'zoho-crm'`, under "Tier 2: OAuth2 (CRM)"). Reproduced verbatim:

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
    // Defaults to AU region. Admins serving other Zoho data centres (US/EU/IN/JP/CN)
    // edit authUrl and tokenUrl in the wizard's Advanced section — see setup steps.
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

Field notes (load-bearing fields; the rest are self-evident from the code block):
| Field | Notes |
| --- | --- |
| `id` `zoho-crm` | slug; matches `ext-api-doc/zoho-crm/` folder. Pipedream catalog uses `zoho_crm` (underscore) — different surface. |
| `authType` `oauth2` | OAuth connect wizard (no `credentialFields`) |
| `surfaces` `['chat']` | Direct-API only; not in Files > Remote |
| `authHeaderScheme` `Zoho-oauthtoken` | **Critical.** Proxy emits `Authorization: Zoho-oauthtoken {token}`, not `Bearer`. Wrong scheme → 401 `INVALID_TOKEN`. |
| `oauth.authUrl`/`tokenUrl` | `https://accounts.zoho.com.au/oauth/v2/{auth\|token}` — **AU default**, region-pinned (§4); tokenUrl also handles refresh |
| `oauth.scopes` | `ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ` — **comma-delimited** (Zoho/Xero quirk); see scope-gap callout |
| `oauth.extraAuthParams` | `{"access_type":"offline","prompt":"consent"}` — `access_type=offline` **MANDATORY** for a refresh_token; `prompt=consent` forces fresh consent on reconnect |

> **Comma-delimited scopes.** Zoho's authorize endpoint expects a comma-separated scope string, not the OAuth-standard space-delimited list. `COMMA_SEPARATED_PROVIDERS` in `wizards/oauthScopeDefinitions.ts` includes `'zoho-crm'` (alongside `'xero'`) so the wizard joins with `,`. Do NOT normalise to spaces. [VERIFIED — `oauthScopeDefinitions.ts:422`]

> **⚠ Scope-gap callout.** Live registry `scopes` ships **three**: `ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ`. The investigation's "default bundle" (`02 § Required Scopes`) recommends **six**, also adding `ZohoCRM.settings.modules.READ`, `ZohoCRM.settings.fields.READ`, `ZohoCRM.coql.READ`. **Consequence:** without `settings.*.READ` + `coql.READ`, the agent's metadata-discovery (`GET /settings/modules`, `GET /settings/fields`) and COQL (`POST /crm/v8/coql`) **403 `OAUTH_SCOPE_MISMATCH`** — even though `01-llm-api-rules.md` instructs the agent to use them (e.g. "use `GET /settings/fields?module=Leads` first…", and the webhook-polling workaround is a COQL query). The wizard's `oauthScopeDefinitions.ts` exposes a selectable `ZohoCRM.settings.READ` toggle (default **off**) but NO `coql.READ` toggle. **Product-owner decision:** to make the documented metadata + COQL flows work, either (a) flip `settings` on at connect time AND add `ZohoCRM.coql.READ` to the registry `scopes` / scope definitions, or (b) accept those flows 403 and rely on agent fallback. Adding scopes requires re-consent (Zoho re-consents app-level on scope change). This is a deliberate config decision, not a doc gap. [VERIFIED — `connectorRegistry.ts` vs `02 § Required Scopes` and `oauthScopeDefinitions.ts:298-326`]

## 2. No Backend Provider Class (Direct API via `connect_request`)

Proxy holds the OAuth token (refreshed via `oauth.tokenUrl`), forwards authenticated HTTP to the region-correct host, attaches `Authorization: Zoho-oauthtoken {access_token}`. Agent issues the plain REST calls from `01`/`02`.

- **Region pinning.** API host `https://www.zohoapis.{region}/crm/v8/` **must match the DC that minted the token**. Save and use the token response's **`api_domain`** field (e.g. `"https://www.zohoapis.com.au"`) exactly — do NOT compute one from the admin-configured region (a user may belong to a Zoho org in a different DC). Mismatch → misleading **401 `INVALID_TOKEN`** (not an obvious "wrong region"). [VERIFIED — `04 §§2,5`; `02 § Multi-DC`]
- **JSON-only.** No attachment up/download from chat this iteration (`01 § CANNOT`).

## 3. Agent Prompt Deployment (how `ext-api-doc/zoho-crm/` reaches the agent)

Same machinery as all `ext-api-doc/` connectors:

- **Bucket:** `numa-client-stack.ts` provisions a per-client `ext-api-doc` bucket via `core-numa-infra-construct.ts` (`extApiDocBucket`, `${numaClient}-ext-api-doc`).
- **Sync:** at the end of `numa-client-stack.ts` (avoids shifting Terraform resource addresses), the stack walks `ext-api-doc/` recursively and creates an `S3Object` for every `.md` (skipping `_templates/`), keyed by relative path (e.g. `zoho-crm/01-llm-api-rules.md`), `contentType:'text/markdown'`, with a `filemd5` source hash so changed files re-upload on deploy.
- **Discovery:** `admin-data-connector-settings-get` lists this bucket (`EXT_API_DOC_BUCKET_NAME`) to report which connectors have docs.
- **Agent load:** the agent loads the **`01-*.md`** knowledge pack (`01-llm-api-rules.md` + companions `01a`–`01d`) when the Zoho CRM connector is active. `00`/`02`/`03`/`04` are developer/build reference and are NOT in agent runtime context.

| File                                    | Audience        | Shipped to S3 | Loaded into agent    |
| --------------------------------------- | --------------- | ------------- | -------------------- |
| `00-api-investigation-questionnaire.md` | Developer       | Yes           | No                   |
| `01-llm-api-rules.md`                   | **Agent**       | Yes           | **Yes** (main rules) |
| `01a-domain-model-reference.md`         | **Agent**       | Yes           | **Yes**              |
| `01b-query-patterns.md`                 | **Agent**       | Yes           | **Yes**              |
| `01c-mutation-patterns.md`              | **Agent**       | Yes           | **Yes** (writes)     |
| `01d-event-and-error-handling.md`       | **Agent**       | Yes           | **Yes**              |
| `02-api-spec-investigation.md`          | Developer       | Yes           | No                   |
| `03-connector-setup.md` (this)          | Developer       | Yes           | No                   |
| `04-connection-and-reauth.md`           | Developer / ops | Yes           | No                   |

> Editing any `01-*.md` and redeploying re-uploads the changed object via the `filemd5` hash — no code change needed, the sync is file-driven.

## 4. Admin & User Auth Flows

### Region matrix (the gotcha that breaks naive automation)

Accounts host AND API host must match the user's Zoho data centre. A token from `accounts.zoho.com.au` works only against `www.zohoapis.com.au`; mismatch → 401 `INVALID_TOKEN`. Admin sets region at wizard time (defaults AU) by editing `authUrl`/`tokenUrl` in Advanced.

| Region | Developer console          | Accounts host (auth/token)     | API host              |
| ------ | -------------------------- | ------------------------------ | --------------------- |
| AU     | `api-console.zoho.com.au`  | `accounts.zoho.com.au`         | `www.zohoapis.com.au` |
| US     | `api-console.zoho.com`     | `accounts.zoho.com`            | `www.zohoapis.com`    |
| EU     | `api-console.zoho.eu`      | `accounts.zoho.eu`             | `www.zohoapis.eu`     |
| IN     | `api-console.zoho.in`      | `accounts.zoho.in`             | `www.zohoapis.in`     |
| JP     | `api-console.zoho.jp`      | `accounts.zoho.jp`             | `www.zohoapis.jp`     |
| CN     | `api-console.zoho.com.cn`  | `accounts.zoho.com.cn`         | `www.zohoapis.com.cn` |
| **CA** | `api-console.zohocloud.ca` | **`accounts.zohocloud.ca`** ⚠️ | `www.zohoapis.ca`     |

> **⚠ Canada special case.** CA accounts host is **`accounts.zohocloud.ca`** (NOT `accounts.zoho.ca`). Naive `accounts.zoho.{region}` substitution routes CA customers to a non-existent host — OAuth fails at DNS resolution before any error UI. Special-case CA explicitly. [VERIFIED 2026-05-19 — multi-dc.html] The live `oauthSetupSteps` list AU/US/EU/IN/JP/CN consoles but **omit CA** — extend the wizard text if a CA customer is onboarded.

### OAuth endpoints & parameters

| Property          | Value                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grant types       | `authorization_code` (initial), `refresh_token` (renewal)                                                                                           |
| Authorization URL | `https://accounts.zoho.{region}/oauth/v2/auth` — **CA: `https://accounts.zohocloud.ca/oauth/v2/auth`**                                              |
| Token URL         | `https://accounts.zoho.{region}/oauth/v2/token` — **CA: `https://accounts.zohocloud.ca/oauth/v2/token`**                                            |
| Revocation URL    | `https://accounts.zoho.{region}/oauth/v2/token/revoke` (CA: `accounts.zohocloud.ca`) — `POST` form `token={refresh_token}` → `{"status":"success"}` |
| Redirect URI      | `https://{client-name}.numa.arcanum.ai/oauth/callback/zoho-crm` — copy byte-for-byte from wizard (Zoho does exact matching)                         |
| Header scheme     | `Authorization: Zoho-oauthtoken {access_token}` — **NOT `Bearer`** (response `token_type` says `"Bearer"` but Zoho ignores it)                      |
| Scopes (registry) | `ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ` (comma-delimited; see scope-gap §1)                                                       |
| `access_type`     | `offline` — **MANDATORY** for a refresh_token                                                                                                       |
| `prompt`          | `consent` — recommended; fresh scope grant on reconnect                                                                                             |
| PKCE              | No                                                                                                                                                  |
| Access token TTL  | 1 hour (3600s)                                                                                                                                      |
| Refresh token TTL | unlimited until revoked. **Not rotated** — refresh response returns no new refresh token                                                            |
| Refresh-token cap | Zoho caps **20 active refresh tokens per user per app**; a 21st invalidates the oldest                                                              |

### Credentials to store

| Credential             | Vault scope         | Source                                                          |
| ---------------------- | ------------------- | --------------------------------------------------------------- |
| Client ID              | **Company** (admin) | Zoho API Console — `1000.` + 32 chars                           |
| Client Secret          | **Company** (admin) | Zoho API Console — 64-char hex, **shown once**                  |
| Region / accounts host | **Company** (admin) | admin selection at wizard time (drives `authUrl`/`tokenUrl`)    |
| Access token           | **User** (per-user) | token response — short-lived (1h)                               |
| Refresh token          | **User** (per-user) | token response — long-lived, **not rotated**, store carefully   |
| `api_domain`           | **User** (per-user) | token response field — exact API host to call; do not recompute |

> PAT/api-key admin path from the generic template is N/A — Zoho CRM offers **no PAT** for the CRM API; OAuth is the only path.

### Flow summary

| Flow             | Who    | What                                                                                                                                                                                                      |
| ---------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin setup      | Admin  | registers a Zoho "Server-based Application" per `oauthSetupSteps`; selects region; stores **company** Client ID + Secret                                                                                  |
| User connect     | User   | authorization-code redirect to `oauth.authUrl` with `access_type=offline&prompt=consent`; on callback proxy exchanges code at `oauth.tokenUrl`, storing **user** access + refresh tokens AND `api_domain` |
| Token refresh    | System | on/before 401 `INVALID_TOKEN`: `POST oauth.tokenUrl` `grant_type=refresh_token`; reuse the SAME refresh token (no rotation); retry original call once                                                     |
| User disconnect  | User   | deletes user tokens only; company Client ID/Secret untouched                                                                                                                                              |
| Admin disconnect | Admin  | deletes company Client ID/Secret; optionally `POST .../token/revoke` and/or revoke app access in Zoho                                                                                                     |

### Reauthorization triggers

| Trigger                            | Detection                                     | Action                                                                      |
| ---------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| Access token expired               | 401 `INVALID_TOKEN` on a call                 | refresh; retry once                                                         |
| Refresh token revoked / >20 issued | refresh returns 4xx (`invalid_code`/401/400)  | mark disconnected; prompt full re-consent                                   |
| Scopes changed at app level        | 403 `OAUTH_SCOPE_MISMATCH`                    | admin updates scopes in `api-console.zoho.{region}`; user reconnects        |
| User revoked via Zoho UI           | 401 on BOTH refresh and API calls             | disconnect; full re-consent                                                 |
| Wrong-region host                  | 401 `INVALID_TOKEN` (misleading — not expiry) | verify admin `authUrl`/`tokenUrl` + stored `api_domain` match the user's DC |

Detailed app-registration, redirect-URI, scope, refresh, revocation, reauth steps: `04-connection-and-reauth.md`.

## 5. i18n Keys

Table-driven: display strings come from the `connectorRegistry.ts` entry (`displayName`, `description`) — **no `connectors.zoho-crm.*` keys required** (same as Xero).

> Do NOT confuse the native connector (`id:'zoho-crm'`, hyphen) with the **Pipedream** catalog entry (`id:'zoho_crm'`, underscore) in `integrationsConfig.ts` + `locales/en/integrations.json` (`connections.zoho_crm.*`). Different surface (Pipedream Connect), with its own `name`/`description`/`example_query`. This doc concerns only the native Direct-API data connector. [VERIFIED — `integrations.json:295`, `integrationsConfig.ts:584`]

## 6. Deployment Checklist

Reference: [Connector Checklist](../../documentation/connectors/README.md)

Code/config:

- [x] Registry entry present (`id:'zoho-crm'`)
- [x] Icon set (`bi-person-rolodex`)
- [x] `authType:'oauth2'` with `oauth.authUrl`/`tokenUrl`/`scopes`
- [x] `authHeaderScheme:'Zoho-oauthtoken'` (NOT `Bearer`)
- [x] `surfaces:['chat']` (Direct-API; not in Files > Remote)
- [x] `extraAuthParams` includes `access_type=offline` + `prompt=consent`
- [x] `oauthSetupSteps` present
- [x] `'zoho-crm'` registered in `COMMA_SEPARATED_PROVIDERS`
- [ ] **Decide scope gap:** add `ZohoCRM.settings.modules.READ`/`settings.fields.READ`/`coql.READ` if metadata-discovery + COQL flows must work (currently 403). Re-consent required.
- [ ] **Add CA** to `oauthSetupSteps` console list if a Canada customer is onboarded (`accounts.zohocloud.ca`)
- [ ] No backend provider class (Direct-API) — confirm not accidentally added to `lib/oauth-providers/__init__.py`
- [x] `01-*.md` knowledge pack authored (`01`,`01a`–`01d`)

Auth flows:

- [ ] Admin registers a Zoho "Server-based Application"; redirect URI matches wizard string exactly
- [ ] Admin selects correct region (Advanced) — accounts host AND API host match the org's DC
- [ ] Company Client ID + Secret saved to vault
- [ ] User connect works; refresh token + `api_domain` persisted
- [ ] Token refresh works reusing the SAME refresh token (no rotation)
- [ ] User disconnect deletes user tokens only; admin disconnect deletes company secret
- [ ] (Optional) revocation via `POST .../token/revoke` → `{"status":"success"}`

Workspace agent:

- [ ] Deploy syncs `ext-api-doc/zoho-crm/*.md` to `${client}-ext-api-doc` (verify in S3)
- [ ] First liveness call `GET /crm/v8/org` returns 200 against the stored `api_domain`
- [ ] Agent lists/searches/gets with required `fields`; honours module case-sensitivity
- [ ] Agent reports scope-gap limitations (no `/settings/*` or COQL if those scopes absent → 403)
- [ ] Agent honours 429 credit limits (`Retry-After` + backoff) and handles 207 partial-batch

CI/CD:

- [ ] No new Lambda (Direct-API) — no `.gitlab-ci.yml`/`package-all.sh` change
- [ ] Frontend build picks up the registry entry

## 7. Testing Plan

### Manual sequence (vendor + agent)

1. **Admin setup:** register the Server-based Application, select region, save company Client ID/Secret.
2. **User connect:** complete OAuth redirect (`access_type=offline&prompt=consent`); confirm access + refresh tokens AND `api_domain` stored.
3. **Liveness:** "what Zoho org am I connected to?" → `GET https://{api_domain}/crm/v8/org` returns 200 + org name.
4. **Header scheme:** confirm proxy sends `Authorization: Zoho-oauthtoken …` (a `Bearer` header → 401 `INVALID_TOKEN`).
5. **List records:** "list my newest leads" → `GET /crm/v8/Leads?fields=Last_Name,First_Name,Email,Phone,Company,Lead_Status,Owner&per_page=200&sort_by=Modified_Time&sort_order=desc` (missing `fields` → 400 `REQUIRED_PARAM_MISSING`).
6. **Search:** "find the contact with email jane@acme.example" → `GET /crm/v8/Contacts/search?email=jane@acme.example` (one of criteria/email/phone/word only).
7. **Create:** "add a lead Jane Smith at Acme" → `POST /crm/v8/Leads` `{"data":[{…}],"trigger":["workflow"]}`; verify SUCCESS + returned id (string).
8. **Scope gap:** "show me the field metadata for Leads" → if `settings.fields.READ` absent, expect a clean 403 `OAUTH_SCOPE_MISMATCH` explanation, not silent failure.
9. **Token refresh:** after >1h idle, a 401 triggers a silent refresh + single retry, reusing the same refresh token.
10. **User disconnect:** disconnect; subsequent calls fail / prompt reconnect.

### Edge cases

- [ ] Access token expired mid-session (1h) → refresh + retry once
- [ ] Refresh token revoked or >20 issued → 4xx on refresh → mark disconnected, full re-consent
- [ ] Wrong-region host → misleading 401 `INVALID_TOKEN` surfaced as a region mismatch, not "expired"
- [ ] **CA customer** → accounts host `accounts.zohocloud.ca` resolves (not `accounts.zoho.ca`)
- [ ] 429 credit limit → `Retry-After` honoured, exponential backoff (base 2s, max 60s), surface after 3 retries
- [ ] 207 partial batch → iterate `data[i].status`, report successes AND failures
- [ ] Custom/tenant module → query `/settings/modules` first (never hardcode), respect case-sensitivity
- [ ] IDs treated as opaque 18–19 digit strings (no integer parsing/truncation)

---

See also: [Connector Framework](../../documentation/connectors/README.md) · `02-api-spec-investigation.md` (clean developer API reference) · `04-connection-and-reauth.md` (OAuth app registration, region matrix, scopes, refresh, revocation, reauth) · `01-llm-api-rules.md` + `01a`–`01d` (agent knowledge pack).
