---
api_name: PMO365 (Microsoft Dataverse)
connector_id: pmo365
auth_type: oauth2
tier: standard
category: project-management
integration_path: 'Direct API (spec-driven, chat-only) — surfaces=[chat]; HTTP via connect_request; NO lib/oauth-providers/ provider class (not file-browsing)'
base_url: '{environment_url}/api/data/v9.2/'
schema_confidence: 'All pmo_* names ILLUSTRATIVE [INFERRED] — confirm via discovery / $metadata. Never mark a pmo_* name [CONFIRMED].'
---

# PMO365 (Microsoft Dataverse) — Connector & Integration Setup

Build instructions. **Path: Direct API, chat-only, spec-driven** — same shape as Actionstep / NetSuite / Zoho CRM. PMO365 has **no API of its own**; data lives in the customer's **Microsoft Dataverse** environment, integrated via the **Dataverse Web API** (OData v4, JSON) at `{environment_url}/api/data/v9.2/`. The agent reads `ext-api-doc/pmo365/` and calls Dataverse through the connector request path. **No `lib/oauth-providers/` provider class** (not Files-Remote / file-browsing). Prereqs: read `00-api-investigation-questionnaire.md`, activate the `numa-connectors` skill.

## Integration Type — Direct API (spec-driven, chat-only)

| Component                       | Required? | Status                                           |
| ------------------------------- | --------- | ------------------------------------------------ |
| Connector Registry entry        | Yes       | ✅ Done — `connectorRegistry.ts`                 |
| `ext-api-doc/pmo365/` specs     | Yes       | ✅ Done — this folder                            |
| Admin OAuth wizard              | Yes       | ✅ Generated from registry (no bespoke code)     |
| User integration (Connect)      | Yes       | ✅ Generated from registry (no bespoke code)     |
| OAuth scope picker entry        | No        | ❌ Not used — single `.default` scope, no picker |
| Native-connector catalog entry  | Yes       | ⏳ Confirm `infra/config/connectors.ts` lists it |
| `lib/oauth-providers/` provider | No        | ❌ Not needed (chat-only, not file-browsing)     |
| Auto-derive Dataverse scope     | Optional  | ⏳ Enhancement (see §3)                          |
| Entra app credentials           | Yes       | ⛔ External — register an app per customer       |

## 1. Connector Registry Entry (DONE)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (in the "Tier 2: OAuth2 (Microsoft Dataverse — PPM)" block). Shape, verbatim:

```typescript
{
  id: 'pmo365',
  displayName: 'PMO365',
  icon: 'bi-diagram-3',
  description: 'PMO365 project portfolio management — projects, risks, benefits, and financials, served from Microsoft Dataverse',
  category: 'Project Management',
  authType: 'oauth2',
  surfaces: ['chat'],
  cachingPolicy: CACHING_PRESETS.projectManagement,
  oauth: {
    authUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
    scopes: 'https://YOUR-ENV.crm.dynamics.com/.default offline_access',
    extraAuthParams: '{"response_mode":"query"}',
  },
  credentialFields: [
    { key: 'environment_url', label: 'Dataverse environment URL', type: 'url',
      placeholder: 'https://yourorg.crm.dynamics.com', required: true,
      helpText: 'Your PMO365 environment Dataverse URL (Power Platform admin center → Environments → your environment → Environment URL). All users in this workspace share it; the Web API is served from {environment_url}/api/data/v9.2/.' },
  ],
  oauthSetupSteps: [ /* Entra app registration steps — see §4 */ ],
}
```

Rationale:

- **`surfaces: ['chat']`** — chat-only; records are queried/mutated via the connector request path, not browsed in Files Remote (no `'files'` surface → no provider class).
- **`authType: 'oauth2'` + `organizations` authority** — Dataverse is a work/school resource only (no personal Microsoft accounts), so `organizations`, **not** `common`/`consumers`.
- **`scopes`** — Dataverse resource scope is **environment-specific**. `.default` requests every delegated permission the Entra app was granted (here: Dynamics CRM `user_impersonation`); `offline_access` yields the **refresh token**. The literal `YOUR-ENV.crm.dynamics.com` is a placeholder the admin must replace (§3).
- **`extraAuthParams: '{"response_mode":"query"}'`** — forces the v2.0 authorize endpoint to return the code on the query string (the redirect flow Numa expects); persisted to `extra_auth_params`.
- **`credentialFields: [environment_url]`** — workspace-wide base host, analogous to Actionstep's `api_endpoint` / Total Synergy's `instance_url`. The backend expands every relative path against `{environment_url}/api/data/v9.2/`.
- **`cachingPolicy: CACHING_PRESETS.projectManagement`** — 30-min (`ttl: 1800`) read cache, the shared PM preset.

## 2. Backend Provider Class — NOT REQUIRED

PMO365 is chat-only and spec-driven. There is **no** `lib/oauth-providers/pmo365_provider.py` and no `handleListProviders`/`getProviderConfig` Files-Remote wiring. The agent issues authenticated requests through the standard `connect_request` path (method + relative path + optional JSON body) using the stored OAuth token, guided by the `01*` rules. The Bearer token is attached as `Authorization: Bearer {access_token}` (standard scheme — **no** `authHeaderScheme` override). (If a future requirement adds Files-Remote browsing of Dataverse documents / `annotation` attachments, then add a provider class and set `surfaces: ['files','chat']`.)

## 3. The `environment_url` credential field + the scope wrinkle

**3a. `environment_url`** — admin records the Dataverse environment URL (e.g. `https://contoso.crm.dynamics.com`), workspace-wide, like Actionstep's `api_endpoint`. The backend expands every relative path against `{environment_url}/api/data/v9.2/`; the agent never hard-codes a host. Found in **Power Platform admin center → Environments → (your environment) → Environment URL**.

**3b. The environment-specific scope wrinkle ⚠️** — Dataverse OAuth requires a resource-specific scope `{environment_url}/.default offline_access`. But the OAuth wizard's dynamic URL interpolation **only rewrites `authUrl` and `tokenUrl`** (splices credential-field values via `<KEY>` placeholders in `OAuthWizard.tsx`'s "Dynamic URL interpolation" block). It does **not** touch `scopes`. For PMO365 the auth/token endpoints are static (`login.microsoftonline.com/organizations/…`), so nothing interpolates there — and the one field that _would_ need to flow into the scope (`environment_url`) is never substituted. **Consequence:** the registry ships the scope with the literal placeholder `https://YOUR-ENV.crm.dynamics.com/.default offline_access`. After pasting `environment_url`, the admin **must open the wizard's Advanced section and replace `YOUR-ENV.crm.dynamics.com` in the scope with their environment host** (the last `oauthSetupSteps` line instructs this). If the scope host doesn't match the environment, the token is issued for the wrong resource and Dataverse returns **401** on every call.

**3c. Recommended follow-up — auto-derive the scope from `environment_url`** (removes the only fiddly setup step, the most likely place an admin errs — host typo, leftover placeholder, trailing slash):

1. **Wizard-side interpolation (preferred, frontend-only).** Extend the interpolation step in `OAuthWizard.tsx` to also substitute `<KEY>` placeholders into `scopes` (not just `authUrl`/`tokenUrl`). Change the registry scope to `<ENVIRONMENT_URL>/.default offline_access`; the wizard rewrites it from the `environment_url` field. Normalise (strip trailing `/`) before splicing. Generalises to any future resource-scoped Microsoft connector.
2. **Backend derivation at token exchange.** Have the token-exchange handler construct the scope from the stored `environment_url` (`f"{environment_url.rstrip('/')}/.default offline_access"`) rather than trusting the persisted string, making the Advanced field a fallback/override only.

Scope as a follow-up task — **not** required for first testing; the manual edit works.

## 4. Entra app registration (`oauthSetupSteps`)

Surfaced in the admin wizard. Produce the **Application (client) ID** + **client secret** the admin pastes, plus a **Dataverse Application User** so the app can read/write PMO365 tables:

1. **App registration.** Entra admin center → **App registrations → New registration**; _Supported account types_ → **"Accounts in any organizational directory"** (matches the `organizations` authority).
2. **Redirect URI.** Add the redirect URI shown in the wizard, type **Web**.
3. **API permission.** **API permissions → Add a permission → Dynamics CRM → Delegated → `user_impersonation`**, then **Grant admin consent**. (`user_impersonation` is what `.default` resolves to for Dataverse.)
4. **Client secret.** **Certificates & secrets → New client secret** → copy the **Value** (not the secret ID); copy the **Application (client) ID** from **Overview**.
5. **Application User + security role.** Power Platform admin center → add an **Application User** for this app registration, assign a **security role** granting read/write on the PMO365 tables. Without this, tokens authenticate but every call returns **403** (missing privilege).
6. **Environment URL + scope.** Paste `environment_url`, then open **Advanced** and replace `YOUR-ENV.crm.dynamics.com` in the scope with your environment host (§3b).

## 5. Workspace Agent Specs (DONE) & Deploy mechanism

Agent knowledge pack: `01-llm-api-rules.md` (main rules) + `01a-domain-model-reference.md`, `01b-query-patterns.md`, `01c-mutation-patterns.md`, `01d-event-and-error-handling.md`.

**Deploy.** `numa-client-stack.ts` walks the `ext-api-doc/` tree at synth (skipping `_templates/`) and uploads every file to the per-client `ext-api-doc` S3 bucket as an `S3Object`, keyed by path **relative to `ext-api-doc/`** (this file → S3 key `pmo365/03-connector-setup.md`). At runtime the agent's S3 sync downloads the **`01-*.md`** files for each active connector into **`/workdir/api-docs/pmo365/`** (`s3_workspace.py`); the system prompt advertises that path (`prompts.py`: `/workdir/api-docs/{name}/`). The folder name **`pmo365`** must equal the registry `id` — enforced by `tools/check-connector-docs.mjs`.

> Only the `01-*.md` files are pulled into the agent's `/workdir`. `00`, `02`, `03` (this file), `04` live in S3 but are NOT loaded into the model's context.

## 6. Deployment Checklist

**Code (done in this branch):**

- [x] Registry entry added (`connectorRegistry.ts` — `pmo365`)
- [x] `ext-api-doc/pmo365/` specs committed (`01`–`01d`, plus `00`/`02`/`03`/`04`)
- [ ] Parity check passes (`node tools/check-connector-docs.mjs`)
- [ ] Native-connector catalog entry confirmed in `infra/config/connectors.ts`
- [ ] Frontend lint + typecheck clean (`yarn lint && yarn typecheck`)

**External / deploy (developer):**

- [ ] Register an Entra app per customer, capture **Client ID** + **secret** (§4)
- [ ] Add the **Dataverse Application User** with a read/write security role on the PMO365 tables
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` S3 sync + `NATIVE_CONNECTORS`)
- [ ] Verify `s3://numa-<client>-ext-api-doc/pmo365/01-*.md` objects exist after deploy
- [ ] Confirm the connector appears in **/integrations** (gated by `DATA_CONNECTORS_ENABLED`)
- [ ] **Phase 2 smoke test** against the customer's Dataverse environment (§7 + `04-connection-and-reauth.md`)
- [ ] Confirm the [INFERRED] items: real `pmo_*` table & column names (via discovery / `$metadata`), option-set values, statecode/statuscode state machine

## 7. Testing Plan

**Manual sequence:**

1. **Admin setup:** open the PMO365 OAuth wizard, enter Client ID/Secret, paste `environment_url`, then in **Advanced** replace `YOUR-ENV.crm.dynamics.com` in the scope with the environment host (§3b). Save.
2. **User connect:** **Connect** → authorize on `login.microsoftonline.com/organizations` (consent to Dynamics CRM `user_impersonation`) → token exchange. `offline_access` ⇒ a refresh token is stored.
3. **Discovery (Phase 2 gate):** ask the agent to "find the PMO365 solution and list its tables". Expect in order: `GET /solutions?$select=solutionid,uniquename,friendlyname,version&$filter=contains(uniquename,'pmo') or contains(friendlyname,'pmo')` → `GET /solutioncomponents?$filter=_solutionid_value eq {solutionid} and componenttype eq 1&$select=objectid` → `GET /EntityDefinitions({metadataid})?$select=LogicalName,EntitySetName,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute`. This resolves the real `pmo_*` `EntitySetName`s at runtime — proprietary, never hard-coded.
4. **Read:** "list the active PMO365 projects" → e.g. (ILLUSTRATIVE — confirm the entity set via discovery) `GET /pmo_projects?$select=pmo_name,pmo_projectid,statuscode&$top=20` with `Prefer: odata.include-annotations="*"` so labels come back as `@OData.Community.Display.V1.FormattedValue`. Sample: `{"@odata.context":"https://contoso.crm.dynamics.com/api/data/v9.2/$metadata#pmo_projects(pmo_name,pmo_projectid,statuscode)","value":[{"@odata.etag":"W/\"123456\"","pmo_name":"Customer Portal Rebuild","pmo_projectid":"8f2c1e90-7c4a-4f12-9b3a-0c1d2e3f4a5b","statuscode":1,"statuscode@OData.Community.Display.V1.FormattedValue":"Active"}],"@odata.nextLink":"https://contoso.crm.dynamics.com/api/data/v9.2/pmo_projects?$select=pmo_name,pmo_projectid,statuscode&$skiptoken=..."}`. Follow `@odata.nextLink` **verbatim** (server-driven paging); page size via `Prefer: odata.maxpagesize=N` (max 5000). Do **not** hand-roll `$skip`.
5. **Expand a lookup:** "show project X with its owning programme" → `GET /pmo_projects({id})?$expand=pmo_ProgrammeId($select=pmo_name)` (ILLUSTRATIVE nav property — confirm via `$metadata`). The lookup GUID column is `_pmo_programmeid_value`.
6. **Write (create):** "create a risk on project X" → `POST /pmo_risks` body `{"pmo_name":"Vendor delay","pmo_ProjectId@odata.bind":"/pmo_projects({id})"}` ⇒ **204 No Content** + `OData-EntityId` response header (URL of the new row), or **201** + body if `Prefer: return=representation`.
7. **Write (update):** "set that risk's status" → `PATCH /pmo_risks({id})` with **`If-Match: *`** to force update-only (PATCH is an **upsert** — without `If-Match: *` it creates a row if the id is absent).
8. **Polling for changes:** no Numa-hosted webhook receiver yet. Verify the agent polls: `GET /pmo_projects?$filter=modifiedon gt 2026-05-29T00:00:00Z&$orderby=modifiedon asc` at interval **≥5 min**.
9. **Disconnect:** removes the user secret only; the workspace-wide `environment_url` and Entra app config remain.

**Edge cases:**

- [ ] **401** (token expired, ~1h) → backend refreshes via `offline_access` + retries once; 2nd 401 ⇒ user reconnects
- [ ] **401 on every call** → wrong scope host (placeholder not replaced in Advanced, §3b)
- [ ] **403** → Application User missing / security role lacks the privilege (§4 step 5)
- [ ] **404** → wrong `EntitySetName` (NOT the logical name — `pmo_project` → `pmo_projects`; resolve via discovery) or a wrong record GUID
- [ ] **412** → `If-Match: *` precondition failed on PATCH
- [ ] **429** → honour `Retry-After` (seconds); avoid tight loops (per-user sliding 5-min window, three facets: ~6,000 requests / ~20 min (1,200,000 ms) combined execution time / ~52 concurrent requests)
- [ ] **Pagination** beyond one page → `@odata.nextLink` followed verbatim until absent

## Honesty rule (carry into every spec)

PMO365's actual table/column names (`pmo_project`, `pmo_risk`, `pmo_benefit`, …) are **proprietary and not publicly documented**. Every such name here is an **ILLUSTRATIVE [INFERRED]** example, always paired with the **discovery query** that yields the real name at runtime. Never mark a specific `pmo_*` name `[CONFIRMED]`. Discovery-first (`/solutions` → `/solutioncomponents` → `/EntityDefinitions`, or `$metadata`) is how the real schema is obtained — not by guessing.

## Sources

- Dataverse Web API (OData v4): https://learn.microsoft.com/power-apps/developer/data-platform/webapi/overview
- Query data with the Web API: https://learn.microsoft.com/power-apps/developer/data-platform/webapi/query-data-web-api
- Create / Update / Delete: https://learn.microsoft.com/power-apps/developer/data-platform/webapi/create-entity-web-api
- Service protection (API) limits: https://learn.microsoft.com/power-apps/developer/data-platform/api-limits
- Web API metadata: https://learn.microsoft.com/power-apps/developer/data-platform/webapi/query-metadata-web-api
- OAuth with Dataverse: https://learn.microsoft.com/power-apps/developer/data-platform/authenticate-oauth
- PMO365 (EPM Partners): https://www.pmo365.com/
